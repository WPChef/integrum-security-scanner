/**
 * Scan status polling: reveals the progress section for the active job,
 * renders progress + ETA, and loads the results once the job finishes.
 */
import { CFG } from './config.js';
import { fetchJSON } from './ajax.js';
import { formatBytes, formatDuration } from './format.js';
import { revealIntoView } from './viewport.js';
import { loadResults } from './results.js';
import { setDirTreeLocked } from './dirTree.js';
import { refreshHistory } from './history.js';

const STATUS_INTERVAL_MS = 4000;
const STATUSES_DONE = [ 'completed', 'done', 'failed' ];
const MAX_RETRY_DELAY_MS = 30000;
// Give up after this many consecutive transport-level failures (network
// error, 5xx, malformed response). The PHP side escalates a failing job on
// its own; this cap only stops the client from retrying forever when the
// server is unreachable.
const MAX_CONSECUTIVE_ERRORS = 5;

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
	const statusSection = document.querySelector( '.iss-status' );
	const stopBtn = document.querySelector( '.iss-scan-actions__stop' );
	const startBtn = document.querySelector( '.iss-scan-actions__start' );
	if ( ! statusSection ) {
		return;
	}

	revealIntoView( statusSection );
	setDirTreeLocked( true );

	const progressBar = statusSection.querySelector( '.iss-progress__bar' );
	const progressLabel = statusSection.querySelector( '.iss-progress__label' );

	// Rolling samples of {t: client ms, bytes: scannedBytes} for ETA smoothing.
	// We derive the scan rate from the last few polls instead of the whole
	// history, so a temporary slowdown does not distort the estimate forever.
	let samples = [];

	// Consecutive transport-level poll failures (network / 5xx / bad JSON).
	// A single hiccup must not kill the poller — the scan would look frozen
	// while the job keeps running server-side.
	let consecutiveErrors = 0;

	function pollStatus() {
		fetchJSON( 'integrum_security_scanner_status', { job_id: jobId } )
			.then( function ( payload ) {
				consecutiveErrors = 0;
				onStatus( payload );
			} )
			.catch( function () {
				handlePollFailure();
			} );
	}

	/**
	 * Retries a failed status poll with exponential backoff instead of
	 * abandoning the scan UI. Stops after MAX_CONSECUTIVE_ERRORS so an
	 * unreachable server does not produce an endless retry loop.
	 */
	function handlePollFailure() {
		if ( window.__llarStopped ) {
			return; // Stop requested via the Stop button.
		}

		++consecutiveErrors;

		if ( consecutiveErrors >= MAX_CONSECUTIVE_ERRORS ) {
			// The job keeps running server-side — do not claim it failed.
			progressLabel.textContent = ( CFG.i18n && CFG.i18n.connectionLost )
				|| 'Connection lost. Reload the page to resume monitoring.';
			return;
		}

		progressLabel.textContent = ( CFG.i18n && CFG.i18n.retrying ) || 'Connection lost, retrying…';
		const delay = Math.min( STATUS_INTERVAL_MS * Math.pow( 2, consecutiveErrors ), MAX_RETRY_DELAY_MS );
		window.setTimeout( pollStatus, delay );
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
		setDirTreeLocked( false );
		if ( stopBtn ) {
			stopBtn.disabled = true;
		}
		if ( startBtn ) {
			startBtn.disabled = false;
		}
		hideScanNotice( statusSection );
		loadResults( jobId ).then( function ( rows ) {
			showSummary( statusSection, status, rows, completed || total, payload.data.findings, payload.data.summary );
			// The history table at the bottom gains a row for this run without a
			// page reload (the server archived it when completion was observed).
			refreshHistory();
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
			section.querySelectorAll( '.integrum-security-scanner-notice' ),
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
	 * @param {number}  scanned      Files scanned, from the status counters.
	 * @param {number|undefined} findings Non-clean count from the scanner summary.
	 * @param {Object|undefined} summary  Per-verdict counters from the scanner.
	 */
	function showSummary( statusSection, status, rows, scanned, findings, summary ) {
		const summaryEl = statusSection.parentElement
			? statusSection.parentElement.querySelector( '.iss-scan-summary' )
			: null;
		if ( ! summaryEl ) {
			return;
		}

		const i18n = CFG.i18n || {};
		let text;
		let skin;
		let note = '';
		if ( 'failed' === status ) {
			text = i18n.scanFailed || 'Scan failed.';
			skin = 'iss-scan-summary--failed';
		} else {
			// rows alone are unreliable at completion: the scanner trims the
			// per-file list once the job is done and may return it empty at
			// the instant of completion, so the counts come from the status
			// payload (status counters + scanner summary).
			const suspicious = 'number' === typeof findings
				? findings
				: rows.filter( function ( row ) {
					return row.status && 'clean' !== row.status;
				} ).length;
			const total = scanned || rows.length;

			if ( suspicious > 0 ) {
				const breakdown = verdictBreakdown( summary, i18n );
				text = ( i18n.scanCompletedFindings || 'Scan completed: {scanned} files scanned — {threats} threats found ({breakdown}).' )
					.replace( '{scanned}', String( total ) )
					.replace( '{threats}', String( suspicious ) )
					.replace( '{breakdown}', breakdown );
				skin = 'iss-scan-summary--findings';

				// The scanner may report findings without the per-file list.
				// Say so instead of leaving an empty results tree unexplained.
				if ( rows.length === 0 ) {
					note = i18n.scanFindingsNoList
						|| 'The scanner did not return the per-file list, so the files themselves are not shown. Run the scan again to list them.';
				}
			} else {
				text = ( i18n.scanCompletedClean || 'Scan completed: {scanned} files scanned — no threats found.' )
					.replace( '{scanned}', String( total ) );
				skin = 'iss-scan-summary--clean';
			}
		}

		summaryEl.textContent = text;
		summaryEl.className = 'iss-scan-summary mb-4 rounded-lg border px-4 py-3 text-sm ' + skin;
		summaryEl.hidden = false;

		if ( '' !== note ) {
			const noteEl = document.createElement( 'p' );
			noteEl.className = 'mt-1 text-xs opacity-75';
			noteEl.textContent = note;
			summaryEl.appendChild( noteEl );
		}
	}

	/**
	 * Builds the "N malicious, N suspicious" part of the completion summary
	 * from the scanner's per-verdict counters, skipping zero categories.
	 *
	 * @param {Object|undefined} summary Per-verdict counters.
	 * @param {Object}           i18n    Translated labels.
	 * @return {string}
	 */
	function verdictBreakdown( summary, i18n ) {
		if ( ! summary ) {
			return '';
		}
		const labels = {
			malicious: i18n.verdictMalicious || 'malicious',
			suspicious: i18n.verdictSuspicious || 'suspicious',
			unknown: i18n.verdictUnknown || 'unknown',
		};
		const parts = [];
		Object.keys( labels ).forEach( function ( key ) {
			const count = Number( summary[ key ] ) || 0;
			if ( count > 0 ) {
				parts.push( count + ' ' + labels[ key ] );
			}
		} );
		return parts.join( ', ' );
	}

	pollStatus();
}
