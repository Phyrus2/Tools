SET @pending_contract_period_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_pending' AND COLUMN_NAME = 'contract_period'
);
SET @add_pending_contract_period_sql = IF(
    @pending_contract_period_exists = 0,
    'ALTER TABLE contract_pending ADD COLUMN contract_period VARCHAR(100) NULL AFTER workflow_state',
    'SELECT 1'
);
PREPARE add_pending_contract_period_statement FROM @add_pending_contract_period_sql;
EXECUTE add_pending_contract_period_statement;
DEALLOCATE PREPARE add_pending_contract_period_statement;

UPDATE contract_pending pending_row
JOIN contract_scan_results scan_result ON scan_result.id = pending_row.scan_result_id
JOIN contract_scan_sources scan_source ON scan_source.id = scan_result.source_id
   SET pending_row.contract_period = CAST(scan_source.year AS CHAR)
 WHERE pending_row.contract_period IS NULL OR TRIM(pending_row.contract_period) = '';

