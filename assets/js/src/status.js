/**
 * Scan status polling: reveals the progress section for the active job,
 * renders progress + ETA, and loads the results once the job finishes.
 */
import { CFG } from './config.js';
import { fetchJSON } from './ajax.js';
import { formatBytes, formatDuration } from './format.js';
import { revealIntoView } from './viewport.js';
import { loadResults } from './results.js';

const STATUS_INTERVAL_MS = 4000;
const STATUSES_DONE = [ 'completed', 'done', 'failed' ];

/**
 * Estimates remaining seconds from the scanned-bytes rate over the sample
 * window. Returns null when there is not enough progress yet to estimate.
 *
 * @param {Array<{t: number, bytes: number}>} window    Recent samples.
 * @param {number}                            scanned   Current scanned bytes.
 * @param {number}                            total     Total bytes.
 * @return {number|null}
 */
function computeEta( window, scanned, total ) {
	if ( total <= 0 || scanned <= 0 || window.length < 2 ) {
		return null;
	}

	const first = window[ 0 ];
	const last = window[ window.length - 1 ];
	const dt = ( last.t - first.t ) / 1000;
	const db = last.bytes - first.bytes;

	if ( dt <= 0 || db <= 0 ) {
		return null; // No forward progress in the window.
	}

	const rate = db / dt;
	const remaining = total - scanned;
	return remaining / rate;
}

/**
 * Starts polling the given job id. The progress section is revealed and
 * scrolled into the visible area — a scan that has just been started must
 * land in the viewport, not below the fold.
 */
export function initPolling( jobId ) {
	const statusSection = document.querySelector( '.llar-status' );
	const stopBtn = document.querySelector( '.llar-scan-actions__stop' );
	const startBtn = document.querySelector( '.llar-scan-actions__start' );
	if ( ! statusSection ) {
		return;
	}

	revealIntoView( statusSection );

	const progressBar = statusSection.querySelector( '.llar-progress__bar' );
	const progressLabel = statusSection.querySelector( '.llar-progress__label' );

	// Rolling samples of {t: client ms, bytes: scannedBytes} for ETA smoothing.
	// We derive the scan rate from the last few polls instead of the whole
	// history, so a temporary slowdown does not distort the estimate forever.
	let samples = [];

	function pollStatus() {
		fetchJSON( 'security_scanner_status', { job_id: jobId } )
			.then( onStatus )
			.catch( function () {
				progressLabel.textContent = CFG.i18n ? CFG.i18n.error : 'error';
			} );
	}

	function onStatus( payload ) {
		if ( ! payload || ! payload.success ) {
			progressLabel.textContent = CFG.i18n ? CFG.i18n.error : 'error';
			return;
		}

		const status = payload.data.status || 'unknown';
		const pct = payload.data.progress_pct || 0;
		const currentFile = payload.data.current_file || '';
		const completed = payload.data.completed || 0;
		const total = payload.data.total || 0;
		const totalBytes = payload.data.total_bytes || 0;
		const scannedBytes = payload.data.scanned_bytes || 0;

		progressBar.style.width = pct + '%';

		// Record a rate sample and compute a smoothed ETA from the recent window.
		const now = Date.now();
		samples.push( { t: now, bytes: scannedBytes } );
		if ( samples.length > 6 ) {
			samples.shift();
		}

		let label = pct + '%';

		// File-count summary (e.g. "3/5 files") when totals are known.
		// Show it even when completed is 0 so the user sees the scale
		// from the very first poll.
		if ( total > 0 ) {
			label += ' · ' + completed + '/' + total;
		}

		// Byte-level summary (e.g. "1.2 MB / 2.8 GB") once we know the total.
		// Shown alongside the file count — both perspectives are useful.
		if ( totalBytes > 0 ) {
			label += ' · ' + formatBytes( scannedBytes ) + ' / ' + formatBytes( totalBytes );
		}

		// ETA, derived from the scanned-bytes rate over the recent sample window.
		// Needs at least two samples with real progress to be meaningful.
		const eta = computeEta( samples, scannedBytes, totalBytes );
		if ( eta !== null ) {
			label += ' · ~' + formatDuration( eta );
		}

		if ( currentFile ) {
			label += ' · ' + currentFile;
		}

		progressLabel.textContent = label;

		if ( STATUSES_DONE.indexOf( status ) === -1 ) {
			if ( window.__llarStopped ) {
				return; // Stop requested via the Stop button: do not schedule another poll.
			}
			window.setTimeout( pollStatus, STATUS_INTERVAL_MS );
			return;
		}

		statusSection.hidden = true;
		if ( stopBtn ) {
			stopBtn.disabled = true;
		}
		if ( startBtn ) {
			startBtn.disabled = false;
		}
		hideScanNotice( statusSection );
		loadResults( jobId ).then( function ( rows ) {
			showSummary( statusSection, status, rows );
		} );
	}

	/**
	 * Hides the server-rendered "Scan started…" notice: it tells the user not
	 * to close the page, which is obsolete advice once the job has finished.
	 *
	 * @param {Element} statusSection Progress section (scopes the lookup to
	 *                                 the scan card, leaving the connection
	 *                                 section's notices alone).
	 */
	function hideScanNotice( statusSection ) {
		const section = statusSection.closest( 'section' );
		if ( ! section ) {
			return;
		}
		Array.prototype.forEach.call(
			section.querySelectorAll( '.security-scanner-notice' ),
			function ( notice ) {
				notice.hidden = true;
			}
		);
	}

	/**
	 * Reveals the completion summary in place of the progress block: without
	 * it the scan ends silently and the user has no explicit "finished"
	 * signal.
	 *
	 * @param {Element} statusSection Progress section.
	 * @param {string}  status       Final job status ('completed' or 'failed').
	 * @param {Array<{file_path: string, status: string}>} rows Result rows.
	 */
	function showSummary( statusSection, status, rows ) {
		const summary = statusSection.parentElement
			? statusSection.parentElement.querySelector( '.llar-scan-summary' )
			: null;
		if ( ! summary ) {
			return;
		}

		const i18n = CFG.i18n || {};
		let text;
		let skin;
		if ( 'failed' === status ) {
			text = i18n.scanFailed || 'Scan failed.';
			skin = 'llar-scan-summary--failed';
		} else {
			const suspicious = rows.filter( function ( row ) {
				return row.status && 'clean' !== row.status;
			} ).length;
			text = ( i18n.scanCompleted || 'Scan completed: {scanned} files scanned, {suspicious} suspicious.' )
				.replace( '{scanned}', String( rows.length ) )
				.replace( '{suspicious}', String( suspicious ) );
			skin = suspicious > 0 ? 'llar-scan-summary--findings' : 'llar-scan-summary--clean';
		}

		summary.textContent = text;
		summary.className = 'llar-scan-summary mb-4 rounded-lg border px-4 py-3 text-sm ' + skin;
		summary.hidden = false;
	}

	pollStatus();
}
