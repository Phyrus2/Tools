SET @hotel_option_year_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hotel_options' AND COLUMN_NAME = 'option_year'
);
SET @add_hotel_option_year_sql = IF(
    @hotel_option_year_exists = 0,
    'ALTER TABLE hotel_options ADD COLUMN option_year SMALLINT UNSIGNED NOT NULL DEFAULT 2026 AFTER option_key',
    'SELECT 1'
);
PREPARE add_hotel_option_year_statement FROM @add_hotel_option_year_sql;
EXECUTE add_hotel_option_year_statement;
DEALLOCATE PREPARE add_hotel_option_year_statement;

SET @hotel_option_year_index_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hotel_options'
      AND INDEX_NAME = 'idx_hotel_options_year_region_location'
);
SET @add_hotel_option_year_index_sql = IF(
    @hotel_option_year_index_exists = 0,
    'ALTER TABLE hotel_options ADD INDEX idx_hotel_options_year_region_location (option_year, region, location)',
    'SELECT 1'
);
PREPARE add_hotel_option_year_index_statement FROM @add_hotel_option_year_index_sql;
EXECUTE add_hotel_option_year_index_statement;
DEALLOCATE PREPARE add_hotel_option_year_index_statement;
