/**
 * Start scan form: show a loading state until the server finishes the
 * manifest build + redirect. The scan does not really start until the
 * first status poll returns, so this is the user's feedback during that
 * gap.
 */
import { setDirTreeLocked } from './dirTree.js';

export function initStartForm() {
	const startForm = document.querySelector( '.iss-start-form' );
	const startBtn = document.querySelector( '.iss-scan-actions__start' );
	if ( ! startForm || ! startBtn ) {
		return;
	}

	startForm.addEventListener( 'submit', function () {
		setDirTreeLocked( true );
		startBtn.classList.add( 'is-loading' );
		startBtn.disabled = true;
	} );
}
