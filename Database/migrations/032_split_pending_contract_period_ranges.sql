DROP TEMPORARY TABLE IF EXISTS pending_period_splits;
DROP TEMPORARY TABLE IF EXISTS pending_period_norm;

CREATE TEMPORARY TABLE pending_period_norm AS
SELECT p.id AS pending_id,
       REPLACE(
         REPLACE(
           REPLACE(
             REPLACE(TRIM(p.contract_period), ' ', ''),
             '/', '-'
           ),
           '–', '-'
         ),
         '—', '-'
       ) AS period_value
  FROM contract_pending p
 WHERE p.status NOT IN ('DONE', 'IGNORED')
   AND REPLACE(
         REPLACE(
           REPLACE(
             REPLACE(TRIM(p.contract_period), ' ', ''),
             '/', '-'
           ),
           '–', '-'
         ),
         '—', '-'
       ) REGEXP '^(19|20)?[0-9]{2}-(19|20)?[0-9]{2}$';

CREATE TEMPORARY TABLE pending_period_splits AS
SELECT parsed.pending_id,
       parsed.year_1,
       parsed.year_2,
       UNHEX(SHA2(CONCAT('pending-period:', parsed.pending_id, ':', parsed.year_2), 256)) AS new_fingerprint
  FROM (
    SELECT n.pending_id,
           CASE
             WHEN CHAR_LENGTH(SUBSTRING_INDEX(n.period_value, '-', 1)) = 2
               THEN 2000 + CAST(SUBSTRING_INDEX(n.period_value, '-', 1) AS UNSIGNED)
             ELSE CAST(SUBSTRING_INDEX(n.period_value, '-', 1) AS UNSIGNED)
           END AS year_1,
           CASE
             WHEN CHAR_LENGTH(SUBSTRING_INDEX(n.period_value, '-', -1)) = 2
               THEN 2000 + CAST(SUBSTRING_INDEX(n.period_value, '-', -1) AS UNSIGNED)
             ELSE CAST(SUBSTRING_INDEX(n.period_value, '-', -1) AS UNSIGNED)
           END AS year_2
      FROM pending_period_norm n
  ) parsed
 WHERE parsed.year_2 > parsed.year_1
   AND parsed.year_2 - parsed.year_1 <= 10;

INSERT IGNORE INTO contract_scan_sources
  (server_id, year, base_path, target_folder, module_key, enabled,
   last_successful_checkpoint_utc, created_by, updated_by, created_at, updated_at)
SELECT DISTINCT source.server_id, split.year_2, source.base_path, source.target_folder,
       source.module_key, source.enabled, source.last_successful_checkpoint_utc,
       source.created_by, source.updated_by, source.created_at, source.updated_at
  FROM pending_period_splits split
  JOIN contract_pending pending_row ON pending_row.id = split.pending_id
  JOIN contract_scan_results scan_result ON scan_result.id = pending_row.scan_result_id
  JOIN contract_scan_sources source ON source.id = scan_result.source_id;

INSERT IGNORE INTO contract_scan_results
  (source_id, full_path, parent_path, file_name, extension, date_modified_utc,
   file_size, path_hash, fingerprint, detected_signed_status, processed,
   processed_at, first_seen_at, last_seen_at)
SELECT COALESCE(target_source.id, scan_result.source_id),
       scan_result.full_path, scan_result.parent_path, scan_result.file_name,
       scan_result.extension, scan_result.date_modified_utc, scan_result.file_size,
       scan_result.path_hash, split.new_fingerprint,
       scan_result.detected_signed_status, 0, NULL,
       scan_result.first_seen_at, scan_result.last_seen_at
  FROM pending_period_splits split
  JOIN contract_pending pending_row ON pending_row.id = split.pending_id
  JOIN contract_scan_results scan_result ON scan_result.id = pending_row.scan_result_id
  JOIN contract_scan_sources source ON source.id = scan_result.source_id
  LEFT JOIN contract_scan_sources target_source
    ON target_source.server_id = source.server_id
   AND target_source.year = split.year_2
   AND target_source.base_path = source.base_path
   AND target_source.target_folder = source.target_folder;

INSERT IGNORE INTO contract_pending
  (scan_result_id, is_management_contract, management_group_id, management_name,
   status, workflow_state, contract_period, queue_supplier_status,
   claimed_by, claimed_at, handled_by, completed_by, completed_at,
   version, note, created_at, updated_at)
SELECT cloned_scan.id, original.is_management_contract, original.management_group_id,
       original.management_name, original.status, original.workflow_state,
       CAST(split.year_2 AS CHAR), original.queue_supplier_status,
       NULL, NULL, original.handled_by, NULL, NULL,
       original.version, original.note, original.created_at, original.updated_at
  FROM pending_period_splits split
  JOIN contract_pending original ON original.id = split.pending_id
  JOIN contract_scan_results cloned_scan ON cloned_scan.fingerprint = split.new_fingerprint;

INSERT IGNORE INTO contract_pending_suppliers
  (pending_id, supplier_id, detected_supplier_name, recommendation_source,
   match_score, detection, action, target_contract_report_id, supplier_type,
   location_jambix, validity_start, validity_end, contract_reference,
   signed_status, note, created_at, updated_at)
SELECT cloned_pending.id, supplier.supplier_id, supplier.detected_supplier_name,
       supplier.recommendation_source, supplier.match_score, supplier.detection,
       NULL, NULL, supplier.supplier_type, supplier.location_jambix,
       NULL, NULL, NULL, supplier.signed_status, supplier.note,
       supplier.created_at, supplier.updated_at
  FROM pending_period_splits split
  JOIN contract_pending original ON original.id = split.pending_id
  JOIN contract_pending_suppliers supplier ON supplier.pending_id = original.id
  JOIN contract_scan_results cloned_scan ON cloned_scan.fingerprint = split.new_fingerprint
  JOIN contract_pending cloned_pending ON cloned_pending.scan_result_id = cloned_scan.id;

UPDATE contract_pending pending_row
JOIN pending_period_splits split ON split.pending_id = pending_row.id
   SET pending_row.contract_period = CAST(split.year_1 AS CHAR);

DROP TEMPORARY TABLE IF EXISTS pending_period_splits;
DROP TEMPORARY TABLE IF EXISTS pending_period_norm;