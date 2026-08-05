<?php
/**
 * Scan engine — single responsibility.
 *
 * Manages the lifecycle of a scan job: creation, hash submission, file upload,
 * polling with progressive auto-completion. Delegates verdict assignment to
 * an injected VerdictStrategy.
 *
 * Response shapes mirror the real Imunify Connect API:
 *   - GET /results `files[]` exposes ONLY files awaiting an action
 *     (needs_sha256, needs_upload, pending_scan) while the job is processing.
 *     Files with a verdict are excluded from `files[]` during processing and
 *     counted in `summary`. Once `is_complete`, `files[]` carries the final
 *     verdicts so the client can read results from the same payload.
 *   - `summary` reports per-action and per-verdict counters.
 *   - Top-level identifier is `id` (not `job_id`).
 *
 * @package Llar\SecurityScanner\E2e\Mock
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\E2e\Mock;

/**
 * Imunify Connect job protocol simulator.
 */
final class ScanEngine {

	/**
	 * Polls after which remaining pending files are auto-completed.
	 */
	private const AUTO_COMPLETE_AFTER = 4;

	/**
	 * Constructor.
	 *
	 * @param StateStore      $store    State storage.
	 * @param VerdictStrategy $verdicts Verdict assignment strategy.
	 */
	public function __construct(
		private StateStore $store,
		private VerdictStrategy $verdicts,
	) {}

	/**
	 * Creates a new scan job from a file manifest.
	 *
	 * @param array<int, array{path: string, file_index: int, size: int, modified_at: int}> $files Manifest entries.
	 * @return string job_id
	 *
	 * @throws \RuntimeException When the manifest is empty.
	 */
	public function start( array $files ): string {
		if ( array() === $files ) {
			throw new \RuntimeException( 'No files' );
		}

		$job_id    = uniqid( 'job-', false );
		$job_files = array();
		foreach ( $files as $f ) {
			$idx     = (int) ( $f['file_index'] ?? -1 );
			$file_id = bin2hex( random_bytes( 8 ) );
			$verdict = $this->verdicts->verdict( $idx );

			$job_files[] = array(
				'file_id'        => $file_id,
				'file_index'     => $idx,
				'action'         => $this->verdicts->action( $idx ),
				'verdict'        => $verdict,
				'signature_name' => $this->verdicts->signature( $verdict ),
				// Deterministic placeholder hash: the real API echoes the client
				// hash once submitted. The value is irrelevant to the plugin
				// (it never reads sha256 from /results) but the field must be
				// present on non-needs_sha256 rows to match the wire shape.
				'sha256'         => hash( 'sha256', $file_id ),
			);
		}

		$state                    = $this->store->load();
		$state['jobs']            = is_array( $state['jobs'] ?? null ) ? $state['jobs'] : array();
		$state['jobs'][ $job_id ] = array(
			'status'      => 'processing',
			'is_complete' => false,
			'total'       => count( $files ),
			'done'        => 0,
			'poll_count'  => 0,
			'files'       => $job_files,
		);
		$this->store->save( $state );

		return $job_id;
	}

	/**
	 * Accepts a hash batch for a job.
	 *
	 * Lifecycle: needs_sha256 -> (malicious destiny: needs_upload | otherwise: pending_scan).
	 * The file is NOT resolved yet; pending_scan resolves to has_verdict on the next poll,
	 * mirroring the real server's asynchronous verdict processing.
	 *
	 * @param string                                             $job_id Job id.
	 * @param array<int, array{file_id: string, sha256: string}> $hashes Hash entries.
	 * @return int Number of files processed.
	 *
	 * @throws \RuntimeException When the job is not found.
	 */
	public function submit_hashes( string $job_id, array $hashes ): int {
		$state = $this->store->load();
		$job   = $this->require_job( $state, $job_id );

		$processed = 0;
		foreach ( $hashes as $h ) {
			$fid = (string) ( $h['file_id'] ?? '' );
			$sha = (string) ( $h['sha256'] ?? '' );
			foreach ( $job['files'] as &$f ) {
				if ( $f['file_id'] === $fid && 'needs_sha256' === $f['action'] ) {
					if ( '' !== $sha ) {
						$f['sha256'] = $sha;
					}
					// Server decision: needs the file body for malicious verdicts;
					// otherwise enters the pending verdict queue. `pending_since`
					// records the poll at which the file entered pending_scan so
					// resolution can be delayed by one poll (the real server
					// processes verdicts asynchronously).
					$f['action']        = ( 'malicious' === $f['verdict'] ) ? 'needs_upload' : 'pending_scan';
					$f['pending_since'] = (int) ( $job['poll_count'] ?? 0 );
					++$processed;
					break;
				}
			}
			unset( $f );
		}

		$this->recompute_done( $job );
		$state['jobs'][ $job_id ] = $job;
		$this->store->save( $state );

		return $processed;
	}

	/**
	 * Accepts a file upload for a job.
	 *
	 * Lifecycle: needs_upload -> pending_scan (verdict resolves on next poll).
	 *
	 * @param string $job_id  Job id.
	 * @param string $file_id Imunify file_id.
	 *
	 * @throws \RuntimeException When the job or file is not found.
	 */
	public function upload( string $job_id, string $file_id ): void {
		$state = $this->store->load();
		$job   = $this->require_job( $state, $job_id );

		foreach ( $job['files'] as &$f ) {
			if ( $f['file_id'] === $file_id && 'needs_upload' === $f['action'] ) {
				$f['action']        = 'pending_scan';
				$f['pending_since'] = (int) ( $job['poll_count'] ?? 0 );
				break;
			}
		}
		unset( $f );

		$this->recompute_done( $job );
		$state['jobs'][ $job_id ] = $job;
		$this->store->save( $state );
	}

	/**
	 * Polls the job status. Resolves pending_scan files to their final verdict and
	 * advances the handshake on each call.
	 *
	 * After AUTO_COMPLETE_AFTER polls, remaining pending files are auto-completed
	 * so the job eventually finishes even without the plugin sending hashes/upload.
	 *
	 * @param string $job_id Job id.
	 * @return array The full job payload as returned by the Imunify API.
	 *
	 * @throws \RuntimeException When the job is not found.
	 */
	public function poll( string $job_id ): array {
		$state = $this->store->load();
		$job   = $this->require_job( $state, $job_id );

		++$job['poll_count'];

		// The real Imunify API reissues a fresh file_id each time it surfaces a
		// file for an action (the id is per-stage, not per-file). Rotate the id
		// for every in-flight file on each poll so a file that advances
		// needs_sha256 -> needs_upload is seen with a DIFFERENT id in each stage.
		// The client always acts on the id from the current poll's body within a
		// single request cycle, so submit_hashes()/upload() still match the
		// current value below.
		foreach ( $job['files'] as &$f ) {
			if ( 'has_verdict' !== $f['action'] ) {
				$f['file_id'] = bin2hex( random_bytes( 8 ) );
			}
		}
		unset( $f );

		// Resolve files whose asynchronous verdict has matured. A file enters
		// pending_scan in response to a client action (hash/upload) between
		// polls; it must remain visible as pending_scan for at least one poll
		// before resolving, mirroring the real server's processing lag.
		foreach ( $job['files'] as &$f ) {
			if ( 'pending_scan' === $f['action'] && ( $job['poll_count'] - (int) ( $f['pending_since'] ?? 0 ) ) >= 2 ) {
				$f['action'] = 'has_verdict';
			}
		}
		unset( $f );

		// Force-complete stragglers so the job terminates even if the client
		// never satisfies every action.
		if ( $job['poll_count'] >= self::AUTO_COMPLETE_AFTER ) {
			foreach ( $job['files'] as &$f ) {
				if ( 'has_verdict' !== $f['action'] ) {
					$f['action'] = 'has_verdict';
				}
			}
			unset( $f );
		}

		$this->try_complete( $job );
		$this->recompute_done( $job );

		$state['jobs'][ $job_id ] = $job;
		$this->store->save( $state );

		// During processing the wire payload exposes only files awaiting an
		// action. Once complete, it carries the verdicts so the client can read
		// results from the same endpoint.
		if ( $job['is_complete'] ) {
			$files_out = array_map( array( $this, 'verdict_row' ), $job['files'] );
		} else {
			$files_out = array();
			foreach ( $job['files'] as $f ) {
				if ( 'has_verdict' !== $f['action'] ) {
					$files_out[] = $this->action_row( $f );
				}
			}
		}

		return array(
			'id'              => $job_id,
			'status'          => $job['status'],
			'total_files'     => $job['total'],
			'completed_files' => $job['done'],
			'is_complete'     => $job['is_complete'],
			'files'           => $files_out,
			'summary'         => $this->summary( $job['files'] ),
		);
	}

	/**
	 * Returns a summary of all jobs.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public function all_jobs(): array {
		$state = $this->store->load();
		$jobs  = is_array( $state['jobs'] ?? null ) ? $state['jobs'] : array();

		return array_map(
			function ( array $j ) {
				return array(
					'status'      => $j['status'],
					'is_complete' => $j['is_complete'],
					'total'       => $j['total'],
					'done'        => $j['done'],
					'poll_count'  => $j['poll_count'],
				);
			},
			$jobs
		);
	}

	// -----------------------------------------------------------------------
	// Response row builders
	// -----------------------------------------------------------------------

	/**
	 * Builds the wire row for a file still awaiting an action.
	 *
	 * `sha256` is omitted on needs_sha256 (client has not submitted a hash yet)
	 * and present otherwise — matching the observed real-API shape.
	 *
	 * @param array<string, mixed> $f Stored file.
	 * @return array<string, mixed>
	 */
	private function action_row( array $f ): array {
		$row = array(
			'file_id'    => $f['file_id'],
			'file_index' => $f['file_index'],
			'action'     => $f['action'],
		);
		if ( 'needs_sha256' !== $f['action'] ) {
			$row['sha256'] = $f['sha256'];
		}
		return $row;
	}

	/**
	 * Builds the wire row for a file with a final verdict.
	 *
	 * @param array<string, mixed> $f Stored file.
	 * @return array<string, mixed>
	 */
	private function verdict_row( array $f ): array {
		return array(
			'file_id'        => $f['file_id'],
			'file_index'     => $f['file_index'],
			'action'         => 'has_verdict',
			'sha256'         => $f['sha256'],
			'verdict'        => $f['verdict'],
			'signature_name' => $f['signature_name'],
			'scanned_at'     => gmdate( 'Y-m-d\TH:i:s\Z' ),
		);
	}

	/**
	 * Builds the summary object with per-action and per-verdict counters.
	 *
	 * @param array<int, array<string, mixed>> $files Stored files.
	 * @return array<string, int>
	 */
	private function summary( array $files ): array {
		$actions  = array(
			'needs_sha256' => 0,
			'needs_upload' => 0,
			'pending_scan' => 0,
			'has_verdict'  => 0,
		);
		$verdicts = array(
			'clean'      => 0,
			'malicious'  => 0,
			'suspicious' => 0,
			'unknown'    => 0,
		);

		foreach ( $files as $f ) {
			$action = $f['action'];
			if ( isset( $actions[ $action ] ) ) {
				++$actions[ $action ];
			}
			if ( 'has_verdict' === $action ) {
				$v = $f['verdict'];
				if ( isset( $verdicts[ $v ] ) ) {
					++$verdicts[ $v ];
				} else {
					++$verdicts['unknown'];
				}
			}
		}

		return array_merge( $actions, $verdicts );
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Recomputes the completed-files counter from the file list.
	 *
	 * The real API reports `completed_files` equal to the number of files with
	 * a final verdict, so we derive it rather than mutating it ad hoc.
	 *
	 * @param array $job Mutable job array.
	 */
	private function recompute_done( array &$job ): void {
		$count = 0;
		foreach ( $job['files'] as $f ) {
			if ( 'has_verdict' === $f['action'] ) {
				++$count;
			}
		}
		$job['done'] = $count;
	}

	/**
	 * Retrieves a job from state or throws.
	 *
	 * @param array<string, mixed> $state  Full state array.
	 * @param string               $job_id Job id.
	 * @return array The mutable job array.
	 *
	 * @throws \RuntimeException When not found.
	 */
	private function require_job( array $state, string $job_id ): array {
		$jobs = is_array( $state['jobs'] ?? null ) ? $state['jobs'] : array();
		$job  = $jobs[ $job_id ] ?? null;

		if ( null === $job || ! is_array( $job ) ) {
			throw new \RuntimeException( 'Job not found' );
		}

		return $job;
	}

	/**
	 * Marks the job complete when all files have verdicts.
	 *
	 * @param array $job Mutable job array.
	 */
	private function try_complete( array &$job ): void {
		foreach ( $job['files'] as $f ) {
			if ( 'has_verdict' !== $f['action'] ) {
				return;
			}
		}

		$job['status']      = 'completed';
		$job['is_complete'] = true;
	}
}
