<?php
/**
 * Registers the site with the LLAR licensing service and stores the key.
 *
 * Owns the licensing HTTP call so the controller does not reach into the
 * transport layer. Returns a UI-ready notice; the controller decides how to
 * surface it.
 *
 * @package Integrum\SecurityScanner\Services
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Services;

use Integrum\SecurityScanner\Contracts\CredentialStorageInterface;
use Integrum\SecurityScanner\Contracts\HttpClientInterface;
use Integrum\SecurityScanner\Contracts\HttpException;
use Integrum\SecurityScanner\Contracts\LoggerInterface;

/**
 * Single responsibility: turn (domain, email) into a stored site key.
 */
final class LicensingService {

	/**
	 * Constructor.
	 *
	 * @param HttpClientInterface        $http    HTTP client.
	 * @param LoggerInterface            $logger  Logger.
	 * @param CredentialStorageInterface $storage Credential storage.
	 * @param string                     $api_base LLAR licensing API base URL.
	 */
	public function __construct(
		private HttpClientInterface $http,
		private LoggerInterface $logger,
		private CredentialStorageInterface $storage,
		private string $api_base
	) {
	}

	/**
	 * Registers the site and stores the returned credentials.
	 *
	 * The returned notice message is plain text; the caller must escape it for
	 * the output context (it carries no markup). On any error response the
	 * API-provided error text is surfaced verbatim, so the message may come
	 * straight from the remote service.
	 *
	 * @param string $domain Site domain.
	 * @param string $email  Owner email.
	 * @return array{type: string, message: string}
	 */
	public function register( string $domain, string $email ): array {
		if ( '' === $domain || ! is_email( $email ) ) {
			return array(
				'type'    => 'error',
				'message' => __( 'Please provide a valid email address.', 'integrum-security-scanner' ),
			);
		}

		try {
			$resp = $this->http->request(
				'POST',
				$this->api_base,
				array(
					'domain' => $domain,
					'email'  => $email,
				)
			);
		} catch ( HttpException $e ) {
			$this->logger->error( 'site registration failed', array( 'message' => $e->getMessage() ) );

			return array(
				'type'    => 'error',
				'message' => __( 'Could not reach the licensing service. Please try again.', 'integrum-security-scanner' ),
			);
		}

		if ( 400 === $resp['code'] ) {
			return array(
				'type'    => 'error',
				'message' => $this->api_error_message( $resp['body'] ),
			);
		}

		if ( $resp['code'] < 200 || $resp['code'] >= 300 || empty( $resp['body']['site_key'] ) ) {
			$this->logger->error(
				'site registration bad response',
				array(
					'code' => $resp['code'],
					'body' => $resp['body'],
				)
			);

			// Surface the cloud's own reason whenever the body carries one,
			// regardless of the HTTP code — the generic message hides the real
			// cause (e.g. a 403/409/500 with a readable error payload).
			return array(
				'type'    => 'error',
				'message' => $this->api_error_message(
					is_array( $resp['body'] ?? null ) ? $resp['body'] : array(),
					__( 'Could not obtain a site key. Please try again.', 'integrum-security-scanner' )
				),
			);
		}

		$body = $resp['body'];
		$this->storage->set_credentials( (string) $body['site_id'], (string) $body['site_key'] );

		return array(
			'type'    => 'success',
			'message' => sprintf(
				/* translators: %s: plan name. */
				__( 'Site registered. Plan: %s.', 'integrum-security-scanner' ),
				(string) ( $body['plan'] ?? 'free' )
			),
		);
	}

	/**
	 * Builds the notice text for a rejected registration.
	 *
	 * The API's own reason is surfaced as-is (mock: `error`, live API:
	 * `message`) so a server-side failure shows its real cause instead of a
	 * misleading "already registered". Only a genuine duplicate-domain
	 * rejection keeps the paste-key hint; a body without a readable reason
	 * falls back to $fallback (or the generic message when empty).
	 *
	 * @param array<string, mixed> $body     Decoded response body.
	 * @param string               $fallback Message for a body without a readable reason.
	 * @return string Plain-text notice message.
	 */
	private function api_error_message( array $body, string $fallback = '' ): string {
		$text = '';

		foreach ( array( 'error', 'message' ) as $key ) {
			if ( isset( $body[ $key ] ) && is_string( $body[ $key ] ) && '' !== trim( $body[ $key ] ) ) {
				$text = trim( $body[ $key ] );
				break;
			}
		}

		if ( '' === $text ) {
			return '' !== $fallback ? $fallback : __( 'Registration failed. Please try again.', 'integrum-security-scanner' );
		}

		if ( false !== stripos( $text, 'already' ) ) {
			return rtrim( $text, ' .' ) . '. ' . __( 'Paste the site key in the field below and save it manually.', 'integrum-security-scanner' );
		}

		return $text;
	}
}
