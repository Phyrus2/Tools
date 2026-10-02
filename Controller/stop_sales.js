const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const XLSX = require("xlsx");
const pool = require("../Database/connection");
const { normalizeName, parseCategories } = require("../Utils/contract_monitoring");
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
            CAST(r.date_modified_utc AS CHAR) AS date_modified_utc,
            r.file_size, HEX(r.fingerprint) AS fingerprint,
            s.company_name, s.location AS supplier_location, s.category_supplier,
            u.fullname AS completed_by_name
       FROM stop_sale_jobs j
       JOIN contract_scan_results r ON r.id = j.scan_result_id
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

function cellMap(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true, cellFormula: true, cellStyles: true });
  const result = new Map();
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith("!")) continue;
      result.set(`${sheetName}!${address}`, {
        sheet: sheetName,
        cell: address,
        raw: cell.v,
        type: cell.t || null,
        numberFormat: cell.z || null,
        value: cell.w ?? (cell.v === undefined ? null : String(cell.v)),
        formula: cell.f || null,
        style: cell.s || null,
        styleSignature: cell.s ? JSON.stringify(cell.s) : null,
      });
    }
  }
  return result;
}

function dateFromCell(cell) {
  if (!cell) return null;
  if (cell.raw instanceof Date && !Number.isNaN(cell.raw.getTime()))
    return cell.raw.toISOString().slice(0, 10);
  if (typeof cell.raw === "number" && cell.numberFormat && XLSX.SSF.is_date(cell.numberFormat)) {
    const parsed = XLSX.SSF.parse_date_code(cell.raw);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = String(cell.value || "").trim();
  if (!text || !/[0-9]/.test(text) || /^\d{1,2}$/.test(text)) return null;
  const iso = /^(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

const MONTH_NAMES = new Map([
  ["jan", 1], ["january", 1], ["januari", 1], ["feb", 2], ["february", 2], ["februari", 2],
  ["mar", 3], ["march", 3], ["maret", 3], ["apr", 4], ["april", 4], ["may", 5], ["mei", 5],
  ["jun", 6], ["june", 6], ["juni", 6], ["jul", 7], ["july", 7], ["juli", 7],
  ["aug", 8], ["august", 8], ["agu", 8], ["agustus", 8], ["sep", 9], ["september", 9],
  ["oct", 10], ["october", 10], ["okt", 10], ["oktober", 10], ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12], ["des", 12], ["desember", 12],
]);

function monthYearFromText(value) {
  const text = String(value || "").toLowerCase();
  const year = /(?:19|20)\d{2}/.exec(text)?.[0];
  const monthEntry = [...MONTH_NAMES].find(([name]) => new RegExp(`\\b${name}\\b`, "i").test(text));
  return year && monthEntry ? { year: Number(year), month: monthEntry[1] } : null;
}

function isMarkedCell(cell) {
  if (!cell) return false;
  const text = String(cell.value ?? "").trim();
  if (text && !/^(?:-|n\/a|na)$/i.test(text)) return true;
  const fill = cell.style?.fill;
  const color = fill?.fgColor?.rgb || fill?.fgColor?.indexed || fill?.fgColor?.theme;
  return Boolean(fill && fill.patternType && fill.patternType !== "none" && color !== undefined);
}

function cellByPosition(map, sheet, row, column) {
  return map.get(`${sheet}!${XLSX.utils.encode_cell({ r: row, c: column })}`) || null;
}

function findDateHeader(before, after, sheet, row, column) {
  for (let headerRow = row - 1; headerRow >= Math.max(0, row - 40); headerRow -= 1) {
    const headerCell = cellByPosition(after, sheet, headerRow, column)
      || cellByPosition(before, sheet, headerRow, column);
    const date = dateFromCell(headerCell);
    if (date) return date;
    const day = Number(String(headerCell?.value || "").trim());
    if (Number.isInteger(day) && day >= 1 && day <= 31) {
      for (let contextRow = headerRow; contextRow >= Math.max(0, headerRow - 8); contextRow -= 1) {
        for (let contextColumn = column; contextColumn >= Math.max(0, column - 40); contextColumn -= 1) {
          const context = cellByPosition(after, sheet, contextRow, contextColumn)
            || cellByPosition(before, sheet, contextRow, contextColumn);
          const monthYear = monthYearFromText(context?.value);
          if (!monthYear) continue;
          const candidate = new Date(Date.UTC(monthYear.year, monthYear.month - 1, day));
          if (candidate.getUTCMonth() === monthYear.month - 1)
            return candidate.toISOString().slice(0, 10);
        }
      }
    }
  }
  return null;
}

function findRoomLabel(before, after, sheet, row, column) {
  for (let labelColumn = column - 1; labelColumn >= Math.max(0, column - 15); labelColumn -= 1) {
    const cell = cellByPosition(after, sheet, row, labelColumn)
      || cellByPosition(before, sheet, row, labelColumn);
    const value = String(cell?.value || "").trim();
    if (value && !dateFromCell(cell) && /[a-z]/i.test(value)) return value;
  }
  return `Row ${row + 1}`;
}

function compareExcel(oldPath, newPath) {
  const before = oldPath ? cellMap(oldPath) : new Map();
  const after = cellMap(newPath);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes = [];
  const calendarChanges = [];
  for (const key of keys) {
    const oldCell = before.get(key) || null;
    const newCell = after.get(key) || null;
    const oldValue = oldCell?.formula ? `=${oldCell.formula}` : oldCell?.value ?? null;
    const newValue = newCell?.formula ? `=${newCell.formula}` : newCell?.value ?? null;
    if (oldValue === newValue && oldCell?.styleSignature === newCell?.styleSignature) continue;
    const formatOnly = oldValue === newValue && oldCell && newCell;
    changes.push({
      sheet: (newCell || oldCell).sheet,
      cell: (newCell || oldCell).cell,
      before: formatOnly ? `${oldValue ?? ""} [previous format]` : oldValue,
      after: formatOnly ? `${newValue ?? ""} [new format]` : newValue,
      change: formatOnly ? "FORMAT_CHANGED" : oldCell && newCell ? "UPDATED" : newCell ? "ADDED" : "REMOVED",
    });
    const position = XLSX.utils.decode_cell((newCell || oldCell).cell);
    const date = findDateHeader(before, after, (newCell || oldCell).sheet, position.r, position.c);
    if (date) {
      const oldMarked = isMarkedCell(oldCell);
      const newMarked = isMarkedCell(newCell);
      if (oldMarked || newMarked) {
        calendarChanges.push({
          sheet: (newCell || oldCell).sheet,
          cell: (newCell || oldCell).cell,
          room: findRoomLabel(before, after, (newCell || oldCell).sheet, position.r, position.c),
          date,
          change: !oldMarked && newMarked ? "ADDED" : oldMarked && !newMarked ? "REMOVED" : "UPDATED",
          before: oldValue,
          after: newValue,
        });
      }
    }
    if (changes.length >= 500) break;
  }
  return { sourceDiff: changes, calendarChanges };
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

function compareSourceFiles(baselinePath, currentPath, extension) {
  const ext = String(extension || path.extname(currentPath).slice(1)).toLowerCase();
  if (["xlsx", "xls"].includes(ext)) return compareExcel(baselinePath, currentPath);
  return {
    sourceDiff: [{
      change: baselinePath ? "FILE_CHANGED" : "FIRST_FILE",
      sheet: null,
      cell: null,
      before: baselinePath ? path.basename(baselinePath) : null,
      after: path.basename(currentPath),
      note: "Format ini memerlukan review visual/OCR untuk menghasilkan calendar otomatis.",
    }],
    calendarChanges: [],
  };
}

function dateRange(start, end) {
  const dates = [];
  let cursor = new Date(`${start}T00:00:00Z`);
  const finish = new Date(`${end}T00:00:00Z`);
  for (let guard = 0; cursor <= finish && guard < 4000; guard += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dates;
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

function contiguousRanges(dates) {
  const sorted = [...dates].sort();
  if (!sorted.length) return [];
  const result = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const date of sorted.slice(1)) {
    const expected = new Date(`${previous}T00:00:00Z`).getTime() + 86400000;
    if (new Date(`${date}T00:00:00Z`).getTime() !== expected) {
      result.push({ start_date: start, end_date: previous });
      start = date;
    }
    previous = date;
  }
  result.push({ start_date: start, end_date: previous });
  return result;
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
      "INSERT INTO stop_sale_jobs (scan_result_id) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
      [scanResultId],
    );
    return res.status(result.affectedRows === 1 ? 201 : 200).json({ success: true, job_id: result.insertId });
  } catch (error) {
    console.error("Create stop-sale job error:", error);
    return res.status(500).json({ success: false, message: "Gagal menambahkan file ke queue." });
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
      `SELECT j.*, r.file_name, r.full_path, r.extension,
              CAST(r.date_modified_utc AS CHAR) AS date_modified_utc, r.file_size,
              s.company_name, s.location AS supplier_location, s.category_supplier,
              u.fullname AS completed_by_name
         FROM stop_sale_jobs j
         JOIN contract_scan_results r ON r.id = j.scan_result_id
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
    const storedSummary = jsonValue(job.comparison_summary, null);
    const automaticActions = (storedSummary?.calendar_changes || []).map((item) => ({
      product_id: null,
      product_name: item.room,
      restriction_status: "STOP_SALE",
      change: item.change,
      start_date: item.date,
      end_date: item.date,
      sheet: item.sheet,
      cell: item.cell,
      before: item.before,
      after: item.after,
    }));
    const comparison = automaticActions.length
      ? {
          actions: automaticActions,
          summary: {
            added_days: automaticActions.filter((item) => item.change === "ADDED").length,
            removed_days: automaticActions.filter((item) => item.change === "REMOVED").length,
            updated_days: automaticActions.filter((item) => item.change === "UPDATED").length,
            unchanged_days: 0,
          },
        }
      : compareItems(baselineItems, items);
    return res.json({
      success: true,
      job: serializeJob(job),
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

async function processJob(req, res) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, new Error("Job tidak valid."));
  try {
    const job = await jobRow(id);
    if (!job) return res.status(404).json({ success: false, message: "Job tidak ditemukan." });
    if (!job.supplier_id) return badRequest(res, new Error("Pilih supplier sebelum Process."));
    await pool.execute("UPDATE stop_sale_jobs SET status = 'PROCESSING' WHERE id = ?", [id]);
    const [baselines] = await pool.execute(
      `SELECT j.id, j.baseline_path, HEX(r.fingerprint) AS fingerprint
         FROM stop_sale_jobs j JOIN contract_scan_results r ON r.id = j.scan_result_id
        WHERE j.supplier_id = ? AND j.is_active_baseline = 1 AND j.id <> ? LIMIT 1`,
      [job.supplier_id, id],
    );
    const baseline = baselines[0] || null;
    const baselinePath = baseline?.baseline_path && fs.existsSync(baseline.baseline_path)
      ? baseline.baseline_path : null;
    if (!job.uploaded_path || !fs.existsSync(job.uploaded_path))
      throw new Error("Upload file Stop Sale sebelum menjalankan Compare.");
    if (baselinePath && await fileHash(baselinePath) === await fileHash(job.uploaded_path)) {
      await pool.execute("UPDATE stop_sale_jobs SET status = 'DUPLICATE', processed_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [id]);
      return res.json({ success: true, status: "DUPLICATE", source_diff: [] });
    }
    const compared = baselinePath
      ? compareSourceFiles(
          baselinePath,
          job.uploaded_path,
          path.extname(job.uploaded_file_name || job.uploaded_path).slice(1),
        )
      : {
          sourceDiff: [{
            change: baseline ? "BASELINE_FILE_MISSING" : "FIRST_FILE",
            sheet: null,
            cell: null,
            before: null,
            after: job.uploaded_file_name || path.basename(job.uploaded_path),
            note: baseline
              ? "Baseline metadata ditemukan tetapi file baseline tidak tersedia."
              : "File pertama akan menjadi baseline setelah Complete.",
          }],
          calendarChanges: [],
        };
    const sourceDiff = compared.sourceDiff;
    const status = baseline ? (baselinePath ? "READY_FOR_JAMBIX" : "NEEDS_REVIEW") : "READY_FOR_JAMBIX";
    const summary = {
      baseline_job_id: baseline?.id || null,
      source_changes: sourceDiff.length,
      baseline_available: Boolean(baselinePath),
      calendar_changes: compared.calendarChanges,
    };
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
    if (job.status !== "READY_FOR_JAMBIX") throw new Error("Jalankan Compare sebelum Complete.");
    if (!job.uploaded_path || !fs.existsSync(job.uploaded_path))
      throw new Error("File upload tidak lagi tersedia.");
    await fs.promises.mkdir(BASELINE_ROOT, { recursive: true });
    const extension = String(path.extname(job.uploaded_file_name || job.uploaded_path).slice(1) || "bin")
      .replace(/[^a-z0-9]/gi, "").toLowerCase();
    const baselinePath = path.join(BASELINE_ROOT, `supplier-${job.supplier_id}-job-${id}.${extension}`);
    temporaryPath = path.join(BASELINE_ROOT, `.pending-${id}-${crypto.randomUUID()}.${extension}`);
    await fs.promises.copyFile(job.uploaded_path, temporaryPath);
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
};
