SET @management_name_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_pending' AND COLUMN_NAME = 'management_name'
);
SET @management_name_sql = IF(
    @management_name_exists = 0,
    'ALTER TABLE contract_pending ADD COLUMN management_name VARCHAR(255) NULL AFTER management_group_id',
    'SELECT 1'
);
PREPARE management_name_statement FROM @management_name_sql;
EXECUTE management_name_statement;
DEALLOCATE PREPARE management_name_statement;

SET @contract_region_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_reports' AND COLUMN_NAME = 'region'
);
SET @contract_region_sql = IF(
    @contract_region_exists = 0,
    'ALTER TABLE contract_reports ADD COLUMN region VARCHAR(100) NULL AFTER location_jambix',
    'SELECT 1'
);
PREPARE contract_region_statement FROM @contract_region_sql;
EXECUTE contract_region_statement;
DEALLOCATE PREPARE contract_region_statement;

SET @source_status_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_reports' AND COLUMN_NAME = 'source_status'
);
SET @source_status_sql = IF(
    @source_status_exists = 0,
    'ALTER TABLE contract_reports ADD COLUMN source_status VARCHAR(50) NULL AFTER status',
    'SELECT 1'
);
PREPARE source_status_statement FROM @source_status_sql;
EXECUTE source_status_statement;
DEALLOCATE PREPARE source_status_statement;

SET @period_statuses_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_reports' AND COLUMN_NAME = 'period_statuses'
);
SET @period_statuses_sql = IF(
    @period_statuses_exists = 0,
    'ALTER TABLE contract_reports ADD COLUMN period_statuses JSON NULL AFTER signed_status',
    'SELECT 1'
);
PREPARE period_statuses_statement FROM @period_statuses_sql;
EXECUTE period_statuses_statement;
DEALLOCATE PREPARE period_statuses_statement;

CREATE TABLE IF NOT EXISTS hotel_options (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supplier_id INT NOT NULL,
    option_reference VARCHAR(255) NULL,
    option_data JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_hotel_options_supplier (supplier_id),
    CONSTRAINT fk_hotel_options_supplier
        FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE CASCADE
);
