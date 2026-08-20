<?php
/**
 * HTTP request dispatcher.
 *
 * Resolves method+path to a handler closure. All dependencies are injected
 * through the constructor so handlers never touch globals.
 *
 * @package Llar\SecurityScanner\E2e\Mock
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\E2e\Mock;

/**
 * Matches an incoming request to a handler and executes it.
 */
final class Router {

	/**
	 * Constructor.
	 *
	 * @param SiteRegistrar $registrar Site registration logic.
	 * @param ScanEngine    $engine    Scan job logic.
	 */
	public function __construct(
		private SiteRegistrar $registrar,
		private ScanEngine $engine,
		private StateStore $store,
	) {}

	/**
	 * Dispatches the current request based on $_SERVER globals.
	 */
	public function dispatch(): never {
		$method = strtoupper( $_SERVER['REQUEST_METHOD'] ?? 'GET' );
		$uri    = $_SERVER['REQUEST_URI'] ?? '/';
		$path   = (string) parse_url( $uri, PHP_URL_PATH );

		// Strip the script prefix only when SCRIPT_NAME is an actual PHP file
		// (e.g. /server.php or /e2e/mock/server.php), NOT the request path itself
		// (which php -S sets as SCRIPT_NAME).
		$script = $_SERVER['SCRIPT_NAME'] ?? '';
		if ( '' !== $script && str_ends_with( $script, '.php' ) && str_starts_with( $path, $script ) ) {
			$path = substr( $path, strlen( $script ) );
		}

		// POST /imunify/site
		if ( 'POST' === $method && '/imunify/site' === $path ) {
			$this->handle_register();
		}

		// POST /imunify/inject-key (e2e only — seeds dump credentials into mock state)
		if ( 'POST' === $method && '/imunify/inject-key' === $path ) {
			$this->handle_inject_key();
		}

		// POST /api/v1/scan/start
		if ( 'POST' === $method && '/api/v1/scan/start' === $path ) {
			$this->handle_start_scan();
		}

		// POST /api/v1/jobs/{id}/hashes
		if ( 'POST' === $method && 1 === preg_match( '#^/api/v1/jobs/([^/]+)/hashes$#', $path, $m ) ) {
			$this->handle_hashes( $m[1] );
		}

		// POST /api/v1/jobs/{id}/upload
		if ( 'POST' === $method && 1 === preg_match( '#^/api/v1/jobs/([^/]+)/upload$#', $path, $m ) ) {
			$this->handle_upload( $m[1] );
		}

		// GET /api/v1/jobs/{id}/results
		if ( 'GET' === $method && 1 === preg_match( '#^/api/v1/jobs/([^/]+)/results$#', $path, $m ) ) {
			$this->handle_poll( $m[1] );
		}

		// GET /debug
		if ( 'GET' === $method && '/debug' === $path ) {
			$this->handle_debug();
		}

		// POST /reset
		if ( 'POST' === $method && '/reset' === $path ) {
			$this->handle_reset();
		}

		JsonResponse::error( 404, 'not found' );
	}

	// -------------------------------------------------------------------
	// Route handlers
	// -------------------------------------------------------------------

	private function handle_register(): void {
		$body = $this->read_body();

		try {
			$result = $this->registrar->register(
				(string) ( $body['domain'] ?? '' ),
				(string) ( $body['email'] ?? '' ),
			);
			JsonResponse::ok( $result['created'] );
		} catch ( \RuntimeException $e ) {
			$code = match ( $e->getMessage() ) {
				'Invalid request'            => 400,
				'Site already registered'    => 400,
				default                      => 500,
			};
			JsonResponse::error( $code, $e->getMessage() );
		}
	}

	private function handle_inject_key(): void {
		$body = $this->read_body();
		try {
			$this->registrar->inject(
				(string) ( $body['domain'] ?? '' ),
				(string) ( $body['site_id'] ?? '' ),
				(string) ( $body['site_key'] ?? '' ),
			);
			JsonResponse::ok( array( 'injected' => true ) );
		} catch ( \RuntimeException $e ) {
			JsonResponse::error( 400, $e->getMessage() );
		}
	}

	private function handle_start_scan(): void {
		$this->require_site_key();
		$body  = $this->read_body();
		$files = is_array( $body['files'] ?? null ) ? $body['files'] : array();

		try {
			$job_id = $this->engine->start( $files );
			JsonResponse::ok( array( 'job_id' => $job_id ) );
		} catch ( \RuntimeException $e ) {
			JsonResponse::error( 400, $e->getMessage() );
		}
	}

	/**
	 * @param string $job_id Job id.
	 */
	private function handle_hashes( string $job_id ): void {
		$this->require_site_key();
		$body   = $this->read_body();
		$hashes = is_array( $body['hashes'] ?? null ) ? $body['hashes'] : array();

		try {
			$processed = $this->engine->submit_hashes( $job_id, $hashes );
			JsonResponse::ok( array( 'processed' => $processed ) );
		} catch ( \RuntimeException $e ) {
			JsonResponse::error( 404, $e->getMessage() );
		}
	}

	/**
	 * @param string $job_id Job id.
	 */
	private function handle_upload( string $job_id ): void {
		$this->require_site_key();
		$file_id = $_POST['file_id'] ?? '';
		if ( '' === $file_id ) {
			JsonResponse::error( 400, 'Missing file_id' );
		}

		try {
			$this->engine->upload( $job_id, $file_id );
			JsonResponse::send( 202, array( 'status' => 'accepted' ) );
		} catch ( \RuntimeException $e ) {
			JsonResponse::error( 404, $e->getMessage() );
		}
	}

	/**
	 * @param string $job_id Job id.
	 */
	private function handle_poll( string $job_id ): void {
		$this->require_site_key();
		try {
			$result = $this->engine->poll( $job_id );
			JsonResponse::ok( $result );
		} catch ( \RuntimeException $e ) {
			JsonResponse::error( 404, $e->getMessage() );
		}
	}

	private function handle_debug(): void {
		$sites = $this->registrar->all();
		$jobs  = $this->engine->all_jobs();

		JsonResponse::ok(
			array(
				'sites' => array_map(
					function ( array $s ) {
						return array(
							'id'   => $s['id'],
							'plan' => $s['plan'],
							'key'  => substr( $s['key'], 0, 8 ) . '...',
						);
					},
					$sites
				),
				'jobs' => $jobs,
			)
		);
	}

	private function handle_reset(): void {
		$this->store->reset();
		JsonResponse::ok( array( 'reset' => true ) );
	}

	// -------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------

	/**
	 * Reads and decodes the JSON request body.
	 *
	 * @return array<string, mixed>
	 */
	private function read_body(): array {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$raw = file_get_contents( 'php://input' );
		if ( false === $raw || '' === $raw ) {
			return array();
		}
		$data = json_decode( $raw, true );

		return is_array( $data ) ? $data : array();
	}

	/**
	 * Rejects requests without a registered X-Site-Key.
	 */
	private function require_site_key(): void {
		$key = '';
		if ( isset( $_SERVER['HTTP_X_SITE_KEY'] ) && is_string( $_SERVER['HTTP_X_SITE_KEY'] ) ) {
			$key = $_SERVER['HTTP_X_SITE_KEY'];
		}
		if ( ! $this->registrar->is_valid_key( $key ) ) {
			JsonResponse::error( 401, 'Invalid site key' );
		}
	}
}
