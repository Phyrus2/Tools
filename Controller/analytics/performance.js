const pool = require("../../Database/connection");

const CONFIRMED_SQL = "LOWER(TRIM(COALESCE(bp.status, ''))) = 'confirmed'";
const DATE_SQL = "bp.travel_date BETWEEN ? AND ?";
const PERIOD_SQL = {
  day: "DATE_FORMAT(bp.travel_date, '%Y-%m-%d')",
  month: "DATE_FORMAT(bp.travel_date, '%Y-%m')",
  year: "DATE_FORMAT(bp.travel_date, '%Y')",
};

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function witaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateRange(req, res) {
  const today = witaToday();
  const currentYear = today.slice(0, 4);
  const requestedFrom = String(req.query.dateFrom || "").trim();
  const requestedTo = String(req.query.dateTo || "").trim();
  const inferredYear = (requestedFrom || requestedTo || currentYear).slice(0, 4);
  const dateFrom = requestedFrom || `${inferredYear}-01-01`;
  const dateTo = requestedTo || `${inferredYear}-12-31`;
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) {
    res.status(400).json({ success: false, message: "Range tanggal tidak valid." });
    return null;
  }
  return { dateFrom, dateTo };
}

function granularity(req, res) {
  const value = String(req.query.granularity || "month").toLowerCase();
  if (!Object.hasOwn(PERIOD_SQL, value)) {
    res.status(400).json({ success: false, message: "Kelompok waktu tidak valid." });
    return null;
  }
  return value;
}

function numberRows(rows, fields) {
  return rows.map((row) => {
    const normalized = { ...row };
    fields.forEach((field) => {
      normalized[field] = Number(row[field] || 0);
    });
    return normalized;
  });
}

function normalizeCategories(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanDestination(value) {
  let destination = String(value || "")
    .trim()
    .replace(/\s+-\s+(?:exclude\b.*|one\s+way\b.*|boat\b.*)$/i, "")
    .replace(/\s*\/\s*boat\s+only\s*$/i, "")
    .replace(/\s*\([A-Z0-9]{3,4}\)\s*$/i, "")
    .trim();

  const aliases = new Map([
    ["padangbai", "Padang Bai"],
    ["nusa penida", "Nusa Penida"],
    ["nusa lembongan", "Nusa Lembongan"],
  ]);
  destination = aliases.get(destination.toLowerCase()) || destination;

  if (
    !destination ||
    /^(?:area\s*\d+|hotel|harbou?r|port)$/i.test(destination) ||
    /\b(?:airport|bandara)\b/i.test(destination)
  ) {
    return null;
  }
  return destination;
}

function destinationFromProduct(productName, productType) {
  const name = String(productName || "").trim();
  const type = String(productType || "").trim().toLowerCase();
  let destination = "";

  if (type === "transport (air)") {
    if (!/^flight\b/i.test(name) || !/\s-\s/.test(name)) return null;
    destination = name.split(/\s+-\s/).pop();
  } else if (type === "transport (sea)") {
    const toParts = name.split(/\s+to\s+/i);
    destination = toParts.length > 1 ? toParts.pop() : name.split(/\s+-\s/).pop();
  } else if (type.startsWith("transport land")) {
    const toParts = name.split(/\s+to\s+/i);
    if (toParts.length < 2) return null;
    destination = toParts.pop();
  } else {
    return null;
  }

  return cleanDestination(destination);
}

function aggregateDestinations(rows) {
  const destinations = new Map();
  rows.forEach((row) => {
    const destination = destinationFromProduct(row.product_name, row.product_type);
    if (!destination) return;
    const key = destination.toLocaleLowerCase("id-ID");
    const existing = destinations.get(key) || { destination, bookings: 0 };
    existing.bookings += Number(row.bookings || 0);
    destinations.set(key, existing);
  });
  return [...destinations.values()]
    .sort((a, b) => b.bookings - a.bookings || a.destination.localeCompare(b.destination, "id-ID"))
    .slice(0, 3);
}

async function overview(req, res) {
  try {
    const range = dateRange(req, res);
    if (!range) return;
    const groupBy = granularity(req, res);
    if (!groupBy) return;
    const rangeParams = [range.dateFrom, range.dateTo];

    const [summaryRows] = await pool.query(
      `SELECT COUNT(*) AS booked_products,
              COUNT(DISTINCT NULLIF(TRIM(bp.dossier_id), '')) AS reservations,
              COUNT(DISTINCT bp.supplier_id) AS suppliers,
              COUNT(DISTINCT bp.product_id) AS products,
              (SELECT COUNT(*)
                 FROM booked_products all_bookings
                WHERE LOWER(TRIM(COALESCE(all_bookings.status, ''))) = 'confirmed') AS total_bookings,
              (SELECT COUNT(*) FROM suppliers) AS total_suppliers,
              (SELECT COUNT(*) FROM products) AS total_products,
              (SELECT COUNT(DISTINCT all_bp.dossier_id)
                 FROM booked_products all_bp
                WHERE LOWER(TRIM(COALESCE(all_bp.status, ''))) = 'confirmed'
                  AND all_bp.dossier_id IS NOT NULL
                  AND TRIM(all_bp.dossier_id) <> '') AS total_dossiers
       FROM booked_products bp
       WHERE ${CONFIRMED_SQL} AND ${DATE_SQL}`,
      rangeParams,
    );
    const [monthlyRows] = await pool.query(
      `SELECT ${PERIOD_SQL[groupBy]} AS period, COUNT(*) AS bookings
       FROM booked_products bp
       WHERE ${CONFIRMED_SQL} AND ${DATE_SQL}
       GROUP BY period ORDER BY period`,
      rangeParams,
    );
    const [supplierRows] = await pool.query(
      `SELECT s.supplier_id, s.company_name, COUNT(*) AS bookings
       FROM booked_products bp JOIN suppliers s ON s.supplier_id = bp.supplier_id
       WHERE ${CONFIRMED_SQL} AND ${DATE_SQL}
       GROUP BY s.supplier_id, s.company_name
       ORDER BY bookings DESC, s.company_name ASC LIMIT 3`,
      rangeParams,
    );
    const [productRows] = await pool.query(
      `SELECT p.product_id, p.name, s.company_name, COUNT(*) AS bookings
       FROM booked_products bp
       JOIN products p ON p.product_id = bp.product_id
       JOIN suppliers s ON s.supplier_id = p.supplier_id
       WHERE ${CONFIRMED_SQL} AND ${DATE_SQL}
       GROUP BY p.product_id, p.name, s.company_name
       ORDER BY bookings DESC, p.name ASC LIMIT 3`,
      rangeParams,
    );
    const [salesRows] = await pool.query(
      `SELECT TRIM(bp.sales) AS name, COUNT(*) AS bookings
       FROM booked_products bp
       WHERE ${CONFIRMED_SQL} AND ${DATE_SQL}
         AND bp.sales IS NOT NULL AND TRIM(bp.sales) <> ''
       GROUP BY TRIM(bp.sales)
       ORDER BY bookings DESC, name ASC`,
      rangeParams,
    );
    const [operationalRows] = await pool.query(
      `SELECT TRIM(bp.operational) AS name, COUNT(*) AS bookings
       FROM booked_products bp
       WHERE ${CONFIRMED_SQL} AND ${DATE_SQL}
         AND bp.operational IS NOT NULL AND TRIM(bp.operational) <> ''
       GROUP BY TRIM(bp.operational)
       ORDER BY bookings DESC, name ASC`,
      rangeParams,
    );
    const [destinationProductRows] = await pool.query(
      `SELECT p.name AS product_name, p.type AS product_type, COUNT(*) AS bookings
       FROM booked_products bp JOIN products p ON p.product_id = bp.product_id
       WHERE ${CONFIRMED_SQL} AND ${DATE_SQL}
         AND (
           LOWER(TRIM(COALESCE(p.type, ''))) IN ('transport (air)', 'transport (sea)')
           OR LOWER(TRIM(COALESCE(p.type, ''))) LIKE 'transport land%'
         )
         AND (LOWER(p.name) LIKE '% to %' OR p.name LIKE '% - %')
       GROUP BY p.product_id, p.name, p.type`,
      rangeParams,
    );
    const destinationRows = aggregateDestinations(destinationProductRows);
    const summary = summaryRows[0] || {};
    return res.json({
      success: true,
      timezone: "Asia/Makassar",
      status: "Confirmed",
      ...range,
      granularity: groupBy,
      summary: {
        bookedProducts: Number(summary.booked_products || 0),
        totalBookings: Number(summary.total_bookings || 0),
        reservations: Number(summary.reservations || 0),
        suppliers: Number(summary.suppliers || 0),
        products: Number(summary.products || 0),
        totalDossiers: Number(summary.total_dossiers || 0),
        totalSuppliers: Number(summary.total_suppliers || 0),
        totalProducts: Number(summary.total_products || 0),
      },
      monthly: numberRows(monthlyRows, ["bookings"]),
      topSuppliers: numberRows(supplierRows, ["supplier_id", "bookings"]),
      topProducts: numberRows(productRows, ["product_id", "bookings"]),
      topSales: numberRows(salesRows, ["bookings"]),
      topOperational: numberRows(operationalRows, ["bookings"]),
      topTransferDestinations: numberRows(destinationRows, ["bookings"]),
    });
  } catch (error) {
    console.error("Analytics overview error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil dashboard analytics." });
  }
}

async function supplierDetail(req, res) {
  try {
    const supplierId = parseId(req.params.supplierId);
    if (!supplierId) return res.status(400).json({ success: false, message: "Supplier ID tidak valid." });
    const range = dateRange(req, res);
    if (!range) return;
    const groupBy = granularity(req, res);
    if (!groupBy) return;

    const [supplierRows] = await pool.query(
      `SELECT supplier_id, company_name, address, town, region, location,
              category_supplier, status, created_at, updated_at
         FROM suppliers WHERE supplier_id = ?`,
      [supplierId],
    );
    if (!supplierRows.length) return res.status(404).json({ success: false, message: "Supplier tidak ditemukan." });

    const params = [supplierId, range.dateFrom, range.dateTo];
    const [summaryRows] = await pool.query(
      `SELECT COUNT(*) AS booked_products, COUNT(DISTINCT bp.dossier_id) AS reservations,
              COUNT(DISTINCT bp.product_id) AS booked_product_types,
              MAX(bp.travel_date) AS last_travel_date
       FROM booked_products bp
       WHERE ${CONFIRMED_SQL} AND bp.supplier_id = ? AND ${DATE_SQL}`,
      params,
    );
    const [monthlyRows] = await pool.query(
      `SELECT ${PERIOD_SQL[groupBy]} AS period, COUNT(*) AS bookings
       FROM booked_products bp
       WHERE ${CONFIRMED_SQL} AND bp.supplier_id = ? AND ${DATE_SQL}
       GROUP BY period ORDER BY period`,
      params,
    );
    const [productRows] = await pool.query(
      `SELECT p.product_id, p.name, p.type, p.status, p.not_on_offer,
              COUNT(bp.id) AS bookings,
              COUNT(DISTINCT bp.dossier_id) AS reservations,
              MAX(bp.travel_date) AS last_travel_date
       FROM products p
       LEFT JOIN booked_products bp ON bp.product_id = p.product_id
         AND ${CONFIRMED_SQL} AND ${DATE_SQL}
       WHERE p.supplier_id = ?
       GROUP BY p.product_id, p.name, p.type, p.status, p.not_on_offer
       ORDER BY bookings DESC, p.name ASC`,
      [range.dateFrom, range.dateTo, supplierId],
    );
    const totalBookings = Number(summaryRows[0]?.booked_products || 0);

    return res.json({
      success: true, timezone: "Asia/Makassar", status: "Confirmed", ...range, granularity: groupBy,
      supplier: { ...supplierRows[0], category_supplier: normalizeCategories(supplierRows[0].category_supplier) },
      summary: {
        bookedProducts: totalBookings,
        reservations: Number(summaryRows[0]?.reservations || 0),
        bookedProductTypes: Number(summaryRows[0]?.booked_product_types || 0),
        totalProducts: productRows.length,
        lastTravelDate: summaryRows[0]?.last_travel_date || null,
      },
      monthly: numberRows(monthlyRows, ["bookings"]),
      products: numberRows(productRows, ["product_id", "bookings", "reservations"]).map((row) => ({
        ...row,
        contribution: totalBookings ? Number(((row.bookings / totalBookings) * 100).toFixed(1)) : 0,
      })),
    });
  } catch (error) {
    console.error("Supplier analytics error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil analytics supplier." });
  }
}

async function productDetail(req, res) {
  try {
    const productId = parseId(req.params.productId);
    if (!productId) return res.status(400).json({ success: false, message: "Product ID tidak valid." });
    const range = dateRange(req, res);
    if (!range) return;
    const groupBy = granularity(req, res);
    if (!groupBy) return;

    const [productRows] = await pool.query(
      `SELECT p.product_id, p.name, p.type, p.status, p.info, p.not_on_offer,
              p.services_included, p.services_excluded, p.instructions, p.description,
              p.created_at, p.updated_at,
              s.supplier_id, s.company_name, s.location, s.town, s.region
       FROM products p JOIN suppliers s ON s.supplier_id = p.supplier_id
       WHERE p.product_id = ?`,
      [productId],
    );
    if (!productRows.length) return res.status(404).json({ success: false, message: "Product tidak ditemukan." });

    const params = [productId, range.dateFrom, range.dateTo];
    const [summaryRows] = await pool.query(
      `SELECT COUNT(*) AS booked_products, COUNT(DISTINCT bp.dossier_id) AS reservations,
              MAX(bp.travel_date) AS last_travel_date, MIN(bp.travel_date) AS first_travel_date
       FROM booked_products bp
       WHERE ${CONFIRMED_SQL} AND bp.product_id = ? AND ${DATE_SQL}`,
      params,
    );
    const [monthlyRows] = await pool.query(
      `SELECT ${PERIOD_SQL[groupBy]} AS period, COUNT(*) AS bookings
       FROM booked_products bp
       WHERE ${CONFIRMED_SQL} AND bp.product_id = ? AND ${DATE_SQL}
       GROUP BY period ORDER BY period`,
      params,
    );
    const [weekdayRows] = await pool.query(
      `SELECT WEEKDAY(bp.travel_date) AS weekday, COUNT(*) AS bookings
       FROM booked_products bp
       WHERE ${CONFIRMED_SQL} AND bp.product_id = ? AND ${DATE_SQL}
       GROUP BY WEEKDAY(bp.travel_date) ORDER BY weekday`,
      params,
    );
    const [bookedProductRows] = await pool.query(
      `SELECT bp.id AS sold_product_id, bp.dossier_id, bp.dossier_name,
              bp.travel_date, bp.end_date, bp.duration, bp.duration_unit,
              bp.quantity, bp.unit, bp.sales, bp.operational,
              CASE
                WHEN bp.duration IS NULL OR bp.quantity IS NULL THEN NULL
                ELSE bp.duration * bp.quantity
              END AS total_quantity
       FROM booked_products bp
       WHERE ${CONFIRMED_SQL} AND bp.product_id = ? AND ${DATE_SQL}
       ORDER BY bp.travel_date DESC, bp.id DESC`,
      params,
    );
    const [rankRows] = await pool.query(
      `SELECT ranked.supplier_rank FROM (
         SELECT bp.product_id,
                DENSE_RANK() OVER (ORDER BY COUNT(*) DESC) AS supplier_rank
         FROM booked_products bp
         JOIN products p ON p.product_id = bp.product_id
         WHERE ${CONFIRMED_SQL} AND p.supplier_id = ? AND ${DATE_SQL}
         GROUP BY bp.product_id
       ) ranked WHERE ranked.product_id = ?`,
      [productRows[0].supplier_id, range.dateFrom, range.dateTo, productId],
    );
    const summary = summaryRows[0] || {};
    return res.json({
      success: true, timezone: "Asia/Makassar", status: "Confirmed", ...range, granularity: groupBy,
      product: productRows[0],
      summary: {
        bookedProducts: Number(summary.booked_products || 0),
        reservations: Number(summary.reservations || 0),
        supplierRank: rankRows.length ? Number(rankRows[0].supplier_rank) : null,
        firstTravelDate: summary.first_travel_date || null,
        lastTravelDate: summary.last_travel_date || null,
      },
      monthly: numberRows(monthlyRows, ["bookings"]),
      weekdays: numberRows(weekdayRows, ["weekday", "bookings"]),
      bookedProducts: bookedProductRows.map((row) => ({
        ...row,
        sold_product_id: Number(row.sold_product_id),
        duration: row.duration === null ? null : Number(row.duration),
        quantity: row.quantity === null ? null : Number(row.quantity),
        total_quantity: row.total_quantity === null ? null : Number(row.total_quantity),
      })),
    });
  } catch (error) {
    console.error("Product analytics error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil analytics product." });
  }
}

module.exports = { overview, supplierDetail, productDetail };
