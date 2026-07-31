<?php
/**
 * Collects candidate files for scanning by walking directories
 * and filtering through include/exclude glob masks.
 *
 * @package Llar\Imunify\Models
 */

declare( strict_types = 1 );

namespace Llar\Imunify\Models;

/**
 * Mask matcher + directory walker.
 *
 * Glob syntax supported:
 *  - *      single path segment (no slashes)
 *  - **     any number of segments
 *  - {a,b}  alternatives within one segment
 *  - ?      single character
 *  - .      literal dot
 */
final class FileCollector {

	/**
	 * Builds the candidate list.
	 *
	 * @param string[] $directories    Absolute directory paths.
	 * @param string[] $include_masks  Glob masks; empty = everything.
	 * @param string[] $exclude_masks  Glob masks; always win.
	 * @param string   $root           Root path used to compute relative paths.
	 * @return string[] Relative paths from $root.
	 */
	public function collect( array $directories, array $include_masks, array $exclude_masks, string $root ): array {
		$root     = rtrim( $root, DIRECTORY_SEPARATOR ) . DIRECTORY_SEPARATOR;
		$includes = $this->compile( $include_masks );
		$excludes = $this->compile( $exclude_masks );
		$has_incl = array() !== $includes;

		$out  = array();
		$seen = array();

		foreach ( $directories as $dir ) {
			if ( ! is_dir( $dir ) ) {
				continue;
			}

			$iterator = new \RecursiveIteratorIterator(
				new \RecursiveDirectoryIterator( $dir, \FilesystemIterator::SKIP_DOTS ),
				\RecursiveIteratorIterator::LEAVES_ONLY
			);

			foreach ( $iterator as $file ) {
				/** @var \SplFileInfo $file */
				$abs = $file->getPathname();

				if ( isset( $seen[ $abs ] ) ) {
					continue;
				}
				$seen[ $abs ] = true;

				$relative = $this->normalise_relative( $abs, $root );
				if ( '' === $relative ) {
					continue;
				}

				if ( $this->any_match( $excludes, $relative ) ) {
					continue;
				}

				if ( $has_incl && ! $this->any_match( $includes, $relative ) ) {
					continue;
				}

				$out[] = $relative;
			}
		}

		sort( $out );
		return $out;
	}

	/**
	 * Compiles masks into a list of (regex, is_basename) pairs.
	 *
	 * Slash-less masks are matched against the file basename, others against
	 * the full relative path — matches the README semantics.
	 *
	 * @param string[] $masks Masks.
	 * @return array<int, array{regex: string, basename: bool}>
	 */
	private function compile( array $masks ): array {
		$masks = array_values( array_filter( array_map( 'trim', $masks ), 'strlen' ) );
		$out   = array();

		foreach ( $masks as $mask ) {
			$is_basename = false === strpos( $mask, '/' );
			$out[]       = array(
				'regex'    => '#^' . $this->mask_to_regex( $mask ) . '$#u',
				'basename' => $is_basename,
			);
		}

		return $out;
	}

	/**
	 * Returns true when at least one compiled mask matches.
	 *
	 * @param array<int, array{regex: string, basename: bool}> $compiled  Masks.
	 * @param string                                           $relative Relative path.
	 */
	private function any_match( array $compiled, string $relative ): bool {
		$basename = basename( $relative );

		foreach ( $compiled as $rule ) {
			$target = $rule['basename'] ? $basename : $relative;
			if ( 1 === preg_match( $rule['regex'], $target ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Converts one glob mask into a (non-anchored) regex.
	 *
	 * @param string $mask Mask.
	 */
	private function mask_to_regex( string $mask ): string {
		$out      = '';
		$length   = strlen( $mask );
		$in_brace = false;
		$brace    = '';

		for ( $i = 0; $i < $length; ++$i ) {
			$ch = $mask[ $i ];

			if ( $in_brace ) {
				if ( '}' === $ch ) {
					$alts     = explode( ',', $brace );
					$escaped  = array_map( fn( $a ) => preg_quote( $a, '#' ), $alts );
					$out     .= '(?:' . implode( '|', $escaped ) . ')';
					$in_brace = false;
					$brace    = '';
				} else {
					$brace .= $ch;
				}
				continue;
			}

			switch ( $ch ) {
				case '*':
					$next = $mask[ $i + 1 ] ?? '';
					// "**" — any number of segments.
					if ( '*' === $next ) {
						$out .= '.*';
						++$i;
						break;
					}
					// "*/" — "anywhere" prefix, crosses segments.
					if ( '/' === $next ) {
						$out .= '.*';
						break;
					}
					// "*" otherwise — single segment.
					$out .= '[^/]*';
					break;
				case '?':
					$out .= '[^/]';
					break;
				case '{':
					$in_brace = true;
					$brace    = '';
					break;
				default:
					$out .= preg_quote( $ch, '#' );
					break;
			}
		}

		return $out;
	}

	/**
	 * Normalises an absolute path into a forward-slash relative path.
	 *
	 * @param string $abs  Absolute path.
	 * @param string $root Root with trailing slash.
	 */
	private function normalise_relative( string $abs, string $root ): string {
		$abs  = str_replace( '\\', '/', $abs );
		$root = str_replace( '\\', '/', $root );

		if ( 0 === strpos( $abs, $root ) ) {
			$rel = substr( $abs, strlen( $root ) );
		} else {
			$rel = ltrim( str_replace( $root, '', $abs ), '/' );
		}

		return $rel;
	}
}
