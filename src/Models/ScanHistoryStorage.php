<?php
/**
 * Persistent scan history.
 *
 * @package Llar\SecurityScanner\Models
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\Models;

/**
 * Keeps the list of finished scan runs in a no-autoload option so the admin
 * page can render the "Scan history" table without touching the (ephemeral,
 * transient-backed) job storage.
 *
 * Each run record:
 *   job_id      string  Imunify job id (unique per scan, used for dedupe).
 *   finished_at int     Unix timestamp of the moment completion was observed.
 *   scanned     int     Files checked in the run (status counters preferred;
 *                       counting result rows is the fallback).
 *   problems    int     Non-clean verdicts (infected/suspicious/error).
 *   files       array   Problem files only, capped to MAX_FILES, in the same
 *                       row shape serialize_results() produces so the JS tree
 *                       renderer (renderFile) can consume them as-is.
 */
final class ScanHistoryStorage {

	private const OPTION_NAME = 'site_integrity_scanner_history';

	/** How many runs to keep (newest first, older dropped). */
	private const MAX_RUNS = 20;

	/** How many problem files to store per run (counter stays exact). */
	private const MAX_FILES = 500;

	/**
	 * Records a finished run.
	 *
	 * Idempotent per job: recording the same job twice returns the stored
	 * record unchanged, so both the status poll and a results fetch can call
	 * this safely.
	 *
	 * @param string       $job_id      Job id.
	 * @param ScanResult[] $results    Verdicts of the run.
	 * @param int|null     $finished_at Completion timestamp (defaults to now; injectable for tests).
	 * @param int|null     $scanned_total Total files checked, from the status counters.
	 *                       /results can omit clean files (or list nothing at all once
	 *                       every action resolved server-side), so counting rows can
	 *                       understate the run — the real API would archive "0 scanned".
	 *                       Non-positive values fall back to counting rows.
	 * @return array<string, mixed>|null The stored record, or the previously stored one for a duplicate job.
	 */
	public function record( string $job_id, array $results, ?int $finished_at = null, ?int $scanned_total = null ): ?array {
		$runs = $this->all();

		foreach ( $runs as $run ) {
			if ( $run['job_id'] === $job_id ) {
				return $run;
			}
		}

		$scanned  = 0;
		$problems = 0;
		$files    = array();

		foreach ( $results as $result ) {
			if ( ! $result instanceof ScanResult ) {
				continue;
			}

			++$scanned;
			if ( 'clean' === $result->status ) {
				continue;
			}

			++$problems;
			if ( count( $files ) < self::MAX_FILES ) {
				$files[] = array(
					'file_path'   => $result->file_path,
					'status'      => $result->status,
					'threat_type' => $result->threat_type,
					'severity'    => $result->severity,
					'detail'      => $result->detail,
				);
			}
		}

		$record = array(
			'job_id'      => $job_id,
			'finished_at' => $finished_at ?? time(),
			'scanned'     => $scanned_total > 0 ? $scanned_total : $scanned,
			'problems'    => $problems,
			'files'       => $files,
		);

		array_unshift( $runs, $record );
		$runs = array_slice( $runs, 0, self::MAX_RUNS );

		update_option( self::OPTION_NAME, $runs, false );

		return $record;
	}

	/**
	 * Returns the stored runs, newest first, with corrupted entries dropped.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public function all(): array {
		$saved = get_option( self::OPTION_NAME, array() );
		if ( ! is_array( $saved ) ) {
			return array();
		}

		$out = array();
		foreach ( $saved as $run ) {
			$normalised = $this->normalise_run( $run );
			if ( null !== $normalised ) {
				$out[] = $normalised;
			}
		}

		return $out;
	}

	/**
	 * Validates and normalises a single stored run.
	 *
	 * @param mixed $run Raw stored value.
	 * @return array<string, mixed>|null Null when the entry is unusable.
	 */
	private function normalise_run( $run ): ?array {
		if ( ! is_array( $run ) ) {
			return null;
		}

		$job_id      = $run['job_id'] ?? '';
		$finished_at = $run['finished_at'] ?? 0;

		if ( ! is_string( $job_id ) || '' === $job_id || ! is_int( $finished_at ) || $finished_at <= 0 ) {
			return null;
		}

		$files = array();
		if ( isset( $run['files'] ) && is_array( $run['files'] ) ) {
			foreach ( $run['files'] as $file ) {
				if ( is_array( $file ) && isset( $file['file_path'] ) && is_string( $file['file_path'] ) && '' !== $file['file_path'] ) {
					$files[] = array(
						'file_path'   => $file['file_path'],
						'status'      => is_string( $file['status'] ?? null ) ? $file['status'] : '',
						'threat_type' => is_string( $file['threat_type'] ?? null ) ? $file['threat_type'] : '',
						'severity'    => is_string( $file['severity'] ?? null ) ? $file['severity'] : '',
						'detail'      => isset( $file['detail'] ) && is_array( $file['detail'] ) ? $file['detail'] : array(),
					);
				}
			}
		}

		return array(
			'job_id'      => $job_id,
			'finished_at' => $finished_at,
			'scanned'     => is_int( $run['scanned'] ?? null ) ? $run['scanned'] : count( $files ),
			'problems'    => is_int( $run['problems'] ?? null ) ? $run['problems'] : count( $files ),
			'files'       => $files,
		);
	}
}
