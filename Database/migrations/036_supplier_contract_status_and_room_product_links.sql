SET @supplier_contract_status_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND COLUMN_NAME = 'contract_status'
);
SET @add_supplier_contract_status_sql = IF(
    @supplier_contract_status_exists = 0,
    'ALTER TABLE suppliers ADD COLUMN contract_status ENUM(''NO_CONTRACT_RECORD'', ''ONE_TIME_SUPPLIER'', ''CONTRACTED'') NOT NULL DEFAULT ''NO_CONTRACT_RECORD'' AFTER status, ADD INDEX idx_supplier_contract_status (contract_status)',
    'SELECT 1'
);
PREPARE add_supplier_contract_status_statement FROM @add_supplier_contract_status_sql;
EXECUTE add_supplier_contract_status_statement;
DEALLOCATE PREPARE add_supplier_contract_status_statement;

UPDATE suppliers supplier
LEFT JOIN (
    SELECT supplier_id,
           MAX(report_type = 'CONTRACT') AS has_contract,
           MAX(report_type = 'ONE_TIME_SUPPLIER') AS has_one_time
      FROM contract_reports
     GROUP BY supplier_id
) reports ON reports.supplier_id = supplier.supplier_id
   SET supplier.contract_status = CASE
       WHEN COALESCE(reports.has_contract, 0) = 1 THEN 'CONTRACTED'
       WHEN COALESCE(reports.has_one_time, 0) = 1 THEN 'ONE_TIME_SUPPLIER'
       ELSE 'NO_CONTRACT_RECORD'
   END;

CREATE TABLE IF NOT EXISTS hotel_option_room_products (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    hotel_option_room_id BIGINT UNSIGNED NOT NULL,
    product_id INT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX uq_hotel_option_room_product (hotel_option_room_id, product_id),
    INDEX idx_hotel_option_room_product_product (product_id),
    CONSTRAINT fk_hotel_option_room_product_room
        FOREIGN KEY (hotel_option_room_id) REFERENCES hotel_option_rooms(id) ON DELETE CASCADE,
    CONSTRAINT fk_hotel_option_room_product_product
        FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);

INSERT IGNORE INTO hotel_option_room_products (hotel_option_room_id, product_id)
SELECT id, product_id
  FROM hotel_option_rooms
 WHERE product_id IS NOT NULL;

SET @contract_report_signed_status_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_reports'
      AND COLUMN_NAME = 'signed_status'
);
SET @drop_contract_report_signed_status_sql = IF(
    @contract_report_signed_status_exists > 0,
    'ALTER TABLE contract_reports DROP COLUMN signed_status',
    'SELECT 1'
);
PREPARE drop_contract_report_signed_status_statement FROM @drop_contract_report_signed_status_sql;
EXECUTE drop_contract_report_signed_status_statement;
DEALLOCATE PREPARE drop_contract_report_signed_status_statement;
