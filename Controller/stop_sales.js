const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const pool = require("../Database/connection");
const { normalizeName, parseCategories } = require("../Utils/contract_monitoring");
const { EXTRACTOR_VERSION, extractStopSales, updateDateIn } = require("../Services/stop_sales/extractor");
const {
  compareSnapshots,
  comparisonFromSummary,
  contiguousRanges,
  dateRange,
  fromSnapshot,
  toSnapshot,
} = require("../Services/stop_sales/compare");
const {
  badRequest,
  dateValue,
  enumValue,
  pagination,
  parseId,
  textValue,
} = require("./contract_monitoring/common");

const JOB_STATUSES = [
  "NEW", "UNMATCHED_SUPPLIER", "PROCESSING", "NO_BASELINE", "COMPARED",
  "NEEDS_REVIEW", "READY_FOR_JAMBIX", "COMPLETED", "DUPLICATE",
  "EXTRACTION_FAILED", "WAITING_PREVIOUS",
];
const DOCUMENT_TYPES = ["FULL_SNAPSHOT", "INCREMENTAL", "UNKNOWN"];
const RESTRICTION_STATUSES = ["STOP_SALE", "ON_REQUEST"];
const BASELINE_ROOT = path.resolve(__dirname, "../uploads/stop-sales");
const PENDING_UPLOAD_ROOT = path.join(BASELINE_ROOT, "pending");
fs.mkdirSync(PENDING_UPLOAD_ROOT, { recursive: true });
const stopSaleUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, PENDING_UPLOAD_ROOT),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "");
      callback(null, `${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set([".xlsx", ".xls", ".pdf", ".png", ".jpg", ".jpeg", ".eml", ".msg"]);
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowed.has(extension)) {
      const error = new Error("Format file harus Excel, PDF, image, EML, atau MSG.");
      error.statusCode = 400;
      return callback(error);
    }
    return callback(null, true);
  },
});

async function removeManagedFile(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  if (resolved === BASELINE_ROOT || !resolved.startsWith(`${BASELINE_ROOT}${path.sep}`)) return;
  await fs.promises.unlink(resolved).catch(() => {});
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function serializeJob(row) {
  const {
    baseline_path: _baselinePath,
    uploaded_path: _uploadedPath,
    ...safeRow
  } = row;
  return {
    ...safeRow,
    is_active_baseline: Boolean(row.is_active_baseline),
    comparison_summary: jsonValue(row.comparison_summary, null),
    source_diff: jsonValue(row.source_diff, []),
    category_supplier: parseCategories(row.category_supplier),
  };
}

async function jobRow(id, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT j.*, r.full_path, r.parent_path, r.file_name, r.extension,
            src.base_path, src.year AS source_year, src.target_folder,
            CAST(r.date_modified_utc AS CHAR) AS date_modified_utc,
            r.file_size, HEX(r.fingerprint) AS fingerprint,
            s.company_name, s.location AS supplier_location, s.category_supplier,
            u.fullname AS completed_by_name
       FROM stop_sale_jobs j
       JOIN contract_scan_results r ON r.id = j.scan_result_id
       JOIN contract_scan_sources src ON src.id = r.source_id
       LEFT JOIN suppliers s ON s.supplier_id = j.supplier_id
       LEFT JOIN users u ON u.id = j.completed_by
      WHERE j.id = ?`,
    [id],
  );
  return rows[0] || null;
}

async function itemsForJob(id, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT i.id, i.job_id, i.product_id, i.detected_product_name,
            i.restriction_status, CAST(i.start_date AS CHAR) AS start_date,
            CAST(i.end_date AS CHAR) AS end_date, i.confidence, i.source_reference,
            p.name AS product_name
       FROM stop_sale_items i
       LEFT JOIN products p ON p.product_id = i.product_id
      WHERE i.job_id = ?
      ORDER BY COALESCE(p.name, i.detected_product_name), i.start_date, i.end_date`,
    [id],
  );
  return rows.map((row) => ({
    ...row,
    confidence: row.confidence === null ? null : Number(row.confidence),
    source_reference: jsonValue(row.source_reference, null),
  }));
}

function fileHash(filePath) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(digest.digest("hex")));
  });
}

function comparisonKey(item) {
  const productKey = item.product_id
    ? `id:${item.product_id}`
    : `name:${normalizeName(item.detected_product_name, { keepGeneric: true })}`;
  return `${productKey}|${item.restriction_status}`;
}

function itemLabel(item) {
  return item.product_name || item.detected_product_name || "Unmapped product";
}

function daySets(items) {
  const groups = new Map();
  for (const item of items) {
    const key = comparisonKey(item);
    if (!groups.has(key)) groups.set(key, { item, dates: new Set() });
    for (const date of dateRange(item.start_date, item.end_date)) groups.get(key).dates.add(date);
  }
  return groups;
}

function compareItems(baselineItems, currentItems) {
  const before = daySets(baselineItems);
  const after = daySets(currentItems);
  const actions = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const oldGroup = before.get(key);
    const newGroup = after.get(key);
    const metadata = newGroup?.item || oldGroup?.item;
    const oldDates = oldGroup?.dates || new Set();
    const newDates = newGroup?.dates || new Set();
    const added = [...newDates].filter((date) => !oldDates.has(date));
    const removed = [...oldDates].filter((date) => !newDates.has(date));
    const same = [...newDates].filter((date) => oldDates.has(date));
    for (const range of contiguousRanges(added)) actions.push({
      ...range, change: "ADDED", product_id: metadata.product_id,
      product_name: itemLabel(metadata), restriction_status: metadata.restriction_status,
    });
    for (const range of contiguousRanges(removed)) actions.push({
      ...range, change: "REMOVED", product_id: metadata.product_id,
      product_name: itemLabel(metadata), restriction_status: metadata.restriction_status,
    });
    for (const range of contiguousRanges(same)) actions.push({
      ...range, change: "UNCHANGED", product_id: metadata.product_id,
      product_name: itemLabel(metadata), restriction_status: metadata.restriction_status,
    });
  }
  actions.sort((a, b) => a.product_name.localeCompare(b.product_name) || a.start_date.localeCompare(b.start_date));
  return {
    actions,
    summary: {
      added_days: actions.filter((item) => item.change === "ADDED").reduce((sum, item) => sum + dateRange(item.start_date, item.end_date).length, 0),
      removed_days: actions.filter((item) => item.change === "REMOVED").reduce((sum, item) => sum + dateRange(item.start_date, item.end_date).length, 0),
      unchanged_days: actions.filter((item) => item.change === "UNCHANGED").reduce((sum, item) => sum + dateRange(item.start_date, item.end_date).length, 0),
    },
  };
}

function extractionSummary(result) {
  if (!result) return null;
  return {
    supported: result.supported,
    detected_days: result.entries.length,
    rooms: [...new Set(result.entries.map((entry) => entry.room))].length,
    legend: result.legend || null,
    warnings: result.warnings,
  };
}

// A manual upload wins; otherwise the file found by the folder scan is used directly.
function sourceFile(job) {
  if (job.uploaded_path && fs.existsSync(job.uploaded_path))
    return { mode: "UPLOAD", path: job.uploaded_path, name: job.uploaded_file_name || path.basename(job.uploaded_path) };
  if (job.full_path && fs.existsSync(job.full_path))
    return { mode: "SCAN", path: job.full_path, name: job.file_name || path.basename(job.full_path) };
  return null;
}

// Identifies one version of a file, so a saved or cached extraction is only reused for it.
function sourceKey(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${EXTRACTOR_VERSION}|${filePath}|${stat.size}|${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

// Extraction can take seconds (OCR, Google Sheet download). The preview and Compare read
// the same file, so concurrent and repeated reads share one result.
const extractionCache = new Map();
function readStopSales(filePath, fileName) {
  const key = sourceKey(filePath);
  if (!key) return extractStopSales(filePath, fileName);
  if (!extractionCache.has(key)) {
    const pending = extractStopSales(filePath, fileName);
    extractionCache.set(key, pending);
    pending.catch(() => extractionCache.delete(key));
    while (extractionCache.size > 30) extractionCache.delete(extractionCache.keys().next().value);
  }
  return extractionCache.get(key);
}

// When the supplier updated this file: "... - updated on 02 Oct" in the folder name, an
// "as of" date in the file name, or else the date the file was last modified.
function updateDate(job) {
  const modified = job.date_modified_utc ? new Date(`${String(job.date_modified_utc).replace(" ", "T")}Z`) : null;
  const reference = modified && !Number.isNaN(modified.getTime()) ? modified : new Date();
  const names = [...String(job.parent_path || "").split(/[\\/]/).reverse(), job.file_name, job.uploaded_file_name];
  for (const name of names) {
    const date = updateDateIn(name, reference);
    if (date) return date;
  }
  return modified && !Number.isNaN(modified.getTime()) ? modified.toISOString().slice(0, 10) : null;
}

function serializeJobWithSource(job) {
  const source = sourceFile(job);
  return {
    ...serializeJob(job),
    source_mode: source?.mode || null,
    source_file_name: source?.name || null,
    update_date: updateDate(job),
  };
}

// Reads the source file right away so its stop sales are visible before a
// supplier is chosen or Compare is run. Nothing is compared yet (all CURRENT).
async function buildPreviewSummary(filePath, fileName, fromDate = null) {
  try {
    const current = await readStopSales(filePath, fileName);
    const { context } = compareSnapshots([], current.entries, { hasBaseline: false, fromDate });
    return {
      version: 2,
      extractor_version: EXTRACTOR_VERSION,
      preview: true,
      update_date: fromDate,
      source_key: sourceKey(filePath),
      snapshot: toSnapshot(current.entries),
      calendar_changes: [],
      current_stop_sales: context,
      extraction: {
        current: extractionSummary(current),
        baseline: null,
        warnings: ["Preview: belum dibandingkan dengan baseline. Pilih supplier lalu klik Compare."],
      },
    };
  } catch (error) {
    console.error("Stop-sale preview error:", error);
    return {
      version: 2,
      extractor_version: EXTRACTOR_VERSION,
      preview: true,
      calendar_changes: [],
      current_stop_sales: [],
      extraction: { current: null, baseline: null, warnings: [`Preview gagal: ${error.message}`] },
    };
  }
}

// Jobs without a summary (new from scan, or older uploads) get a preview generated and saved.
async function ensurePreview(job) {
  let summary = jsonValue(job.comparison_summary, null);
  const source = sourceFile(job);
  const stalePreview = summary?.preview && summary.extractor_version !== EXTRACTOR_VERSION;
  if ((!(summary?.version >= 2) || stalePreview) && !job.processed_at && source) {
    summary = await buildPreviewSummary(source.path, source.name, updateDate(job));
    await pool.execute(
      "UPDATE stop_sale_jobs SET comparison_summary = ? WHERE id = ? AND processed_at IS NULL",
      [JSON.stringify(summary), job.id],
    );
  }
  return summary;
}

async function createJob(req, res) {
  const scanResultId = parseId(req.params.scanResultId);
  if (!scanResultId) return badRequest(res, new Error("Hasil scan tidak valid."));
  try {
    const [rows] = await pool.execute(
      `SELECT r.id FROM contract_scan_results r
       JOIN contract_scan_sources s ON s.id = r.source_id
       WHERE r.id = ? AND s.module_key = 'INFO_STOP_SALES'`,
      [scanResultId],
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "File Stop Sale tidak ditemukan." });
    const [result] = await pool.execute(
      "INSERT INTO stop_sale_jobs (scan_result_id, split_index) VALUES (?, 0) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
      [scanResultId],
    );
    // Read the file in the background so opening the job does not wait for it.
    jobRow(result.insertId).then((job) => job && ensurePreview(job))
      .catch((error) => console.error("Stop-sale preview warm-up error:", error));
    return res.status(result.affectedRows === 1 ? 201 : 200).json({ success: true, job_id: result.insertId });
  } catch (error) {
    console.error("Create stop-sale job error:", error);
    return res.status(500).json({ success: false, message: "Gagal menambahkan file ke queue." });
  }
}

// A folder such as "K CLUB & KANVA UBUD" covers two hotels: the same file is queued
// again as a separate job so each supplier gets its own supplier, baseline and compare.
async function addSupplierJob(req, res) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, new Error("Job tidak valid."));
  try {
    const job = await jobRow(id);
    if (!job) return res.status(404).json({ success: false, message: "Job tidak ditemukan." });
    const [[next]] = await pool.execute(
      "SELECT COALESCE(MAX(split_index), 0) + 1 AS value FROM stop_sale_jobs WHERE scan_result_id = ?",
      [job.scan_result_id],
    );
    if (next.value > 9) return badRequest(res, new Error("File ini sudah dipakai untuk terlalu banyak supplier."));
    const [result] = await pool.execute(
      "INSERT INTO stop_sale_jobs (scan_result_id, split_index) VALUES (?, ?)",
      [job.scan_result_id, next.value],
    );
    jobRow(result.insertId).then((created) => created && ensurePreview(created))
      .catch((error) => console.error("Stop-sale preview warm-up error:", error));
    return res.status(201).json({ success: true, job_id: result.insertId });
  } catch (error) {
    console.error("Add stop-sale supplier job error:", error);
    return res.status(500).json({ success: false, message: "Gagal menambahkan supplier untuk file ini." });
  }
}

// Removes a job from the Pending Queue (and its manual upload). Completed jobs are the
// supplier's history/baseline and stay.
async function deleteJob(req, res) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, new Error("Job tidak valid."));
  try {
    const job = await jobRow(id);
    if (!job) return res.status(404).json({ success: false, message: "Job tidak ditemukan." });
    if (job.is_active_baseline || job.status === "COMPLETED")
      return res.status(409).json({ success: false, message: "Job yang sudah Complete tidak bisa dihapus dari queue." });
    await pool.execute("DELETE FROM stop_sale_jobs WHERE id = ? AND is_active_baseline = 0 AND status <> 'COMPLETED'", [id]);
    await removeManagedFile(job.uploaded_path);
    return res.json({ success: true, message: "Job dihapus dari Pending Queue." });
  } catch (error) {
    console.error("Delete stop-sale job error:", error);
    return res.status(500).json({ success: false, message: "Gagal menghapus job dari queue." });
  }
}

// Hides a file from the scan results (the file on the drive is not touched).
async function removeScanResult(req, res) {
  const scanResultId = parseId(req.params.scanResultId);
  if (!scanResultId) return badRequest(res, new Error("Hasil scan tidak valid."));
  try {
    const [[queued]] = await pool.execute(
      "SELECT COUNT(*) AS total FROM stop_sale_jobs WHERE scan_result_id = ? AND status <> 'COMPLETED' AND is_active_baseline = 0",
      [scanResultId],
    );
    if (queued.total) return res.status(409).json({ success: false, message: "File masih ada di Pending Queue. Hapus dari queue dulu." });
    await pool.execute(
      "INSERT IGNORE INTO stop_sale_removed_results (scan_result_id, removed_by) VALUES (?, ?)",
      [scanResultId, req.admin?.id || null],
    );
    return res.json({ success: true, message: "File dihapus dari hasil scan." });
  } catch (error) {
    console.error("Remove stop-sale scan result error:", error);
    return res.status(500).json({ success: false, message: "Gagal menghapus file dari hasil scan." });
  }
}

async function listJobs(req, res) {
  const { page, limit, offset } = pagination(req.query);
  try {
    const statuses = (Array.isArray(req.query.status) ? req.query.status : req.query.status ? [req.query.status] : [])
      .map((value) => String(value).toUpperCase()).filter((value) => JOB_STATUSES.includes(value));
    const where = statuses.length ? `WHERE j.status IN (${statuses.map(() => "?").join(",")})` : "";
    const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM stop_sale_jobs j ${where}`, statuses);
    const [rows] = await pool.query(
      `SELECT j.*, r.file_name, r.full_path, r.parent_path, r.extension,
              src.base_path, src.year AS source_year, src.target_folder,
              CAST(r.date_modified_utc AS CHAR) AS date_modified_utc, r.file_size,
              s.company_name, s.location AS supplier_location, s.category_supplier,
              u.fullname AS completed_by_name
         FROM stop_sale_jobs j
         JOIN contract_scan_results r ON r.id = j.scan_result_id
         JOIN contract_scan_sources src ON src.id = r.source_id
         LEFT JOIN suppliers s ON s.supplier_id = j.supplier_id
         LEFT JOIN users u ON u.id = j.completed_by
         ${where}
         ORDER BY j.is_active_baseline DESC, j.updated_at DESC
         LIMIT ? OFFSET ?`,
      [...statuses, limit, offset],
    );
    return res.json({ success: true, page, limit, total: count.total, jobs: rows.map(serializeJob) });
  } catch (error) {
    console.error("List stop-sale jobs error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil Stop Sale queue." });
  }
}

async function getJob(req, res) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, new Error("Job tidak valid."));
  try {
    const job = await jobRow(id);
    if (!job) return res.status(404).json({ success: false, message: "Job tidak ditemukan." });
    const items = await itemsForJob(id);
    let baseline = null;
    let baselineItems = [];
    if (job.supplier_id) {
      const [rows] = await pool.execute(
        `SELECT j.id FROM stop_sale_jobs j
         WHERE j.supplier_id = ? AND j.is_active_baseline = 1 AND j.id <> ? LIMIT 1`,
        [job.supplier_id, id],
      );
      if (rows.length) {
        baseline = serializeJob(await jobRow(rows[0].id));
        baselineItems = await itemsForJob(rows[0].id);
      }
    }
    const storedSummary = await ensurePreview(job);
    // Summaries from the old cell-diff compare (no version) are not trusted; re-run Compare.
    const comparison = storedSummary?.version >= 2
      ? comparisonFromSummary(storedSummary)
      : compareItems(baselineItems, items);
    return res.json({
      success: true,
      job: serializeJobWithSource(job),
      items,
      baseline,
      baseline_items: baselineItems,
      comparison,
    });
  } catch (error) {
    console.error("Get stop-sale job error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil detail Stop Sale." });
  }
}

async function updateJob(req, res) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, new Error("Job tidak valid."));
  try {
    const supplierId = req.body?.supplier_id === null ? null : parseId(req.body?.supplier_id);
    if (!supplierId) throw new Error("Supplier wajib dipilih.");
    const documentType = enumValue(req.body?.document_type || "UNKNOWN", DOCUMENT_TYPES, "Document type", { required: true });
    const note = textValue(req.body?.note, "Catatan", { max: 4000 });
    const [suppliers] = await pool.execute("SELECT supplier_id FROM suppliers WHERE supplier_id = ?", [supplierId]);
    if (!suppliers.length) throw new Error("Supplier tidak ditemukan.");
    await pool.execute(
      `UPDATE stop_sale_jobs SET supplier_id = ?, document_type = ?, note = ?,
              status = CASE WHEN status IN ('NEW','UNMATCHED_SUPPLIER') THEN 'NEW' ELSE status END
        WHERE id = ? AND is_active_baseline = 0`,
      [supplierId, documentType, note, id],
    );
    return res.json({ success: true, message: "Supplier dan tipe dokumen disimpan." });
  } catch (error) {
    if (/wajib|tidak ditemukan|valid/i.test(error.message || "")) return badRequest(res, error);
    console.error("Update stop-sale job error:", error);
    return res.status(500).json({ success: false, message: "Gagal memperbarui job." });
  }
}

async function uploadJobFile(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    await removeManagedFile(req.file?.path);
    return badRequest(res, new Error("Job tidak valid."));
  }
  if (!req.file) return badRequest(res, new Error("Pilih file Stop Sale untuk dibandingkan."));
  try {
    const job = await jobRow(id);
    if (!job || job.is_active_baseline || job.status === "COMPLETED") {
      await removeManagedFile(req.file.path);
      return res.status(409).json({ success: false, message: "Job tidak dapat menerima upload baru." });
    }
    const oldUploadPath = job.uploaded_path;
    await pool.execute(
      `UPDATE stop_sale_jobs
          SET uploaded_path = ?, uploaded_file_name = ?, uploaded_mime_type = ?,
              uploaded_file_size = ?, status = 'NEW', source_diff = NULL,
              comparison_summary = NULL, processed_at = NULL
        WHERE id = ?`,
      [req.file.path, req.file.originalname, req.file.mimetype, req.file.size, id],
    );
    if (oldUploadPath && path.resolve(oldUploadPath) !== path.resolve(req.file.path))
      await removeManagedFile(oldUploadPath);
    const preview = await buildPreviewSummary(req.file.path, req.file.originalname, updateDate(job));
    await pool.execute(
      "UPDATE stop_sale_jobs SET comparison_summary = ? WHERE id = ? AND processed_at IS NULL",
      [JSON.stringify(preview), id],
    );
    return res.json({
      success: true,
      message: "File Stop Sale siap dibandingkan.",
      file: { name: req.file.originalname, size: req.file.size, mime_type: req.file.mimetype },
    });
  } catch (error) {
    await removeManagedFile(req.file.path);
    console.error("Upload stop-sale comparison file error:", error);
    return res.status(500).json({ success: false, message: "Gagal menyimpan file Stop Sale." });
  }
}

async function clearJobUpload(req, res) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, new Error("Job tidak valid."));
  try {
    const job = await jobRow(id);
    if (!job || job.is_active_baseline || job.status === "COMPLETED")
      return res.status(409).json({ success: false, message: "Job tidak dapat diubah." });
    await pool.execute(
      `UPDATE stop_sale_jobs
          SET uploaded_path = NULL, uploaded_file_name = NULL, uploaded_mime_type = NULL,
              uploaded_file_size = NULL, status = 'NEW', source_diff = NULL,
              comparison_summary = NULL, processed_at = NULL
        WHERE id = ?`,
      [id],
    );
    await removeManagedFile(job.uploaded_path);
    return res.json({ success: true, message: "Upload manual dihapus, kembali memakai file hasil scan." });
  } catch (error) {
    console.error("Clear stop-sale upload error:", error);
    return res.status(500).json({ success: false, message: "Gagal menghapus upload manual." });
  }
}

async function processJob(req, res) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, new Error("Job tidak valid."));
  try {
    const job = await jobRow(id);
    if (!job) return res.status(404).json({ success: false, message: "Job tidak ditemukan." });
    if (!job.supplier_id) return badRequest(res, new Error("Pilih supplier sebelum Process."));
    await pool.execute("UPDATE stop_sale_jobs SET status = 'PROCESSING' WHERE id = ?", [id]);
    const [baselines] = await pool.execute(
      `SELECT j.id, j.baseline_path, j.comparison_summary, HEX(r.fingerprint) AS fingerprint
         FROM stop_sale_jobs j JOIN contract_scan_results r ON r.id = j.scan_result_id
        WHERE j.supplier_id = ? AND j.is_active_baseline = 1 AND j.id <> ? LIMIT 1`,
      [job.supplier_id, id],
    );
    const baseline = baselines[0] || null;
    const baselinePath = baseline?.baseline_path && fs.existsSync(baseline.baseline_path)
      ? baseline.baseline_path : null;
    const source = sourceFile(job);
    if (!source) throw new Error("Upload file Stop Sale: file hasil scan tidak bisa diakses dari server.");
    if (baselinePath && await fileHash(baselinePath) === await fileHash(source.path)) {
      await pool.execute("UPDATE stop_sale_jobs SET status = 'DUPLICATE', processed_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [id]);
      return res.json({ success: true, status: "DUPLICATE", source_diff: [] });
    }
    // The preview already read this exact file; reuse it instead of reading it again.
    const preview = jsonValue(job.comparison_summary, null);
    const current = preview?.preview && preview.snapshot && preview.extraction?.current
      && preview.source_key === sourceKey(source.path)
      ? {
        supported: preview.extraction.current.supported,
        entries: fromSnapshot(preview.snapshot),
        warnings: preview.extraction.current.warnings || [],
        legend: preview.extraction.current.legend,
      }
      : await readStopSales(source.path, source.name);
    // Prefer what the baseline file said when it was compared (stored snapshot);
    // re-reading it could give different data (live Google Sheet) and repeats OCR.
    const baselineSnapshot = jsonValue(baseline?.comparison_summary, null)?.snapshot;
    const previous = baselineSnapshot
      ? { supported: true, entries: fromSnapshot(baselineSnapshot), warnings: [], legend: null }
      : baselinePath ? await readStopSales(baselinePath) : null;
    const fromDate = updateDate(job);
    const { changes, context } = compareSnapshots(previous?.entries || [], current.entries, {
      fromDate,
      hasBaseline: Boolean(previous),
      incremental: job.document_type === "INCREMENTAL",
    });
    const warnings = [];
    if (baseline && !previous) warnings.push("Baseline metadata ditemukan tetapi file baseline tidak tersedia.");
    if (!baseline) warnings.push("Belum ada baseline: stop sale di file ini ditampilkan sebagai kondisi saat ini, bukan perubahan.");
    if (previous && !previous.supported) warnings.push("File baseline tidak bisa dibaca otomatis, hasil compare tidak bisa dipercaya.");
    const needsReview = !current.supported || (previous && !previous.supported) || (baseline && !previous);
    const status = needsReview ? "NEEDS_REVIEW" : "READY_FOR_JAMBIX";
    const summary = {
      version: 2,
      baseline_job_id: baseline?.id || null,
      baseline_available: Boolean(previous),
      update_date: fromDate,
      source_mode: source.mode,
      snapshot: toSnapshot(current.entries),
      has_changes: changes.length > 0,
      calendar_changes: changes,
      current_stop_sales: context,
      extraction: {
        current: extractionSummary(current),
        baseline: extractionSummary(previous),
        warnings,
      },
    };
    const sourceDiff = changes;
    await pool.execute(
      `UPDATE stop_sale_jobs SET status = ?, source_diff = ?, comparison_summary = ?,
              processed_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
      [status, JSON.stringify(sourceDiff), JSON.stringify(summary), id],
    );
    return res.json({ success: true, status, source_diff: sourceDiff, summary });
  } catch (error) {
    await pool.execute("UPDATE stop_sale_jobs SET status = 'EXTRACTION_FAILED' WHERE id = ?", [id]).catch(() => {});
    if (/Pilih supplier|Upload file/i.test(error.message || "")) return badRequest(res, error);
    console.error("Process stop-sale job error:", error);
    return res.status(500).json({ success: false, message: "Gagal membandingkan file Stop Sale." });
  }
}

async function saveItems(req, res) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, new Error("Job tidak valid."));
  const connection = await pool.getConnection();
  try {
    const job = await jobRow(id, connection);
    if (!job || job.is_active_baseline) throw new Error("Job tidak dapat diubah.");
    if (!job.supplier_id) throw new Error("Supplier wajib dipilih.");
    if (!Array.isArray(req.body?.items)) throw new Error("Items wajib berupa array.");
    const items = req.body.items.map((item, index) => {
      const productId = item.product_id ? parseId(item.product_id) : null;
      const detectedName = textValue(item.detected_product_name, `Nama product baris ${index + 1}`, { max: 255 });
      if (!productId && !detectedName) throw new Error(`Product baris ${index + 1} wajib dipilih.`);
      const startDate = dateValue(item.start_date, `Tanggal mulai baris ${index + 1}`, { required: true });
      const endDate = dateValue(item.end_date, `Tanggal selesai baris ${index + 1}`, { required: true });
      if (endDate < startDate) throw new Error(`Tanggal selesai baris ${index + 1} tidak boleh lebih awal.`);
      return {
        productId,
        detectedName,
        restrictionStatus: enumValue(item.restriction_status || "STOP_SALE", RESTRICTION_STATUSES, "Status", { required: true }),
        startDate,
        endDate,
        confidence: item.confidence === null || item.confidence === undefined ? null : Math.max(0, Math.min(1, Number(item.confidence))),
        sourceReference: item.source_reference ? JSON.stringify(item.source_reference) : null,
      };
    });
    const productIds = [...new Set(items.map((item) => item.productId).filter(Boolean))];
    if (productIds.length) {
      const [products] = await connection.query(
        `SELECT product_id FROM products WHERE supplier_id = ? AND product_id IN (${productIds.map(() => "?").join(",")})`,
        [job.supplier_id, ...productIds],
      );
      if (products.length !== productIds.length) throw new Error("Ada product yang bukan milik supplier ini.");
    }
    await connection.beginTransaction();
    await connection.execute("DELETE FROM stop_sale_items WHERE job_id = ?", [id]);
    for (const item of items) {
      await connection.execute(
        `INSERT INTO stop_sale_items
           (job_id, product_id, detected_product_name, restriction_status,
            start_date, end_date, confidence, source_reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, item.productId, item.detectedName, item.restrictionStatus, item.startDate, item.endDate, item.confidence, item.sourceReference],
      );
    }
    await connection.execute(
      `UPDATE stop_sale_jobs SET status = 'READY_FOR_JAMBIX',
              extraction_confidence = ? WHERE id = ?`,
      [items.length ? Math.min(...items.map((item) => item.confidence ?? 1)) : null, id],
    );
    await connection.commit();
    return res.json({ success: true, message: "Stop Sale items disimpan.", item_count: items.length });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (/wajib|tidak boleh|bukan milik|tidak dapat/i.test(error.message || "")) return badRequest(res, error);
    console.error("Save stop-sale items error:", error);
    return res.status(500).json({ success: false, message: "Gagal menyimpan Stop Sale items." });
  } finally {
    connection.release();
  }
}

async function completeJob(req, res) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, new Error("Job tidak valid."));
  const connection = await pool.getConnection();
  let temporaryPath = null;
  let createdBaselinePath = null;
  let committed = false;
  try {
    const job = await jobRow(id, connection);
    if (!job) return res.status(404).json({ success: false, message: "Job tidak ditemukan." });
    if (!job.supplier_id) throw new Error("Supplier wajib dipilih.");
    // NEEDS_REVIEW (e.g. image/scanned file) can be completed after a manual check.
    if (!["READY_FOR_JAMBIX", "NEEDS_REVIEW"].includes(job.status))
      throw new Error("Jalankan Compare sebelum Complete.");
    const source = sourceFile(job);
    if (!source) throw new Error("File Stop Sale tidak lagi tersedia.");
    await fs.promises.mkdir(BASELINE_ROOT, { recursive: true });
    const extension = String(path.extname(source.name).slice(1) || "bin")
      .replace(/[^a-z0-9]/gi, "").toLowerCase();
    const baselinePath = path.join(BASELINE_ROOT, `supplier-${job.supplier_id}-job-${id}.${extension}`);
    temporaryPath = path.join(BASELINE_ROOT, `.pending-${id}-${crypto.randomUUID()}.${extension}`);
    await fs.promises.copyFile(source.path, temporaryPath);
    await fs.promises.rename(temporaryPath, baselinePath);
    temporaryPath = null;
    createdBaselinePath = baselinePath;

    await connection.beginTransaction();
    const [oldRows] = await connection.execute(
      "SELECT id, baseline_path FROM stop_sale_jobs WHERE supplier_id = ? AND is_active_baseline = 1 AND id <> ? FOR UPDATE",
      [job.supplier_id, id],
    );
    await connection.execute(
      `UPDATE stop_sale_jobs
          SET is_active_baseline = 0, baseline_path = NULL, source_diff = NULL
        WHERE supplier_id = ? AND is_active_baseline = 1 AND id <> ?`,
      [job.supplier_id, id],
    );
    await connection.execute(
      `UPDATE stop_sale_jobs
          SET status = 'COMPLETED', is_active_baseline = 1, baseline_path = ?,
              uploaded_path = NULL,
              completed_at = CURRENT_TIMESTAMP(3), completed_by = ?
        WHERE id = ?`,
      [baselinePath, req.admin.id, id],
    );
    await connection.execute(
      "UPDATE contract_scan_results SET processed = 1, processed_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [job.scan_result_id],
    );
    await connection.commit();
    committed = true;
    await removeManagedFile(job.uploaded_path);
    for (const old of oldRows) {
      if (!old.baseline_path || path.resolve(old.baseline_path) === path.resolve(baselinePath)) continue;
      const resolved = path.resolve(old.baseline_path);
      if (resolved.startsWith(`${BASELINE_ROOT}${path.sep}`)) await fs.promises.unlink(resolved).catch(() => {});
    }
    return res.json({ success: true, message: "Stop Sale selesai dan baseline baru sudah aktif." });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (temporaryPath) await fs.promises.unlink(temporaryPath).catch(() => {});
    if (!committed && createdBaselinePath)
      await fs.promises.unlink(createdBaselinePath).catch(() => {});
    if (/wajib|sebelum Complete|tidak lagi tersedia/i.test(error.message || "")) return badRequest(res, error);
    console.error("Complete stop-sale job error:", error);
    return res.status(500).json({ success: false, message: "Gagal menyelesaikan Stop Sale." });
  } finally {
    connection.release();
  }
}

async function searchSuppliers(req, res) {
  const keyword = String(req.query.q || "").trim();
  try {
    const term = `%${keyword}%`;
    const [rows] = await pool.execute(
      `SELECT supplier_id, company_name, location, category_supplier
         FROM suppliers
        WHERE LOWER(status) = 'active' AND (? = '' OR company_name LIKE ?)
        ORDER BY company_name LIMIT 30`,
      [keyword, term],
    );
    return res.json({ success: true, suppliers: rows.map((row) => ({ ...row, category_supplier: parseCategories(row.category_supplier) })) });
  } catch (error) {
    console.error("Search stop-sale suppliers error:", error);
    return res.status(500).json({ success: false, message: "Gagal mencari supplier." });
  }
}

async function listProducts(req, res) {
  const supplierId = parseId(req.query.supplier_id);
  if (!supplierId) return badRequest(res, new Error("Supplier wajib dipilih."));
  try {
    const [rows] = await pool.execute(
      "SELECT product_id, name, type, status FROM products WHERE supplier_id = ? ORDER BY name",
      [supplierId],
    );
    return res.json({ success: true, products: rows });
  } catch (error) {
    console.error("List stop-sale products error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil product." });
  }
}

async function listReports(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT j.id AS job_id, j.supplier_id, s.company_name,
              CAST(r.first_seen_at AS CHAR) AS in_dropbox_email,
              CAST(j.completed_at AS CHAR) AS in_jambix,
              u.fullname AS user_who_update, j.note,
              COALESCE(JSON_LENGTH(JSON_EXTRACT(j.comparison_summary, '$.calendar_changes')), 0)
                AS detected_change_count
         FROM stop_sale_jobs j
         JOIN suppliers s ON s.supplier_id = j.supplier_id
         JOIN contract_scan_results r ON r.id = j.scan_result_id
         LEFT JOIN users u ON u.id = j.completed_by
        WHERE j.is_active_baseline = 1
        GROUP BY j.id, j.supplier_id, s.company_name, r.first_seen_at,
                 j.completed_at, u.fullname, j.note, j.comparison_summary
        ORDER BY s.company_name`,
    );
    return res.json({ success: true, reports: rows });
  } catch (error) {
    console.error("List stop-sale reports error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil Stop Sale report." });
  }
}

module.exports = {
  completeJob,
  createJob,
  getJob,
  listJobs,
  listProducts,
  listReports,
  processJob,
  saveItems,
  searchSuppliers,
  updateJob,
  uploadJobFile: [stopSaleUpload.single("file"), uploadJobFile],
  clearJobUpload,
  addSupplierJob,
  deleteJob,
  removeScanResult,
};
