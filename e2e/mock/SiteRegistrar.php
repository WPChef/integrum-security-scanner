<?php
/**
 * Site registrar — single responsibility.
 *
 * Handles LLAR site registration: validates input, checks for duplicates,
 * generates credentials, persists through StateStore.
 *
 * @package Llar\SecurityScanner\E2e\Mock
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\E2e\Mock;

/**
 * Registers sites and stores keys.
 */
final class SiteRegistrar {

	/**
	 * Constructor.
	 *
	 * @param StateStore $store State storage.
	 */
	public function __construct( private StateStore $store ) {}

	/**
	 * Registers a new site or rejects a duplicate.
	 *
	 * @param string $domain Domain.
	 * @param string $email  Owner email.
	 * @return array{sites: array, created: array{site_id: string, site_key: string, domain: string, plan: string}}
	 *
	 * @throws \RuntimeException When the domain is already registered or input is invalid.
	 */
	public function register( string $domain, string $email ): array {
		if ( '' === $domain || '' === $email || ! filter_var( $email, FILTER_VALIDATE_EMAIL ) ) {
			throw new \RuntimeException( 'Invalid request' );
		}

		$state = $this->store->load();

		if ( isset( $state['sites'][ $domain ] ) ) {
			throw new \RuntimeException( 'Site already registered' );
		}

		$site_id    = bin2hex( random_bytes( 12 ) );
		$site_key   = bin2hex( random_bytes( 32 ) );
		$created    = array(
			'site_id'  => $site_id,
			'site_key' => $site_key,
			'domain'   => $domain,
			'plan'     => 'free',
		);

		$state['sites']                    = is_array( $state['sites'] ?? null ) ? $state['sites'] : array();
		$state['sites'][ $domain ]         = array(
			'id'   => $site_id,
			'key'  => $site_key,
			'plan' => 'free',
		);
		$this->store->save( $state );

		return array(
			'sites'   => $state['sites'],
			'created' => $created,
		);
	}

	/**
	 * Returns the stored sites map.
	 *
	 * @return array<string, array{id: string, key: string, plan: string}>
	 */
	public function all(): array {
		$state = $this->store->load();

		return is_array( $state['sites'] ?? null ) ? $state['sites'] : array();
	}

	/**
	 * True when $key matches a registered site key.
	 *
	 * @param string $key Site key from X-Site-Key.
	 */
	public function is_valid_key( string $key ): bool {
		if ( '' === $key ) {
			return false;
		}
		foreach ( $this->all() as $site ) {
			if ( ( $site['key'] ?? '' ) === $key ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Injects a pre-existing key (e2e dump sync). Overwrites the domain slot.
	 *
	 * @param string $domain   Domain key in state.
	 * @param string $site_id  Site id.
	 * @param string $site_key Site key.
	 */
	public function inject( string $domain, string $site_id, string $site_key ): void {
		if ( '' === $domain || '' === $site_key ) {
			throw new \RuntimeException( 'Invalid request' );
		}
		$state                         = $this->store->load();
		$state['sites']                = is_array( $state['sites'] ?? null ) ? $state['sites'] : array();
		$state['sites'][ $domain ]     = array(
			'id'   => $site_id !== '' ? $site_id : bin2hex( random_bytes( 12 ) ),
			'key'  => $site_key,
			'plan' => 'free',
		);
		$this->store->save( $state );
	}
}
