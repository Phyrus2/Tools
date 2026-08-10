CREATE TABLE IF NOT EXISTS products (

    product_id int PRIMARY KEY,

    supplier_id INT NOT NULL,

    name VARCHAR(255) NOT NULL,

    type VARCHAR(255),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_supplier
    FOREIGN KEY (supplier_id)
    REFERENCES suppliers(supplier_id)
    ON DELETE CASCADE
);