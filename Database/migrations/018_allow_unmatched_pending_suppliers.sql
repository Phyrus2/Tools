SET @pending_supplier_name_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_pending_suppliers'
      AND COLUMN_NAME = 'detected_supplier_name'
);

SET @add_pending_supplier_name_sql = IF(
    @pending_supplier_name_exists = 0,
    'ALTER TABLE contract_pending_suppliers ADD COLUMN detected_supplier_name VARCHAR(255) NULL AFTER supplier_id',
    'SELECT 1'
);
PREPARE add_pending_supplier_name_statement FROM @add_pending_supplier_name_sql;
EXECUTE add_pending_supplier_name_statement;
DEALLOCATE PREPARE add_pending_supplier_name_statement;

SET @pending_supplier_nullable = (
    SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_pending_suppliers'
      AND COLUMN_NAME = 'supplier_id'
    LIMIT 1
);

SET @pending_supplier_fk_exists = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_pending_suppliers'
      AND CONSTRAINT_NAME = 'fk_contract_pending_supplier_supplier'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @drop_pending_supplier_fk_sql = IF(
    @pending_supplier_nullable = 'NO' AND @pending_supplier_fk_exists > 0,
    'ALTER TABLE contract_pending_suppliers DROP FOREIGN KEY fk_contract_pending_supplier_supplier',
    'SELECT 1'
);
PREPARE drop_pending_supplier_fk_statement FROM @drop_pending_supplier_fk_sql;
EXECUTE drop_pending_supplier_fk_statement;
DEALLOCATE PREPARE drop_pending_supplier_fk_statement;

SET @make_pending_supplier_nullable_sql = IF(
    @pending_supplier_nullable = 'NO',
    'ALTER TABLE contract_pending_suppliers MODIFY COLUMN supplier_id INT NULL',
    'SELECT 1'
);
PREPARE make_pending_supplier_nullable_statement FROM @make_pending_supplier_nullable_sql;
EXECUTE make_pending_supplier_nullable_statement;
DEALLOCATE PREPARE make_pending_supplier_nullable_statement;

SET @pending_supplier_fk_exists_after = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_pending_suppliers'
      AND CONSTRAINT_NAME = 'fk_contract_pending_supplier_supplier'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @restore_pending_supplier_fk_sql = IF(
    @pending_supplier_fk_exists_after = 0,
    'ALTER TABLE contract_pending_suppliers ADD CONSTRAINT fk_contract_pending_supplier_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE RESTRICT',
    'SELECT 1'
);
PREPARE restore_pending_supplier_fk_statement FROM @restore_pending_supplier_fk_sql;
EXECUTE restore_pending_supplier_fk_statement;
DEALLOCATE PREPARE restore_pending_supplier_fk_statement;
