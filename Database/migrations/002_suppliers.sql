CREATE TABLE IF NOT EXISTS suppliers (
    id INT PRIMARY KEY,

    company_name VARCHAR(255) NOT NULL,

    town VARCHAR(255),

    region VARCHAR(255),

    location VARCHAR(255),

    category_supplier VARCHAR(255),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);