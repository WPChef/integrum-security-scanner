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
	 * the output context (it carries no markup).
	 *
	 * @param string $domain Site domain.
	 * @param string $email  Owner email.
	 * @return array{type: string, message: string}
	 */
	public function register( string $domain, string $email ): array {
		if ( '' === $domain || ! is_email( $email ) ) {
			return array(
				'type'    => 'error',
				'message' => __( 'Please provide a valid email address.', 'security-scanner' ),
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
				'message' => __( 'Could not reach the licensing service. Please try again.', 'security-scanner' ),
			);
		}

		if ( 400 === $resp['code'] ) {
			return array(
				'type'    => 'error',
				'message' => __( 'This domain is already registered. Paste the site key in the field below and save it manually.', 'security-scanner' ),
			);
		}

		if ( $resp['code'] < 200 || $resp['code'] >= 300 || empty( $resp['body']['site_key'] ) ) {
			$this->logger->error( 'site registration bad response', array( 'code' => $resp['code'] ) );

			return array(
				'type'    => 'error',
				'message' => __( 'Could not obtain a site key. Please try again.', 'security-scanner' ),
			);
		}

		$body = $resp['body'];
		$this->storage->set_credentials( (string) $body['site_id'], (string) $body['site_key'] );

		return array(
			'type'    => 'success',
			'message' => sprintf(
				/* translators: %s: plan name. */
				__( 'Site registered. Plan: %s.', 'security-scanner' ),
				(string) ( $body['plan'] ?? 'free' )
			),
		);
	}
}
