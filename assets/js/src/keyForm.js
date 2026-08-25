/**
 * Key field behaviour: the connection form button reads "Register" while
 * the key field is empty and "Save key" once filled. The eye toggle reveals
 * the masked key and switches back on the second click.
 */
import { CFG } from './config.js';

export function initKeyForm() {
	const keyField = document.getElementById( 'llar-key' );
	const keyBtn = keyField && keyField.closest( 'form' ).querySelector( 'button[type="submit"]' );
	if ( ! keyField || ! keyBtn ) {
		return;
	}

	function updateKeyBtn() {
		keyBtn.textContent = keyField.value.trim()
			? ( CFG.i18n && CFG.i18n.saveKey || 'Save key' )
			: ( CFG.i18n && CFG.i18n.register || 'Register' );
	}

	keyField.addEventListener( 'input', updateKeyBtn );
	updateKeyBtn();

	const toggleBtn = document.getElementById( 'llar-key-toggle' );
	if ( ! toggleBtn ) {
		return;
	}

	const iconOn = toggleBtn.querySelector( '.llar-key-icon:not(.llar-key-icon--off)' );
	const iconOff = toggleBtn.querySelector( '.llar-key-icon--off' );

	toggleBtn.addEventListener( 'click', function () {
		const reveal = 'password' === keyField.type;
		keyField.type = reveal ? 'text' : 'password';
		toggleBtn.setAttribute( 'aria-pressed', String( reveal ) );
		toggleBtn.setAttribute(
			'aria-label',
			reveal
				? ( CFG.i18n && CFG.i18n.hideKey || 'Hide site key' )
				: ( CFG.i18n && CFG.i18n.showKey || 'Show site key' )
		);
		if ( iconOn ) {
			iconOn.hidden = reveal;
		}
		if ( iconOff ) {
			iconOff.hidden = ! reveal;
		}
	} );
}
