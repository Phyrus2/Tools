CREATE TABLE IF NOT EXISTS user_permissions (
    user_id INT NOT NULL,
    permission_key VARCHAR(80) NOT NULL,
    granted_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, permission_key),
    CONSTRAINT fk_user_permission_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_permission_granted_by
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_permission_key (permission_key)
);

CREATE TABLE IF NOT EXISTS user_management_audit (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    actor_user_id INT NULL,
    target_user_id INT NULL,
    action VARCHAR(60) NOT NULL,
    details JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_management_audit_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_user_management_audit_target
        FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_management_audit_target (target_user_id, created_at),
    INDEX idx_user_management_audit_actor (actor_user_id, created_at)
);
