<?php
/**
 * Default verdict strategy: cyclic assignment by file_index mod 3.
 *
 *   file_index % 3 == 0  -> needs_sha256 -> clean
 *   file_index % 3 == 1  -> needs_sha256 -> malicious (EICAR_TEST_FILE)
 *   file_index % 3 == 2  -> has_verdict   -> suspicious (OBFUSCATED_EVAL)
 *
 * Index % 3 == 1 starts at needs_sha256 but resolves to a MALICIOUS verdict,
 * so the server (see ScanEngine) flips it to needs_upload on the NEXT poll.
 * This forces a single physical file to traverse two action stages across
 * two polls — the exact path that exposed the scanned_bytes double-charging
 * bug when the server reissues a fresh file_id per stage.
 *
 * @package Llar\SecurityScanner\E2e\Mock
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\E2e\Mock;

/**
 * Simple cycling verdict strategy.
 *
 * Override: the file PATH decides the verdict, regardless of index (checked
 * case-insensitively as substrings, malicious first):
 *   - "virus" or "malicious"  -> malicious, starting at needs_sha256 so the
 *     mock walks the full malicious lifecycle (hash -> upload -> verdict),
 *     mirroring how the real server asks for the body of a file it flagged.
 *   - "suspicious" (and the common typo "suspisious") -> suspicious, delivered
 *     immediately (has_verdict), like the cyclic suspicious path.
 */
final class CyclicVerdictStrategy implements VerdictStrategy {

	/**
	 * {@inheritdoc}
	 *
	 * @param int    $file_index Index.
	 * @param string $path       Manifest path.
	 * @return string
	 */
	public function action( int $file_index, string $path = '' ): string {
		$name_verdict = self::name_verdict( $path );
		if ( null !== $name_verdict ) {
			return 'malicious' === $name_verdict
				? 'needs_sha256' // malicious destiny -> flipped to needs_upload after hashing.
				: 'has_verdict';
		}

		return match ( $file_index % 3 ) {
			0       => 'needs_sha256',
			1       => 'needs_sha256', // malicious verdict -> flipped to needs_upload after hashing.
			default => 'has_verdict',
		};
	}

	/**
	 * {@inheritdoc}
	 *
	 * @param int    $file_index Index.
	 * @param string $path       Manifest path.
	 * @return string
	 */
	public function verdict( int $file_index, string $path = '' ): string {
		$name_verdict = self::name_verdict( $path );
		if ( null !== $name_verdict ) {
			return $name_verdict;
		}

		return match ( $file_index % 3 ) {
			0       => 'clean',
			1       => 'malicious',
			default => 'suspicious',
		};
	}

	/**
	 * {@inheritdoc}
	 *
	 * @param string $verdict Verdict.
	 * @return string
	 */
	public function signature( string $verdict ): string {
		return match ( $verdict ) {
			'malicious'  => 'EICAR_TEST_FILE',
			'suspicious' => 'OBFUSCATED_EVAL',
			default      => '',
		};
	}

	/**
	 * Maps a path to a verdict for deterministic testing.
	 *
	 * @param string $path Manifest path.
	 * @return string|null Verdict, or null when no name rule matches.
	 */
	private static function name_verdict( string $path ): ?string {
		if ( '' === $path ) {
			return null;
		}

		$lower = strtolower( $path );
		if ( str_contains( $lower, 'virus' ) || str_contains( $lower, 'malicious' ) ) {
			return 'malicious';
		}
		if ( str_contains( $lower, 'suspicious' ) || str_contains( $lower, 'suspisious' ) ) {
			return 'suspicious';
		}

		return null;
	}
}
