<?php
/**
 * Minimal PSR-4 autoloader.
 *
 * Maps `Integrum\SecurityScanner\Foo\Bar` -> src/Foo/Bar.php. No Composer, no cache.
 *
 * @package Integrum\SecurityScanner
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

/**
 * Registers the PSR-4 prefix `Integrum\SecurityScanner\` against the `src/` directory.
 */
spl_autoload_register(
	/**
	 * Resolves a fully-qualified class name to a file path under src/.
	 *
	 * @param string $fqcn Fully-qualified class name.
	 */
	function ( string $fqcn ): void {
		$prefix = 'Integrum\\SecurityScanner\\';
		if ( 0 !== strncmp( $fqcn, $prefix, strlen( $prefix ) ) ) {
			return;
		}

		$path = INTEGRUM_SECURITY_SCANNER_DIR . 'src/' . str_replace( '\\', '/', substr( $fqcn, strlen( $prefix ) ) ) . '.php';
		if ( is_file( $path ) ) {
			require_once $path;
		}
	}
);
