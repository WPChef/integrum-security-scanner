<?php
/**
 * Shared mapping of Imunify Connect 401/403 bodies to ScanException.
 *
 * @package Integrum\SecurityScanner\Models
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Models;

use Integrum\SecurityScanner\Contracts\ScanException;

/**
 * One place for auth vs quota_exceeded handling (file + DB clients).
 */
final class ImunifyHttpErrors {

	/**
	 * Builds a ScanException for a 401/403 Connect response.
	 *
	 * A 403 "quota_exceeded" is not an auth error: the key is valid, the plan
	 * limit was hit. Code stays 403 so the UI does not tell the user to fetch
	 * a new key. Wording is ours: the raw API "Scan quota exceeded" reads like
	 * a technical failure, so callers pass a plan explanation as $quota_fallback.
	 *
	 * @param array{code?: int, body?: array<string, mixed>} $resp             Decoded HTTP response.
	 * @param string                                         $quota_fallback   Plan explanation for quota_exceeded.
	 * @param string                                         $rejected_fallback Default for non-quota 403/empty body.
	 * @param bool                                           $prefer_db_reset  Prefer quota.db_resets_in over resets_in.
	 */
	public static function auth_or_quota(
		array $resp,
		string $quota_fallback,
		string $rejected_fallback,
		bool $prefer_db_reset = false
	): ScanException {
		$http_code = (int) ( $resp['code'] ?? 0 );
		$body      = is_array( $resp['body'] ?? null ) ? $resp['body'] : array();
		$api_code  = (string) ( $body['code'] ?? '' );
		$message   = (string) ( $body['error'] ?? '' );

		if ( 403 === $http_code && 'quota_exceeded' === $api_code ) {
			$msg   = $quota_fallback;
			$quota = is_array( $body['quota'] ?? null ) ? $body['quota'] : array();
			$resets = $prefer_db_reset
				? (int) ( $quota['db_resets_in'] ?? $quota['resets_in'] ?? 0 )
				: (int) ( $quota['resets_in'] ?? 0 );
			// Free plan resets monthly; fall back to 30 days when the API omits
			// the reset interval so the message keeps its full wording.
			$days = $resets > 0 ? max( 1, (int) round( $resets / 86400 ) ) : 30;
			$msg .= ' ' . sprintf(
				/* translators: %d: number of days until the scan quota resets. */
				_n( 'You can scan again in %d day.', 'You can scan again in %d days.', $days, 'integrum-security-scanner' ),
				$days
			);
			return new ScanException( $msg, 403 );
		}

		if ( '' === $message ) {
			$message = 401 === $http_code
				? __( 'Invalid site key.', 'integrum-security-scanner' )
				: $rejected_fallback;
		}

		return new ScanException( $message, 401 === $http_code ? 401 : 403 );
	}
}
