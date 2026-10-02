SET @has_uploaded_path = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stop_sale_jobs' AND COLUMN_NAME = 'uploaded_path'
);
SET @sql = IF(@has_uploaded_path = 0,
    'ALTER TABLE stop_sale_jobs ADD COLUMN uploaded_path TEXT NULL AFTER baseline_path',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_uploaded_file_name = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stop_sale_jobs' AND COLUMN_NAME = 'uploaded_file_name'
);
SET @sql = IF(@has_uploaded_file_name = 0,
    'ALTER TABLE stop_sale_jobs ADD COLUMN uploaded_file_name VARCHAR(512) NULL AFTER uploaded_path',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_uploaded_mime_type = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stop_sale_jobs' AND COLUMN_NAME = 'uploaded_mime_type'
);
SET @sql = IF(@has_uploaded_mime_type = 0,
    'ALTER TABLE stop_sale_jobs ADD COLUMN uploaded_mime_type VARCHAR(150) NULL AFTER uploaded_file_name',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_uploaded_file_size = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stop_sale_jobs' AND COLUMN_NAME = 'uploaded_file_size'
);
SET @sql = IF(@has_uploaded_file_size = 0,
    'ALTER TABLE stop_sale_jobs ADD COLUMN uploaded_file_size BIGINT UNSIGNED NULL AFTER uploaded_mime_type',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
