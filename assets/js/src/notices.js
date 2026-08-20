/**
 * Server-rendered notices: after a form submit + PRG redirect the page loads
 * at the top, so an error/success notice rendered below the fold would be
 * invisible. Bring the first notice into the visible area instead.
 *
 * When a scan has just been started, the progress section takes priority
 * (status.js reveals and scrolls it), so the notice is left alone.
 */
import { scrollIntoView } from './viewport.js';

export function initNotices() {
	const notice = document.querySelector( '.security-scanner-notice' );
	if ( ! notice ) {
		return;
	}

	// Do not fight the progress reveal: if a scan was just started, its
	// section is the thing the user needs to see.
	const jobIdInput = document.querySelector( '.llar-job-id' );
	if ( jobIdInput && jobIdInput.value ) {
		return;
	}

	scrollIntoView( notice );
}
