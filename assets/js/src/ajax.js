/**
 * AJAX transport: POSTs an admin-ajax action as URL-encoded form data.
 *
 * Array values are appended once per item so PHP receives a real array.
 */
import { CFG } from './config.js';

export function fetchJSON( action, body ) {
	const data = new URLSearchParams();
	data.append( 'action', action );
	data.append( 'nonce', CFG.nonce );
	Object.keys( body || {} ).forEach( function ( k ) {
		const v = body[ k ];
		if ( Array.isArray( v ) ) {
			v.forEach( function ( item ) {
				data.append( k, item );
			} );
		} else {
			data.append( k, v );
		}
	} );

	return fetch( CFG.ajaxUrl, {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: data.toString(),
	} ).then( function ( r ) {
		return r.json();
	} );
}
