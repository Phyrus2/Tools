SET @hotel_option_fk_exists = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'hotel_options'
      AND CONSTRAINT_NAME = 'fk_hotel_options_supplier' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @drop_hotel_option_fk_sql = IF(
    @hotel_option_fk_exists > 0,
    'ALTER TABLE hotel_options DROP FOREIGN KEY fk_hotel_options_supplier',
    'SELECT 1'
);
PREPARE drop_hotel_option_fk_statement FROM @drop_hotel_option_fk_sql;
EXECUTE drop_hotel_option_fk_statement;
DEALLOCATE PREPARE drop_hotel_option_fk_statement;

ALTER TABLE hotel_options MODIFY COLUMN supplier_id INT NULL;

SET @hotel_option_fk_after = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'hotel_options'
      AND CONSTRAINT_NAME = 'fk_hotel_options_supplier' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @add_hotel_option_fk_sql = IF(
    @hotel_option_fk_after = 0,
    'ALTER TABLE hotel_options ADD CONSTRAINT fk_hotel_options_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE SET NULL',
    'SELECT 1'
);
PREPARE add_hotel_option_fk_statement FROM @add_hotel_option_fk_sql;
EXECUTE add_hotel_option_fk_statement;
DEALLOCATE PREPARE add_hotel_option_fk_statement;

SET @hotel_columns_sql = 'ALTER TABLE hotel_options
    ADD COLUMN region VARCHAR(100) NULL AFTER supplier_id,
    ADD COLUMN location VARCHAR(150) NULL AFTER region,
    ADD COLUMN segment VARCHAR(150) NULL AFTER location,
    ADD COLUMN hotel_name VARCHAR(255) NULL AFTER segment,
    ADD COLUMN room_type VARCHAR(255) NULL AFTER hotel_name,
    ADD COLUMN quote_amount DECIMAL(15,2) NULL AFTER room_type,
    ADD COLUMN high_season_surcharge DECIMAL(15,2) NULL AFTER quote_amount,
    ADD COLUMN high_season_period VARCHAR(255) NULL AFTER high_season_surcharge,
    ADD COLUMN peak_season_period VARCHAR(255) NULL AFTER high_season_period,
    ADD COLUMN remarks TEXT NULL AFTER peak_season_period,
    ADD COLUMN source_file VARCHAR(255) NULL AFTER remarks,
    ADD COLUMN source_sheet VARCHAR(100) NULL AFTER source_file,
    ADD COLUMN source_row INT NULL AFTER source_sheet';

SET @hotel_columns_missing = (
    SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hotel_options' AND COLUMN_NAME = 'hotel_name'
);
SET @apply_hotel_columns_sql = IF(@hotel_columns_missing, @hotel_columns_sql, 'SELECT 1');
PREPARE apply_hotel_columns_statement FROM @apply_hotel_columns_sql;
EXECUTE apply_hotel_columns_statement;
DEALLOCATE PREPARE apply_hotel_columns_statement;
