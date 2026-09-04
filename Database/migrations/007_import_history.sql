CREATE TABLE IF NOT EXISTS supplier_imports (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    total_rows INT UNSIGNED NOT NULL DEFAULT 0,
    inserted_count INT UNSIGNED NOT NULL DEFAULT 0,
    updated_count INT UNSIGNED NOT NULL DEFAULT 0,
    unchanged_count INT UNSIGNED NOT NULL DEFAULT 0,
    skipped_count INT UNSIGNED NOT NULL DEFAULT 0,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    undone_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS supplier_import_category_changes (
    import_id BIGINT UNSIGNED NOT NULL,
    supplier_id INT NOT NULL,
    categories_before JSON NOT NULL,
    categories_after JSON NOT NULL,
    undone_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (import_id, supplier_id),
    CONSTRAINT fk_supplier_import_change_import
        FOREIGN KEY (import_id)
        REFERENCES supplier_imports(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_supplier_import_change_supplier
        FOREIGN KEY (supplier_id)
        REFERENCES suppliers(supplier_id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS data_import_status (
    dataset VARCHAR(100) PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    total_rows INT UNSIGNED NOT NULL DEFAULT 0,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);
