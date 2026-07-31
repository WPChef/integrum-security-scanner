	( function ( document, window ) {
		'use strict';

		const CFG = window.llarImunify || {};

		// ── Key field → button label toggle ──────────────────────────────
		const keyField = document.getElementById( 'llar-key' );
		const keyBtn = keyField && keyField.closest( 'form' ).querySelector( 'button[type="submit"]' );
		if ( keyField && keyBtn ) {
			function updateKeyBtn() {
				keyBtn.textContent = keyField.value.trim()
					? ( CFG.i18n && CFG.i18n.saveKey || 'Save key' )
					: ( CFG.i18n && CFG.i18n.register || 'Register' );
			}
			keyField.addEventListener( 'input', updateKeyBtn );
			updateKeyBtn();
		}

		const startBtn = document.querySelector( '.llar-scan-actions__start' );

		// ── Stop scan button ───────────────────────────────────────────────
		const stopBtn = document.querySelector( '.llar-scan-actions__stop' );
		if ( stopBtn ) {
			stopBtn.addEventListener( 'click', function () {
				const statusSection = document.querySelector( '.llar-status' );
				const progressLabel = statusSection && statusSection.querySelector( '.llar-progress__label' );
				const stoppedText = ( CFG.i18n && CFG.i18n.stopped ) || 'Scan stopped.';

				// Optimistically disable the button and signal the stop.
				stopBtn.disabled = true;
				if ( progressLabel ) {
					progressLabel.textContent = ( CFG.i18n && CFG.i18n.stopping ) || 'Stopping…';
				}

				const data = new URLSearchParams();
				data.append( 'action', 'llar_imunify_stop' );
				data.append( 'nonce', CFG.nonce );

				fetch( CFG.ajaxUrl, {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: data.toString(),
				} )
					.then( function ( r ) { return r.json(); } )
					.then( function () {
						// The poller checks `stopped` via window.__llarStopped.
						window.__llarStopped = true;
						if ( statusSection ) {
							statusSection.hidden = true;
						}
						stopBtn.disabled = true;
						if ( startBtn ) {
							startBtn.disabled = false;
						}
						// Surface a brief confirmation at the top of the plugin page.
						const wrap = document.querySelector( '.wrap.llar-imunify' );
						if ( wrap ) {
							const notice = document.createElement( 'div' );
							notice.className = 'notice notice-info is-dismissible';
							notice.innerHTML = '<p>' + stoppedText + '</p>';
							wrap.insertBefore( notice, wrap.firstChild );
						}
					} )
					.catch( function () {
						stopBtn.disabled = false;
						if ( progressLabel ) {
							progressLabel.textContent = CFG.i18n ? CFG.i18n.error : 'error';
						}
					} );
			} );
		}

		// ── Start scan form: show spinner until the server finishes the manifest
		// build + redirect. The scan does not really start until the first status
		// poll returns, so the spinner is the user's feedback during that gap.
		const startForm = document.querySelector( '.llar-start-form' );
		if ( startForm ) {
			startForm.addEventListener( 'submit', function () {
				if ( startBtn ) {
					startBtn.classList.add( 'is-loading' );
					startBtn.disabled = true;
				}
			} );
		}

		// ── Scan polling ─────────────────────────────────────────────────
		const STATUS_INTERVAL_MS = 4000;
		const STATUSES_DONE = [ 'completed', 'done', 'failed' ];

		const statusSection = document.querySelector( '.llar-status' );
	const resultsSection = document.querySelector( '.llar-results' );
	const jobIdInput = document.querySelector( '.llar-job-id' );

	if ( ! statusSection || ! jobIdInput ) {
		return;
	}

	const jobId = jobIdInput.value;
	if ( ! jobId ) {
		return;
	}

	statusSection.hidden = false;

	const progressBar = statusSection.querySelector( '.llar-progress__bar' );
	const progressLabel = statusSection.querySelector( '.llar-progress__label' );
	const tree = resultsSection ? resultsSection.querySelector( '.llar-tree' ) : null;
	const onlySuspicious = document.getElementById( 'llar-only-suspicious' );

	let timer = null;
	// Rolling samples of {t: client ms, bytes: scannedBytes} for ETA smoothing.
	// We derive the scan rate from the last few polls instead of the whole
	// history, so a temporary slowdown does not distort the estimate forever.
	let samples = [];

	function fetchJSON( action, body ) {
		const data = new URLSearchParams();
		data.append( 'action', action );
		data.append( 'nonce', CFG.nonce );
		Object.keys( body || {} ).forEach( function ( k ) {
			data.append( k, body[ k ] );
		} );

		return fetch( CFG.ajaxUrl, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: data.toString(),
		} ).then( function ( r ) {
			return r.json();
		} );
	}

	/**
	 * Formats a byte count as a compact human-readable string.
	 *
	 * @param {number} bytes Bytes.
	 * @return {string}
	 */
	function formatBytes( bytes ) {
		if ( bytes < 1024 ) {
			return bytes + ' B';
		}
		const units = [ 'KB', 'MB', 'GB', 'TB' ];
		let value = bytes / 1024;
		let i = 0;
		while ( value >= 1024 && i < units.length - 1 ) {
			value /= 1024;
			++i;
		}
		return value.toFixed( value < 10 ? 1 : 0 ) + ' ' + units[ i ];
	}

	/**
	 * Formats a duration in seconds as a compact human-readable string.
	 *
	 * @param {number} seconds Seconds.
	 * @return {string}
	 */
	function formatDuration( seconds ) {
		if ( seconds < 60 ) {
			return Math.round( seconds ) + 's';
		}
		if ( seconds < 3600 ) {
			return Math.round( seconds / 60 ) + ' min';
		}
		const h = Math.floor( seconds / 3600 );
		const m = Math.round( ( seconds % 3600 ) / 60 );
		return h + 'h ' + ( m > 0 ? m + 'm' : '' );
	}

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

	function pollStatus() {
		fetchJSON( 'llar_imunify_status', { job_id: jobId } )
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
			timer = window.setTimeout( pollStatus, STATUS_INTERVAL_MS );
			return;
		}

		statusSection.hidden = true;
		if ( stopBtn ) {
			stopBtn.disabled = true;
		}
		if ( startBtn ) {
			startBtn.disabled = false;
		}
		loadResults();
	}

	function loadResults() {
		fetchJSON( 'llar_imunify_results', { job_id: jobId } )
			.then( renderResults )
			.catch( function () {
				if ( resultsSection ) {
					resultsSection.hidden = false;
				}
			} );
	}

	function renderResults( payload ) {
		if ( ! resultsSection || ! tree ) {
			return;
		}

		const rows = ( payload && payload.data && payload.data.results ) || [];
		window.__llarLastResults = rows;
		resultsSection.hidden = false;
		tree.innerHTML = '';

		const empty = resultsSection.querySelector( '.llar-empty' );
		if ( empty ) {
			empty.hidden = true;
		}

		if ( ! rows.length ) {
			if ( empty ) {
				empty.hidden = false;
			}
			return;
		}

		const showAll = ! onlySuspicious || ! onlySuspicious.checked;
		const visible = rows.filter( function ( row ) {
			return showAll || row.status !== 'clean';
		} );

		if ( ! visible.length ) {
			if ( empty ) {
				empty.hidden = false;
			}
			return;
		}

		const root = buildTree( visible );
		tree.appendChild( renderNode( root, '', true ) );
	}

	/**
	 * Groups rows into a nested { children, files } tree by path segments.
	 */
	function buildTree( rows ) {
		const root = { children: {}, files: [] };

		rows.forEach( function ( row ) {
			const parts = row.file_path.split( '/' );
			let node = root;

			for ( let i = 0; i < parts.length - 1; i++ ) {
				const seg = parts[ i ];
				node.children[ seg ] = node.children[ seg ] || { children: {}, files: [] };
				node = node.children[ seg ];
			}
			node.files.push( row );
		} );

		return root;
	}

	/**
	 * Builds a <ul> for a tree node. Folders containing suspicious/infected
	 * files are expanded by default so problems are immediately visible.
	 */
	function renderNode( node, prefix, isRoot ) {
		const ul = document.createElement( 'ul' );
		ul.className = 'llar-tree__list' + ( isRoot ? ' is-root' : '' );

		Object.keys( node.children ).sort().forEach( function ( name ) {
			const child = node.children[ name ];
			const path = prefix ? prefix + '/' + name : name;
			const hasProblems = nodeHasProblems( child );

			const li = document.createElement( 'li' );
			li.className = 'llar-tree__folder';

			const toggle = document.createElement( 'span' );
			toggle.className = 'llar-tree__toggle';
			toggle.textContent = hasProblems ? '▾' : '▸';
			li.appendChild( toggle );

			const label = document.createElement( 'span' );
			label.className = 'llar-tree__folder-name' + ( hasProblems ? ' has-problems' : '' );
			label.textContent = path + '/';
			li.appendChild( label );

			const subtree = renderNode( child, path, false );
			subtree.hidden = ! hasProblems;
			li.appendChild( subtree );

			toggle.addEventListener( 'click', function () {
				subtree.hidden = ! subtree.hidden;
				toggle.textContent = subtree.hidden ? '▸' : '▾';
			} );

			ul.appendChild( li );
		} );

		node.files.sort( function ( a, b ) {
			return a.file_path < b.file_path ? -1 : 1;
		} ).forEach( function ( row ) {
			ul.appendChild( renderFile( row ) );
		} );

		return ul;
	}

	/**
	 * Builds a <li> for a single scanned file.
	 */
	function renderFile( row ) {
		const li = document.createElement( 'li' );
		li.className = 'llar-tree__file' + fileStatusClass( row );

		const name = row.file_path.split( '/' ).pop();
		const nameEl = document.createElement( 'span' );
		nameEl.className = 'llar-tree__file-name';
		nameEl.textContent = name;
		nameEl.title = row.file_path;
		li.appendChild( nameEl );

		if ( row.severity ) {
			const sev = document.createElement( 'span' );
			sev.className = 'llar-sev llar-sev--' + row.severity;
			sev.textContent = row.severity;
			li.appendChild( sev );
		}

		if ( row.threat_type ) {
			const t = document.createElement( 'em' );
			t.className = 'llar-tree__threat';
			t.textContent = row.threat_type;
			li.appendChild( t );
		}

		return li;
	}

	function fileStatusClass( row ) {
		if ( 'infected' === row.status ) {
			return ' is-infected';
		}
		return 'clean' !== row.status ? ' is-suspicious' : '';
	}

	function nodeHasProblems( node ) {
		for ( let i = 0; i < node.files.length; i++ ) {
			if ( 'clean' !== node.files[ i ].status ) {
				return true;
			}
		}
		for ( const name in node.children ) {
			if ( nodeHasProblems( node.children[ name ] ) ) {
				return true;
			}
		}
		return false;
	}

	if ( onlySuspicious ) {
		onlySuspicious.addEventListener( 'change', function () {
			if ( resultsSection && ! resultsSection.hidden ) {
				renderResults( { data: { results: window.__llarLastResults || [] } } );
			}
		} );
	}

	pollStatus();
} )( document, window );
