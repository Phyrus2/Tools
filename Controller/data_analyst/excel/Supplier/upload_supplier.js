const xlsx = require("xlsx");
const fs = require("fs");
const pool = require("../../../Database/connection");
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

const ALLOWED_COLUMNS = ["id", "company_name", "town", "region", "location"];

// =====================================================
// HEADER ALIASES
// =====================================================

const HEADER_ALIASES = {
  id: "id",
  supplierid: "id",
  supplier_id: "id",

  companyname: "company_name",
  company_name: "company_name",

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
    .replace(/[\s_]+/g, "");
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

// =====================================================
// IMPORT SUPPLIER
// =====================================================

async function importSupplier(req, res) {
  let filePath = null;

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

    // =================================================
    // PROCESS ROW
    // =================================================

    for (const [index, row] of rows.entries()) {
      const excelRow = index + 2;

      const mapped = mapRowToColumns(row);

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

      const [existingRows] = await pool.query(
        `
          SELECT
            supplier_id,
            company_name,
            town,
            region,
            location,
            category_supplier
          FROM suppliers
          WHERE supplier_id = ?
          `,
        [supplierId],
      );

      // =================================================
      // SUPPLIER BARU
      // =================================================

      if (existingRows.length === 0) {
        const categories = [supplierCategory];

        await pool.query(
          `
          INSERT INTO suppliers
          (
            supplier_id,
            company_name,
            town,
            region,
            location,
            category_supplier
          )
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            supplierId,
            mapped.company_name,
            mapped.town,
            mapped.region,
            mapped.location,
            JSON.stringify(categories),
          ],
        );

        inserted++;

        insertedRows.push({
          row: excelRow,

          supplier_id: supplierId,

          company_name: mapped.company_name,

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

      const existing = existingRows[0];

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

      await pool.query(
        `
        UPDATE suppliers
        SET
          company_name = ?,
          town = ?,
          region = ?,
          location = ?,
          category_supplier = ?
        WHERE supplier_id = ?
        `,
        [
          mapped.company_name,
          mapped.town,
          mapped.region,
          mapped.location,
          JSON.stringify(newCategories),
          supplierId,
        ],
      );

      updated++;

      updatedRows.push({
        row: excelRow,

        supplier_id: supplierId,

        company_name: mapped.company_name,

        changes,
      });
    }

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

    // Hapus temporary file
    if (filePath) {
      fs.unlink(filePath, () => {});
    }

    return res.status(500).json({
      success: false,

      message: error.message || "Gagal melakukan import supplier.",
    });
  }
}

module.exports = {
  importSupplier: [
    upload.single("file"),
    importSupplier,
  ],
};
