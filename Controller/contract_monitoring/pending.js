const pool = require("../../Database/connection");
const multer = require("multer");
const xlsx = require("xlsx");
const crypto = require("node:crypto");
const path = require("node:path");
const {
  normalizeName,
  parseCategories,
  todayWita,
} = require("../../Utils/contract_monitoring");
const {
  badRequest,
  booleanValue,
  dateValue,
  enumValue,
  isValidationError,
  pagination,
  parseId,
  textValue,
} = require("./common");
const {
  SIGNED_STATUSES,
  reportSnapshot,
  validateSupplierType,
} = require("./reports");
const { parsePeriodStatuses } = require("./report_import");

const RECOMMENDATION_SOURCES = ["FUZZY", "GROUP", "MANUAL"];
const ACTIONS = ["INSERT", "UPDATE"];
const WORKFLOW_STATES = [
  "UNHANDLED",
  "IN_PROGRESS",
  "OP_NO_RESPONSE",
  "OP_WAITING",
  "DB_PENDING_VARIANT",
];
const pendingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

function importCell(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}
function importHeader(value) {
  return importCell(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function importPendingQueue(req, res) {
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, message: "Select an Excel file first." });
  const connection = await pool.getConnection();
  try {
    const workbook = xlsx.read(req.file.buffer, {
      type: "buffer",
      cellDates: false,
    });
    const [supplierRows] = await connection.execute(
      "SELECT supplier_id, company_name, category_supplier, location FROM suppliers",
    );
    const suppliers = new Map(
      supplierRows.map((row) => [
        normalizeName(row.company_name, { keepGeneric: true }),
        row,
      ]),
    );
    const summary = { totalRows: 0, inserted: 0, skipped: 0 };
    const skippedRows = [];
    await connection.beginTransaction();
    for (const sheetName of workbook.SheetNames) {
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: null,
        raw: false,
      });
      const headerIndex = rows.findIndex((row) =>
        row.some((value) =>
          ["supplier", "supplier name"].includes(importHeader(value)),
        ),
      );
      if (headerIndex < 0) continue;
      const headers = rows[headerIndex].map(importHeader);
      const column = (...names) =>
        headers.findIndex((header) => names.includes(header));
      const columns = {
        supplier: column("supplier", "supplier name"),
        contract: column("contract", "year", "contract year"),
        file: column("file", "file name", "file path", "path"),
        type: column("type", "supplier type"),
        management: column("management", "management name"),
        note: column("note", "problem note", "keterangan"),
      };
      const statusColumns = headers
        .map((header, index) => ({ header, index }))
        .filter(
          ({ header }) => header === "status" || header === "workflow status",
        )
        .map(({ index }) => index);
      for (
        let rowIndex = headerIndex + 1;
        rowIndex < rows.length;
        rowIndex += 1
      ) {
        const row = rows[rowIndex];
        const supplierName = importCell(row[columns.supplier]);
        if (!supplierName) continue;
        summary.totalRows += 1;
        const contractPeriod =
          importCell(row[columns.contract]) || "Unspecified";
        const year =
          Number.parseInt(contractPeriod.match(/(?:19|20)\d{2}/)?.[0], 10) ||
          new Date().getFullYear();
        const fullPath =
          importCell(row[columns.file]) ||
          `Excel import/${req.file.originalname}/${sheetName}/row-${rowIndex + 1}`;
        const fileName =
          path.win32.basename(fullPath) || `${supplierName} ${year}`;
        const parentPath = path.win32.dirname(fullPath);
        const fingerprint = crypto
          .createHash("sha256")
          .update(`pending:${year}:${fullPath}`)
          .digest();
        const pathHash = crypto
          .createHash("sha256")
          .update(fullPath.toLowerCase())
          .digest();
        const [existing] = await connection.execute(
          "SELECT id FROM contract_scan_results WHERE fingerprint=? LIMIT 1",
          [fingerprint],
        );
        if (existing.length) {
          summary.skipped += 1;
          skippedRows.push({
            sheet_name: sheetName,
            row_number: rowIndex + 1,
            supplier_name: supplierName,
            reason: "This pending row was already imported.",
          });
          continue;
        }
        await connection.execute(
          `INSERT INTO contract_scan_sources (server_id, year, base_path, target_folder, module_key, enabled, created_by, updated_by)
           VALUES ('excel-pending', ?, 'C:\\\\Excel Imports', ?, 'CONTRACT', 0, ?, ?)
           ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
          [
            year,
            req.file.originalname.slice(0, 512),
            req.admin.id,
            req.admin.id,
          ],
        );
        const [[source]] = await connection.execute(
          "SELECT id FROM contract_scan_sources WHERE server_id='excel-pending' AND year=? AND base_path='C:\\\\Excel Imports' AND target_folder=? LIMIT 1",
          [year, req.file.originalname.slice(0, 512)],
        );
        const [scanResult] = await connection.execute(
          `INSERT INTO contract_scan_results
             (source_id, full_path, parent_path, file_name, extension, date_modified_utc, path_hash, fingerprint, detected_signed_status)
           VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, ?, 'BELUM_SIGNED')`,
          [
            source.id,
            fullPath,
            parentPath,
            fileName,
            path.win32.extname(fileName).slice(0, 50) || null,
            pathHash,
            fingerprint,
          ],
        );
        const managementName = importCell(row[columns.management]);
        const supplierStatusText = importCell(
          row[statusColumns[0]],
        ).toLowerCase();
        const queueSupplierStatus = /booked product/.test(supplierStatusText)
          ? "HAS_BOOKED_PRODUCT"
          : /^(?:blm|belum|tidak)/.test(supplierStatusText)
            ? "NOT_IN_JAMBIX"
            : "IN_JAMBIX";
        const workflowColumn =
          statusColumns.length > 1 ? statusColumns[1] : statusColumns[0];
        const rawState = importCell(row[workflowColumn])
          .toUpperCase()
          .replace(/[^A-Z]+/g, "_")
          .replace(/^_+|_+$/g, "");
        const stateAliases = {
          NEW: "UNHANDLED",
          NOT_HANDLED: "UNHANDLED",
          BELUM_DIHANDLE: "UNHANDLED",
          PROGRESS: "IN_PROGRESS",
          PROSES: "IN_PROGRESS",
          OP_BELUM_ADA_BALASAN: "OP_NO_RESPONSE",
          OP_MENUNGGU: "OP_WAITING",
          DATABASE_PENDING_VARIANT: "DB_PENDING_VARIANT",
        };
        const workflowState = WORKFLOW_STATES.includes(rawState)
          ? rawState
          : stateAliases[rawState] || "UNHANDLED";
        const [pendingResult] = await connection.execute(
          `INSERT INTO contract_pending
             (scan_result_id, is_management_contract, management_name, status, workflow_state, contract_period, queue_supplier_status, note)
           VALUES (?, ?, ?, 'NEW', ?, ?, ?, ?)`,
          [
            scanResult.insertId,
            managementName ? 1 : 0,
            managementName || null,
            workflowState,
            contractPeriod,
            queueSupplierStatus,
            importCell(row[columns.note]) || null,
          ],
        );
        const supplierLookupName = supplierName
          .replace(/\([^)]*(?:jambix|booked product)[^)]*\)/gi, "")
          .trim();
        const supplier =
          suppliers.get(
            normalizeName(supplierLookupName, { keepGeneric: true }),
          ) || null;
        await connection.execute(
          `INSERT INTO contract_pending_suppliers
             (pending_id, supplier_id, detected_supplier_name, recommendation_source, detection, supplier_type, location_jambix, signed_status)
           VALUES (?, ?, ?, 'MANUAL', ?, ?, ?, 'BELUM_SIGNED')`,
          [
            pendingResult.insertId,
            supplier?.supplier_id || null,
            supplier ? null : supplierName,
            supplier ? "SUPPLIER_MATCH" : "NO_MATCH",
            importCell(row[columns.type]) || null,
            supplier?.location || null,
          ],
        );
        summary.inserted += 1;
      }
    }
    await connection.commit();
    return res.json({ success: true, summary, skippedRows });
  } catch (error) {
    await connection.rollback();
    console.error("Import pending queue error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to import the pending queue.",
    });
  } finally {
    connection.release();
  }
}

async function classifySupplier(connection, supplierId, recommendationSource) {
  const [reports] = await connection.execute(
    `SELECT id, file_source, location_jambix, supplier_type,
            CAST(validity_start AS CHAR) AS validity_start,
            CAST(validity_end AS CHAR) AS validity_end,
            status, contract_reference, signed_status, note
       FROM contract_reports
      WHERE supplier_id = ?
      ORDER BY validity_end DESC, id DESC
      LIMIT 25`,
    [supplierId],
  );
  if (reports.length) return { detection: "ACTIVE_CONTRACT", reports };
  return {
    detection:
      recommendationSource === "MANUAL" ? "NO_MATCH" : "SUPPLIER_MATCH",
    reports: [],
  };
}

async function createPending(req, res) {
  const scanResultId = parseId(req.params.id);
  if (!scanResultId)
    return res
      .status(400)
      .json({ success: false, message: "Scan result ID tidak valid." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [results] = await connection.execute(
      "SELECT id, processed FROM contract_scan_results WHERE id = ? FOR UPDATE",
      [scanResultId],
    );
    if (!results.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Hasil scan tidak ditemukan." });
    }
    if (results[0].processed) throw new Error("Hasil scan ini sudah diproses.");
    const [existing] = await connection.execute(
      "SELECT * FROM contract_pending WHERE scan_result_id = ? FOR UPDATE",
      [scanResultId],
    );
    let pending;
    if (!existing.length) {
      const [inserted] = await connection.execute(
        `INSERT INTO contract_pending
           (scan_result_id, status, claimed_by, claimed_at)
         VALUES (?, 'NEW', ?, CURRENT_TIMESTAMP(3))`,
        [scanResultId, req.admin.id],
      );
      pending = { id: inserted.insertId, status: "NEW" };
    } else {
      pending = existing[0];
      if (["DONE", "IGNORED"].includes(pending.status))
        throw new Error("Pending item ini sudah selesai.");
      if (pending.claimed_by && pending.claimed_by !== req.admin.id) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "Item sedang diproses oleh user lain.",
        });
      }
      await connection.execute(
        `UPDATE contract_pending
            SET claimed_by = ?, claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP(3)),
                version = version + 1
          WHERE id = ?`,
        [req.admin.id, pending.id],
      );
    }
    await connection.commit();
    return res.status(existing.length ? 200 : 201).json({
      success: true,
      message: "Item siap diproses.",
      pending_id: pending.id,
    });
  } catch (error) {
    await connection.rollback();
    if (
      isValidationError(error) ||
      /sudah diproses|sudah selesai/i.test(error.message || "")
    )
      return badRequest(res, error);
    console.error("Create contract pending error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal membuka item untuk diproses." });
  } finally {
    connection.release();
  }
}

async function listPending(req, res) {
  const { page, limit, offset } = pagination(req.query);
  try {
    const params = [];
    const conditions = ["p.status <> 'DONE'"];
    const multiValues = (value) => [
      ...new Set(
        (Array.isArray(value) ? value : String(value || "").split(","))
          .map((item) => String(item).trim())
          .filter(Boolean),
      ),
    ];
    const statuses = multiValues(req.query.status);
    if (statuses.length) {
      const valid = statuses.map((status) =>
        enumValue(status, WORKFLOW_STATES, "Workflow status", {
          required: true,
        }),
      );
      conditions.push(
        `p.workflow_state IN (${valid.map(() => "?").join(",")})`,
      );
      params.push(...valid);
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
    const supplierStatuses = multiValues(req.query.supplier_status).map(
      (status) =>
        enumValue(
          status,
          [
            "IN_JAMBIX",
            "NOT_IN_JAMBIX",
            "HAS_BOOKED_PRODUCT",
            "HAS_HOTEL_OPTION",
          ],
          "Supplier status",
          { required: true },
        ),
    );
    const supplierStatusSql = {
      NOT_IN_JAMBIX:
        "(p.queue_supplier_status = 'NOT_IN_JAMBIX' OR (p.queue_supplier_status IS NULL AND s.supplier_id IS NULL))",
      IN_JAMBIX:
        "(p.queue_supplier_status = 'IN_JAMBIX' OR (p.queue_supplier_status IS NULL AND s.supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM booked_products bp_jambix WHERE bp_jambix.supplier_id = ps.supplier_id)))",
      HAS_BOOKED_PRODUCT:
        "(p.queue_supplier_status = 'HAS_BOOKED_PRODUCT' OR EXISTS (SELECT 1 FROM booked_products bp_filter WHERE bp_filter.supplier_id = ps.supplier_id))",
      HAS_HOTEL_OPTION:
        "EXISTS (SELECT 1 FROM hotel_options ho_filter WHERE ho_filter.supplier_id = ps.supplier_id)",
    };
    if (supplierStatuses.length)
      conditions.push(
        `(${supplierStatuses.map((status) => supplierStatusSql[status]).join(" OR ")})`,
      );
    const where = `WHERE ${conditions.join(" AND ")}`;
    const [rows] = await pool.query(
      `SELECT ps.supplier_id, ps.detected_supplier_name, s.company_name, s.location AS supplier_location,
              s.category_supplier, ps.detection,
              EXISTS (SELECT 1 FROM booked_products bp WHERE bp.supplier_id = ps.supplier_id) AS has_booked_product,
              EXISTS (SELECT 1 FROM hotel_options ho WHERE ho.supplier_id = ps.supplier_id) AS has_hotel_option,
              p.id, p.scan_result_id, p.is_management_contract, p.management_group_id, p.contract_period, p.queue_supplier_status,
              ps.supplier_type, p.status, p.workflow_state, p.claimed_by, p.claimed_at, p.completed_at, p.version, p.note,
              r.file_name, r.full_path, r.detected_signed_status, src.year,
              CAST(r.date_modified_utc AS CHAR) AS date_modified_utc,
              COALESCE(p.management_name, g.name) AS management_group_name, u.fullname AS claimed_by_name
         FROM contract_pending p
         JOIN contract_pending_suppliers ps ON ps.pending_id = p.id
         LEFT JOIN suppliers s ON s.supplier_id = ps.supplier_id
         JOIN contract_scan_results r ON r.id = p.scan_result_id
         JOIN contract_scan_sources src ON src.id = r.source_id
         LEFT JOIN contract_management_groups g ON g.id = p.management_group_id
         LEFT JOIN users u ON u.id = p.claimed_by
         ${where} ORDER BY s.company_name, p.updated_at DESC`,
      params,
    );
    const grouped = new Map();
    for (const row of rows) {
      const groupKey = row.is_management_contract
        ? `management-${row.management_group_id || row.id}`
        : row.supplier_id
          ? `supplier-${row.supplier_id}`
          : `unmatched-${row.id}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          key: groupKey,
          is_management: Boolean(row.is_management_contract),
          management_group_id: row.management_group_id,
          management_group_name:
            row.management_group_name ||
            (row.is_management_contract ? "Management contract" : null),
          suppliers: [],
        });
      }
      const group = grouped.get(groupKey);
      let supplier = group.suppliers.find(
        (item) => item.supplier_id === row.supplier_id,
      );
      if (!supplier) {
        supplier = {
          supplier_id: row.supplier_id,
          company_name:
            row.company_name ||
            row.detected_supplier_name ||
            "Unknown supplier",
          supplier_location: row.supplier_location,
          category_supplier: parseCategories(row.category_supplier),
          supplier_type: row.supplier_type,
          jambix_status:
            row.queue_supplier_status === "NOT_IN_JAMBIX"
              ? "NOT_IN_JAMBIX"
              : row.company_name
                ? "IN_JAMBIX"
                : "NOT_IN_JAMBIX",
          has_booked_product:
            row.queue_supplier_status === "HAS_BOOKED_PRODUCT" ||
            Boolean(row.has_booked_product),
          has_hotel_option: Boolean(row.has_hotel_option),
          files: [],
        };
        group.suppliers.push(supplier);
      }
      supplier.files.push({
        id: row.id,
        scan_result_id: row.scan_result_id,
        is_management_contract: row.is_management_contract,
        management_group_id: row.management_group_id,
        management_group_name: row.management_group_name,
        status: row.status,
        workflow_state: row.workflow_state,
        contract_period: row.contract_period || String(row.year),
        year: Number(row.year),
        claimed_by: row.claimed_by,
        claimed_by_name: row.claimed_by_name,
        claimed_at: row.claimed_at,
        completed_at: row.completed_at,
        version: row.version,
        note: row.note,
        file_name: row.file_name,
        full_path: row.full_path,
        date_modified_utc: row.date_modified_utc,
        detected_signed_status: row.detected_signed_status,
      });
    }
    const queueGroups = [...grouped.values()];
    const categories = [
      ...new Set(rows.flatMap((row) => parseCategories(row.category_supplier))),
    ].sort();
    return res.json({
      success: true,
      page,
      limit,
      total: queueGroups.length,
      categories,
      pending: queueGroups.slice(offset, offset + limit),
    });
  } catch (error) {
    if (isValidationError(error)) return badRequest(res, error);
    console.error("List contract pending error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal mengambil pending item." });
  }
}

async function getPending(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Pending ID tidak valid." });
  try {
    const [rows] = await pool.execute(
      `SELECT p.*, r.full_path, r.parent_path, r.file_name, r.detected_signed_status,
              r.date_modified_utc, s.base_path, s.year, s.target_folder,
              COALESCE(p.management_name, g.name) AS management_group_name
         FROM contract_pending p
         JOIN contract_scan_results r ON r.id = p.scan_result_id
         JOIN contract_scan_sources s ON s.id = r.source_id
         LEFT JOIN contract_management_groups g ON g.id = p.management_group_id
        WHERE p.id = ?`,
      [id],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({ success: false, message: "Pending item tidak ditemukan." });
    const [suppliers] = await pool.execute(
      `SELECT ps.*,
              CAST(ps.validity_start AS CHAR) AS validity_start,
              CAST(ps.validity_end AS CHAR) AS validity_end,
              COALESCE(s.company_name, ps.detected_supplier_name) AS company_name,
              s.category_supplier, s.location AS supplier_location
         FROM contract_pending_suppliers ps
         LEFT JOIN suppliers s ON s.supplier_id = ps.supplier_id
        WHERE ps.pending_id = ? ORDER BY COALESCE(s.company_name, ps.detected_supplier_name)`,
      [id],
    );
    for (const supplier of suppliers) {
      supplier.category_supplier = parseCategories(supplier.category_supplier);
      const classified = await classifySupplier(
        pool,
        supplier.supplier_id,
        supplier.recommendation_source,
      );
      supplier.active_contracts = classified.reports;
      if (!supplier.action && classified.reports.length) {
        const report = classified.reports[0];
        supplier.action = "UPDATE";
        supplier.target_contract_report_id = report.id;
        supplier.supplier_type = report.supplier_type;
        supplier.location_jambix = report.location_jambix;
        supplier.validity_start = report.validity_start;
        supplier.validity_end = report.validity_end;
        supplier.contract_reference = report.contract_reference;
        supplier.signed_status = report.signed_status;
        supplier.note = report.note;
      }
    }
    let groupMembersNotSelected = [];
    if (rows[0].management_group_id) {
      const [missing] = await pool.execute(
        `SELECT s.supplier_id, s.company_name, s.location
           FROM supplier_management_group_history h
           JOIN suppliers s ON s.supplier_id = h.supplier_id
          WHERE h.group_id = ? AND h.end_date IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM contract_pending_suppliers ps
               WHERE ps.pending_id = ? AND ps.supplier_id = h.supplier_id
            )
          ORDER BY s.company_name`,
        [rows[0].management_group_id, id],
      );
      groupMembersNotSelected = missing;
    }
    return res.json({
      success: true,
      pending: {
        ...rows[0],
        suppliers,
        group_members_not_selected: groupMembersNotSelected,
      },
    });
  } catch (error) {
    console.error("Get contract pending error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal mengambil pending item." });
  }
}

async function updatePending(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Pending ID tidak valid." });
  const connection = await pool.getConnection();
  try {
    const groupId =
      req.body?.management_group_id === null ||
      req.body?.management_group_id === undefined
        ? null
        : parseId(req.body.management_group_id);
    const note = textValue(req.body?.note, "Note", { max: 10000 });
    const managementName = textValue(
      req.body?.management_name,
      "Management name",
      { max: 255 },
    );
    await connection.beginTransaction();
    const [pendingRows] = await connection.execute(
      `SELECT p.*, r.full_path, r.detected_signed_status, s.base_path, s.year, s.target_folder
         FROM contract_pending p
         JOIN contract_scan_results r ON r.id = p.scan_result_id
         JOIN contract_scan_sources s ON s.id = r.source_id
        WHERE p.id = ? FOR UPDATE`,
      [id],
    );
    if (!pendingRows.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Pending item tidak ditemukan." });
    }
    if (["DONE", "IGNORED"].includes(pendingRows[0].status))
      throw new Error("Pending item sudah selesai.");
    if (pendingRows[0].claimed_by !== req.admin.id) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Pending item tidak diklaim oleh user ini.",
      });
    }
    const isManagement =
      req.body?.is_management_contract === undefined
        ? Boolean(pendingRows[0].is_management_contract)
        : booleanValue(req.body.is_management_contract);
    const requestedGroupId =
      req.body?.management_group_id === undefined
        ? pendingRows[0].management_group_id
        : groupId;
    if (
      isManagement &&
      req.body?.management_group_id !== undefined &&
      req.body.management_group_id !== null &&
      !groupId
    ) {
      throw new Error("Management group ID tidak valid.");
    }
    if (!isManagement && req.body?.management_group_id)
      throw new Error(
        "Management group hanya boleh dipilih untuk kontrak manajemen.",
      );
    const resolvedGroupId = isManagement ? requestedGroupId : null;
    if (resolvedGroupId) {
      const [groups] = await connection.execute(
        "SELECT id FROM contract_management_groups WHERE id = ? AND status = 'ACTIVE'",
        [resolvedGroupId],
      );
      if (!groups.length)
        throw new Error("Management group tidak ditemukan atau tidak aktif.");
    }
    await connection.execute(
      `UPDATE contract_pending
          SET is_management_contract = ?, management_group_id = ?, management_name = ?, note = ?, version = version + 1
        WHERE id = ?`,
      [
        isManagement,
        isManagement ? resolvedGroupId : null,
        isManagement ? managementName || pendingRows[0].management_name : null,
        note ?? pendingRows[0].note,
        id,
      ],
    );
    let prefilled = 0;
    if (
      isManagement &&
      resolvedGroupId &&
      req.body?.prefill_group_members !== false
    ) {
      const [members] = await connection.execute(
        `SELECT s.supplier_id, s.company_name, s.location
           FROM supplier_management_group_history h
           JOIN suppliers s ON s.supplier_id = h.supplier_id
          WHERE h.group_id = ? AND h.end_date IS NULL AND LOWER(s.status) = 'active'`,
        [resolvedGroupId],
      );
      for (const member of members) {
        const classification = await classifySupplier(
          connection,
          member.supplier_id,
          "GROUP",
        );
        const [inserted] = await connection.execute(
          `INSERT IGNORE INTO contract_pending_suppliers
             (pending_id, supplier_id, recommendation_source, detection, location_jambix, signed_status)
           VALUES (?, ?, 'GROUP', ?, ?, ?)`,
          [
            id,
            member.supplier_id,
            classification.detection,
            member.location,
            pendingRows[0].detected_signed_status,
          ],
        );
        prefilled += inserted.affectedRows;
      }
    }
    await connection.commit();
    return res.json({
      success: true,
      message: "Pending item berhasil diperbarui.",
      prefilled_supplier_count: prefilled,
    });
  } catch (error) {
    await connection.rollback();
    if (
      isValidationError(error) ||
      /management|selesai/i.test(error.message || "")
    )
      return badRequest(res, error);
    console.error("Update contract pending error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal memperbarui pending item." });
  } finally {
    connection.release();
  }
}

function nullableScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1)
    throw new Error("Match score tidak valid.");
  return number;
}

async function saveSuppliers(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Pending ID tidak valid." });
  if (!Array.isArray(req.body?.suppliers) || !req.body.suppliers.length) {
    return res.status(400).json({
      success: false,
      message: "Minimal satu supplier wajib dipilih.",
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [pendingRows] = await connection.execute(
      `SELECT p.*, r.full_path, r.detected_signed_status, s.base_path, s.year, s.target_folder
         FROM contract_pending p
         JOIN contract_scan_results r ON r.id = p.scan_result_id
         JOIN contract_scan_sources s ON s.id = r.source_id
        WHERE p.id = ? FOR UPDATE`,
      [id],
    );
    if (!pendingRows.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Pending item tidak ditemukan." });
    }
    const pending = pendingRows[0];
    if (["DONE", "IGNORED"].includes(pending.status))
      throw new Error("Pending item sudah selesai.");
    if (pending.claimed_by !== req.admin.id) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Pending item tidak diklaim oleh user ini.",
      });
    }
    if (!pending.is_management_contract && req.body.suppliers.length !== 1) {
      throw new Error("Kontrak biasa hanya boleh memiliki satu supplier.");
    }
    const ids = req.body.suppliers
      .map((row) => parseId(row.supplier_id))
      .filter(Boolean);
    if (new Set(ids).size !== ids.length)
      throw new Error("Supplier ID duplikat atau tidak valid.");
    const [supplierRows] = ids.length
      ? await connection.execute(
          `SELECT supplier_id, company_name, category_supplier, location FROM suppliers
          WHERE supplier_id IN (${ids.map(() => "?").join(",")})`,
          ids,
        )
      : [[]];
    if (supplierRows.length !== ids.length)
      throw new Error("Sebagian supplier tidak ditemukan.");
    const supplierMap = new Map(
      supplierRows.map((row) => [row.supplier_id, row]),
    );
    await connection.execute(
      "DELETE FROM contract_pending_suppliers WHERE pending_id = ?",
      [id],
    );
    for (const input of req.body.suppliers) {
      const supplierId = parseId(input.supplier_id);
      if (!supplierId) {
        const detectedName = textValue(
          input.detected_supplier_name || input.company_name,
          "Detected supplier name",
          { required: true, max: 255 },
        );
        await connection.execute(
          `INSERT INTO contract_pending_suppliers
             (pending_id, supplier_id, detected_supplier_name, recommendation_source, detection,
              action, supplier_type, location_jambix, validity_start, validity_end,
              contract_reference, signed_status, note)
           VALUES (?, NULL, ?, 'MANUAL', 'NO_MATCH', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            detectedName,
            input.action
              ? enumValue(input.action, ACTIONS, "Action", { required: true })
              : null,
            textValue(input.supplier_type, "Supplier type", { max: 100 }),
            textValue(input.location_jambix, "Location Jambix", { max: 500 }),
            input.validity_start
              ? dateValue(input.validity_start, "Validity start")
              : null,
            input.validity_end
              ? dateValue(input.validity_end, "Validity end")
              : null,
            textValue(input.contract_reference, "Contract reference", {
              max: 255,
            }),
            enumValue(
              input.signed_status || pending.detected_signed_status,
              SIGNED_STATUSES,
              "Signed status",
              { required: true },
            ),
            textValue(input.note, "Note", { max: 10000 }),
          ],
        );
        continue;
      }
      const source = enumValue(
        input.recommendation_source || "MANUAL",
        RECOMMENDATION_SOURCES,
        "Recommendation source",
        { required: true },
      );
      const classification = await classifySupplier(
        connection,
        supplierId,
        source,
      );
      const action = input.action
        ? enumValue(input.action, ACTIONS, "Action", { required: true })
        : null;
      const targetId = input.target_contract_report_id
        ? parseId(input.target_contract_report_id)
        : null;
      if (action === "UPDATE" && !targetId)
        throw new Error("Target contract report wajib dipilih untuk update.");
      const supplier = supplierMap.get(supplierId);
      const location =
        textValue(input.location_jambix, "Location Jambix", { max: 500 }) ||
        supplier.location;
      await connection.execute(
        `INSERT INTO contract_pending_suppliers
           (pending_id, supplier_id, recommendation_source, match_score, detection, action,
            target_contract_report_id, supplier_type, location_jambix, validity_start,
            validity_end, contract_reference, signed_status, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          supplierId,
          source,
          nullableScore(input.match_score),
          classification.detection,
          action,
          targetId,
          textValue(input.supplier_type, "Supplier type", { max: 100 }),
          location,
          input.validity_start
            ? dateValue(input.validity_start, "Validity start")
            : null,
          input.validity_end
            ? dateValue(input.validity_end, "Validity end")
            : null,
          textValue(input.contract_reference, "Contract reference", {
            max: 255,
          }),
          enumValue(
            input.signed_status || pending.detected_signed_status,
            SIGNED_STATUSES,
            "Signed status",
            { required: true },
          ),
          textValue(input.note, "Note", { max: 10000 }),
        ],
      );
    }
    await connection.execute(
      "UPDATE contract_pending SET version = version + 1 WHERE id = ?",
      [id],
    );
    await connection.commit();
    return res.json({
      success: true,
      message: "Daftar supplier berhasil disimpan.",
    });
  } catch (error) {
    await connection.rollback();
    if (
      isValidationError(error) ||
      /supplier|target|action|score|selesai/i.test(error.message || "")
    )
      return badRequest(res, error);
    console.error("Save contract pending suppliers error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal menyimpan daftar supplier." });
  } finally {
    connection.release();
  }
}

async function startPending(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Pending ID tidak valid." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT * FROM contract_pending WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!rows.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Pending item tidak ditemukan." });
    }
    const pending = rows[0];
    if (["DONE", "IGNORED"].includes(pending.status))
      throw new Error("Pending item sudah selesai.");
    if (pending.claimed_by !== req.admin.id) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Pending item tidak diklaim oleh user ini.",
      });
    }
    const [[count]] = await connection.execute(
      "SELECT COUNT(*) AS total FROM contract_pending_suppliers WHERE pending_id = ?",
      [id],
    );
    if (!count.total)
      throw new Error(
        "Add a supplier or queue the detected folder name before starting progress.",
      );
    await connection.execute(
      `UPDATE contract_pending SET status = 'IN_PROGRESS', workflow_state = 'IN_PROGRESS', version = version + 1 WHERE id = ?`,
      [id],
    );
    await connection.commit();
    return res.json({
      success: true,
      message: "File masuk progress dan siap dilengkapi.",
    });
  } catch (error) {
    await connection.rollback();
    if (
      isValidationError(error) ||
      /supplier|selesai/i.test(error.message || "")
    )
      return badRequest(res, error);
    console.error("Start contract pending error:", error);
    return res.status(500).json({
      success: false,
      message: "Gagal memulai progress pending item.",
    });
  } finally {
    connection.release();
  }
}

async function queueUnmatched(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Pending ID is invalid." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT p.*, r.parent_path, r.detected_signed_status
         FROM contract_pending p
         JOIN contract_scan_results r ON r.id = p.scan_result_id
        WHERE p.id = ? FOR UPDATE`,
      [id],
    );
    if (!rows.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Pending item was not found." });
    }
    const pending = rows[0];
    if (pending.status !== "NEW")
      throw new Error(
        "Only a new item can be queued without a Jambix supplier.",
      );
    if (pending.claimed_by !== req.admin.id) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "This item is not claimed by the current user.",
      });
    }
    const detectedName =
      String(pending.parent_path || "")
        .split(/[\\/]/)
        .filter(Boolean)
        .pop()
        ?.trim()
        .slice(0, 255) || "Unknown supplier";
    await connection.execute(
      "DELETE FROM contract_pending_suppliers WHERE pending_id = ?",
      [id],
    );
    await connection.execute(
      `INSERT INTO contract_pending_suppliers
         (pending_id, supplier_id, detected_supplier_name, recommendation_source,
          detection, signed_status)
       VALUES (?, NULL, ?, 'MANUAL', 'NO_MATCH', ?)`,
      [id, detectedName, pending.detected_signed_status],
    );
    await connection.execute(
      "UPDATE contract_pending SET version = version + 1 WHERE id = ?",
      [id],
    );
    await connection.commit();
    return res.json({
      success: true,
      message: "Item added to the queue as Not in Jambix.",
    });
  } catch (error) {
    await connection.rollback();
    if (
      isValidationError(error) ||
      /only a new item/i.test(error.message || "")
    )
      return badRequest(res, error);
    console.error("Queue unmatched contract pending error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to queue the unmatched supplier.",
    });
  } finally {
    connection.release();
  }
}

async function completePending(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Pending ID tidak valid." });
  const expectedVersion = Number.parseInt(req.body?.version, 10);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return res.status(400).json({
      success: false,
      message: "Version pending wajib dan harus valid.",
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [pendingRows] = await connection.execute(
      `SELECT p.*, r.full_path
         FROM contract_pending p JOIN contract_scan_results r ON r.id = p.scan_result_id
        WHERE p.id = ? FOR UPDATE`,
      [id],
    );
    if (!pendingRows.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Pending item tidak ditemukan." });
    }
    const pending = pendingRows[0];
    if (pending.status === "DONE") {
      await connection.rollback();
      return res.json({
        success: true,
        message: "Pending item sebelumnya sudah diselesaikan.",
        already_completed: true,
      });
    }
    if (pending.status === "IGNORED")
      throw new Error("Pending item sudah diabaikan.");
    if (pending.status !== "IN_PROGRESS")
      throw new Error("Pending item harus masuk progress sebelum Mark Done.");
    if (pending.claimed_by !== req.admin.id) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Pending item tidak diklaim oleh user ini.",
      });
    }
    if (pending.version !== expectedVersion) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Data berubah. Muat ulang sebelum Mark Done.",
      });
    }
    const [items] = await connection.execute(
      `SELECT ps.*, s.region AS supplier_region
         FROM contract_pending_suppliers ps
         LEFT JOIN suppliers s ON s.supplier_id = ps.supplier_id
        WHERE ps.pending_id = ? ORDER BY ps.id FOR UPDATE`,
      [id],
    );
    if (!items.length) throw new Error("Minimal satu supplier wajib dipilih.");
    if (items.some((item) => !item.supplier_id)) {
      throw new Error(
        "Assign the supplier in Jambix before Mark Done. Import the supplier first if it is not available.",
      );
    }
    if (!pending.is_management_contract && items.length !== 1) {
      throw new Error("Kontrak biasa hanya boleh memiliki satu supplier.");
    }
    const reportIds = [];
    for (const item of items) {
      if (!item.action)
        throw new Error(`Action supplier ${item.supplier_id} wajib dipilih.`);
      const supplierType = textValue(item.supplier_type, "Supplier type", {
        required: true,
        max: 100,
      });
      await validateSupplierType(connection, item.supplier_id, supplierType);
      const validityStart = dateValue(item.validity_start, "Validity start", {
        required: true,
      });
      const validityEnd = dateValue(item.validity_end, "Validity end", {
        required: true,
      });
      if (validityEnd < validityStart)
        throw new Error(
          "Validity end tidak boleh lebih awal dari validity start.",
        );
      const status = validityEnd < todayWita() ? "EXPIRED" : "ACTIVE";
      const periodStatuses = parsePeriodStatuses(
        item.contract_reference,
        validityStart,
      );
      if (item.action === "UPDATE") {
        if (!item.target_contract_report_id)
          throw new Error("Target contract report wajib dipilih untuk update.");
        const [reports] = await connection.execute(
          "SELECT * FROM contract_reports WHERE id = ? FOR UPDATE",
          [item.target_contract_report_id],
        );
        if (!reports.length || reports[0].supplier_id !== item.supplier_id) {
          throw new Error(
            "Target contract report tidak ditemukan atau bukan milik supplier tersebut.",
          );
        }
        const before = reportSnapshot(reports[0]);
        await connection.execute(
          `UPDATE contract_reports SET source_scan_result_id = ?, file_source = ?,
             location_jambix = ?, region = ?, supplier_type = ?, validity_start = ?, validity_end = ?,
             status = ?, source_status = 'Complete', contract_reference = ?, signed_status = ?, period_statuses = ?, note = ?, updated_by = ?
           WHERE id = ?`,
          [
            pending.scan_result_id,
            pending.full_path,
            item.location_jambix,
            item.supplier_region,
            supplierType,
            validityStart,
            validityEnd,
            status,
            item.contract_reference,
            item.signed_status,
            JSON.stringify(periodStatuses),
            item.note,
            req.admin.id,
            item.target_contract_report_id,
          ],
        );
        const [updatedRows] = await connection.execute(
          "SELECT * FROM contract_reports WHERE id = ?",
          [item.target_contract_report_id],
        );
        await connection.execute(
          `INSERT INTO contract_report_revisions
             (contract_report_id, action, before_data, after_data, changed_by)
           VALUES (?, 'UPDATE', ?, ?, ?)`,
          [
            item.target_contract_report_id,
            JSON.stringify(before),
            JSON.stringify(reportSnapshot(updatedRows[0])),
            req.admin.id,
          ],
        );
        reportIds.push(item.target_contract_report_id);
      } else {
        const [inserted] = await connection.execute(
          `INSERT INTO contract_reports
             (source_scan_result_id, file_source, location_jambix, region, supplier_id, supplier_type,
              validity_start, validity_end, status, source_status, contract_reference, signed_status, period_statuses, note,
              created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Complete', ?, ?, ?, ?, ?, ?)`,
          [
            pending.scan_result_id,
            pending.full_path,
            item.location_jambix,
            item.supplier_region,
            item.supplier_id,
            supplierType,
            validityStart,
            validityEnd,
            status,
            item.contract_reference,
            item.signed_status,
            JSON.stringify(periodStatuses),
            item.note,
            req.admin.id,
            req.admin.id,
          ],
        );
        const [createdRows] = await connection.execute(
          "SELECT * FROM contract_reports WHERE id = ?",
          [inserted.insertId],
        );
        await connection.execute(
          `INSERT INTO contract_report_revisions
             (contract_report_id, action, before_data, after_data, changed_by)
           VALUES (?, 'INSERT', NULL, ?, ?)`,
          [
            inserted.insertId,
            JSON.stringify(reportSnapshot(createdRows[0])),
            req.admin.id,
          ],
        );
        reportIds.push(inserted.insertId);
      }
    }
    await connection.execute(
      `UPDATE contract_pending SET status = 'DONE', workflow_state = 'DONE', completed_by = ?,
              completed_at = CURRENT_TIMESTAMP(3), version = version + 1 WHERE id = ?`,
      [req.admin.id, id],
    );
    await connection.execute(
      "UPDATE contract_scan_results SET processed = 1, processed_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [pending.scan_result_id],
    );
    await connection.commit();
    return res.json({
      success: true,
      message: "Kontrak berhasil disimpan dan item ditandai selesai.",
      report_ids: reportIds,
    });
  } catch (error) {
    await connection.rollback();
    if (
      isValidationError(error) ||
      /supplier|target|action|validity|diabaikan|progress|assign|import/i.test(
        error.message || "",
      )
    )
      return badRequest(res, error);
    console.error("Complete contract pending error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal menyelesaikan pending item." });
  } finally {
    connection.release();
  }
}

async function ignorePending(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Pending ID tidak valid." });
  const connection = await pool.getConnection();
  try {
    const reason = textValue(req.body?.reason, "Alasan", {
      required: true,
      max: 10000,
    });
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT * FROM contract_pending WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!rows.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Pending item tidak ditemukan." });
    }
    if (["DONE", "IGNORED"].includes(rows[0].status)) {
      await connection.rollback();
      return res
        .status(409)
        .json({ success: false, message: "Pending item sudah selesai." });
    }
    if (rows[0].claimed_by && rows[0].claimed_by !== req.admin.id) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Item sedang diproses oleh user lain.",
      });
    }
    await connection.execute(
      `UPDATE contract_pending SET status = 'IGNORED', workflow_state = 'IGNORED', note = ?, completed_by = ?,
              completed_at = CURRENT_TIMESTAMP(3), version = version + 1 WHERE id = ?`,
      [reason, req.admin.id, id],
    );
    await connection.execute(
      "UPDATE contract_scan_results SET processed = 1, processed_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [rows[0].scan_result_id],
    );
    await connection.commit();
    return res.json({ success: true, message: "Pending item diabaikan." });
  } catch (error) {
    await connection.rollback();
    if (isValidationError(error)) return badRequest(res, error);
    console.error("Ignore contract pending error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal mengabaikan pending item." });
  } finally {
    connection.release();
  }
}

async function updateQueueMeta(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Pending ID is invalid." });
  try {
    const workflowState = enumValue(
      req.body?.workflow_state,
      WORKFLOW_STATES,
      "Workflow status",
      { required: true },
    );
    const note = textValue(req.body?.note, "Problem note", { max: 10000 });
    const [result] = await pool.execute(
      `UPDATE contract_pending SET workflow_state=?, note=?, version=version+1
        WHERE id=? AND status NOT IN ('DONE', 'IGNORED')`,
      [workflowState, note, id],
    );
    if (!result.affectedRows)
      return res.status(404).json({
        success: false,
        message: "Pending item was not found or is already completed.",
      });
    return res.json({ success: true, message: "Queue status saved." });
  } catch (error) {
    if (isValidationError(error)) return badRequest(res, error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to save queue status." });
  }
}

async function releasePending(req, res) {
  const id = parseId(req.params.id);
  if (!id)
    return res
      .status(400)
      .json({ success: false, message: "Pending ID tidak valid." });
  try {
    const [result] = await pool.execute(
      `UPDATE contract_pending SET claimed_by = NULL, claimed_at = NULL,
              version = version + 1
        WHERE id = ? AND claimed_by = ? AND status IN ('NEW', 'IN_PROGRESS')`,
      [id, req.admin.id],
    );
    if (!result.affectedRows)
      return res.status(409).json({
        success: false,
        message: "Pending item tidak dapat dilepas oleh user ini.",
      });
    return res.json({
      success: true,
      message: "Claim pending item berhasil dilepas.",
    });
  } catch (error) {
    console.error("Release contract pending error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal melepas pending item." });
  }
}

module.exports = {
  completePending,
  createPending,
  getPending,
  ignorePending,
  listPending,
  queueUnmatched,
  releasePending,
  saveSuppliers,
  startPending,
  updatePending,
  updateQueueMeta,
  importPendingQueue: [pendingUpload.single("file"), importPendingQueue],
};
