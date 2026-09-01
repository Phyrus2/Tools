const xlsx = require("xlsx");
const fs = require("fs");
const multer = require("multer");
const pool = require("../../../../Database/connection");
require("dotenv").config();

// =====================================================
// MULTER
// =====================================================

const upload = multer({
  dest: "uploads/",
});

// =====================================================
// KOLOM EXCEL YANG DIGUNAKAN
// =====================================================

const ALLOWED_COLUMNS = ["id", "product", "supplier", "type"];

const HEADER_ALIASES = {
  id: "id",
  product: "product",
  supplier: "supplier",
  type: "type",
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
// NORMALIZE NAME
// Dipakai juga untuk mencocokkan nama supplier excel <-> nama supplier database
// =====================================================

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    // normalize common unicode apostrophes/quotes to ASCII apostrophe
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u201C\u201D]/g, "'")
    // convert apostrophes to space so variations match (e.g. curly vs ascii)
    .replace(/['`\u2018\u2019\u201A\u201B]/g, " ")
    // replace any non-alphanumeric characters with a space
    .replace(/[^0-9a-zA-Z\s]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
        value === undefined || value === "" ? null : String(value).trim();
    }
  }
  return mapped;
}

// =====================================================
// CEK BARIS "UNUSED"
// =====================================================

function rowContainsUnused(row) {
  return Object.values(row).some(
    (value) =>
      value !== null && String(value).toLowerCase().includes("unused"),
  );
}

// =====================================================
// IMPORT PRODUCT (HTTP HANDLER)
// =====================================================

async function importProduct(req, res) {
  console.log("Import product request received.");

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
    // 1. AMBIL SEMUA SUPPLIER UNTUK LOOKUP NAMA -> ID
    // =================================================

    const [suppliers] = await pool.query(
      "SELECT supplier_id, company_name FROM suppliers",
    );

    const supplierMap = new Map();
    suppliers.forEach((s) => {
      supplierMap.set(normalizeName(s.company_name), s.supplier_id);
    });

    // =================================================
    // 2. BACA EXCEL
    // =================================================

    const workbook = xlsx.readFile(filePath);

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error("Excel tidak memiliki sheet.");
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

    if (rows.length === 0) {
      throw new Error("File Excel kosong.");
    }

    // =================================================
    // 3. VALIDASI & MAPPING PER BARIS (di memory, tanpa query)
    // =================================================

    const dataToInsert = [];
    const skippedRows = [];

    rows.forEach((row, index) => {
      const excelRow = index + 2; // +2 karena baris 1 = header

      // Skip baris yang mengandung kata "unused"
      if (rowContainsUnused(row)) {
        skippedRows.push({ row: excelRow, reason: "mengandung kata unused" });
        return;
      }

      const mapped = mapRowToColumns(row);

      if (!mapped.id) {
        skippedRows.push({ row: excelRow, reason: "id kosong" });
        return;
      }
      if (!mapped.product) {
        skippedRows.push({ row: excelRow, reason: "product (name) kosong" });
        return;
      }
      if (!mapped.supplier) {
        skippedRows.push({ row: excelRow, reason: "supplier kosong" });
        return;
      }

      const supplierId = supplierMap.get(normalizeName(mapped.supplier));
      if (!supplierId) {
        skippedRows.push({
          row: excelRow,
          reason: `supplier "${mapped.supplier}" tidak ditemukan di database`,
        });
        return;
      }

      dataToInsert.push({
        row: excelRow,
        product_id: mapped.id,
        supplier_id: supplierId,
        name: mapped.product,
        type: mapped.type || null,
      });
    });

    if (dataToInsert.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Tidak ada baris valid untuk diimpor.",
        summary: {
          totalRows: rows.length,
          inserted: 0,
          updated: 0,
          skipped: skippedRows.length,
        },
        insertedRows: [],
        updatedRows: [],
        skippedRows,
      });
    }

    // =================================================
    // 4. CEK PRODUCT YANG SUDAH ADA (1x bulk query)
    // =================================================

    const productIds = dataToInsert.map((r) => r.product_id);

    const [existingProducts] = await pool.query(
      `SELECT product_id, name FROM products WHERE product_id IN (?)`,
      [productIds],
    );

    const existingProductIds = new Set(
      existingProducts.map((p) => p.product_id),
    );

    const insertedRows = dataToInsert.filter(
      (r) => !existingProductIds.has(r.product_id),
    );

    const updatedRows = dataToInsert.filter((r) =>
      existingProductIds.has(r.product_id),
    );

    // =================================================
    // 5. BULK INSERT / UPDATE (1x query untuk semua baris)
    // =================================================

    const values = dataToInsert.map((r) => [
      r.product_id,
      r.supplier_id,
      r.name,
      r.type,
    ]);

    await pool.query(
      `
      INSERT INTO products (product_id, supplier_id, name, type)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        supplier_id = VALUES(supplier_id),
        name = VALUES(name),
        type = VALUES(type)
      `,
      [values],
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

    console.log("Import product selesai.");
    console.log("Total baris di file :", rows.length);
    console.log("Berhasil diinsert   :", insertedRows.length);
    console.log("Diupdate            :", updatedRows.length);
    console.log("Dilewati            :", skippedRows.length);

    return res.status(200).json({
      success: true,
      message: "Import product berhasil.",

      summary: {
        totalRows: rows.length,
        inserted: insertedRows.length,
        updated: updatedRows.length,
        skipped: skippedRows.length,
      },

      insertedRows: insertedRows.map((r) => ({
        row: r.row,
        product_id: r.product_id,
        supplier_id: r.supplier_id,
        name: r.name,
        type: r.type,
      })),

      updatedRows: updatedRows.map((r) => ({
        row: r.row,
        product_id: r.product_id,
        supplier_id: r.supplier_id,
        name: r.name,
        type: r.type,
      })),

      skippedRows,
    });
  } catch (error) {
    console.error("Import product error:", error);

    if (filePath) {
      fs.unlink(filePath, () => {});
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Gagal melakukan import product.",
    });
  }
}

module.exports = {
  importProduct: [
    (req, res, next) => {
      console.log("Request menyentuh route product import");
      next();
    },
    upload.single("file"),
    importProduct,
  ],
};