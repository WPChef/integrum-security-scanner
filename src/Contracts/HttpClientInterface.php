<?php
/**
 * HTTP client contract.
 *
 * @package Llar\Imunify\Contracts
 */

declare( strict_types = 1 );

namespace Llar\Imunify\Contracts;

interface HttpClientInterface {

	/**
	 * Performs a JSON request authenticated with the site key.
	 *
	 * The site key is sent as the `X-Site-Key` header (WordPress/site context).
	 *
	 * @param string               $method  GET|POST.
	 * @param string               $url     Full URL.
	 * @param array<string, mixed> $body    Request body (JSON-encoded).
	 * @param string|null          $api_key Optional site key.
	 * @return array{code: int, body: array<string, mixed>}
	 *
	 * @throws HttpException On transport or HTTP error.
	 */
	public function request( string $method, string $url, array $body = array(), ?string $api_key = null ): array;

	/**
	 * Uploads a single file as multipart/form-data.
	 *
	 * Used by the scanner handshake to push file content for `needs_upload`
	 * actions. The site key is sent as `X-Site-Key`.
	 *
	 * @param string      $url       Full URL.
	 * @param string      $file_path Absolute path to the file on disk.
	 * @param string      $file_id   Imunify file_id (UUID) to attach.
	 * @param string|null $api_key   Optional site key.
	 * @return array{code: int, body: array<string, mixed>}
	 *
	 * @throws HttpException On transport or HTTP error.
	 */
	public function upload( string $url, string $file_path, string $file_id, ?string $api_key = null ): array;
}
