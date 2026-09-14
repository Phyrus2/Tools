SET @product_info_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'info'
);
SET @product_info_sql = IF(
    @product_info_exists = 0,
    'ALTER TABLE products ADD COLUMN info TEXT NULL AFTER status',
    'SELECT 1'
);
PREPARE product_info_statement FROM @product_info_sql;
EXECUTE product_info_statement;
DEALLOCATE PREPARE product_info_statement;

SET @product_not_on_offer_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'not_on_offer'
);
SET @product_not_on_offer_sql = IF(
    @product_not_on_offer_exists = 0,
    'ALTER TABLE products ADD COLUMN not_on_offer TEXT NULL AFTER info',
    'SELECT 1'
);
PREPARE product_not_on_offer_statement FROM @product_not_on_offer_sql;
EXECUTE product_not_on_offer_statement;
DEALLOCATE PREPARE product_not_on_offer_statement;

SET @product_services_included_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'services_included'
);
SET @product_services_included_sql = IF(
    @product_services_included_exists = 0,
    'ALTER TABLE products ADD COLUMN services_included TEXT NULL AFTER not_on_offer',
    'SELECT 1'
);
PREPARE product_services_included_statement FROM @product_services_included_sql;
EXECUTE product_services_included_statement;
DEALLOCATE PREPARE product_services_included_statement;

SET @product_services_excluded_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'services_excluded'
);
SET @product_services_excluded_sql = IF(
    @product_services_excluded_exists = 0,
    'ALTER TABLE products ADD COLUMN services_excluded TEXT NULL AFTER services_included',
    'SELECT 1'
);
PREPARE product_services_excluded_statement FROM @product_services_excluded_sql;
EXECUTE product_services_excluded_statement;
DEALLOCATE PREPARE product_services_excluded_statement;

SET @product_instructions_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'instructions'
);
SET @product_instructions_sql = IF(
    @product_instructions_exists = 0,
    'ALTER TABLE products ADD COLUMN instructions TEXT NULL AFTER services_excluded',
    'SELECT 1'
);
PREPARE product_instructions_statement FROM @product_instructions_sql;
EXECUTE product_instructions_statement;
DEALLOCATE PREPARE product_instructions_statement;

SET @product_description_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'description'
);
SET @product_description_sql = IF(
    @product_description_exists = 0,
    'ALTER TABLE products ADD COLUMN description TEXT NULL AFTER instructions',
    'SELECT 1'
);
PREPARE product_description_statement FROM @product_description_sql;
EXECUTE product_description_statement;
DEALLOCATE PREPARE product_description_statement;
