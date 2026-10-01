SET @report_type_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_reports'
      AND COLUMN_NAME = 'report_type'
);
SET @add_report_type_sql = IF(
    @report_type_exists = 0,
    'ALTER TABLE contract_reports ADD COLUMN report_type ENUM(''ONE_TIME_SUPPLIER'', ''CONTRACT'') NOT NULL DEFAULT ''CONTRACT'' AFTER supplier_type, ADD INDEX idx_contract_report_type_supplier (report_type, supplier_id)',
    'SELECT 1'
);
PREPARE add_report_type_statement FROM @add_report_type_sql;
EXECUTE add_report_type_statement;
DEALLOCATE PREPARE add_report_type_statement;

ALTER TABLE contract_reports
    MODIFY COLUMN validity_start DATE NULL,
    MODIFY COLUMN validity_end DATE NULL,
    MODIFY COLUMN status ENUM('NO_CONTRACT', 'ACTIVE', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE';

UPDATE contract_reports
   SET report_type = 'CONTRACT'
 WHERE report_type IS NULL;

CREATE TABLE IF NOT EXISTS hotel_option_rooms (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    hotel_option_id BIGINT UNSIGNED NOT NULL,
    room_type VARCHAR(255) NOT NULL,
    product_id INT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX uq_hotel_option_room (hotel_option_id, room_type),
    INDEX idx_hotel_option_room_product (product_id),
    INDEX idx_hotel_option_room_active (hotel_option_id, is_active),
    CONSTRAINT fk_hotel_option_room_option
        FOREIGN KEY (hotel_option_id) REFERENCES hotel_options(id) ON DELETE CASCADE,
    CONSTRAINT fk_hotel_option_room_product
        FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL
);

INSERT INTO hotel_option_rooms (hotel_option_id, room_type, product_id, is_active)
SELECT id, room_type, product_id, 1
  FROM hotel_options
 WHERE room_type IS NOT NULL
   AND TRIM(room_type) <> ''
ON DUPLICATE KEY UPDATE
    product_id = COALESCE(hotel_option_rooms.product_id, VALUES(product_id));
