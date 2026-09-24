CREATE TABLE IF NOT EXISTS contract_management_groups (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    normalized_name VARCHAR(255) NOT NULL,
    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_by INT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_contract_management_group_name (normalized_name),
    CONSTRAINT fk_contract_management_group_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS supplier_management_group_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supplier_id INT NOT NULL,
    group_id BIGINT UNSIGNED NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    created_by INT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_supplier_group_period (supplier_id, group_id, start_date),
    INDEX idx_supplier_group_current (group_id, end_date, supplier_id),
    INDEX idx_supplier_group_supplier (supplier_id, end_date),
    CONSTRAINT fk_supplier_group_history_supplier
        FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    CONSTRAINT fk_supplier_group_history_group
        FOREIGN KEY (group_id) REFERENCES contract_management_groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_supplier_group_history_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_supplier_group_dates
        CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS contract_scan_sources (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    server_id VARCHAR(100) NOT NULL,
    year SMALLINT UNSIGNED NOT NULL,
    base_path VARCHAR(1024) NOT NULL,
    target_folder VARCHAR(512) NOT NULL,
    module_key ENUM('CONTRACT', 'INFO_STOP_SALES', 'QUOTE_TICKET')
        NOT NULL DEFAULT 'CONTRACT',
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    last_successful_checkpoint_utc DATETIME(3) NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_contract_scan_source
        (server_id, year, base_path(300), target_folder(200)),
    INDEX idx_contract_scan_source_server (server_id, enabled, module_key),
    CONSTRAINT fk_contract_scan_source_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_contract_scan_source_updater
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS contract_scan_runs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    server_id VARCHAR(100) NOT NULL,
    mode ENUM('AUTO', 'CUSTOM') NOT NULL,
    requested_start_wita DATETIME NULL,
    requested_end_wita DATETIME NULL,
    captured_now_utc DATETIME(3) NOT NULL,
    status ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')
        NOT NULL DEFAULT 'QUEUED',
    total_files INT UNSIGNED NOT NULL DEFAULT 0,
    new_files INT UNSIGNED NOT NULL DEFAULT 0,
    warning_count INT UNSIGNED NOT NULL DEFAULT 0,
    error_summary JSON NULL,
    requested_by INT NULL,
    started_at DATETIME(3) NULL,
    finished_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    active_server_id VARCHAR(100)
        GENERATED ALWAYS AS (
            CASE WHEN status IN ('QUEUED', 'RUNNING') THEN server_id ELSE NULL END
        ) STORED,
    UNIQUE KEY uq_contract_scan_active_server (active_server_id),
    INDEX idx_contract_scan_run_server (server_id, created_at),
    CONSTRAINT fk_contract_scan_run_requester
        FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS contract_scan_run_sources (
    scan_run_id BIGINT UNSIGNED NOT NULL,
    source_id BIGINT UNSIGNED NOT NULL,
    window_start_utc DATETIME(3) NOT NULL,
    window_end_utc DATETIME(3) NOT NULL,
    checkpoint_before_utc DATETIME(3) NULL,
    status ENUM('PENDING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    error_message TEXT NULL,
    PRIMARY KEY (scan_run_id, source_id),
    CONSTRAINT fk_contract_scan_run_source_run
        FOREIGN KEY (scan_run_id) REFERENCES contract_scan_runs(id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_scan_run_source_source
        FOREIGN KEY (source_id) REFERENCES contract_scan_sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contract_scan_results (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_id BIGINT UNSIGNED NOT NULL,
    full_path TEXT NOT NULL,
    parent_path TEXT NOT NULL,
    file_name VARCHAR(512) NOT NULL,
    extension VARCHAR(50) NULL,
    date_modified_utc DATETIME(3) NOT NULL,
    file_size BIGINT UNSIGNED NULL,
    path_hash BINARY(32) NOT NULL,
    fingerprint BINARY(32) NOT NULL,
    detected_signed_status ENUM('SIGNED', 'BELUM_SIGNED', 'DRAFT')
        NOT NULL DEFAULT 'BELUM_SIGNED',
    processed TINYINT(1) NOT NULL DEFAULT 0,
    processed_at DATETIME(3) NULL,
    first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_contract_scan_fingerprint (fingerprint),
    INDEX idx_contract_scan_result_source_modified (source_id, date_modified_utc),
    INDEX idx_contract_scan_result_processed (processed),
    CONSTRAINT fk_contract_scan_result_source
        FOREIGN KEY (source_id) REFERENCES contract_scan_sources(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS contract_scan_run_results (
    scan_run_id BIGINT UNSIGNED NOT NULL,
    scan_result_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (scan_run_id, scan_result_id),
    CONSTRAINT fk_contract_scan_run_result_run
        FOREIGN KEY (scan_run_id) REFERENCES contract_scan_runs(id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_scan_run_result_result
        FOREIGN KEY (scan_result_id) REFERENCES contract_scan_results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contract_reports (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_scan_result_id BIGINT UNSIGNED NULL,
    file_source TEXT NOT NULL,
    location_jambix VARCHAR(500) NULL,
    supplier_id INT NOT NULL,
    supplier_type VARCHAR(100) NOT NULL,
    validity_start DATE NOT NULL,
    validity_end DATE NOT NULL,
    status ENUM('ACTIVE', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    contract_reference VARCHAR(255) NULL,
    signed_status ENUM('SIGNED', 'BELUM_SIGNED', 'DRAFT')
        NOT NULL DEFAULT 'BELUM_SIGNED',
    note TEXT NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_contract_report_supplier_validity (supplier_id, validity_end, validity_start),
    INDEX idx_contract_report_source (source_scan_result_id),
    INDEX idx_contract_report_reference (contract_reference),
    CONSTRAINT fk_contract_report_scan_result
        FOREIGN KEY (source_scan_result_id) REFERENCES contract_scan_results(id) ON DELETE SET NULL,
    CONSTRAINT fk_contract_report_supplier
        FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE RESTRICT,
    CONSTRAINT fk_contract_report_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_contract_report_updater
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_contract_report_validity
        CHECK (validity_end >= validity_start)
);

CREATE TABLE IF NOT EXISTS contract_pending (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    scan_result_id BIGINT UNSIGNED NOT NULL,
    is_management_contract TINYINT(1) NOT NULL DEFAULT 0,
    management_group_id BIGINT UNSIGNED NULL,
    status ENUM('NEW', 'IN_PROGRESS', 'DONE', 'IGNORED') NOT NULL DEFAULT 'NEW',
    claimed_by INT NULL,
    claimed_at DATETIME(3) NULL,
    completed_by INT NULL,
    completed_at DATETIME(3) NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    note TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_contract_pending_scan_result (scan_result_id),
    INDEX idx_contract_pending_status (status, updated_at),
    CONSTRAINT fk_contract_pending_scan_result
        FOREIGN KEY (scan_result_id) REFERENCES contract_scan_results(id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_pending_group
        FOREIGN KEY (management_group_id) REFERENCES contract_management_groups(id) ON DELETE SET NULL,
    CONSTRAINT fk_contract_pending_claimer
        FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_contract_pending_completer
        FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS contract_pending_suppliers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pending_id BIGINT UNSIGNED NOT NULL,
    supplier_id INT NOT NULL,
    recommendation_source ENUM('FUZZY', 'GROUP', 'MANUAL') NOT NULL,
    match_score DECIMAL(5,4) NULL,
    detection ENUM('NO_MATCH', 'SUPPLIER_MATCH', 'ACTIVE_CONTRACT') NOT NULL,
    action ENUM('INSERT', 'UPDATE') NULL,
    target_contract_report_id BIGINT UNSIGNED NULL,
    supplier_type VARCHAR(100) NULL,
    location_jambix VARCHAR(500) NULL,
    validity_start DATE NULL,
    validity_end DATE NULL,
    contract_reference VARCHAR(255) NULL,
    signed_status ENUM('SIGNED', 'BELUM_SIGNED', 'DRAFT')
        NOT NULL DEFAULT 'BELUM_SIGNED',
    note TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_contract_pending_supplier (pending_id, supplier_id),
    INDEX idx_contract_pending_supplier_target (target_contract_report_id),
    CONSTRAINT fk_contract_pending_supplier_pending
        FOREIGN KEY (pending_id) REFERENCES contract_pending(id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_pending_supplier_supplier
        FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE RESTRICT,
    CONSTRAINT fk_contract_pending_supplier_target
        FOREIGN KEY (target_contract_report_id) REFERENCES contract_reports(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS contract_report_revisions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    contract_report_id BIGINT UNSIGNED NOT NULL,
    action ENUM('INSERT', 'UPDATE') NOT NULL,
    before_data JSON NULL,
    after_data JSON NOT NULL,
    changed_by INT NULL,
    changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_contract_report_revision_report (contract_report_id, changed_at),
    CONSTRAINT fk_contract_report_revision_report
        FOREIGN KEY (contract_report_id) REFERENCES contract_reports(id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_report_revision_user
        FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);
