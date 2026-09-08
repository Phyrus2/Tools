SET @duration_unit_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'booked_products'
      AND COLUMN_NAME = 'duration_unit'
);

SET @duration_unit_sql = IF(
    @duration_unit_exists = 0,
    'ALTER TABLE booked_products ADD COLUMN duration_unit ENUM(''D'', ''N'') NULL AFTER duration',
    'SELECT 1'
);

PREPARE duration_unit_statement FROM @duration_unit_sql;
EXECUTE duration_unit_statement;
DEALLOCATE PREPARE duration_unit_statement;

-- Nilai lama dibiarkan NULL karena unit D/N sudah hilang pada import lama.
-- Import ulang file sumber untuk mengisi unit secara akurat.
