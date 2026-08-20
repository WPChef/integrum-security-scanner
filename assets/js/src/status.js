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
		loadResults( jobId );
	}

	pollStatus();
}
