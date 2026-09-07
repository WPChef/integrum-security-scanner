/**
 * Scan results, rendered into the directory selector tree (unified tree):
 * every scanned file becomes a row under its folder, and every folder with
 * scanned files gets a badge summarising its subtree — ⚠ N for findings,
 * ✓ N for clean. Folders with findings are expanded automatically so the
 * problems are visible without extra clicks.
 */
import { fetchJSON } from './ajax.js';
import { renderFile, dirname } from './fileTree.js';
import { materializeFolder } from './dirTree.js';

const treeEl = document.querySelector( '.llar-dirtree' );
const filterWrap = document.getElementById( 'llar-only-suspicious-wrap' );
const onlySuspicious = document.getElementById( 'llar-only-suspicious' );

/**
 * Fetches the verdicts for a finished job and attaches them to the tree.
 * Resolves with the result rows (empty on failure) so the caller can build
 * its own completion summary from the counts.
 *
 * @param {string} jobId Job id.
 * @return {Promise<Array<{file_path: string, status: string}>>}
 */
export function loadResults( jobId ) {
	return fetchJSON( 'site_integrity_scanner_results', { job_id: jobId } )
		.then( function ( payload ) {
			const rows = ( payload && payload.data && payload.data.results ) || [];
			attachResults( rows );
			return rows;
		} )
		.catch( function () {
			return [];
		} );
}

/**
 * Removes every result mark from the tree (file rows, badges, highlighting)
 * and hides the filter. Called before results attach and whenever the scan
 * scope is edited (the marks would no longer describe it).
 */
export function clearResults() {
	if ( ! treeEl ) {
		return;
	}
	treeEl.classList.remove( 'is-complete' );
	Array.prototype.forEach.call( treeEl.querySelectorAll( '.llar-tree__file' ), function ( el ) {
		el.remove();
	} );
	Array.prototype.forEach.call( treeEl.querySelectorAll( '.llar-node-badge' ), function ( el ) {
		el.remove();
	} );
	Array.prototype.forEach.call( treeEl.querySelectorAll( '.llar-tree__folder-name.has-problems' ), function ( el ) {
		el.classList.remove( 'has-problems' );
	} );
	if ( filterWrap ) {
		filterWrap.hidden = true;
	}
	window.__llarLastResults = [];
}

/**
 * Attaches result rows to the tree and marks the scanned folders.
 *
 * @param {Array<{file_path: string, status: string}>} rows Result rows.
 */
export function attachResults( rows ) {
	if ( ! treeEl ) {
		return;
	}

	clearResults();
	window.__llarLastResults = rows;

	// Per-folder subtree counters: rel => { scanned, alert, infected }.
	const stats = {};

	rows.forEach( function ( row ) {
		const dir = dirname( row.file_path );
		const bad = 'clean' !== row.status;
		const infected = 'infected' === row.status;

		const folder = materializeFolder( dir );
		if ( folder ) {
			const kids = folder.lastElementChild;
			if ( kids && 'UL' === kids.tagName ) {
				kids.appendChild( renderFile( row ) );
			}
		}

		// Charge the file against its folder and every ancestor.
		const segs = dir ? dir.split( '/' ) : [];
		for ( let i = 0; i <= segs.length; i++ ) {
			const rel = segs.slice( 0, i ).join( '/' );
			stats[ rel ] = stats[ rel ] || { scanned: 0, alert: 0, infected: 0 };
			++stats[ rel ].scanned;
			if ( bad ) {
				++stats[ rel ].alert;
			}
			if ( infected ) {
				++stats[ rel ].infected;
			}
		}
	} );

	Object.keys( stats ).forEach( function ( rel ) {
		const folder = materializeFolder( rel );
		if ( ! folder ) {
			return;
		}
		addBadge( folder, stats[ rel ] );
		if ( stats[ rel ].alert > 0 ) {
			markProblems( folder );
			expandChain( folder );
		}
	} );

	treeEl.classList.add( 'is-complete' );
	if ( filterWrap && rows.length ) {
		filterWrap.hidden = false;
	}
	applyFilter();
}

/**
 * Adds the summary badge to a folder row (before its child list, so the list
 * stays the last element the tree wiring relies on).
 *
 * @param {Element}                            folder Folder <li>.
 * @param {{scanned: number, alert: number, infected: number}} s Subtree counters.
 */
function addBadge( folder, s ) {
	const kids = folder.lastElementChild;
	if ( ! kids || 'UL' !== kids.tagName ) {
		return;
	}

	const badge = document.createElement( 'span' );
	if ( s.alert > 0 ) {
		badge.className = 'llar-node-badge llar-node-badge--alert' +
			( s.infected > 0 ? ' llar-node-badge--infected' : '' );
		badge.textContent = '⚠ ' + s.alert;
		badge.title = s.alert + ' suspicious/infected file(s) in this subtree';
	} else {
		badge.className = 'llar-node-badge llar-node-badge--ok';
		badge.textContent = '✓ ' + s.scanned;
		badge.title = s.scanned + ' file(s) scanned, all clean';
	}
	folder.insertBefore( badge, kids );
}

/**
 * Highlights a folder row containing findings.
 *
 * @param {Element} folder Folder <li>.
 */
function markProblems( folder ) {
	const name = folder.querySelector( ':scope > .llar-dirtree__label .llar-tree__folder-name' );
	if ( name ) {
		name.classList.add( 'has-problems' );
	}
}

/**
 * Expands the folder itself and all its ancestors (used for folders with
 * findings, so problems are immediately visible).
 *
 * @param {Element} folder Folder <li>.
 */
function expandChain( folder ) {
	// Reveal the folder's own rows first…
	const kids = folder.lastElementChild;
	if ( kids && 'UL' === kids.tagName ) {
		kids.hidden = false;
		const ownToggle = folder.querySelector( ':scope > .llar-tree__toggle' );
		if ( ownToggle ) {
			ownToggle.textContent = '▾';
		}
	}

	// …then every ancestor list so the folder itself is reachable.
	let el = folder;
	while ( el && el !== treeEl ) {
		if ( 'UL' === el.tagName && el.classList.contains( 'llar-tree__list' ) ) {
			el.hidden = false;
			const owner = el.parentElement;
			const toggle = owner && owner.querySelector( ':scope > .llar-tree__toggle' );
			if ( toggle ) {
				toggle.textContent = '▾';
			}
		}
		el = el.parentElement;
	}
}

/**
 * Applies the "suspicious only" filter to the attached result rows.
 * Pending (not yet scanned) preview rows are never hidden by it.
 *
 * When the filter is switched off, the folders holding result rows are
 * expanded: most of them are collapsed after the scan (only folders with
 * findings auto-expand), so without this the clean files would stay
 * invisible and the checkbox would look like a no-op.
 */
export function applyFilter() {
	if ( ! treeEl ) {
		return;
	}
	const hide = ! onlySuspicious || onlySuspicious.checked;
	const folders = [];
	Array.prototype.forEach.call( treeEl.querySelectorAll( '.llar-tree__file' ), function ( el ) {
		el.hidden = hide && el.classList.contains( 'is-clean' );
		if ( ! hide ) {
			const list = el.parentElement;
			if ( list && 'UL' === list.tagName && folders.indexOf( list ) === -1 ) {
				folders.push( list );
			}
		}
	} );
	folders.forEach( function ( list ) {
		if ( list.parentElement ) {
			expandChain( list.parentElement );
		}
	} );
}

export function initResultsFilter() {
	if ( onlySuspicious ) {
		onlySuspicious.addEventListener( 'change', applyFilter );
	}
}
