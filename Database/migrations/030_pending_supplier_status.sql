SET @pending_supplier_status_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_pending' AND COLUMN_NAME = 'queue_supplier_status'
);
SET @add_pending_supplier_status_sql = IF(
    @pending_supplier_status_exists = 0,
    'ALTER TABLE contract_pending ADD COLUMN queue_supplier_status VARCHAR(30) NULL AFTER contract_period',
    'SELECT 1'
);
PREPARE add_pending_supplier_status_statement FROM @add_pending_supplier_status_sql;
EXECUTE add_pending_supplier_status_statement;
DEALLOCATE PREPARE add_pending_supplier_status_statement;

