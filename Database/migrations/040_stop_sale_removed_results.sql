-- Files removed from the Stop Sale scan results. Only hidden from the list: the file
-- on the drive is untouched, and an updated version is a new scan result and shows again.
CREATE TABLE IF NOT EXISTS stop_sale_removed_results (
    scan_result_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    removed_by INT NULL,
    removed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_stop_sale_removed_result
        FOREIGN KEY (scan_result_id) REFERENCES contract_scan_results(id) ON DELETE CASCADE,
    CONSTRAINT fk_stop_sale_removed_by
        FOREIGN KEY (removed_by) REFERENCES users(id) ON DELETE SET NULL
);
