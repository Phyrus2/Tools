const { parseCategories } = require("../../Utils/contract_monitoring");

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function textValue(value, label, { required = false, max = 1000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} wajib diisi.`);
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    if (required) throw new Error(`${label} wajib diisi.`);
    return null;
  }
  if (normalized.length > max) throw new Error(`${label} maksimal ${max} karakter.`);
  return normalized;
}

function dateValue(value, label, { required = false } = {}) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const normalized = textValue(value, label, { required, max: 10 });
  if (!normalized) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new Error(`${label} harus berformat YYYY-MM-DD.`);
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`${label} tidak valid.`);
  }
  return normalized;
}

function enumValue(value, allowed, label, { required = false } = {}) {
  const normalized = textValue(value, label, { required, max: 100 });
  if (!normalized) return null;
  const upper = normalized.toUpperCase();
  if (!allowed.includes(upper)) throw new Error(`${label} tidak valid.`);
  return upper;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  throw new Error("Nilai boolean tidak valid.");
}

function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

function badRequest(res, error) {
  return res.status(400).json({ success: false, message: error.message || "Data tidak valid." });
}

function isValidationError(error) {
  return /wajib|valid|format|maksimal|tidak boleh|harus|tidak ditemukan/i.test(error?.message || "");
}

function serializeSupplier(row) {
  return { ...row, category_supplier: parseCategories(row.category_supplier) };
}

module.exports = {
  badRequest,
  booleanValue,
  dateValue,
  enumValue,
  isValidationError,
  pagination,
  parseId,
  serializeSupplier,
  textValue,
};
