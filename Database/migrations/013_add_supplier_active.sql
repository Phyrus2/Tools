SET @supplier_status_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND COLUMN_NAME = 'status'
);

SET @supplier_status_sql = IF(
    @supplier_status_exists = 0,
    'ALTER TABLE suppliers ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT ''Active'' AFTER category_supplier',
    'SELECT 1'
);

PREPARE supplier_status_statement FROM @supplier_status_sql;
EXECUTE supplier_status_statement;
DEALLOCATE PREPARE supplier_status_statement;
