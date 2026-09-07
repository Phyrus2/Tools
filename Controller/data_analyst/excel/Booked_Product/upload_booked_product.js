const xlsx = require("xlsx");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const pool = require("../../../../Database/connection");
require("dotenv").config();

// =====================================================
// MULTER
// =====================================================

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

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
  "supplier_name",
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

  // Nama supplier dipakai untuk memberi konteks pada baris yang dilewati
  supplier: "supplier_name",

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

function buildManualBookedProductData(mapped) {
  return {
    booked_product_id: normalizeInteger(mapped.id),
    original_product_id: normalizeInteger(mapped.product_id),
    dossier_id: mapped.dossier_id || null,
    dossier_name: mapped.dossier_name || null,
    supplier_id: normalizeInteger(mapped.supplier_id),
    product_name: mapped.product_name || null,
    product_type: null,
    booking_status: mapped.status || null,
    code: mapped.code || null,
    duration: normalizeDuration(mapped.duration),
    travel_date: normalizeDate(mapped.travel_date),
    end_date: normalizeDate(mapped.end_date),
    sales: mapped.sales || null,
    operational: mapped.operational || null,
    quantity: normalizeInteger(mapped.quantity),
    unit: mapped.unit || null,
    price: normalizePrice(mapped.price),
    description: mapped.description || null,
    info: mapped.info || null,
    instructions: mapped.instructions || null,
    transport_pickup: mapped.transport_pickup || null,
    transport_dropoff: mapped.transport_dropoff || null,
  };
}

async function recordBookedProductImport(fileName, totalRows) {
  await pool.query(
    `
    INSERT INTO data_import_status (dataset, file_name, total_rows, imported_at)
    VALUES ('booked_products', ?, ?, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE
      file_name = VALUES(file_name),
      total_rows = VALUES(total_rows),
      imported_at = CURRENT_TIMESTAMP
    `,
    [fileName, totalRows],
  );

  return readBookedProductImportStatus();
}

async function readBookedProductImportStatus() {
  const [rows] = await pool.query(
    `
    SELECT file_name AS fileName, total_rows AS totalRows, imported_at AS importedAt
    FROM data_import_status
    WHERE dataset = 'booked_products'
    `,
  );

  return rows[0] ?? null;
}

async function getBookedProductImportStatus(_req, res) {
  try {
    return res.status(200).json({
      success: true,
      lastImport: await readBookedProductImportStatus(),
    });
  } catch (error) {
    console.error("Get booked product import status error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Gagal mengambil status booked product.",
    });
  }
}

/**
 * ============================================================
 * IMPORT BOOKED PRODUCT (HTTP HANDLER)
 * ============================================================
 */

async function importBookedProduct(req, res) {
  console.log("Import booked product request received.");

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
     * File sumber untuk one-time product biasanya tetap berisi product_id 0.
     * Hubungkan kembali melalui Sold Product ID agar hasil input manual tidak
     * dianggap sebagai produk hilang ketika file yang sama diimpor ulang.
     */
    const [oneTimeBookedProducts] = await pool.query(`
      SELECT bp.id AS booked_product_id, bp.product_id
      FROM booked_products bp
      INNER JOIN products p ON p.product_id = bp.product_id
      WHERE p.status = 'One Time Product'
    `);

    const oneTimeProductByBookedId = new Map(
      oneTimeBookedProducts.map((item) => [
        String(item.booked_product_id),
        item.product_id,
      ]),
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

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error("Excel tidak memiliki sheet.");
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = xlsx.utils.sheet_to_json(sheet, {
      defval: null,

      // Row index 1 = Excel Row 2
      range: 1,
    });

    if (rows.length === 0) {
      throw new Error("File Excel kosong.");
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
          supplier_name: mapped.supplier_name || null,
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
        const existingOneTimeProductId = oneTimeProductByBookedId.get(
          String(mapped.id),
        );

        if (existingOneTimeProductId) {
          mapped.product_id = String(existingOneTimeProductId);
        }
      }

      if (!validProductIds.has(String(mapped.product_id))) {
        skippedRows.push({
          row: excelRow,
          reason: `product_id "${mapped.product_id}" tidak ditemukan di database`,
          supplier_name: mapped.supplier_name || null,
          product_name: mapped.product_name || null,
          can_add_product: true,
          manual_data: buildManualBookedProductData(mapped),
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
       *
       * (Validasi Sold Product ID/id dilakukan
       * setelah blok ini — juga WAJIB ada.)
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
       * BOOKED PRODUCT ID (WAJIB)
       * ------------------------------------------------------
       */

      if (!mapped.id) {
        skippedRows.push({
          row: excelRow,
          reason: "Sold Product ID kosong",
        });

        return;
      }

      const bookedProductId = normalizeInteger(mapped.id);

      if (bookedProductId === null) {
        skippedRows.push({
          row: excelRow,
          reason: `Sold Product ID "${mapped.id}" tidak valid`,
        });

        return;
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
          normalizedPrice > 9999999999999.99 ||
          normalizedPrice < -9999999999999.99)
      ) {
        skippedRows.push({
          row: excelRow,
          reason: `price di luar range DECIMAL(15,2): "${mapped.price}" -> ${normalizedPrice}`,
        });

        return;
      }

      dataToInsert.push({
        row: excelRow,
        booked_product_id: bookedProductId,
        dossier_id: mapped.dossier_id || null,
        dossier_name: mapped.dossier_name || null,
        supplier_id: normalizeInteger(mapped.supplier_id),
        product_id: normalizeInteger(mapped.product_id),
        product_name: mapped.product_name,
        status: mapped.status || null,
        code: mapped.code || null,
        duration: normalizeDuration(mapped.duration),
        travel_date: travelDate,
        end_date: endDate,
        sales: mapped.sales || null,
        operational: mapped.operational || null,
        quantity: normalizeInteger(mapped.quantity),
        unit: mapped.unit || null,
        price: normalizedPrice,
        description: mapped.description || null,
        info: mapped.info || null,
        instructions: mapped.instructions || null,
        transport_pickup: normalizeTransport(mapped.transport_pickup),
        transport_dropoff: normalizeTransport(mapped.transport_dropoff),
      });
    });

    /**
     * ==========================================================
     * 5. TIDAK ADA DATA VALID
     * ==========================================================
     */

    if (dataToInsert.length === 0) {
      const lastImport = await readBookedProductImportStatus();

      if (filePath) {
        fs.unlink(filePath, () => {});
        filePath = null;
      }

      return res.status(200).json({
        success: true,
        message: "Tidak ada data valid untuk diimport.",
        lastImport,
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

    /**
     * ==========================================================
     * 6. AMBIL DATA BOOKED PRODUCT YANG SUDAH ADA (1x bulk query)
     * ==========================================================
     *
     * Sold Product ID wajib ada di setiap baris valid,
     * jadi setiap baris pasti punya booked_product_id.
     *
     * Ambil SEMUA kolom (bukan cuma id) supaya bisa
     * dibandingkan field-by-field untuk menentukan
     * apakah baris ini benar-benar berubah atau tidak.
     */

    const idsToCheck = dataToInsert.map((r) => r.booked_product_id);

    const [existingBooked] = await pool.query(
      `
        SELECT
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
        FROM booked_products
        WHERE id IN (?)
      `,
      [idsToCheck],
    );

    const existingMap = new Map(existingBooked.map((b) => [b.id, b]));

    // =================================================
    // NORMALIZE UNTUK COMPARE
    // =================================================

    function normalizeCompareValue(value) {
      if (value === null || value === undefined || value === "") {
        return null;
      }

      return String(value).trim();
    }

    function normalizeCompareDate(value) {
      if (!value) return null;

      // Bisa berupa Date object dari mysql2 (kolom DATE)
      if (value instanceof Date) {
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, "0");
        const d = String(value.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }

      return String(value).slice(0, 10);
    }

    // Kolom numerik (INT/DECIMAL) bisa dikembalikan mysql2 sebagai
    // string dengan trailing zero (misal DECIMAL -> "250000.00"),
    // sementara nilai baru dari Excel adalah JS number ("250000").
    // Perbandingan string naive akan selalu mismatch, jadi
    // dibandingkan sebagai angka.
    function normalizeCompareNumber(value) {
      if (value === null || value === undefined || value === "") {
        return null;
      }

      const num = Number(value);

      if (Number.isNaN(num)) {
        return null;
      }

      // Bulatkan ke 2 desimal untuk menghindari floating point noise
      // (mis. 250000.000000001 vs 250000).
      return Math.round(num * 100) / 100;
    }

    // Kolom JSON (transport_pickup/transport_dropoff) bisa
    // dikembalikan mysql2 sebagai object (jika kolom bertipe JSON)
    // atau string (jika kolom bertipe TEXT). Nilai baru selalu
    // string hasil JSON.stringify(). Samakan representasinya
    // dengan parse -> stringify ulang dengan KEY TERURUT, karena
    // MySQL's JSON type tidak menjamin urutan key yang sama
    // dengan urutan penulisan di kode (biasanya dikembalikan
    // terurut alfabetis), sementara object literal di JS
    // mempertahankan urutan insersi aslinya.
    function normalizeCompareJson(value) {
      if (value === null || value === undefined || value === "") {
        return null;
      }

      let obj = value;

      if (typeof value === "string") {
        try {
          obj = JSON.parse(value);
        } catch (error) {
          // Bukan JSON valid, bandingkan sebagai string apa adanya
          return value.trim();
        }
      }

      if (obj === null || typeof obj !== "object") {
        return JSON.stringify(obj);
      }

      const sortedKeys = Object.keys(obj).sort();

      const sortedObj = {};

      for (const key of sortedKeys) {
        sortedObj[key] = obj[key];
      }

      return JSON.stringify(sortedObj);
    }

    // Kolom yang dibandingkan untuk menentukan "changes"
    // (tidak termasuk id, karena itu key pembanding)
    const COMPARABLE_FIELDS = [
      { key: "dossier_id", type: "text" },
      { key: "dossier_name", type: "text" },
      { key: "supplier_id", type: "number" },
      { key: "product_id", type: "number" },
      { key: "product_name", type: "text" },
      { key: "status", type: "text" },
      { key: "code", type: "text" },
      { key: "duration", type: "number" },
      { key: "travel_date", type: "date" },
      { key: "end_date", type: "date" },
      { key: "sales", type: "text" },
      { key: "operational", type: "text" },
      { key: "quantity", type: "number" },
      { key: "unit", type: "text" },
      { key: "price", type: "number" },
      { key: "description", type: "text" },
      { key: "info", type: "text" },
      { key: "instructions", type: "text" },
      { key: "transport_pickup", type: "json" },
      { key: "transport_dropoff", type: "json" },
    ];

    function normalizeByType(value, type) {
      switch (type) {
        case "date":
          return normalizeCompareDate(value);
        case "number":
          return normalizeCompareNumber(value);
        case "json":
          return normalizeCompareJson(value);
        default:
          return normalizeCompareValue(value);
      }
    }

    const insertedRows = [];
    const updatedRows = [];
    const unchangedRows = [];

    // =================================================
    // DEBUG: tampilkan detail field yang mismatch untuk
    // beberapa baris pertama, supaya kelihatan field mana
    // dan tipe data apa yang bikin selalu "updated".
    // =================================================
    const DEBUG_COMPARE = false;
    const DEBUG_LIMIT = 5;
    let debugCount = 0;

    for (const r of dataToInsert) {
      const existing = existingMap.get(r.booked_product_id);

      // =================================================
      // BARIS BARU
      // =================================================

      if (!existing) {
        insertedRows.push(r);
        continue;
      }

      // =================================================
      // BANDINGKAN FIELD SATU-SATU
      // =================================================

      const changes = [];

      for (const field of COMPARABLE_FIELDS) {
        const oldValue = existing[field.key];
        const newValue = r[field.key];

        const oldNorm = normalizeByType(oldValue, field.type);
        const newNorm = normalizeByType(newValue, field.type);

        if (oldNorm !== newNorm) {
          changes.push({
            field: field.key,
            old: oldValue,
            new: newValue,
          });

          if (DEBUG_COMPARE && debugCount < DEBUG_LIMIT) {
            console.log(
              `[DEBUG][row ${r.row}][id ${r.booked_product_id}] MISMATCH field="${field.key}" type=${field.type}\n` +
                `    DB    : value=${JSON.stringify(oldValue)} (typeof ${typeof oldValue}) -> normalized=${JSON.stringify(oldNorm)}\n` +
                `    EXCEL : value=${JSON.stringify(newValue)} (typeof ${typeof newValue}) -> normalized=${JSON.stringify(newNorm)}`,
            );
          }
        }
      }

      if (changes.length === 0) {
        unchangedRows.push(r);
      } else {
        updatedRows.push({ ...r, changes });

        if (DEBUG_COMPARE && debugCount < DEBUG_LIMIT) {
          debugCount++;
        }
      }
    }

    /**
     * ==========================================================
     * 7. INSERT / UPDATE (1x bulk query, tanpa baris unchanged)
     * ==========================================================
     *
     * Baris unchanged tidak perlu ditulis ulang ke database —
     * datanya sudah identik, jadi write ini cuma buang I/O.
     */

    const rowsToWrite = [...insertedRows, ...updatedRows];

    const values = rowsToWrite.map((r) => [
      r.booked_product_id,
      r.dossier_id,
      r.dossier_name,
      r.supplier_id,
      r.product_id,
      r.product_name,
      r.status,
      r.code,
      r.duration,
      r.travel_date,
      r.end_date,
      r.sales,
      r.operational,
      r.quantity,
      r.unit,
      r.price,
      r.description,
      r.info,
      r.instructions,
      r.transport_pickup,
      r.transport_dropoff,
    ]);

    let affectedRows = 0;

    if (rowsToWrite.length > 0) {
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
        [values],
      );

      affectedRows = result.affectedRows;
    }

    const lastImport = await recordBookedProductImport(
      req.file.originalname,
      rows.length,
    );

    /**
     * ==========================================================
     * HAPUS TEMPORARY FILE
     * ==========================================================
     */

    if (filePath) {
      fs.unlink(filePath, () => {});
      filePath = null;
    }

    /**
     * ==========================================================
     * RESPONSE
     * ==========================================================
     */

    console.log("");
    console.log("======================================");
    console.log("     IMPORT BOOKED PRODUCT SELESAI");
    console.log("======================================");
    console.log("Total baris Excel :", rows.length);
    console.log("Data valid        :", dataToInsert.length);
    console.log("Affected rows     :", affectedRows);
    console.log("Inserted          :", insertedRows.length);
    console.log("Updated           :", updatedRows.length);
    console.log("Unchanged         :", unchangedRows.length);
    console.log("Dilewati          :", skippedRows.length);

    return res.status(200).json({
      success: true,
      message: "Import booked product berhasil.",
      lastImport,

      summary: {
        totalRows: rows.length,
        inserted: insertedRows.length,
        updated: updatedRows.length,
        unchanged: unchangedRows.length,
        skipped: skippedRows.length,
      },

      insertedRows: insertedRows.map((r) => ({
        row: r.row,
        id: r.booked_product_id,
        dossier_id: r.dossier_id,
        dossier_name: r.dossier_name,
        supplier_id: r.supplier_id,
        product_id: r.product_id,
        product_name: r.product_name,
        status: r.status,
        travel_date: r.travel_date,
        price: r.price,
      })),

      updatedRows: updatedRows.map((r) => ({
        row: r.row,
        id: r.booked_product_id,
        dossier_id: r.dossier_id,
        dossier_name: r.dossier_name,
        supplier_id: r.supplier_id,
        product_id: r.product_id,
        product_name: r.product_name,
        status: r.status,
        travel_date: r.travel_date,
        price: r.price,
        changes: r.changes,
      })),

      unchangedRows: unchangedRows.map((r) => ({
        row: r.row,
        id: r.booked_product_id,
        dossier_id: r.dossier_id,
        dossier_name: r.dossier_name,
        product_name: r.product_name,
      })),

      skippedRows,
    });
  } catch (error) {
    console.error("Import booked product error:", error);

    if (filePath) {
      fs.unlink(filePath, () => {});
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Gagal melakukan import booked product.",
    });
  }
}

async function createManualBookedProduct(req, res) {
  const connection = await pool.getConnection();

  try {
    const body = req.body || {};
    const booking = body.booking || {};
    const idMode = body.idMode === "manual" ? "manual" : "random";
    const allowedProductStatuses = new Set([
      "One Time Product",
      "Regular Product",
    ]);

    const supplierId = normalizeInteger(body.supplierId);
    const bookedProductId = normalizeInteger(booking.bookedProductId);
    const productName = String(body.productName || "").trim();
    const productType = String(body.productType || "").trim() || null;
    const productStatus = allowedProductStatuses.has(body.productStatus)
      ? body.productStatus
      : null;

    if (!supplierId || supplierId < 1) {
      return res.status(400).json({ success: false, message: "Supplier ID wajib diisi dan harus valid." });
    }

    if (!bookedProductId || bookedProductId < 1) {
      return res.status(400).json({ success: false, message: "Sold Product ID wajib diisi dan harus valid." });
    }

    if (!productName) {
      return res.status(400).json({ success: false, message: "Nama produk wajib diisi." });
    }

    if (!productStatus) {
      return res.status(400).json({ success: false, message: "Status produk tidak valid." });
    }

    const travelDate = normalizeDate(booking.travelDate);
    const endDate = normalizeDate(booking.endDate);
    const price = normalizePrice(booking.price);

    if (booking.travelDate && !travelDate) {
      return res.status(400).json({ success: false, message: "Travel Date tidak valid." });
    }

    if (booking.endDate && !endDate) {
      return res.status(400).json({ success: false, message: "End Date tidak valid." });
    }

    if (
      price !== null &&
      (!Number.isFinite(price) ||
        price > 9999999999999.99 ||
        price < -9999999999999.99)
    ) {
      return res.status(400).json({ success: false, message: "Price di luar range DECIMAL(15,2)." });
    }

    await connection.beginTransaction();

    const [supplierRows] = await connection.query(
      "SELECT supplier_id FROM suppliers WHERE supplier_id = ? LIMIT 1",
      [supplierId],
    );

    if (supplierRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: `Supplier ID "${supplierId}" tidak ditemukan.` });
    }

    let productId = normalizeInteger(body.productId);

    if (idMode === "random") {
      productId = null;

      for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = crypto.randomInt(100000000, 2147483647);
        const [existingRandomId] = await connection.query(
          "SELECT product_id FROM products WHERE product_id = ? LIMIT 1",
          [candidate],
        );

        if (existingRandomId.length === 0) {
          productId = candidate;
          break;
        }
      }
    }

    if (!productId || productId < 1 || productId > 2147483647) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Product ID wajib berupa angka 1 sampai 2147483647." });
    }

    const [[existingProduct], [existingBooking]] = await Promise.all([
      connection.query(
        "SELECT product_id FROM products WHERE product_id = ? LIMIT 1",
        [productId],
      ),
      connection.query(
        "SELECT id FROM booked_products WHERE id = ? LIMIT 1",
        [bookedProductId],
      ),
    ]);

    if (existingProduct.length > 0) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: `Product ID "${productId}" sudah digunakan.` });
    }

    if (existingBooking.length > 0) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: `Sold Product ID "${bookedProductId}" sudah digunakan.` });
    }

    await connection.query(
      `INSERT INTO products (product_id, supplier_id, name, type, status)
       VALUES (?, ?, ?, ?, ?)`,
      [productId, supplierId, productName, productType, productStatus],
    );

    await connection.query(
      `INSERT INTO booked_products (
        id, dossier_id, dossier_name, supplier_id, product_id, product_name,
        status, code, duration, travel_date, end_date, sales, operational,
        quantity, unit, price, description, info, instructions,
        transport_pickup, transport_dropoff
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookedProductId,
        booking.dossierId || null,
        booking.dossierName || null,
        supplierId,
        productId,
        productName,
        booking.status || null,
        booking.code || null,
        normalizeDuration(booking.duration),
        travelDate,
        endDate,
        booking.sales || null,
        booking.operational || null,
        normalizeInteger(booking.quantity),
        booking.unit || null,
        price,
        booking.description || null,
        booking.info || null,
        booking.instructions || null,
        normalizeTransport(booking.transportPickup),
        normalizeTransport(booking.transportDropoff),
      ],
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Produk dan booked product berhasil ditambahkan.",
      productId,
      bookedProduct: {
        row: body.sourceRow || 0,
        id: bookedProductId,
        dossier_id: booking.dossierId || null,
        dossier_name: booking.dossierName || null,
        supplier_id: supplierId,
        product_id: productId,
        product_name: productName,
        status: booking.status || null,
        travel_date: travelDate,
        price,
      },
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create manual booked product error:", error);

    const status = error.code === "ER_DUP_ENTRY" ? 409 : 500;
    return res.status(status).json({
      success: false,
      message:
        status === 409
          ? "Product ID atau Sold Product ID sudah digunakan."
          : error.message || "Gagal menambahkan produk secara manual.",
    });
  } finally {
    connection.release();
  }
}

/**
 * ============================================================
 * EXPORT
 * ============================================================
 */

module.exports = {
  importBookedProduct: [
    (req, res, next) => {
      console.log("Request menyentuh route booked product import");
      next();
    },
    upload.single("file"),
    importBookedProduct,
  ],
  getBookedProductImportStatus,
  createManualBookedProduct,
};
