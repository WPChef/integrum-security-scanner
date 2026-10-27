<?php
/**
 * ScanHistoryStorage tests.
 *
 * @package Integrum\SecurityScanner\Tests
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Tests;

use Integrum\SecurityScanner\Models\ScanHistoryStorage;
use Integrum\SecurityScanner\Models\ScanResult;
use PHPUnit\Framework\TestCase;

/**
 * Archived runs must keep the authoritative counters.
 */
final class ScanHistoryStorageTest extends TestCase {

	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['__llar_options'] = array();
	}

	protected function tearDown(): void {
		unset( $GLOBALS['__llar_options'] );
		parent::tearDown();
	}

	/**
	 * A completed scan archives with the scanner-provided counters: the
	 * per-file list is trimmed by the API once the job completes, so the
	 * row-derived counts under-report (the customer saw 0/0 for a 5k run).
	 */
	public function test_authoritative_counters_override_row_counts(): void {
		$storage = new ScanHistoryStorage();

		$record = $storage->record(
			'job-a',
			array(
				new ScanResult( '/clean.php', 'clean', '', 'low', null, array() ),
			),
			1700000000,
			5000,
			9
		);

		$this->assertSame( 5000, $record['scanned'] );
		$this->assertSame( 9, $record['problems'] );
	}

	/**
	 * Without overrides the counts still come from the rows.
	 */
	public function test_row_counts_without_overrides(): void {
		$storage = new ScanHistoryStorage();

		$record = $storage->record(
			'job-b',
			array(
				new ScanResult( '/clean.php', 'clean', '', 'low', null, array() ),
				new ScanResult( '/bad.php', 'infected', 'trojan', 'high', null, array() ),
			),
			1700000000
		);

		$this->assertSame( 2, $record['scanned'] );
		$this->assertSame( 1, $record['problems'] );
	}

	/**
	 * A job is archived once; a repeat record() returns the existing run.
	 */
	public function test_recording_is_idempotent_per_job(): void {
		$storage = new ScanHistoryStorage();

		$first  = $storage->record( 'job-c', array(), 1700000000, 10, 2 );
		$second = $storage->record( 'job-c', array(), 1700000900, 99, 99 );

		$this->assertSame( $first, $second );
		$this->assertCount( 1, $storage->all() );
	}
}
