const pool = require("../../Database/connection");
require("dotenv").config();


function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ------------------------------------------------------------
 * BUILD WORD-BOUNDARY PATTERN
 * ------------------------------------------------------------
 */

function buildWordBoundaryPattern(keyword) {
  const escaped = escapeRegex(keyword.trim());
  return `\\b${escaped}`;
}

/**
 * ------------------------------------------------------------
 * SEARCH HANDLER
 * ------------------------------------------------------------
 */

async function searchBookedProduct(req, res) {
  try {
    const { keyword, date, startDate, endDate } = req.query;
    console.log("Received search request:", { keyword, date, startDate, endDate });
    // =================================================
    // VALIDASI TANGGAL (opsional, fleksibel)
    // =================================================
    //

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    let hasSingleDate = false;
    let hasStartDate = false;
    let hasEndDate = false;

    if (date) {
      if (!dateRegex.test(date)) {
        return res.status(400).json({
          success: false,
          message: "Format date tidak valid. Gunakan YYYY-MM-DD.",
        });
      }
      hasSingleDate = true;
    }

    if (!hasSingleDate && startDate) {
      if (!dateRegex.test(startDate)) {
        return res.status(400).json({
          success: false,
          message: "Format startDate tidak valid. Gunakan YYYY-MM-DD.",
        });
      }
      hasStartDate = true;
    }

    if (!hasSingleDate && endDate) {
      if (!dateRegex.test(endDate)) {
        return res.status(400).json({
          success: false,
          message: "Format endDate tidak valid. Gunakan YYYY-MM-DD.",
        });
      }
      hasEndDate = true;
    }

    // =================================================
    // VALIDASI KEYWORD
    // =================================================

    const trimmedKeyword = keyword ? String(keyword).trim() : "";
    const hasKeyword = trimmedKeyword.length > 0;

    if (hasKeyword && trimmedKeyword.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Keyword minimal 2 karakter.",
      });
    }

    if (!hasKeyword && !hasSingleDate && !hasStartDate && !hasEndDate) {
      return res.status(400).json({
        success: false,
        message: "Isi keyword atau pilih filter tanggal.",
      });
    }

    const pattern = hasKeyword
      ? buildWordBoundaryPattern(trimmedKeyword)
      : null;

    // =================================================
    // PAGINATION
    // =================================================

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit, 10) || 50),
    );
    const offset = (page - 1) * limit;

    // =================================================
    // BANGUN WHERE CLAUSE SECARA DINAMIS
    // =================================================
    //

    const whereParts = [
      "s.company_name REGEXP ?",
      "s.address REGEXP ?",
      "s.town REGEXP ?",
      "s.region REGEXP ?",
      "s.location REGEXP ?",
      "bp.product_name REGEXP ?",
      "bp.description REGEXP ?",
      "bp.info REGEXP ?",
      "bp.instructions REGEXP ?",
    ];

    // Setiap placeholder REGEXP di atas butuh pattern yang sama
    const whereParams = hasKeyword
      ? Array(whereParts.length).fill(pattern)
      : [];

    // =================================================
    // FILTER TANGGAL: SINGLE DATE ATAU RANGE (OVERLAP)
    // =================================================
    //

    let dateSql = "";
    const dateParams = [];

    if (hasSingleDate) {
      dateSql =
        " AND bp.travel_date <= ? AND COALESCE(bp.end_date, bp.travel_date) >= ?";
      dateParams.push(date, date);
    } else if (hasStartDate && hasEndDate) {
      dateSql =
        " AND bp.travel_date <= ? AND COALESCE(bp.end_date, bp.travel_date) >= ?";
      dateParams.push(endDate, startDate);
    } else if (hasStartDate) {
      // Booking masih berlangsung atau dimulai pada/setelah startDate.
      // Contoh: booking 21/12/2026–01/01/2027 tetap cocok untuk 01/01/2027.
      dateSql = " AND COALESCE(bp.end_date, bp.travel_date) >= ?";
      dateParams.push(startDate);
    } else if (hasEndDate) {
      // Booking sudah mulai sebelum/pada endDate
      dateSql = " AND bp.travel_date <= ?";
      dateParams.push(endDate);
    }

    const baseWhereSql = hasKeyword
      ? `(${whereParts.join(" OR ")})${dateSql}`
      : dateSql.replace(/^ AND /, "");

    // =================================================
    // COUNT TOTAL (untuk pagination)
    // =================================================

    const [countResult] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM booked_products bp
      JOIN suppliers s ON s.supplier_id = bp.supplier_id
      WHERE ${baseWhereSql}
      `,
      [...whereParams, ...dateParams],
    );

    const total = countResult[0].total;

    // =================================================
    // AMBIL DATA
    // =================================================

    // matched_field butuh pattern lagi (dipakai di SELECT, bukan cuma WHERE)
    const matchedFieldParams = hasKeyword
      ? Array(whereParts.length).fill(pattern)
      : [];

    const matchedFieldSql = hasKeyword
      ? `CASE
          WHEN s.company_name REGEXP ? THEN 'company_name'
          WHEN s.address REGEXP ? THEN 'address'
          WHEN s.town REGEXP ? THEN 'town'
          WHEN s.region REGEXP ? THEN 'region'
          WHEN s.location REGEXP ? THEN 'location'
          WHEN bp.product_name REGEXP ? THEN 'product_name'
          WHEN bp.description REGEXP ? THEN 'description'
          WHEN bp.info REGEXP ? THEN 'info'
          WHEN bp.instructions REGEXP ? THEN 'instructions'
          ELSE 'other'
        END`
      : "'travel_date'";

    const [rows] = await pool.query(
      `
      SELECT
        bp.*,
        s.supplier_id,
        s.company_name,
        s.address,
        s.town,
        s.region,
        s.location,

        ${matchedFieldSql} AS matched_field

      FROM booked_products bp
      JOIN suppliers s ON s.supplier_id = bp.supplier_id
      WHERE ${baseWhereSql}
      ORDER BY bp.travel_date ASC
      LIMIT ? OFFSET ?
      `,
      [
        ...matchedFieldParams,
        ...whereParams,
        ...dateParams,
        limit,
        offset,
      ],
    );

    console.log("Query selesai, jumlah rows:", rows.length); 

    return res.status(200).json({
      success: true,
      keyword: trimmedKeyword,
      filters: {
        date: hasSingleDate ? date : null,
        startDate: hasStartDate ? startDate : null,
        endDate: hasEndDate ? endDate : null,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      results: rows,
    });
  } catch (error) {
    console.error("Search booked product error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Gagal melakukan pencarian.",
    });
  }
}

module.exports = {
  searchBookedProduct,
};
