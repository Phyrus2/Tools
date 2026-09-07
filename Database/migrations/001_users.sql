CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,

    fullname VARCHAR(150) NOT NULL,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(150) UNIQUE,
    password VARCHAR(255) NOT NULL,

    role ENUM(
        'ADMIN',
        'OPERATION',
        'SALES',
        'USER'
    ) NOT NULL DEFAULT 'USER',

    status ENUM(
        'ACTIVE',
        'INACTIVE'
    ) NOT NULL DEFAULT 'ACTIVE',

    last_login DATETIME DEFAULT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

-- Admin sengaja tidak dibuat di migration. Gunakan `npm run admin:create`
-- agar password tidak pernah disimpan sebagai teks biasa atau masuk Git.
