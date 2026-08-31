const xlsx = require("xlsx");
const path = require("path");
const pool = require("../../../../Database/connection");
require("dotenv").config();

/**
 * ============================================================
 * KOLOM DATABASE YANG DIGUNAKAN
 * ============================================================
 */

const ALLOWED_COLUMNS = [
  "id",
  "dossier_id",
  "dossier_name",
  "supplier_id",
  "product_id",
  "product_name",
  "status",
  "code",
  "duration",
  "travel_date",
  "end_date",
  "sales",
  "operational",
  "quantity",
  "unit",
  "price",
  "description",
  "info",
  "instructions",
  "transport_pickup",
  "transport_dropoff",
];

const HEADER_ALIASES = {
  // Sold Product ID
  soldproductid: "id",

  // Doss Nr
  dossnr: "dossier_id",

  // Dossier Name
  dossiername: "dossier_name",

  // Status
  status: "status",

  // Code
  code: "code",

  // Supplier ID
  supplierid: "supplier_id",

  // Supplier tidak digunakan
  supplier: null,

  // Product ID
  productid: "product_id",

  // Product
  // Nama product dari Excel bersifat dynamic
  product: "product_name",

  // Duration
  duration: "duration",

  // Travel Date
  traveldate: "travel_date",

  // End Date
  enddate: "end_date",

  // Sales
  sales: "sales",

  // Operational
  operational: "operational",

  // Qty.
  qty: "quantity",

  // Unit
  unit: "unit",

  // Price
  price: "price",

  // Tab Info (Description)
  tabinfodescription: "description",

  // Tab Info (Info)
  tabinfoinfo: "info",

  // Tab Voucher (Instruction)
  tabvoucherinstruction: "instructions",

  // Tab Transport Pickup
  tabtransportpickup: "transport_pickup",

  // Tab Transport Dropoff
  tabtransportdropoff: "transport_dropoff",
};

/**
 * ============================================================
 * NORMALIZE HEADER
 * ============================================================
 */

function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * ============================================================
 * MAP EXCEL ROW
 * ============================================================
 */

function mapRowToColumns(row) {
  const mapped = {};

  for (const [header, value] of Object.entries(row)) {
    const normalizedHeader = normalizeHeader(header);

    const column = HEADER_ALIASES[normalizedHeader];

    if (column && ALLOWED_COLUMNS.includes(column)) {
      mapped[column] =
        value === undefined || value === null || value === ""
          ? null
          : String(value).trim();
    }
  }

  return mapped;
}

/**
 * ============================================================
 * CHECK UNUSED
 * ============================================================
 */

function rowContainsUnused(row) {
  return Object.values(row).some(
    (value) =>
      value !== null &&
      value !== undefined &&
      String(value).toLowerCase().includes("unused"),
  );
}

/**
 * ============================================================
 * NORMALIZE INTEGER
 * ============================================================
 */

function normalizeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(String(value).replace(/,/g, ""));

  if (Number.isNaN(number)) {
    return null;
  }

  return parseInt(number, 10);
}

/**
 * ============================================================
 * NORMALIZE DURATION
 * ============================================================
 *
 * Contoh:
 *
 * "3 N" -> 3
 * "3N"  -> 3
 * "3"   -> 3
 */

function normalizeDuration(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const match = String(value).match(/\d+/);

  return match ? parseInt(match[0], 10) : null;
}

/**
 * ============================================================
 * NORMALIZE PRICE
 * ============================================================
 */

function normalizePrice(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");

  const number = Number(cleaned);

  return Number.isNaN(number) ? null : number;
}

/**
 * ============================================================
 * NORMALIZE DATE
 * ============================================================
 *
 * Mendukung:
 *
 * 30/12/2023
 * 30-12-2023
 * 2023-12-30
 * Excel serial number
 * Date object
 *
 * Output:
 *
 * YYYY-MM-DD
 */

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  /**
   * ==========================================================
   * 1. EXCEL SERIAL DATE
   * ==========================================================
   *
   * Contoh:
   *
   * 45564
   * "45564"
   *
   * Keduanya diproses sebagai Excel serial date.
   */

  const numericValue = Number(value);

  if (
    !Number.isNaN(numericValue) &&
    numericValue >= 1 &&
    numericValue <= 100000
  ) {
    const parsed = xlsx.SSF.parse_date_code(numericValue);

    if (parsed) {
      const year = parsed.y;
      const month = parsed.m;
      const day = parsed.d;

      if (
        year >= 1900 &&
        year <= 2100 &&
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= 31
      ) {
        return `${year}-${String(month).padStart(2, "0")}-${String(
          day,
        ).padStart(2, "0")}`;
      }
    }

    return null;
  }

  /**
   * ==========================================================
   * 2. STRING DATE
   * ==========================================================
   */

  const stringValue = String(value).trim();

  /**
   * ==========================================================
   * DD/MM/YYYY
   * ==========================================================
   *
   * 30/12/2023
   */

  let match = stringValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (match) {
    const [, day, month, year] = match;

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
      2,
      "0",
    )}`;
  }

  /**
   * ==========================================================
   * DD-MM-YYYY
   * ==========================================================
   */

  match = stringValue.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);

  if (match) {
    const [, day, month, year] = match;

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
      2,
      "0",
    )}`;
  }

  /**
   * ==========================================================
   * YYYY-MM-DD
   * ==========================================================
   */

  match = stringValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (match) {
    const [, year, month, day] = match;

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
      2,
      "0",
    )}`;
  }

  /**
   * ==========================================================
   * JAVASCRIPT DATE OBJECT
   * ==========================================================
   *
   * Fallback jika XLSX membaca cell sebagai Date.
   *
   * Tidak menggunakan toISOString()
   * agar tidak terkena timezone shift.
   */

  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      return null;
    }

    const year = value.getFullYear();

    const month = value.getMonth() + 1;

    const day = value.getDate();

    if (year < 1900 || year > 2100) {
      return null;
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
      2,
      "0",
    )}`;
  }

  return null;
}

/**
 * ============================================================
 * NORMALIZE JSON
 * ============================================================
 */

function normalizeTransport(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  // Kalau sudah object
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  const stringValue = String(value).trim();

  if (!stringValue) {
    return null;
  }

  /**
   * ==========================================================
   * FORMAT EXCEL
   *
   * Date:2024-01-06
   * Time:
   * Locality:
   * Location: Kajane Mua Ubud
   * Text:
   * ==========================================================
   */

  const result = {
    date: null,
    time: null,
    locality: null,
    location: null,
    text: null,
  };

  const lines = stringValue.split(/\r?\n/);

  lines.forEach((line) => {
    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      return;
    }

    const key = line.substring(0, separatorIndex).trim().toLowerCase();

    const value = line.substring(separatorIndex + 1).trim();

    const cleanValue = value === "" ? null : value;

    switch (key) {
      case "date":
        result.date = cleanValue;
        break;

      case "time":
        result.time = cleanValue;
        break;

      case "locality":
        result.locality = cleanValue;
        break;

      case "location":
        result.location = cleanValue;
        break;

      case "text":
        result.text = cleanValue;
        break;
    }
  });

  return JSON.stringify(result);
}

/**
 * ============================================================
 * IMPORT BOOKED PRODUCT
 * ============================================================
 */

async function importBookedProduct() {
  const filePath = path.join(__dirname, "booked_product.xlsx");

  /**
   * ==========================================================
   * 1. AMBIL SUPPLIER ID DARI DATABASE
   * ==========================================================
   */

  const [suppliers] = await pool.query(`
      SELECT supplier_id
      FROM suppliers
    `);

  const validSupplierIds = new Set(
    suppliers.map((supplier) => String(supplier.supplier_id)),
  );

  /**
   * ==========================================================
   * 2. AMBIL PRODUCT ID DARI DATABASE
   * ==========================================================
   */

  const [products] = await pool.query(`
      SELECT product_id
      FROM products
    `);

  const validProductIds = new Set(
    products.map((product) => String(product.product_id)),
  );

  /**
   * ==========================================================
   * 3. BACA EXCEL
   * ==========================================================
   *
   * Header berada di ROW 2.
   * Data mulai ROW 3.
   */

  const workbook = xlsx.readFile(filePath);

  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const rows = xlsx.utils.sheet_to_json(sheet, {
    defval: null,

    // Row index 1 = Excel Row 2
    range: 1,
  });

  if (rows.length === 0) {
    console.log("File Excel kosong.");

    return;
  }

  const dataToInsert = [];
  const skippedRows = [];

  /**
   * ==========================================================
   * 4. MAPPING & VALIDASI
   * ==========================================================
   */

  rows.forEach((row, index) => {
    /**
     * Karena header berada di row 2,
     * data pertama berada di row 3.
     */

    const excelRow = index + 3;

    /**
     * ------------------------------------------------------
     * SKIP UNUSED
     * ------------------------------------------------------
     */

    if (rowContainsUnused(row)) {
      skippedRows.push({
        row: excelRow,
        reason: "mengandung kata unused",
      });

      return;
    }

    /**
     * ------------------------------------------------------
     * MAP
     * ------------------------------------------------------
     */

    const mapped = mapRowToColumns(row);

    /**
     * ------------------------------------------------------
     * VALIDASI SUPPLIER ID
     * ------------------------------------------------------
     */

    if (!mapped.supplier_id) {
      skippedRows.push({
        row: excelRow,
        reason: "supplier_id kosong",
      });

      return;
    }

    if (!validSupplierIds.has(String(mapped.supplier_id))) {
      skippedRows.push({
        row: excelRow,
        reason: `supplier_id "${mapped.supplier_id}" tidak ditemukan di database`,
      });

      return;
    }

    /**
     * ------------------------------------------------------
     * VALIDASI PRODUCT ID
     * ------------------------------------------------------
     */

    if (!mapped.product_id) {
      skippedRows.push({
        row: excelRow,
        reason: "product_id kosong",
      });

      return;
    }

    if (!validProductIds.has(String(mapped.product_id))) {
      skippedRows.push({
        row: excelRow,
        reason: `product_id "${mapped.product_id}" tidak ditemukan di database`,
      });

      return;
    }

    /**
     * ------------------------------------------------------
     * VALIDASI PRODUCT NAME
     * ------------------------------------------------------
     *
     * Product name WAJIB ada.
     *
     * Tetapi TIDAK dibandingkan dengan
     * products.name.
     */

    if (!mapped.product_name) {
      skippedRows.push({
        row: excelRow,
        reason: "product_name kosong",
      });

      return;
    }

    /**
     * ------------------------------------------------------
     * BOOKED PRODUCT ID
     * ------------------------------------------------------
     */

    let bookedProductId = null;

    if (mapped.id) {
      bookedProductId = normalizeInteger(mapped.id);

      if (bookedProductId === null) {
        skippedRows.push({
          row: excelRow,
          reason: `Sold Product ID "${mapped.id}" tidak valid`,
        });

        return;
      }
    }

    /**
     * ------------------------------------------------------
     * DATE
     * ------------------------------------------------------
     */

    const travelDate = normalizeDate(mapped.travel_date);

    const endDate = normalizeDate(mapped.end_date);

    /**
     * Kalau Excel punya nilai travel_date
     * tetapi gagal dikonversi → skip.
     */

    if (mapped.travel_date && !travelDate) {
      skippedRows.push({
        row: excelRow,
        reason: `travel_date tidak valid: "${mapped.travel_date}"`,
      });

      return;
    }

    /**
     * Kalau Excel punya nilai end_date
     * tetapi gagal dikonversi → skip.
     */

    if (mapped.end_date && !endDate) {
      skippedRows.push({
        row: excelRow,
        reason: `end_date tidak valid: "${mapped.end_date}"`,
      });

      return;
    }

    /**
     * ------------------------------------------------------
     * PUSH DATA
     * ------------------------------------------------------
     */

    const normalizedPrice = normalizePrice(mapped.price);

    if (
      normalizedPrice !== null &&
      (!Number.isFinite(normalizedPrice) ||
        normalizedPrice > 99999999.99 ||
        normalizedPrice < -99999999.99)
    ) {
      skippedRows.push({
        row: excelRow,
        reason: `price di luar range DECIMAL(10,2): "${mapped.price}" -> ${normalizedPrice}`,
      });

      return;
    }

    dataToInsert.push([
      bookedProductId,

      // Doss Nr → dossier_id
      mapped.dossier_id || null,

      mapped.dossier_name || null,

      // Supplier ID dari Excel
      normalizeInteger(mapped.supplier_id),

      // Product ID dari Excel
      normalizeInteger(mapped.product_id),

      // Product name LANGSUNG dari Excel
      mapped.product_name,

      mapped.status || null,

      mapped.code || null,

      normalizeDuration(mapped.duration),

      // Travel Date
      travelDate,

      // End Date
      endDate,

      mapped.sales || null,

      mapped.operational || null,

      normalizeInteger(mapped.quantity),

      mapped.unit || null,

      normalizedPrice,

      mapped.description || null,

      mapped.info || null,

      mapped.instructions || null,

      normalizeTransport(mapped.transport_pickup),
      normalizeTransport(mapped.transport_dropoff),
    ]);
  });

  /**
   * ==========================================================
   * 5. TIDAK ADA DATA VALID
   * ==========================================================
   */

  if (dataToInsert.length === 0) {
    console.log("Tidak ada data valid untuk diimport.");

    if (skippedRows.length) {
      console.table(skippedRows);
    }

    return;
  }

  /**
   * ==========================================================
   * 6. INSERT / UPDATE
   * ==========================================================
   */

  const [result] = await pool.query(
    `
      INSERT INTO booked_products (
        id,
        dossier_id,
        dossier_name,
        supplier_id,
        product_id,
        product_name,
        status,
        code,
        duration,
        travel_date,
        end_date,
        sales,
        operational,
        quantity,
        unit,
        price,
        description,
        info,
        instructions,
        transport_pickup,
        transport_dropoff
      )
      VALUES ?

      ON DUPLICATE KEY UPDATE

        dossier_id =
          VALUES(dossier_id),

        dossier_name =
          VALUES(dossier_name),

        supplier_id =
          VALUES(supplier_id),

        product_id =
          VALUES(product_id),

        /**
         * Product name tetap mengikuti
         * nama dari Excel.
         */

        product_name =
          VALUES(product_name),

        status =
          VALUES(status),

        code =
          VALUES(code),

        duration =
          VALUES(duration),

        travel_date =
          VALUES(travel_date),

        end_date =
          VALUES(end_date),

        sales =
          VALUES(sales),

        operational =
          VALUES(operational),

        quantity =
          VALUES(quantity),

        unit =
          VALUES(unit),

        price =
          VALUES(price),

        description =
          VALUES(description),

        info =
          VALUES(info),

        instructions =
          VALUES(instructions),

        transport_pickup =
          VALUES(transport_pickup),

        transport_dropoff =
          VALUES(transport_dropoff)
      `,
    [dataToInsert],
  );

  /**
   * ==========================================================
   * 7. REPORT
   * ==========================================================
   */

  console.log("");

  console.log("======================================");

  console.log("     IMPORT BOOKED PRODUCT SELESAI");

  console.log("======================================");

  console.log("Total baris Excel :", rows.length);

  console.log("Data valid        :", dataToInsert.length);

  console.log("Affected rows     :", result.affectedRows);

  console.log("Dilewati          :", skippedRows.length);

  /**
   * ==========================================================
   * DATA SKIPPED
   * ==========================================================
   */

  if (skippedRows.length > 0) {
    console.log("");

    console.log("DATA YANG DILEWATI:");

    console.table(skippedRows);
  }
}

/**
 * ============================================================
 * EXPORT
 * ============================================================
 */

module.exports = {
  importBookedProduct,
};
