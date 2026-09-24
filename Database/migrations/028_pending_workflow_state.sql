SET @pending_workflow_state_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_pending' AND COLUMN_NAME = 'workflow_state'
);
SET @add_pending_workflow_state_sql = IF(
    @pending_workflow_state_exists = 0,
    'ALTER TABLE contract_pending ADD COLUMN workflow_state VARCHAR(30) NOT NULL DEFAULT ''UNHANDLED'' AFTER status, ADD INDEX idx_contract_pending_workflow (workflow_state, updated_at)',
    'SELECT 1'
);
PREPARE add_pending_workflow_state_statement FROM @add_pending_workflow_state_sql;
EXECUTE add_pending_workflow_state_statement;
DEALLOCATE PREPARE add_pending_workflow_state_statement;

UPDATE contract_pending
   SET workflow_state = CASE status
     WHEN 'NEW' THEN 'UNHANDLED'
     WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
     WHEN 'DONE' THEN 'DONE'
     WHEN 'IGNORED' THEN 'IGNORED'
     ELSE workflow_state
   END
 WHERE @pending_workflow_state_exists = 0;
