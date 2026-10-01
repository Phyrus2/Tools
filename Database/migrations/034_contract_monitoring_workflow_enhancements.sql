SET @supplier_inactive_name_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suppliers' AND COLUMN_NAME = 'inactive_name'
);
SET @supplier_inactive_columns_sql = IF(
    @supplier_inactive_name_exists = 0,
    'ALTER TABLE suppliers
       ADD COLUMN inactive_name VARCHAR(255) NULL AFTER status,
       ADD COLUMN inactive_at DATE NULL AFTER inactive_name,
       ADD COLUMN inactive_reason TEXT NULL AFTER inactive_at,
       ADD COLUMN replacement_supplier_name VARCHAR(255) NULL AFTER inactive_reason,
       ADD COLUMN inactive_by INT NULL AFTER replacement_supplier_name,
       ADD INDEX idx_supplier_inactive_by (inactive_by),
       ADD CONSTRAINT fk_supplier_inactive_by FOREIGN KEY (inactive_by) REFERENCES users(id) ON DELETE SET NULL',
    'SELECT 1'
);
PREPARE supplier_inactive_columns_statement FROM @supplier_inactive_columns_sql;
EXECUTE supplier_inactive_columns_statement;
DEALLOCATE PREPARE supplier_inactive_columns_statement;

CREATE TABLE IF NOT EXISTS supplier_status_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supplier_id INT NOT NULL,
    previous_status VARCHAR(20) NOT NULL,
    new_status VARCHAR(20) NOT NULL,
    inactive_name VARCHAR(255) NULL,
    inactive_at DATE NULL,
    inactive_reason TEXT NULL,
    replacement_supplier_name VARCHAR(255) NULL,
    changed_by INT NULL,
    changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_supplier_status_history (supplier_id, changed_at),
    CONSTRAINT fk_supplier_status_history_supplier
        FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    CONSTRAINT fk_supplier_status_history_user
        FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

SET @pending_supplier_processing_status_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_pending_suppliers'
      AND COLUMN_NAME = 'processing_status'
);
SET @pending_supplier_processing_columns_sql = IF(
    @pending_supplier_processing_status_exists = 0,
    'ALTER TABLE contract_pending_suppliers
       ADD COLUMN processing_status ENUM(''PENDING'', ''DONE'', ''IGNORED'') NOT NULL DEFAULT ''PENDING'' AFTER note,
       ADD COLUMN completed_by INT NULL AFTER processing_status,
       ADD COLUMN completed_at DATETIME(3) NULL AFTER completed_by,
       ADD INDEX idx_pending_supplier_processing (pending_id, processing_status),
       ADD CONSTRAINT fk_pending_supplier_completer FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL',
    'SELECT 1'
);
PREPARE pending_supplier_processing_columns_statement FROM @pending_supplier_processing_columns_sql;
EXECUTE pending_supplier_processing_columns_statement;
DEALLOCATE PREPARE pending_supplier_processing_columns_statement;

UPDATE contract_pending_suppliers ps
JOIN contract_pending p ON p.id = ps.pending_id
   SET ps.processing_status = CASE p.status WHEN 'DONE' THEN 'DONE' ELSE 'IGNORED' END,
       ps.completed_by = COALESCE(ps.completed_by, p.completed_by),
       ps.completed_at = COALESCE(ps.completed_at, p.completed_at)
 WHERE ps.processing_status = 'PENDING'
   AND p.status IN ('DONE', 'IGNORED');
