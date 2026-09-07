/**
 * Directory selector tree: nested folders with cascading checkboxes.
 *
 * Checking a folder checks its whole subtree; unchecking a subfolder clears
 * its parent (shown as an indeterminate dash). Deeper levels load lazily via
 * the dirchildren endpoint.
 *
 * State model: `flags` maps a relative path to an explicit toggle. The
 * nearest flag wins (self first, then ancestors); absent = checked, so the
 * default is all-on.
 */
import { fetchJSON } from './ajax.js';

const dirTreeEl = document.querySelector( '.llar-dirtree' );
let treeFlags = {};
/** When true, directory checkboxes cannot be unchecked (active scan). */
let dirTreeLocked = false;
// Wiring hooks set by initDirTree() so materializeFolder() can register
// synthetic rows with the same cascade/lazy-load handlers (null until init).
let registerRowRef = null;
let syncAllRef = null;

if ( dirTreeEl ) {
	try {
		treeFlags = JSON.parse( dirTreeEl.getAttribute( 'data-flags' ) || '{}' ) || {};
	} catch ( e ) {
		treeFlags = {};
	}
}

/**
 * Locks or unlocks unchecking directory toggles while a scan is running.
 *
 * @param {boolean} locked
 */
export function setDirTreeLocked( locked ) {
	dirTreeLocked = !! locked;
}

/**
 * Effective checked state of a tree node (nearest explicit flag wins).
 */
function treeEffective( rel ) {
	const segs = rel ? rel.split( '/' ) : [];
	for ( let i = segs.length; i >= 0; i-- ) {
		const prefix = segs.slice( 0, i ).join( '/' );
		if ( Object.prototype.hasOwnProperty.call( treeFlags, prefix ) ) {
			return !! treeFlags[ prefix ];
		}
	}
	return true;
}

/**
 * True when a flag with the given value exists strictly below $rel.
 */
function treeHasFlagBelow( rel, value ) {
	return Object.keys( treeFlags ).some( function ( k ) {
		const below = '' === rel ? '' !== k : 0 === k.indexOf( rel + '/' );
		return below && treeFlags[ k ] === value;
	} );
}

/**
 * Wires the tree UI. `onChange` fires after every toggle (the preview hooks
 * its debounced refresh here).
 *
 * @return {{getFlags: Function, getSelectedSlugs: Function}} Tree state readers.
 */
export function initDirTree( onChange ) {
	if ( ! dirTreeEl ) {
		return {
			getFlags: function () {
				return {};
			},
			getSelectedSlugs: function () {
				return [];
			},
		};
	}

	const notify = 'function' === typeof onChange ? onChange : function () {};
	const flagsContainer = dirTreeEl.querySelector( '.llar-tree-flags' );
	const startBtn = document.querySelector( '.llar-scan-actions__start' );
	// Only manage the Start button when the server did not disable it
	// (no key / running job) and no poller is active.
	const guardAllowed = startBtn ? ! startBtn.disabled : false;

	/**
	 * Sets one explicit toggle, pruning descendant flags (a fresh toggle
	 * overrides everything below) and dropping no-op flags.
	 */
	function treeSetFlag( rel, value ) {
		Object.keys( treeFlags ).forEach( function ( k ) {
			if ( '' === rel || 0 === k.indexOf( rel + '/' ) ) {
				delete treeFlags[ k ];
			}
		} );

		const parent = rel ? rel.split( '/' ).slice( 0, -1 ).join( '/' ) : null;
		const inherited = null === parent ? true : treeEffective( parent );
		if ( inherited === value ) {
			delete treeFlags[ rel ];
		} else {
			treeFlags[ rel ] = value;
		}
	}

	function syncRow( row ) {
		const rel = row.getAttribute( 'data-rel' ) || '';
		const input = row.children[ 1 ] && row.children[ 1 ].querySelector( 'input[type="checkbox"]' );
		if ( ! input ) {
			return;
		}
		const eff = treeEffective( rel );
		const mixed = treeHasFlagBelow( rel, ! eff );
		// A mixed subtree shows no checkmark (dash); only a fully-checked
		// subtree keeps the parent checked.
		input.checked = eff && ! mixed;
		input.indeterminate = mixed;
	}

	function syncAll() {
		Array.prototype.forEach.call(
			dirTreeEl.querySelectorAll( '.llar-dirtree__node' ),
			syncRow
		);
	}

	function syncHidden() {
		if ( ! flagsContainer ) {
			return;
		}
		flagsContainer.innerHTML = '';
		Object.keys( treeFlags ).forEach( function ( rel ) {
			const input = document.createElement( 'input' );
			input.type = 'hidden';
			input.name = treeFlags[ rel ] ? 'site_integrity_scanner_tree_on[]' : 'site_integrity_scanner_tree_off[]';
			input.value = rel;
			flagsContainer.appendChild( input );
		} );
	}

	function updateStartGuard() {
		if ( ! startBtn || ! guardAllowed ) {
			return;
		}
		// Nothing will be scanned when the root is off and nothing is
		// explicitly re-checked.
		const rootOff = ! treeEffective( '' );
		const anyOn = Object.keys( treeFlags ).some( function ( k ) {
			return treeFlags[ k ] === true;
		} );
		startBtn.disabled = rootOff && ! anyOn;
	}

	function onRowToggle( rel, checked ) {
		treeSetFlag( rel, checked );
		syncAll();
		syncHidden();
		updateStartGuard();
		notify();
	}

	function buildChildRow( child ) {
		const li = document.createElement( 'li' );
		li.className = 'llar-tree__folder llar-dirtree__node';
		li.setAttribute( 'data-rel', child.rel );

		const toggle = document.createElement( 'span' );
		toggle.className = 'llar-tree__toggle';
		toggle.textContent = child.has_children ? '▸' : ' ';
		li.appendChild( toggle );

		const label = document.createElement( 'label' );
		label.className = 'llar-dirtree__label inline-flex cursor-pointer items-center gap-2';

		const input = document.createElement( 'input' );
		input.type = 'checkbox';
		input.className = 'rounded border-slate-300 text-primary-600 focus:ring-primary-500';
		if ( child.slug ) {
			input.name = 'site_integrity_scanner_directories[]';
			input.value = child.slug;
		}
		label.appendChild( input );

		const name = document.createElement( 'span' );
		name.className = 'llar-tree__folder-name';
		name.textContent = child.name + '/';
		label.appendChild( name );

		li.appendChild( label );

		const kids = document.createElement( 'ul' );
		kids.className = 'llar-tree__list';
		kids.hidden = true;
		li.appendChild( kids );

		return li;
	}

	function registerRow( row ) {
		const rel = row.getAttribute( 'data-rel' ) || '';
		const label = row.children[ 1 ];
		const input = label && label.querySelector( 'input[type="checkbox"]' );
		const toggle = row.children[ 0 ];
		const kids = row.lastElementChild && 'UL' === row.lastElementChild.tagName ? row.lastElementChild : null;

		if ( input ) {
			input.addEventListener( 'click', function ( event ) {
				// Checked → unchecked is blocked for the scan duration; checking
				// and indeterminate → checked remain allowed.
				if ( dirTreeLocked && input.checked ) {
					event.preventDefault();
				}
			} );
			input.addEventListener( 'change', function () {
				// Revert checked → unchecked while locked: preventDefault on click
				// is not reliable for every input path (e.g. label / programmatic).
				if ( dirTreeLocked && ! input.checked ) {
					syncRow( row );
					syncHidden();
					return;
				}
				onRowToggle( rel, input.checked );
			} );
		}

		if ( toggle && kids ) {
			toggle.addEventListener( 'click', function () {
				if ( kids.dataset.loaded ) {
					kids.hidden = ! kids.hidden;
					toggle.textContent = kids.hidden ? '▸' : '▾';
					return;
				}

				toggle.textContent = '▾';
				kids.dataset.loaded = '1';
				kids.hidden = false;

				fetchJSON( 'site_integrity_scanner_dirchildren', { rel: rel } ).then( function ( payload ) {
					const children = ( payload && payload.data && payload.data.children ) || [];
					children.forEach( function ( child ) {
						// Skip folders already present: the preview/results renderer
						// may have materialised them as synthetic rows before this
						// lazy load ran — re-adding them would duplicate the row.
						if ( kids.querySelector( ':scope > .llar-dirtree__node[data-rel="' + cssEscape( child.rel ) + '"]' ) ) {
							return;
						}
						const childRow = buildChildRow( child );
						// Folder rows stay above file rows already attached by the
						// results renderer (unified tree).
						const firstFile = kids.querySelector( ':scope > .llar-tree__file' );
						if ( firstFile ) {
							kids.insertBefore( childRow, firstFile );
						} else {
							kids.appendChild( childRow );
						}
						registerRow( childRow );
					} );
					syncAll();
				} ).catch( function () {
					kids.hidden = true;
					toggle.textContent = '▸';
					delete kids.dataset.loaded;
				} );
			} );
		}
	}

	Array.prototype.forEach.call( dirTreeEl.querySelectorAll( '.llar-dirtree__node' ), registerRow );
	syncAll();
	syncHidden();
	updateStartGuard();

	registerRowRef = registerRow;
	syncAllRef = syncAll;

	return {
		/** @return {Object<string, boolean>} Explicit toggles (rel path => checked). */
		getFlags: function () {
			return treeFlags;
		},
		/** @return {string[]} Checked legacy slug checkboxes (no-JS fallback values). */
			getSelectedSlugs: function () {
				return Array.prototype.slice
					.call( dirTreeEl.querySelectorAll( 'input[name="site_integrity_scanner_directories[]"]' ) )
					.filter( function ( cb ) {
						return cb.checked;
					} )
					.map( function ( cb ) {
						return cb.value;
					} );
			},
		};
	}

	/**
	 * Ensures the folder chain for a relative path exists in the tree and returns
	 * its <li>. Missing folders (deeper than the lazily loaded levels) are
	 * created as synthetic rows with an unnamed checkbox and wired like regular
	 * rows. Returns null when the tree is absent.
	 *
	 * @param {string} rel Relative directory path ('' = site root).
	 * @return {Element|null}
	 */
	export function materializeFolder( rel ) {
		if ( ! dirTreeEl ) {
			return null;
		}

		const root = dirTreeEl.querySelector( '.llar-dirtree__node[data-rel=""]' );
		if ( ! root ) {
			return null;
		}
		if ( ! rel ) {
			return root;
		}

		const segs = rel.split( '/' );
		let node = root;
		let prefix = '';

		for ( let i = 0; i < segs.length; i++ ) {
			const seg = segs[ i ];
			prefix = prefix ? prefix + '/' + seg : seg;
			const kids = node.lastElementChild && 'UL' === node.lastElementChild.tagName ? node.lastElementChild : null;
			if ( ! kids ) {
				return null;
			}

			let li = kids.querySelector( ':scope > .llar-dirtree__node[data-rel="' + cssEscape( prefix ) + '"]' );
			if ( ! li ) {
				li = buildSyntheticRow( prefix, seg, kids );
			}
			node = li;
		}

		return node;
	}

	/**
	 * Creates and registers a folder row the tree has not loaded lazily yet.
	 *
	 * @param {string} rel   Relative path.
	 * @param {string} name  Folder name segment.
	 * @param {Element} kids Parent <ul> to append to.
	 * @return {Element} The new <li>.
	 */
	function buildSyntheticRow( rel, name, kids ) {
		const li = document.createElement( 'li' );
		li.className = 'llar-tree__folder llar-dirtree__node';
		li.setAttribute( 'data-rel', rel );

		const toggle = document.createElement( 'span' );
		toggle.className = 'llar-tree__toggle';
		toggle.textContent = '▸';
		li.appendChild( toggle );

		const label = document.createElement( 'label' );
		label.className = 'llar-dirtree__label inline-flex cursor-pointer items-center gap-2';

		// No slug: the checkbox is cosmetic (JS-driven scope), matching the
		// server-rendered rows whose folder is not a registered scan option.
		const input = document.createElement( 'input' );
		input.type = 'checkbox';
		input.className = 'rounded border-slate-300 text-primary-600 focus:ring-primary-500';
		label.appendChild( input );

		const nameEl = document.createElement( 'span' );
		nameEl.className = 'llar-tree__folder-name';
		nameEl.textContent = name + '/';
		label.appendChild( nameEl );

		li.appendChild( label );

		const sub = document.createElement( 'ul' );
		sub.className = 'llar-tree__list';
		sub.hidden = true;
		li.appendChild( sub );

		// Folder rows stay above any attached file rows.
		const firstFile = kids.querySelector( ':scope > .llar-tree__file' );
		if ( firstFile ) {
			kids.insertBefore( li, firstFile );
		} else {
			kids.appendChild( li );
		}

		if ( registerRowRef ) {
			registerRowRef( li );
		}
		if ( syncAllRef ) {
			syncAllRef();
		}
		return li;
	}

	/**
	 * Escapes a path segment for use in an attribute selector.
	 *
	 * @param {string} value Raw value.
	 * @return {string}
	 */
	function cssEscape( value ) {
		return window.CSS && CSS.escape ? CSS.escape( value ) : value.replace( /"/g, '\\"' );
	}
