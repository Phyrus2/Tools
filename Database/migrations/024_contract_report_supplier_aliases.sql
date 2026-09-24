CREATE TABLE IF NOT EXISTS contract_report_supplier_aliases (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_name VARCHAR(255) NOT NULL,
    normalized_name VARCHAR(255) NOT NULL,
    supplier_id INT NOT NULL,
    linked_by INT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX uq_contract_report_supplier_alias (normalized_name),
    INDEX idx_contract_report_supplier_alias_supplier (supplier_id),
    CONSTRAINT fk_contract_report_supplier_alias_supplier
        FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_report_supplier_alias_user
        FOREIGN KEY (linked_by) REFERENCES users(id) ON DELETE SET NULL
);
