/**
 * Scan results: fetches the verdicts for a finished job and renders them as
 * a file tree with the "suspicious only" filter.
 */
import { fetchJSON } from './ajax.js';
import { buildTree, renderNode } from './fileTree.js';

const resultsSection = document.querySelector( '.llar-results' );
const tree = resultsSection ? resultsSection.querySelector( '.llar-tree' ) : null;
const onlySuspicious = document.getElementById( 'llar-only-suspicious' );

export function loadResults( jobId ) {
	fetchJSON( 'security_scanner_results', { job_id: jobId } )
		.then( renderResults )
		.catch( function () {
			if ( resultsSection ) {
				resultsSection.hidden = false;
			}
		} );
}

export function renderResults( payload ) {
	if ( ! resultsSection || ! tree ) {
		return;
	}

	const rows = ( payload && payload.data && payload.data.results ) || [];
	window.__llarLastResults = rows;
	resultsSection.hidden = false;
	tree.innerHTML = '';

	const empty = resultsSection.querySelector( '.llar-empty' );
	if ( empty ) {
		empty.hidden = true;
	}

	if ( ! rows.length ) {
		if ( empty ) {
			empty.hidden = false;
		}
		return;
	}

	const showAll = ! onlySuspicious || ! onlySuspicious.checked;
	const visible = rows.filter( function ( row ) {
		return showAll || row.status !== 'clean';
	} );

	if ( ! visible.length ) {
		if ( empty ) {
			empty.hidden = false;
		}
		return;
	}

	const root = buildTree( visible );
	tree.appendChild( renderNode( root, '', true ) );
}

export function initResultsFilter() {
	if ( onlySuspicious ) {
		onlySuspicious.addEventListener( 'change', function () {
			if ( resultsSection && ! resultsSection.hidden ) {
				renderResults( { data: { results: window.__llarLastResults || [] } } );
			}
		} );
	}
}
