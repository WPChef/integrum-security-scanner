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
 * verdict, status + severity badges (each with a hover tooltip explaining
 * what to do), threat name and the raw-response detail block.
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

	const i18n = CFG.i18n || {};

	// Status chip (infected/suspicious/error) with an explanatory tooltip —
	// the label alone does not tell the user what to do with the file.
	// (Class intentionally differs from the .llar-status progress block.)
	if ( row.status && 'clean' !== row.status && 'pending' !== row.status ) {
		const st = document.createElement( 'span' );
		st.className = 'llar-verdict llar-verdict--' + row.status + ' llar-tip';
		st.textContent = ( i18n.statusLabels && i18n.statusLabels[ row.status ] ) || row.status;
		st.tabIndex = 0;
		const stHint = ( i18n.statusHints && i18n.statusHints[ row.status ] ) || '';
		if ( stHint ) {
			st.dataset.tip = stHint;
		}
		li.appendChild( st );
	}

	if ( row.severity ) {
		const sev = document.createElement( 'span' );
		sev.className = 'llar-sev llar-sev--' + row.severity + ' llar-tip';
		sev.textContent = ( i18n.severity && i18n.severity[ row.severity ] ) || row.severity;
		sev.tabIndex = 0;
		const sevHint = ( i18n.severityHints && i18n.severityHints[ row.severity ] ) || '';
		if ( sevHint ) {
			sev.dataset.tip = sevHint;
		}
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
