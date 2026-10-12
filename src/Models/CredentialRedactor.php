<?php
/**
 * Redacts credentials from log context arrays.
 *
 * @package Integrum\SecurityScanner\Models
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Models;

use Integrum\SecurityScanner\Contracts\CredentialStorageInterface;

/**
 * Masks site keys and known secret header/field names.
 */
final class CredentialRedactor {

	/**
	 * Context keys that always get redacted (case-insensitive).
	 *
	 * @var string[]
	 */
	private const SENSITIVE_KEYS = array(
		'site_key',
		'sitekey',
		'api_key',
		'apikey',
		'x-site-key',
		'authorization',
		'password',
		'token',
		'secret',
	);

	/**
	 * Constructor.
	 *
	 * @param CredentialStorageInterface|null $storage Optional storage for known site key value.
	 */
	public function __construct( private ?CredentialStorageInterface $storage = null ) {}

	/**
	 * Returns a copy of $context with secrets replaced by [REDACTED].
	 *
	 * @param array<string, mixed> $context Context.
	 * @return array<string, mixed>
	 */
	public function redact_context( array $context ): array {
		$known = $this->storage?->get_site_key();
		$known = ( null !== $known && '' !== $known ) ? $known : null;

		$out = array();
		foreach ( $context as $key => $value ) {
			$name = strtolower( (string) $key );
			if ( in_array( $name, self::SENSITIVE_KEYS, true ) ) {
				$out[ $key ] = '[REDACTED]';
				continue;
			}

			if ( is_string( $value ) && null !== $known && false !== strpos( $value, $known ) ) {
				$out[ $key ] = str_replace( $known, '[REDACTED]', $value );
				continue;
			}

			$out[ $key ] = $value;
		}

		return $out;
	}
}
