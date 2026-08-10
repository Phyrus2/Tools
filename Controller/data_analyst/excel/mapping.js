const xlsx = require("xlsx");
const path = require("path");
const pool = require("../../../Database/connection");
require("dotenv").config();

// Kolom valid di tabel suppliers yang diambil dari excel
const ALLOWED_COLUMNS = ["id", "company_name", "town", "region", "location"];

// Nilai category_supplier di-set manual, tidak ada di excel
// Use a plain string here; we'll store arrays of categories in the DB
const DEFAULT_CATEGORY_SUPPLIER = "ACCOMMODATION"; // <-- ganti sesuai kebutuhan

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

function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "");
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

async function importExcel() {
  // file berada di folder yang sama dengan mapping.js
  const filePath = path.join(__dirname, "accommodation.xls");

  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, {
    defval: null,
  });
  if (rows.length === 0) {
    console.log("File excel kosong.");
    return;
  }

  const skippedRows = [];
  let inserted = 0;
  let updated = 0;
  const updatedRows = [];

  for (const [index, row] of rows.entries()) {
    const mapped = mapRowToColumns(row);
    if (!mapped.company_name) {
      skippedRows.push({ row: index + 2, reason: "company_name kosong" });
      continue;
    }
    const supplierId = mapped.id || mapped.supplier_id || null;
    if (!supplierId) {
      skippedRows.push({ row: index + 2, reason: "supplier_id kosong" });
      continue;
    }

    // Determine category for this import (single string)
    const category = DEFAULT_CATEGORY_SUPPLIER;

    // Check if supplier already exists
    const [existingRows] = await pool.query(
      "SELECT category_supplier FROM suppliers WHERE supplier_id = ?",
      [supplierId],
    );

    if (existingRows.length > 0) {
      // Merge category into existing JSON array (avoid duplicates)
      let existing = existingRows[0].category_supplier;
      let arr;
      try {
        arr = JSON.parse(existing);
      } catch (e) {
        // If stored as plain string, convert to array
        arr = typeof existing === "string" && existing ? [existing] : [];
      }
      if (!Array.isArray(arr)) arr = [arr].flat().filter(Boolean);
      if (!arr.includes(category)) {
        arr.push(category);
        await pool.query(
          "UPDATE suppliers SET category_supplier = ? WHERE supplier_id = ?",
          [JSON.stringify(arr), supplierId],
        );
        updated++;
        updatedRows.push({ row: index + 2, supplier_id: supplierId, company_name: mapped.company_name, categories: [...arr] });
      }
    } else {
      // Insert new supplier; store category as array
      await pool.query(
        "INSERT INTO suppliers (supplier_id, company_name, town, region, location, category_supplier) VALUES (?, ?, ?, ?, ?, ?)",
        [
          supplierId,
          mapped.company_name,
          mapped.town || null,
          mapped.region || null,
          mapped.location || null,
          JSON.stringify([category]),
        ],
      );
      inserted++;
    }
  }

  console.log("Import selesai.");
  console.log("Total baris di file :", rows.length);
  console.log("Baru diinsert       :", inserted);
  console.log("Diupdate (kategori) :", updated);
  console.log("Dilewati            :", skippedRows.length);
  if (skippedRows.length) console.log(skippedRows);
  if (updatedRows.length) {
    console.log("Daftar company yang diupdate (merge kategori):");
    console.table(updatedRows);
  }

  process.exit(0);
}

module.exports = {
  importExcel,
};
