const pool = require("../../Database/connection");
require("dotenv").config();

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}

/**
 * ------------------------------------------------------------
 * BUILD WORD-BOUNDARY PATTERN (per satu term)
 * spasi di term diganti \s+ supaya toleran ke non-breaking space,
 * spasi ganda, atau line break di data database.
 * ------------------------------------------------------------
 */
function buildWordBoundaryPattern(term) {
  const normalized = term.trim().replace(/\s+/g, " ");
  const escaped = escapeRegex(normalized).replace(/ /g, "\\s+");
  return `\\b${escaped}`;
}

// Pisah keyword multi-lokasi pakai koma, misal "ruteng, liang bua"
function parseKeywordTerms(rawKeyword) {
  return String(rawKeyword)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

const SEARCHABLE_FIELDS = [
  { column: "s.company_name", label: "company_name" },
  { column: "s.address", label: "address" },
  { column: "s.town", label: "town" },
  { column: "s.region", label: "region" },
  { column: "s.location", label: "location" },
  { column: "bp.product_name", label: "product_name" },
  { column: "bp.description", label: "description" },
  { column: "bp.info", label: "info" },
  { column: "bp.instructions", label: "instructions" },
  { column: "bp.sales", label: "sales" },
  { column: "bp.operational", label: "operational" },
];

/**
 * ------------------------------------------------------------
 * SEARCH HANDLER
 * ------------------------------------------------------------
 */
async function searchBookedProduct(req, res) {
  try {
    const { keyword, date, startDate, endDate } = req.query;
    const sales = String(req.query.sales || "").trim();
    const operational = String(req.query.operational || "").trim();
    console.log("Received search request:", { keyword, date, startDate, endDate, sales, operational });

    // =================================================
    // VALIDASI TANGGAL
    // =================================================
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let hasSingleDate = false;
    let hasStartDate = false;
    let hasEndDate = false;

    if (date) {
      if (!dateRegex.test(date)) {
        return res.status(400).json({ success: false, message: "Format date tidak valid. Gunakan YYYY-MM-DD." });
      }
      hasSingleDate = true;
    }

    if (!hasSingleDate && startDate) {
      if (!dateRegex.test(startDate)) {
        return res.status(400).json({ success: false, message: "Format startDate tidak valid. Gunakan YYYY-MM-DD." });
      }
      hasStartDate = true;
    }

    if (!hasSingleDate && endDate) {
      if (!dateRegex.test(endDate)) {
        return res.status(400).json({ success: false, message: "Format endDate tidak valid. Gunakan YYYY-MM-DD." });
      }
      hasEndDate = true;
    }

    if (hasStartDate && hasEndDate && startDate > endDate) {
      return res.status(400).json({ success: false, message: "Tanggal akhir tidak boleh lebih awal dari tanggal mulai." });
    }

    // =================================================
    // VALIDASI KEYWORD (per-term, bukan total string)
    // =================================================
    const trimmedKeyword = keyword ? String(keyword).trim() : "";
    const keywordTerms = trimmedKeyword ? parseKeywordTerms(trimmedKeyword) : [];
    const hasKeyword = keywordTerms.length > 0;

    if (hasKeyword && keywordTerms.some((t) => t.length < 2)) {
      return res.status(400).json({
        success: false,
        message: "Setiap keyword minimal 2 karakter.",
      });
    }

    if ((sales && sales.length < 2) || (operational && operational.length < 2)) {
      return res.status(400).json({ success: false, message: "Nama sales atau operational minimal 2 karakter." });
    }
    if (sales.length > 100 || operational.length > 100) {
      return res.status(400).json({ success: false, message: "Nama sales atau operational maksimal 100 karakter." });
    }

    if (!hasKeyword && !hasSingleDate && !hasStartDate && !hasEndDate && !sales && !operational) {
      return res.status(400).json({ success: false, message: "Isi keyword, nama sales/operational, atau pilih filter tanggal." });
    }

    const keywordPatterns = keywordTerms.map(buildWordBoundaryPattern);

    // =================================================
    // PAGINATION
    // =================================================
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    // =================================================
    // WHERE: setiap term dicek di semua field, digabung OR
    // (per-term terpisah, TANPA grouping regex alternation)
    // =================================================
    const keywordWhereSql = hasKeyword
      ? "(" +
        keywordPatterns
          .map(
            () =>
              "(" +
              SEARCHABLE_FIELDS.map((f) => `${f.column} REGEXP ?`).join(" OR ") +
              ")",
          )
          .join(" OR ") +
        ")"
      : "";

    const keywordWhereParams = hasKeyword
      ? keywordPatterns.flatMap((pattern) => SEARCHABLE_FIELDS.map(() => pattern))
      : [];

    // =================================================
    // FILTER TANGGAL: SINGLE DATE ATAU RANGE (OVERLAP)
    // =================================================
    let dateSql = "";
    const dateParams = [];

    if (hasSingleDate) {
      dateSql = " AND bp.travel_date <= ? AND COALESCE(bp.end_date, bp.travel_date) >= ?";
      dateParams.push(date, date);
    } else if (hasStartDate && hasEndDate) {
      dateSql = " AND bp.travel_date <= ? AND COALESCE(bp.end_date, bp.travel_date) >= ?";
      dateParams.push(endDate, startDate);
    } else if (hasStartDate) {
      dateSql = " AND COALESCE(bp.end_date, bp.travel_date) >= ?";
      dateParams.push(startDate);
    } else if (hasEndDate) {
      dateSql = " AND bp.travel_date <= ?";
      dateParams.push(endDate);
    }

    const conditions = [];
    const filterParams = [];
    if (hasKeyword) {
      conditions.push(keywordWhereSql);
      filterParams.push(...keywordWhereParams);
    }
    if (dateSql) {
      conditions.push(dateSql.replace(/^ AND /, ""));
      filterParams.push(...dateParams);
    }
    if (sales) {
      conditions.push("COALESCE(bp.sales, '') LIKE ? ESCAPE '\\\\'");
      filterParams.push(`%${escapeLike(sales)}%`);
    }
    if (operational) {
      conditions.push("COALESCE(bp.operational, '') LIKE ? ESCAPE '\\\\'");
      filterParams.push(`%${escapeLike(operational)}%`);
    }
    const baseWhereSql = conditions.join(" AND ");

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
      filterParams,
    );

    const total = countResult[0].total;

    console.log("WHERE SQL:", baseWhereSql);
    console.log("Params:", filterParams);

    // =================================================
    // AMBIL DATA
    // =================================================
    const matchedFieldSql = hasKeyword
      ? `CASE
${SEARCHABLE_FIELDS.map(
        (f) =>
          `        WHEN (${keywordPatterns.map(() => `${f.column} REGEXP ?`).join(" OR ")}) THEN '${f.label}'`,
      ).join("\n")}
        ELSE 'other'
      END`
      : "'travel_date'";

    const matchedFieldParams = hasKeyword
      ? SEARCHABLE_FIELDS.flatMap(() => keywordPatterns)
      : [];

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
      ORDER BY bp.travel_date ASC, bp.id ASC
      LIMIT ? OFFSET ?
      `,
      [
        ...matchedFieldParams,
        ...filterParams,
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
        sales: sales || null,
        operational: operational || null,
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
