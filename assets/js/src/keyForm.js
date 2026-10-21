/**
 * Key field behaviour: the connection form button reads "Register" while
 * the key field is empty and "Save key" once filled. The eye toggle reveals
 * the masked key and switches back on the second click. Registration requires
 * accepting the Terms of Service via the checkbox above the submit button.
 */
import { CFG } from './config.js';

export function initKeyForm() {
	const keyField = document.getElementById( 'iss-key' );
	const form = keyField && keyField.closest( 'form' );
	const keyBtn = document.getElementById( 'iss-key-submit' );
	const termsRow = document.getElementById( 'iss-terms-row' );
	const termsCheckbox = document.getElementById( 'iss-terms-agree' );
	// Every dotted-underline term label in the consent (Terms of Service,
	// Malware Scanning Terms, Privacy Policy) opens the same popup.
	const termsOpenBtns = document.querySelectorAll( '.iss-terms-open' );
	const termsDialog = document.getElementById( 'iss-terms-dialog' );
	const termsCloseBtn = termsDialog && termsDialog.querySelector( '.iss-terms-close' );

	if ( ! keyField || ! form || ! keyBtn ) {
		return;
	}

	function isRegisterMode() {
		return '' === keyField.value.trim();
	}

	function updateSubmitState() {
		if ( isRegisterMode() && termsCheckbox && ! termsCheckbox.checked ) {
			keyBtn.disabled = true;
			return;
		}
		keyBtn.disabled = false;
	}

	function updateKeyBtn() {
		keyBtn.textContent = keyField.value.trim()
			? ( CFG.i18n && CFG.i18n.saveKey || 'Save key' )
			: ( CFG.i18n && CFG.i18n.register || 'Register' );

		if ( termsRow ) {
			termsRow.hidden = ! isRegisterMode();
		}

		if ( termsCheckbox ) {
			termsCheckbox.required = isRegisterMode();
		}

		updateSubmitState();
	}

	keyField.addEventListener( 'input', updateKeyBtn );
	termsCheckbox && termsCheckbox.addEventListener( 'change', updateSubmitState );

	form.addEventListener( 'submit', function ( event ) {
		if ( isRegisterMode() && termsCheckbox && ! termsCheckbox.checked ) {
			event.preventDefault();
			return;
		}
		// Real submission: show "loadinfo" on the button while the request
		// is processed server-side and the page reloads. Deferred so disabling
		// the button can never cancel the navigation in any browser.
		window.setTimeout( function () {
			keyBtn.classList.add( 'is-loading' );
			keyBtn.disabled = true;
		}, 0 );
	} );

	updateKeyBtn();

	if ( termsOpenBtns.length && termsDialog && 'function' === typeof termsDialog.showModal ) {
		Array.prototype.forEach.call( termsOpenBtns, function ( btn ) {
			btn.addEventListener( 'click', function () {
				termsDialog.showModal();
			} );
		} );

		if ( termsCloseBtn ) {
			termsCloseBtn.addEventListener( 'click', function () {
				termsDialog.close();
			} );
		}

		termsDialog.addEventListener( 'click', function ( event ) {
			if ( event.target === termsDialog ) {
				termsDialog.close();
			}
		} );
	}

	const toggleBtn = document.getElementById( 'iss-key-toggle' );
	if ( ! toggleBtn ) {
		return;
	}

	const iconOn = toggleBtn.querySelector( '.iss-key-icon:not(.iss-key-icon--off)' );
	const iconOff = toggleBtn.querySelector( '.iss-key-icon--off' );

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
		// The icons are inline SVG: the `hidden` IDL property exists only on
		// HTMLElement, so the attribute must be toggled explicitly (and the
		// [hidden] rule for SVG is enforced in tailwind-src.css).
		if ( iconOn ) {
			reveal ? iconOn.setAttribute( 'hidden', '' ) : iconOn.removeAttribute( 'hidden' );
		}
		if ( iconOff ) {
			reveal ? iconOff.removeAttribute( 'hidden' ) : iconOff.setAttribute( 'hidden', '' );
		}
	} );
}
