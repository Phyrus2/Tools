SET @legacy_supplier_active_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND COLUMN_NAME = 'is_active'
);

SET @supplier_status_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND COLUMN_NAME = 'status'
);

SET @add_supplier_status_sql = IF(
    @supplier_status_exists = 0,
    'ALTER TABLE suppliers ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT ''Active'' AFTER category_supplier',
    'SELECT 1'
);
PREPARE add_supplier_status_statement FROM @add_supplier_status_sql;
EXECUTE add_supplier_status_statement;
DEALLOCATE PREPARE add_supplier_status_statement;

SET @copy_supplier_status_sql = IF(
    @legacy_supplier_active_exists > 0,
    'UPDATE suppliers SET status = CASE WHEN is_active = 0 THEN ''Inactive'' ELSE ''Active'' END',
    'SELECT 1'
);
PREPARE copy_supplier_status_statement FROM @copy_supplier_status_sql;
EXECUTE copy_supplier_status_statement;
DEALLOCATE PREPARE copy_supplier_status_statement;

SET @drop_supplier_active_sql = IF(
    @legacy_supplier_active_exists > 0,
    'ALTER TABLE suppliers DROP COLUMN is_active',
    'SELECT 1'
);
PREPARE drop_supplier_active_statement FROM @drop_supplier_active_sql;
EXECUTE drop_supplier_active_statement;
DEALLOCATE PREPARE drop_supplier_active_statement;
