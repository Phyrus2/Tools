SET @pending_handler_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_pending'
      AND COLUMN_NAME = 'handled_by'
);

SET @add_pending_handler_sql = IF(
    @pending_handler_exists = 0,
    'ALTER TABLE contract_pending ADD COLUMN handled_by INT NULL AFTER claimed_at, ADD INDEX idx_contract_pending_handler (handled_by), ADD CONSTRAINT fk_contract_pending_handler FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL',
    'SELECT 1'
);

PREPARE add_pending_handler_statement FROM @add_pending_handler_sql;
EXECUTE add_pending_handler_statement;
DEALLOCATE PREPARE add_pending_handler_statement;

UPDATE contract_pending
   SET handled_by = claimed_by
 WHERE handled_by IS NULL
   AND claimed_by IS NOT NULL;
