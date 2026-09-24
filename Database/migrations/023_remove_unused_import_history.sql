SET @revision_import_fk_exists = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'hotel_option_revisions'
      AND CONSTRAINT_NAME = 'fk_hotel_option_revision_import' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @drop_revision_import_fk_sql = IF(@revision_import_fk_exists > 0,
    'ALTER TABLE hotel_option_revisions DROP FOREIGN KEY fk_hotel_option_revision_import', 'SELECT 1');
PREPARE drop_revision_import_fk_statement FROM @drop_revision_import_fk_sql;
EXECUTE drop_revision_import_fk_statement;
DEALLOCATE PREPARE drop_revision_import_fk_statement;

SET @revision_import_column_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hotel_option_revisions' AND COLUMN_NAME = 'import_id'
);
SET @drop_revision_import_column_sql = IF(@revision_import_column_exists > 0,
    'ALTER TABLE hotel_option_revisions DROP COLUMN import_id', 'SELECT 1');
PREPARE drop_revision_import_column_statement FROM @drop_revision_import_column_sql;
EXECUTE drop_revision_import_column_statement;
DEALLOCATE PREPARE drop_revision_import_column_statement;

DROP TABLE IF EXISTS contract_report_import_items;
DROP TABLE IF EXISTS contract_report_imports;
DROP TABLE IF EXISTS hotel_option_imports;
