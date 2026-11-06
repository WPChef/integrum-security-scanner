/**
 * Database scan: AJAX start, sequential poll ticks, stop, render findings.
 */
import { CFG } from './config.js';
import { fetchJSON } from './ajax.js';

const TICK_MS = 1500;

/**
 * Stage → localized label.
 *
 * @param {string} stage
 * @returns {string}
 */
function stageLabel( stage ) {
	const i18n = CFG.i18n || {};
	if ( stage === 'options' ) {
		return i18n.dbStageOptions || 'Scanning options…';
	}
	if ( stage === 'postmeta' ) {
		return i18n.dbStagePostmeta || 'Scanning post meta…';
	}
	if ( stage === 'posts' ) {
		return i18n.dbStagePosts || 'Scanning posts…';
	}
	return i18n.dbStagePosts || 'Scanning database…';
}

/**
 * Honest progress copy: candidate throughput, not "Imunify % done".
 *
 * @param {{ stage?: string, examined?: number, scope_total?: number, progress_pct?: number }} data
 * @returns {string}
 */
function progressLabel( data ) {
	const examined = Number( data.examined ) || 0;
	const total = Number( data.scope_total ) || 0;
	const i18n = CFG.i18n || {};
	const tpl = i18n.dbCandidates || 'Processed %1$s of %2$s candidates';
	const candidates =
		total > 0
			? tpl.replace( '%1$s', String( examined ) ).replace( '%2$s', String( total ) )
			: tpl.replace( '%1$s', String( examined ) ).replace( '%2$s', '…' );
	const stage = data.stage ? stageLabel( data.stage ) : '';
	return stage ? candidates + ' · ' + stage : candidates;
}

/**
 * Renders the findings table inside #iss-db-scan (shared by poll + hydrate).
 *
 * @param {HTMLElement} section
 * @param {Array<{severity?: string, edit_url?: string, label?: string, row_id?: string, table?: string, signature_id?: string}>} rows
 * @param {boolean} truncated
 * @param {{ emptyMessage?: string }} [opts]
 */
function renderFindings( section, rows, truncated, opts ) {
	const resultsWrap = section.querySelector( '.iss-db-results' );
	const tbody = section.querySelector( '.iss-db-results__body' );
	const emptyEl = section.querySelector( '.iss-db-results__empty' );
	const truncEl = section.querySelector( '.iss-db-results__truncated' );
	if ( ! resultsWrap || ! tbody ) {
		return;
	}

	resultsWrap.classList.remove( 'hidden' );
	tbody.innerHTML = '';

	if ( truncEl ) {
		if ( truncated ) {
			truncEl.classList.remove( 'hidden' );
			truncEl.textContent =
				( CFG.i18n && CFG.i18n.dbTruncated ) || 'Showing the first 500 findings.';
		} else {
			truncEl.classList.add( 'hidden' );
			truncEl.textContent = '';
		}
	}

	if ( ! rows || ! rows.length ) {
		if ( emptyEl ) {
			emptyEl.classList.remove( 'hidden' );
			emptyEl.textContent =
				( opts && opts.emptyMessage ) ||
				( CFG.i18n && CFG.i18n.dbNoFindings ) ||
				'No database threats detected.';
		}
		return;
	}

	if ( emptyEl ) {
		emptyEl.classList.add( 'hidden' );
	}

	rows.forEach( function ( row ) {
		const tr = document.createElement( 'tr' );
		const sev = document.createElement( 'td' );
		sev.className = 'border-b border-slate-100 py-2 pr-3';
		sev.textContent = row.severity || '';

		const loc = document.createElement( 'td' );
		loc.className = 'border-b border-slate-100 py-2 pr-3';
		if ( row.edit_url ) {
			const a = document.createElement( 'a' );
			a.href = row.edit_url;
			a.textContent = row.label || row.row_id;
			a.className = 'text-primary-700 underline';
			loc.appendChild( a );
		} else {
			loc.textContent = row.label || ( row.table + ' #' + row.row_id );
		}

		const sig = document.createElement( 'td' );
		sig.className = 'border-b border-slate-100 py-2 font-mono text-xs';
		sig.textContent = row.signature_id || '';

		tr.appendChild( sev );
		tr.appendChild( loc );
		tr.appendChild( sig );
		tbody.appendChild( tr );
	} );
}

/**
 * Shows / clears an inline notice under the DB scan actions (no page reload).
 *
 * @param {HTMLElement} section
 * @param {'success'|'error'|''} type
 * @param {string} message
 */
function setDbNotice( section, type, message ) {
	let notice = section.querySelector( '.iss-db-ajax-notice' );
	if ( ! notice ) {
		notice = document.createElement( 'div' );
		notice.className = 'iss-db-ajax-notice mt-3 rounded-md border px-3 py-2 text-sm';
		notice.setAttribute( 'role', 'status' );
		const form = section.querySelector( '.iss-db-scan__form' );
		if ( form && form.parentNode ) {
			form.parentNode.insertBefore( notice, form.nextSibling );
		} else {
			section.prepend( notice );
		}
	}

	if ( ! type || ! message ) {
		notice.hidden = true;
		notice.textContent = '';
		return;
	}

	notice.hidden = false;
	notice.textContent = message;
	notice.className =
		'iss-db-ajax-notice mt-3 rounded-md border px-3 py-2 text-sm ' +
		( type === 'error'
			? 'border-red-200 bg-red-50 text-red-800'
			: 'border-emerald-200 bg-emerald-50 text-emerald-800' );
}

/**
 * Starts DB scan polling for an active job. Ticks are chained (never overlapping).
 *
 * @param {string} jobId Remote Imunify DB job id.
 */
export function initDbPolling( jobId ) {
	const section = document.querySelector( '#iss-db-scan' );
	if ( ! section || ! jobId ) {
		return;
	}

	const jobInput = section.querySelector( '.iss-db-job-id' );
	if ( jobInput ) {
		jobInput.value = jobId;
	}

	const progressWrap = section.querySelector( '.iss-db-progress' );
	const bar = section.querySelector( '.iss-db-progress__bar' );
	const pctEl = section.querySelector( '.iss-db-progress__pct' );
	const label = section.querySelector( '.iss-db-progress__label' );
	const startBtn = section.querySelector( '.iss-db-scan__start' );
	const stopBtn = section.querySelector( '.iss-db-scan__stop' );

	if ( progressWrap ) {
		progressWrap.classList.remove( 'hidden' );
	}
	if ( startBtn ) {
		startBtn.disabled = true;
	}
	if ( stopBtn ) {
		stopBtn.disabled = false;
	}

	let stopped = false;
	let inFlight = false;
	let timer = null;

	function setProgress( pct ) {
		const n = Math.max( 0, Math.min( 100, Number( pct ) || 0 ) );
		if ( bar ) {
			bar.style.width = n + '%';
		}
		if ( pctEl ) {
			pctEl.textContent = n + '%';
		}
	}

	function clearTimer() {
		if ( timer ) {
			clearTimeout( timer );
			timer = null;
		}
	}

	function scheduleNext() {
		clearTimer();
		if ( stopped ) {
			return;
		}
		timer = setTimeout( tick, TICK_MS );
	}

	function finishUi( ok ) {
		clearTimer();
		stopped = true;
		if ( startBtn ) {
			startBtn.disabled = false;
		}
		if ( stopBtn ) {
			stopBtn.disabled = true;
		}
		if ( jobInput ) {
			jobInput.value = '';
		}
		const lastInput = section.querySelector( '.iss-db-last-job-id' );
		if ( lastInput ) {
			lastInput.value = jobId;
		}
		if ( label && ok ) {
			label.textContent = ( CFG.i18n && CFG.i18n.dbCompleted ) || 'Database scan completed.';
		}
		setProgress( 100 );
	}

	function loadResults() {
		return fetchJSON( 'integrum_security_scanner_db_results', { job_id: jobId } ).then( function ( payload ) {
			if ( payload && payload.success && payload.data ) {
				renderFindings( section, payload.data.results || [], !! payload.data.truncated );
			} else {
				renderFindings( section, [], false );
			}
		} );
	}

	function onTick( payload ) {
		if ( stopped ) {
			return;
		}
		if ( ! payload || ! payload.success ) {
			const data = ( payload && payload.data ) || {};
			if ( data.retryable ) {
				if ( label ) {
					label.textContent =
						( CFG.i18n && CFG.i18n.dbRetrying ) ||
						data.message ||
						'Temporary network issue — retrying…';
				}
				scheduleNext();
				return;
			}
			if ( label ) {
				label.textContent =
					data.message || ( CFG.i18n && CFG.i18n.dbError ) || 'error';
			}
			setDbNotice( section, 'error', data.message || ( CFG.i18n && CFG.i18n.dbError ) || 'error' );
			finishUi( false );
			return;
		}

		const data = payload.data || {};
		setProgress( data.progress_pct );
		if ( label && data.status === 'running' ) {
			label.textContent = progressLabel( data );
		}

		if ( data.status === 'completed' ) {
			finishUi( true );
			setDbNotice(
				section,
				'success',
				( CFG.i18n && CFG.i18n.dbCompleted ) || 'Database scan completed.'
			);
			if ( data.results ) {
				renderFindings( section, data.results, !! data.truncated );
			} else {
				loadResults();
			}
			return;
		}

		if ( data.status === 'failed' || data.status === 'stopped' ) {
			if ( label ) {
				label.textContent =
					data.message ||
					( data.status === 'stopped'
						? ( CFG.i18n && CFG.i18n.dbStopped ) || 'stopped'
						: ( CFG.i18n && CFG.i18n.dbError ) || 'error' );
			}
			if ( data.status === 'failed' ) {
				setDbNotice( section, 'error', data.message || ( CFG.i18n && CFG.i18n.dbError ) || 'error' );
			}
			finishUi( false );
			if ( data.status === 'failed' ) {
				if ( data.results ) {
					renderFindings( section, data.results, !! data.truncated );
				} else {
					loadResults();
				}
			}
			return;
		}

		scheduleNext();
	}

	function tick() {
		if ( stopped || inFlight ) {
			return;
		}
		inFlight = true;
		fetchJSON( 'integrum_security_scanner_db_status', { job_id: jobId } )
			.then( onTick )
			.catch( function () {
				// Network blip — keep polling; do not clear the active job.
				if ( ! stopped && label ) {
					label.textContent =
						( CFG.i18n && CFG.i18n.dbRetrying ) || 'Temporary network issue — retrying…';
				}
				scheduleNext();
			} )
			.finally( function () {
				inFlight = false;
			} );
	}

	if ( stopBtn && ! stopBtn.dataset.issDbStopBound ) {
		stopBtn.dataset.issDbStopBound = '1';
		stopBtn.addEventListener( 'click', function () {
			stopped = true;
			clearTimer();
			fetchJSON( 'integrum_security_scanner_db_stop', { job_id: jobId } ).finally( function () {
				if ( label ) {
					label.textContent = ( CFG.i18n && CFG.i18n.dbStopped ) || 'stopped';
				}
				finishUi( false );
			} );
		} );
	}

	tick();
}

/**
 * Starts a DB scan via AJAX on button click — no form submit, no page scroll.
 */
export function initDbScanStart() {
	const section = document.querySelector( '#iss-db-scan' );
	if ( ! section ) {
		return;
	}

	const startBtn = section.querySelector( '.iss-db-scan__start' );
	if ( ! startBtn ) {
		return;
	}

	// Hard-disable native submit: click handler only (matches in-place file-scan UX).
	startBtn.setAttribute( 'type', 'button' );

	startBtn.addEventListener( 'click', function () {
		if ( startBtn.disabled ) {
			return;
		}

		const progressWrap = section.querySelector( '.iss-db-progress' );
		const label = section.querySelector( '.iss-db-progress__label' );
		const stopBtn = section.querySelector( '.iss-db-scan__stop' );
		const resultsWrap = section.querySelector( '.iss-db-results' );

		startBtn.disabled = true;
		if ( stopBtn ) {
			stopBtn.disabled = true;
		}
		setDbNotice( section, '', '' );
		if ( resultsWrap ) {
			resultsWrap.classList.add( 'hidden' );
		}
		if ( progressWrap ) {
			progressWrap.classList.remove( 'hidden' );
		}
		if ( label ) {
			label.textContent = ( CFG.i18n && CFG.i18n.dbStarting ) || 'Starting database scan…';
		}

		fetchJSON( 'integrum_security_scanner_db_start', {} )
			.then( function ( payload ) {
				if ( ! payload || ! payload.success || ! payload.data || ! payload.data.job_id ) {
					const msg =
						( payload && payload.data && payload.data.message ) ||
						( CFG.i18n && CFG.i18n.dbError ) ||
						'error';
					setDbNotice( section, 'error', msg );
					if ( label ) {
						label.textContent = msg;
					}
					startBtn.disabled = false;
					return;
				}
				setDbNotice( section, 'success', payload.data.message || '' );
				initDbPolling( String( payload.data.job_id ) );
			} )
			.catch( function () {
				const msg = ( CFG.i18n && CFG.i18n.dbError ) || 'error';
				setDbNotice( section, 'error', msg );
				if ( label ) {
					label.textContent = msg;
				}
				startBtn.disabled = false;
			} );
	} );
}

/**
 * After reload, re-fetch findings for the last completed DB job (no polling).
 *
 * @param {string} jobId
 */
export function initDbResultsHydration( jobId ) {
	const section = document.querySelector( '#iss-db-scan' );
	if ( ! section || ! jobId ) {
		return;
	}

	fetchJSON( 'integrum_security_scanner_db_results', { job_id: jobId } ).then( function ( payload ) {
		if ( ! payload || ! payload.success || ! payload.data ) {
			return;
		}
		const data = payload.data;
		if ( data.state_expired && ( ! data.results || ! data.results.length ) ) {
			renderFindings( section, [], false, {
				emptyMessage:
					data.message ||
					( CFG.i18n && CFG.i18n.dbStateExpired ) ||
					'Previous database scan results are no longer available locally. Start a new scan to refresh.',
			} );
			return;
		}
		renderFindings( section, data.results || [], !! data.truncated );
	} );
}
