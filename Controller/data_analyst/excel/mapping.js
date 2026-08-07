const xlsx = require("xlsx");
const path = require("path");
const pool = require("../../../Database/connection");
require("dotenv").config();

// Kolom valid di tabel suppliers yang diambil dari excel
const ALLOWED_COLUMNS = ["id", "company_name", "town", "region", "location"];

// Nilai category_supplier di-set manual, tidak ada di excel
const DEFAULT_CATEGORY_SUPPLIER = "VISA"; // <-- ganti sesuai kebutuhan

const HEADER_ALIASES = {
  companyname: "company_name",
  id: "id",
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
  const filePath = path.join(__dirname, "visa.xls");

  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, {
    defval: null,
  });
  if (rows.length === 0) {
    console.log("File excel kosong.");
    return;
  }

  const dataToInsert = [];
  const skippedRows = [];

  rows.forEach((row, index) => {
    const mapped = mapRowToColumns(row);
    if (!mapped.company_name) {
      skippedRows.push({ row: index + 2, reason: "company_name kosong" });
      return;
    }
    dataToInsert.push([
      mapped.id,
      mapped.company_name,
      mapped.town || null,
      mapped.region || null,
      mapped.location || null,
      DEFAULT_CATEGORY_SUPPLIER,
    ]);
  });

  if (dataToInsert.length === 0) {
    console.log("Tidak ada baris valid untuk diimpor.", skippedRows);
    return;
  }

  const [result] = await pool.query(
    "INSERT INTO suppliers (id, company_name, town, region, location, category_supplier) VALUES ?",
    [dataToInsert],
  );

  console.log("Import selesai.");
  console.log("Total baris di file :", rows.length);
  console.log("Berhasil diinsert   :", result.affectedRows);
  console.log("Dilewati            :", skippedRows.length);
  if (skippedRows.length) console.log(skippedRows);

  process.exit(0);
}

module.exports = {
  importExcel,
};
