<?php
/**
 * Plugin Name:       Imunify Connect
 * Plugin URI:        https://www.limitloginattempts.com/
 * Description:       White-label malware scanner for WordPress powered by Imunify Connect.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      8.1
 * Author:            Limit Login Attempts Security
 * License:           GPL-2.0-or-later
 * Text Domain:       llar-imunify
 *
 * @package Llar\Imunify
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

define( 'LLAR_IMUNIFY_VERSION', '0.1.0' );
define( 'LLAR_IMUNIFY_DIR', plugin_dir_path( __FILE__ ) );
define( 'LLAR_IMUNIFY_URL', plugin_dir_url( __FILE__ ) );

/**
 * External API base URLs.
 *
 * Override precedence (last wins):
 *   1. Hardcoded default (the value below).
 *   2. Same-named constant defined earlier (e.g. in wp-config.php).
 *   3. Runtime filter `llar_imunify_<name>_api_base` (added via add_filter
 *      in a theme / mu-plugin / helper plugin).
 */
defined( 'LLAR_IMUNIFY_LLAR_API_BASE' ) || define( 'LLAR_IMUNIFY_LLAR_API_BASE', 'https://api.limitloginattempts.com' );
defined( 'LLAR_IMUNIFY_SCANNER_API_BASE' ) || define( 'LLAR_IMUNIFY_SCANNER_API_BASE', 'https://connect.imunify.com' );

define( 'LLAR_IMUNIFY_OPTION_KEY', 'llar_imunify_credentials' );

require_once LLAR_IMUNIFY_DIR . 'autoload.php';

/**
 * Resolves the site domain from a single source of truth.
 *
 * Precedence:
 *   1. `LLAR_IMUNIFY_REGISTER_DOMAIN` constant (when set and non-empty).
 *   2. host of `home_url()`.
 *
 * @param string $domain Unused fallback (empty by default).
 * @return string
 */
add_filter(
	'llar_imunify_site_domain',
	static function ( string $domain ): string {
		if ( '' !== $domain ) {
			return $domain;
		}
		if ( defined( 'LLAR_IMUNIFY_REGISTER_DOMAIN' ) && '' !== \LLAR_IMUNIFY_REGISTER_DOMAIN ) {
			return \LLAR_IMUNIFY_REGISTER_DOMAIN;
		}
		return (string) ( wp_parse_url( home_url(), PHP_URL_HOST ) ?? '' );
	}
);

if ( is_admin() ) {
	$logger      = new \Llar\Imunify\Models\WpLogger();
	$http        = new \Llar\Imunify\Models\WpHttpClient( $logger );
	$storage     = new \Llar\Imunify\Models\OptionsCredentialStorage();
	$job_store   = new \Llar\Imunify\Models\WpTransientJobStore();
	$site_domain = (string) apply_filters( 'llar_imunify_site_domain', '' );

	$scanner_base = (string) apply_filters( 'llar_imunify_scanner_api_base', LLAR_IMUNIFY_SCANNER_API_BASE );
	$scanner      = new \Llar\Imunify\Models\ImunifyScanner( $http, $logger, $storage, $job_store, $site_domain, $scanner_base );

	$llar_base = (string) apply_filters( 'llar_imunify_llar_api_base', LLAR_IMUNIFY_LLAR_API_BASE );
	$licensing = new \Llar\Imunify\Services\LicensingService( $http, $logger, $storage, $llar_base );

	$admin = new \Llar\Imunify\Controllers\AdminController( $scanner, $storage, $licensing, $logger );
	$admin->register();
}
