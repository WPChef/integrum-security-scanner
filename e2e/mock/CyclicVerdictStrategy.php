<?php
/**
 * Default verdict strategy: file names decide, everything else is clean.
 *
 * Path markers (checked case-insensitively as substrings):
 *   - "virus" or "malicious"  -> malicious, starting at needs_sha256 so the
 *     mock walks the full malicious lifecycle (hash -> upload -> verdict),
 *     mirroring how the real server asks for the body of a file it flagged.
 *   - "suspicious" (and the common typo "suspisious") -> suspicious, delivered
 *     immediately (has_verdict).
 *   - anything else            -> clean via needs_sha256.
 *
 * Deterministic for e2e fixture folders: a folder with no marked files scans
 * clean, a folder with marked files flags exactly those files. The malicious
 * path still forces a single physical file to traverse two action stages
 * across two polls (file_id rotates per stage) — the path that exposed the
 * scanned_bytes double-charging bug.
 *
 * @package Llar\SecurityScanner\E2e\Mock
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\E2e\Mock;

/**
 * Name-driven verdict strategy: fixture file names decide the outcome.
 *
 * Path markers (checked case-insensitively as substrings, malicious first):
 *   - "virus" or "malicious"  -> malicious, starting at needs_sha256 so the
 *     mock walks the full malicious lifecycle (hash -> upload -> verdict),
 *     mirroring how the real server asks for the body of a file it flagged.
 *   - "suspicious" (and the common typo "suspisious") -> suspicious, delivered
 *     immediately (has_verdict).
 */
final class CyclicVerdictStrategy implements VerdictStrategy {

	/**
	 * {@inheritdoc}
	 *
	 * @param int    $file_index Index (unused — verdicts are name-driven).
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

		// Unmarked files are clean: the client submits a hash, the verdict lands
		// on a later poll (needs_sha256 -> pending_scan -> has_verdict).
		return 'needs_sha256';
	}

	/**
	 * {@inheritdoc}
	 *
	 * @param int    $file_index Index (unused — verdicts are name-driven).
	 * @param string $path       Manifest path.
	 * @return string
	 */
	public function verdict( int $file_index, string $path = '' ): string {
		$name_verdict = self::name_verdict( $path );
		if ( null !== $name_verdict ) {
			return $name_verdict;
		}

		return 'clean';
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
