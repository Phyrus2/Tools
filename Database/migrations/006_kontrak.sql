CREATE TABLE IF NOT EXISTS kontrak (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Jenis file
    kategori ENUM('CONTRACT','QUOTE_TICKET') NOT NULL DEFAULT 'CONTRACT',

    -- Informasi file
    tahun YEAR NOT NULL,
    folder VARCHAR(500) NOT NULL,
    nama_file VARCHAR(255) NOT NULL,
    full_path VARCHAR(1000) NOT NULL,
    extension VARCHAR(20),
    ukuran BIGINT DEFAULT NULL,
    modified_at DATETIME NOT NULL,

    -- Workflow
    status ENUM(
        'BELUM_INPUT',
        'PROSES',
        'COMPLETED'
    ) NOT NULL DEFAULT 'BELUM_INPUT',

    process_by INT DEFAULT NULL,
    process_at DATETIME DEFAULT NULL,

    completed_by INT DEFAULT NULL,
    completed_at DATETIME DEFAULT NULL,

    -- Relasi ke data master
    supplier_id INT DEFAULT NULL,
    product_id INT DEFAULT NULL,

    -- Keterangan
    notes TEXT DEFAULT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_status (status),
    INDEX idx_supplier (supplier_id),
    INDEX idx_product (product_id),
    INDEX idx_tahun (tahun),
    INDEX idx_modified (modified_at),

    CONSTRAINT fk_kontrak_process_by
        FOREIGN KEY (process_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_kontrak_completed_by
        FOREIGN KEY (completed_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_kontrak_supplier
        FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_kontrak_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);