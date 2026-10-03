const path = require("path");
const fs = require("fs");
const pool = require("../../Database/connection");
const {
  topRecommendations,
  parseCategories,
  normalizeName,
  isHotelOptionScanFile,
} = require("../../Utils/contract_monitoring");
const {
  configuredServerId,
  createScan,
  safeConfiguredRoot,
} = require("../../Services/contract_monitoring/scanner");
const {
  badRequest,
  booleanValue,
  enumValue,
  isValidationError,
  pagination,
  parseId,
  textValue,
} = require("./common");

const MODULE_KEYS = ["CONTRACT", "INFO_STOP_SALES", "QUOTE_TICKET"];

async function cleanupTransientScans() {
  await pool.execute(
    `DELETE FROM contract_scan_runs
      WHERE status IN ('COMPLETED', 'PARTIAL', 'FAILED')`,
  );
  await pool.execute(
    `DELETE r FROM contract_scan_results r
      LEFT JOIN contract_pending p ON p.scan_result_id = r.id
      LEFT JOIN stop_sale_jobs ssj ON ssj.scan_result_id = r.id
      LEFT JOIN contract_scan_run_results rr ON rr.scan_result_id = r.id
     WHERE p.id IS NULL AND ssj.id IS NULL AND rr.scan_result_id IS NULL`,
  );
}

function sourcePayload(body) {
  const year = Number.parseInt(body.year, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2200)
    throw new Error("Tahun tidak valid.");
  const basePath = textValue(body.base_path, "Base path", {
    required: true,
    max: 1024,
  });
  const targetFolder = textValue(body.target_folder, "Target folder", {
    required: true,
    max: 512,
  });
  const enabled = booleanValue(body.enabled, true);
  if (!path.win32.isAbsolute(basePath))
    throw new Error("Base path harus berupa path Windows absolut.");
  if (
    enabled &&
    /^20\d{2}$/.test(path.win32.basename(path.win32.normalize(basePath)))
  ) {
    throw new Error(
      "Base path jangan memasukkan folder tahun. Isi tahun pada field Tahun.",
    );
  }
  if (
    path.win32.isAbsolute(targetFolder) ||
    targetFolder.split(/[\\/]/).includes("..")
  ) {
    throw new Error("Target folder harus berupa path relatif yang aman.");
  }
  return {
    serverId:
      textValue(body.server_id, "Server ID", { max: 100 }) ||
      configuredServerId(),
    year,
    basePath: path.win32.normalize(basePath),
    targetFolder: path.win32.normalize(targetFolder),
    moduleKey: enumValue(
      body.module_key || "CONTRACT",
      MODULE_KEYS,
      "Module key",
      { required: true },
    ),
    enabled,
  };
}

async function validateConfiguredFolder(data) {
  const configuredRoot = safeConfiguredRoot({
    year: data.year,
    base_path: data.basePath,
    target_folder: data.targetFolder,
  });
  if (!data.enabled || data.serverId !== configuredServerId())
    return configuredRoot;
  try {
    const stat = await fs.promises.stat(configuredRoot);
    if (!stat.isDirectory()) throw new Error("Path bukan folder.");
  } catch {
    throw new Error(`Folder scan tidak ditemukan: ${configuredRoot}`);
  }
  return configuredRoot;
}

async function listSources(req, res) {
  try {
    const includeAllServers = req.query.all_servers === "true";
    const [rows] = await pool.execute(
      `SELECT id, server_id, year, base_path, target_folder, module_key, enabled,
              CAST(last_successful_checkpoint_utc AS CHAR) AS last_successful_checkpoint_utc,
              created_at, updated_at
         FROM contract_scan_sources
        WHERE deleted_at IS NULL
          AND module_key IN ('CONTRACT', 'QUOTE_TICKET')
          ${includeAllServers ? "" : "AND server_id = ?"}
        ORDER BY server_id, year, target_folder`,
      includeAllServers ? [] : [configuredServerId()],
    );
    return res.json({
      success: true,
      server_id: configuredServerId(),
      sources: rows,
    });
  } catch (error) {
    console.error("List contract scan sources error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal mengambil konfigurasi scan." });
  }
}

async function listStopSaleSources(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, server_id, year, base_path, target_folder, module_key, enabled,
              CAST(last_successful_checkpoint_utc AS CHAR) AS last_successful_checkpoint_utc,
              created_at, updated_at
         FROM contract_scan_sources
        WHERE deleted_at IS NULL AND server_id = ? AND module_key = 'INFO_STOP_SALES'
        ORDER BY year, target_folder`,
      [configuredServerId()],
    );
    return res.json({ success: true, server_id: configuredServerId(), sources: rows });
  } catch (error) {
    console.error("List stop-sale scan sources error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil folder Stop Sale." });
  }
}

function createStopSaleSource(req, res) {
  req.stopSaleSource = true;
  req.body = { ...(req.body || {}), module_key: "INFO_STOP_SALES" };
  return createSource(req, res);
}

async function updateStopSaleSource(req, res) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, new Error("Scan source ID tidak valid."));
  const [rows] = await pool.execute(
    "SELECT id FROM contract_scan_sources WHERE id = ? AND module_key = 'INFO_STOP_SALES' AND deleted_at IS NULL",
    [id],
  );
  if (!rows.length) return res.status(404).json({ success: false, message: "Folder Stop Sale tidak ditemukan." });
  req.stopSaleSource = true;
  req.body = { ...(req.body || {}), module_key: "INFO_STOP_SALES" };
  return updateSource(req, res);
}

async function deleteStopSaleSource(req, res) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, new Error("Scan source ID tidak valid."));
  const [rows] = await pool.execute(
    "SELECT id FROM contract_scan_sources WHERE id = ? AND module_key = 'INFO_STOP_SALES' AND deleted_at IS NULL",
    [id],
  );
  if (!rows.length) return res.status(404).json({ success: false, message: "Folder Stop Sale tidak ditemukan." });
  req.stopSaleSource = true;
  return deleteSource(req, res);
}

async function createSource(req, res) {
  try {
    const data = sourcePayload(req.body || {});
    if (data.moduleKey === "INFO_STOP_SALES" && !req.stopSaleSource)
      return res.status(403).json({ success: false, message: "Gunakan modul Stop Sale untuk mengelola folder ini." });
    await validateConfiguredFolder(data);
    const [archivedRows] = await pool.execute(
      `SELECT id FROM contract_scan_sources
        WHERE server_id = ? AND year = ? AND base_path = ? AND target_folder = ?
          AND deleted_at IS NOT NULL LIMIT 1`,
      [data.serverId, data.year, data.basePath, data.targetFolder],
    );
    if (archivedRows.length) {
      await pool.execute(
        `UPDATE contract_scan_sources
            SET module_key = ?, enabled = ?, deleted_at = NULL, updated_by = ?
          WHERE id = ?`,
        [data.moduleKey, data.enabled, req.admin.id, archivedRows[0].id],
      );
      return res.status(201).json({
        success: true,
        message: "Scan source berhasil dipulihkan.",
        id: archivedRows[0].id,
      });
    }
    const [result] = await pool.execute(
      `INSERT INTO contract_scan_sources
         (server_id, year, base_path, target_folder, module_key, enabled, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.serverId,
        data.year,
        data.basePath,
        data.targetFolder,
        data.moduleKey,
        data.enabled,
        req.admin.id,
        req.admin.id,
      ],
    );
    return res.status(201).json({
      success: true,
      message: "Scan source berhasil ditambahkan.",
      id: result.insertId,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ success: false, message: "Scan source tersebut sudah ada." });
    if (
      isValidationError(error) ||
      /path|folder|tahun/i.test(error.message || "")
    )
      return badRequest(res, error);
    console.error("Create contract scan source error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal menambahkan konfigurasi scan." });
  }
}

async function updateSource(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Scan source ID tidak valid." });
  try {
    const data = sourcePayload(req.body || {});
    const [existingRows] = await pool.execute(
      "SELECT module_key FROM contract_scan_sources WHERE id = ? AND deleted_at IS NULL",
      [id],
    );
    if (!existingRows.length)
      return res.status(404).json({ success: false, message: "Scan source tidak ditemukan." });
    const existingIsStopSale = existingRows[0].module_key === "INFO_STOP_SALES";
    if (existingIsStopSale !== Boolean(req.stopSaleSource))
      return res.status(403).json({ success: false, message: "Scan source tidak dapat diubah dari modul ini." });
    await validateConfiguredFolder(data);
    const [result] = await pool.execute(
      `UPDATE contract_scan_sources
          SET server_id = ?, year = ?, base_path = ?, target_folder = ?, module_key = ?,
              enabled = ?, updated_by = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [
        data.serverId,
        data.year,
        data.basePath,
        data.targetFolder,
        data.moduleKey,
        data.enabled,
        req.admin.id,
        id,
      ],
    );
    if (!result.affectedRows)
      return res
        .status(404)
        .json({ success: false, message: "Scan source tidak ditemukan." });
    return res.json({
      success: true,
      message: "Scan source berhasil diperbarui.",
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ success: false, message: "Scan source tersebut sudah ada." });
    if (
      isValidationError(error) ||
      /path|folder|tahun/i.test(error.message || "")
    )
      return badRequest(res, error);
    console.error("Update contract scan source error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal memperbarui konfigurasi scan." });
  }
}

async function deleteSource(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Scan source ID tidak valid." });
  try {
    const [existingRows] = await pool.execute(
      "SELECT module_key FROM contract_scan_sources WHERE id = ? AND deleted_at IS NULL",
      [id],
    );
    if (!existingRows.length)
      return res.status(404).json({ success: false, message: "Scan source tidak ditemukan." });
    const existingIsStopSale = existingRows[0].module_key === "INFO_STOP_SALES";
    if (existingIsStopSale !== Boolean(req.stopSaleSource))
      return res.status(403).json({ success: false, message: "Scan source tidak dapat dihapus dari modul ini." });
    const [result] = await pool.execute(
      `UPDATE contract_scan_sources
          SET enabled = 0, deleted_at = CURRENT_TIMESTAMP(3), updated_by = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [req.admin.id, id],
    );
    if (!result.affectedRows)
      return res
        .status(404)
        .json({ success: false, message: "Scan source tidak ditemukan." });
    return res.json({
      success: true,
      message:
        "Konfigurasi folder dihapus. Folder dan file fisik tidak dihapus.",
    });
  } catch (error) {
    console.error("Delete contract scan source error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal menghapus konfigurasi scan." });
  }
}

async function startScan(req, res) {
  try {
    const mode = enumValue(req.body?.mode, ["AUTO", "CUSTOM"], "Mode", {
      required: true,
    });
    const sourceIds =
      req.body?.source_ids === undefined
        ? null
        : Array.from(
            new Set(
              (Array.isArray(req.body.source_ids)
                ? req.body.source_ids
                : []
              ).map(parseId),
            ),
          );
    if (
      sourceIds?.some((id) => !id) ||
      (req.body?.source_ids !== undefined && !sourceIds?.length)
    ) {
      throw new Error("Source IDs tidak valid.");
    }
    await cleanupTransientScans();
    const run = await createScan({
      mode,
      start: req.body?.start,
      end: req.body?.end,
      sourceIds,
      requestedBy: req.admin.id,
    });
    return res.status(202).json({
      success: true,
      message: "Scan mulai dijalankan.",
      scan_id: run.id,
      status: "QUEUED",
      server_id: run.serverId,
      source_count: run.sourceCount,
    });
  } catch (error) {
    if (/Masih ada scan/.test(error.message || ""))
      return res.status(409).json({ success: false, message: error.message });
    if (
      isValidationError(error) ||
      /checkpoint|source|waktu/i.test(error.message || "")
    )
      return badRequest(res, error);
    console.error("Start contract scan error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal memulai scan." });
  }
}

async function startStopSaleScan(req, res) {
  try {
    const mode = enumValue(req.body?.mode, ["AUTO", "CUSTOM"], "Mode", { required: true });
    await cleanupTransientScans();
    const run = await createScan({
      mode,
      start: req.body?.start,
      end: req.body?.end,
      sourceIds: null,
      requestedBy: req.admin.id,
      moduleKeys: ["INFO_STOP_SALES"],
    });
    return res.status(202).json({
      success: true,
      message: "Scan Stop Sale mulai dijalankan.",
      scan_id: run.id,
      status: "QUEUED",
      server_id: run.serverId,
      source_count: run.sourceCount,
    });
  } catch (error) {
    if (/Masih ada scan/.test(error.message || ""))
      return res.status(409).json({ success: false, message: error.message });
    if (isValidationError(error) || /checkpoint|source|waktu|module/i.test(error.message || ""))
      return badRequest(res, error);
    console.error("Start stop-sale scan error:", error);
    return res.status(500).json({ success: false, message: "Gagal memulai scan Stop Sale." });
  }
}

async function stopSaleScanExists(scanId) {
  const [rows] = await pool.execute(
    `SELECT r.scan_run_id
       FROM contract_scan_run_sources r
       JOIN contract_scan_sources s ON s.id = r.source_id
      WHERE r.scan_run_id = ?
      GROUP BY r.scan_run_id
     HAVING SUM(s.module_key = 'INFO_STOP_SALES') > 0
        AND SUM(s.module_key <> 'INFO_STOP_SALES') = 0`,
    [scanId],
  );
  return Boolean(rows.length);
}

async function getStopSaleScan(req, res) {
  const id = parseId(req.params.scanId);
  if (!id || !(await stopSaleScanExists(id)))
    return res.status(404).json({ success: false, message: "Scan Stop Sale tidak ditemukan." });
  return getScan(req, res);
}

async function listStopSaleResults(req, res) {
  const id = parseId(req.params.scanId);
  if (!id || !(await stopSaleScanExists(id)))
    return res.status(404).json({ success: false, message: "Scan Stop Sale tidak ditemukan." });
  const { page, limit, offset } = pagination(req.query);
  try {
    // Office/LibreOffice lock files (".~lock.x.xlsx#", "~$x.xlsx") are not supplier files.
    // An email is left out when its supplier folder already has a PDF/Excel file.
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM contract_scan_run_results rr
         JOIN contract_scan_results r ON r.id = rr.scan_result_id
        WHERE rr.scan_run_id = ?
          AND r.file_name NOT LIKE '.~lock.%' AND r.file_name NOT LIKE '~$%'
          AND NOT (LOWER(r.extension) IN ('eml', '.eml', 'msg', '.msg') AND EXISTS (
            SELECT 1 FROM contract_scan_run_results rr2
              JOIN contract_scan_results r2 ON r2.id = rr2.scan_result_id
             WHERE rr2.scan_run_id = rr.scan_run_id AND r2.parent_path = r.parent_path
               AND LOWER(r2.extension) IN ('pdf', '.pdf', 'xls', '.xls', 'xlsx', '.xlsx', 'xlsm', '.xlsm', 'csv', '.csv')
               AND r2.file_name NOT LIKE '.~lock.%' AND r2.file_name NOT LIKE '~$%'
               AND NOT EXISTS (SELECT 1 FROM stop_sale_removed_results gone WHERE gone.scan_result_id = r2.id)))
          AND NOT EXISTS (SELECT 1 FROM stop_sale_removed_results removed WHERE removed.scan_result_id = r.id)`,
      [id],
    );
    // job_id/job_status let the UI disable "Add to queue" for files already queued.
    const [rows] = await pool.query(
      `SELECT r.id, r.full_path, r.parent_path, r.file_name, r.extension,
              CAST(r.date_modified_utc AS CHAR) AS date_modified_utc, r.file_size,
              r.processed, s.year, s.base_path, s.target_folder, s.module_key,
              ssj.id AS job_id, ssj.status AS job_status
         FROM contract_scan_run_results rr
         JOIN contract_scan_results r ON r.id = rr.scan_result_id
         JOIN contract_scan_sources s ON s.id = r.source_id
         LEFT JOIN stop_sale_jobs ssj ON ssj.scan_result_id = r.id AND ssj.split_index = 0
        WHERE rr.scan_run_id = ?
          AND r.file_name NOT LIKE '.~lock.%' AND r.file_name NOT LIKE '~$%'
          AND NOT (LOWER(r.extension) IN ('eml', '.eml', 'msg', '.msg') AND EXISTS (
            SELECT 1 FROM contract_scan_run_results rr2
              JOIN contract_scan_results r2 ON r2.id = rr2.scan_result_id
             WHERE rr2.scan_run_id = rr.scan_run_id AND r2.parent_path = r.parent_path
               AND LOWER(r2.extension) IN ('pdf', '.pdf', 'xls', '.xls', 'xlsx', '.xlsx', 'xlsm', '.xlsm', 'csv', '.csv')
               AND r2.file_name NOT LIKE '.~lock.%' AND r2.file_name NOT LIKE '~$%'
               AND NOT EXISTS (SELECT 1 FROM stop_sale_removed_results gone WHERE gone.scan_result_id = r2.id)))
          AND NOT EXISTS (SELECT 1 FROM stop_sale_removed_results removed WHERE removed.scan_result_id = r.id)
        ORDER BY r.parent_path, r.date_modified_utc DESC, r.id DESC LIMIT ? OFFSET ?`,
      [id, limit, offset],
    );
    return res.json({ success: true, page, limit, total: countRow.total, results: rows });
  } catch (error) {
    console.error("List stop-sale scan results error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil hasil scan." });
  }
}

async function getScan(req, res) {
  const id = parseId(req.params.scanId);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Scan ID tidak valid." });
  try {
    const [runs] = await pool.execute(
      `SELECT r.id, r.server_id, r.mode, r.requested_start_wita, r.requested_end_wita,
              CAST(r.captured_now_utc AS CHAR) AS captured_now_utc, r.status, r.total_files,
              r.new_files, r.warning_count, r.error_summary, r.started_at, r.finished_at, r.created_at,
              r.requested_by, u.fullname AS requested_by_name
         FROM contract_scan_runs r
         LEFT JOIN users u ON u.id = r.requested_by
         WHERE r.id = ?`,
      [id],
    );
    if (!runs.length)
      return res
        .status(404)
        .json({ success: false, message: "Scan tidak ditemukan." });
    const [sources] = await pool.execute(
      `SELECT rs.source_id, s.year, s.base_path, s.target_folder, s.module_key, rs.status,
              CAST(rs.window_start_utc AS CHAR) AS window_start_utc,
              CAST(rs.window_end_utc AS CHAR) AS window_end_utc,
              rs.error_message
         FROM contract_scan_run_sources rs
         JOIN contract_scan_sources s ON s.id = rs.source_id
        WHERE rs.scan_run_id = ? ORDER BY s.year, s.id`,
      [id],
    );
    return res.json({ success: true, scan: { ...runs[0], sources } });
  } catch (error) {
    console.error("Get contract scan error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal mengambil status scan." });
  }
}

async function listResults(req, res) {
  const scanId = parseId(req.params.scanId);
  if (!scanId)
    return res
      .status(400)
      .json({ success: false, message: "Scan ID tidak valid." });
  const { page, limit, offset } = pagination(req.query);
  try {
    const conditions = ["rr.scan_run_id = ?"];
    const params = [scanId];
    if (req.query.processed === "true" || req.query.processed === "false") {
      conditions.push("r.processed = ?");
      params.push(req.query.processed === "true" ? 1 : 0);
    }
    const where = conditions.join(" AND ");
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM contract_scan_run_results rr
       JOIN contract_scan_results r ON r.id = rr.scan_result_id WHERE ${where}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT r.id, r.full_path, r.parent_path, r.file_name, r.extension,
              CAST(r.date_modified_utc AS CHAR) AS date_modified_utc, r.file_size,
              r.detected_signed_status, r.processed, s.year, s.base_path,
              s.target_folder, s.module_key,
              p.id AS pending_id, p.status AS pending_status
         FROM contract_scan_run_results rr
         JOIN contract_scan_results r ON r.id = rr.scan_result_id
         JOIN contract_scan_sources s ON s.id = r.source_id
         LEFT JOIN contract_pending p ON p.scan_result_id = r.id
        WHERE ${where}
        ORDER BY r.date_modified_utc DESC, r.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return res.json({
      success: true,
      page,
      limit,
      total: countRow.total,
      results: rows.map((row) => ({
        ...row,
        is_hotel_option: isHotelOptionScanFile(row),
      })),
    });
  } catch (error) {
    console.error("List contract scan results error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal mengambil hasil scan." });
  }
}

async function getResult(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Scan result ID tidak valid." });
  try {
    const [rows] = await pool.execute(
      `SELECT r.id, r.source_id, r.full_path, r.parent_path, r.file_name, r.extension,
              CAST(r.date_modified_utc AS CHAR) AS date_modified_utc, r.file_size,
              r.detected_signed_status, r.processed, s.year, s.base_path,
              s.target_folder, s.module_key
         FROM contract_scan_results r
         JOIN contract_scan_sources s ON s.id = r.source_id WHERE r.id = ?`,
      [id],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({ success: false, message: "Hasil scan tidak ditemukan." });
    const item = rows[0];
    item.is_hotel_option = isHotelOptionScanFile(item);
    const [suppliers] = await pool.execute(
      `SELECT supplier_id AS id, company_name AS name, category_supplier, location
         FROM suppliers WHERE LOWER(status) = 'active'`,
    );
    const [groups] = await pool.execute(
      `SELECT id, name FROM contract_management_groups WHERE status = 'ACTIVE'`,
    );
    const supplierRecommendations = topRecommendations(
      item.file_name,
      item.parent_path,
      suppliers,
      0.42,
      5,
      "parent",
    ).map((supplier) => ({
      ...supplier,
      category_supplier: parseCategories(supplier.category_supplier),
    }));
    const groupRecommendations = topRecommendations(
      item.file_name,
      item.parent_path,
      groups,
    );
    return res.json({
      success: true,
      result: item,
      normalized_file_name: normalizeName(item.file_name),
      supplier_recommendations: supplierRecommendations,
      management_group_recommendations: groupRecommendations,
    });
  } catch (error) {
    console.error("Get contract scan result error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal menganalisis hasil scan." });
  }
}

module.exports = {
  createStopSaleSource,
  createSource,
  deleteStopSaleSource,
  deleteSource,
  getResult,
  getScan,
  getStopSaleScan,
  listResults,
  listStopSaleResults,
  listStopSaleSources,
  listSources,
  startStopSaleScan,
  startScan,
  updateStopSaleSource,
  updateSource,
};
