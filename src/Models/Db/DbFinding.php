<?php
/**
 * One database threat reported by Imunify Connect.
 *
 * @package Integrum\SecurityScanner\Models\Db
 */

declare( strict_types = 1 );

namespace Integrum\SecurityScanner\Models\Db;

/**
 * Immutable finding DTO for the admin UI.
 */
final class DbFinding {

	/**
	 * @param string $id           Threat id from API.
	 * @param string $table        Table name.
	 * @param string $column       Column name.
	 * @param string $row_id       Row id (string form).
	 * @param string $severity     Severity label.
	 * @param string $signature_id Signature / rule id.
	 * @param string $status       API status (e.g. detected).
	 * @param string $label        Human location label for UI.
	 * @param string $edit_url     Optional admin edit URL (posts).
	 */
	public function __construct(
		public readonly string $id,
		public readonly string $table,
		public readonly string $column,
		public readonly string $row_id,
		public readonly string $severity,
		public readonly string $signature_id,
		public readonly string $status,
		public readonly string $label,
		public readonly string $edit_url = ''
	) {
	}

	/**
	 * @return array<string, string>
	 */
	public function to_array(): array {
		return array(
			'id'           => $this->id,
			'table'        => $this->table,
			'column'       => $this->column,
			'row_id'       => $this->row_id,
			'severity'     => $this->severity,
			'signature_id' => $this->signature_id,
			'status'       => $this->status,
			'label'        => $this->label,
			'edit_url'     => $this->edit_url,
		);
	}
}
