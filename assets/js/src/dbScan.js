/**
 * Database scan: poll ticks, stop, render findings table.
 */
import { CFG } from './config.js';
import { fetchJSON } from './ajax.js';
import { revealIntoView } from './viewport.js';

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
 * Starts DB scan polling for a job started via the form PRG redirect.
 *
 * @param {string} jobId Remote Imunify DB job id.
 */
export function initDbPolling( jobId ) {
	const section = document.querySelector( '#iss-db-scan' );
	if ( ! section || ! jobId ) {
		return;
	}

	const progressWrap = section.querySelector( '.iss-db-progress' );
	const bar = section.querySelector( '.iss-db-progress__bar' );
	const pctEl = section.querySelector( '.iss-db-progress__pct' );
	const label = section.querySelector( '.iss-db-progress__label' );
	const startBtn = section.querySelector( '.iss-db-scan__start' );
	const stopBtn = section.querySelector( '.iss-db-scan__stop' );

	if ( progressWrap ) {
		progressWrap.classList.remove( 'hidden' );
		revealIntoView( progressWrap );
	}
	if ( startBtn ) {
		startBtn.disabled = true;
	}
	if ( stopBtn ) {
		stopBtn.disabled = false;
	}

	let timer = null;
	let stopped = false;

	function setProgress( pct ) {
		const n = Math.max( 0, Math.min( 100, Number( pct ) || 0 ) );
		if ( bar ) {
			bar.style.width = n + '%';
		}
		if ( pctEl ) {
			pctEl.textContent = n + '%';
		}
	}

	function finishUi( ok ) {
		if ( timer ) {
			clearInterval( timer );
			timer = null;
		}
		if ( startBtn ) {
			startBtn.disabled = false;
		}
		if ( stopBtn ) {
			stopBtn.disabled = true;
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
				return;
			}
			if ( label ) {
				label.textContent =
					data.message || ( CFG.i18n && CFG.i18n.dbError ) || 'error';
			}
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
			finishUi( false );
			if ( data.status === 'failed' ) {
				if ( data.results ) {
					renderFindings( section, data.results, !! data.truncated );
				} else {
					loadResults();
				}
			}
		}
	}

	function tick() {
		fetchJSON( 'integrum_security_scanner_db_status', { job_id: jobId } )
			.then( onTick )
			.catch( function () {
				// Network blip — keep polling; do not clear the active job.
				if ( label ) {
					label.textContent =
						( CFG.i18n && CFG.i18n.dbRetrying ) || 'Temporary network issue — retrying…';
				}
			} );
	}

	if ( stopBtn ) {
		stopBtn.addEventListener( 'click', function () {
			stopped = true;
			fetchJSON( 'integrum_security_scanner_db_stop', { job_id: jobId } ).finally( function () {
				if ( label ) {
					label.textContent = ( CFG.i18n && CFG.i18n.dbStopped ) || 'stopped';
				}
				finishUi( false );
			} );
		} );
	}

	tick();
	timer = setInterval( tick, TICK_MS );
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
