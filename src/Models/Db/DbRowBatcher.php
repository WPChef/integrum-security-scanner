<?php
/**
 * Cursor-based reader of WP DB cells for Imunify db-content batches.
 *
 * @package Integrum\SecurityScanner\Models\Db
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Models\Db;

/**
 * Walks posts → options → postmeta without loading whole tables.
 *
 * @phpstan-type Cursor array{stage: string, last_id: int}
 */
final class DbRowBatcher {

	/**
	 * Default rows per batch (overridden by caller / prescan).
	 */
	public const DEFAULT_BATCH_SIZE = 25;

	/**
	 * Stages in order.
	 */
	private const STAGES = array( 'posts', 'options', 'postmeta', 'done' );

	/**
	 * Post statuses included in the scan.
	 *
	 * @var string[]
	 */
	private const POST_STATUSES = array( 'publish', 'draft', 'private', 'pending' );

	/**
	 * @param \wpdb $wpdb WordPress DB API.
	 */
	public function __construct(
		private \wpdb $wpdb
	) {
	}

	/**
	 * Table descriptors for POST /scan/database/start (official SDK shape).
	 *
	 * @return list<array{schema: string, name: string, key: string, columns: string[]}>
	 */
	public function discover_tables(): array {
		$schema = defined( 'DB_NAME' ) ? (string) DB_NAME : '';
		return array(
			array(
				'schema'  => $schema,
				'name'    => $this->wpdb->posts,
				'key'     => 'ID',
				'columns' => array( 'post_content' ),
			),
			array(
				'schema'  => $schema,
				'name'    => $this->wpdb->options,
				'key'     => 'option_id',
				'columns' => array( 'option_value' ),
			),
			array(
				'schema'  => $schema,
				'name'    => $this->wpdb->postmeta,
				'key'     => 'meta_id',
				'columns' => array( 'meta_value' ),
			),
		);
	}

	/**
	 * Initial cursor.
	 *
	 * @return Cursor
	 */
	public function initial_cursor(): array {
		return array(
			'stage'   => 'posts',
			'last_id' => 0,
		);
	}

	/**
	 * HEX-encodes a cell value for the Imunify API.
	 *
	 * @param string $raw Raw cell bytes / string.
	 */
	public static function hex_encode( string $raw ): string {
		return bin2hex( $raw );
	}

	/**
	 * Whether raw cell content matches any SQL LIKE-style prescan pattern.
	 *
	 * @param string   $raw      Raw cell value.
	 * @param string[] $patterns Patterns like %&lt;script%.
	 */
	public static function matches_prescan( string $raw, array $patterns ): bool {
		if ( array() === $patterns ) {
			return true;
		}
		foreach ( $patterns as $pattern ) {
			if ( ! is_string( $pattern ) || '' === $pattern ) {
				continue;
			}
			$needle = str_replace( '%', '', $pattern );
			if ( '' !== $needle && false !== stripos( $raw, $needle ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Fetches the next batch of rows and the advanced cursor.
	 *
	 * Reads up to $batch_size candidate rows from the current stage, then keeps
	 * only those matching $prescan_patterns (Imunify local filter). May return
	 * fewer than $batch_size matching rows while still advancing the cursor.
	 *
	 * @param Cursor   $cursor           Current cursor.
	 * @param int      $batch_size       Max candidate rows to read from DB.
	 * @param string[] $prescan_patterns LIKE patterns from scan_config.
	 * @param int      $size_limit       Max raw cell length (bytes).
	 * @return array{rows: list<array{table: string, column: string, row_id: string, content: string}>, cursor: Cursor, exhausted: bool}
	 */
	public function next_batch(
		array $cursor,
		int $batch_size = self::DEFAULT_BATCH_SIZE,
		array $prescan_patterns = array(),
		int $size_limit = 665600
	): array {
		$batch_size = max( 1, $batch_size );
		$size_limit = max( 0, $size_limit );
		$stage      = (string) ( $cursor['stage'] ?? 'posts' );
		$last_id    = (int) ( $cursor['last_id'] ?? 0 );

		if ( 'done' === $stage || ! in_array( $stage, self::STAGES, true ) ) {
			return array(
				'rows'      => array(),
				'cursor'    => array(
					'stage'   => 'done',
					'last_id' => 0,
				),
				'exhausted' => true,
			);
		}

		$rows = match ( $stage ) {
			'posts'    => $this->fetch_posts( $last_id, $batch_size ),
			'options'  => $this->fetch_options( $last_id, $batch_size ),
			'postmeta' => $this->fetch_postmeta( $last_id, $batch_size ),
			default    => array(),
		};

		$out = array();
		foreach ( $rows as $row ) {
			$raw = (string) ( $row['_raw'] ?? '' );
			if ( $size_limit > 0 && strlen( $raw ) > $size_limit ) {
				continue;
			}
			if ( ! self::matches_prescan( $raw, $prescan_patterns ) ) {
				continue;
			}
			$out[] = array(
				'table'   => (string) $row['table'],
				'column'  => (string) $row['column'],
				'row_id'  => (string) $row['row_id'],
				'content' => self::hex_encode( $raw ),
			);
		}

		if ( count( $rows ) < $batch_size ) {
			$next = $this->advance_stage( $stage );
			return array(
				'rows'      => $out,
				'cursor'    => $next,
				'exhausted' => 'done' === $next['stage'],
			);
		}

		$new_last = (int) $rows[ count( $rows ) - 1 ]['_id'];

		return array(
			'rows'      => $out,
			'cursor'    => array(
				'stage'   => $stage,
				'last_id' => $new_last,
			),
			'exhausted' => false,
		);
	}

	/**
	 * @return Cursor
	 */
	private function advance_stage( string $stage ): array {
		$idx = array_search( $stage, self::STAGES, true );
		if ( false === $idx ) {
			return array(
				'stage'   => 'done',
				'last_id' => 0,
			);
		}
		$next = self::STAGES[ (int) $idx + 1 ] ?? 'done';
		return array(
			'stage'   => $next,
			'last_id' => 0,
		);
	}

	/**
	 * @return list<array{table: string, column: string, row_id: string, _raw: string, _id: int}>
	 */
	private function fetch_posts( int $last_id, int $limit ): array {
		$statuses = "'" . implode( "','", array_map( 'esc_sql', self::POST_STATUSES ) ) . "'";
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- status list is fixed allowlist.
		$sql = $this->wpdb->prepare(
			"SELECT ID, post_content FROM {$this->wpdb->posts} WHERE ID > %d AND post_status IN ($statuses) ORDER BY ID ASC LIMIT %d",
			$last_id,
			$limit
		);
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$raw = $this->wpdb->get_results( $sql, \ARRAY_A );
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$out = array();
		foreach ( $raw as $row ) {
			$id = (int) ( $row['ID'] ?? 0 );
			$out[] = array(
				'table'  => $this->wpdb->posts,
				'column' => 'post_content',
				'row_id' => (string) $id,
				'_raw'   => (string) ( $row['post_content'] ?? '' ),
				'_id'    => $id,
			);
		}
		return $out;
	}

	/**
	 * @return list<array{table: string, column: string, row_id: string, _raw: string, _id: int}>
	 */
	private function fetch_options( int $last_id, int $limit ): array {
		$sql = $this->wpdb->prepare(
			"SELECT option_id, option_name, option_value FROM {$this->wpdb->options}
			WHERE option_id > %d
			AND option_name NOT IN ('cron')
			AND option_name NOT LIKE %s
			AND option_name NOT LIKE %s
			ORDER BY option_id ASC LIMIT %d",
			$last_id,
			$this->wpdb->esc_like( '_transient_' ) . '%',
			$this->wpdb->esc_like( '_site_transient_' ) . '%',
			$limit
		);
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$raw = $this->wpdb->get_results( $sql, \ARRAY_A );
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$out = array();
		foreach ( $raw as $row ) {
			$id = (int) ( $row['option_id'] ?? 0 );
			$out[] = array(
				'table'  => $this->wpdb->options,
				'column' => 'option_value',
				'row_id' => (string) $id,
				'_raw'   => (string) ( $row['option_value'] ?? '' ),
				'_id'    => $id,
			);
		}
		return $out;
	}

	/**
	 * @return list<array{table: string, column: string, row_id: string, _raw: string, _id: int}>
	 */
	private function fetch_postmeta( int $last_id, int $limit ): array {
		$sql = $this->wpdb->prepare(
			"SELECT meta_id, meta_value FROM {$this->wpdb->postmeta} WHERE meta_id > %d ORDER BY meta_id ASC LIMIT %d",
			$last_id,
			$limit
		);
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$raw = $this->wpdb->get_results( $sql, \ARRAY_A );
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$out = array();
		foreach ( $raw as $row ) {
			$id = (int) ( $row['meta_id'] ?? 0 );
			$out[] = array(
				'table'  => $this->wpdb->postmeta,
				'column' => 'meta_value',
				'row_id' => (string) $id,
				'_raw'   => (string) ( $row['meta_value'] ?? '' ),
				'_id'    => $id,
			);
		}
		return $out;
	}
}
