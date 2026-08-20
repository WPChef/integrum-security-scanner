<?php
/**
 * Validates scanner / licensing API base URLs.
 *
 * @package Llar\SecurityScanner\Models
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\Models;

/**
 * Ensures API endpoints are absolute https URLs (http only when explicitly allowed).
 */
final class ApiBaseUrl {

	/**
	 * Resolves a candidate URL or returns the trusted fallback.
	 *
	 * @param string $candidate      Candidate from filter / config.
	 * @param string $fallback       Trusted default (must itself be https).
	 * @param bool   $allow_insecure When true, http:// is accepted (local e2e/mock).
	 */
	public static function resolve( string $candidate, string $fallback, bool $allow_insecure = false ): string {
		$candidate = self::normalise( $candidate );
		if ( self::is_allowed( $candidate, $allow_insecure ) ) {
			return $candidate;
		}

		return self::normalise( $fallback );
	}

	/**
	 * @param string $url            Absolute URL.
	 * @param bool   $allow_insecure Allow http.
	 */
	public static function is_allowed( string $url, bool $allow_insecure ): bool {
		if ( '' === $url ) {
			return false;
		}

		if ( false === filter_var( $url, FILTER_VALIDATE_URL ) ) {
			return false;
		}

		$scheme = strtolower( (string) ( parse_url( $url, PHP_URL_SCHEME ) ?? '' ) );
		if ( 'https' === $scheme ) {
			return true;
		}

		return $allow_insecure && 'http' === $scheme;
	}

	/**
	 * Trims trailing slashes from the URL path root.
	 *
	 * @param string $url URL.
	 */
	private static function normalise( string $url ): string {
		$url = trim( $url );
		if ( function_exists( 'esc_url_raw' ) ) {
			$url = (string) esc_url_raw( $url );
		}

		return rtrim( $url, '/' );
	}
}
