SET @product_kind_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'products'
      AND COLUMN_NAME = 'product_kind'
);

SET @restore_product_status_sql = IF(
    @product_kind_exists > 0,
    'UPDATE products SET status = product_kind WHERE LOWER(TRIM(product_kind)) IN (''regular product'', ''one time product'')',
    'SELECT 1'
);

PREPARE restore_product_status_statement FROM @restore_product_status_sql;
EXECUTE restore_product_status_statement;
DEALLOCATE PREPARE restore_product_status_statement;

UPDATE products
SET status = 'Regular Product'
WHERE status IS NULL
   OR TRIM(status) = ''
   OR LOWER(TRIM(status)) NOT IN ('regular product', 'one time product');

SET @drop_product_kind_sql = IF(
    @product_kind_exists > 0,
    'ALTER TABLE products DROP COLUMN product_kind',
    'SELECT 1'
);

PREPARE drop_product_kind_statement FROM @drop_product_kind_sql;
EXECUTE drop_product_kind_statement;
DEALLOCATE PREPARE drop_product_kind_statement;

ALTER TABLE products
MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'Regular Product';
