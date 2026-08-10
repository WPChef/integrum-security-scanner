<?php
/**
 * Admin page template.
 *
 * Styling is driven by Tailwind utilities (loaded via the Play CDN and scoped
 * to #security-scanner-app in AdminController::enqueue()). The handful of classes
 * kept without Tailwind counterparts (llar-status, llar-progress__*, llar-tree*,
 * llar-sev*) are required by assets/js/admin.js, which builds those nodes at
 * runtime and reads/writes them by class name.
 *
 * @package Llar\SecurityScanner\Views
 *
 * @var string|null                                 $site_id
 * @var string|null                                 $site_key
 * @var bool                                        $has_key
 * @var string                                      $job_id
 * @var array{type: string, message: string, scope: string}|null    $notice
 * @var array<string, string>                       $dir_options
 * @var array{directories: string[], include: string, exclude: string} $settings
 */

declare( strict_types = 1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap security-scanner" id="security-scanner-app">

	<header class="flex items-center gap-3 mt-1 mb-6">
		<span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
			<span class="dashicons dashicons-shield-alt text-xl" aria-hidden="true"></span>
		</span>
		<div class="min-w-0">
			<h1 class="!m-0 !text-2xl !font-semibold !leading-tight !text-slate-800"><?php esc_html_e( 'File Security Scanner', 'security-scanner' ); ?></h1>
			<p class="!m-0 !text-sm !text-slate-500"><?php esc_html_e( 'Scan your site files for malicious code.', 'security-scanner' ); ?></p>
		</div>
		<?php if ( $has_key ) : ?>
			<span class="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
				<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
				<?php esc_html_e( 'Connected', 'security-scanner' ); ?>
			</span>
		<?php else : ?>
			<span class="ml-auto inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
				<span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
				<?php esc_html_e( 'Not connected', 'security-scanner' ); ?>
			</span>
		<?php endif; ?>
	</header>

	<div class="grid grid-cols-1 gap-5">

		<!-- Connection / site key -->
		<section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
				<h2 class="!m-0 !text-lg !font-semibold !text-slate-800"><?php esc_html_e( 'Connection', 'security-scanner' ); ?></h2>
				<?php if ( $has_key && null !== $site_id ) : ?>
					<span class="text-xs text-slate-500">
						<?php
						printf(
							/* translators: %s: site id. */
							esc_html__( 'Site ID: %s', 'security-scanner' ),
							'<code class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">' . esc_html( $site_id ) . '</code>'
						);
						?>
					</span>
				<?php endif; ?>
			</div>

			<form method="post" action="" class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<?php wp_nonce_field( 'security_scanner_get_key' ); ?>
				<input type="hidden" name="security_scanner_action" value="get_key" />

				<div>
					<label for="llar-email" class="mb-1.5 block text-sm font-medium text-slate-700"><?php esc_html_e( 'Owner email', 'security-scanner' ); ?></label>
					<input
						type="email"
						id="llar-email"
						name="security_scanner_email"
						required
						value="<?php echo esc_attr( wp_get_current_user()->user_email ); ?>"
						class="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30"
					/>
				</div>

				<div>
					<label for="llar-key" class="mb-1.5 block text-sm font-medium text-slate-700"><?php esc_html_e( 'Site key', 'security-scanner' ); ?></label>
					<input
						type="text"
						id="llar-key"
						name="security_scanner_key"
						value="<?php echo esc_attr( $site_key ?? '' ); ?>"
						class="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-800 shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30"
					/>
				</div>

				<div class="md:col-span-2">
					<button
						type="submit"
						class="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:cursor-not-allowed disabled:opacity-60"
					>
						<?php $has_key ? esc_html_e( 'Save key', 'security-scanner' ) : esc_html_e( 'Register', 'security-scanner' ); ?>
					</button>
				</div>

				<?php if ( null !== $notice && 'connection' === $notice['scope'] ) : ?>
					<?php require LLAR_SECURITY_SCANNER_DIR . 'src/Views/notice.php'; ?>
				<?php endif; ?>
			</form>
		</section>

		<!-- Scan area -->
		<section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm <?php echo $has_key ? '' : 'pointer-events-none opacity-60'; ?>">
			<h2 class="!m-0 !mb-4 !text-lg !font-semibold !text-slate-800"><?php esc_html_e( 'Scan area', 'security-scanner' ); ?></h2>

			<form method="post" action="" class="llar-start-form space-y-4">
				<?php wp_nonce_field( 'security_scanner_start_scan' ); ?>
				<input type="hidden" name="security_scanner_action" value="start_scan" />

				<div>
					<span class="mb-2 block text-sm font-medium text-slate-700"><?php esc_html_e( 'Directories', 'security-scanner' ); ?></span>
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
						<?php foreach ( $dir_options as $slug => $abs ) : ?>
							<label class="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100">
								<input
									type="checkbox"
									name="security_scanner_directories[]"
									value="<?php echo esc_attr( $slug ); ?>"
									class="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
									<?php checked( in_array( $slug, $settings['directories'], true ) ); ?>
								/>
								<?php echo esc_html( $slug ); ?>
							</label>
						<?php endforeach; ?>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<div>
						<label for="llar-include" class="mb-1.5 block text-sm font-medium text-slate-700"><?php esc_html_e( 'Include masks', 'security-scanner' ); ?></label>
						<input
							type="text"
							id="llar-include"
							name="security_scanner_include"
							placeholder="*.php"
							value="<?php echo esc_attr( $settings['include'] ); ?>"
							class="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-800 shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30"
						/>
					</div>
					<div>
						<label for="llar-exclude" class="mb-1.5 block text-sm font-medium text-slate-700"><?php esc_html_e( 'Exclude masks', 'security-scanner' ); ?></label>
						<input
							type="text"
							id="llar-exclude"
							name="security_scanner_exclude"
							placeholder="*/cache/*"
							value="<?php echo esc_attr( $settings['exclude'] ); ?>"
							class="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-800 shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30"
						/>
					</div>
				</div>

				<p class="!m-0 text-xs text-slate-500"><?php esc_html_e( 'Separate masks with a comma. Exclude always wins over include.', 'security-scanner' ); ?></p>

				<div class="llar-scan-actions flex items-center gap-3 pt-1">
					<button
						type="submit"
						class="llar-scan-actions__start inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:cursor-not-allowed disabled:opacity-60"
						<?php disabled( ! $has_key || '' !== $job_id ); ?>
					>
						<?php esc_html_e( 'Start Scan', 'security-scanner' ); ?>
					</button>
					<button
						type="button"
						class="llar-scan-actions__stop inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400/30 disabled:cursor-not-allowed disabled:opacity-60"
						<?php disabled( '' === $job_id ); ?>
					>
						<?php esc_html_e( 'Stop Scan', 'security-scanner' ); ?>
					</button>
				</div>
			</form>

			<?php if ( null !== $notice && 'scan' === $notice['scope'] ) : ?>
				<?php require LLAR_SECURITY_SCANNER_DIR . 'src/Views/notice.php'; ?>
			<?php endif; ?>
		</section>

		<!-- Scan status (revealed by admin.js once a job is active) -->
		<section class="llar-status rounded-xl border border-slate-200 bg-white p-6 shadow-sm" hidden>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="!m-0 !text-lg !font-semibold !text-slate-800"><?php esc_html_e( 'Scan in progress', 'security-scanner' ); ?></h2>
				<span class="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700">
					<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-500"></span>
					<?php esc_html_e( 'Live', 'security-scanner' ); ?>
				</span>
			</div>
			<p class="mb-3 text-sm text-slate-500"><?php esc_html_e( 'Do not close this page until the scan completes.', 'security-scanner' ); ?></p>
			<div class="llar-progress h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
				<div class="llar-progress__bar h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-600 transition-[width] duration-500 ease-out" style="width:0%"></div>
			</div>
			<p class="llar-progress__label mt-2 break-all font-mono text-xs text-slate-600"><?php esc_html_e( 'Preparing…', 'security-scanner' ); ?></p>
			<input type="hidden" class="llar-job-id" value="<?php echo esc_attr( $job_id ); ?>" />
		</section>

		<!-- Results (revealed by admin.js after the scan completes) -->
		<section class="llar-results rounded-xl border border-slate-200 bg-white p-6 shadow-sm" hidden>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="!m-0 !text-lg !font-semibold !text-slate-800"><?php esc_html_e( 'Results', 'security-scanner' ); ?></h2>
				<label class="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
					<input type="checkbox" id="llar-only-suspicious" checked class="rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
					<?php esc_html_e( 'Suspicious only', 'security-scanner' ); ?>
				</label>
			</div>
			<ul class="llar-tree"></ul>
			<p class="llar-empty text-sm text-slate-500" hidden><?php esc_html_e( 'No files to show.', 'security-scanner' ); ?></p>
		</section>

	</div>
</div>
