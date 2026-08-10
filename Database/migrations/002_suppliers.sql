CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id INT PRIMARY KEY,

    company_name VARCHAR(255) NOT NULL,

    town VARCHAR(255),

    region VARCHAR(255),

    location VARCHAR(255),

    category_supplier JSON NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);