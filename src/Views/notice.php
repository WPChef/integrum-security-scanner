<?php
/**
 * Inline admin notice partial, themed with the plugin's Tailwind palette.
 *
 * Included by page.php at each section that can produce a notice. The container
 * keeps the legacy `.site-integrity-scanner-notice notice-{type}` classes (plus a `<p>`)
 * so the existing e2e selectors continue to match.
 *
 * @package Llar\SecurityScanner\Views
 *
 * @var array{type: string, message: string, scope: string} $notice
 */

declare( strict_types = 1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$notice_styles = array(
	'success' => 'bg-emerald-50 border-emerald-200 text-emerald-800',
	'error'   => 'bg-red-50 border-red-200 text-red-800',
	'warning' => 'bg-amber-50 border-amber-200 text-amber-800',
	'info'    => 'bg-primary-50 border-primary-200 text-primary-800',
);

$notice_icons = array(
	'success' => 'dashicons-yes',
	'error'   => 'dashicons-dismiss',
	'warning' => 'dashicons-warning',
	'info'    => 'dashicons-info',
);

$n_type    = isset( $notice['type'] ) ? $notice['type'] : 'info';
$n_message = isset( $notice['message'] ) ? $notice['message'] : '';
$n_classes = $notice_styles[ $n_type ] ?? $notice_styles['info'];
$n_icon    = $notice_icons[ $n_type ] ?? $notice_icons['info'];
?>
<div class="site-integrity-scanner-notice notice-<?php echo esc_attr( $n_type ); ?> md:col-span-2 mt-4 flex items-start gap-2 rounded-md border px-4 py-3 text-sm <?php echo esc_attr( $n_classes ); ?>" role="status">
	<span class="dashicons <?php echo esc_attr( $n_icon ); ?> !mt-0.5 !text-base" aria-hidden="true"></span>
	<p class="!m-0"><?php echo esc_html( $n_message ); ?></p>
</div>
