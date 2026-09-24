SET @scan_source_deleted_at_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_scan_sources'
      AND COLUMN_NAME = 'deleted_at'
);

SET @add_scan_source_deleted_at_sql = IF(
    @scan_source_deleted_at_exists = 0,
    'ALTER TABLE contract_scan_sources ADD COLUMN deleted_at DATETIME(3) NULL AFTER updated_at',
    'SELECT 1'
);
PREPARE add_scan_source_deleted_at_statement FROM @add_scan_source_deleted_at_sql;
EXECUTE add_scan_source_deleted_at_statement;
DEALLOCATE PREPARE add_scan_source_deleted_at_statement;

SET @scan_source_deleted_index_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_scan_sources'
      AND INDEX_NAME = 'idx_contract_scan_source_deleted'
);

SET @add_scan_source_deleted_index_sql = IF(
    @scan_source_deleted_index_exists = 0,
    'CREATE INDEX idx_contract_scan_source_deleted ON contract_scan_sources (server_id, deleted_at, enabled)',
    'SELECT 1'
);
PREPARE add_scan_source_deleted_index_statement FROM @add_scan_source_deleted_index_sql;
EXECUTE add_scan_source_deleted_index_statement;
DEALLOCATE PREPARE add_scan_source_deleted_index_statement;
