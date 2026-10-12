<?php
/**
 * JobStore backed by the WP Transients API.
 *
 * Transient key names are identical to the previous inline implementation so
 * in-flight jobs survive the refactor.
 *
 * @package Integrum\SecurityScanner\Models
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Models;

use Integrum\SecurityScanner\Contracts\JobStoreInterface;

/**
 * Persists per-job scan state through set/get/delete_transient().
 */
final class WpTransientJobStore implements JobStoreInterface {

	/**
	 * Transient name prefix shared by every per-job key.
	 */
	private const PREFIX = 'integrum_security_scanner_';

	/**
	 * Transient lifetime (1 hour) — long enough for a scan to finish, short
	 * enough that abandoned jobs are garbage collected automatically.
	 */
	private const TTL = HOUR_IN_SECONDS;

	/**
	 * {@inheritdoc}
	 */
	public function save_file_map( string $job_id, array $payload ): void {
		set_transient( self::PREFIX . 'job_' . $job_id, $payload, self::TTL );
	}

	/**
	 * {@inheritdoc}
	 */
	public function load_file_map( string $job_id ): array {
		$cached = get_transient( self::PREFIX . 'job_' . $job_id );
		return is_array( $cached ) ? $cached : array();
	}

	/**
	 * {@inheritdoc}
	 */
	public function save_done( string $job_id, array $done ): void {
		set_transient( self::PREFIX . 'done_' . $job_id, $done, self::TTL );
	}

	/**
	 * {@inheritdoc}
	 */
	public function load_done( string $job_id ): array {
		$cached = get_transient( self::PREFIX . 'done_' . $job_id );
		return is_array( $cached ) ? $cached : array();
	}

	/**
	 * {@inheritdoc}
	 */
	public function save_progress( string $job_id, array $progress ): void {
		set_transient( self::PREFIX . 'progress_' . $job_id, $progress, self::TTL );
	}

	/**
	 * {@inheritdoc}
	 */
	public function load_progress( string $job_id ): array {
		$cached = get_transient( self::PREFIX . 'progress_' . $job_id );
		return is_array( $cached ) ? $cached : array();
	}

	/**
	 * {@inheritdoc}
	 */
	public function save_failures( string $job_id, int $count ): void {
		set_transient( self::PREFIX . 'fail_' . $job_id, $count, self::TTL );
	}

	/**
	 * {@inheritdoc}
	 */
	public function load_failures( string $job_id ): int {
		return (int) get_transient( self::PREFIX . 'fail_' . $job_id );
	}

	/**
	 * {@inheritdoc}
	 */
	public function delete_failures( string $job_id ): void {
		delete_transient( self::PREFIX . 'fail_' . $job_id );
	}
}
