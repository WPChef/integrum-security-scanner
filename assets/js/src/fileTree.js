/**
 * File-tree rendering, shared by the files-to-scan preview and the scan
 * results: groups rows into a nested tree and renders it as nested lists.
 */
import { CFG } from './config.js';

/**
 * Groups rows into a nested { children, files } tree by path segments.
 */
export function buildTree( rows ) {
	const root = { children: {}, files: [] };

	rows.forEach( function ( row ) {
		const parts = row.file_path.split( '/' );
		let node = root;

		for ( let i = 0; i < parts.length - 1; i++ ) {
			const seg = parts[ i ];
			node.children[ seg ] = node.children[ seg ] || { children: {}, files: [] };
			node = node.children[ seg ];
		}
		node.files.push( row );
	} );

	return root;
}

/**
 * Builds a <ul> for a tree node. Folders containing suspicious/infected
 * files are expanded by default so problems are immediately visible.
 */
export function renderNode( node, prefix, isRoot ) {
	const ul = document.createElement( 'ul' );
	ul.className = 'llar-tree__list' + ( isRoot ? ' is-root' : '' );

	Object.keys( node.children ).sort().forEach( function ( name ) {
		const child = node.children[ name ];
		const path = prefix ? prefix + '/' + name : name;
		const hasProblems = nodeHasProblems( child );

		const li = document.createElement( 'li' );
		li.className = 'llar-tree__folder';

		const toggle = document.createElement( 'span' );
		toggle.className = 'llar-tree__toggle';
		toggle.textContent = hasProblems ? '▾' : '▸';
		li.appendChild( toggle );

		const label = document.createElement( 'span' );
		label.className = 'llar-tree__folder-name' + ( hasProblems ? ' has-problems' : '' );
		label.textContent = path + '/';
		li.appendChild( label );

		const subtree = renderNode( child, path, false );
		subtree.hidden = ! hasProblems;
		li.appendChild( subtree );

		toggle.addEventListener( 'click', function () {
			subtree.hidden = ! subtree.hidden;
			toggle.textContent = subtree.hidden ? '▸' : '▾';
		} );

		ul.appendChild( li );
	} );

	node.files.sort( function ( a, b ) {
		return a.file_path < b.file_path ? -1 : 1;
	} ).forEach( function ( row ) {
		ul.appendChild( renderFile( row ) );
	} );

	return ul;
}

/**
 * Builds a <li> for a single scanned file.
 */
function renderFile( row ) {
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

	return li;
}

function fileStatusClass( row ) {
	if ( 'infected' === row.status ) {
		return ' is-infected';
	}
	return 'clean' !== row.status ? ' is-suspicious' : '';
}

function nodeHasProblems( node ) {
	for ( let i = 0; i < node.files.length; i++ ) {
		if ( 'clean' !== node.files[ i ].status ) {
			return true;
		}
	}
	for ( const name in node.children ) {
		if ( nodeHasProblems( node.children[ name ] ) ) {
			return true;
		}
	}
	return false;
}
