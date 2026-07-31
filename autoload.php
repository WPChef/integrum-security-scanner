<?php
/**
 * Minimal PSR-4 autoloader.
 *
 * Maps `Llar\Imunify\Foo\Bar` -> src/Foo/Bar.php. No Composer, no cache.
 *
 * @package Llar\Imunify
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

/**
 * Registers the PSR-4 prefix `Llar\Imunify\` against the `src/` directory.
 */
spl_autoload_register(
	/**
	 * Resolves a fully-qualified class name to a file path under src/.
	 *
	 * @param string $fqcn Fully-qualified class name.
	 */
	function ( string $fqcn ): void {
		$prefix = 'Llar\\Imunify\\';
		if ( 0 !== strncmp( $fqcn, $prefix, strlen( $prefix ) ) ) {
			return;
		}

		$path = LLAR_IMUNIFY_DIR . 'src/' . str_replace( '\\', '/', substr( $fqcn, strlen( $prefix ) ) ) . '.php';
		if ( is_file( $path ) ) {
			require_once $path;
		}
	}
);
