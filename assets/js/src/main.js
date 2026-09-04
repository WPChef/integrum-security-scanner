/**
 * Composition root: wires the modules together in the original boot order.
 */
import { initKeyForm } from './keyForm.js';
import { initStopScan } from './stopScan.js';
import { initStartForm } from './startForm.js';
import { initDirTree } from './dirTree.js';
import { initPreview } from './preview.js';
import { initPolling } from './status.js';
import { initResultsFilter } from './results.js';
import { initNotices } from './notices.js';
import { refreshHistory } from './history.js';

initKeyForm();
initStopScan();
initStartForm();

// Directory tree ← preview: the tree reports toggles, the preview refreshes
// (debounced) with the new scope. The hoisted `notifyPreview` keeps the
// wiring order-independent, mirroring the previous onTreeChange hook.
let notifyPreview = function () {};
const treeApi = initDirTree( function () {
	notifyPreview();
} );
const previewApi = initPreview( treeApi );
notifyPreview = previewApi.schedule;

initResultsFilter();

const jobIdInput = document.querySelector( '.llar-job-id' );
if ( jobIdInput && jobIdInput.value ) {
	// A scan was just started (one-shot transient): poll it and keep the
	// progress bar in the visible area.
	initPolling( jobIdInput.value );
} else {
	// No active scan: surface any pending form notice instead.
	initNotices();
}
