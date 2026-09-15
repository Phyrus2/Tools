const pool = require("../../Database/connection");
const {
  normalizeProductText,
  parseBooleanFlag,
} = require("../../Utils/normalize_product_text");

const SUPPLIER_FIELDS = [
  { column: "s.company_name", label: "company_name" },
  { column: "s.location", label: "location" },
  { column: "s.town", label: "town" },
  { column: "s.region", label: "region" },
  { column: "s.address", label: "address" },
  { column: "CAST(s.category_supplier AS CHAR)", label: "category_supplier" },
  {
    column: "s.status",
    label: "supplier_status",
  },
];

const PRODUCT_FIELDS = [
  { column: "p.name", label: "product_name" },
  { column: "s.company_name", label: "company_name" },
  { column: "s.location", label: "location" },
  { column: "s.town", label: "town" },
  { column: "s.region", label: "region" },
  { column: "CAST(s.category_supplier AS CHAR)", label: "category_supplier" },
  { column: "p.type", label: "product_type" },
  { column: "p.info", label: "info" },
  { column: "p.description", label: "description" },
  { column: "p.instructions", label: "instructions" },
  { column: "p.services_included", label: "services_included" },
  { column: "p.services_excluded", label: "services_excluded" },
  { column: "p.not_on_offer", label: "not_on_offer" },
];

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}

function parseTerms(keyword) {
  return String(keyword)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
}

function buildSearchWhere(fields, terms) {
  const sql = terms
    .map(
      () =>
        `(${fields
          .map((field) => `COALESCE(${field.column}, '') LIKE ? ESCAPE '\\\\'`)
          .join(" OR ")})`,
    )
    .join(" AND ");

  const params = terms.flatMap((term) => {
    const pattern = `%${escapeLike(term)}%`;
    return fields.map(() => pattern);
  });

  return { sql, params };
}

function buildMatchedField(fields, terms) {
  const lines = fields.map((field) => {
    const checks = terms
      .map(() => `COALESCE(${field.column}, '') LIKE ? ESCAPE '\\\\'`)
      .join(" AND ");
    return `WHEN (${checks}) THEN '${field.label}'`;
  });

  const params = fields.flatMap(() =>
    terms.map((term) => `%${escapeLike(term)}%`),
  );

  return {
    sql: `CASE ${lines.join(" ")} ELSE 'multiple_fields' END`,
    params,
  };
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

function hasCompulsoryDinner(info) {
  if (!info) return null;

  const segments = String(info)
    .toLowerCase()
    .split(/[.\n;]+/)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const positiveSegments = segments.filter(
    (segment) =>
      /\b(?:dinner|buffets?)\b/.test(segment) &&
      /\b(?:compulsory|compulsary)\b/.test(segment),
  );

  if (positiveSegments.length === 0) return null;

  const allNegated = positiveSegments.every((segment) =>
    /\b(?:no|not|without)\s+(?:a\s+)?(?:compulsory|compulsary)\b/.test(
      segment,
    ),
  );
  return !allNegated;
}

async function searchCatalog(req, res) {
  try {
    const type = String(req.query.type || "").toLowerCase();
    const keyword = String(req.query.keyword || "").trim();
    const category = String(req.query.category || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();

    if (type !== "supplier" && type !== "product") {
      return res.status(400).json({
        success: false,
        message: 'Pilih tipe pencarian "supplier" atau "product".',
      });
    }

    if (keyword && keyword.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Keyword minimal 2 karakter.",
      });
    }

    if (keyword.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Keyword maksimal 100 karakter.",
      });
    }

    if (category.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Category maksimal 100 karakter.",
      });
    }

    const validStatuses =
      type === "supplier"
        ? ["", "active", "inactive"]
        : ["", "offer", "not_on_offer"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Filter status tidak valid.",
      });
    }

    if (!keyword && !category && !status) {
      return res.status(400).json({
        success: false,
        message: "Isi keyword atau pilih salah satu filter.",
      });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 20),
    );
    const offset = (page - 1) * limit;
    const terms = parseTerms(keyword);
    const fields = type === "supplier" ? SUPPLIER_FIELDS : PRODUCT_FIELDS;
    const where = buildSearchWhere(fields, terms);
    const matched = terms.length
      ? buildMatchedField(fields, terms)
      : { sql: "'category'", params: [] };

    const fromSql =
      type === "supplier"
        ? "FROM suppliers s"
        : "FROM products p JOIN suppliers s ON s.supplier_id = p.supplier_id";

    const conditions = [];
    const whereParams = [];
    if (where.sql) {
      conditions.push(`(${where.sql})`);
      whereParams.push(...where.params);
    }
    if (category) {
      conditions.push(
        type === "supplier"
          ? "JSON_CONTAINS(s.category_supplier, JSON_QUOTE(?))"
          : "p.type = ?",
      );
      whereParams.push(category);
    }
    if (status) {
      if (type === "supplier") {
        conditions.push("LOWER(TRIM(s.status)) = ?");
        whereParams.push(status);
      } else {
        const notOnOfferSql =
          "LOWER(TRIM(COALESCE(p.not_on_offer, 'false'))) IN ('true', '1', 'yes', 'y')";
        conditions.push(status === "not_on_offer" ? notOnOfferSql : `NOT (${notOnOfferSql})`);
      }
    }
    const filterSql = conditions.join(" AND ");

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total ${fromSql} WHERE ${filterSql}`,
      whereParams,
    );
    const total = Number(countRows[0]?.total || 0);

    let selectSql;
    if (type === "supplier") {
      selectSql = `
        SELECT
          s.supplier_id, s.company_name, s.address, s.town, s.region,
          s.location, s.category_supplier, s.status,
          (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.supplier_id) AS product_count,
          ${matched.sql} AS matched_field
        ${fromSql}
        WHERE ${filterSql}
        ORDER BY s.company_name ASC, s.supplier_id ASC
        LIMIT ? OFFSET ?`;
    } else {
      selectSql = `
        SELECT
          p.product_id, p.name, p.type, p.status, p.info, p.not_on_offer,
          p.services_included, p.services_excluded, p.instructions, p.description,
          s.supplier_id, s.company_name, s.address, s.town, s.region,
          s.location, s.category_supplier,
          ${matched.sql} AS matched_field
        ${fromSql}
        WHERE ${filterSql}
        ORDER BY p.name ASC, s.company_name ASC, p.product_id ASC
        LIMIT ? OFFSET ?`;
    }

    const [rows] = await pool.query(selectSql, [
      ...matched.params,
      ...whereParams,
      limit,
      offset,
    ]);

    const results = rows.map((row) => {
      if (type === "supplier") {
        return {
          ...row,
          category_supplier: normalizeCategories(row.category_supplier),
        };
      }

      const info = normalizeProductText(row.info);
      return {
        ...row,
        info,
        description: normalizeProductText(row.description),
        instructions: normalizeProductText(row.instructions),
        services_included: normalizeProductText(row.services_included),
        services_excluded: normalizeProductText(row.services_excluded),
        not_on_offer: parseBooleanFlag(row.not_on_offer),
        category_supplier: normalizeCategories(row.category_supplier),
        has_compulsory_dinner: hasCompulsoryDinner(info),
      };
    });

    return res.status(200).json({
      success: true,
      type,
      keyword,
      category: category || null,
      status: status || null,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      results,
    });
  } catch (error) {
    console.error("Search catalog error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Gagal melakukan pencarian katalog.",
    });
  }
}

async function getCatalogCategories(req, res) {
  try {
    const type = String(req.query.type || "").toLowerCase();
    if (type !== "supplier" && type !== "product") {
      return res.status(400).json({
        success: false,
        message: 'Pilih tipe category "supplier" atau "product".',
      });
    }

    let categories;
    if (type === "supplier") {
      const [rows] = await pool.query(
        "SELECT category_supplier FROM suppliers",
      );
      categories = [
        ...new Set(
          rows.flatMap((row) => normalizeCategories(row.category_supplier)),
        ),
      ];
    } else {
      const [rows] = await pool.query(
        `SELECT DISTINCT type
         FROM products
         WHERE type IS NOT NULL AND TRIM(type) <> ''`,
      );
      categories = rows.map((row) => String(row.type).trim());
    }

    categories.sort((a, b) => a.localeCompare(b));
    return res.status(200).json({ success: true, type, categories });
  } catch (error) {
    console.error("Get catalog categories error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Gagal mengambil category.",
    });
  }
}

module.exports = { searchCatalog, getCatalogCategories };
