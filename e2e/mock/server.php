<?php
/**
 * Imunify Connect + LLAR API mock server — entry point.
 *
 * Standalone, no framework, no Composer, no DB.
 *
 *    php -S localhost:9000 -t e2e/mock e2e/mock/server.php
 *
 * Protocol:
 *   1. POST /imunify/site         -> register site, return site_key.
 *   2. POST /api/v1/scan/start    -> accept manifest, return job_id.
 *   3. GET  /api/v1/jobs/{id}/results -> polling handshake.
 *   4. POST /api/v1/jobs/{id}/hashes  -> submit SHAs.
 *   5. POST /api/v1/jobs/{id}/upload  -> accept file content.
 *   6. GET  /debug                    -> state dump (masked keys).
 *   7. POST /reset                    -> clear state.
 *
 * Simulated verdicts (CyclicVerdictStrategy):
 *   file_index % 3 == 0  -> needs_sha256 -> clean
 *   file_index % 3 == 1  -> needs_upload  -> malicious (EICAR_TEST_FILE)
 *   file_index % 3 == 2  -> has_verdict   -> suspicious (OBFUSCATED_EVAL)
 *
 * After 4 polls, remaining pending files auto-complete.
 *
 * @package Llar\SecurityScanner\E2e\Mock
 */

declare( strict_types = 1 );

// ---------------------------------------------------------------------------
// Autoloader — all classes live in this directory.
// ---------------------------------------------------------------------------

spl_autoload_register(
	function ( string $fqcn ): void {
		$prefix = 'Llar\\SecurityScanner\\E2e\\Mock\\';
		if ( 0 !== strncmp( $fqcn, $prefix, strlen( $prefix ) ) ) {
			return;
		}

		$path = __DIR__ . '/' . str_replace( '\\', '/', substr( $fqcn, strlen( $prefix ) ) ) . '.php';
		if ( is_file( $path ) ) {
			require_once $path;
		}
	}
);

// ---------------------------------------------------------------------------
// DI wiring — assemble the object graph.
// ---------------------------------------------------------------------------

use Llar\SecurityScanner\E2e\Mock\CyclicVerdictStrategy;
use Llar\SecurityScanner\E2e\Mock\Router;
use Llar\SecurityScanner\E2e\Mock\ScanEngine;
use Llar\SecurityScanner\E2e\Mock\SiteRegistrar;
use Llar\SecurityScanner\E2e\Mock\StateStore;

$store     = new StateStore( __DIR__ . '/state.json' );
$registrar = new SiteRegistrar( $store );
$verdicts  = new CyclicVerdictStrategy();
$engine    = new ScanEngine( $store, $verdicts );
$router    = new Router( $registrar, $engine, $store );

$router->dispatch();
