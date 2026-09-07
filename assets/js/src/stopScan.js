/**
 * Stop scan button: signals the server, optimistically disables the button
 * and surfaces a standard WP admin notice (placed in #wpbody-content before
 * .wrap, outside the Tailwind-scoped markup) which is scrolled into view.
 */
import { CFG } from './config.js';
import { fetchJSON } from './ajax.js';
import { scrollIntoView } from './viewport.js';
import { setDirTreeLocked } from './dirTree.js';

export function initStopScan() {
	const stopBtn = document.querySelector( '.llar-scan-actions__stop' );
	if ( ! stopBtn ) {
		return;
	}

	stopBtn.addEventListener( 'click', function () {
		const statusSection = document.querySelector( '.llar-status' );
		const progressLabel = statusSection && statusSection.querySelector( '.llar-progress__label' );
		const stoppedText = ( CFG.i18n && CFG.i18n.stopped ) || 'Scan stopped.';

		// Optimistically disable the button and signal the stop.
		stopBtn.disabled = true;
		if ( progressLabel ) {
			progressLabel.textContent = ( CFG.i18n && CFG.i18n.stopping ) || 'Stopping…';
		}

		fetchJSON( 'site_integrity_scanner_stop', {} )
			.then( function () {
				// The poller checks `stopped` via window.__llarStopped.
				window.__llarStopped = true;
				setDirTreeLocked( false );
				if ( statusSection ) {
					statusSection.hidden = true;
				}
				stopBtn.disabled = true;
				const startBtn = document.querySelector( '.llar-scan-actions__start' );
				if ( startBtn ) {
					startBtn.disabled = false;
				}

				const wrap = document.querySelector( '.wrap.site-integrity-scanner' );
				if ( wrap && wrap.parentNode ) {
					const notice = document.createElement( 'div' );
					notice.className = 'notice notice-info is-dismissible';
					const p = document.createElement( 'p' );
					p.textContent = stoppedText;
					notice.appendChild( p );
					wrap.parentNode.insertBefore( notice, wrap );
					scrollIntoView( notice );
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
