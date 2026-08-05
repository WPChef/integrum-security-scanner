<?php
/**
 * JSON file state store.
 *
 * Reads/writes a single JSON file atomically. No DB, no lock — sufficient
 * for the PHP built-in server where requests are serialised.
 *
 * @package Llar\SecurityScanner\E2e\Mock
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\E2e\Mock;

/**
 * Persists key-value state through a JSON file.
 */
final class StateStore {

	/**
	 * Constructor.
	 *
	 * @param string $path Absolute path to the JSON file.
	 */
	public function __construct( private string $path ) {}

	/**
	 * Loads the full state array.
	 *
	 * @return array<string, mixed>
	 */
	public function load(): array {
		if ( ! is_file( $this->path ) ) {
			return array();
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$raw = file_get_contents( $this->path );
		if ( false === $raw ) {
			return array();
		}

		$data = json_decode( $raw, true );

		return is_array( $data ) ? $data : array();
	}

	/**
	 * Persists state to disk atomically (tmp + rename).
	 *
	 * @param array<string, mixed> $state State.
	 */
	public function save( array $state ): void {
		$json = json_encode( $state, JSON_PRETTY_PRINT );
		$tmp  = $this->path . '.tmp';
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		file_put_contents( $tmp, $json );
		rename( $tmp, $this->path );
	}

	/**
	 * Deletes the state file.
	 */
	public function reset(): void {
		if ( is_file( $this->path ) ) {
			unlink( $this->path );
		}
	}
}
