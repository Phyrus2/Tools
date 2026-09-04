SET @product_status_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'products'
      AND COLUMN_NAME = 'status'
);

SET @product_status_sql = IF(
    @product_status_exists = 0,
    'ALTER TABLE products ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT ''Regular Product'' AFTER type',
    'SELECT 1'
);

PREPARE product_status_statement FROM @product_status_sql;
EXECUTE product_status_statement;
DEALLOCATE PREPARE product_status_statement;
