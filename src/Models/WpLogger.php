<?php
/**
 * Logger backed by PHP/WordPress native `error_log()`.
 *
 * When `WP_DEBUG_LOG` is enabled, WordPress routes `error_log()` output to
 * `wp-content/debug.log`; otherwise it lands in the server PHP error log.
 * No custom file is created.
 *
 * @package Llar\SecurityScanner\Models
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\Models;

use Llar\SecurityScanner\Contracts\LoggerInterface;

/**
 * Thin adapter over error_log().
 */
final class WpLogger implements LoggerInterface {

	/**
	 * {@inheritdoc}
	 */
	public function debug( string $message, array $context = array() ): void {
		$this->log( 'DEBUG', $message, $context );
	}

	/**
	 * {@inheritdoc}
	 */
	public function error( string $message, array $context = array() ): void {
		$this->log( 'ERROR', $message, $context );
	}

	/**
	 * Formats one line and hands it to error_log().
	 *
	 * @param string               $level   Level name.
	 * @param string               $message Message.
	 * @param array<string, mixed> $context Context.
	 */
	private function log( string $level, string $message, array $context ): void {
		$line = '[' . gmdate( 'Y-m-d H:i:s' ) . '] ' . $level . ' ' . $message;
		if ( array() !== $context ) {
			$encoded = wp_json_encode( $context );
			if ( false !== $encoded ) {
				$line .= ' ' . $encoded;
			}
		}
		error_log( $line ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
	}
}
