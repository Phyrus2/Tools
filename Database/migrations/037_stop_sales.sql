CREATE TABLE IF NOT EXISTS stop_sale_jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    scan_result_id BIGINT UNSIGNED NOT NULL,
    supplier_id INT NULL,
    status ENUM(
        'NEW', 'UNMATCHED_SUPPLIER', 'PROCESSING', 'NO_BASELINE',
        'COMPARED', 'NEEDS_REVIEW', 'READY_FOR_JAMBIX',
        'COMPLETED', 'DUPLICATE', 'EXTRACTION_FAILED', 'WAITING_PREVIOUS'
    ) NOT NULL DEFAULT 'NEW',
    document_type ENUM('FULL_SNAPSHOT', 'INCREMENTAL', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    is_active_baseline TINYINT(1) NOT NULL DEFAULT 0,
    baseline_path TEXT NULL,
    uploaded_path TEXT NULL,
    uploaded_file_name VARCHAR(512) NULL,
    uploaded_mime_type VARCHAR(150) NULL,
    uploaded_file_size BIGINT UNSIGNED NULL,
    extraction_confidence DECIMAL(5,4) NULL,
    comparison_summary JSON NULL,
    source_diff JSON NULL,
    processed_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    completed_by INT NULL,
    note TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    active_supplier_id INT GENERATED ALWAYS AS (
        CASE WHEN is_active_baseline = 1 THEN supplier_id ELSE NULL END
    ) STORED,
    UNIQUE KEY uq_stop_sale_job_scan_result (scan_result_id),
    UNIQUE KEY uq_stop_sale_active_supplier (active_supplier_id),
    INDEX idx_stop_sale_job_status (status, updated_at),
    INDEX idx_stop_sale_job_supplier (supplier_id, completed_at),
    CONSTRAINT fk_stop_sale_job_scan_result
        FOREIGN KEY (scan_result_id) REFERENCES contract_scan_results(id) ON DELETE CASCADE,
    CONSTRAINT fk_stop_sale_job_supplier
        FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE RESTRICT,
    CONSTRAINT fk_stop_sale_job_completer
        FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stop_sale_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT UNSIGNED NOT NULL,
    product_id INT NULL,
    detected_product_name VARCHAR(255) NULL,
    restriction_status ENUM('STOP_SALE', 'ON_REQUEST') NOT NULL DEFAULT 'STOP_SALE',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    confidence DECIMAL(5,4) NULL,
    source_reference JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_stop_sale_item_job (job_id, start_date, end_date),
    INDEX idx_stop_sale_item_product (product_id, start_date, end_date),
    CONSTRAINT fk_stop_sale_item_job
        FOREIGN KEY (job_id) REFERENCES stop_sale_jobs(id) ON DELETE CASCADE,
    CONSTRAINT fk_stop_sale_item_product
        FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL,
    CONSTRAINT chk_stop_sale_item_dates CHECK (end_date >= start_date)
);
