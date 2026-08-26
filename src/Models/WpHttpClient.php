<?php
/**
 * Default HTTP client built on top of WP HTTP API.
 *
 * @package Llar\SecurityScanner\Models
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\Models;

use Llar\SecurityScanner\Contracts\HttpClientInterface;
use Llar\SecurityScanner\Contracts\HttpException;

/**
 * Wraps wp_remote_get/wp_remote_post and normalises the response shape.
 *
 * The Imunify site key authenticates every request via the `X-Site-Key`
 * header (the same header the official WordPress connector uses).
 *
 * When a logger is provided via the constructor every outgoing request and
 * its response (or failure) is written to the debug log.
 */
final class WpHttpClient implements HttpClientInterface {

	/**
	 * Maximum characters of an error response body kept in the log.
	 */
	private const LOG_BODY_SNIPPET = 300;

	/**
	 * Optional logger; null = no request-level logging.
	 */
	private ?\Llar\SecurityScanner\Contracts\LoggerInterface $logger;

	/**
	 * @param \Llar\SecurityScanner\Contracts\LoggerInterface|null $logger Logger.
	 */
	public function __construct( ?\Llar\SecurityScanner\Contracts\LoggerInterface $logger = null ) {
		$this->logger = $logger;
	}

	/**
	 * {@inheritdoc}
	 *
	 * @throws HttpException When transport fails or body is not valid JSON.
	 */
	public function request( string $method, string $url, array $body = array(), ?string $api_key = null ): array {
		$args = array(
			'method'  => strtoupper( $method ),
			'timeout' => 30,
			'headers' => array(
				'Accept'       => 'application/json',
				'Content-Type' => 'application/json',
			),
		);

		if ( null !== $api_key ) {
			$args['headers']['X-Site-Key'] = $api_key;
		}

		if ( ! empty( $body ) ) {
			$args['body'] = wp_json_encode( $body );
		}

		$this->log_outgoing( $args['method'], $url, $body );

		$response = 'GET' === $args['method']
			? wp_remote_get( $url, $args )
			: wp_remote_post( $url, $args );

		return $this->decode( $args['method'], $url, $response );
	}

	/**
	 * {@inheritdoc}
	 *
	 * @throws HttpException When transport fails or body is not valid JSON.
	 */
	public function upload( string $url, string $file_path, string $file_id, ?string $api_key = null ): array {
		$contents = $this->read( $file_path );
		$filename = basename( $file_path );

		// The modern WP transport (Requests) url-encodes array bodies and forces
		// Content-Type: application/x-www-form-urlencoded, which the scanner
		// rejects with HTTP 415. We therefore build a real multipart/form-data
		// body by hand and pin the Content-Type with a boundary we control.
		$boundary = 'security-scanner-' . wp_generate_password( 16, false );
		$eol      = "\r\n";

		$body  = '--' . $boundary . $eol;
		$body .= 'Content-Disposition: form-data; name="file_id"' . $eol . $eol;
		$body .= $file_id . $eol;
		$body .= '--' . $boundary . $eol;
		$body .= 'Content-Disposition: form-data; name="file"; filename="' . $filename . '"' . $eol;
		$body .= 'Content-Type: application/octet-stream' . $eol . $eol;
		$body .= $contents . $eol;
		$body .= '--' . $boundary . '--' . $eol;

		$args = array(
			'method'  => 'POST',
			'timeout' => 60,
			'headers' => array(
				'Accept'       => 'application/json',
				'Content-Type' => 'multipart/form-data; boundary=' . $boundary,
			),
			'body'    => $body,
		);

		if ( null !== $api_key ) {
			$args['headers']['X-Site-Key'] = $api_key;
		}

		$this->log_outgoing(
			'POST',
			$url,
			array(
				'file_id' => $file_id,
				'file'    => $filename,
			)
		);

		return $this->decode( 'POST', $url, wp_remote_post( $url, $args ) );
	}

	/**
	 * Decodes a WP HTTP response into {code, body}.
	 *
	 * @param string                         $method   HTTP method (for logging).
	 * @param string                         $url      Request URL (for logging).
	 * @param array<string, mixed>|\WP_Error $response Raw WP HTTP response.
	 * @return array{code: int, body: array<string, mixed>}
	 *
	 * @throws HttpException On WP_Error.
	 */
	private function decode( string $method, string $url, $response ): array {
		if ( is_wp_error( $response ) ) {
			$this->log_response( $method, $url, 0, 'WP_Error', $response->get_error_message() );
			throw new HttpException( $response->get_error_message() );
		}

		$code     = (int) wp_remote_retrieve_response_code( $response );
		$raw_body = (string) wp_remote_retrieve_body( $response );
		$decoded  = json_decode( $raw_body, true );
		$body     = is_array( $decoded ) ? $decoded : array( 'raw' => $raw_body );

		// On errors the response body carries the reason (API error JSON or a
		// proxy/CDN HTML page); keep a truncated copy in the log so support can
		// see why a request failed without a packet capture.
		$snippet = $code >= 400 ? substr( $raw_body, 0, self::LOG_BODY_SNIPPET ) : null;

		$this->log_response( $method, $url, $code, $body, null, $snippet );

		return array(
			'code' => $code,
			'body' => $body,
		);
	}

	/**
	 * Logs an outgoing request (method + URL, body size, no secrets).
	 *
	 * @param string               $method HTTP method.
	 * @param string               $url    URL.
	 * @param array<string, mixed> $body   Request body (may be truncated).
	 */
	private function log_outgoing( string $method, string $url, array $body ): void {
		if ( null === $this->logger ) {
			return;
		}

		$size = 0;
		if ( ! empty( $body ) ) {
			$encoded = wp_json_encode( $body );
			$size    = is_string( $encoded ) ? strlen( $encoded ) : 0;
		}

		$this->logger->debug(
			'http -> ' . $method . ' ' . $url,
			array( 'body_bytes' => $size )
		);
	}

	/**
	 * Logs the response (or WP_Error) for a request.
	 *
	 * @param string                      $method  HTTP method.
	 * @param string                      $url     Request URL.
	 * @param int                         $code    HTTP status (0 for WP_Error).
	 * @param array<string, mixed>|string $body    Decoded body or error message.
	 * @param string|null                 $error   WP_Error detail (only when $code is 0).
	 * @param string|null                 $snippet Truncated raw body (HTTP >= 4xx only).
	 */
	private function log_response( string $method, string $url, int $code, $body, ?string $error = null, ?string $snippet = null ): void {
		if ( null === $this->logger ) {
			return;
		}

		$ctx = array( 'http' => $code );

		if ( null !== $error ) {
			$ctx['error'] = $error;
		} elseif ( is_array( $body ) ) {
			// Keep log compact: surface the top-level keys, not full payload.
			$ctx['keys'] = array_keys( $body );
		}

		if ( null !== $snippet && '' !== $snippet ) {
			$ctx['body'] = $snippet;
		}

		$this->logger->debug(
			'http <- ' . $method . ' ' . $url . ' [' . $code . ']',
			$ctx
		);
	}

	/**
	 * Reads a file for upload.
	 *
	 * @param string $file_path Absolute path.
	 * @return string File contents.
	 *
	 * @throws HttpException When the file cannot be read.
	 */
	private function read( string $file_path ): string {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$contents = file_get_contents( $file_path );
		if ( false === $contents ) {
			throw new HttpException( 'Unable to read file: ' . basename( $file_path ) );
		}
		return $contents;
	}
}
