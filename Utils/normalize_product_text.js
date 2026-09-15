function normalizeProductText(value) {
  if (value === undefined || value === null || value === "") return null;

  return String(value)
    .trim()
    // Data lama kadang mengganti apostrophe dengan tanda tanya: hotel?s.
    .replace(/([A-Za-z])\?([A-Za-z])/g, "$1'$2")
    // Data lama kadang mengganti dash pada rentang waktu/angka dengan tanda tanya.
    .replace(/(\d)\s+\?\s+(?=\d)/g, "$1 - ")
    // Pulihkan pasangan tanda kutip yang berubah menjadi tanda tanya.
    .replace(/\?([^?\r\n]{1,160})\?/g, '"$1"');
}

function parseBooleanFlag(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return null;
}

module.exports = { normalizeProductText, parseBooleanFlag };
