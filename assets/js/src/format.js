/**
 * Value formatting for the progress label (bytes, durations).
 */

/**
 * Formats a byte count as a compact human-readable string.
 *
 * @param {number} bytes Bytes.
 * @return {string}
 */
export function formatBytes( bytes ) {
	if ( bytes < 1024 ) {
		return bytes + ' B';
	}
	const units = [ 'KB', 'MB', 'GB', 'TB' ];
	let value = bytes / 1024;
	let i = 0;
	while ( value >= 1024 && i < units.length - 1 ) {
		value /= 1024;
		++i;
	}
	return value.toFixed( value < 10 ? 1 : 0 ) + ' ' + units[ i ];
}

/**
 * Formats a duration in seconds as a compact human-readable string.
 *
 * @param {number} seconds Seconds.
 * @return {string}
 */
export function formatDuration( seconds ) {
	if ( seconds < 60 ) {
		return Math.round( seconds ) + 's';
	}
	if ( seconds < 3600 ) {
		return Math.round( seconds / 60 ) + ' min';
	}
	const h = Math.floor( seconds / 3600 );
	const m = Math.round( ( seconds % 3600 ) / 60 );
	return h + 'h ' + ( m > 0 ? m + 'm' : '' );
}
