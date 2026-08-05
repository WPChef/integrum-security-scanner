<?php
/**
 * Simple JSON response helper (single responsibility — output formatting).
 *
 * @package Llar\SecurityScanner\E2e\Mock
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\E2e\Mock;

/**
 * Sends a JSON response and terminates.
 */
final class JsonResponse {

	/**
	 * Writes a JSON payload with the given HTTP status and exits.
	 *
	 * @param int                  $code    HTTP status code.
	 * @param array<string, mixed> $payload Body.
	 */
	public static function send( int $code, array $payload ): never {
		http_response_code( $code );
		header( 'Content-Type: application/json' );
		echo json_encode( $payload );
		exit;
	}

	/**
	 * Shortcut for a 200 OK response.
	 *
	 * @param array<string, mixed> $payload Body.
	 */
	public static function ok( array $payload ): never {
		self::send( 200, $payload );
	}

	/**
	 * Shortcut for an error response. The message goes under the "error" key.
	 *
	 * @param int    $code    HTTP status code.
	 * @param string $message Error message.
	 */
	public static function error( int $code, string $message ): never {
		self::send( $code, array( 'error' => $message ) );
	}
}
