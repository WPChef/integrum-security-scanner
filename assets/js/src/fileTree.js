/**
 * File-row rendering, shared by the files-to-scan preview and the scan
 * results: both attach per-file rows to the unified directory tree
 * (assets/js/src/dirTree.js owns the folder rows).
 */
import { CFG } from './config.js';

/**
 * Builds a <li> for a single file row.
 *
 * Preview rows use status 'pending' (muted); result rows carry the Imunify
 * verdict, severity badge, threat name and the raw-response detail block.
 *
 * @param {{file_path: string, status: string, severity?: string, threat_type?: string, detail?: Object}} row File row.
 * @return {Element}
 */
export function renderFile( row ) {
	const li = document.createElement( 'li' );
	li.className = 'llar-tree__file' + fileStatusClass( row );

	const name = row.file_path.split( '/' ).pop();
	const nameEl = document.createElement( 'span' );
	nameEl.className = 'llar-tree__file-name';
	nameEl.textContent = name;
	nameEl.title = row.file_path;
	li.appendChild( nameEl );

	if ( row.severity ) {
		const sev = document.createElement( 'span' );
		sev.className = 'llar-sev llar-sev--' + row.severity;
		const labels = ( CFG.i18n && CFG.i18n.severity ) || {};
		sev.textContent = labels[ row.severity ] || row.severity;
		li.appendChild( sev );
	}

	if ( row.threat_type ) {
		const t = document.createElement( 'em' );
		t.className = 'llar-tree__threat';
		t.textContent = row.threat_type;
		li.appendChild( t );
	}

	if ( row.detail && Object.keys( row.detail ).length ) {
		li.appendChild( buildDetail( row.detail ) );
	}

	return li;
}

/**
 * Directory part of a relative file path ('' for site root).
 *
 * @param {string} path Relative file path.
 * @return {string}
 */
export function dirname( path ) {
	const idx = path.lastIndexOf( '/' );
	return -1 === idx ? '' : path.slice( 0, idx );
}

/**
 * Builds the expandable raw-Imunify-response block for a file row.
 *
 * @param {Object<string, string>} detail Raw response fields.
 */
function buildDetail( detail ) {
	const wrap = document.createElement( 'span' );
	wrap.className = 'llar-file-detail';

	const btn = document.createElement( 'button' );
	btn.type = 'button';
	btn.className = 'llar-file-detail__toggle';
	btn.textContent = 'ⓘ';
	btn.title = 'Imunify response';
	btn.setAttribute( 'aria-expanded', 'false' );
	wrap.appendChild( btn );

	const panel = document.createElement( 'span' );
	panel.className = 'llar-file-detail__panel';
	panel.hidden = true;
	Object.keys( detail ).forEach( function ( key ) {
		const item = document.createElement( 'span' );
		item.className = 'llar-file-detail__item';
		const k = document.createElement( 'em' );
		k.textContent = key + ':';
		const v = document.createElement( 'code' );
		v.textContent = detail[ key ];
		item.appendChild( k );
		item.appendChild( v );
		panel.appendChild( item );
	} );
	wrap.appendChild( panel );

	btn.addEventListener( 'click', function () {
		panel.hidden = ! panel.hidden;
		btn.setAttribute( 'aria-expanded', String( ! panel.hidden ) );
	} );

	return wrap;
}

function fileStatusClass( row ) {
	if ( 'infected' === row.status ) {
		return ' is-infected';
	}
	if ( 'pending' === row.status ) {
		return ' is-pending';
	}
	return 'clean' !== row.status ? ' is-suspicious' : ' is-clean';
}
