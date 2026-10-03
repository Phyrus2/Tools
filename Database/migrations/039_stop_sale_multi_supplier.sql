-- One supplier folder can hold a file for two hotels ("K CLUB & KANVA UBUD"):
-- the same scan result may then be queued once per supplier.
SET @has_split_index = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stop_sale_jobs' AND COLUMN_NAME = 'split_index'
);
SET @sql = IF(@has_split_index = 0,
    'ALTER TABLE stop_sale_jobs ADD COLUMN split_index TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER scan_result_id',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_old_unique = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stop_sale_jobs' AND INDEX_NAME = 'uq_stop_sale_job_scan_result'
);
SET @sql = IF(@has_old_unique = 1,
    'ALTER TABLE stop_sale_jobs DROP INDEX uq_stop_sale_job_scan_result, ADD UNIQUE KEY uq_stop_sale_job_scan_split (scan_result_id, split_index)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
