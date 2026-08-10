<?php
/**
 * The single admin page: key, masks, scan button, results.
 *
 * @package Llar\SecurityScanner\Controllers
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\Controllers;

use Llar\SecurityScanner\Contracts\CredentialStorageInterface;
use Llar\SecurityScanner\Contracts\LoggerInterface;
use Llar\SecurityScanner\Contracts\ScanException;
use Llar\SecurityScanner\Contracts\ScannerInterface;
use Llar\SecurityScanner\Models\ScanResult;
use Llar\SecurityScanner\Services\LicensingService;

/**
 * Registers the menu, renders the page, handles the two POST forms
 * (Get key / Start scan) and exposes AJAX actions for polling.
 */
final class AdminController {

	private const SLUG            = 'security-scanner';
	private const NONCE_GET_KEY   = 'security_scanner_get_key';
	private const NONCE_START     = 'security_scanner_start_scan';
	private const NONCE_POLL      = 'security_scanner_poll';
	private const CAPABILITY      = 'manage_options';
	private const OPTION_SETTINGS = 'security_scanner_scan_settings';

	/**
	 * Constructor.
	 *
	 * @param ScannerInterface           $scanner  Scanner.
	 * @param CredentialStorageInterface $storage  Storage.
	 * @param LicensingService           $licensing Licensing service.
	 * @param LoggerInterface            $logger   Logger.
	 */
	public function __construct(
		private ScannerInterface $scanner,
		private CredentialStorageInterface $storage,
		private LicensingService $licensing,
		private LoggerInterface $logger
	) {
	}

	/**
	 * Registers WordPress hooks.
	 */
	public function register(): void {
		add_action( 'admin_menu', array( $this, 'add_menu' ) );
		add_action( 'admin_init', array( $this, 'handle_post' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );

		add_action( 'wp_ajax_security_scanner_status', array( $this, 'ajax_status' ) );
		add_action( 'wp_ajax_security_scanner_stop', array( $this, 'ajax_stop' ) );
		add_action( 'wp_ajax_security_scanner_results', array( $this, 'ajax_results' ) );
	}

	/**
	 * Adds the admin menu entry.
	 */
	public function add_menu(): void {
		add_menu_page(
			__( 'File Security Scanner', 'security-scanner' ),
			__( 'File Security', 'security-scanner' ),
			self::CAPABILITY,
			self::SLUG,
			array( $this, 'render' ),
			'dashicons-shield',
			80
		);
	}

	/**
	 * Enqueues assets on the plugin page only.
	 *
	 * @param string $hook Current admin page hook.
	 */
	public function enqueue( string $hook ): void {
		if ( 'toplevel_page_' . self::SLUG !== $hook ) {
			return;
		}

		// Pre-built Tailwind stylesheet: utilities are scoped under
		// #security-scanner-app and preflight is disabled so the WP admin
		// chrome is never affected. Rebuild with:
		//   node node_modules/tailwindcss/lib/cli.js -i tailwind-src.css -o wp-content/plugins/security-scanner/assets/css/tailwind.build.css --minify
		wp_enqueue_style(
			'security-scanner-admin',
			LLAR_SECURITY_SCANNER_URL . 'assets/css/tailwind.build.css',
			array(),
			LLAR_SECURITY_SCANNER_VERSION
		);

		wp_enqueue_script(
			'security-scanner-admin',
			LLAR_SECURITY_SCANNER_URL . 'assets/js/admin.js',
			array(),
			LLAR_SECURITY_SCANNER_VERSION,
			true
		);

		wp_localize_script(
			'security-scanner-admin',
			'llarSecurityScanner',
			array(
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( self::NONCE_POLL ),
				'i18n'    => array(
					'stay'     => __( 'Do not close this page until the scan completes.', 'security-scanner' ),
					'error'    => __( 'Scan failed. Please try again.', 'security-scanner' ),
					'saveKey'  => __( 'Save key', 'security-scanner' ),
					'register' => __( 'Register', 'security-scanner' ),
					'stopped'  => __( 'Scan stopped.', 'security-scanner' ),
					'stopping' => __( 'Stopping…', 'security-scanner' ),
				),
			)
		);
	}

	/**
	 * Handles the two POST forms (Get key / Start scan) using admin referer checks.
	 */
	public function handle_post(): void {
		$action = '';
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- nonce verified inside each handler.
		if ( isset( $_POST['security_scanner_action'] ) ) {
			$action = sanitize_text_field( wp_unslash( $_POST['security_scanner_action'] ) );
		}
		// phpcs:enable WordPress.Security.NonceVerification.Missing

		if ( '' === $action ) {
			return;
		}

		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'Insufficient permissions.', 'security-scanner' ) );
		}

		switch ( $action ) {
			case 'get_key':
				$this->handle_get_key();
				break;
			case 'start_scan':
				$this->handle_start_scan();
				break;
		}
	}

	/**
	 * Handles the Get key form.
	 */
	private function handle_get_key(): void {
		check_admin_referer( self::NONCE_GET_KEY );

		$manual_key = isset( $_POST['security_scanner_key'] ) ? sanitize_text_field( wp_unslash( $_POST['security_scanner_key'] ) ) : '';

		// When user provides a key manually, store it directly without API call.
		if ( '' !== $manual_key ) {
			$existing = $this->storage->get_site_id();
			$this->storage->set_credentials( $existing ?? 'manual', $manual_key );

			$this->redirect(
				array(
					'type'    => 'success',
					'message' => __( 'Site key saved.', 'security-scanner' ),
					'scope'   => 'connection',
				)
			);
			return;
		}

		$domain = (string) apply_filters( 'security_scanner_site_domain', '' );
		$email  = isset( $_POST['security_scanner_email'] ) ? sanitize_email( wp_unslash( $_POST['security_scanner_email'] ) ) : '';

		$notice          = $this->licensing->register( (string) $domain, $email );
		$notice['scope'] = 'connection';
		$this->redirect( $notice );
	}

	/**
	 * Handles the Start scan form.
	 */
	private function handle_start_scan(): void {
		check_admin_referer( self::NONCE_START );

		$allowed = $this->directory_options();

		$dir_slugs     = $this->sanitize_directory_slugs( $_POST['security_scanner_directories'] ?? array(), $allowed ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.ValidatedSanitizedInput.MissingUnslash -- sanitised inside sanitize_directory_slugs().
		$include_masks = $this->parse_masks( $_POST['security_scanner_include'] ?? '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.ValidatedSanitizedInput.MissingUnslash -- sanitised inside parse_masks().
		$exclude_masks = $this->parse_masks( $_POST['security_scanner_exclude'] ?? '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.ValidatedSanitizedInput.MissingUnslash -- sanitised inside parse_masks().

		// Persist the user's selections so the form keeps its state across reloads
		// (even when the scan fails, e.g. quota exceeded — the user can retry).
		$this->store_scan_settings(
			$dir_slugs,
			isset( $_POST['security_scanner_include'] ) ? sanitize_text_field( wp_unslash( $_POST['security_scanner_include'] ) ) : '', // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.MissingUnslash -- unslashed above.
			isset( $_POST['security_scanner_exclude'] ) ? sanitize_text_field( wp_unslash( $_POST['security_scanner_exclude'] ) ) : '' // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.MissingUnslash -- unslashed above.
		);

		$directories = $this->slugs_to_paths( $dir_slugs, $allowed );
		if ( array() === $directories ) {
			$directories = array( untrailingslashit( ABSPATH ) );
		}

		try {
			$job_id = $this->scanner->start_scan( $directories, $include_masks, $exclude_masks );
		} catch ( ScanException $e ) {
			$this->logger->error(
				'scan start failed',
				array(
					'message' => $e->getMessage(),
					'code'    => $e->getCode(),
				)
			);

			$is_key_error = 401 === $e->getCode();
			$real_message = $e->getMessage();
			$message      = $is_key_error
				? __( 'The site key is missing or was rejected. Use the "Get site key" form above to obtain a new key, then start the scan again.', 'security-scanner' )
				: ( '' !== $real_message ? $real_message : __( 'Could not start the scan. Please try again in a moment.', 'security-scanner' ) );

		$this->redirect(
			array(
				'type'    => 'error',
				'message' => $message,
				'scope'   => 'scan',
			)
		);
		return;
		}

		set_transient( 'security_scanner_active_job', $job_id, HOUR_IN_SECONDS );
		// One-shot marker consumed by render() on the FIRST page load after the
		// PRG redirect. It is NOT a persistent "scan in progress" flag: once
		// consumed, a page reload no longer surfaces a running scan, so the UI
		// returns to idle and the scan is not silently resumed by the poller.
		set_transient( 'security_scanner_started_job', $job_id, 5 * MINUTE_IN_SECONDS );

		$this->redirect(
			array(
				'type'    => 'success',
				'message' => __( 'Scan started. Do not close this page until it completes.', 'security-scanner' ),
				'scope'   => 'scan',
			)
		);
	}

	/**
	 * AJAX: returns current scan status for the active job.
	 */
	public function ajax_status(): void {
		check_ajax_referer( self::NONCE_POLL, 'nonce' );

		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_send_json_error( array( 'message' => 'forbidden' ), 403 );
		}

		$job_id = '';
		if ( isset( $_POST['job_id'] ) ) {
			$job_id = sanitize_text_field( wp_unslash( $_POST['job_id'] ) );
		} elseif ( get_transient( 'security_scanner_active_job' ) ) {
			$job_id = (string) get_transient( 'security_scanner_active_job' );
		}

		if ( '' === $job_id ) {
			wp_send_json_error( array( 'message' => 'no job' ) );
		}

		try {
			$status = $this->scanner->get_status( $job_id );
		} catch ( ScanException $e ) {
			wp_send_json_error( array( 'message' => $e->getMessage() ) );
		}

		if ( in_array( $status['status'], array( 'completed', 'done', 'failed' ), true ) ) {
			delete_transient( 'security_scanner_active_job' );
		}

		wp_send_json_success( $status );
	}

	/**
	 * AJAX: stops the active scan by clearing the active job transient.
	 *
	 * The Imunify Connect API has no "cancel" endpoint for a running job; the
	 * server-side scan simply stops being polled and will expire on its own.
	 * We clear the local active-job marker so the poller stops and the UI
	 * returns to the idle state.
	 */
	public function ajax_stop(): void {
		check_ajax_referer( self::NONCE_POLL, 'nonce' );

		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_send_json_error( array( 'message' => 'forbidden' ), 403 );
		}

		delete_transient( 'security_scanner_active_job' );

		wp_send_json_success( array( 'status' => 'stopped' ) );
	}

	/**
	 * AJAX: returns scan results for a job.
	 */
	public function ajax_results(): void {
		check_ajax_referer( self::NONCE_POLL, 'nonce' );

		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_send_json_error( array( 'message' => 'forbidden' ), 403 );
		}

		// TODO(dry): this job_id resolution block is duplicated in ajax_status();
		// extract a private resolve_job_id() helper returning `?string`.
		$job_id = '';
		if ( isset( $_POST['job_id'] ) ) {
			$job_id = sanitize_text_field( wp_unslash( $_POST['job_id'] ) );
		} elseif ( get_transient( 'security_scanner_active_job' ) ) {
			$job_id = (string) get_transient( 'security_scanner_active_job' );
		}

		if ( '' === $job_id ) {
			wp_send_json_error( array( 'message' => 'no job' ) );
		}

		try {
			$results = $this->scanner->get_results( $job_id );
		} catch ( ScanException $e ) {
			wp_send_json_error( array( 'message' => $e->getMessage() ) );
		}

		wp_send_json_success( array( 'results' => $this->serialize_results( $results ) ) );
	}

	/**
	 * Renders the admin page.
	 */
	public function render(): void {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return;
		}

		$site_id     = $this->storage->get_site_id();
		$site_key    = $this->storage->get_site_key();
		$has_key     = null !== $site_key && '' !== $site_key;
		// The job id shown to the UI comes ONLY from the one-shot started_job
		// transient, so reloading the page (or opening it fresh) does not pick
		// up a previously started scan and resume polling. The scan keeps running
		// server-side while the original tab polls; a reload simply returns the
		// UI to idle rather than silently continuing.
		$job_id      = $this->consume_started_job();
		$notice      = $this->consume_notice();
		$dir_options = $this->directory_options();
		$settings    = $this->load_scan_settings();

		require LLAR_SECURITY_SCANNER_DIR . 'src/Views/page.php';
	}

	/**
	 * Returns the sanitised list of selected directory slugs.
	 *
	 * @param mixed                $raw    Raw POST value.
	 * @param array<string,string> $allowed Valid slug => path map.
	 * @return string[] Directory slugs (validated against the allowed map).
	 */
	private function sanitize_directory_slugs( $raw, array $allowed ): array {
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$out = array();
		foreach ( $raw as $key ) {
			$key = sanitize_text_field( wp_unslash( $key ) );
			if ( isset( $allowed[ $key ] ) ) {
				$out[] = $key;
			}
		}

		return array_values( array_unique( $out ) );
	}

	/**
	 * Maps validated directory slugs back to absolute paths.
	 *
	 * @param string[]             $slugs   Directory slugs.
	 * @param array<string,string> $allowed Valid slug => path map.
	 * @return string[] Absolute paths.
	 */
	private function slugs_to_paths( array $slugs, array $allowed ): array {
		$out = array();
		foreach ( $slugs as $slug ) {
			if ( isset( $allowed[ $slug ] ) ) {
				$out[] = $allowed[ $slug ];
			}
		}

		return array_values( array_unique( $out ) );
	}

	/**
	 * Persists the scan form selections so they survive page reloads.
	 *
	 * @param string[] $dir_slugs     Selected directory slugs.
	 * @param string   $include_masks Include masks raw string.
	 * @param string   $exclude_masks Exclude masks raw string.
	 */
	private function store_scan_settings( array $dir_slugs, string $include_masks, string $exclude_masks ): void {
		update_option(
			self::OPTION_SETTINGS,
			array(
				'directories' => array_values( $dir_slugs ),
				'include'     => $include_masks,
				'exclude'     => $exclude_masks,
			),
			false
		);
	}

	/**
	 * Loads the persisted scan form selections, with sane defaults.
	 *
	 * @return array{directories: string[], include: string, exclude: string}
	 */
	private function load_scan_settings(): array {
		$saved = get_option( self::OPTION_SETTINGS );

		if ( ! is_array( $saved ) ) {
			return array(
				'directories' => array( 'root' ),
				'include'     => '',
				'exclude'     => '',
			);
		}

		$dirs = is_array( $saved['directories'] ?? null ) ? array_map( 'strval', $saved['directories'] ) : array( 'root' );

		return array(
			'directories' => array() === $dirs ? array( 'root' ) : array_values( $dirs ),
			'include'     => is_string( $saved['include'] ?? null ) ? (string) $saved['include'] : '',
			'exclude'     => is_string( $saved['exclude'] ?? null ) ? (string) $saved['exclude'] : '',
		);
	}

	/**
	 * Parses a comma/newline separated mask string into a list.
	 *
	 * @param mixed $raw Raw value.
	 * @return string[]
	 */
	private function parse_masks( $raw ): array {
		$raw   = is_string( $raw ) ? wp_unslash( $raw ) : '';
		$parts = preg_split( '/[\r\n,]+/', $raw );
		$parts = false === $parts ? array() : $parts;
		$parts = array_map( 'sanitize_text_field', $parts );

		return array_values( array_filter( $parts, 'strlen' ) );
	}

	/**
	 * Maps ScanResult[] to a plain JSON-serialisable array.
	 *
	 * @param ScanResult[] $results Results.
	 * @return array<int, array<string, mixed>>
	 */
	private function serialize_results( array $results ): array {
		$out = array();
		foreach ( $results as $r ) {
			$out[] = array(
				'file_path'   => $r->file_path,
				'status'      => $r->status,
				'threat_type' => $r->threat_type,
				'severity'    => $r->severity,
				'scanned_at'  => $r->scanned_at,
			);
		}

		return $out;
	}

	/**
	 * Builds the selectable directory map [slug => absolute path].
	 *
	 * @return array<string, string>
	 */
	private function directory_options(): array {
		$root = untrailingslashit( ABSPATH );

		$options = array(
			'root'        => $root,
			'wp-admin'    => $root . '/wp-admin',
			'wp-includes' => $root . '/wp-includes',
			'wp-content'  => $root . '/wp-content',
		);

		// E2E test: if a test directory was set via transient, add it.
		$e2e_dir = get_transient( 'security_scanner_e2e_dir' );
		if ( false !== $e2e_dir && is_string( $e2e_dir ) && '' !== $e2e_dir ) {
			$options['e2e-test'] = $e2e_dir;
		}

		return $options;
	}

	/**
	 * Stores a notice in a transient and redirects back to the page.
	 *
	 * @param array{type: string, message: string} $notice Notice.
	 */
	private function redirect( array $notice ): void {
		set_transient( 'security_scanner_notice', $notice, 60 );
		wp_safe_redirect( admin_url( 'admin.php?page=' . self::SLUG ) );
		exit;
	}

	/**
	 * Reads and clears the one-shot "scan just started" transient.
	 *
	 * Set by handle_start_scan() right before the PRG redirect and consumed
	 * here on the first render so the UI shows the running scan exactly once.
	 * Any subsequent load (reload, reopening the page) finds it gone and renders
	 * the idle state, preventing the scan from being silently resumed.
	 *
	 * @return string Job id, or '' when no scan was just started.
	 */
	private function consume_started_job(): string {
		$job_id = get_transient( 'security_scanner_started_job' );
		if ( false !== $job_id ) {
			delete_transient( 'security_scanner_started_job' );
			return (string) $job_id;
		}
		return '';
	}

	/**
	 * Pops the one-shot transient notice for inline display on the plugin page.
	 *
	 * Rendered inline in the page view (under the relevant section) rather than
	 * via `admin_notices`: that hook fires in admin-header, before the page
	 * callback, and would consume the transient before `render()` can read it.
	 * The `scope` ("connection" or "scan") routes the notice to the section
	 * that triggered it, so e.g. a scan-start error lands near the scan form,
	 * not under the connection form.
	 *
	 * @return array{type: string, message: string, scope: string}|null Notice data or null when none pending.
	 */
	private function consume_notice(): ?array {
		$notice = get_transient( 'security_scanner_notice' );
		if ( ! is_array( $notice ) ) {
			return null;
		}
		delete_transient( 'security_scanner_notice' );

		$allowed = array( 'success' => true, 'error' => true, 'warning' => true, 'info' => true );
		$type    = isset( $notice['type'], $allowed[ $notice['type'] ] ) ? $notice['type'] : 'info';
		$message = isset( $notice['message'] ) && is_string( $notice['message'] ) ? $notice['message'] : '';

		if ( '' === $message ) {
			return null;
		}

		$allowed_scopes = array( 'connection' => true, 'scan' => true );
		$scope          = isset( $notice['scope'], $allowed_scopes[ $notice['scope'] ] ) ? $notice['scope'] : 'connection';

		return array(
			'type'    => $type,
			'message' => $message,
			'scope'   => $scope,
		);
	}
}
