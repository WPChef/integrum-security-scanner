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
	const previewCount   = document.querySelector( '.llar-preview__count' );
	const previewEmpty   = document.querySelector( '.llar-preview__empty' );
	const previewLoading = document.querySelector( '.llar-preview__loading' );
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

		fetchJSON( 'site_integrity_scanner_preview', {
			'site_integrity_scanner_directories[]': selected,
			'site_integrity_scanner_tree_on[]':     onFlags,
			'site_integrity_scanner_tree_off[]':    offFlags,
			site_integrity_scanner_include:         includeInput ? includeInput.value : '',
			site_integrity_scanner_exclude:         excludeInput ? excludeInput.value : '',
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
