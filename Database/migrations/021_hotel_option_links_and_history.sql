SET @product_id_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hotel_options' AND COLUMN_NAME = 'product_id'
);
SET @product_id_sql = IF(@product_id_exists = 0,
    'ALTER TABLE hotel_options ADD COLUMN product_id INT NULL AFTER supplier_id, ADD INDEX idx_hotel_options_product (product_id), ADD CONSTRAINT fk_hotel_options_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL',
    'SELECT 1');
PREPARE product_id_statement FROM @product_id_sql;
EXECUTE product_id_statement;
DEALLOCATE PREPARE product_id_statement;

SET @option_key_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hotel_options' AND COLUMN_NAME = 'option_key'
);
SET @option_key_sql = IF(@option_key_exists = 0,
    'ALTER TABLE hotel_options ADD COLUMN option_key CHAR(64) NULL AFTER id, ADD UNIQUE INDEX uq_hotel_options_key (option_key)',
    'SELECT 1');
PREPARE option_key_statement FROM @option_key_sql;
EXECUTE option_key_statement;
DEALLOCATE PREPARE option_key_statement;

CREATE TABLE IF NOT EXISTS hotel_option_revisions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    hotel_option_id BIGINT UNSIGNED NOT NULL,
    action ENUM('IMPORTED', 'UPDATED', 'LINKED') NOT NULL,
    changes JSON NULL,
    before_data JSON NULL,
    after_data JSON NOT NULL,
    changed_by INT NULL,
    changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_hotel_option_revision_option (hotel_option_id, changed_at),
    CONSTRAINT fk_hotel_option_revision_option FOREIGN KEY (hotel_option_id) REFERENCES hotel_options(id) ON DELETE CASCADE,
    CONSTRAINT fk_hotel_option_revision_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);
