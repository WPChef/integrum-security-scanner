<?php
/**
 * Credential storage contract.
 *
 * @package Integrum\SecurityScanner\Contracts
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Contracts;

interface CredentialStorageInterface {

	public function get_site_id(): ?string;
	public function get_site_key(): ?string;
	public function set_credentials( string $site_id, string $site_key ): void;
	public function clear_credentials(): void;
}
