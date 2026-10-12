<?php
/**
 * File collector contract.
 *
 * Decouples ImunifyScanner from the concrete directory walker so the manifest
 * builder can be substituted (e.g. a cached or streamed implementation in
 * tests or for very large sites).
 *
 * @package Integrum\SecurityScanner\Contracts
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Contracts;

/**
 * Builds the list of candidate files to send to the scanner.
 */
interface FileCollectorInterface {

	/**
	 * Builds the candidate list.
	 *
	 * @param string[] $directories    Absolute directory paths.
	 * @param string[] $include_masks  Glob masks; empty = everything.
	 * @param string[] $exclude_masks  Glob masks; always win.
	 * @param string   $root           Root path used to compute relative paths.
	 * @return string[] Relative paths from $root.
	 */
	public function collect( array $directories, array $include_masks, array $exclude_masks, string $root ): array;
}
