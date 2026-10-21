/**
 * Files-to-scan preview, attached to the unified directory tree: renders the
 * scan scope as per-file "pending" rows under their folders and refreshes
 * (debounced) whenever the directory tree or the mask inputs change, so the
 * scope is visible before a job is started — not only afterwards as scan
 * results. A refresh clears previous scan results first: their marks would
 * no longer describe the edited scope.
 */
import { CFG } from './config.js';
import { fetchJSON } from './ajax.js';
import { renderFile, dirname } from './fileTree.js';
import { materializeFolder } from './dirTree.js';
import { clearResults } from './results.js';

/**
 * @param {{getFlags: Function, getSelectedSlugs: Function}} treeApi Directory-tree state readers.
 * @return {{schedule: Function}} Debounced refresh trigger.
 */
export function initPreview( treeApi ) {
	const previewCount   = document.querySelector( '.iss-preview__count' );
	const previewEmpty   = document.querySelector( '.iss-preview__empty' );
	const previewLoading = document.querySelector( '.iss-preview__loading' );
	const treeOverlay    = document.querySelector( '.iss-tree-overlay' );
	const includeInput   = document.getElementById( 'iss-include' );
	const excludeInput   = document.getElementById( 'iss-exclude' );
	const PREVIEW_DEBOUNCE_MS = 300;

	// The preview is a full filesystem walk and must stay decoupled from the
	// connection flow: until a site key exists it never starts (on serial PHP
	// workers it would otherwise block the registration request itself).
	// '1'/'0' because wp_localize_script casts scalars to strings.
	const connected = CFG.hasKey === '1';

	// Monotonic sequence: stale responses are dropped so a slow earlier
	// request can never overwrite the tree of a newer one.
	let previewSeq   = 0;
	let previewTimer = null;

	/**
	 * Shows or hides the semi-transparent "loadinfo" layer over the tree.
	 *
	 * @param {boolean} on
	 */
	function setTreeOverlay( on ) {
		if ( treeOverlay ) {
			treeOverlay.classList.toggle( 'is-active', !! on );
		}
	}

	function renderPreview( payload ) {
		const files = ( payload && payload.data && payload.data.files ) || [];

		setTreeOverlay( false );
		if ( previewLoading ) {
			previewLoading.hidden = true;
		}
		if ( previewCount ) {
			previewCount.textContent = files.length + ' ' + ( 1 === files.length
				? ( CFG.i18n && CFG.i18n.file || 'file' )
				: ( CFG.i18n && CFG.i18n.files || 'files' ) );
		}
		if ( previewEmpty ) {
			previewEmpty.hidden = files.length > 0;
		}

		clearResults();

		// Group by folder first so each folder is materialised (and its
		// <ul> resolved) exactly once, then append its file rows.
		const byDir = {};
		files.forEach( function ( f ) {
			const dir = dirname( f );
			( byDir[ dir ] = byDir[ dir ] || [] ).push( f );
		} );

		Object.keys( byDir ).forEach( function ( dir ) {
			const folder = materializeFolder( dir );
			if ( ! folder ) {
				return;
			}
			const kids = folder.lastElementChild;
			if ( ! kids || 'UL' !== kids.tagName ) {
				return;
			}
			byDir[ dir ].forEach( function ( f ) {
				kids.appendChild( renderFile( { file_path: f, status: 'pending' } ) );
			} );
		} );
	}

	function loadPreview() {
		const seq = ++previewSeq;
		const onFlags = [];
		const offFlags = [];
		const flags = treeApi.getFlags();
		Object.keys( flags ).forEach( function ( rel ) {
			( flags[ rel ] ? onFlags : offFlags ).push( rel );
		} );
		const selected = treeApi.getSelectedSlugs();

		setTreeOverlay( true );

		fetchJSON( 'integrum_security_scanner_preview', {
			'integrum_security_scanner_directories[]': selected,
			'integrum_security_scanner_tree_on[]':     onFlags,
			'integrum_security_scanner_tree_off[]':    offFlags,
			integrum_security_scanner_include:         includeInput ? includeInput.value : '',
			integrum_security_scanner_exclude:         excludeInput ? excludeInput.value : '',
		} ).then( function ( payload ) {
			if ( seq !== previewSeq ) {
				return; // A newer request has already taken over.
			}
			renderPreview( payload );
		} ).catch( function () {
			if ( seq !== previewSeq ) {
				return;
			}
			setTreeOverlay( false );
			if ( previewLoading ) {
				previewLoading.textContent = CFG.i18n ? CFG.i18n.error : 'error';
			}
		} );
	}

	function schedule() {
		if ( ! connected ) {
			return; // Not registered yet: keep the tree idle (see `connected`).
		}
		if ( previewTimer ) {
			window.clearTimeout( previewTimer );
		}
		previewTimer = window.setTimeout( loadPreview, PREVIEW_DEBOUNCE_MS );
	}

	// Mask inputs refresh the preview too (debounced).
	if ( includeInput ) {
		includeInput.addEventListener( 'input', schedule );
	}
	if ( excludeInput ) {
		excludeInput.addEventListener( 'input', schedule );
	}

	// Without a site key there is no preview at all — hide the idle hint so
	// it does not read as a stuck "Loading…" state.
	if ( ! connected && previewLoading ) {
		previewLoading.hidden = true;
	}

	schedule();

	return { schedule: schedule };
}
