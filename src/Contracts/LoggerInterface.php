<?php
/**
 * Logger contract.
 *
 * @package Llar\Imunify\Contracts
 */

declare( strict_types = 1 );

namespace Llar\Imunify\Contracts;

interface LoggerInterface {

	public function debug( string $message, array $context = array() ): void;
	public function error( string $message, array $context = array() ): void;
}
