/**
 * Key field ↔ button label toggle: the connection form button reads
 * "Register" while the key field is empty and "Save key" once filled.
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
}
