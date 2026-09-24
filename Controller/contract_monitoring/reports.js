const pool = require("../../Database/connection");
const {
  contractStatus,
  parseCategories,
  todayWita,
} = require("../../Utils/contract_monitoring");
const {
  badRequest,
  dateValue,
  enumValue,
  isValidationError,
  pagination,
  parseId,
  textValue,
} = require("./common");

const SIGNED_STATUSES = ["SIGNED", "BELUM_SIGNED", "DRAFT"];
const REGION_SQL =
  "COALESCE(r.region COLLATE utf8mb4_unicode_ci, s.region COLLATE utf8mb4_unicode_ci, _utf8mb4'Other' COLLATE utf8mb4_unicode_ci)";
const LOCATION_SQL =
  "COALESCE(r.location_jambix COLLATE utf8mb4_unicode_ci, _utf8mb4'Unspecified location' COLLATE utf8mb4_unicode_ci)";
const locationMatchesSupplier = (reportAlias) =>
  `LOWER(TRIM(CONVERT(COALESCE(${reportAlias}.location_jambix, '') USING utf8mb4))) COLLATE utf8mb4_unicode_ci = ` +
  "LOWER(TRIM(CONVERT(COALESCE(s.location, '') USING utf8mb4))) COLLATE utf8mb4_unicode_ci";
const LATEST_PERIOD_REPORT_SQL = `NOT EXISTS (
  SELECT 1 FROM contract_reports newer
   WHERE newer.supplier_id = r.supplier_id
     AND newer.validity_start = r.validity_start
     AND newer.validity_end = r.validity_end
     AND (
       CASE WHEN ${locationMatchesSupplier("newer")}
            THEN 1 ELSE 0 END
       >
       CASE WHEN ${locationMatchesSupplier("r")}
            THEN 1 ELSE 0 END
       OR (
         CASE WHEN ${locationMatchesSupplier("newer")}
              THEN 1 ELSE 0 END
         =
         CASE WHEN ${locationMatchesSupplier("r")}
              THEN 1 ELSE 0 END
         AND newer.id > r.id
       )
     )
)`;
function multiValues(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : String(value || "").split(","))
        .map((item) => String(item).trim())
        .filter(Boolean),
    ),
  ];
}

async function validateSupplierType(connection, supplierId, supplierType) {
  const [rows] = await connection.execute(
    "SELECT supplier_id, company_name, category_supplier FROM suppliers WHERE supplier_id = ?",
    [supplierId],
  );
  if (!rows.length) throw new Error("Supplier tidak ditemukan.");
  const categories = parseCategories(rows[0].category_supplier);
  if (
    !categories.some(
      (category) => category.toLowerCase() === supplierType.toLowerCase(),
    )
  ) {
    throw new Error("Supplier type harus dipilih dari kategori supplier.");
  }
  return rows[0];
}

async function validatedReportPayload(
  connection,
  body,
  fixedSupplierId = null,
) {
  const supplierId = fixedSupplierId || parseId(body.supplier_id);
  if (!supplierId) throw new Error("Supplier ID tidak valid.");
  const supplierType = textValue(body.supplier_type, "Supplier type", {
    required: true,
    max: 100,
  });
  await validateSupplierType(connection, supplierId, supplierType);
  const validityStart = dateValue(body.validity_start, "Validity start", {
    required: true,
  });
  const validityEnd = dateValue(body.validity_end, "Validity end", {
    required: true,
  });
  if (validityEnd < validityStart)
    throw new Error("Validity end tidak boleh lebih awal dari validity start.");
  const sourceScanResultId =
    body.source_scan_result_id === undefined ||
    body.source_scan_result_id === null
      ? null
      : parseId(body.source_scan_result_id);
  if (
    body.source_scan_result_id !== undefined &&
    body.source_scan_result_id !== null &&
    !sourceScanResultId
  ) {
    throw new Error("Source scan result ID tidak valid.");
  }
  return {
    supplierId,
    supplierType,
    fileSource: textValue(body.file_source, "File source", {
      required: true,
      max: 4000,
    }),
    locationJambix: textValue(body.location_jambix, "Location Jambix", {
      max: 500,
    }),
    validityStart,
    validityEnd,
    status: contractStatus(validityEnd),
    contractReference: textValue(
      body.contract_reference,
      "Contract reference",
      { max: 255 },
    ),
    signedStatus: enumValue(
      body.signed_status,
      SIGNED_STATUSES,
      "Signed status",
      { required: true },
    ),
    note: textValue(body.note, "Note", { max: 10000 }),
    sourceScanResultId,
  };
}

function reportSnapshot(row) {
  return {
    id: row.id,
    source_scan_result_id: row.source_scan_result_id,
    file_source: row.file_source,
    location_jambix: row.location_jambix,
    region: row.region,
    supplier_id: row.supplier_id,
    supplier_type: row.supplier_type,
    validity_start: row.validity_start,
    validity_end: row.validity_end,
    status: row.status,
    source_status: row.source_status,
    contract_reference: row.contract_reference,
    signed_status: row.signed_status,
    period_statuses: row.period_statuses,
    note: row.note,
  };
}

async function syncExpired(connection = pool) {
  await connection.execute(
    "UPDATE contract_reports SET status = IF(validity_end < ?, 'EXPIRED', 'ACTIVE') WHERE status <> IF(validity_end < ?, 'EXPIRED', 'ACTIVE')",
    [todayWita(), todayWita()],
  );
}

async function listReports(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    5000,
    Math.max(1, Number.parseInt(req.query.limit, 10) || 100),
  );
  const offset = (page - 1) * limit;
  try {
    await syncExpired();
    const conditions = [LATEST_PERIOD_REPORT_SQL];
    const params = [];
    const supplierId = req.query.supplier_id
      ? parseId(req.query.supplier_id)
      : null;
    if (req.query.supplier_id && !supplierId)
      throw new Error("Supplier ID tidak valid.");
    if (supplierId) {
      conditions.push("r.supplier_id = ?");
      params.push(supplierId);
    }
    const statuses = multiValues(req.query.status);
    if (statuses.length) {
      const valid = statuses.map((status) =>
        enumValue(status, ["ACTIVE", "EXPIRED"], "Status", { required: true }),
      );
      conditions.push(`r.status IN (${valid.map(() => "?").join(",")})`);
      params.push(...valid);
    }
    if (req.query.signed_status) {
      const signed = enumValue(
        req.query.signed_status,
        SIGNED_STATUSES,
        "Signed status",
        { required: true },
      );
      conditions.push("r.signed_status = ?");
      params.push(signed);
    }
    if (req.query.location_jambix) {
      conditions.push("r.location_jambix LIKE ?");
      params.push(`%${String(req.query.location_jambix).slice(0, 500)}%`);
    }
    const categoriesFilter = multiValues(req.query.category).map((category) =>
      textValue(category, "Category", { max: 100 }),
    );
    if (categoriesFilter.length) {
      conditions.push(
        `(${categoriesFilter.map(() => "JSON_CONTAINS(s.category_supplier, JSON_QUOTE(?))").join(" OR ")})`,
      );
      params.push(...categoriesFilter);
    }
    const expiryDate = req.query.expiry_date
      ? dateValue(req.query.expiry_date, "Expiry date", { required: true })
      : null;
    if (expiryDate) {
      conditions.push("r.validity_end = ?");
      params.push(expiryDate);
    }
    const regions = multiValues(req.query.region).map((value) =>
      textValue(value, "Region", { max: 100 }),
    );
    if (regions.length) {
      conditions.push(
        `(${regions.map(() => `${REGION_SQL} = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci`).join(" OR ")})`,
      );
      params.push(...regions);
    }
    const locations = multiValues(req.query.location).map((value) =>
      textValue(value, "Location", { max: 500 }),
    );
    if (locations.length) {
      conditions.push(
        `(${locations.map(() => `${LOCATION_SQL} = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci`).join(" OR ")})`,
      );
      params.push(...locations);
    }
    const supplier = textValue(req.query.supplier, "Supplier", { max: 255 });
    if (supplier) {
      conditions.push("s.company_name LIKE ?");
      params.push(`%${supplier}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM contract_reports r
       JOIN suppliers s ON s.supplier_id = r.supplier_id ${where}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT r.id, r.source_scan_result_id, r.file_source, r.location_jambix,
              ${REGION_SQL} AS region,
              r.supplier_id, r.supplier_type,
              CAST(r.validity_start AS CHAR) AS validity_start,
              CAST(r.validity_end AS CHAR) AS validity_end,
              r.status, r.source_status, r.contract_reference, r.signed_status, r.period_statuses, r.note,
              r.created_by, r.updated_by, r.created_at, r.updated_at,
              s.company_name, s.category_supplier,
              EXISTS (SELECT 1 FROM hotel_options ho WHERE ho.supplier_id = r.supplier_id) AS has_hotel_option
         FROM contract_reports r JOIN suppliers s ON s.supplier_id = r.supplier_id
         ${where} ORDER BY r.validity_end DESC, r.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    for (const row of rows) {
      row.category_supplier = parseCategories(row.category_supplier);
      if (typeof row.period_statuses === "string") {
        try {
          row.period_statuses = JSON.parse(row.period_statuses);
        } catch {
          row.period_statuses = [];
        }
      }
      if (!Array.isArray(row.period_statuses)) row.period_statuses = [];
    }
    const [categoryRows] = await pool.execute(
      "SELECT category_supplier FROM suppliers ORDER BY supplier_id",
    );
    const categories = [
      ...new Set(
        categoryRows.flatMap((row) => parseCategories(row.category_supplier)),
      ),
    ].sort();
    const [filterRows] = await pool.execute(
      `SELECT DISTINCT ${REGION_SQL} AS region,
              ${LOCATION_SQL} AS location
       FROM contract_reports r JOIN suppliers s ON s.supplier_id = r.supplier_id
        WHERE ${LATEST_PERIOD_REPORT_SQL}
        ORDER BY region, location`,
    );
    return res.json({
      success: true,
      page,
      limit,
      total: countRow.total,
      categories,
      filter_options: filterRows,
      reports: rows,
    });
  } catch (error) {
    if (isValidationError(error)) return badRequest(res, error);
    console.error("List contract reports error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal mengambil contract report." });
  }
}

async function getReport(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Contract report ID tidak valid." });
  try {
    await syncExpired();
    const [rows] = await pool.execute(
      `SELECT r.*,
              CAST(r.validity_start AS CHAR) AS validity_start,
              CAST(r.validity_end AS CHAR) AS validity_end,
              s.company_name, s.category_supplier
         FROM contract_reports r JOIN suppliers s ON s.supplier_id = r.supplier_id WHERE r.id = ?`,
      [id],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({ success: false, message: "Contract report tidak ditemukan." });
    const [revisions] = await pool.execute(
      `SELECT id, action, before_data, after_data, changed_by, changed_at
         FROM contract_report_revisions WHERE contract_report_id = ? ORDER BY id DESC`,
      [id],
    );
    return res.json({ success: true, report: rows[0], revisions });
  } catch (error) {
    console.error("Get contract report error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal mengambil contract report." });
  }
}

async function createReport(req, res) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const data = await validatedReportPayload(connection, req.body || {});
    const [result] = await connection.execute(
      `INSERT INTO contract_reports
         (source_scan_result_id, file_source, location_jambix, supplier_id, supplier_type,
          validity_start, validity_end, status, contract_reference, signed_status, note,
          created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.sourceScanResultId,
        data.fileSource,
        data.locationJambix,
        data.supplierId,
        data.supplierType,
        data.validityStart,
        data.validityEnd,
        data.status,
        data.contractReference,
        data.signedStatus,
        data.note,
        req.admin.id,
        req.admin.id,
      ],
    );
    const [rows] = await connection.execute(
      "SELECT * FROM contract_reports WHERE id = ?",
      [result.insertId],
    );
    await connection.execute(
      `INSERT INTO contract_report_revisions
         (contract_report_id, action, before_data, after_data, changed_by)
       VALUES (?, 'INSERT', NULL, ?, ?)`,
      [result.insertId, JSON.stringify(reportSnapshot(rows[0])), req.admin.id],
    );
    await connection.commit();
    return res.status(201).json({
      success: true,
      message: "Contract report berhasil dibuat.",
      report: rows[0],
    });
  } catch (error) {
    await connection.rollback();
    if (
      error.code === "ER_NO_REFERENCED_ROW_2" ||
      isValidationError(error) ||
      /supplier type/i.test(error.message || "")
    )
      return badRequest(res, error);
    console.error("Create contract report error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal membuat contract report." });
  } finally {
    connection.release();
  }
}

async function updateReport(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Contract report ID tidak valid." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.execute(
      "SELECT * FROM contract_reports WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!existingRows.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Contract report tidak ditemukan." });
    }
    const merged = {
      ...existingRows[0],
      ...req.body,
      file_source: req.body?.file_source ?? existingRows[0].file_source,
    };
    const data = await validatedReportPayload(connection, merged);
    await connection.execute(
      `UPDATE contract_reports SET
         source_scan_result_id = ?, file_source = ?, location_jambix = ?, supplier_id = ?,
         supplier_type = ?, validity_start = ?, validity_end = ?, status = ?,
         contract_reference = ?, signed_status = ?, note = ?, updated_by = ?
       WHERE id = ?`,
      [
        data.sourceScanResultId,
        data.fileSource,
        data.locationJambix,
        data.supplierId,
        data.supplierType,
        data.validityStart,
        data.validityEnd,
        data.status,
        data.contractReference,
        data.signedStatus,
        data.note,
        req.admin.id,
        id,
      ],
    );
    const [rows] = await connection.execute(
      "SELECT * FROM contract_reports WHERE id = ?",
      [id],
    );
    await connection.execute(
      `INSERT INTO contract_report_revisions
         (contract_report_id, action, before_data, after_data, changed_by)
       VALUES (?, 'UPDATE', ?, ?, ?)`,
      [
        id,
        JSON.stringify(reportSnapshot(existingRows[0])),
        JSON.stringify(reportSnapshot(rows[0])),
        req.admin.id,
      ],
    );
    await connection.commit();
    return res.json({
      success: true,
      message: "Contract report berhasil diperbarui.",
      report: rows[0],
    });
  } catch (error) {
    await connection.rollback();
    if (
      error.code === "ER_NO_REFERENCED_ROW_2" ||
      isValidationError(error) ||
      /supplier type/i.test(error.message || "")
    )
      return badRequest(res, error);
    console.error("Update contract report error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal memperbarui contract report." });
  } finally {
    connection.release();
  }
}

async function supplierContracts(req, res) {
  const supplierId = parseId(req.params.supplierId);
  if (!supplierId)
    return res
      .status(400)
      .json({ success: false, message: "Supplier ID tidak valid." });
  try {
    await syncExpired();
    const [rows] = await pool.execute(
      `SELECT r.*,
              CAST(r.validity_start AS CHAR) AS validity_start,
              CAST(r.validity_end AS CHAR) AS validity_end
         FROM contract_reports r
        WHERE supplier_id = ? ORDER BY validity_end DESC, id DESC`,
      [supplierId],
    );
    return res.json({ success: true, contracts: rows });
  } catch (error) {
    console.error("Get supplier contracts error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal mengambil kontrak supplier." });
  }
}

module.exports = {
  SIGNED_STATUSES,
  createReport,
  getReport,
  listReports,
  reportSnapshot,
  supplierContracts,
  syncExpired,
  updateReport,
  validateSupplierType,
  validatedReportPayload,
};
