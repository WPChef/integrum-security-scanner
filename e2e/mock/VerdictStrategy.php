<?php
/**
 * Verdict strategy (OCP — replaceable).
 *
 * Determines the simulated scan action and verdict for a file based on
 * its index. Plug in a different strategy to change the mock behaviour
 * without touching the scan engine.
 *
 * @package Llar\SecurityScanner\E2e\Mock
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\E2e\Mock;

/**
 * Maps a file_index to a scan action + verdict.
 */
interface VerdictStrategy {

	/**
	 * Returns the simulated Imunify action for this file.
	 *
	 * @param int $file_index Zero-based index in the manifest.
	 * @return string needs_sha256|needs_upload|has_verdict
	 */
	public function action( int $file_index ): string;

	/**
	 * Returns the final verdict for this file.
	 *
	 * @param int $file_index Zero-based index.
	 * @return string clean|malicious|suspicious
	 */
	public function verdict( int $file_index ): string;

	/**
	 * Returns a human-readable signature name for a verdict.
	 *
	 * @param string $verdict Verdict.
	 * @return string Empty for clean files.
	 */
	public function signature( string $verdict ): string;
}
