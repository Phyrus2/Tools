SET @hotel_option_code_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hotel_options' AND COLUMN_NAME = 'option_code'
);
SET @add_hotel_option_code_sql = IF(
    @hotel_option_code_exists = 0,
    'ALTER TABLE hotel_options ADD COLUMN option_code CHAR(1) NULL AFTER option_year',
    'SELECT 1'
);
PREPARE add_hotel_option_code_statement FROM @add_hotel_option_code_sql;
EXECUTE add_hotel_option_code_statement;
DEALLOCATE PREPARE add_hotel_option_code_statement;

UPDATE hotel_options
   SET location = TRIM(
       CASE
         WHEN LOWER(TRIM(location)) LIKE '%- ok'
           THEN LEFT(TRIM(location), CHAR_LENGTH(TRIM(location)) - 4)
         ELSE location
       END
   )
 WHERE location IS NOT NULL;

UPDATE hotel_options
   SET location = CONCAT(TRIM(location), ' / ', TRIM(segment))
 WHERE segment IS NOT NULL
   AND TRIM(segment) <> ''
   AND location NOT LIKE '%/%';

DROP TEMPORARY TABLE IF EXISTS hotel_option_code_backfill;
CREATE TEMPORARY TABLE hotel_option_code_backfill AS
SELECT id,
       ROW_NUMBER() OVER (
         PARTITION BY option_year, region, location
         ORDER BY COALESCE(source_row, 2147483647), id
       ) AS option_number
  FROM hotel_options
 WHERE option_code IS NULL;

UPDATE hotel_options option_row
JOIN hotel_option_code_backfill backfill ON backfill.id = option_row.id
   SET option_row.option_code = CASE backfill.option_number
     WHEN 1 THEN 'A'
     WHEN 2 THEN 'B'
     WHEN 3 THEN 'C'
     ELSE NULL
   END;

DROP TEMPORARY TABLE IF EXISTS hotel_option_code_backfill;
