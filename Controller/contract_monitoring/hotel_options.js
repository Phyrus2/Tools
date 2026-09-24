const multer = require("multer");
const xlsx = require("xlsx");
const crypto = require("crypto");
const pool = require("../../Database/connection");
const {
  normalizeName,
  similarity,
} = require("../../Utils/contract_monitoring");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}
function hotelName(value) {
  return text(value)
    .replace(/^[A-Z]\s*[.)-]\s*/i, "")
    .trim();
}
function optionCode(value) {
  const match = /^([ABC])\s*[.)-]\s*/i.exec(text(value));
  return match ? match[1].toUpperCase() : null;
}
function cleanLocation(value) {
  return text(value)
    .replace(/\s*-\s*ok\s*$/i, "")
    .trim();
}
function optionKey(year, sheet, row) {
  return crypto
    .createHash("sha256")
    .update(`${year}:${sheet}:${row}`)
    .digest("hex");
}
function snapshot(item) {
  return {
    option_year: Number(item.option_year),
    option_code: item.option_code || null,
    supplier_id: item.supplier_id || null,
    product_id: item.product_id || null,
    hotel_name: item.hotel_name,
    room_type: item.room_type || null,
    region: item.region,
    location: item.location,
    segment: item.segment || null,
  };
}
function changesBetween(before, after) {
  const changes = {};
  for (const key of Object.keys(after)) {
    if (String(before[key] ?? "") !== String(after[key] ?? ""))
      changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
  }
  return changes;
}

async function importHotelOptions(req, res) {
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, message: "Select an Excel file first." });
  const connection = await pool.getConnection();
  try {
    const requestedYear = Number.parseInt(req.body?.year, 10);
    const fileYearMatch = /(?:19|20)\d{2}/.exec(req.file.originalname || "");
    const fileYear = fileYearMatch ? Number(fileYearMatch[0]) : null;
    const optionYear = fileYear || requestedYear || 2026;
    if (
      !Number.isInteger(optionYear) ||
      optionYear < 2000 ||
      optionYear > 2100
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Select a valid hotel option year." });
    }
    if (
      fileYear &&
      Number.isInteger(requestedYear) &&
      fileYear !== requestedYear
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: `This file is for ${fileYear}. Open the Hotel Options ${fileYear} page before importing it.`,
        });
    }
    const workbook = xlsx.read(req.file.buffer, {
      type: "buffer",
      cellDates: false,
    });
    const [suppliers] = await connection.execute(
      "SELECT supplier_id, company_name FROM suppliers",
    );
    const [products] = await connection.execute(
      "SELECT product_id, supplier_id, name FROM products",
    );
    const [storedOptions] = await connection.execute(
      "SELECT * FROM hotel_options WHERE option_year = ?",
      [optionYear],
    );
    const storedByHotel = new Map();
    for (const option of storedOptions) {
      const key = [
        text(option.region).toLowerCase(),
        cleanLocation(option.location).toLowerCase(),
        normalizeName(option.hotel_name, { keepGeneric: true }),
      ].join(":");
      if (!storedByHotel.has(key)) storedByHotel.set(key, []);
      storedByHotel.get(key).push(option);
    }
    const exact = new Map(
      suppliers.map((row) => [
        normalizeName(row.company_name, { keepGeneric: true }),
        row,
      ]),
    );
    const parsed = [];
    const skippedRows = [];
    const locationOptions = new Map();
    let unmatched = 0;
    for (const sheetName of workbook.SheetNames) {
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: null,
        raw: false,
      });
      let location = sheetName;
      let segment = null;
      for (let index = 1; index < rows.length; index += 1) {
        const row = rows[index];
        const first = text(row[0]);
        const roomType = text(row[1]);
        const hasDetails =
          roomType ||
          text(row[2]) ||
          text(row[3]) ||
          text(row[4]) ||
          text(row[5]) ||
          text(row[6]);
        if (first && !hasDetails) {
          const heading = cleanLocation(first);
          const parts = heading
            .split("/")
            .map((item) => item.trim())
            .filter(Boolean);
          location = heading || sheetName;
          segment = parts.slice(1).join(" / ") || null;
          continue;
        }
        if (!first || !hasDetails) continue;
        const name = hotelName(first);
        const locationKey =
          `${optionYear}:${sheetName}:${location}`.toLowerCase();
        const usedCodes = locationOptions.get(locationKey) || new Set();
        const storedKey = [
          text(sheetName).toLowerCase(),
          cleanLocation(location).toLowerCase(),
          normalizeName(name, { keepGeneric: true }),
        ].join(":");
        const savedCandidates = storedByHotel.get(storedKey) || [];
        const sourceCode = optionCode(first);
        const storedMatch =
          savedCandidates.find(
            (option) =>
              normalizeName(option.room_type, { keepGeneric: true }) ===
                normalizeName(roomType, { keepGeneric: true }) &&
              (!sourceCode || option.option_code === sourceCode),
          ) ||
          savedCandidates.find(
            (option) => sourceCode && option.option_code === sourceCode,
          ) ||
          (savedCandidates.length === 1 ? savedCandidates[0] : null);
        // Keep an existing hotel's saved option code. This happens before the
        // A/B/C capacity check so a moved Excel row is reported as unchanged.
        const code =
          storedMatch?.option_code ||
          sourceCode ||
          ["A", "B", "C"].find((value) => !usedCodes.has(value));
        if (
          !code ||
          (!storedMatch && (usedCodes.size >= 3 || usedCodes.has(code)))
        ) {
          skippedRows.push({
            sheet_name: sheetName,
            row_number: index + 1,
            hotel_name: name,
            room_type: roomType || null,
            reason: `Each location supports only one Option A, B, and C. ${location} already has this option.`,
          });
          continue;
        }
        if (!roomType) {
          skippedRows.push({
            sheet_name: sheetName,
            row_number: index + 1,
            hotel_name: name,
            room_type: null,
            reason: "Room name is missing",
          });
          continue;
        }
        const normalized = normalizeName(name, { keepGeneric: true });
        let supplier = exact.get(normalized) || null;
        if (!supplier) {
          const ranked = suppliers
            .map((item) => ({
              item,
              score: similarity(name, item.company_name),
            }))
            .sort((a, b) => b.score - a.score);
          if (ranked[0]?.score >= 0.78) supplier = ranked[0].item;
        }
        let product = null;
        if (supplier && roomType) {
          const supplierProducts = products.filter(
            (item) => item.supplier_id === supplier.supplier_id,
          );
          product =
            supplierProducts.find(
              (item) =>
                normalizeName(item.name, { keepGeneric: true }) ===
                normalizeName(roomType, { keepGeneric: true }),
            ) || null;
          if (!product) {
            const rankedProducts = supplierProducts
              .map((item) => ({ item, score: similarity(roomType, item.name) }))
              .sort((a, b) => b.score - a.score);
            if (rankedProducts[0]?.score >= 0.86)
              product = rankedProducts[0].item;
          }
        }
        if (!supplier) unmatched += 1;
        usedCodes.add(code);
        locationOptions.set(locationKey, usedCodes);
        parsed.push({
          option_year: optionYear,
          supplier_id: supplier?.supplier_id || null,
          product_id: product?.product_id || null,
          region: sheetName,
          location,
          segment,
          option_code: code,
          hotel_name: name,
          room_type: roomType || null,
          source_row: index + 1,
          existing_id: storedMatch?.id || null,
        });
      }
    }
    await connection.beginTransaction();
    const newRows = [];
    const updatedRows = [];
    const unchangedRows = [];
    for (const item of parsed) {
      const [existing] = await connection.execute(
        "SELECT * FROM hotel_options WHERE id=? OR (option_year=? AND source_sheet=? AND source_row=?) OR option_key=? ORDER BY (id=?) DESC, id LIMIT 1 FOR UPDATE",
        [
          item.existing_id || 0,
          optionYear,
          item.region,
          item.source_row,
          optionKey(optionYear, item.region, item.source_row),
          item.existing_id || 0,
        ],
      );
      if (existing.length) {
        const previous = snapshot(existing[0]);
        const next = snapshot({
          ...item,
          supplier_id: existing[0].supplier_id || item.supplier_id,
          product_id: existing[0].product_id || item.product_id,
        });
        const changes = changesBetween(previous, next);
        if (!Object.keys(changes).length) {
          unchangedRows.push({ ...item, id: existing[0].id });
          continue;
        }
        await connection.execute(
          `UPDATE hotel_options SET option_key=?, option_year=?, option_code=?, supplier_id=?, product_id=?, region=?, location=?, segment=?,
             hotel_name=?, room_type=?, source_file=?, source_sheet=?, source_row=? WHERE id=?`,
          [
            optionKey(optionYear, item.region, item.source_row),
            optionYear,
            next.option_code,
            next.supplier_id,
            next.product_id,
            next.region,
            next.location,
            next.segment,
            next.hotel_name,
            next.room_type,
            req.file.originalname,
            item.region,
            item.source_row,
            existing[0].id,
          ],
        );
        await connection.execute(
          `INSERT INTO hotel_option_revisions (hotel_option_id, action, changes, before_data, after_data, changed_by)
           VALUES (?, 'UPDATED', ?, ?, ?, ?)`,
          [
            existing[0].id,
            JSON.stringify(changes),
            JSON.stringify(previous),
            JSON.stringify(next),
            req.admin.id,
          ],
        );
        updatedRows.push({
          ...item,
          id: existing[0].id,
          changes: Object.entries(changes).map(([field, value]) => ({
            field,
            old: value.from,
            new: value.to,
          })),
        });
      } else {
        const [result] = await connection.execute(
          `INSERT INTO hotel_options
            (option_key, option_year, option_code, supplier_id, product_id, region, location, segment, hotel_name, room_type,
             option_reference, source_file, source_sheet, source_row)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            optionKey(optionYear, item.region, item.source_row),
            optionYear,
            item.option_code,
            item.supplier_id,
            item.product_id,
            item.region,
            item.location,
            item.segment,
            item.hotel_name,
            item.room_type,
            `${item.region}:${item.source_row}`,
            req.file.originalname,
            item.region,
            item.source_row,
          ],
        );
        await connection.execute(
          `INSERT INTO hotel_option_revisions (hotel_option_id, action, changes, before_data, after_data, changed_by)
           VALUES (?, 'IMPORTED', NULL, NULL, ?, ?)`,
          [result.insertId, JSON.stringify(snapshot(item)), req.admin.id],
        );
        newRows.push({ ...item, id: result.insertId });
      }
    }
    await connection.commit();
    return res.json({
      success: true,
      year: optionYear,
      summary: {
        totalRows:
          newRows.length +
          updatedRows.length +
          unchangedRows.length +
          skippedRows.length,
        inserted: newRows.length,
        updated: updatedRows.length,
        unchanged: unchangedRows.length,
        skipped: skippedRows.length,
        unmatched,
      },
      newRows,
      updatedRows,
      unchangedRows,
      skippedRows,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Import hotel options error:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: error.message || "Failed to import hotel options.",
      });
  } finally {
    connection.release();
  }
}

async function listHotelOptions(req, res) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(10, Number.parseInt(req.query.limit, 10) || 50),
    );
    const offset = (page - 1) * limit;
    const optionYear = Number.parseInt(req.query.year, 10) || 2026;
    const conditions = ["ho.option_year = ?"];
    const params = [optionYear];
    if (req.query.region) {
      conditions.push("ho.region = ?");
      params.push(String(req.query.region).slice(0, 100));
    }
    if (req.query.location) {
      conditions.push("ho.location = ?");
      params.push(String(req.query.location).slice(0, 150));
    }
    if (req.query.status === "IN_JAMBIX")
      conditions.push(
        "ho.supplier_id IS NOT NULL AND ho.product_id IS NOT NULL",
      );
    if (req.query.status === "NOT_IN_JAMBIX")
      conditions.push("(ho.supplier_id IS NULL OR ho.product_id IS NULL)");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM hotel_options ho ${where}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT ho.*, s.company_name, p.name AS product_name,
              (SELECT COUNT(*) FROM hotel_option_revisions hr WHERE hr.hotel_option_id=ho.id AND hr.action='UPDATED') AS update_count
         FROM hotel_options ho
       LEFT JOIN products p ON p.product_id=ho.product_id
       LEFT JOIN suppliers s ON s.supplier_id=ho.supplier_id
       ${where}
       ORDER BY ho.region, ho.location, FIELD(ho.option_code, 'A', 'B', 'C'), ho.hotel_name, ho.id
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const [filters] = await pool.execute(
      "SELECT DISTINCT region, location FROM hotel_options WHERE option_year=? ORDER BY region, location",
      [optionYear],
    );
    const [yearRows] = await pool.execute(
      "SELECT DISTINCT option_year FROM hotel_options ORDER BY option_year",
    );
    return res.json({
      success: true,
      page,
      limit,
      total: Number(countRows[0]?.total || 0),
      year: optionYear,
      available_years: yearRows.map((row) => Number(row.option_year)),
      options: rows,
      filter_options: filters,
    });
  } catch (error) {
    console.error("List hotel options error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load hotel options." });
  }
}

function manualPayload(body) {
  const year = Number.parseInt(body?.option_year, 10);
  const code = text(body?.option_code).toUpperCase();
  const region = text(body?.region).slice(0, 100);
  const location = cleanLocation(body?.location).slice(0, 150);
  const hotel = hotelName(body?.hotel_name).slice(0, 255);
  const room = text(body?.room_type).slice(0, 255);
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new Error("Select a valid year.");
  if (!region || !location || !hotel || !room)
    throw new Error("Region, location, hotel, and room are required.");
  if (!["A", "B", "C"].includes(code))
    throw new Error("Option must be A, B, or C.");
  const supplierId = Number.parseInt(body?.supplier_id, 10);
  const productId = Number.parseInt(body?.product_id, 10);
  const hasSupplier = Number.isInteger(supplierId);
  const hasProduct = Number.isInteger(productId);
  if (hasSupplier !== hasProduct)
    throw new Error("Select both a supplier and its room product.");
  return {
    option_year: year,
    option_code: code,
    region,
    location,
    hotel_name: hotel,
    room_type: room,
    segment: text(body?.segment).slice(0, 150) || null,
    supplier_id: hasSupplier ? supplierId : null,
    product_id: hasProduct ? productId : null,
  };
}

async function saveManualOption(req, res) {
  const id = req.params.id ? Number.parseInt(req.params.id, 10) : null;
  const connection = await pool.getConnection();
  try {
    const data = manualPayload(req.body);
    await connection.beginTransaction();
    if (data.supplier_id) {
      const [links] = await connection.execute(
        `SELECT p.product_id FROM products p
          JOIN suppliers s ON s.supplier_id=p.supplier_id
         WHERE s.supplier_id=? AND p.product_id=? LIMIT 1`,
        [data.supplier_id, data.product_id],
      );
      if (!links.length)
        throw new Error("The selected product does not belong to this supplier.");
    }
    let before = null;
    if (id) {
      const [rows] = await connection.execute(
        "SELECT * FROM hotel_options WHERE id=? FOR UPDATE",
        [id],
      );
      if (!rows.length) throw new Error("Hotel option was not found.");
      before = snapshot(rows[0]);
    }
    const [duplicates] = await connection.execute(
      `SELECT id FROM hotel_options
        WHERE option_year=? AND region=? AND location=? AND option_code=? AND id<>? LIMIT 1`,
      [data.option_year, data.region, data.location, data.option_code, id || 0],
    );
    if (duplicates.length)
      throw new Error(
        `Option ${data.option_code} already exists in ${data.location}.`,
      );
    const [countRows] = await connection.execute(
      "SELECT COUNT(*) AS total FROM hotel_options WHERE option_year=? AND region=? AND location=? AND id<>?",
      [data.option_year, data.region, data.location, id || 0],
    );
    if (Number(countRows[0].total) >= 3)
      throw new Error("Each location can contain a maximum of three options.");
    if (id) {
      await connection.execute(
        `UPDATE hotel_options SET option_year=?, option_code=?, supplier_id=?, product_id=?, region=?, location=?, segment=?, hotel_name=?, room_type=? WHERE id=?`,
        [
          data.option_year,
          data.option_code,
          data.supplier_id,
          data.product_id,
          data.region,
          data.location,
          data.segment,
          data.hotel_name,
          data.room_type,
          id,
        ],
      );
      const after = snapshot({ ...before, ...data });
      const changes = changesBetween(before, after);
      if (Object.keys(changes).length)
        await connection.execute(
          `INSERT INTO hotel_option_revisions (hotel_option_id, action, changes, before_data, after_data, changed_by)
         VALUES (?, 'UPDATED', ?, ?, ?, ?)`,
          [
            id,
            JSON.stringify(changes),
            JSON.stringify(before),
            JSON.stringify(after),
            req.admin.id,
          ],
        );
      await connection.commit();
      return res.json({ success: true, id, message: "Hotel option updated." });
    }
    const [inserted] = await connection.execute(
      `INSERT INTO hotel_options (option_year, option_code, supplier_id, product_id, region, location, segment, hotel_name, room_type, option_reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.option_year,
        data.option_code,
        data.supplier_id,
        data.product_id,
        data.region,
        data.location,
        data.segment,
        data.hotel_name,
        data.room_type,
        `MANUAL:${Date.now()}`,
      ],
    );
    await connection.execute(
      `INSERT INTO hotel_option_revisions (hotel_option_id, action, changes, before_data, after_data, changed_by)
       VALUES (?, 'IMPORTED', NULL, NULL, ?, ?)`,
      [inserted.insertId, JSON.stringify(snapshot(data)), req.admin.id],
    );
    await connection.commit();
    return res
      .status(201)
      .json({
        success: true,
        id: inserted.insertId,
        message: "Hotel option added.",
      });
  } catch (error) {
    await connection.rollback();
    return res
      .status(400)
      .json({
        success: false,
        message: error.message || "Failed to save hotel option.",
      });
  } finally {
    connection.release();
  }
}

async function deleteHotelOption(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id))
    return res
      .status(400)
      .json({ success: false, message: "Invalid hotel option." });
  try {
    const [result] = await pool.execute(
      "DELETE FROM hotel_options WHERE id=?",
      [id],
    );
    if (!result.affectedRows)
      return res
        .status(404)
        .json({ success: false, message: "Hotel option was not found." });
    return res.json({ success: true, message: "Hotel option deleted." });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete hotel option." });
  }
}

async function assignHotelOption(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const supplierId = Number.parseInt(req.body?.supplier_id, 10);
  const productId = Number.parseInt(req.body?.product_id, 10);
  if (
    !Number.isInteger(id) ||
    !Number.isInteger(supplierId) ||
    !Number.isInteger(productId)
  ) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Select both a supplier and a product.",
      });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [options] = await connection.execute(
      "SELECT * FROM hotel_options WHERE id=? FOR UPDATE",
      [id],
    );
    if (!options.length) throw new Error("Hotel option was not found.");
    const [suppliers] = await connection.execute(
      "SELECT supplier_id, company_name FROM suppliers WHERE supplier_id = ? LIMIT 1",
      [supplierId],
    );
    if (!suppliers.length) throw new Error("Supplier was not found in Jambix.");
    const [products] = await connection.execute(
      "SELECT product_id, name FROM products WHERE product_id=? AND supplier_id=? LIMIT 1",
      [productId, supplierId],
    );
    if (!products.length)
      throw new Error("The selected product does not belong to this supplier.");
    const before = snapshot(options[0]);
    const after = snapshot({
      ...options[0],
      supplier_id: supplierId,
      product_id: productId,
    });
    const changes = changesBetween(before, after);
    await connection.execute(
      "UPDATE hotel_options SET supplier_id=?, product_id=? WHERE id=?",
      [supplierId, productId, id],
    );
    if (Object.keys(changes).length) {
      await connection.execute(
        `INSERT INTO hotel_option_revisions (hotel_option_id, action, changes, before_data, after_data, changed_by)
         VALUES (?, 'LINKED', ?, ?, ?, ?)`,
        [
          id,
          JSON.stringify(changes),
          JSON.stringify(before),
          JSON.stringify(after),
          req.admin.id,
        ],
      );
    }
    await connection.commit();
    return res.json({
      success: true,
      supplier: suppliers[0],
      product: products[0],
    });
  } catch (error) {
    await connection.rollback();
    console.error("Assign hotel option supplier error:", error);
    return res
      .status(400)
      .json({
        success: false,
        message: error.message || "Failed to link hotel option.",
      });
  } finally {
    connection.release();
  }
}

async function searchLinks(req, res) {
  const query = text(req.query.q).slice(0, 100);
  const supplierId = Number.parseInt(req.query.supplier_id, 10);
  try {
    const like = `%${query}%`;
    const [suppliers] = await pool.execute(
      `SELECT supplier_id, company_name, location, region FROM suppliers
        WHERE company_name LIKE ? ORDER BY company_name LIMIT 20`,
      [like],
    );
    let products = [];
    if (Number.isInteger(supplierId)) {
      [products] = await pool.execute(
        `SELECT product_id, supplier_id, name, type FROM products
          WHERE supplier_id=? AND name LIKE ? ORDER BY name LIMIT 30`,
        [supplierId, like],
      );
    }
    return res.json({ success: true, suppliers, products });
  } catch (error) {
    console.error("Search hotel option links error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to search Jambix data." });
  }
}

async function optionHistory(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id))
    return res
      .status(400)
      .json({ success: false, message: "Invalid hotel option." });
  try {
    const [history] = await pool.execute(
      `SELECT id, action, changes, before_data, after_data, changed_at
         FROM hotel_option_revisions WHERE hotel_option_id=? ORDER BY id DESC LIMIT 100`,
      [id],
    );
    for (const row of history)
      for (const key of ["changes", "before_data", "after_data"]) {
        if (typeof row[key] === "string") row[key] = JSON.parse(row[key]);
      }
    return res.json({ success: true, history });
  } catch (error) {
    console.error("Hotel option history error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load update history." });
  }
}

module.exports = {
  importHotelOptions: [upload.single("file"), importHotelOptions],
  listHotelOptions,
  assignHotelOption,
  searchLinks,
  optionHistory,
  saveManualOption,
  deleteHotelOption,
};
