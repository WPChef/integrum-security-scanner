<?php
/**
 * Registers the site with the LLAR licensing service and stores the key.
 *
 * Owns the licensing HTTP call so the controller does not reach into the
 * transport layer. Returns a UI-ready notice; the controller decides how to
 * surface it.
 *
 * @package Llar\SecurityScanner\Services
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\Services;

use Llar\SecurityScanner\Contracts\CredentialStorageInterface;
use Llar\SecurityScanner\Contracts\HttpClientInterface;
use Llar\SecurityScanner\Contracts\HttpException;
use Llar\SecurityScanner\Contracts\LoggerInterface;

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
	 * the output context (it carries no markup). On HTTP 400 the API-provided
	 * error text is surfaced verbatim, so the message may come straight from
	 * the remote service.
	 *
	 * @param string $domain Site domain.
	 * @param string $email  Owner email.
	 * @return array{type: string, message: string}
	 */
	public function register( string $domain, string $email ): array {
		if ( '' === $domain || ! is_email( $email ) ) {
			return array(
				'type'    => 'error',
				'message' => __( 'Please provide a valid email address.', 'site-integrity-scanner' ),
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
				'message' => __( 'Could not reach the licensing service. Please try again.', 'site-integrity-scanner' ),
			);
		}

		if ( 400 === $resp['code'] ) {
			return array(
				'type'    => 'error',
				'message' => $this->api_error_message( $resp['body'] ),
			);
		}

		if ( $resp['code'] < 200 || $resp['code'] >= 300 || empty( $resp['body']['site_key'] ) ) {
			$this->logger->error( 'site registration bad response', array( 'code' => $resp['code'] ) );

			return array(
				'type'    => 'error',
				'message' => __( 'Could not obtain a site key. Please try again.', 'site-integrity-scanner' ),
			);
		}

		$body = $resp['body'];
		$this->storage->set_credentials( (string) $body['site_id'], (string) $body['site_key'] );

		return array(
			'type'    => 'success',
			'message' => sprintf(
				/* translators: %s: plan name. */
				__( 'Site registered. Plan: %s.', 'site-integrity-scanner' ),
				(string) ( $body['plan'] ?? 'free' )
			),
		);
	}

	/**
	 * Builds the notice text for an HTTP 400 registration rejection.
	 *
	 * The API's own reason is surfaced as-is (mock: `error`, live API:
	 * `message`) so a server-side failure shows its real cause instead of a
	 * misleading "already registered". Only a genuine duplicate-domain
	 * rejection keeps the paste-key hint; a body without a readable reason
	 * falls back to a generic message.
	 *
	 * @param array<string, mixed> $body Decoded response body.
	 * @return string Plain-text notice message.
	 */
	private function api_error_message( array $body ): string {
		$text = '';

		foreach ( array( 'error', 'message' ) as $key ) {
			if ( isset( $body[ $key ] ) && is_string( $body[ $key ] ) && '' !== trim( $body[ $key ] ) ) {
				$text = trim( $body[ $key ] );
				break;
			}
		}

		if ( '' === $text ) {
			return __( 'Registration failed. Please try again.', 'site-integrity-scanner' );
		}

		if ( false !== stripos( $text, 'already' ) ) {
			return rtrim( $text, ' .' ) . '. ' . __( 'Paste the site key in the field below and save it manually.', 'site-integrity-scanner' );
		}

		return $text;
	}
}
