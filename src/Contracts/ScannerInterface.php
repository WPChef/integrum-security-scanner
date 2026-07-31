<?php
/**
 * Scanner contract.
 *
 * @package Llar\Imunify\Contracts
 */

declare( strict_types = 1 );

namespace Llar\Imunify\Contracts;

use Llar\Imunify\Models\ScanResult;

interface ScannerInterface {

	/**
	 * Starts a scan and returns its job id.
	 *
	 * @param string[] $directories    Absolute paths.
	 * @param string[] $include_masks  Glob patterns.
	 * @param string[] $exclude_masks  Glob patterns.
	 * @return string Scan job id.
	 *
	 * @throws ScanException On failure.
	 */
	public function start_scan( array $directories, array $include_masks, array $exclude_masks ): string;

	/**
	 * Returns the current job status plus progress percentage.
	 *
	 * Drives the asynchronous handshake forward: any pending file actions
	 * reported by the scanner (needs_sha256 / needs_upload) are processed on
	 * each call so the job can progress towards completion.
	 *
	 * @param string $scan_job_id Job id.
	 * @return array{status: string, progress_pct: int}
	 *
	 * @throws ScanException On transport / auth failure.
	 */
	public function get_status( string $scan_job_id ): array;

	/**
	 * Returns per-file verdicts once the job is complete.
	 *
	 * @param string $scan_job_id Job id.
	 * @return ScanResult[]
	 *
	 * @throws ScanException On transport / auth failure.
	 */
	public function get_results( string $scan_job_id ): array;
}
