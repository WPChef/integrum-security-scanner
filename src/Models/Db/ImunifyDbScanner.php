<?php
/**
 * Imunify Connect database scan client.
 *
 * @package Integrum\SecurityScanner\Models\Db
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Models\Db;

use Integrum\SecurityScanner\Contracts\CredentialStorageInterface;
use Integrum\SecurityScanner\Contracts\DbScannerInterface;
use Integrum\SecurityScanner\Contracts\HttpClientInterface;
use Integrum\SecurityScanner\Contracts\HttpException;
use Integrum\SecurityScanner\Contracts\LoggerInterface;
use Integrum\SecurityScanner\Contracts\ScanException;
use Integrum\SecurityScanner\Models\ImunifyHttpErrors;

/**
 * Native DB endpoints: start → db-content batches → db-status / db-results.
 */
final class ImunifyDbScanner implements DbScannerInterface {

	private const STATE_TTL         = HOUR_IN_SECONDS;
	private const STATE_PREFIX      = 'integrum_security_scanner_db_';
	private const TICK_BUDGET_SEC   = 2.5;
	private const DEFAULT_BATCH     = DbRowBatcher::DEFAULT_BATCH_SIZE;
	private const MAX_BATCH_RETRIES = 3;
	private const RESULTS_CAP       = 500;
	private const RETRY_AFTER_MAX_S = 30;

	/**
	 * @param HttpClientInterface        $http    HTTP client.
	 * @param LoggerInterface            $logger  Logger.
	 * @param CredentialStorageInterface $storage Credentials.
	 * @param DbRowBatcher               $batcher Row cursor.
	 * @param string                     $base    API host (no trailing slash).
	 */
	public function __construct(
		private HttpClientInterface $http,
		private LoggerInterface $logger,
		private CredentialStorageInterface $storage,
		private DbRowBatcher $batcher,
		private string $base
	) {
	}

	/**
	 * {@inheritdoc}
	 */
	public function start(): string {
		$key  = $this->require_key();
		$path = defined( 'ABSPATH' ) ? (string) ABSPATH : '/';

		global $wpdb;
		$prefix = ( isset( $wpdb ) && is_object( $wpdb ) ) ? (string) $wpdb->prefix : 'wp_';

		// Official Imunify SDK body: cms_type + db_prefix + tables (+ optional wordpress_path).
		$payload = array(
			'cms_type'       => 'wordpress',
			'db_prefix'      => $prefix,
			'tables'         => $this->batcher->discover_tables(),
			'wordpress_path' => $path,
		);

		$resp = $this->call( 'POST', '/scan/database/start', $key, $payload );
		$body = $resp['body'];

		if ( empty( $body['job_id'] ) ) {
			throw new ScanException( __( 'No job_id returned by database scanner.', 'integrum-security-scanner' ) );
		}

		$job_id      = (string) $body['job_id'];
		$scan_config = is_array( $body['scan_config'] ?? null ) ? $body['scan_config'] : array();
		$patterns    = is_array( $scan_config['prescan_patterns'] ?? null ) ? $scan_config['prescan_patterns'] : array();
		$size_limit  = isset( $scan_config['size_limit'] ) ? max( 0, (int) $scan_config['size_limit'] ) : 665600;
		// Phase 1: ignore scan_config.base64_pattern (needs SQL-side filter; substring
		// pass only reduces volume — Connect still scans every submitted cell).
		$scope = $this->batcher->estimate_scope();

		$this->save_state(
			$job_id,
			array(
				'cursor'           => $this->batcher->initial_cursor(),
				'batch_size'       => self::DEFAULT_BATCH,
				'prescan_patterns' => $patterns,
				'size_limit'       => $size_limit,
				'scope_total'      => (int) ( $scope['total'] ?? 0 ),
				'examined'         => 0,
				'accepted'         => 0,
				'submitted'        => 0,
				'finalized'        => false,
				'stopped'          => false,
				'status'           => 'running',
				'stage'            => 'posts',
				'progress_pct'     => 0,
			)
		);

		return $job_id;
	}

	/**
	 * {@inheritdoc}
	 */
	public function tick( string $job_id ): array {
		$state = $this->load_state( $job_id );
		if ( array() === $state ) {
			throw new ScanException(
				__( 'Database scan job not found. It may have expired or the cache was cleared — start a new scan.', 'integrum-security-scanner' )
			);
		}

		if ( ! empty( $state['stopped'] ) ) {
			return array(
				'status'       => 'stopped',
				'progress_pct' => (int) ( $state['progress_pct'] ?? 0 ),
				'stage'        => (string) ( $state['stage'] ?? '' ),
			);
		}

		if ( ! empty( $state['finalized'] ) || 'completed' === ( $state['status'] ?? '' ) ) {
			return array(
				'status'       => 'completed',
				'progress_pct' => 100,
				'stage'        => 'done',
			);
		}

		if ( 'failed' === ( $state['status'] ?? '' ) ) {
			return array(
				'status'       => 'failed',
				'progress_pct' => (int) ( $state['progress_pct'] ?? 0 ),
				'message'      => (string) ( $state['message'] ?? '' ),
				'stage'        => (string) ( $state['stage'] ?? '' ),
			);
		}

		$key        = $this->require_key();
		$batch_size = max( 1, (int) ( $state['batch_size'] ?? self::DEFAULT_BATCH ) );
		$patterns   = is_array( $state['prescan_patterns'] ?? null ) ? $state['prescan_patterns'] : array();
		$size_limit = isset( $state['size_limit'] ) ? max( 0, (int) $state['size_limit'] ) : 665600;
		$deadline   = microtime( true ) + self::TICK_BUDGET_SEC;

		while ( microtime( true ) < $deadline ) {
			$cursor   = is_array( $state['cursor'] ?? null ) ? $state['cursor'] : $this->batcher->initial_cursor();
			$batch    = $this->batcher->next_batch( $cursor, $batch_size, $patterns, $size_limit );
			$rows     = $batch['rows'];
			$is_final = (bool) $batch['exhausted'];
			$state['examined'] = (int) ( $state['examined'] ?? 0 ) + (int) ( $batch['examined'] ?? 0 );
			$state['stage']    = (string) ( $batch['stage'] ?? $state['stage'] ?? 'posts' );
			$state['progress_pct'] = $this->progress_from_examined(
				(int) ( $state['examined'] ?? 0 ),
				(int) ( $state['scope_total'] ?? 0 ),
				$is_final
			);

			// Advance empty non-final stages without an HTTP round-trip.
			if ( array() === $rows && ! $is_final ) {
				$state['cursor'] = $batch['cursor'];
				$state['status'] = 'running';
				$this->save_state( $job_id, $state );
				continue;
			}

			try {
				$resp = $this->submit_with_retry(
					$job_id,
					$key,
					array(
						'rows'     => $rows,
						'is_final' => $is_final,
					)
				);
			} catch ( ScanException $e ) {
				// Persist failure only for terminal API codes; transport / exhausted
				// 429·503 leave cursor intact so the next tick can resume.
				if ( in_array( $e->getCode(), array( 401, 403, 422 ), true ) ) {
					$state['status']  = 'failed';
					$state['message'] = $e->getMessage();
					$this->save_state( $job_id, $state );
				} else {
					$state['cursor'] = $batch['cursor'];
					$state['status'] = 'running';
					$this->save_state( $job_id, $state );
				}
				throw $e;
			}

			$body = $resp['body'];
			$state['accepted']  = (int) ( $state['accepted'] ?? 0 ) + (int) ( $body['accepted'] ?? 0 );
			$state['submitted'] = (int) ( $state['submitted'] ?? 0 ) + count( $rows );
			$state['cursor']    = $batch['cursor'];

			// Peer tick already closed the Connect job (HTTP 409 → already_closed).
			$remote_done = ! empty( $body['already_closed'] );

			if ( $is_final || $remote_done ) {
				$state['finalized']    = true;
				$state['status']       = 'completed';
				$state['progress_pct'] = 100;
				$state['stage']        = 'done';
				$this->save_state( $job_id, $state );
				return array(
					'status'       => 'completed',
					'progress_pct' => 100,
					'stage'        => 'done',
					'examined'     => (int) ( $state['examined'] ?? 0 ),
					'scope_total'  => (int) ( $state['scope_total'] ?? 0 ),
				);
			}

			$state['status'] = 'running';
			$this->save_state( $job_id, $state );
		}

		return array(
			'status'       => 'running',
			'progress_pct' => (int) ( $state['progress_pct'] ?? 0 ),
			'stage'        => (string) ( $state['stage'] ?? 'posts' ),
			'examined'     => (int) ( $state['examined'] ?? 0 ),
			'scope_total'  => (int) ( $state['scope_total'] ?? 0 ),
		);
	}

	/**
	 * {@inheritdoc}
	 */
	public function stop( string $job_id ): void {
		$state = $this->load_state( $job_id );
		if ( array() === $state ) {
			return;
		}
		$state['stopped'] = true;
		$state['status']  = 'stopped';
		$this->save_state( $job_id, $state );
	}

	/**
	 * {@inheritdoc}
	 */
	public function has_local_job( string $job_id ): bool {
		return array() !== $this->load_state( $job_id );
	}

	/**
	 * {@inheritdoc}
	 */
	public function get_results( string $job_id ): array {
		$key       = $this->require_key();
		$out       = array();
		$offset    = 0;
		$limit     = 50;
		$truncated = false;

		do {
			$path = '/jobs/' . rawurlencode( $job_id ) . '/db-results?limit=' . $limit . '&offset=' . $offset . '&status=detected';
			$resp = $this->call( 'GET', $path, $key );
			$body = $resp['body'];
			$list = is_array( $body['results'] ?? null ) ? $body['results'] : array();

			foreach ( $list as $item ) {
				if ( ! is_array( $item ) ) {
					continue;
				}
				$out[] = $this->map_finding( $item );
			}

			$count   = count( $list );
			$offset += $limit;
			if ( $offset >= self::RESULTS_CAP ) {
				$truncated = $count === $limit;
				break;
			}
		} while ( $count === $limit );

		return array(
			'findings'  => $out,
			'truncated' => $truncated,
		);
	}

	/**
	 * Progress from examined candidate rows vs COUNT(*) scope (capped at 99 until final).
	 */
	private function progress_from_examined( int $examined, int $total, bool $is_final ): int {
		if ( $is_final ) {
			return 100;
		}
		if ( $total <= 0 ) {
			return min( 99, max( 1, $examined > 0 ? 50 : 1 ) );
		}
		return min( 99, max( 0, (int) floor( 100 * $examined / $total ) ) );
	}

	/**
	 * @param array<string, mixed> $item API result row.
	 */
	private function map_finding( array $item ): DbFinding {
		$table  = (string) ( $item['table'] ?? '' );
		$column = (string) ( $item['column'] ?? '' );
		$row_id = (string) ( $item['row_id'] ?? '' );
		$label  = $table . ' / ' . $column . ' #' . $row_id;
		$url    = '';

		global $wpdb;
		if ( isset( $wpdb ) && $table === $wpdb->posts && '' !== $row_id && ctype_digit( $row_id ) ) {
			$edit = get_edit_post_link( (int) $row_id, 'raw' );
			if ( is_string( $edit ) && '' !== $edit ) {
				$url   = $edit;
				$title = get_the_title( (int) $row_id );
				$label = sprintf(
					/* translators: 1: post ID, 2: post title */
					__( 'Post #%1$s — %2$s', 'integrum-security-scanner' ),
					$row_id,
					'' !== $title ? $title : __( '(no title)', 'integrum-security-scanner' )
				);
			}
		} elseif ( isset( $wpdb ) && $table === $wpdb->options ) {
			$label = sprintf(
				/* translators: %s: option row id */
				__( 'Option #%s', 'integrum-security-scanner' ),
				$row_id
			);
		} elseif ( isset( $wpdb ) && $table === $wpdb->postmeta ) {
			$label = sprintf(
				/* translators: %s: meta id */
				__( 'Post meta #%s', 'integrum-security-scanner' ),
				$row_id
			);
		}

		return new DbFinding(
			(string) ( $item['id'] ?? '' ),
			$table,
			$column,
			$row_id,
			(string) ( $item['severity'] ?? 'medium' ),
			(string) ( $item['signature_id'] ?? '' ),
			(string) ( $item['status'] ?? 'detected' ),
			$label,
			$url
		);
	}

	/**
	 * @param array<string, mixed> $payload db-content body.
	 * @return array{code: int, body: array<string, mixed>}
	 *
	 * @throws ScanException On terminal failure.
	 */
	private function submit_with_retry( string $job_id, string $key, array $payload ): array {
		$attempt = 0;
		$path    = '/jobs/' . rawurlencode( $job_id ) . '/db-content';

		while ( true ) {
			++$attempt;
			try {
				$resp = $this->http->request( 'POST', $this->base . '/api/v1' . $path, $payload, $key );
			} catch ( HttpException $e ) {
				if ( $attempt >= self::MAX_BATCH_RETRIES || ! self::is_retryable_transport( $e ) ) {
					throw new ScanException( __( 'Database scanner is temporarily unavailable.', 'integrum-security-scanner' ), 0, $e );
				}
				usleep( 250000 * $attempt );
				continue;
			}

			$code    = (int) $resp['code'];
			$body    = is_array( $resp['body'] ) ? $resp['body'] : array();
			$headers = is_array( $resp['headers'] ?? null ) ? $resp['headers'] : array();

			if ( 401 === $code || 403 === $code ) {
				throw $this->auth_or_quota_error( $resp );
			}

			if ( 422 === $code ) {
				$err = (string) ( $body['error'] ?? 'scan_failed' );
				throw new ScanException(
					sprintf(
						/* translators: %s: API error string */
						__( 'Database scan failed: %s. Start a new scan to retry.', 'integrum-security-scanner' ),
						$err
					),
					422
				);
			}

			if ( 429 === $code || 503 === $code ) {
				if ( $attempt >= self::MAX_BATCH_RETRIES ) {
					throw new ScanException(
						__( 'Database scanner rate-limited or overloaded. Try again shortly.', 'integrum-security-scanner' ),
						$code
					);
				}
				$wait_us = self::retry_after_usleep( $headers, $attempt );
				$this->logger->debug(
					'db-content retryable',
					array(
						'code'    => $code,
						'attempt' => $attempt,
						'wait_us' => $wait_us,
					)
				);
				usleep( $wait_us );
				continue;
			}

			// Concurrent ticks: Connect already finalized / cancelled the job.
			// Do not surface as retryable transport — treat as soft completion.
			if ( 409 === $code && self::is_job_closed_conflict( $body ) ) {
				$this->logger->debug(
					'db-content already closed',
					array(
						'status' => (string) ( $body['status'] ?? '' ),
						'error'  => (string) ( $body['error'] ?? '' ),
					)
				);
				return array(
					'code'    => 200,
					'body'    => array(
						'accepted'       => 0,
						'job_status'     => 'completed',
						'already_closed' => true,
					),
					'headers' => $headers,
				);
			}

			if ( $code < 200 || $code >= 300 ) {
				throw new ScanException(
					sprintf(
						/* translators: %d: HTTP status */
						__( 'Database scanner error: HTTP %d.', 'integrum-security-scanner' ),
						$code
					),
					$code
				);
			}

			return $resp;
		}
	}

	/**
	 * Only retry transient transport failures (timeouts / connection), not all HttpException.
	 */
	private static function is_retryable_transport( HttpException $e ): bool {
		$m = strtolower( $e->getMessage() );
		foreach ( array( 'timed out', 'timeout', 'could not resolve', 'failed to connect', 'connection reset', 'connection refused' ) as $needle ) {
			if ( false !== strpos( $m, $needle ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Connect 409 when the remote job no longer accepts db-content batches.
	 *
	 * @param array<string, mixed> $body Decoded error body.
	 */
	private static function is_job_closed_conflict( array $body ): bool {
		$status = strtolower( (string) ( $body['status'] ?? '' ) );
		if ( in_array( $status, array( 'completed', 'cancelled', 'cancelled_or_completed' ), true ) ) {
			return true;
		}
		$err = strtolower( (string) ( $body['error'] ?? '' ) );
		return false !== strpos( $err, 'not accepting' ) || false !== strpos( $err, 'no longer accepting' );
	}

	/**
	 * Honour Retry-After when present; otherwise exponential backoff. Caps wait.
	 *
	 * @param array<string, string> $headers Response headers (lowercase keys).
	 */
	private static function retry_after_usleep( array $headers, int $attempt ): int {
		$raw = (string) ( $headers['retry-after'] ?? '' );
		if ( '' !== $raw && ctype_digit( $raw ) ) {
			$sec = min( self::RETRY_AFTER_MAX_S, max( 1, (int) $raw ) );
			return $sec * 1000000;
		}
		return min( self::RETRY_AFTER_MAX_S * 1000000, 500000 * $attempt );
	}

	/**
	 * @param array{code: int, body: array<string, mixed>} $resp Response.
	 *
	 * @throws ScanException Always.
	 */
	private function call( string $method, string $path, string $key, array $body = array() ): array {
		$url = $this->base . '/api/v1' . $path;

		try {
			$resp = $this->http->request( $method, $url, $body, $key );
		} catch ( HttpException $e ) {
			throw new ScanException( __( 'Database scanner is temporarily unavailable.', 'integrum-security-scanner' ), 0, $e );
		}

		$code = (int) $resp['code'];
		if ( 401 === $code || 403 === $code ) {
			throw $this->auth_or_quota_error( $resp );
		}
		if ( $code < 200 || $code >= 300 ) {
			$msg = (string) ( $resp['body']['error'] ?? '' );
			if ( '' === $msg ) {
				$msg = sprintf(
					/* translators: %d: HTTP status */
					__( 'Database scanner error: HTTP %d.', 'integrum-security-scanner' ),
					$code
				);
			}
			throw new ScanException( $msg, $code );
		}

		return $resp;
	}

	/**
	 * @param array{code: int, body: array<string, mixed>} $resp Response.
	 */
	private function auth_or_quota_error( array $resp ): ScanException {
		return ImunifyHttpErrors::auth_or_quota(
			$resp,
			__( 'Database scan quota exceeded.', 'integrum-security-scanner' ),
			__( 'Database scanner rejected the request.', 'integrum-security-scanner' ),
			true
		);
	}

	/**
	 * @throws ScanException When no key.
	 */
	private function require_key(): string {
		$key = $this->storage->get_site_key();
		if ( null === $key || '' === $key ) {
			throw new ScanException( __( 'Site key is required for database scan.', 'integrum-security-scanner' ), 401 );
		}
		return $key;
	}

	/**
	 * @param array<string, mixed> $state State payload.
	 */
	private function save_state( string $job_id, array $state ): void {
		set_transient( self::STATE_PREFIX . $job_id, $state, self::STATE_TTL );
		set_transient( self::STATE_PREFIX . 'current', $job_id, self::STATE_TTL );
	}

	/**
	 * @return array<string, mixed>
	 */
	private function load_state( string $job_id ): array {
		$cached = get_transient( self::STATE_PREFIX . $job_id );
		return is_array( $cached ) ? $cached : array();
	}
}
