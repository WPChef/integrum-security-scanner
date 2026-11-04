<?php
/**
 * Database scanner contract (Imunify Connect DB API).
 *
 * @package Integrum\SecurityScanner\Contracts
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Contracts;

use Integrum\SecurityScanner\Models\Db\DbFinding;

interface DbScannerInterface {

	/**
	 * Starts a database scan job. Returns the remote job id.
	 *
	 * @return string Job id.
	 *
	 * @throws ScanException On auth / quota / transport failure.
	 */
	public function start(): string;

	/**
	 * Advances the job: submits the next content batch (or finalises).
	 *
	 * @param string $job_id Remote job id.
	 * @return array{status: string, progress_pct: int, message?: string}
	 *
	 * @throws ScanException On terminal failure.
	 */
	public function tick( string $job_id ): array;

	/**
	 * Stops local submission for this job (server job may remain abandoned).
	 *
	 * @param string $job_id Remote job id.
	 */
	public function stop( string $job_id ): void;

	/**
	 * Returns detected findings for a completed (or in-progress) job.
	 *
	 * @param string $job_id Remote job id.
	 * @return DbFinding[]
	 *
	 * @throws ScanException On transport / auth failure.
	 */
	public function get_results( string $job_id ): array;
}
