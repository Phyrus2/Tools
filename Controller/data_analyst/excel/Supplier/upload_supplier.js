const xlsx = require("xlsx");
const fs = require("fs");
const pool = require("../../../../Database/connection");
const multer = require("multer");

// =====================================================
// MULTER
// =====================================================

const upload = multer({
  dest: "uploads/",
});

// =====================================================
// KOLOM EXCEL YANG DIGUNAKAN
// =====================================================

const ALLOWED_COLUMNS = [
  "id",
  "company_name",
  "address",
  "town",
  "region",
  "location",
];

// =====================================================
// HEADER ALIASES
// =====================================================

const HEADER_ALIASES = {
  id: "id",
  supplierid: "id",
  supplier_id: "id",

  companyname: "company_name",
  company_name: "company_name",

  address: "address",
  addressstreet: "address", // hasil normalisasi dari "Address (Street)"
  street: "address",

  town: "town",
  region: "region",
  location: "location",
};

// =====================================================
// NORMALIZE HEADER
// =====================================================

function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // buang spasi, underscore, tanda kurung, dsb
}

// =====================================================
// MAPPING ROW EXCEL
// =====================================================

function mapRowToColumns(row) {
  const mapped = {};

  for (const [header, value] of Object.entries(row)) {
    const column = HEADER_ALIASES[normalizeHeader(header)];

    if (column && ALLOWED_COLUMNS.includes(column)) {
      mapped[column] =
        value === undefined || value === null || value === ""
          ? null
          : String(value).trim();
    }
  }

  return mapped;
}

// =====================================================
// NORMALIZE VALUE
// =====================================================

function normalizeValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return String(value).trim();
}

// =====================================================
// PARSE CATEGORY
// =====================================================

function parseCategories(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return parsed;
      }

      return parsed ? [parsed] : [];
    } catch (error) {
      // Support data lama
      return [value];
    }
  }

  return [];
}

// =====================================================
// NORMALIZE CATEGORY
// =====================================================

function normalizeCategories(categories) {
  return [
    ...new Set(
      categories
        .filter(Boolean)
        .map((item) => String(item).trim().toUpperCase()),
    ),
  ].sort();
}

// =====================================================
// COMPARE CATEGORY
// =====================================================

function categoriesEqual(a, b) {
  return (
    JSON.stringify(normalizeCategories(a)) ===
    JSON.stringify(normalizeCategories(b))
  );
}

const DATABASE_BATCH_SIZE = 500;

function chunk(items, size = DATABASE_BATCH_SIZE) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function loadExistingSuppliers(connection, supplierIds) {
  const suppliers = new Map();

  for (const idChunk of chunk([...new Set(supplierIds)])) {
    const [rows] = await connection.query(
      `
      SELECT
        supplier_id,
        company_name,
        address,
        town,
        region,
        location,
        category_supplier
      FROM suppliers
      WHERE supplier_id IN (?)
      `,
      [idChunk],
    );

    for (const row of rows) {
      suppliers.set(String(row.supplier_id), row);
    }
  }

  return suppliers;
}

async function saveSuppliers(connection, suppliers) {
  for (const supplierChunk of chunk(suppliers)) {
    const values = supplierChunk.map((supplier) => [
      supplier.supplier_id,
      supplier.company_name,
      supplier.address,
      supplier.town,
      supplier.region,
      supplier.location,
      JSON.stringify(normalizeCategories(parseCategories(supplier.category_supplier))),
    ]);

    await connection.query(
      `
      INSERT INTO suppliers
      (
        supplier_id,
        company_name,
        address,
        town,
        region,
        location,
        category_supplier
      )
      VALUES ?
      ON DUPLICATE KEY UPDATE
        company_name = VALUES(company_name),
        address = VALUES(address),
        town = VALUES(town),
        region = VALUES(region),
        location = VALUES(location),
        category_supplier = VALUES(category_supplier)
      `,
      [values],
    );
  }
}

function recordCategoryChange(changes, supplierId, before, after) {
  const supplierKey = String(supplierId);
  const normalizedBefore = normalizeCategories(before);
  const normalizedAfter = normalizeCategories(after);

  if (categoriesEqual(normalizedBefore, normalizedAfter)) {
    return;
  }

  const recorded = changes.get(supplierKey);

  changes.set(supplierKey, {
    supplier_id: supplierId,
    categories_before: recorded?.categories_before ?? normalizedBefore,
    categories_after: normalizedAfter,
  });
}

async function createImportHistory(connection, details, categoryChanges) {
  const [result] = await connection.query(
    `
    INSERT INTO supplier_imports
    (
      file_name,
      category,
      total_rows,
      inserted_count,
      updated_count,
      unchanged_count,
      skipped_count
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      details.fileName,
      details.category,
      details.totalRows,
      details.inserted,
      details.updated,
      details.unchanged,
      details.skipped,
    ],
  );

  const importId = result.insertId;
  const values = [...categoryChanges.values()].map((change) => [
    importId,
    change.supplier_id,
    JSON.stringify(change.categories_before),
    JSON.stringify(change.categories_after),
  ]);

  for (const valueChunk of chunk(values)) {
    await connection.query(
      `
      INSERT INTO supplier_import_category_changes
      (import_id, supplier_id, categories_before, categories_after)
      VALUES ?
      `,
      [valueChunk],
    );
  }

  return importId;
}

async function updateSupplierCategories(connection, changes) {
  for (const changeChunk of chunk(changes)) {
    const cases = changeChunk.map(() => "WHEN ? THEN ?").join(" ");
    const caseParams = changeChunk.flatMap((change) => [
      change.supplier_id,
      JSON.stringify(change.categories_before),
    ]);
    const supplierIds = changeChunk.map((change) => change.supplier_id);

    await connection.query(
      `
      UPDATE suppliers
      SET category_supplier = CASE supplier_id
        ${cases}
        ELSE category_supplier
      END
      WHERE supplier_id IN (?)
      `,
      [...caseParams, supplierIds],
    );
  }
}

async function markCategoryChangesUndone(connection, importId, supplierIds) {
  for (const idChunk of chunk(supplierIds)) {
    await connection.query(
      `
      UPDATE supplier_import_category_changes
      SET undone_at = CURRENT_TIMESTAMP
      WHERE import_id = ? AND supplier_id IN (?)
      `,
      [importId, idChunk],
    );
  }
}

// =====================================================
// IMPORT SUPPLIER
// =====================================================

async function importSupplier(req, res) {
  console.log("Import supplier request received.");

  const startedAt = Date.now();
  let filePath = null;
  let connection = null;

  try {
    // =================================================
    // AMBIL FILE DARI FRONTEND
    // =================================================

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "File Excel wajib diupload.",
      });
    }

    filePath = req.file.path;

    // =================================================
    // AMBIL CATEGORY DARI FRONTEND
    // =================================================

    const { category } = req.body;

    if (!category || !String(category).trim()) {
      return res.status(400).json({
        success: false,
        message: "Supplier type/category wajib dipilih.",
      });
    }

    const supplierCategory = String(category).trim().toUpperCase();

    // =================================================
    // BACA EXCEL
    // =================================================

    const workbook = xlsx.readFile(filePath);

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error("Excel tidak memiliki sheet.");
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = xlsx.utils.sheet_to_json(sheet, {
      defval: null,
    });

    if (rows.length === 0) {
      throw new Error("File Excel kosong.");
    }

    console.log(`Supplier import: memproses ${rows.length} baris.`);

    // =================================================
    // RESULT
    // =================================================

    const insertedRows = [];
    const updatedRows = [];
    const unchangedRows = [];
    const skippedRows = [];

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    const mappedRows = rows.map((row, index) => ({
      excelRow: index + 2,
      mapped: mapRowToColumns(row),
    }));

    const supplierIds = mappedRows
      .map(({ mapped }) => mapped.id)
      .filter(Boolean);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const suppliersById = await loadExistingSuppliers(connection, supplierIds);
    const dirtySupplierIds = new Set();
    const categoryChanges = new Map();

    // =================================================
    // PROCESS ROW
    // =================================================

    for (const { excelRow, mapped } of mappedRows) {

      // ===============================================
      // VALIDASI COMPANY NAME
      // ===============================================

      if (!mapped.company_name) {
        skippedRows.push({
          row: excelRow,
          reason: "company_name kosong",
        });

        continue;
      }

      // ===============================================
      // VALIDASI SUPPLIER ID
      // ===============================================

      const supplierId = mapped.id;

      if (!supplierId) {
        skippedRows.push({
          row: excelRow,
          reason: "supplier_id kosong",
        });

        continue;
      }

      // ===============================================
      // CARI SUPPLIER
      // ===============================================

      const supplierKey = String(supplierId);
      const existing = suppliersById.get(supplierKey);

      // =================================================
      // SUPPLIER BARU
      // =================================================

      if (!existing) {
        const categories = [supplierCategory];

        recordCategoryChange(categoryChanges, supplierId, [], categories);

        suppliersById.set(supplierKey, {
          supplier_id: supplierId,
          company_name: mapped.company_name,
          address: mapped.address,
          town: mapped.town,
          region: mapped.region,
          location: mapped.location,
          category_supplier: categories,
        });
        dirtySupplierIds.add(supplierKey);

        inserted++;

        insertedRows.push({
          row: excelRow,

          supplier_id: supplierId,

          company_name: mapped.company_name,

          address: mapped.address,

          town: mapped.town,

          region: mapped.region,

          location: mapped.location,

          category_supplier: categories,
        });

        continue;
      }

      // =================================================
      // SUPPLIER SUDAH ADA
      // =================================================

      const oldCategories = parseCategories(existing.category_supplier);

      const newCategories = normalizeCategories([
        ...oldCategories,
        supplierCategory,
      ]);

      // =================================================
      // COMPARE DATA
      // =================================================

      const changes = [];

      // -----------------------------------------------
      // COMPANY NAME
      // -----------------------------------------------

      if (
        normalizeValue(existing.company_name) !==
        normalizeValue(mapped.company_name)
      ) {
        changes.push({
          field: "company_name",
          old: existing.company_name,
          new: mapped.company_name,
        });
      }

      // -----------------------------------------------
      // ADDRESS
      // -----------------------------------------------

      if (
        normalizeValue(existing.address) !== normalizeValue(mapped.address)
      ) {
        changes.push({
          field: "address",
          old: existing.address,
          new: mapped.address,
        });
      }

      // -----------------------------------------------
      // TOWN
      // -----------------------------------------------

      if (normalizeValue(existing.town) !== normalizeValue(mapped.town)) {
        changes.push({
          field: "town",
          old: existing.town,
          new: mapped.town,
        });
      }

      // -----------------------------------------------
      // REGION
      // -----------------------------------------------

      if (normalizeValue(existing.region) !== normalizeValue(mapped.region)) {
        changes.push({
          field: "region",
          old: existing.region,
          new: mapped.region,
        });
      }

      // -----------------------------------------------
      // LOCATION
      // -----------------------------------------------

      if (
        normalizeValue(existing.location) !== normalizeValue(mapped.location)
      ) {
        changes.push({
          field: "location",
          old: existing.location,
          new: mapped.location,
        });
      }

      // -----------------------------------------------
      // CATEGORY
      // -----------------------------------------------

      if (!categoriesEqual(oldCategories, newCategories)) {
        recordCategoryChange(
          categoryChanges,
          supplierId,
          oldCategories,
          newCategories,
        );

        changes.push({
          field: "category_supplier",

          old: normalizeCategories(oldCategories),

          new: newCategories,
        });
      }

      // =================================================
      // TIDAK ADA PERUBAHAN
      // =================================================

      if (changes.length === 0) {
        unchanged++;

        unchangedRows.push({
          row: excelRow,

          supplier_id: supplierId,

          company_name: existing.company_name,
        });

        continue;
      }

      // =================================================
      // UPDATE DATABASE
      // =================================================

      suppliersById.set(supplierKey, {
        supplier_id: supplierId,
        company_name: mapped.company_name,
        address: mapped.address,
        town: mapped.town,
        region: mapped.region,
        location: mapped.location,
        category_supplier: newCategories,
      });
      dirtySupplierIds.add(supplierKey);

      updated++;

      updatedRows.push({
        row: excelRow,

        supplier_id: supplierId,

        company_name: mapped.company_name,

        changes,
      });
    }

    const suppliersToSave = [...dirtySupplierIds].map((supplierId) =>
      suppliersById.get(supplierId),
    );

    await saveSuppliers(connection, suppliersToSave);

    const importId = await createImportHistory(
      connection,
      {
        fileName: req.file.originalname,
        category: supplierCategory,
        totalRows: rows.length,
        inserted,
        updated,
        unchanged,
        skipped: skippedRows.length,
      },
      categoryChanges,
    );

    await connection.commit();

    console.log(
      `Supplier import selesai dalam ${Date.now() - startedAt} ms: ` +
        `${inserted} baru, ${updated} diperbarui, ` +
        `${unchanged} tidak berubah, ${skippedRows.length} dilewati.`,
    );

    // =================================================
    // HAPUS TEMPORARY FILE
    // =================================================

    if (filePath) {
      fs.unlink(filePath, () => {});
      filePath = null;
    }

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      message: "Import supplier berhasil.",

      category: supplierCategory,

      importId,

      canUndo: categoryChanges.size > 0,

      summary: {
        totalRows: rows.length,

        inserted,

        updated,

        unchanged,

        skipped: skippedRows.length,
      },

      insertedRows,

      updatedRows,

      unchangedRows,

      skippedRows,
    });
  } catch (error) {
    console.error("Import supplier error:", error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback import supplier gagal:", rollbackError);
      }
    }

    // Hapus temporary file
    if (filePath) {
      fs.unlink(filePath, () => {});
    }

    return res.status(500).json({
      success: false,

      message: error.message || "Gagal melakukan import supplier.",
    });
  } finally {
    connection?.release();
  }
}

async function getLatestSupplierImport(_req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT
        si.id AS importId,
        si.file_name AS fileName,
        si.category,
        si.total_rows AS totalRows,
        si.imported_at AS importedAt,
        si.undone_at AS undoneAt,
        COUNT(sicc.supplier_id) AS pendingChanges
      FROM supplier_imports si
      LEFT JOIN supplier_import_category_changes sicc
        ON sicc.import_id = si.id
        AND sicc.undone_at IS NULL
      GROUP BY si.id
      ORDER BY si.imported_at DESC, si.id DESC
      LIMIT 1
    `);

    const latest = rows[0] ?? null;

    return res.status(200).json({
      success: true,
      latest: latest
        ? {
            ...latest,
            canUndo: !latest.undoneAt && Number(latest.pendingChanges) > 0,
          }
        : null,
    });
  } catch (error) {
    console.error("Get latest supplier import error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Gagal mengambil riwayat import supplier.",
    });
  }
}

async function undoSupplierImport(req, res) {
  const importId = Number.parseInt(req.params.importId, 10);

  if (!Number.isInteger(importId) || importId < 1) {
    return res.status(400).json({
      success: false,
      message: "ID import tidak valid.",
    });
  }

  let connection = null;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [imports] = await connection.query(
      `SELECT * FROM supplier_imports WHERE id = ? FOR UPDATE`,
      [importId],
    );

    if (imports.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Riwayat import tidak ditemukan.",
      });
    }

    if (imports[0].undone_at) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Import ini sudah pernah dibatalkan.",
      });
    }

    const [changes] = await connection.query(
      `
      SELECT
        sicc.supplier_id,
        sicc.categories_before,
        sicc.categories_after,
        s.category_supplier AS current_categories
      FROM supplier_import_category_changes sicc
      JOIN suppliers s ON s.supplier_id = sicc.supplier_id
      WHERE sicc.import_id = ? AND sicc.undone_at IS NULL
      FOR UPDATE
      `,
      [importId],
    );

    const restorable = [];
    const completedIds = [];
    const conflicts = [];

    for (const change of changes) {
      const current = parseCategories(change.current_categories);
      const before = parseCategories(change.categories_before);
      const after = parseCategories(change.categories_after);

      if (categoriesEqual(current, after)) {
        restorable.push({
          supplier_id: change.supplier_id,
          categories_before: before,
        });
        completedIds.push(change.supplier_id);
      } else if (categoriesEqual(current, before)) {
        completedIds.push(change.supplier_id);
      } else {
        conflicts.push(change.supplier_id);
      }
    }

    await updateSupplierCategories(connection, restorable);
    await markCategoryChangesUndone(connection, importId, completedIds);

    if (conflicts.length === 0) {
      await connection.query(
        `UPDATE supplier_imports SET undone_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [importId],
      );
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message:
        conflicts.length === 0
          ? "Kategori dari import berhasil dibatalkan."
          : "Sebagian kategori tidak dibatalkan karena supplier sudah diubah setelah import ini.",
      restored: restorable.length,
      conflicts: conflicts.length,
      conflictSupplierIds: conflicts,
      canRetry: conflicts.length > 0,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback undo supplier gagal:", rollbackError);
      }
    }

    console.error("Undo supplier import error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Gagal membatalkan import supplier.",
    });
  } finally {
    connection?.release();
  }
}

module.exports = {
  importSupplier: [
    (req, res, next) => {
      console.log("1. Request menyentuh route supplier");
      next();
    },
    upload.single("file"),
    importSupplier,
  ],
  getLatestSupplierImport,
  undoSupplierImport,
};
