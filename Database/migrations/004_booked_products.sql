CREATE TABLE IF NOT EXISTS booked_products (
    id INT AUTO_INCREMENT PRIMARY KEY,

    dossier_id VARCHAR(100) NOT NULL,

    dossier_name VARCHAR(255),

    supplier_id INT NOT NULL,

    product_id INT NOT NULL,

    status VARCHAR(255),

    code VARCHAR(100),

    duration INT,

    travel_date DATE,

    end_date DATE,

    sales VARCHAR(255),

    operational VARCHAR(255),

    quantity INT,

    unit varchar(50),

    price DECIMAL(10, 2),

    -- Simpan seluruh kolom Excel (raw row) di sini sebagai JSON
    extra_data JSON DEFAULT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_booked_supplier
    FOREIGN KEY (supplier_id)
    REFERENCES suppliers(supplier_id)
    ON DELETE CASCADE,

    CONSTRAINT fk_booked_product
    FOREIGN KEY (product_id)
    REFERENCES products(product_id)
    ON DELETE CASCADE,

    INDEX idx_dossier_id (dossier_id),
    INDEX idx_travel_date (travel_date),
    INDEX idx_supplier_id (supplier_id),
    INDEX idx_product_id (product_id)
);