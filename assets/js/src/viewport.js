/**
 * Viewport helpers: bring important elements (notices, the progress bar)
 * into the visible area after actions, so feedback is never rendered
 * off-screen.
 */

/**
 * Scrolls an element into the visible area (no-op when absent).
 *
 * @param {Element|null} el Element to reveal.
 */
export function scrollIntoView( el ) {
	if ( ! el ) {
		return;
	}
	el.scrollIntoView( { behavior: 'smooth', block: 'center' } );
}

/**
 * Reveals a hidden section and scrolls it into view.
 *
 * @param {Element}  section Section element (has the `hidden` attribute).
 * @param {Element|null} target Optional element to scroll to inside the section.
 */
export function revealIntoView( section, target ) {
	if ( ! section ) {
		return;
	}
	section.hidden = false;
	scrollIntoView( target || section );
}
