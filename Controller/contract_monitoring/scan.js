const path = require("path");
const fs = require("fs");
const pool = require("../../Database/connection");
const {
  topRecommendations,
  parseCategories,
  normalizeName,
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
      LEFT JOIN contract_scan_run_results rr ON rr.scan_result_id = r.id
     WHERE p.id IS NULL AND rr.scan_result_id IS NULL`,
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
        WHERE deleted_at IS NULL ${includeAllServers ? "" : "AND server_id = ?"}
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

async function createSource(req, res) {
  try {
    const data = sourcePayload(req.body || {});
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

async function getScan(req, res) {
  const id = parseId(req.params.scanId);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Scan ID tidak valid." });
  try {
    const [runs] = await pool.execute(
      `SELECT id, server_id, mode, requested_start_wita, requested_end_wita,
              CAST(captured_now_utc AS CHAR) AS captured_now_utc, status, total_files,
              new_files, warning_count, error_summary, started_at, finished_at, created_at
         FROM contract_scan_runs WHERE id = ?`,
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
              r.detected_signed_status, r.processed, s.year, s.module_key,
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
      results: rows,
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
  createSource,
  deleteSource,
  getResult,
  getScan,
  listResults,
  listSources,
  startScan,
  updateSource,
};
