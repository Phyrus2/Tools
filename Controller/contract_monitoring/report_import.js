const multer = require("multer");
const xlsx = require("xlsx");
const { createHash } = require("node:crypto");
const pool = require("../../Database/connection");
const {
  contractStatus,
  normalizeName,
  parseContractReferenceStatuses,
} = require("../../Utils/contract_monitoring");
const { syncSupplierContractStatus } = require("./reports");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});
const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
function cell(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}
function normalizeHeader(value) {
  return cell(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function isYellowCell(cellData) {
  const fill = cellData?.s?.fill || cellData?.s;
  return [fill?.fgColor, fill?.bgColor].filter(Boolean).some((color) => {
    const rgb = String(color.rgb || '').replace(/^FF/i, '').toUpperCase();
    return ['FFFF00', 'FFF200', 'FFD966', 'FFEB9C'].includes(rgb) || color.indexed === 5;
  });
}
function parseDate(value) {
  if (typeof value === "number") {
    const parsed = xlsx.SSF.parse_date_code(value);
    return parsed
      ? `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`
      : null;
  }
  const text = cell(value).replace(/,/g, " ").replace(/\s+/g, " ");
  if (!text || /^immediately$/i.test(text)) return null;
  const match = /^(\d{1,2})[-\s/]([A-Za-z]+|\d{1,2})[-\s/](\d{2}|\d{4})$/.exec(
    text,
  );
  if (!match) return null;
  const day = Number(match[1]),
    month = /^\d+$/.test(match[2])
      ? Number(match[2])
      : MONTHS[match[2].toLowerCase()],
    year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    !month ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const parsePeriodStatuses = parseContractReferenceStatuses;
function reportSourceKey(payload) {
  const sourceIdentity = [
    cell(payload.region).toLowerCase(),
    cell(payload.folder).toLowerCase(),
    normalizeName(payload.supplier_name, { keepGeneric: true }),
  ].join("|");
  return createHash("sha256").update(sourceIdentity).digest("hex");
}
function reportData(payload, supplierId) {
  const periods = parsePeriodStatuses(
    payload.reference,
    payload.validity_start,
  );
  return {
    import_source_key: reportSourceKey(payload),
    file_source: payload.folder,
    location_jambix: payload.location || null,
    region: payload.region || null,
    supplier_id: supplierId,
    supplier_type: payload.supplier_type || "Unspecified",
    report_type: "CONTRACT",
    validity_start: payload.validity_start,
    validity_end: payload.validity_end,
    status: contractStatus(payload.validity_end),
    source_status: payload.source_status || null,
    contract_reference: payload.reference || null,
    period_statuses: periods,
    note: payload.note || null,
  };
}
function comparable(row) {
  return {
    supplier_id: Number(row.supplier_id),
    file_source: row.file_source,
    location_jambix: row.location_jambix || null,
    region: row.region || null,
    supplier_type: row.supplier_type,
    report_type: row.report_type || "CONTRACT",
    validity_start: row.validity_start
      ? String(row.validity_start).slice(0, 10)
      : null,
    validity_end: row.validity_end ? String(row.validity_end).slice(0, 10) : null,
    status: row.status,
    source_status: row.source_status || null,
    contract_reference: row.contract_reference || null,
    period_statuses:
      typeof row.period_statuses === "string"
        ? JSON.parse(row.period_statuses || "[]")
        : row.period_statuses || [],
    note: row.note || null,
  };
}
function diff(before, after) {
  const changes = [];
  for (const key of Object.keys(after)) {
    if (
      JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)
    )
      changes.push({
        field: key,
        old: before[key] ?? null,
        new: after[key] ?? null,
      });
  }
  return changes;
}
async function insertReport(connection, data, adminId) {
  const [result] = await connection.execute(
    `INSERT INTO contract_reports (import_source_key,file_source,location_jambix,region,supplier_id,supplier_type,report_type,validity_start,validity_end,status,source_status,contract_reference,period_statuses,note,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      data.import_source_key,
      data.file_source,
      data.location_jambix,
      data.region,
      data.supplier_id,
      data.supplier_type,
      data.report_type,
      data.validity_start,
      data.validity_end,
      data.status,
      data.source_status,
      data.contract_reference,
      JSON.stringify(data.period_statuses),
      data.note,
      adminId,
      adminId,
    ],
  );
  return result.insertId;
}
async function findExistingReport(connection, data, lock = false) {
  const [keyRows] = await connection.execute(
    `SELECT *, CAST(validity_start AS CHAR) AS validity_start,
            CAST(validity_end AS CHAR) AS validity_end
       FROM contract_reports WHERE import_source_key = ?
      LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [data.import_source_key],
  );
  if (keyRows.length) return keyRows[0];
  const [rows] = await connection.execute(
    `SELECT *, CAST(validity_start AS CHAR) AS validity_start,
            CAST(validity_end AS CHAR) AS validity_end
       FROM contract_reports
      WHERE import_source_key IS NULL
        AND supplier_id = ? AND file_source = ?
        AND validity_start = ? AND validity_end = ?
      ORDER BY id DESC
      LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [
      data.supplier_id,
      data.file_source,
      data.validity_start,
      data.validity_end,
    ],
  );
  if (rows[0]) return rows[0];
  const [oneTimeRows] = await connection.execute(
    `SELECT *, CAST(validity_start AS CHAR) AS validity_start,
            CAST(validity_end AS CHAR) AS validity_end
       FROM contract_reports
      WHERE report_type = 'ONE_TIME_SUPPLIER'
        AND supplier_id = ?
        AND LOWER(TRIM(COALESCE(region, ''))) = LOWER(TRIM(COALESCE(?, '')))
        AND LOWER(TRIM(COALESCE(location_jambix, ''))) = LOWER(TRIM(COALESCE(?, '')))
        AND LOWER(TRIM(COALESCE(supplier_type, ''))) = LOWER(TRIM(COALESCE(?, '')))
      ORDER BY id
      LIMIT 2${lock ? " FOR UPDATE" : ""}`,
    [data.supplier_id, data.region, data.location_jambix, data.supplier_type],
  );
  if (oneTimeRows.length > 1) return { ambiguous_one_time: true };
  return oneTimeRows[0] || null;
}

async function saveSupplierAlias(connection, sourceName, supplierId, adminId) {
  const normalizedName = normalizeName(sourceName, { keepGeneric: true });
  if (!normalizedName) return;
  await connection.execute(
    `INSERT INTO contract_report_supplier_aliases
       (source_name, normalized_name, supplier_id, linked_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       source_name = VALUES(source_name), supplier_id = VALUES(supplier_id),
       linked_by = VALUES(linked_by)`,
    [cell(sourceName), normalizedName, supplierId, adminId],
  );
}

async function findLegacyManualLink(connection, payload) {
  if (!payload.validity_start || !payload.validity_end) return null;
  const [rows] = await connection.execute(
    `SELECT r.supplier_id, s.company_name
       FROM contract_reports r
       JOIN suppliers s ON s.supplier_id = r.supplier_id
      WHERE r.file_source = ? AND r.validity_start = ? AND r.validity_end = ?
        AND COALESCE(r.contract_reference, '') = COALESCE(?, '')
      LIMIT 2`,
    [
      payload.folder,
      payload.validity_start,
      payload.validity_end,
      payload.reference,
    ],
  );
  return rows.length === 1 ? rows[0] : null;
}

async function importReport(req, res) {
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, message: "Select an Excel file first." });
  const connection = await pool.getConnection();
  try {
    const workbook = xlsx.read(req.file.buffer, {
      type: "buffer",
      cellDates: false,
      cellStyles: true,
    });
    const [suppliers] = await connection.execute(
      "SELECT supplier_id, company_name FROM suppliers",
    );
    const [aliases] = await connection.execute(
      `SELECT a.normalized_name, s.supplier_id, s.company_name
         FROM contract_report_supplier_aliases a
         JOIN suppliers s ON s.supplier_id = a.supplier_id`,
    );
    const supplierMap = new Map(
      suppliers.map((row) => [
        normalizeName(row.company_name, { keepGeneric: true }),
        row,
      ]),
    );
    for (const alias of aliases) supplierMap.set(alias.normalized_name, alias);

    let candidates = [];
    const skippedRows = [];
    const recoveredAliases = [];
    for (const sheetName of workbook.SheetNames) {
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: null,
        raw: true,
      });
      const headerIndex = rows.findIndex((row) =>
        row.some((value) => normalizeHeader(value) === "supplier name"),
      );
      if (headerIndex < 0) continue;
      const headers = rows[headerIndex].map(normalizeHeader);
      const indexOf = (...names) =>
        headers.findIndex((header) => names.includes(header));
      const columns = {
        folder: indexOf("folder dropbox"),
        location: indexOf("location"),
        supplier: indexOf("supplier name"),
        type: indexOf("type"),
        start: indexOf("validity start"),
        end: indexOf("validity end"),
        status: indexOf("status"),
        reference: indexOf("reference"),
        note: indexOf("note supplier"),
      };
      for (
        let rowIndex = headerIndex + 1;
        rowIndex < rows.length;
        rowIndex += 1
      ) {
        const row = rows[rowIndex];
        const supplierName = cell(row[columns.supplier]);
        if (!supplierName || /supplier name/i.test(supplierName)) continue;
        const start = parseDate(row[columns.start]);
        const end = parseDate(row[columns.end]);
        const payload = {
          supplier_name: supplierName,
          folder: cell(row[columns.folder]) || `Excel import: ${sheetName}`,
          region: sheetName,
          location: cell(row[columns.location]) || null,
          supplier_type: cell(row[columns.type]) || "Unspecified",
          validity_start: start,
          validity_end: end,
          source_status: cell(row[columns.status]) || null,
          reference: cell(row[columns.reference]) || null,
          note: cell(row[columns.note]) || null,
        };
        const validDates = Boolean(start && end && end >= start);
        const supplierCell = workbook.Sheets[sheetName][xlsx.utils.encode_cell({ r: rowIndex, c: columns.supplier })];
        const oneTimeCandidate = isYellowCell(supplierCell) && !start && !end;
        let supplier = supplierMap.get(
          normalizeName(supplierName, { keepGeneric: true }),
        );
        payload.matched_supplier_id = supplier?.supplier_id || null;
        if (!supplier && validDates) {
          supplier = await findLegacyManualLink(connection, payload);
          if (supplier)
            recoveredAliases.push({
              sourceName: supplierName,
              supplierId: supplier.supplier_id,
            });
        }
        const reasons = [];
        if (oneTimeCandidate) {
          skippedRows.push({
            sheet_name: sheetName,
            row_number: rowIndex + 1,
            supplier_name: supplierName,
            reason: "The Supplier Name cell is yellow and the validity dates are empty. Link it to Jambix as a one-time supplier.",
            one_time_candidate: true,
            can_link_supplier: true,
            payload: { ...payload, matched_supplier_id: supplier?.supplier_id || null },
          });
          continue;
        }
        if (!supplier) reasons.push("Supplier not found in Jambix");
        if (!validDates) reasons.push("Validity dates are missing or invalid");
        if (reasons.length) {
          skippedRows.push({
            sheet_name: sheetName,
            row_number: rowIndex + 1,
            supplier_name: supplierName,
            reason: reasons.join("; "),
            can_link_supplier: true,
            payload,
          });
          continue;
        }
        candidates.push({
          sheet_name: sheetName,
          row_number: rowIndex + 1,
          supplier_name: supplier.company_name,
          payload,
          supplier_id: supplier.supplier_id,
        });
      }
    }

    // The same row can occur twice in the workbook. During a first import the
    // first copy is inserted, so without this pass the second copy is
    // misleadingly reported as "unchanged" even though the database was empty.
    const uniqueCandidates = [];
    const candidateFingerprints = new Set();
    for (const item of candidates) {
      const fingerprint = JSON.stringify({
        supplier_id: item.supplier_id,
        folder: item.payload.folder,
        region: item.payload.region,
        location: item.payload.location,
        supplier_type: item.payload.supplier_type,
        validity_start: item.payload.validity_start,
        validity_end: item.payload.validity_end,
        source_status: item.payload.source_status,
        reference: item.payload.reference,
        note: item.payload.note,
      });
      if (candidateFingerprints.has(fingerprint)) {
        skippedRows.push({
          ...item,
          reason: "Duplicate contract report row in the Excel file.",
          can_link_supplier: true,
        });
        continue;
      }
      candidateFingerprints.add(fingerprint);
      uniqueCandidates.push(item);
    }
    candidates = uniqueCandidates;

    const locationsByContract = new Map();
    for (const item of candidates) {
      const key = `${item.supplier_id}:${item.payload.validity_start}:${item.payload.validity_end}`;
      if (!locationsByContract.has(key))
        locationsByContract.set(key, new Set());
      locationsByContract
        .get(key)
        .add(cell(item.payload.location).toLowerCase());
    }
    const ambiguousContracts = new Set(
      [...locationsByContract.entries()]
        .filter(([, locations]) => locations.size > 1)
        .map(([key]) => key),
    );
    if (ambiguousContracts.size) {
      const accepted = [];
      for (const item of candidates) {
        const key = `${item.supplier_id}:${item.payload.validity_start}:${item.payload.validity_end}`;
        if (!ambiguousContracts.has(key)) {
          accepted.push(item);
          continue;
        }
        skippedRows.push({
          ...item,
          reason:
            "The same supplier and validity period appears in multiple locations. Choose the correct row manually.",
          can_link_supplier: true,
        });
      }
      candidates = accepted;
    }

    await connection.beginTransaction();
    for (const alias of recoveredAliases) {
      await saveSupplierAlias(
        connection,
        alias.sourceName,
        alias.supplierId,
        req.admin.id,
      );
    }
    const newRows = [],
      updatedRows = [],
      unchangedRows = [];
    for (const item of candidates) {
      const data = reportData(item.payload, item.supplier_id);
      const existing = await findExistingReport(connection, data, true);
      if (existing?.ambiguous_one_time) {
        skippedRows.push({
          ...item,
          reason:
            "More than one one-time supplier record matches this contract. Select the target record manually.",
          can_link_supplier: true,
        });
        continue;
      }
      if (!existing) {
        const id = await insertReport(connection, data, req.admin.id);
        await syncSupplierContractStatus(connection, data.supplier_id);
        newRows.push({ ...item, id });
        continue;
      }
      const before = comparable(existing),
        after = comparable(data),
        changes = diff(before, after);
      if (!changes.length) {
        if (existing.import_source_key !== data.import_source_key) {
          await connection.execute(
            "UPDATE contract_reports SET import_source_key = ? WHERE id = ?",
            [data.import_source_key, existing.id],
          );
        }
        unchangedRows.push({ ...item, id: existing.id });
        await syncSupplierContractStatus(connection, data.supplier_id);
        continue;
      }
      await connection.execute(
        `UPDATE contract_reports SET import_source_key=?,supplier_id=?,file_source=?,location_jambix=?,region=?,supplier_type=?,report_type='CONTRACT',validity_start=?,validity_end=?,status=?,source_status=?,contract_reference=?,period_statuses=?,note=?,updated_by=? WHERE id=?`,
        [
          data.import_source_key,
          data.supplier_id,
          data.file_source,
          data.location_jambix,
          data.region,
          data.supplier_type,
          data.validity_start,
          data.validity_end,
          data.status,
          data.source_status,
          data.contract_reference,
          JSON.stringify(data.period_statuses),
          data.note,
          req.admin.id,
          existing.id,
        ],
      );
      await syncSupplierContractStatus(connection, data.supplier_id);
      await connection.execute(
        `INSERT INTO contract_report_revisions
           (contract_report_id, action, before_data, after_data, changed_by)
         VALUES (?, 'UPDATE', ?, ?, ?)`,
        [
          existing.id,
          JSON.stringify(before),
          JSON.stringify(after),
          req.admin.id,
        ],
      );
      updatedRows.push({ ...item, id: existing.id, changes });
    }
    await connection.commit();
    return res.json({
      success: true,
      summary: {
        totalRows:
          newRows.length +
          updatedRows.length +
          unchangedRows.length +
          skippedRows.length,
        inserted: newRows.length,
        updated: updatedRows.length,
        unchanged: unchangedRows.length,
        skipped: skippedRows.length,
      },
      newRows,
      updatedRows,
      unchangedRows,
      skippedRows,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Import contract report error:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: error.message || "Failed to import the contract report.",
      });
  } finally {
    connection.release();
  }
}

async function createManualProduct(req, res) {
  const supplierId = Number.parseInt(req.body?.supplier_id, 10);
  const name = cell(req.body?.name);
  const type = cell(req.body?.type) || null;
  const status = cell(req.body?.status) || "One Time Product";
  if (!Number.isInteger(supplierId) || supplierId < 1)
    return res.status(400).json({ success: false, message: "Select a supplier first." });
  if (!name || name.length > 255)
    return res.status(400).json({ success: false, message: "Product name is required (maximum 255 characters)." });
  if (!['Regular Product', 'One Time Product'].includes(status))
    return res.status(400).json({ success: false, message: "Product status is invalid." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [suppliers] = await connection.execute("SELECT supplier_id FROM suppliers WHERE supplier_id=?", [supplierId]);
    if (!suppliers.length) throw new Error("Supplier was not found.");
    const [[lastProduct]] = await connection.execute("SELECT product_id FROM products ORDER BY product_id DESC LIMIT 1 FOR UPDATE");
    const productId = Number(lastProduct?.product_id || 0) + 1;
    await connection.execute(
      `INSERT INTO products
         (product_id, supplier_id, name, type, status, info, not_on_offer,
          services_included, services_excluded, instructions, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [productId, supplierId, name, type, status, optional(req.body?.info), optional(req.body?.not_on_offer),
       optional(req.body?.services_included), optional(req.body?.services_excluded),
       optional(req.body?.instructions), optional(req.body?.description)],
    );
    await connection.commit();
    return res.status(201).json({ success: true, message: "Product added successfully.", product_id: productId });
  } catch (error) {
    await connection.rollback();
    return res.status(400).json({ success: false, message: error.message || "Failed to add product." });
  } finally {
    connection.release();
  }
}

function optional(value) {
  const valueText = cell(value);
  return valueText || null;
}

async function addOneTimeSupplier(req, res) {
  const supplierId = Number.parseInt(req.body?.supplier_id, 10);
  const payload = req.body?.payload || {};
  if (!Number.isInteger(supplierId) || supplierId < 1)
    return res
      .status(400)
      .json({ success: false, message: "Select a supplier from Jambix." });
  if (payload.validity_start || payload.validity_end)
    return res.status(400).json({
      success: false,
      message: "One-time suppliers cannot have a partial validity period.",
    });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [suppliers] = await connection.execute(
      "SELECT supplier_id FROM suppliers WHERE supplier_id=? LIMIT 1",
      [supplierId],
    );
    if (!suppliers.length) throw new Error("Supplier was not found in Jambix.");
    await saveSupplierAlias(
      connection,
      payload.supplier_name,
      supplierId,
      req.admin.id,
    );
    const data = {
      import_source_key: reportSourceKey(payload),
      file_source: cell(payload.folder) || "Contract report import",
      location_jambix: cell(payload.location) || null,
      region: cell(payload.region) || null,
      supplier_id: supplierId,
      supplier_type: cell(payload.supplier_type) || "Unspecified",
      report_type: "ONE_TIME_SUPPLIER",
      validity_start: null,
      validity_end: null,
      status: "NO_CONTRACT",
      source_status: cell(payload.source_status) || null,
      contract_reference: cell(payload.reference) || null,
      period_statuses: [],
      note: cell(payload.note) || null,
    };
    const [existing] = await connection.execute(
      `SELECT id, report_type FROM contract_reports
        WHERE import_source_key = ?
           OR (supplier_id = ? AND report_type = 'ONE_TIME_SUPPLIER'
               AND LOWER(TRIM(COALESCE(region, ''))) = LOWER(TRIM(COALESCE(?, '')))
               AND LOWER(TRIM(COALESCE(location_jambix, ''))) = LOWER(TRIM(COALESCE(?, '')))
               AND LOWER(TRIM(COALESCE(supplier_type, ''))) = LOWER(TRIM(COALESCE(?, ''))))
        ORDER BY id LIMIT 1 FOR UPDATE`,
      [
        data.import_source_key,
        supplierId,
        data.region,
        data.location_jambix,
        data.supplier_type,
      ],
    );
    if (existing.length) {
      await connection.commit();
      return res.json({
        success: true,
        id: existing[0].id,
        created: false,
        message:
          existing[0].report_type === "CONTRACT"
            ? "This supplier row is already linked to a contract report."
            : "This one-time supplier is already listed in Contract Report.",
      });
    }
    const id = await insertReport(connection, data, req.admin.id);
    await syncSupplierContractStatus(connection, supplierId);
    await connection.execute(
      `INSERT INTO contract_report_revisions
         (contract_report_id, action, before_data, after_data, changed_by)
       VALUES (?, 'INSERT', NULL, ?, ?)`,
      [id, JSON.stringify(comparable(data)), req.admin.id],
    );
    await connection.commit();
    return res.status(201).json({
      success: true,
      id,
      created: true,
      message: "One-time supplier added to Contract Report.",
    });
  } catch (error) {
    await connection.rollback();
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to add the one-time supplier.",
    });
  } finally {
    connection.release();
  }
}

async function addSkippedReport(req, res) {
  const supplierId = Number.parseInt(req.body?.supplier_id, 10),
    payload = req.body?.payload || {};
  if (!Number.isInteger(supplierId))
    return res
      .status(400)
      .json({ success: false, message: "Select a supplier from Jambix." });
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.validity_start || "") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.validity_end || "") ||
    payload.validity_end < payload.validity_start
  )
    return res
      .status(400)
      .json({
        success: false,
        message:
          "Enter valid start and end dates, or add this row as a one-time supplier.",
      });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [supplier] = await connection.execute(
      "SELECT supplier_id FROM suppliers WHERE supplier_id=? LIMIT 1",
      [supplierId],
    );
    if (!supplier.length) throw new Error("Supplier was not found in Jambix.");
    await saveSupplierAlias(
      connection,
      payload.supplier_name,
      supplierId,
      req.admin.id,
    );
    const data = reportData(payload, supplierId);
    const existing = await findExistingReport(connection, data, true);
    if (existing?.ambiguous_one_time)
      throw new Error(
        "More than one one-time supplier record matches. Select the target contract from Pending Queue.",
      );
    const id = existing
      ? existing.id
      : await insertReport(connection, data, req.admin.id);
    let updated = false;
    if (existing) {
      const before = comparable(existing);
      const after = comparable(data);
      const changes = diff(before, after);
      await connection.execute(
        `UPDATE contract_reports SET import_source_key=?,supplier_id=?,file_source=?,location_jambix=?,region=?,
           supplier_type=?,report_type='CONTRACT',validity_start=?,validity_end=?,status=?,source_status=?,
           contract_reference=?,period_statuses=?,note=?,updated_by=? WHERE id=?`,
        [
          data.import_source_key,
          data.supplier_id,
          data.file_source,
          data.location_jambix,
          data.region,
          data.supplier_type,
          data.validity_start,
          data.validity_end,
          data.status,
          data.source_status,
          data.contract_reference,
          JSON.stringify(data.period_statuses),
          data.note,
          req.admin.id,
          existing.id,
        ],
      );
      updated = Boolean(changes.length);
      if (updated)
        await connection.execute(
          `INSERT INTO contract_report_revisions
             (contract_report_id, action, before_data, after_data, changed_by)
           VALUES (?, 'UPDATE', ?, ?, ?)`,
          [existing.id, JSON.stringify(before), JSON.stringify(after), req.admin.id],
        );
    }
    await syncSupplierContractStatus(connection, supplierId);
    await connection.commit();
    return res.json({
      success: true,
      id,
      created: !existing,
      updated,
      message: existing
        ? "The one-time supplier was converted to a contract report."
        : "Skipped contract added and supplier link saved for future imports.",
    });
  } catch (error) {
    await connection.rollback();
    return res
      .status(400)
      .json({
        success: false,
        message: error.message || "Failed to add skipped contract.",
      });
  } finally {
    connection.release();
  }
}
module.exports = {
  importReport: [upload.single("file"), importReport],
  addSkippedReport,
  addOneTimeSupplier,
  parsePeriodStatuses,
  createManualProduct,
};
