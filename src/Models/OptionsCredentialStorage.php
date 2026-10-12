<?php
/**
 * Credential storage backed by wp_options.
 *
 * @package Integrum\SecurityScanner\Models
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Models;

use Integrum\SecurityScanner\Contracts\CredentialStorageInterface;

/**
 * Stores site_id/site_key in a single option with autoload=false.
 */
final class OptionsCredentialStorage implements CredentialStorageInterface {

	/**
	 * Option key.
	 */
	private string $key;

	/**
	 * Constructor.
	 *
	 * @param string|null $key Override option key (used in tests).
	 */
	public function __construct( ?string $key = null ) {
		$this->key = $key ?? ( defined( 'INTEGRUM_SECURITY_SCANNER_OPTION_KEY' ) ? INTEGRUM_SECURITY_SCANNER_OPTION_KEY : 'integrum_security_scanner_credentials' );
	}

	/**
	 * {@inheritdoc}
	 */
	public function get_site_id(): ?string {
		$data = $this->read();
		return $data['site_id'] ?? null;
	}

	/**
	 * {@inheritdoc}
	 */
	public function get_site_key(): ?string {
		$data = $this->read();
		return $data['site_key'] ?? null;
	}

	/**
	 * {@inheritdoc}
	 */
	public function set_credentials( string $site_id, string $site_key ): void {
		update_option(
			$this->key,
			array(
				'site_id'  => $site_id,
				'site_key' => $site_key,
			),
			false
		);
	}

	/**
	 * {@inheritdoc}
	 */
	public function clear_credentials(): void {
		delete_option( $this->key );
	}

	/**
	 * Reads the raw stored array.
	 *
	 * @return array<string, mixed>
	 */
	private function read(): array {
		$data = get_option( $this->key, array() );
		return is_array( $data ) ? $data : array();
	}
}
