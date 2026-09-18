const pool = require("../../Database/connection");

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function nullableText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function requiredText(value, label) {
  const normalized = nullableText(value);
  if (!normalized) throw new Error(`${label} wajib diisi.`);
  return normalized;
}

function nullableInteger(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(normalized)) throw new Error(`${label} harus berupa angka bulat.`);
  return normalized;
}

function positiveInteger(value, label) {
  const normalized = nullableInteger(value, label);
  if (!normalized || normalized < 1) throw new Error(`${label} tidak valid.`);
  return normalized;
}

function nullableDecimal(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new Error(`${label} harus berupa angka.`);
  return normalized;
}

function nullableDate(value, label) {
  const normalized = nullableText(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`${label} harus berformat YYYY-MM-DD.`);
  return normalized;
}

function jsonValue(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object") {
    return JSON.stringify(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, nullableText(item)]),
    ));
  }
  try {
    return JSON.stringify(JSON.parse(String(value)));
  } catch {
    throw new Error(`${label} harus berupa JSON yang valid.`);
  }
}

function categoriesValue(value) {
  const categories = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  return JSON.stringify([...new Set(categories.map((item) => String(item).trim()).filter(Boolean))]);
}

function badRequest(res, error) {
  return res.status(400).json({ success: false, message: error.message || "Data tidak valid." });
}

async function updateSupplier(req, res) {
  const supplierId = parseId(req.params.supplierId);
  if (!supplierId) return res.status(400).json({ success: false, message: "Supplier ID tidak valid." });
  try {
    const status = requiredText(req.body.status, "Status");
    if (!["active", "inactive"].includes(status.toLowerCase())) throw new Error("Status supplier tidak valid.");
    const values = [
      requiredText(req.body.company_name, "Nama supplier"),
      nullableText(req.body.address),
      nullableText(req.body.town),
      nullableText(req.body.region),
      nullableText(req.body.location),
      categoriesValue(req.body.category_supplier),
      status,
      supplierId,
    ];
    const [result] = await pool.query(
      `UPDATE suppliers
          SET company_name = ?, address = ?, town = ?, region = ?, location = ?,
              category_supplier = ?, status = ?
        WHERE supplier_id = ?`,
      values,
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "Supplier tidak ditemukan." });
    const [rows] = await pool.query("SELECT * FROM suppliers WHERE supplier_id = ?", [supplierId]);
    const supplier = rows[0];
    if (typeof supplier.category_supplier === "string") supplier.category_supplier = JSON.parse(supplier.category_supplier || "[]");
    return res.json({ success: true, message: "Data supplier berhasil diperbarui.", supplier });
  } catch (error) {
    if (error.message?.includes("wajib") || error.message?.includes("valid")) return badRequest(res, error);
    console.error("Update supplier detail error:", error);
    return res.status(500).json({ success: false, message: "Gagal memperbarui data supplier." });
  }
}

async function updateProduct(req, res) {
  const productId = parseId(req.params.productId);
  if (!productId) return res.status(400).json({ success: false, message: "Product ID tidak valid." });
  try {
    const status = requiredText(req.body.status, "Status");
    if (!["regular product", "one time product"].includes(status.toLowerCase())) throw new Error("Status product tidak valid.");
    const values = [
      positiveInteger(req.body.supplier_id, "Supplier ID"),
      requiredText(req.body.name, "Nama product"),
      nullableText(req.body.type),
      status,
      nullableText(req.body.info),
      nullableText(req.body.not_on_offer),
      nullableText(req.body.services_included),
      nullableText(req.body.services_excluded),
      nullableText(req.body.instructions),
      nullableText(req.body.description),
      productId,
    ];
    const [result] = await pool.query(
      `UPDATE products
          SET supplier_id = ?, name = ?, type = ?, status = ?, info = ?, not_on_offer = ?,
              services_included = ?, services_excluded = ?, instructions = ?, description = ?
        WHERE product_id = ?`,
      values,
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "Product tidak ditemukan." });
    const [rows] = await pool.query(
      `SELECT p.*, s.company_name, s.location, s.town, s.region
         FROM products p JOIN suppliers s ON s.supplier_id = p.supplier_id
        WHERE p.product_id = ?`,
      [productId],
    );
    return res.json({ success: true, message: "Data product berhasil diperbarui.", product: rows[0] });
  } catch (error) {
    if (error.code === "ER_NO_REFERENCED_ROW_2") return res.status(400).json({ success: false, message: "Supplier ID tidak ditemukan." });
    if (error.message?.includes("wajib") || error.message?.includes("valid")) return badRequest(res, error);
    console.error("Update product detail error:", error);
    return res.status(500).json({ success: false, message: "Gagal memperbarui data product." });
  }
}

async function getBookedProduct(req, res) {
  const bookedProductId = parseId(req.params.bookedProductId);
  if (!bookedProductId) return res.status(400).json({ success: false, message: "Booked Product ID tidak valid." });
  try {
    const [rows] = await pool.query(
      `SELECT bp.*, s.company_name, p.name AS master_product_name
         FROM booked_products bp
         JOIN suppliers s ON s.supplier_id = bp.supplier_id
         JOIN products p ON p.product_id = bp.product_id
        WHERE bp.id = ?`,
      [bookedProductId],
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "Booked product tidak ditemukan." });
    return res.json({ success: true, bookedProduct: rows[0] });
  } catch (error) {
    console.error("Get booked product detail error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil detail booked product." });
  }
}

async function updateBookedProduct(req, res) {
  const bookedProductId = parseId(req.params.bookedProductId);
  if (!bookedProductId) return res.status(400).json({ success: false, message: "Booked Product ID tidak valid." });
  try {
    const durationUnit = nullableText(req.body.duration_unit);
    if (durationUnit && !["D", "N"].includes(durationUnit)) throw new Error("Duration unit harus D atau N.");
    const travelDate = nullableDate(req.body.travel_date, "Travel date");
    const endDate = nullableDate(req.body.end_date, "End date");
    if (travelDate && endDate && endDate < travelDate) throw new Error("End date tidak boleh lebih awal dari travel date.");
    const duration = nullableInteger(req.body.duration, "Duration");
    const quantity = nullableInteger(req.body.quantity, "Quantity");
    if (duration !== null && duration < 0) throw new Error("Duration tidak boleh negatif.");
    if (quantity !== null && quantity < 0) throw new Error("Quantity tidak boleh negatif.");
    const values = [
      requiredText(req.body.dossier_id, "Dossier ID"), nullableText(req.body.dossier_name),
      positiveInteger(req.body.supplier_id, "Supplier ID"), positiveInteger(req.body.product_id, "Product ID"),
      nullableText(req.body.product_name), nullableText(req.body.status), nullableText(req.body.code),
      duration, durationUnit,
      travelDate, endDate,
      nullableText(req.body.sales), nullableText(req.body.operational), quantity,
      nullableText(req.body.unit), nullableDecimal(req.body.price, "Price"), nullableText(req.body.description),
      nullableText(req.body.info), nullableText(req.body.instructions), jsonValue(req.body.transport_pickup, "Transport pickup"),
      jsonValue(req.body.transport_dropoff, "Transport dropoff"), bookedProductId,
    ];
    const [result] = await pool.query(
      `UPDATE booked_products SET
        dossier_id = ?, dossier_name = ?, supplier_id = ?, product_id = ?, product_name = ?, status = ?, code = ?,
        duration = ?, duration_unit = ?, travel_date = ?, end_date = ?, sales = ?, operational = ?, quantity = ?,
        unit = ?, price = ?, description = ?, info = ?, instructions = ?, transport_pickup = ?, transport_dropoff = ?
       WHERE id = ?`,
      values,
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "Booked product tidak ditemukan." });
    return getBookedProduct(req, res);
  } catch (error) {
    if (error.code === "ER_NO_REFERENCED_ROW_2") return res.status(400).json({ success: false, message: "Supplier ID atau Product ID tidak ditemukan." });
    if (/wajib|valid|harus|tidak boleh/i.test(error.message || "")) return badRequest(res, error);
    console.error("Update booked product detail error:", error);
    return res.status(500).json({ success: false, message: "Gagal memperbarui booked product." });
  }
}

module.exports = { updateSupplier, updateProduct, getBookedProduct, updateBookedProduct };
