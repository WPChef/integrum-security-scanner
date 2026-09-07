/**
 * Scan history table: the server renders the finished runs at the bottom of
 * the page; this module owns the interactions —
 *   - clicking a row lazily fetches the run's problem files (one AJAX call,
 *     cached) and expands them as a directory tree below the row;
 *   - refreshHistory() re-renders the tbody after a scan finished in this
 *     page view, so the table shows the new run without a reload.
 *
 * Row markup is built here (not in PHP) for the refresh path, so the table
 * cells are styled via the .llar-history__* classes in the stylesheet, not
 * Tailwind utilities that only exist in the server-rendered page.
 */
import { CFG } from './config.js';
import { fetchJSON } from './ajax.js';
import { renderFile, dirname } from './fileTree.js';

const bodyEl = document.querySelector( '.llar-history__body' );
const emptyEl = document.querySelector( '.llar-history__empty' );

let runsCache = null;
let fetchPromise = null;

/**
 * Loads the history runs (single shared request).
 *
 * @return {Promise<Array<{job_id: string, date: string, problems: number, scanned: number, files: Array<{file_path: string, status: string}>}>>}
 */
function fetchRuns() {
	if ( runsCache ) {
		return Promise.resolve( runsCache );
	}
	if ( ! fetchPromise ) {
		fetchPromise = fetchJSON( 'site_integrity_scanner_history', {} )
			.then( function ( payload ) {
				fetchPromise = null;
				runsCache = ( payload && payload.data && payload.data.runs ) || [];
				return runsCache;
			} )
			.catch( function () {
				fetchPromise = null;
				return [];
			} );
	}
	return fetchPromise;
}

/**
 * Re-fetches the history and re-renders the table body (called after a scan
 * completes in this page view).
 */
export function refreshHistory() {
	if ( ! bodyEl ) {
		return;
	}
	runsCache = null;
	fetchRuns().then( renderRuns );
}

/**
 * Replaces the table body with the given runs.
 *
 * @param {Array<{job_id: string, date: string, problems: number, scanned: number}>} runs History runs.
 */
function renderRuns( runs ) {
	bodyEl.textContent = '';
	runs.forEach( function ( run ) {
		bodyEl.appendChild( buildRunRows( run ) );
	} );
	if ( emptyEl ) {
		emptyEl.hidden = runs.length > 0;
	}
}

/**
 * Builds the clickable summary row + the hidden detail row for one run.
 *
 * @param {Object} run History run.
 * @return {DocumentFragment}
 */
function buildRunRows( run ) {
	const frag = document.createDocumentFragment();

	const row = document.createElement( 'tr' );
	row.className = 'llar-history__row';
	row.dataset.job = run.job_id;
	row.setAttribute( 'aria-expanded', 'false' );

	const dateTd = document.createElement( 'td' );
	dateTd.className = 'llar-history__td';
	dateTd.textContent = run.date;
	row.appendChild( dateTd );

	const problemsTd = document.createElement( 'td' );
	problemsTd.className = 'llar-history__td';
	const count = document.createElement( 'span' );
	count.className = 'llar-history__count' +
		( run.problems > 0 ? ' llar-history__count--alert' : ' llar-history__count--ok' );
	count.textContent = String( run.problems );
	problemsTd.appendChild( count );
	row.appendChild( problemsTd );

	const scannedTd = document.createElement( 'td' );
	scannedTd.className = 'llar-history__td llar-history__td--muted';
	scannedTd.textContent = String( run.scanned );
	row.appendChild( scannedTd );
	frag.appendChild( row );

	const detail = document.createElement( 'tr' );
	detail.className = 'llar-history__detail';
	detail.hidden = true;
	const detailTd = document.createElement( 'td' );
	detailTd.colSpan = 3;
	detailTd.className = 'llar-history__detail-td';
	const tree = document.createElement( 'div' );
	tree.className = 'llar-tree llar-history__tree';
	tree.dataset.job = run.job_id;
	detailTd.appendChild( tree );
	detail.appendChild( detailTd );
	frag.appendChild( detail );

	return frag;
}

/**
 * Builds the problem-file tree for a run: folders mirror the file paths,
 * every leaf is a standard file row (badges and tooltips included).
 *
 * @param {Array<{file_path: string, status: string}>} files Problem files.
 * @return {Element}
 */
function buildTree( files ) {
	const root = document.createElement( 'ul' );
	root.className = 'llar-tree__list is-root';
	const lists = { '': root };

	if ( ! files.length ) {
		const li = document.createElement( 'li' );
		li.className = 'llar-history__no-files';
		li.textContent = ( CFG.i18n && CFG.i18n.historyClean ) || 'No problem files in this scan.';
		root.appendChild( li );
		return root;
	}

	/**
	 * Returns the <ul> for a directory, creating every missing folder node
	 * on the way from the root.
	 *
	 * @param {string} rel Relative directory path ('' = tree root).
	 * @return {Element}
	 */
	function folderList( rel ) {
		if ( lists[ rel ] ) {
			return lists[ rel ];
		}

		const segs = rel.split( '/' );
		const li = document.createElement( 'li' );
		li.className = 'llar-tree__folder';
		li.dataset.rel = rel;

		const toggle = document.createElement( 'span' );
		toggle.className = 'llar-tree__toggle';
		toggle.textContent = '▾';

		const name = document.createElement( 'span' );
		name.className = 'llar-tree__folder-name';
		name.textContent = segs[ segs.length - 1 ] + '/';

		li.appendChild( toggle );
		li.appendChild( name );

		const ul = document.createElement( 'ul' );
		ul.className = 'llar-tree__list';
		li.appendChild( ul );

		folderList( segs.slice( 0, -1 ).join( '/' ) ).appendChild( li );

		toggle.addEventListener( 'click', function () {
			ul.hidden = ! ul.hidden;
			toggle.textContent = ul.hidden ? '▸' : '▾';
		} );

		lists[ rel ] = ul;
		return ul;
	}

	files.forEach( function ( file ) {
		folderList( dirname( file.file_path ) ).appendChild( renderFile( file ) );
	} );

	return root;
}

/**
 * Populates a run's tree container on first expand.
 *
 * @param {Element} detail The detail row.
 * @return {Promise<void>}
 */
function ensureTree( detail ) {
	const treeEl = detail.querySelector( '.llar-history__tree' );
	if ( ! treeEl || treeEl.childElementCount ) {
		return Promise.resolve();
	}

	treeEl.textContent = ( CFG.i18n && CFG.i18n.historyLoading ) || 'Loading…';
	return fetchRuns().then( function ( runs ) {
		const run = runs.filter( function ( r ) {
			return r.job_id === treeEl.dataset.job;
		} )[ 0 ] || null;
		treeEl.textContent = '';
		treeEl.appendChild( buildTree( run ? run.files : [] ) );
	} );
}

if ( bodyEl ) {
	bodyEl.addEventListener( 'click', function ( event ) {
		const row = event.target.closest ? event.target.closest( '.llar-history__row' ) : null;
		if ( ! row ) {
			return;
		}
		const detail = row.nextElementSibling;
		if ( ! detail || ! detail.classList.contains( 'llar-history__detail' ) ) {
			return;
		}

		if ( detail.hidden ) {
			ensureTree( detail ).then( function () {
				detail.hidden = false;
				row.setAttribute( 'aria-expanded', 'true' );
			} );
		} else {
			detail.hidden = true;
			row.setAttribute( 'aria-expanded', 'false' );
		}
	} );
}
