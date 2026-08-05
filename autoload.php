<?php
/**
 * Minimal PSR-4 autoloader.
 *
 * Maps `Llar\SecurityScanner\Foo\Bar` -> src/Foo/Bar.php. No Composer, no cache.
 *
 * @package Llar\SecurityScanner
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

/**
 * Registers the PSR-4 prefix `Llar\SecurityScanner\` against the `src/` directory.
 */
spl_autoload_register(
	/**
	 * Resolves a fully-qualified class name to a file path under src/.
	 *
	 * @param string $fqcn Fully-qualified class name.
	 */
	function ( string $fqcn ): void {
		$prefix = 'Llar\\SecurityScanner\\';
		if ( 0 !== strncmp( $fqcn, $prefix, strlen( $prefix ) ) ) {
			return;
		}

		$path = LLAR_SECURITY_SCANNER_DIR . 'src/' . str_replace( '\\', '/', substr( $fqcn, strlen( $prefix ) ) ) . '.php';
		if ( is_file( $path ) ) {
			require_once $path;
		}
	}
);
