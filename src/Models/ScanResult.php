<?php
/**
 * Scan result DTO.
 *
 * @package Llar\SecurityScanner\Models
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\Models;

/**
 * Immutable scan result for a single file.
 */
final class ScanResult {

	public readonly string $file_path;

	public readonly string $status;

	public readonly string $threat_type;

	public readonly string $severity;

	public readonly ?string $scanned_at;

	/**
	 * Constructor.
	 *
	 * @param string      $file_path   Relative path from ABSPATH.
	 * @param string      $status      clean|infected|suspicious|error.
	 * @param string      $threat_type Threat class (empty if clean).
	 * @param string      $severity    info|low|medium|high|critical.
	 * @param string|null $scanned_at  ISO-8601 timestamp.
	 */
	public function __construct(
		string $file_path,
		string $status,
		string $threat_type = '',
		string $severity = 'info',
		?string $scanned_at = null
	) {
		$this->file_path   = $file_path;
		$this->status      = $status;
		$this->threat_type = $threat_type;
		$this->severity    = $severity;
		$this->scanned_at  = $scanned_at;
	}
}
