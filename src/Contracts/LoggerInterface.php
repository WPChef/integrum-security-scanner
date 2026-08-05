<?php
/**
 * Logger contract.
 *
 * @package Llar\SecurityScanner\Contracts
 */

declare( strict_types = 1 );

namespace Llar\SecurityScanner\Contracts;

interface LoggerInterface {

	public function debug( string $message, array $context = array() ): void;
	public function error( string $message, array $context = array() ): void;
}
