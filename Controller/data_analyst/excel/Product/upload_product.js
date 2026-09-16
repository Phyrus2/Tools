const xlsx = require("xlsx");
const fs = require("fs");
const multer = require("multer");
const pool = require("../../../../Database/connection");
const { normalizeProductText } = require("../../../../Utils/normalize_product_text");
require("dotenv").config();

// =====================================================
// MULTER
// =====================================================

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

// =====================================================
// KOLOM EXCEL YANG DIGUNAKAN
// =====================================================

const ALLOWED_COLUMNS = [
  "id",
  "product",
  "supplier",
  "type",
  "status",
  "info",
  "not_on_offer",
  "services_included",
  "services_excluded",
  "instructions",
  "description",
];

const HEADER_ALIASES = {
  id: "id",
  product: "product",
  supplier: "supplier",
  type: "type",
  productstatus: "status",
  status: "status",
  info: "info",
  notonoffer: "not_on_offer",
  servicesincluded: "services_included",
  servicesexcluded: "services_excluded",
  instructions: "instructions",
  description: "description",
};

const PRODUCT_TEXT_COLUMNS = new Set([
  "info",
  "not_on_offer",
  "services_included",
  "services_excluded",
  "instructions",
  "description",
]);

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

function normalizeValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return String(value).trim();
}

// =====================================================
// NORMALIZE STATUS
// Status product hanya membedakan Regular Product dan One Time Product.
// =====================================================

function normalizeStatus(value) {
  if (value === undefined || value === null || value === "") {
    return "Regular Product";
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "regular product") return "Regular Product";
  if (normalized === "one time product") return "One Time Product";
  return null;
}

// =====================================================
// MAPPING ROW EXCEL
// =====================================================

function mapRowToColumns(row) {
  const mapped = {};
  for (const [header, value] of Object.entries(row)) {
    const column = HEADER_ALIASES[normalizeHeader(header)];
    if (!column || !ALLOWED_COLUMNS.includes(column)) continue;

    if (column === "status") {
      mapped[column] = normalizeStatus(value);
    } else if (PRODUCT_TEXT_COLUMNS.has(column)) {
      mapped[column] = normalizeProductText(value);
    } else {
      mapped[column] =
        value === undefined || value === null || value === ""
          ? null
          : String(value).trim();
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
      if (mapped.status === null) {
        skippedRows.push({
          row: excelRow,
          reason: "status harus Regular Product atau One Time Product",
        });
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
        status: mapped.status || "Regular Product",
        info: mapped.info || null,
        not_on_offer: mapped.not_on_offer || null,
        services_included: mapped.services_included || null,
        services_excluded: mapped.services_excluded || null,
        instructions: mapped.instructions || null,
        description: mapped.description || null,
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
          unchanged: 0,
          skipped: skippedRows.length,
        },
        insertedRows: [],
        updatedRows: [],
        unchangedRows: [],
        skippedRows,
      });
    }

    // =================================================
    // 4. CEK PRODUCT YANG SUDAH ADA (1x bulk query)
    // =================================================

    const productIds = dataToInsert.map((r) => r.product_id);

    const [existingProducts] = await pool.query(
      `SELECT product_id, supplier_id, name, type, status, info, not_on_offer,
              services_included, services_excluded, instructions, description
       FROM products
       WHERE product_id IN (?)`,
      [productIds],
    );

    const existingProductMap = new Map(
      existingProducts.map((product) => [String(product.product_id), product]),
    );

    const insertedRows = [];
    const updatedRows = [];
    const unchangedRows = [];

    const comparableFields = [
      "supplier_id",
      "name",
      "type",
      "status",
      "info",
      "not_on_offer",
      "services_included",
      "services_excluded",
      "instructions",
      "description",
    ];

    dataToInsert.forEach((row) => {
      const existing = existingProductMap.get(String(row.product_id));

      if (!existing) {
        insertedRows.push(row);
        return;
      }

      const changes = comparableFields.flatMap((field) => {
        const oldValue = existing[field];
        const newValue = row[field];

        if (normalizeValue(oldValue) === normalizeValue(newValue)) {
          return [];
        }

        return [{ field, old: oldValue, new: newValue }];
      });

      if (changes.length > 0) {
        updatedRows.push({ ...row, changes });
      } else {
        unchangedRows.push(row);
      }
    });

    // =================================================
    // 5. BULK INSERT / UPDATE (1x query untuk semua baris)
    // =================================================

    const rowsToWrite = [...insertedRows, ...updatedRows];
    const values = rowsToWrite.map((r) => [
      r.product_id,
      r.supplier_id,
      r.name,
      r.type,
      r.status,
      r.info,
      r.not_on_offer,
      r.services_included,
      r.services_excluded,
      r.instructions,
      r.description,
    ]);

    if (values.length > 0) {
      await pool.query(
        `
        INSERT INTO products (
          product_id, supplier_id, name, type, status, info, not_on_offer,
          services_included, services_excluded, instructions, description
        )
        VALUES ?
        ON DUPLICATE KEY UPDATE
          supplier_id = VALUES(supplier_id),
          name = VALUES(name),
          type = VALUES(type),
          status = VALUES(status),
          info = VALUES(info),
          not_on_offer = VALUES(not_on_offer),
          services_included = VALUES(services_included),
          services_excluded = VALUES(services_excluded),
          instructions = VALUES(instructions),
          description = VALUES(description)
        `,
        [values],
      );
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

    console.log("Import product selesai.");
    console.log("Total baris di file :", rows.length);
    console.log("Berhasil diinsert   :", insertedRows.length);
    console.log("Diupdate            :", updatedRows.length);
    console.log("Tidak berubah       :", unchangedRows.length);
    console.log("Dilewati            :", skippedRows.length);

    return res.status(200).json({
      success: true,
      message: "Import product berhasil.",

      summary: {
        totalRows: rows.length,
        inserted: insertedRows.length,
        updated: updatedRows.length,
        unchanged: unchangedRows.length,
        skipped: skippedRows.length,
      },

      insertedRows: insertedRows.map((r) => ({
        row: r.row,
        product_id: r.product_id,
        supplier_id: r.supplier_id,
        name: r.name,
        type: r.type,
        status: r.status,
        info: r.info,
        not_on_offer: r.not_on_offer,
        services_included: r.services_included,
        services_excluded: r.services_excluded,
        instructions: r.instructions,
        description: r.description,
      })),

      updatedRows: updatedRows.map((r) => ({
        row: r.row,
        product_id: r.product_id,
        supplier_id: r.supplier_id,
        name: r.name,
        type: r.type,
        status: r.status,
        info: r.info,
        not_on_offer: r.not_on_offer,
        services_included: r.services_included,
        services_excluded: r.services_excluded,
        instructions: r.instructions,
        description: r.description,
        changes: r.changes,
      })),

      unchangedRows: unchangedRows.map((r) => ({
        row: r.row,
        product_id: r.product_id,
        supplier_id: r.supplier_id,
        name: r.name,
        type: r.type,
        status: r.status,
        info: r.info,
        not_on_offer: r.not_on_offer,
        services_included: r.services_included,
        services_excluded: r.services_excluded,
        instructions: r.instructions,
        description: r.description,
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
