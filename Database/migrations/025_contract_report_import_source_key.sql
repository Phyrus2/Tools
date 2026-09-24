SET @report_import_key_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_reports'
      AND COLUMN_NAME = 'import_source_key'
);
SET @add_report_import_key_sql = IF(
    @report_import_key_exists = 0,
    'ALTER TABLE contract_reports ADD COLUMN import_source_key CHAR(64) NULL AFTER source_scan_result_id',
    'SELECT 1'
);
PREPARE add_report_import_key_statement FROM @add_report_import_key_sql;
EXECUTE add_report_import_key_statement;
DEALLOCATE PREPARE add_report_import_key_statement;

SET @report_import_key_index_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_reports'
      AND INDEX_NAME = 'uq_contract_report_import_source_key'
);
SET @add_report_import_key_index_sql = IF(
    @report_import_key_index_exists = 0,
    'ALTER TABLE contract_reports ADD UNIQUE INDEX uq_contract_report_import_source_key (import_source_key)',
    'SELECT 1'
);
PREPARE add_report_import_key_index_statement FROM @add_report_import_key_index_sql;
EXECUTE add_report_import_key_index_statement;
DEALLOCATE PREPARE add_report_import_key_index_statement;
