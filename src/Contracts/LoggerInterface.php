<?php
/**
 * Logger contract.
 *
 * @package Integrum\SecurityScanner\Contracts
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Contracts;

interface LoggerInterface {

	public function debug( string $message, array $context = array() ): void;
	public function error( string $message, array $context = array() ): void;
}
