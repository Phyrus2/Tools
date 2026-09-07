SET @failed_attempts_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'failed_login_attempts'
);
SET @failed_attempts_sql = IF(
    @failed_attempts_exists = 0,
    'ALTER TABLE users ADD COLUMN failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER last_login',
    'SELECT 1'
);
PREPARE failed_attempts_statement FROM @failed_attempts_sql;
EXECUTE failed_attempts_statement;
DEALLOCATE PREPARE failed_attempts_statement;

SET @locked_until_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'locked_until'
);
SET @locked_until_sql = IF(
    @locked_until_exists = 0,
    'ALTER TABLE users ADD COLUMN locked_until DATETIME NULL AFTER failed_login_attempts',
    'SELECT 1'
);
PREPARE locked_until_statement FROM @locked_until_sql;
EXECUTE locked_until_statement;
DEALLOCATE PREPARE locked_until_statement;

CREATE TABLE IF NOT EXISTS admin_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash BINARY(32) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_admin_session_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_admin_session_expiry (expires_at),
    INDEX idx_admin_session_user (user_id)
);
