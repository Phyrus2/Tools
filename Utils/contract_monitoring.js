const path = require("path");

const WITA_OFFSET_MS = 8 * 60 * 60 * 1000;
const GENERIC_FILE_WORDS = new Set([
  "contract", "contracts", "rate", "rates", "quote", "ticket", "signed",
  "unsigned", "draft", "update", "updated", "renewal", "agreement", "copy",
  "final", "new", "baru", "kontrak",
]);
const COMPANY_SUFFIXES = new Set(["pt", "cv", "ltd", "limited", "inc", "llc"]);

function normalizeName(value, options = {}) {
  const ignored = options.keepGeneric ? new Set() : GENERIC_FILE_WORDS;
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, " ")
    .replace(/[_\-./\\()[\]{}]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/^20\d{2}$/.test(word))
    .filter((word) => !ignored.has(word))
    .filter((word) => options.keepCompanySuffixes || !COMPANY_SUFFIXES.has(word))
    .join(" ")
    .trim();
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function tokenDice(left, right) {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

function similarity(leftValue, rightValue) {
  const left = normalizeName(leftValue);
  const right = normalizeName(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const editScore = 1 - levenshtein(left, right) / Math.max(left.length, right.length);
  const tokenScore = tokenDice(left, right);
  const containment = left.includes(right) || right.includes(left) ? 0.9 : 0;
  return Math.max(containment, (tokenScore * 0.6) + (Math.max(0, editScore) * 0.4));
}

function candidateScore(fileName, parentPath, candidateName, basis = "file") {
  const immediateParent = path.basename(String(parentPath || ""));
  if (basis === "parent") return similarity(immediateParent, candidateName);
  const fileScore = similarity(path.parse(String(fileName || "")).name, candidateName);
  const parentNames = String(parentPath || "").split(/[\\/]/).filter(Boolean).slice(-3);
  const folderScore = parentNames.reduce(
    (best, folderName) => Math.max(best, similarity(folderName, candidateName)),
    0,
  );
  return Math.min(1, (fileScore * 0.8) + (folderScore * 0.2));
}

function topRecommendations(fileName, parentPath, candidates, threshold = 0.42, limit = 5, basis = "file") {
  return candidates
    .map((candidate) => ({ ...candidate, score: candidateScore(fileName, parentPath, candidate.name, basis) }))
    .filter((candidate) => candidate.score >= threshold)
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit)
    .map((candidate) => ({ ...candidate, score: Number(candidate.score.toFixed(4)) }));
}

function detectSignedStatus(fileName) {
  const words = String(fileName || "")
    .normalize("NFKD")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.includes("draft")) return "DRAFT";
  if (words.includes("signed")) return "SIGNED";
  return "BELUM_SIGNED";
}

function parseWitaDateTime(value, label = "Tanggal dan waktu") {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ""));
  if (!match) throw new Error(`${label} harus berformat YYYY-MM-DDTHH:mm.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00"] = match;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const logical = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    logical.getUTCFullYear() !== year || logical.getUTCMonth() !== month - 1 ||
    logical.getUTCDate() !== day || logical.getUTCHours() !== hour ||
    logical.getUTCMinutes() !== minute || logical.getUTCSeconds() !== second
  ) throw new Error(`${label} tidak valid.`);
  return new Date(logical.getTime() - WITA_OFFSET_MS);
}

function toSqlUtc(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Waktu UTC tidak valid.");
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function parseSqlUtc(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const normalized = String(value).trim().replace(" ", "T");
  const parsed = new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function todayWita(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function contractStatus(validityEnd, now = new Date()) {
  return String(validityEnd) < todayWita(now) ? "EXPIRED" : "ACTIVE";
}

function normalizeWindowsPath(value) {
  return path.win32.normalize(String(value || "")).replace(/[\\/]+$/, "").toLowerCase();
}

function inferLocation(fullPath, rootPath, supplierName) {
  const relative = path.relative(rootPath, fullPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const folders = relative.split(path.sep).slice(0, -1).filter(Boolean);
  if (folders.length < 2) return null;
  let bestIndex = -1;
  let bestScore = 0;
  folders.forEach((folder, index) => {
    const score = similarity(folder, supplierName);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex > 0 && bestScore >= 0.42 ? folders[bestIndex - 1] : null;
}

function parseCategories(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

module.exports = {
  candidateScore,
  contractStatus,
  detectSignedStatus,
  inferLocation,
  normalizeName,
  normalizeWindowsPath,
  parseCategories,
  parseSqlUtc,
  parseWitaDateTime,
  similarity,
  todayWita,
  topRecommendations,
  toSqlUtc,
};
