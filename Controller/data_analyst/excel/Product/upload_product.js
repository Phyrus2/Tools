const xlsx = require("xlsx");
const path = require("path");
const pool = require("../../../../Database/connection");
require("dotenv").config();

// Kolom yang dipakai dari excel product
const ALLOWED_COLUMNS = ["id", "product", "supplier", "type"];

const HEADER_ALIASES = {
  id: "id",
  product: "product",
  supplier: "supplier",
  type: "type",
};

function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "");
}

// Dipakai juga untuk mencocokkan nama supplier excel <-> nama supplier database
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

function rowContainsUnused(row) {
  return Object.values(row).some(
    (value) => value !== null && String(value).toLowerCase().includes("unused")
  );
}

async function importProduct() {
  // file berada di folder yang sama dengan file mapping ini
  const filePath = path.join(__dirname, "product_sharing_bed.xlsx");

  // 1. Ambil semua supplier dari database untuk lookup nama -> id
  const [suppliers] = await pool.query(
    "SELECT supplier_id, company_name FROM suppliers"
  );
  const supplierMap = new Map();
  suppliers.forEach((s) => {
    supplierMap.set(normalizeName(s.company_name), s.supplier_id);
  });

  // 2. Baca excel
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

  if (rows.length === 0) {
    console.log("File excel kosong.");
    return;
  }

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

    dataToInsert.push([
      mapped.id,        // product_id
      supplierId,        // supplier_id (hasil lookup, bukan dari excel)
      mapped.product,    // name
      mapped.type || null, // type
    ]);
  });

  if (dataToInsert.length === 0) {
    console.log("Tidak ada baris valid untuk diimpor.");
    console.table(skippedRows);
    return;
  }

  const productIds = dataToInsert.map((row) => row[0]);
  const [existingProducts] = await pool.query(
    `SELECT product_id, name FROM products WHERE product_id IN (?)`,
    [productIds]
  );
  const existingProductIds = new Set(existingProducts.map((p) => p.product_id));
  const updatedRows = dataToInsert
    .filter((row) => existingProductIds.has(row[0]))
    .map((row) => ({ product_id: row[0], name: row[2] }));

  const [result] = await pool.query(
    "INSERT INTO products (product_id, supplier_id, name, type) VALUES ? ON DUPLICATE KEY UPDATE supplier_id = VALUES(supplier_id), name = VALUES(name), type = VALUES(type)",
    [dataToInsert]
  );

  console.log("Import product selesai.");
  console.log("Total baris di file :", rows.length);
  console.log("Berhasil diinsert   :", result.affectedRows);
  console.log("Dilewati            :", skippedRows.length);
  if (updatedRows.length) {
    console.log("Produk yang diupdate:");
    console.table(updatedRows);
  }
  if (skippedRows.length) console.table(skippedRows);
}

module.exports = {
  importProduct,
};