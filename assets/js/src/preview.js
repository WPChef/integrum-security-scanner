/**
 * Files-to-scan preview: renders the scan scope on page load and refreshes
 * it (debounced) whenever the directory tree or the mask inputs change, so
 * the scope is visible before a job is started — not only afterwards as
 * scan results.
 */
import { CFG } from './config.js';
import { fetchJSON } from './ajax.js';
import { buildTree, renderNode } from './fileTree.js';

/**
 * @param {{getFlags: Function, getSelectedSlugs: Function}} treeApi Directory-tree state readers.
 * @return {{schedule: Function}} Debounced refresh trigger.
 */
export function initPreview( treeApi ) {
	const previewSection = document.querySelector( '.llar-preview' );
	if ( ! previewSection ) {
		return { schedule: function () {} };
	}

	const previewTree    = previewSection.querySelector( '.llar-preview__tree' );
	const previewCount   = previewSection.querySelector( '.llar-preview__count' );
	const previewEmpty   = previewSection.querySelector( '.llar-preview__empty' );
	const previewLoading = previewSection.querySelector( '.llar-preview__loading' );
	const includeInput   = document.getElementById( 'llar-include' );
	const excludeInput   = document.getElementById( 'llar-exclude' );
	const PREVIEW_DEBOUNCE_MS = 300;

	// Monotonic sequence: stale responses are dropped so a slow earlier
	// request can never overwrite the tree of a newer one.
	let previewSeq   = 0;
	let previewTimer = null;

	function renderPreview( payload ) {
		const files = ( payload && payload.data && payload.data.files ) || [];

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

		previewTree.innerHTML = '';
		if ( ! files.length ) {
			return;
		}

		// Preview rows carry no verdicts: render them as plain (clean) nodes.
		const rows = files.map( function ( f ) {
			return { file_path: f, status: 'clean' };
		} );
		previewTree.appendChild( renderNode( buildTree( rows ), '', true ) );
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

		fetchJSON( 'security_scanner_preview', {
			'security_scanner_directories[]': selected,
			'security_scanner_tree_on[]':     onFlags,
			'security_scanner_tree_off[]':    offFlags,
			security_scanner_include:         includeInput ? includeInput.value : '',
			security_scanner_exclude:         excludeInput ? excludeInput.value : '',
		} ).then( function ( payload ) {
			if ( seq !== previewSeq ) {
				return; // A newer request has already taken over.
			}
			renderPreview( payload );
		} ).catch( function () {
			if ( seq !== previewSeq ) {
				return;
			}
			if ( previewLoading ) {
				previewLoading.textContent = CFG.i18n ? CFG.i18n.error : 'error';
			}
		} );
	}

	function schedule() {
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

	schedule();

	return { schedule: schedule };
}
