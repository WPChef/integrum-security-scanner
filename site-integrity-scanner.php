<?php
/**
 * Plugin Name:       Site Integrity Scanner
 * Plugin URI:        https://www.limitloginattempts.com/
 * Description:       Scan your WordPress files for malicious code, right from the dashboard.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      8.1
 * Author:            Limit Login Attempts Security
 * License:           GPL-2.0-or-later
 * Text Domain:       site-integrity-scanner
 *
 * @package Llar\SecurityScanner
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

define( 'LLAR_SECURITY_SCANNER_VERSION', '0.1.0' );
define( 'LLAR_SECURITY_SCANNER_DIR', plugin_dir_path( __FILE__ ) );
define( 'LLAR_SECURITY_SCANNER_URL', plugin_dir_url( __FILE__ ) );

/**
 * External API URLs — used as-is, no path is appended.
 *
 * LLAR_API_BASE is the full registration endpoint URL; SCANNER_API_BASE is a
 * bare host (the scanner appends /api/v1/... itself).
 *
 * Override precedence (last wins):
 *   1. Hardcoded default (the value below).
 *   2. Same-named constant defined earlier (e.g. in wp-config.php).
 *   3. Runtime filter `site_integrity_scanner_<name>_api_base` (added via add_filter
 *      in a theme / mu-plugin / helper plugin).
 */
defined( 'LLAR_SECURITY_SCANNER_LLAR_API_BASE' ) || define( 'LLAR_SECURITY_SCANNER_LLAR_API_BASE', 'https://api.limitloginattempts.com/imunify/site' );
defined( 'LLAR_SECURITY_SCANNER_SCANNER_API_BASE' ) || define( 'LLAR_SECURITY_SCANNER_SCANNER_API_BASE', 'https://connect.imunify.com' );

define( 'LLAR_SECURITY_SCANNER_OPTION_KEY', 'site_integrity_scanner_credentials' );

require_once LLAR_SECURITY_SCANNER_DIR . 'autoload.php';

/**
 * One-shot rename migration: security_scanner_* → site_integrity_scanner_*.
 *
 * Keeps credentials / settings / history when the plugin slug changes.
 */
add_action(
	'plugins_loaded',
	static function (): void {
		$option_map = array(
			'security_scanner_credentials'   => 'site_integrity_scanner_credentials',
			'security_scanner_scan_settings' => 'site_integrity_scanner_scan_settings',
			'security_scanner_history'       => 'site_integrity_scanner_history',
			'security_scanner_e2e_mock'      => 'site_integrity_scanner_e2e_mock',
		);

		$all = function_exists( 'wp_load_alloptions' ) ? wp_load_alloptions() : array();
		if ( ! is_array( $all ) ) {
			$all = array();
		}

		foreach ( $option_map as $old => $new ) {
			if ( array_key_exists( $new, $all ) ) {
				continue;
			}
			if ( ! array_key_exists( $old, $all ) ) {
				// Non-autoload options are absent from wp_load_alloptions().
				$old_val = get_option( $old, null );
				if ( null === $old_val ) {
					continue;
				}
				update_option( $new, $old_val, false );
				delete_option( $old );
				continue;
			}
			update_option( $new, get_option( $old ) );
			delete_option( $old );
		}

		$active = get_option( 'active_plugins', array() );
		if ( ! is_array( $active ) ) {
			return;
		}
		$old_plugin = 'security-scanner/security-scanner.php';
		$new_plugin = 'site-integrity-scanner/site-integrity-scanner.php';
		if ( ! in_array( $old_plugin, $active, true ) ) {
			return;
		}
		$active = array_values( array_diff( $active, array( $old_plugin ) ) );
		if ( ! in_array( $new_plugin, $active, true ) ) {
			$active[] = $new_plugin;
		}
		update_option( 'active_plugins', $active );
	},
	1
);

/**
 * Resolves the site domain from a single source of truth.
 *
 * Precedence:
 *   1. `LLAR_SECURITY_SCANNER_REGISTER_DOMAIN` constant (when set and non-empty).
 *   2. host of `home_url()`.
 *
 * @param string $domain Unused fallback (empty by default).
 * @return string
 */
add_filter(
	'site_integrity_scanner_site_domain',
	static function ( string $domain ): string {
		if ( '' !== $domain ) {
			return $domain;
		}
		if ( defined( 'LLAR_SECURITY_SCANNER_REGISTER_DOMAIN' ) && '' !== \LLAR_SECURITY_SCANNER_REGISTER_DOMAIN ) {
			return \LLAR_SECURITY_SCANNER_REGISTER_DOMAIN;
		}
		return (string) ( wp_parse_url( home_url(), PHP_URL_HOST ) ?? '' );
	}
);

if ( is_admin() ) {
	$storage        = new \Llar\SecurityScanner\Models\OptionsCredentialStorage();
	$logger         = new \Llar\SecurityScanner\Models\WpLogger( $storage );
	$http           = new \Llar\SecurityScanner\Models\WpHttpClient( $logger );
	$job_store      = new \Llar\SecurityScanner\Models\WpTransientJobStore();
	$file_collector = new \Llar\SecurityScanner\Models\FileCollector();
	$site_domain    = (string) apply_filters( 'site_integrity_scanner_site_domain', '' );

	$allow_insecure = (bool) apply_filters(
		'site_integrity_scanner_allow_insecure_api',
		function_exists( 'wp_get_environment_type' ) && 'local' === wp_get_environment_type()
	);

	$scanner_base = \Llar\SecurityScanner\Models\ApiBaseUrl::resolve(
		(string) apply_filters( 'site_integrity_scanner_scanner_api_base', LLAR_SECURITY_SCANNER_SCANNER_API_BASE ),
		LLAR_SECURITY_SCANNER_SCANNER_API_BASE,
		$allow_insecure
	);
	$scanner      = new \Llar\SecurityScanner\Models\ImunifyScanner( $http, $logger, $storage, $job_store, $file_collector, $site_domain, $scanner_base );

	$llar_base = \Llar\SecurityScanner\Models\ApiBaseUrl::resolve(
		(string) apply_filters( 'site_integrity_scanner_llar_api_base', LLAR_SECURITY_SCANNER_LLAR_API_BASE ),
		LLAR_SECURITY_SCANNER_LLAR_API_BASE,
		$allow_insecure
	);
	$licensing = new \Llar\SecurityScanner\Services\LicensingService( $http, $logger, $storage, $llar_base );

	$admin = new \Llar\SecurityScanner\Controllers\AdminController(
		$scanner,
		$storage,
		$licensing,
		$logger,
		$file_collector,
		new \Llar\SecurityScanner\Models\ScanHistoryStorage()
	);
	$admin->register();
}
