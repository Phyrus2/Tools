// Reads a supplier Stop Sale file (Excel, PDF, EML, MSG) and returns a normalized
// snapshot: one entry per room per date that is closed (STOP_SALE) or ON_REQUEST.
// Comparing two snapshots is what tells us whether the stop sale actually changed;
// raw file/cell differences (prices, notes, formatting) are deliberately ignored.
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const MONTHS = [
  ["january", "januari", "jan"], ["february", "februari", "feb", "pebruari"],
  ["march", "maret", "mar"], ["april", "apr"], ["may", "mei"], ["june", "juni", "jun"],
  ["july", "juli", "jul"], ["august", "agustus", "aug", "agu", "agt", "ags"],
  ["september", "sept", "sep"], ["october", "oktober", "oct", "okt"],
  ["november", "nov", "nop"], ["december", "desember", "dec", "des"],
];
const MONTH_LOOKUP = new Map(MONTHS.flatMap((names, index) => names.map((name) => [name, index + 1])));
const MONTH_PATTERN = [...MONTH_LOOKUP.keys()].sort((a, b) => b.length - a.length).join("|");

const STOP_MARKS = new Set([
  "x", "xx", "×", "✕", "✖", "✗", "✘", "●", "■", "▪", "ss", "s/s", "s.s", "stop", "stop sale",
  "stopsale", "close", "closed", "cl", "cls", "full", "sold out", "soldout", "c", "tutup", "penuh",
]);
const REQUEST_MARKS = new Set(["or", "o/r", "o.r", "rq", "r/q", "req", "request", "on request", "onrequest"]);
const MAX_RANGE_DAYS = 400;
// Bump when detection rules change so stored previews are regenerated.
const EXTRACTOR_VERSION = 8;

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function fullYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year)) return null;
  return year < 100 ? 2000 + year : year;
}

function markStatus(text) {
  const value = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!value) return null;
  if (STOP_MARKS.has(value)) return "STOP_SALE";
  if (REQUEST_MARKS.has(value)) return "ON_REQUEST";
  return null;
}

// "Oct-26", "October 2026", "Okt 26", "10/2026", "2026-10" -> { year, month }
function parseMonthYear(text) {
  const value = String(text ?? "").toLowerCase();
  const named = new RegExp(`(?:^|[^a-z])(${MONTH_PATTERN})\\.?[a-z]*[\\s\\-/'.,]*(\\d{4}|\\d{2})(?!\\d)`).exec(value);
  if (named) return { month: MONTH_LOOKUP.get(named[1]), year: fullYear(named[2]) };
  const numeric = /^\s*(\d{1,2})[/-](\d{4})\s*$/.exec(value) || /^\s*(\d{4})[/-](\d{1,2})\s*$/.exec(value);
  if (!numeric) return null;
  const [first, second] = [Number(numeric[1]), Number(numeric[2])];
  const month = first > 12 ? second : first;
  const year = first > 12 ? first : second;
  return month >= 1 && month <= 12 ? { month, year } : null;
}

// Day header cell: "7", "07" or with its month: "1-Jan", "01-Okt", "1 -Dec".
function dayHeader(token) {
  const match = /^(\d{1,2})(?:\s*[-/.\s]\s*([a-z]{3,})\.?)?$/i.exec(String(token.text ?? "").trim());
  if (!match) return null;
  const day = Number(match[1]);
  if (day < 1 || day > 31) return null;
  const month = match[2] ? MONTH_LOOKUP.get(match[2].toLowerCase()) || MONTH_LOOKUP.get(match[2].toLowerCase().slice(0, 3)) : null;
  if (match[2] && !month) return null;
  return { day, month };
}

function dayNumber(token) {
  return dayHeader(token)?.day ?? null;
}

function cleanLabel(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function roomKey(room) {
  return cleanLabel(room).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Grid parsing. Every source (Excel sheet, PDF page, HTML table) is turned into
// rows of tokens with an x position, then a month header row (day numbers or
// dates) defines the columns and each following labelled row is a room.
// ---------------------------------------------------------------------------

function headerColumns(row) {
  // Dated header: the longest run of consecutive days. A month cell before it
  // ("Jan-23" stored as a date) is a label, not a day column.
  let run = [];
  let best = [];
  for (const token of row.filter((item) => item.date).sort((a, b) => a.x - b.x)) {
    const previous = run[run.length - 1];
    const next = previous && new Date(`${previous.date}T00:00:00Z`).getTime() + 86400000 === new Date(`${token.date}T00:00:00Z`).getTime();
    run = next ? [...run, token] : [token];
    if (run.length > best.length) best = run;
  }
  if (best.length >= 7) return { columns: best.map((token) => ({ x: token.x, day: Number(token.date.slice(8)), date: token.date })), explicit: true };
  const days = row.map((token) => ({ x: token.x, ...dayHeader(token) })).filter((token) => token.day);
  if (days.length < 7) return null;
  let increasing = 0;
  for (let index = 1; index < days.length; index += 1)
    if (days[index].day === days[index - 1].day + 1) increasing += 1;
  // Day headers count up 1,2,3... (with month resets); allotment/price rows do not.
  if (increasing < (days.length - 1) * 0.7) return null;
  return { columns: days, explicit: false };
}

function findMonthContext(rows, rowIndex, firstX) {
  // Month label in the same row, as text ("Oct-26") or a date cell formatted as month.
  const sameRow = rows[rowIndex].filter((token) => token.x < firstX)
    .map((token) => parseMonthYear(token.text) || (token.date ? { year: Number(token.date.slice(0, 4)), month: Number(token.date.slice(5, 7)) } : null))
    .filter(Boolean);
  if (sameRow.length) return sameRow[sameRow.length - 1];
  for (let index = rowIndex - 1; index >= Math.max(0, rowIndex - 4); index -= 1) {
    const candidates = rows[index]
      .map((token) => ({ token, parsed: parseMonthYear(token.text) || (token.date ? { year: Number(token.date.slice(0, 4)), month: Number(token.date.slice(5, 7)) } : null) }))
      .filter((candidate) => candidate.parsed);
    if (!candidates.length) {
      // PDFs often split "SEPTEMBER 2026 STOPSALE CALENDAR" into separate words.
      const joined = parseMonthYear(rows[index].map((token) => token.text || "").join(" ").replace(FULL_DATE, " "));
      if (joined) return joined;
      continue;
    }
    // Prefer the month label sitting closest to (or left of) the first day column.
    candidates.sort((a, b) => Math.abs(a.token.x - firstX) - Math.abs(b.token.x - firstX));
    return candidates[0].parsed;
  }
  return null;
}

function shiftMonth({ year, month }, delta) {
  const index = year * 12 + month - 1 + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

// Month labels printed beside the room rows ("Sep-26" down the left side), used when
// the day header has no month of its own. One header can serve several month blocks
// (the same rooms listed again for Oct, Nov, ...): a repeated room starts a new block.
// Returns rowIndex -> { year, month }.
function sideMonths(rows, headerIndex, firstX) {
  const segments = [];
  let segment = null;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (headerColumns(row)) break;
    const left = row.filter((token) => token.x < firstX);
    const label = left.map((token) => parseMonthYear(token.text)).find(Boolean);
    const room = roomKey(left.filter((token) => /[a-z]/i.test(token.text || "") && !parseMonthYear(token.text)).map((token) => token.text).join(" "));
    if (room && (!segment || segment.rooms.has(room))) segments.push(segment = { rooms: new Set(), rowIndexes: [], label: null });
    if (!segment) continue;
    if (room) segment.rooms.add(room);
    segment.rowIndexes.push(index);
    if (label && !segment.label) segment.label = label;
  }
  if (!segments.some((item) => item.label)) return null;
  // A block cut by a page break may lose its label: take it from the next/previous block.
  segments.forEach((item, index) => {
    if (item.label) return;
    const next = segments.slice(index + 1).findIndex((other) => other.label);
    if (next >= 0) item.label = shiftMonth(segments[index + 1 + next].label, -(next + 1));
  });
  segments.forEach((item, index) => {
    if (item.label) return;
    const previous = segments.slice(0, index).reverse().findIndex((other) => other.label);
    if (previous >= 0) item.label = shiftMonth(segments[index - 1 - previous].label, previous + 1);
  });
  const months = new Map();
  for (const item of segments) for (const index of item.rowIndexes) if (item.label) months.set(index, item.label);
  return months;
}

// Without a month context the columns keep only their day number; that is enough
// for "transposed" calendars where every row is a month (January ... December).
function resolveColumns(header, context) {
  if (header.explicit) return header.columns;
  if (context && header.columns.some((column) => column.month)) {
    let year = context.year;
    let previousMonth = 0;
    return header.columns
      .map((column) => {
        const month = column.month || previousMonth || context.month;
        if (month < previousMonth) year += 1;
        previousMonth = month;
        return { x: column.x, day: column.day, date: isoDate(year, month, column.day) };
      })
      .filter((column) => column.date);
  }
  if (!context) return header.columns.map((column) => ({ x: column.x, day: column.day, date: null }));
  let { year, month } = context;
  let previousDay = 0;
  const columns = [];
  for (const column of header.columns) {
    if (column.day < previousDay) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    previousDay = column.day;
    const date = isoDate(year, month, column.day);
    if (date) columns.push({ x: column.x, day: column.day, date });
  }
  return columns;
}

const FULL_DATE = new RegExp(`\\b\\d{1,2}[\\s/.-]+(?:\\d{1,2}|(?:${MONTH_PATTERN})[a-z]*)[\\s/.,-]+(?:19|20)?\\d{2}\\b`, "gi");

// Year of a calendar title ("STOP SALES REPORT ... 2027"), ignoring dated stamps
// such as "DATE 29 AUGUST 2026" that only say when the report was made.
function titleYear(rows, beforeIndex = rows.length) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const text = rows[index].map((token) => token.text || "").join(" ").replace(FULL_DATE, " ");
    const match = /\b(20\d{2})\b/.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
}

// Room name printed as a title above a transposed block ("STANDARD GARDEN ROOM").
function blockTitle(rows, headerIndex) {
  for (let index = headerIndex - 1; index >= Math.max(0, headerIndex - 3); index -= 1) {
    const text = cleanLabel(rows[index].map((token) => token.text || "").join(" "));
    if (!text || /\d/.test(text) || !/[a-z]{3,}/i.test(text)) continue;
    if (/^(?:month|bulan|date|room\s*type|note)\b/i.test(text) || legendStatus(text)) continue;
    return text;
  }
  return null;
}

function nearestColumn(columns, x, tolerance) {
  let best = null;
  for (const column of columns) {
    const distance = Math.abs(column.x - x);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { column, distance };
  }
  return best?.column || null;
}

function columnTolerance(columns, fallback) {
  const gaps = [];
  for (let index = 1; index < columns.length; index += 1) gaps.push(Math.abs(columns[index].x - columns[index - 1].x));
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : fallback * 2;
  return Math.max(median / 2, 0.01);
}

function hexChannels(hex) {
  return /^[0-9a-f]{6}$/i.test(hex || "") ? [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) : null;
}

function isLightColor(hex) {
  const rgb = hexChannels(hex);
  return !rgb || rgb.every((channel) => channel >= 0xf0);
}

function isRedColor(hex) {
  const rgb = hexChannels(hex);
  return Boolean(rgb) && rgb[0] >= 0xb0 && rgb[1] <= 0x70 && rgb[2] <= 0x70;
}

// Legend wording -> meaning. "Re Open" must be checked before "close".
function legendStatus(text) {
  const value = cleanLabel(text).toLowerCase();
  // A change legend names the state now: "Last Week: Open - This Week: Closed".
  const now = /\b(?:this\s+week|now|currently|becomes?)\s*[:=-]?\s*(re-?\s*open\w*|open\w*|clos\w*|stop\s*sales?|on\s*request)\b/.exec(value);
  if (now) return /open/.test(now[1]) ? "OPEN" : /request/.test(now[1]) ? "ON_REQUEST" : "STOP_SALE";
  if (/\b(?:can\s+be|to\s+be|upon|by|on)\s+request(?:ed)?\b/.test(value)) return "ON_REQUEST";
  if (/\b(?:fully\s+booked|close\s*out|sold\s*out)\b/.test(value) && !/\b(?:calendar|chart|report)\b/.test(value)) return "STOP_SALE";
  if (/^[=:]?\s*free\s*-?\s*sel[l]?s?\b/.test(value)) return "OPEN";
  if (!value || value.length > 40 || /\d{3,}/.test(value)) return null;
  if (/\b(calendar|kalender|update|report|inventory|availability|allotment)\b/.test(value)) return null;
  // "Not Available" / "Unavailable" / "No availability" are closures, not openings.
  if (/\b(not\s+avail\w*|unavail\w*|no\s+avail\w*|not\s+open)\b/.test(value)) return "STOP_SALE";
  if (/\b(re-?\s*open(?:ed)?|open(?:ed)?|available|free\s*sale|release[sd]?|lift(?:ed)?)\b/.test(value)) return "OPEN";
  if (/\b(on\s*request|request|o\/r)\b/.test(value)) return "ON_REQUEST";
  if (/\b(new\s*clos\w*|clos\w*|stop\s*(?:sales?|sell)|full|sold\s*out|blocked?|tutup|penuh)\b/.test(value)) return "STOP_SALE";
  return null;
}

// Collect "<colour swatch> Label" pairs such as "[red] New Close", "[green] Closed".
function findLegend(rows, swatchAt) {
  const legend = new Map();
  // Text legends such as "C : CLOSED", "R : ON REQUEST", "O : OPEN" map cell codes.
  for (const row of rows) {
    const joined = cleanLabel(row.map((token) => token.text).join(" "));
    const match = /^([a-z/]{1,3})\s*[:=]\s*([a-z][a-z /]*)$/i.exec(joined)
      || (row.length === 2 && /^[a-z/]{1,3}$/i.test(String(row[0].text).trim()) ? /^([a-z/]{1,3})\s+([a-z][a-z /]*)$/i.exec(joined) : null)
      || (row.length >= 2 && row.length <= 6 && /^[a-z]$/i.test(String(row[0].text).trim()) && !headerColumns(row)
        ? /^([a-z])\s+[=:]?\s*(.+)$/i.exec(joined) : null);
    const status = match && legendStatus(match[2]);
    if (status && !legend.has(`code:${match[1].toLowerCase()}`)) legend.set(`code:${match[1].toLowerCase()}`, status);
  }
  if (!swatchAt) return legend;
  rows.forEach((row, rowIndex) => {
    if (row.length > 6 || headerColumns(row) || !row.length) return;
    // Whole row first ("X = Not Available", "x New Close"), so a lone "Available"
    // inside "Not Available" cannot claim the swatch colour as open.
    const label = cleanLabel(row.map((token) => token.text).join(" ")).replace(/^[a-z/]{1,3}\s*[:=]\s*/i, "")
      .replace(row.length >= 2 && /^[a-z]$/i.test(String(row[0].text).trim()) ? /^[a-z]\s+/i : /^$/, "");
    const rowStatus = legendStatus(label);
    if (rowStatus) {
      const color = swatchAt(rowIndex, row[0]);
      if (color && !isLightColor(color) && !legend.has(color)) legend.set(color, rowStatus);
    }
    for (const token of row) {
      const status = legendStatus(token.text);
      if (!status) continue;
      const color = swatchAt(rowIndex, token);
      if (color && !isLightColor(color) && !legend.has(color)) legend.set(color, status);
    }
  });
  return legend;
}

function isLegendLabel(text) {
  const value = cleanLabel(text);
  // "= AVAILABLE", ": CLOSED", "O = REOPEN", "C : CLOSED", "FS : FREE SALE"
  return /^[=:]/.test(value) || /^[a-z/]{1,3}\s*[:=]\s*\S/i.test(value);
}

// CIE Lab: distances follow what the eye sees, so a pale yellow cell (ffd966) stays
// closer to its yellow swatch (ffc000) than to a pale green one (c6e0b4).
function labColor(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value > 0.04045 ? ((value + 0.055) / 1.055) ** 2.4 : value / 12.92;
  });
  const f = (value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// Exact legend colour, or the closest one when the cell is only a shade off
// (legend swatch ff3333 vs cell ff0000, ffc000 vs ffd966, JPEG noise in screenshots).
function legendColorStatus(color, legend) {
  if (!color) return null;
  if (legend.has(color)) return legend.get(color);
  const rgb = hexChannels(color);
  if (!rgb) return null;
  const lab = labColor(rgb);
  let best = null;
  for (const [key, status] of legend) {
    const other = hexChannels(key);
    if (!other) continue;
    const otherLab = labColor(other);
    const distance = Math.hypot(lab[0] - otherLab[0], lab[1] - otherLab[1], lab[2] - otherLab[2]);
    if (distance <= 35 && (!best || distance < best.distance)) best = { status, distance };
  }
  return best?.status || null;
}

function cellStatus({ color, mark, legend }) {
  const fromLegend = legendColorStatus(color, legend);
  if (fromLegend) return fromLegend === "OPEN" ? null : fromLegend;
  if (mark) return mark;
  // Without a colour legend only an obviously red cell is treated as closed.
  const hasColorLegend = [...legend.keys()].some((key) => !key.startsWith("code:"));
  return !hasColorLegend && isRedColor(color) ? "STOP_SALE" : null;
}

function parseGrid(rows, { source, tolerance: fixedTolerance, colorAt, legend = new Map(), yearHint = null } = {}) {
  const entries = [];
  const warnings = [];
  let blocks = 0;
  let current = null;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row.length) continue;
    let header = headerColumns(row);
    if (header) {
      const firstX = Math.min(...header.columns.map((column) => column.x));
      const context = findMonthContext(rows, rowIndex, firstX);
      // Header rows copied from an older month keep their old dates and only show the
      // day number; the month label beside them ("Nov-26") is what the reader sees.
      const label = row.some((token) => token.x < firstX && (token.date || parseMonthYear(token.text))) ? context : null;
      if (header.explicit && label && header.columns[0].date.slice(0, 7) !== `${label.year}-${pad(label.month)}`)
        header = { columns: header.columns.map((column) => ({ x: column.x, day: column.day })), explicit: false };
      const columns = resolveColumns(header, context);
      if (!columns?.length) {
        current = null;
        continue;
      }
      const rowMonths = !context && !header.explicit
        ? sideMonths(rows, rowIndex, firstX) : null;
      const tolerance = fixedTolerance ?? columnTolerance(columns, 1);
      current = {
        columns,
        tolerance,
        firstX: Math.min(...columns.map((column) => column.x)),
        title: blockTitle(rows, rowIndex),
        year: titleYear(rows, rowIndex) || yearHint,
        header,
        rowMonths,
        used: false,
      };
      blocks += 1;
      continue;
    }
    if (!current) continue;
    const gridStart = current.firstX - current.tolerance;
    const labelTokens = row.filter((token) => token.x < gridStart && /[a-z]/i.test(token.text || "") && !parseMonthYear(token.text));
    let room = cleanLabel(labelTokens.map((token) => token.text).join(" "));
    // Transposed calendar: the row label is a month and the room is the block title.
    const rowMonth = monthName(room);
    let rowColumns = current.columns;
    if (rowMonth && !/\d/.test(room)) {
      if (!current.year) {
        if (!current.warned) warnings.push(`${source}: tahun untuk kalender per bulan tidak terbaca.`);
        current.warned = true;
        continue;
      }
      room = current.title || "All rooms";
      rowColumns = current.columns.map((column) => ({ ...column, date: isoDate(current.year, rowMonth, column.day) }));
    } else if (current.rowMonths?.has(rowIndex)) {
      rowColumns = resolveColumns(current.header, current.rowMonths.get(rowIndex));
    }
    rowColumns = rowColumns.filter((column) => column.date);
    if (!rowColumns.length) {
      if (!current.warned && row.some((token) => token.x >= gridStart)) warnings.push(`${source}: header tanggal ditemukan tetapi bulan/tahun tidak terbaca.`);
      current.warned = true;
      continue;
    }
    // Legend rows ("x New Close", "O = REOPEN", "= AVAILABLE") sit inside/under month blocks; they are not rooms.
    if (!room && row.some((token) => token.x >= gridStart && legendStatus(token.text))) continue;
    // Legend line inside the block ("CUT OFF DATE | X = STOP SELL | X = NEW STOP SELL DATE").
    if (row.some((token) => token.x >= gridStart && isLegendLabel(token.text) && legendStatus(String(token.text).replace(/^[^=:]*[=:]/, "")))) continue;
    if (isLegendLabel(room)) continue;
    const markByDate = new Map();
    for (const token of row) {
      if (token.x < gridStart) continue;
      const code = legend.get(`code:${cleanLabel(token.text).toLowerCase()}`);
      const status = code ? (code === "OPEN" ? null : code) : token.mark || markStatus(token.text);
      const column = status && nearestColumn(rowColumns, token.x, current.tolerance);
      if (column) markByDate.set(column.date, { status, ref: token.ref });
    }
    const marks = [];
    for (const column of rowColumns) {
      const mark = markByDate.get(column.date);
      const color = colorAt ? colorAt(rowIndex, column.x) : null;
      const status = cellStatus({ color, mark: mark?.status, legend });
      if (status) marks.push({ date: column.date, status, ref: mark?.ref || source });
    }
    if (!marks.length) continue;
    // A row holding only a side label ("Oct-26" between two room rows) has no cells of its own.
    if (!room && row.every((token) => token.x < gridStart)) continue;
    if (!room) {
      warnings.push(`${source}: ${marks.length} tanda stop sale tanpa nama kamar diabaikan.`);
      continue;
    }
    for (const mark of marks) entries.push({ room, date: mark.date, status: mark.status, source: mark.ref });
  }
  return { entries, warnings, blocks };
}

// ---------------------------------------------------------------------------
// Month-column lists: one column per month, cells list the closed days, e.g.
//   ROOM TYPE | September | October    | ...
//   Deluxe    | 8,17,18   | 9,13,15-16 | ...
// The year comes from a year cell above the months and rolls over at January.
// ---------------------------------------------------------------------------


function monthName(text) {
  const value = String(text ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return value.length >= 3 ? MONTH_LOOKUP.get(value) || null : null;
}

function dayList(text) {
  const value = String(text ?? "").trim();
  // Only digits, separators and ranges: "8,17,18", "1-5, 9", "27 & 28".
  if (!value || !/^[\d\s,;/&+.\-–]+$/.test(value) || !/\d/.test(value)) return [];
  const days = new Set();
  for (const part of value.split(/[,;/&+]|\s{2,}/)) {
    const range = /^\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\s*$/.exec(part);
    if (range) {
      for (let day = Number(range[1]); day <= Math.min(31, Number(range[2])); day += 1) days.add(day);
      continue;
    }
    for (const match of part.matchAll(/\d{1,2}/g)) if (Number(match[0]) >= 1 && Number(match[0]) <= 31) days.add(Number(match[0]));
  }
  return [...days];
}

function parseMonthColumns(rows, { source, reference = new Date() } = {}) {
  const entries = [];
  let blocks = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const monthCells = rows[rowIndex].map((token) => ({ x: token.x, month: monthName(token.text) })).filter((cell) => cell.month);
    if (monthCells.length < 3) continue;
    let year = null;
    for (let index = rowIndex; index >= Math.max(0, rowIndex - 3) && !year; index -= 1) {
      const yearToken = rows[index].find((token) => /^(?:19|20)\d{2}$/.test(String(token.text).trim()));
      if (yearToken) year = Number(yearToken.text);
    }
    if (!year) year = monthCells[0].month < reference.getUTCMonth() + 1 - 3 ? reference.getUTCFullYear() + 1 : reference.getUTCFullYear();
    let previousMonth = 0;
    const columns = monthCells.map((cell) => {
      if (cell.month < previousMonth) year += 1;
      previousMonth = cell.month;
      return { x: cell.x, month: cell.month, year };
    });
    const firstX = Math.min(...columns.map((column) => column.x));
    blocks += 1;
    for (let index = rowIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.filter((token) => monthName(token.text)).length >= 3) break;
      const room = cleanLabel(row.filter((token) => token.x < firstX && /[a-z]/i.test(token.text || "")).map((token) => token.text).join(" "));
      if (!room || isLegendLabel(room) || /^note\b/i.test(room)) continue;
      for (const token of row) {
        const column = columns.find((candidate) => Math.abs(candidate.x - token.x) < 0.5);
        if (!column) continue;
        const status = /request|\bo\/?r\b/i.test(token.text) ? "ON_REQUEST" : "STOP_SALE";
        for (const day of dayList(String(token.text).replace(/request|\bo\/?r\b/gi, ""))) {
          const date = isoDate(column.year, column.month, day);
          if (date) entries.push({ room, date, status, source: token.ref || source });
        }
      }
    }
  }
  return { entries, warnings: [], blocks };
}

// ---------------------------------------------------------------------------
// Date rows: one row per date, one column per room, e.g.
//   Date      | Deluxe Room | Suite Garden (One bedroom) | ...
//   01-Sep-26 | X           | O                          | ...
// ---------------------------------------------------------------------------


function rowDate(token) {
  if (token.date) return token.date;
  const text = String(token.text || "").trim();
  const iso = /^(20\d{2})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const named = new RegExp(`^(\\d{1,2})[\\s/.-]+(${MONTH_PATTERN})[a-z]*\\.?[\\s/.,-]+(\\d{2}|\\d{4})$`, "i").exec(text);
  if (named) return isoDate(fullYear(named[3]), MONTH_LOOKUP.get(named[2].toLowerCase()), Number(named[1]));
  const numeric = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/.exec(text);
  return numeric ? isoDate(fullYear(numeric[3]), Number(numeric[2]), Number(numeric[1])) : null;
}

// ---------------------------------------------------------------------------
// Day rows: one row per day of the month, one column per month x room code.
//   MONTHS | Jan'27          | Feb'27          | ...
//   TYPE   | DBF | DSV | DGV | DBF | DSV | DGV | ...
//   1      |  x  |  x  |     |     |  x  |     | ...
// Room codes are spelled out when a legend row pairs them ("DELUXE SEA VIEW ROOM ... DSV").
// ---------------------------------------------------------------------------

function roomCodeNames(rows) {
  const names = new Map();
  for (const row of rows) {
    row.forEach((code, index) => {
      const long = row[index + 1];
      if (long && long.x - code.x <= 3 && /^[A-Z]{2,4}$/.test(String(code.text).trim()) && /^[a-z][a-z ]{6,}$/i.test(cleanLabel(long.text)))
        names.set(String(code.text).trim().toUpperCase(), cleanLabel(long.text));
    });
  }
  return names;
}

function parseDayRows(rows, { source, colorAt, legend = new Map() } = {}) {
  const entries = [];
  let blocks = 0;
  const codeNames = roomCodeNames(rows);
  for (let rowIndex = 0; rowIndex + 2 < rows.length; rowIndex += 1) {
    const months = rows[rowIndex].map((token) => ({ x: token.x, parsed: parseMonthYear(token.text) }))
      .filter((item) => item.parsed?.year);
    if (months.length < 3) continue;
    const codeRow = rows[rowIndex + 1];
    // Day label columns: the cell holding "1" right under the code row.
    const dayColumns = rows[rowIndex + 2].filter((token) => String(token.text).trim() === "1").map((token) => token.x);
    if (!dayColumns.length) continue;
    const columns = [];
    for (const token of codeRow) {
      const code = cleanLabel(token.text);
      if (!/^[a-z]{2,6}$/i.test(code) || dayColumns.includes(token.x)) continue;
      const dayColumn = Math.max(...dayColumns.filter((x) => x < token.x));
      if (!Number.isFinite(dayColumn)) continue;
      // The month whose (merged) label starts at or before this column, in the same table.
      const month = months.filter((item) => item.x <= token.x && item.x > dayColumn).sort((a, b) => b.x - a.x)[0];
      if (!month) continue;
      columns.push({ x: token.x, dayColumn, room: codeNames.get(code.toUpperCase()) || code.toUpperCase(), ...month.parsed });
    }
    // Old tables kept beside the current one (2024-25 next to 2027) are history.
    const latestYear = Math.max(...columns.map((column) => column.year));
    const tableYear = new Map();
    for (const column of columns) tableYear.set(column.dayColumn, Math.max(tableYear.get(column.dayColumn) || 0, column.year));
    columns.splice(0, columns.length, ...columns.filter((column) => tableYear.get(column.dayColumn) >= latestYear - 1));
    if (!columns.length) continue;
    blocks += 1;
    // Day = position below the header (labels sometimes repeat a number by mistake).
    for (let offset = 0; offset < 31 && rowIndex + 2 + offset < rows.length; offset += 1) {
      const index = rowIndex + 2 + offset;
      const row = rows[index];
      if (!row.some((token) => dayColumns.includes(token.x) && /^\d{1,2}$/.test(String(token.text).trim()))) break;
      for (const column of columns) {
        const date = isoDate(column.year, column.month, offset + 1);
        if (!date) continue;
        const token = row.find((item) => item.x === column.x);
        const status = cellStatus({ color: colorAt?.(index, column.x), mark: token?.mark || markStatus(token?.text), legend });
        if (status) entries.push({ room: column.room, date, status, source: token?.ref || source });
      }
    }
    rowIndex += 2;
  }
  return { entries, warnings: [], blocks };
}

function parseDateRows(rows, { source, colorAt, legend = new Map() } = {}) {
  const entries = [];
  // The date column is the column holding the most dates.
  const dateCounts = new Map();
  for (const row of rows) for (const token of row) if (rowDate(token)) dateCounts.set(token.x, (dateCounts.get(token.x) || 0) + 1);
  const [dateX, count] = [...dateCounts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (dateX === undefined || count < 7) return { entries, warnings: [], blocks: 0 };
  const firstDateRow = rows.findIndex((row) => row.some((token) => token.x === dateX && rowDate(token)));
  // Room names: the header rows just above the first date (two-row headers are joined).
  const headerRows = [];
  // Header rows directly above the dates are joined ("Suite" + "One bedroom"),
  // stopping at a blank row or a legend line such as "X | Room not available".
  for (let index = firstDateRow - 1; index >= 0 && headerRows.length < 3; index -= 1) {
    const row = rows[index];
    const texts = row.filter((token) => token.x !== dateX && /[a-z]/i.test(token.text || ""));
    const legendLine = row.length <= 2 && /^[a-z/]{1,3}$/i.test(String(row[0]?.text || "").trim());
    if (!texts.length || legendLine) {
      if (headerRows.length) break;
      continue;
    }
    headerRows.unshift(row);
  }
  if (!headerRows.some((row) => row.filter((token) => token.x !== dateX && /[a-z]/i.test(token.text || "")).length >= 2))
    return { entries, warnings: [], blocks: 0 };
  if (!headerRows.length) return { entries, warnings: [], blocks: 0 };
  const rooms = new Map();
  for (const row of headerRows)
    for (const token of row) {
      if (token.x === dateX || !/[a-z0-9]/i.test(token.text || "")) continue;
      rooms.set(token.x, cleanLabel(`${rooms.get(token.x) || ""} ${token.text}`));
    }
  for (let rowIndex = firstDateRow; rowIndex < rows.length; rowIndex += 1) {
    const dateToken = rows[rowIndex].find((token) => token.x === dateX);
    const date = dateToken && rowDate(dateToken);
    if (!date) continue;
    for (const [x, room] of rooms) {
      const token = rows[rowIndex].find((candidate) => candidate.x === x);
      const code = token && legend.get(`code:${cleanLabel(token.text).toLowerCase()}`);
      const mark = code ? (code === "OPEN" ? null : code) : token && markStatus(token.text);
      const status = code === "OPEN" ? null : cellStatus({ color: colorAt ? colorAt(rowIndex, x) : null, mark, legend });
      if (status) entries.push({ room, date, status, source: token?.ref || source });
    }
  }
  return { entries, warnings: [], blocks: entries.length || rooms.size ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// Free-text parsing (email bodies, PDFs without a calendar grid). Only lines that
// mention a stop-sale keyword are considered, to avoid picking up e-mail dates.
// ---------------------------------------------------------------------------

const RANGE_SEPARATOR = "\\s*(?:-|–|—|to|till|until|sampai|s\\.?/?d\\.?)\\s*";
const KEYWORD = /stop\s*-?\s*sal|\bclos(?:e|ed|ing)\b|\bfull\b|sold\s*out|on\s*request|\bs\/s\b|tutup|penuh/i;
const REOPEN = /\b(re-?open|open(?:ed)?\s+(?:for\s+)?sal|release[sd]?|lift(?:ed)?|cancel(?:l?ed)?\s+stop)\b/i;

function inferYear(month, day, explicit, reference) {
  if (explicit) return fullYear(explicit);
  const year = reference.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  // Dates more than two months in the past most likely refer to next year.
  return candidate < reference.getTime() - 60 * 86400000 ? year + 1 : year;
}

function textRanges(line, reference) {
  const text = line.toLowerCase();
  const ranges = [];
  const month = `(${MONTH_PATTERN})\\.?[a-z]*`;
  const year = "(?:[\\s,'-]*(\\d{4}|\\d{2}(?!\\d)))?";
  const patterns = [
    // 12 Oct 2026 - 15 Nov 2026
    [new RegExp(`(\\d{1,2})\\s*${month}${year}${RANGE_SEPARATOR}(\\d{1,2})\\s*${month}${year}`, "g"),
      (m) => [[m[1], m[2], m[3]], [m[4], m[5], m[6]]]],
    // 12 - 15 Oct 2026
    [new RegExp(`(\\d{1,2})${RANGE_SEPARATOR}(\\d{1,2})\\s*${month}${year}`, "g"),
      (m) => [[m[1], m[3], m[4]], [m[2], m[3], m[4]]]],
    // Oct 12 - Nov 15, 2026
    [new RegExp(`${month}\\s*(\\d{1,2})(?:st|nd|rd|th)?${RANGE_SEPARATOR}${month}\\s*(\\d{1,2})(?:st|nd|rd|th)?,?${year}`, "g"),
      (m) => [[m[2], m[1], m[5]], [m[4], m[3], m[5]]]],
    // Oct 12 - 15, 2026
    [new RegExp(`${month}\\s*(\\d{1,2})(?:st|nd|rd|th)?${RANGE_SEPARATOR}(\\d{1,2})(?:st|nd|rd|th)?,?${year}`, "g"),
      (m) => [[m[2], m[1], m[4]], [m[3], m[1], m[4]]]],
    // 12/10/2026 - 15/10/2026 (day first)
    [new RegExp(`(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4}|\\d{2})${RANGE_SEPARATOR}(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4}|\\d{2})`, "g"),
      (m) => [[m[1], Number(m[2]), m[3]], [m[4], Number(m[5]), m[6]]]],
    // 20 & 21 August 2027, 5, 9 and 12 Oct (separate days, not a range)
    [new RegExp(`(?<!\\d)((?:\\d{1,2}(?:st|nd|rd|th)?\\s*(?:,|&|\\band\\b|\\+)\\s*)+)(\\d{1,2})(?:st|nd|rd|th)?\\s*${month}${year}`, "g"),
      (m) => [...m[1].matchAll(/\d{1,2}/g)].map((day) => [day[0], m[3], m[4]]).concat([[m[2], m[3], m[4]]]), "list"],
    // single dates
    [new RegExp(`(\\d{1,2})\\s*${month}${year}`, "g"), (m) => [[m[1], m[2], m[3]]]],
    [new RegExp(`${month}\\s*(\\d{1,2})(?:st|nd|rd|th)?,?${year}`, "g"), (m) => [[m[2], m[1], m[3]]]],
    [/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/g, (m) => [[m[1], Number(m[2]), m[3]]]],
  ];
  const used = [];
  for (const [pattern, pick, kind] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (used.some(([a, b]) => start < b && end > a)) continue;
      const points = pick(match).map(([day, monthValue, yearValue]) => {
        const monthNumber = typeof monthValue === "number" ? monthValue : MONTH_LOOKUP.get(monthValue);
        const dayValue = Number(day);
        if (!monthNumber || monthNumber > 12) return null;
        return isoDate(inferYear(monthNumber, dayValue, yearValue, reference), monthNumber, dayValue);
      });
      if (points.some((point) => !point)) continue;
      if (kind === "list") {
        used.push([start, end]);
        for (const point of points) ranges.push({ from: point, to: point, start, end });
        continue;
      }
      const [from, to = points[0]] = points;
      if (to < from) continue;
      used.push([start, end]);
      ranges.push({ from, to, start, end });
    }
  }
  return ranges;
}

function roomFromLine(line, ranges) {
  if ((line.match(/\|/g) || []).length >= 2) return ["All rooms"];
  let text = line;
  for (const range of [...ranges].sort((a, b) => b.start - a.start)) text = text.slice(0, range.start) + " " + text.slice(range.end);
  text = text
    .replace(/stop\s*-?\s*sales?|on\s*request|sold\s*out|\b(?:please|pls|kindly|mohon|note|closed?|full|tutup|penuh|for|from|on|period|date[s]?|tanggal|tgl|untuk|kamar|room\s*type|rooms?\s*:)\b/gi, " ")
    .replace(/[:;|*•\-–—()[\],]+/g, " ");
  const label = cleanLabel(text);
  if (!/[a-z]{3,}/i.test(label) || label.length > 80 || /\ball\s+(?:room|categor|type|unit|villa)/i.test(label)) return ["All rooms"];
  // "classic room & singaraja room" -> two rooms.
  const rooms = label.split(/\s*(?:&|\band\b|\/|\+)\s*/i).map(cleanLabel).filter((room) => /[a-z]{3,}/i.test(room));
  return rooms.length ? rooms : ["All rooms"];
}

function* eachDate(from, to) {
  let cursor = new Date(`${from}T00:00:00Z`);
  const finish = new Date(`${to}T00:00:00Z`);
  for (let guard = 0; cursor <= finish && guard < MAX_RANGE_DAYS; guard += 1) {
    yield cursor.toISOString().slice(0, 10);
    cursor = new Date(cursor.getTime() + 86400000);
  }
}

function parseText(text, { source, reference = new Date() } = {}) {
  const entries = [];
  const warnings = [];
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim());
  let heading = "";
  for (const line of lines) {
    if (!line) continue;
    if (/^(?:from|to|cc|sent|date|subject|dari|kepada|tanggal kirim)\s*:/i.test(line)) continue;
    if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4},?\s+\d{1,2}[:.]\d{2}\b/.test(line) && !/[a-z]{4,}/i.test(line.replace(/\b\d+\s+of\s+\d+\b/gi, ""))) continue;
    const ranges = textRanges(line, reference);
    if (!ranges.length) {
      if (KEYWORD.test(line) || REOPEN.test(line)) heading = line;
      continue;
    }
    const context = `${heading} ${line}`;
    if (REOPEN.test(line) || (!KEYWORD.test(line) && REOPEN.test(heading))) {
      warnings.push(`${source}: baris pembukaan kembali dilewati, cek manual: "${line.slice(0, 120)}"`);
      continue;
    }
    if (!KEYWORD.test(context)) continue;
    const status = /on\s*request/i.test(context) ? "ON_REQUEST" : "STOP_SALE";
    for (const room of roomFromLine(line, ranges))
      for (const range of ranges)
        for (const date of eachDate(range.from, range.to)) entries.push({ room, date, status, source });
  }
  return { entries, warnings };
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

function excelFillColor(cell) {
  const fill = cell?.s;
  if (!fill || !fill.patternType || fill.patternType === "none") return null;
  const rgb = String(fill.fgColor?.rgb || "").slice(-6).toLowerCase();
  return /^[0-9a-f]{6}$/.test(rgb) ? rgb : null;
}

function excelCellDate(cell) {
  if (!cell) return null;
  if (cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) {
    // xlsx builds dates at local midnight (sometimes a few seconds early, e.g.
    // 23:59:24 the day before); round to the nearest local day.
    const shifted = new Date(cell.v.getTime() + 12 * 3600000);
    return isoDate(shifted.getFullYear(), shifted.getMonth() + 1, shifted.getDate());
  }
  if (cell.t === "n" && cell.z && XLSX.SSF.is_date(cell.z)) {
    const parsed = XLSX.SSF.parse_date_code(cell.v);
    if (parsed) return isoDate(parsed.y, parsed.m, parsed.d);
  }
  return null;
}

function excelSheetRows(sheet, sheetName) {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const mergedText = new Map();
  for (const merge of sheet["!merges"] || []) {
    const top = sheet[XLSX.utils.encode_cell(merge.s)];
    const value = top?.w ?? top?.v;
    if (value === undefined || value instanceof Date || !/[a-z]/i.test(String(value))) continue;
    // Only labels merged downwards (one room label over several rows) are copied;
    // a sentence merged across columns stays a single cell.
    for (let r = merge.s.r + 1; r <= merge.e.r; r += 1) mergedText.set(`${r}:${merge.s.c}`, String(value));
  }
  const rows = [];
  const colors = new Map();
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 5000); r += 1) {
    const row = [];
    const rowIndex = rows.length;
    for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 800); c += 1) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address];
      const color = excelFillColor(cell);
      if (color) colors.set(`${rowIndex}:${c}`, color);
      const date = excelCellDate(cell);
      const text = date ? "" : cell ? String(cell.w ?? cell.v ?? "").trim() : mergedText.get(`${r}:${c}`) || "";
      if (!text && !date) continue;
      row.push({ x: c, text, date, ref: `${sheetName}!${address}` });
    }
    rows.push(row);
  }
  const colorAt = (rowIndex, x) => colors.get(`${rowIndex}:${Math.round(x)}`) || null;
  const swatchAt = cellSwatch(colors, colorAt);
  return { rows, colorAt, swatchAt };
}

// Swatch is the coloured cell left of the label, or the label cell itself, but only
// when that colour is a small patch in the row (a banner/title fill is not a legend).
function cellSwatch(colors, colorAt) {
  return (rowIndex, token) => {
    // Left of the label (a narrow spacer column may sit in between), or the label cell.
    let color = colorAt(rowIndex, token.x - 1) || colorAt(rowIndex, token.x - 2) || colorAt(rowIndex, token.x);
    if (!color) {
      // Swatch far from its label: the only colour used in that row.
      const rowColors = new Set([...colors].filter(([key, value]) => key.startsWith(`${rowIndex}:`) && !isLightColor(value)).map(([, value]) => value));
      if (rowColors.size === 1) [color] = rowColors;
    }
    if (!color) return null;
    let sameColor = 0;
    for (const [key, value] of colors) if (value === color && key.startsWith(`${rowIndex}:`)) sameColor += 1;
    return sameColor <= 3 ? color : null;
  };
}

function extractExcel(buffer, name) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellStyles: true, sheetStubs: true });
  const sheets = workbook.SheetNames
    .filter((sheetName) => workbook.Sheets[sheetName]["!ref"])
    .map((sheetName) => ({ sheetName, ...excelSheetRows(workbook.Sheets[sheetName], sheetName) }));
  const legend = new Map();
  for (const sheet of sheets)
    for (const [color, status] of findLegend(sheet.rows, sheet.swatchAt)) if (!legend.has(color)) legend.set(color, status);
  const result = { entries: [], warnings: [], blocks: 0 };
  for (const sheet of sheets) {
    const source = `${name} / ${sheet.sheetName}`;
    merge(result, parseGrid(sheet.rows, { source, tolerance: 0.5, colorAt: sheet.colorAt, legend, yearHint: titleYear(sheet.rows) }));
  }
  if (!result.blocks)
    for (const sheet of sheets)
      merge(result, parseDayRows(sheet.rows, { source: `${name} / ${sheet.sheetName}`, colorAt: sheet.colorAt, legend }));
  if (!result.blocks)
    for (const sheet of sheets) merge(result, parseMonthColumns(sheet.rows, { source: `${name} / ${sheet.sheetName}` }));
  if (!result.blocks)
    for (const sheet of sheets)
      merge(result, parseDateRows(sheet.rows, { source: `${name} / ${sheet.sheetName}`, colorAt: sheet.colorAt, legend }));
  if (!result.blocks) {
    for (const sheet of sheets) {
      const text = sheet.rows.map((row) => row.map((token) => token.text || token.date).join(" ")).join("\n");
      merge(result, parseText(text, { source: `${name} / ${sheet.sheetName}` }));
    }
  }
  return { ...result, legend: Object.fromEntries(legend) };
}

// ---------------------------------------------------------------------------
// PDF (text based; scanned PDFs have no text layer and need manual review).
// Supplier calendars exported from Excel encode the status in the cell colour
// and often contain "x" text that is painted over by later cell fills, so the
// page is evaluated the way it is rendered, not just by its text layer.
// ---------------------------------------------------------------------------

let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ||= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

function multiplyMatrix(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function transformBox(m, box) {
  const points = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]]
    .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function intersectBox(a, b) {
  if (!a) return a === null ? null : b;
  if (!b) return b === null ? null : a;
  const box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return box[2] > box[0] && box[3] > box[1] ? box : null;
}

function colorHex(args) {
  if (typeof args?.[0] === "string") return args[0].replace("#", "").toLowerCase();
  const values = Array.from(args || []).slice(0, 3);
  if (values.length !== 3) return null;
  const scale = values.every((value) => value <= 1) && values.some((value) => value % 1 !== 0) ? 255 : 1;
  return values.map((value) => Math.round(value * scale).toString(16).padStart(2, "0")).join("");
}

async function pdfPaintModel(page, OPS) {
  const operators = await page.getOperatorList();
  const fillOps = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const fills = [];
  const texts = [];
  const stack = [];
  // clip: undefined = no clipping, null = everything clipped away.
  let state = { ctm: [1, 0, 0, 1, 0, 0], clip: undefined, fill: "000000" };
  let path = null;
  let textMatrix = [1, 0, 0, 1, 0, 0];
  let lineMatrix = textMatrix;
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const op = operators.fnArray[index];
    const args = operators.argsArray[index];
    if (op === OPS.save) stack.push({ ...state });
    else if (op === OPS.restore) state = stack.pop() || state;
    else if (op === OPS.transform) state.ctm = multiplyMatrix(Array.from(args), state.ctm);
    else if (op === OPS.setFillRGBColor) state.fill = colorHex(args) || state.fill;
    else if (op === OPS.constructPath) {
      const minMax = args?.[2];
      path = minMax && minMax.length >= 4 && Number.isFinite(minMax[0]) ? transformBox(state.ctm, Array.from(minMax)) : null;
    } else if (op === OPS.clip || op === OPS.eoClip) {
      if (path) state.clip = intersectBox(state.clip, path);
    } else if (fillOps.has(op)) {
      const box = path && intersectBox(state.clip, path);
      if (box) fills.push({ box, color: state.fill, order: index });
    } else if (op === OPS.beginText) {
      textMatrix = [1, 0, 0, 1, 0, 0];
      lineMatrix = textMatrix;
    } else if (op === OPS.setTextMatrix) {
      textMatrix = Array.from(args);
      lineMatrix = textMatrix;
    } else if (op === OPS.moveText || op === OPS.setLeadingMoveText) {
      lineMatrix = multiplyMatrix([1, 0, 0, 1, args[0], args[1]], lineMatrix);
      textMatrix = lineMatrix;
    } else if (op === OPS.showText || op === OPS.showSpacedText) {
      const device = multiplyMatrix(textMatrix, state.ctm);
      texts.push({ x: device[4], y: device[5], color: state.fill, clip: state.clip, order: index });
    }
  }
  const topFill = (x, y, beforeOrder = Infinity) => {
    let top = null;
    for (const fill of fills) {
      if (fill.order > beforeOrder) continue;
      const [x0, y0, x1, y1] = fill.box;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && (!top || fill.order > top.order)) top = fill;
    }
    return top;
  };
  const isVisible = (token) => {
    const draw = texts.find((text) => Math.abs(text.x - token.left) <= 1 && Math.abs(text.y - token.y) <= 1);
    if (!draw) return true;
    const probeY = token.y + token.height * 0.35;
    if (draw.clip === null) return false;
    if (draw.clip) {
      const [x0, y0, x1, y1] = draw.clip;
      if (token.x < x0 || token.x > x1 || probeY < y0 || probeY > y1) return false;
    }
    // Hidden when a later fill paints over it, or when drawn in the cell's own colour.
    const covering = topFill(token.x, probeY);
    if (covering && covering.order > draw.order) return false;
    const background = topFill(token.x, probeY, draw.order);
    return !background || background.color !== draw.color;
  };
  return { topFill, isVisible };
}

function splitPdfItem(item) {
  const raw = String(item.str || "");
  const left = item.transform[4];
  const charWidth = raw.length ? (item.width || 0) / raw.length : 0;
  const parts = [];
  // Split items such as "x  x  x" or "1 2 3" into separate positioned tokens.
  for (const match of raw.matchAll(/\S+(?: \S+)*/g)) {
    const pieces = markStatus(match[0]) || /^[\sxX×✕✗✘]+$/.test(match[0]) || /^[\d\s]+$/.test(match[0])
      ? [...match[0].matchAll(/\S+/g)].map((part) => ({ text: part[0], offset: match.index + part.index }))
      : [{ text: match[0], offset: match.index }];
    for (const piece of pieces) {
      parts.push({
        text: piece.text,
        left: left + charWidth * piece.offset,
        right: left + charWidth * (piece.offset + piece.text.length),
        x: left + charWidth * (piece.offset + piece.text.length / 2),
      });
    }
  }
  return parts;
}

// Some fonts map ligatures to odd glyphs: "ti" -> Ɵ, "f" -> ϐ.
const PDF_LIGATURES = { "Ɵ": "ti", "ϐ": "f", "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff" };

function pdfLineText(row) {
  let text = "";
  let previous = null;
  for (const token of row) {
    const touching = previous && previous.right !== undefined && token.left - previous.right < 1;
    text += (text && !touching ? " " : "") + token.text;
    previous = token;
  }
  return text.replace(/[Ɵϐﬁﬂﬀ]/g, (glyph) => PDF_LIGATURES[glyph]);
}

async function extractPdf(buffer, name) {
  const { getDocument, OPS } = await loadPdfjs();
  const document = await getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false }).promise;
  const result = { entries: [], warnings: [], blocks: 0 };
  const pages = [];
  let textLength = 0;
  let hiddenMarks = 0;
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 60); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const paint = await pdfPaintModel(page, OPS);
      const tokens = [];
      for (const item of content.items) {
        if (!String(item.str || "").trim()) continue;
        textLength += item.str.trim().length;
        const y = item.transform[5];
        const height = item.height || Math.abs(item.transform[3]) || 6;
        const whole = { left: item.transform[4], x: item.transform[4] + (item.width || 0) / 2, y, height };
        if (!paint.isVisible(whole)) {
          if (markStatus(item.str)) hiddenMarks += 1;
          continue;
        }
        for (const part of splitPdfItem(item))
          tokens.push({ ...part, y, height, ref: `${name} p.${pageNumber}` });
      }
      tokens.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows = [];
      for (const token of tokens) {
        const last = rows[rows.length - 1];
        if (last && Math.abs(last.y - token.y) <= 1.5) last.tokens.push(token);
        else rows.push({ y: token.y, height: token.height, tokens: [token] });
      }
      const probe = (rowIndex) => rows[rowIndex].y + rows[rowIndex].height * 0.35;
      pages.push({
        pageNumber,
        rows: rows.map((row) => row.tokens.sort((a, b) => a.x - b.x)),
        colorAt: (rowIndex, x) => paint.topFill(x, probe(rowIndex))?.color || null,
        swatchAt: (rowIndex, token) => paint.topFill(token.left - 4, probe(rowIndex))?.color || null,
      });
    }
    if (document.numPages > 60) result.warnings.push(`${name}: hanya 60 halaman pertama yang dibaca.`);
  } finally {
    await document.destroy().catch(() => {});
  }
  // The legend is usually printed once (last page) but applies to every page.
  const legend = new Map();
  for (const page of pages)
    for (const [color, status] of findLegend(page.rows, page.swatchAt)) if (!legend.has(color)) legend.set(color, status);
  // The report title (usually only on page 1) gives the year for later pages.
  const yearHint = pages.length ? titleYear(pages[0].rows) : null;
  for (const page of pages)
    merge(result, parseGrid(page.rows, { source: `${name} p.${page.pageNumber}`, colorAt: page.colorAt, legend, yearHint }));
  if (!result.blocks) {
    for (const page of pages) {
      const text = page.rows.map(pdfLineText).join("\n");
      merge(result, parseText(text, { source: `${name} p.${page.pageNumber}` }));
    }
  }
  if (hiddenMarks) result.warnings.push(`${name}: ${hiddenMarks} tanda "x" tersembunyi (tertutup warna sel) diabaikan.`);
  if (!textLength) result.warnings.push(`${name}: PDF tidak memiliki teks (hasil scan). Perlu review manual.`);
  return { ...result, legend: Object.fromEntries(legend), supported: textLength > 0 };
}

// ---------------------------------------------------------------------------
// HTML (email bodies)
// ---------------------------------------------------------------------------

function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").trim();
}

const NAMED_COLORS = {
  red: "ff0000", green: "008000", yellow: "ffff00", orange: "ffa500",
  black: "000000", white: "ffffff", grey: "808080", gray: "808080",
};

function htmlCellColor(attributes) {
  const color = /(?:bgcolor\s*=\s*["']?|background(?:-color)?\s*:\s*)(#[0-9a-f]{6}|#[0-9a-f]{3}|[a-z]+)\b/i.exec(attributes)?.[1]?.toLowerCase();
  if (!color) return null;
  if (!color.startsWith("#")) return NAMED_COLORS[color] || null;
  return color.length === 4 ? color.slice(1).split("").map((part) => part + part).join("") : color.slice(1);
}

function htmlText(html) {
  return stripTags(String(html).replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n"));
}

// Public ("anyone with the link") Google Sheets can be exported as .xlsx without login.
async function downloadGoogleSheet(id) {
  try {
    const response = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, {
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok) return { error: `HTTP ${response.status}` };
    // A private sheet answers with an HTML login page instead of a spreadsheet.
    if (!/spreadsheetml|octet-stream|excel/i.test(type)) return { error: "sheet tidak publik" };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 20 * 1024 * 1024) return { error: "file terlalu besar" };
    return { buffer };
  } catch (error) {
    return { error: error.name === "TimeoutError" ? "timeout" : error.message };
  }
}

// Tables in the body and attachments are read first; the body is read as free
// text only when neither contains a calendar (otherwise greetings like "find the
// updated list for July" become fake stop sales).
async function extractMailParts(result, { html, plain, attachments, name, reference, depth }) {
  if (html) merge(result, extractHtml(html, `${name} (body)`, { textFallback: false }));
  for (const attachment of attachments)
    merge(result, await extractBuffer(attachment.content, attachment.filename, depth + 1, { reference }));
  // Some suppliers only send a Google Sheets link ("Chart of Availability").
  if (!result.blocks) {
    const links = new Set();
    for (const match of String(`${html || ""} ${plain || ""}`).matchAll(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/g)) links.add(match[1]);
    for (const id of [...links].slice(0, 3)) {
      const sheet = await downloadGoogleSheet(id);
      if (sheet.error) result.warnings.push(`${name}: Google Sheet ${id} tidak bisa diunduh (${sheet.error}). Buka link-nya dan upload manual.`);
      else merge(result, await extractBuffer(sheet.buffer, `google-sheet-${id}.xlsx`, depth + 1, { reference }));
    }
  }
  if (!result.blocks) {
    const text = html ? htmlText(html) : plain;
    if (text) merge(result, parseText(text, { source: `${name} (body)`, reference }));
  }
  return result;
}

function extractHtml(html, name, { textFallback = true } = {}) {
  const body = String(html).replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ");
  const rows = [];
  const colors = new Map();
  for (const rowMatch of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = [];
    let x = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      const span = Math.max(1, Number(/colspan\s*=\s*["']?(\d+)/i.exec(cellMatch[2])?.[1] || 1));
      const text = stripTags(cellMatch[3]);
      const color = htmlCellColor(cellMatch[2]);
      if (color) for (let offset = 0; offset < span; offset += 1) colors.set(`${rows.length}:${x + offset}`, color);
      if (text) row.push({ x, text, ref: `${name} (table)` });
      x += span;
    }
    rows.push(row);
  }
  const colorAt = (rowIndex, x) => colors.get(`${rowIndex}:${Math.round(x)}`) || null;
  const swatchAt = cellSwatch(colors, colorAt);
  const legend = findLegend(rows, swatchAt);
  const grid = rows.length ? parseGrid(rows, { source: name, tolerance: 0.5, colorAt, legend }) : { entries: [], warnings: [], blocks: 0 };
  if (grid.blocks || !textFallback) return grid;
  const parsed = parseText(htmlText(body), { source: name });
  return { entries: parsed.entries, warnings: [...grid.warnings, ...parsed.warnings], blocks: 0 };
}

// ---------------------------------------------------------------------------
// Images (calendar screenshots pasted into e-mails, or uploaded PNG/JPG).
// Day columns come from the table lines (OCR misses many single digits), the
// day numbers OCR does read only confirm the alignment. Month names are OCR'd;
// a missing year is taken from the e-mail date and month order.
// ---------------------------------------------------------------------------

function monthOnly(text) {
  const value = String(text || "").toLowerCase().replace(/[^a-z]/g, "");
  return value.length >= 3 ? MONTH_LOOKUP.get(value) || null : null;
}

function bandAround(hLines, y) {
  let top = null;
  let bottom = null;
  for (const line of hLines) {
    if (line.center <= y) top = line;
    else if (!bottom) bottom = line;
  }
  return top && bottom ? { top: top.end, bottom: bottom.start, center: (top.end + bottom.start) / 2 } : null;
}

function groupWordLines(words) {
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines = [];
  for (const word of sorted) {
    const center = (word.y0 + word.y1) / 2;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.center - center) <= Math.max(4, (word.y1 - word.y0) * 0.6)) {
      last.words.push(word);
      last.center = (last.center * (last.words.length - 1) + center) / last.words.length;
    } else lines.push({ center, words: [word] });
  }
  for (const line of lines) line.words.sort((a, b) => a.x0 - b.x0);
  return lines;
}

// The run of equally narrow cells in the header band is the day columns.
function dayColumns(vision, band, numbers) {
  const lines = vision.verticalLines(band.top, band.bottom);
  const cells = [];
  for (let index = 1; index < lines.length; index += 1)
    cells.push({ x0: lines[index - 1].end, x1: lines[index].start });
  const narrow = cells.map((cell) => cell.x1 - cell.x0).filter((size) => size > 4).sort((a, b) => a - b);
  if (narrow.length < 7) return null;
  const typical = narrow[Math.floor(narrow.length * 0.25)];
  let best = [];
  let run = [];
  for (const cell of cells) {
    const size = cell.x1 - cell.x0;
    if (size >= typical * 0.6 && size <= typical * 1.6) run.push(cell);
    else run = [];
    if (run.length > best.length) best = [...run];
  }
  if (best.length < 7) return null;
  // Align with the day numbers OCR could read (two-digit ones are reliable).
  const votes = new Map();
  for (const number of numbers) {
    const center = (number.x0 + number.x1) / 2;
    const index = best.findIndex((cell) => center >= cell.x0 && center <= cell.x1);
    if (index >= 0) votes.set(number.day - index, (votes.get(number.day - index) || 0) + 1);
  }
  const offset = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
  return best.map((cell, index) => ({ ...cell, x: (cell.x0 + cell.x1) / 2, day: index + offset })).filter((cell) => cell.day >= 1 && cell.day <= 31);
}

async function extractImage(buffer, name, { reference = new Date() } = {}) {
  const { analyzeImage } = require("./image");
  const vision = await analyzeImage(buffer);
  if (!vision) return { supported: true, entries: [], warnings: [], blocks: 0, image: false };
  const lines = groupWordLines(vision.words);
  const headers = [];
  lines.forEach((line, index) => {
    const numbers = line.words
      .map((word) => ({ ...word, day: /^\d{1,2}$/.test(word.text) ? Number(word.text) : null }))
      .filter((word) => word.day >= 1 && word.day <= 31);
    if (numbers.length >= 5) headers.push({ index, line, numbers });
  });
  const rows = [];
  const rowMeta = [];
  const warnings = [];
  let previous = null;
  for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
    const header = headers[headerIndex];
    const band = bandAround(vision.hLines, header.line.center);
    const columns = band && dayColumns(vision, band, header.numbers.filter((number) => number.day >= 10));
    if (!columns?.length) continue;
    const firstX = columns[0].x0;
    const blockEnd = headers[headerIndex + 1]?.index ?? lines.length;
    const previousEnd = headers[headerIndex - 1]?.index ?? -1;
    const blockLines = lines.slice(header.index + 1, blockEnd);
    // Month: a month word in the block's label area or just above the header.
    const contextLines = [...lines.slice(Math.max(previousEnd + 1, header.index - 2), header.index + 1), ...blockLines];
    let month = null;
    let year = null;
    for (const line of contextLines) {
      for (const word of line.words) {
        const yearFirst = line !== header.line && /^(\d{2})\s*-\s*([a-z]{3,})\.?$/i.exec(word.text);
        const parsed = (yearFirst && Number(yearFirst[1]) >= 20 && monthOnly(yearFirst[2])
          ? { year: 2000 + Number(yearFirst[1]), month: monthOnly(yearFirst[2]) }
          : null) || parseMonthYear(word.text);
        if (!month && parsed) ({ month, year } = parsed);
        else if (!month && word.x1 <= firstX && monthOnly(word.text)) month = monthOnly(word.text);
      }
    }
    for (const line of lines.slice(Math.max(0, previousEnd + 1), header.index + 1))
      for (const word of line.words) if (!year && /^20\d{2}$/.test(word.text)) year = Number(word.text);
    if (!month) {
      warnings.push(`${name}: bulan untuk tabel ke-${headerIndex + 1} tidak terbaca.`);
      continue;
    }
    if (!year) {
      // Calendars run forward in time: continue from the previous block, else from the mail date.
      if (previous) year = month < previous.month ? previous.year + 1 : previous.year;
      else year = month < reference.getUTCMonth() + 1 - 3 ? reference.getUTCFullYear() + 1 : reference.getUTCFullYear();
    }
    previous = { month, year };
    const dated = columns.map((column) => ({ ...column, date: isoDate(year, month, column.day) })).filter((column) => column.date);
    rows.push(dated.map((column) => ({ x: column.x, text: String(column.day), date: column.date })));
    rowMeta.push(null);
    for (const line of blockLines) {
      const labelWords = line.words.filter((word) => word.x1 <= firstX + 2 && !monthOnly(word.text) && !/^20\d{2}$/.test(word.text));
      const label = cleanLabel(labelWords.map((word) => word.text).join(" "));
      if (!/[a-z]{3,}/i.test(label)) continue;
      const rowBand = bandAround(vision.hLines, line.center);
      if (!rowBand) continue;
      const marks = line.words
        .filter((word) => (word.x0 + word.x1) / 2 > firstX && markStatus(word.text))
        .map((word) => ({ x: (word.x0 + word.x1) / 2, text: word.text, ref: `${name} (image)` }));
      rows.push([{ x: columns[0].x0 - 20, text: label, ref: `${name} (image)` }, ...marks]);
      rowMeta.push({ band: rowBand, columns: dated });
    }
  }
  if (!rows.length) return { supported: true, entries: [], warnings, blocks: 0, image: true };
  const colorAt = (rowIndex, x) => {
    const meta = rowMeta[rowIndex];
    const column = meta?.columns.find((candidate) => x >= candidate.x0 && x <= candidate.x1);
    return column ? vision.cellColor(column.x0, column.x1, meta.band.top, meta.band.bottom) : null;
  };
  const tolerance = Math.max(2, ((rowMeta.find(Boolean)?.columns[1]?.x || 20) - (rowMeta.find(Boolean)?.columns[0]?.x || 0)) / 2);
  const legendRows = lines.map((line) => line.words.map((word) => ({ x: (word.x0 + word.x1) / 2, left: word.x0, text: word.text, center: line.center })));
  const legend = findLegend(legendRows, (rowIndex, token) => vision.colorAtPoint(Math.max(0, token.left - 3), token.center));
  const grid = parseGrid(rows, { source: `${name} (image)`, tolerance, colorAt, legend });
  return { supported: true, entries: grid.entries, warnings: [...warnings, ...grid.warnings], blocks: grid.blocks, image: true, legend: Object.fromEntries(legend) };
}

// ---------------------------------------------------------------------------
// E-mail containers (EML = MIME text, MSG = Outlook compound file)
// ---------------------------------------------------------------------------

function decodeWords(value) {
  return String(value || "").replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, charset, encoding, text) => {
    const bytes = encoding.toLowerCase() === "b"
      ? Buffer.from(text, "base64")
      : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (__, hex) => String.fromCharCode(parseInt(hex, 16))), "latin1");
    return bytes.toString(/utf-?8/i.test(charset) ? "utf8" : "latin1");
  });
}

function parseHeaders(text) {
  const headers = {};
  for (const line of text.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function headerParam(value, name) {
  const match = new RegExp(`${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]*))`, "i").exec(value || "");
  return match ? decodeWords(match[1] ?? match[2]).replace(/^utf-8''/i, "") : null;
}

function decodeBody(body, headers) {
  const encoding = String(headers["content-transfer-encoding"] || "").toLowerCase();
  if (encoding === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64");
  if (encoding === "quoted-printable") {
    return Buffer.from(
      body.replace(/=\r?\n/g, "").replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))),
      "latin1",
    );
  }
  return Buffer.from(body, "latin1");
}

function mimeParts(raw, depth = 0) {
  const split = /\r?\n\r?\n/.exec(raw);
  const headers = parseHeaders(split ? raw.slice(0, split.index) : raw);
  const body = split ? raw.slice(split.index + split[0].length) : "";
  const type = String(headers["content-type"] || "text/plain").toLowerCase();
  const boundary = headerParam(headers["content-type"], "boundary");
  if (type.startsWith("multipart/") && boundary && depth < 8) {
    return body.split(`--${boundary}`).slice(1)
      .filter((part) => !part.startsWith("--"))
      .flatMap((part) => mimeParts(part.replace(/^\r?\n/, ""), depth + 1));
  }
  const filename = headerParam(headers["content-disposition"], "filename") || headerParam(headers["content-type"], "name");
  const content = decodeBody(body, headers);
  const charset = headerParam(headers["content-type"], "charset") || "utf-8";
  return [{ type: type.split(";")[0].trim(), filename, content, charset }];
}

function bufferText(buffer, charset) {
  return buffer.toString(/utf-?8/i.test(charset || "utf-8") ? "utf8" : "latin1");
}

async function extractEml(buffer, name, depth, context = {}) {
  const raw = buffer.toString("latin1");
  const parts = mimeParts(raw);
  const result = { entries: [], warnings: [], blocks: 0, supported: true };
  const split = /\r?\n\r?\n/.exec(raw);
  const sent = new Date(parseHeaders(split ? raw.slice(0, split.index) : raw).date || "");
  const reference = Number.isNaN(sent.getTime()) ? context.reference : sent;
  const html = parts.find((part) => !part.filename && part.type === "text/html");
  const plain = parts.find((part) => !part.filename && part.type === "text/plain");
  return extractMailParts(result, {
    html: html && bufferText(html.content, html.charset),
    plain: plain && bufferText(plain.content, plain.charset),
    attachments: parts.filter((item) => item.filename),
    name,
    reference,
    depth,
  });
}

function extractMsg(buffer, name, depth, context = {}) {
  const container = XLSX.CFB.read(buffer, { type: "buffer" });
  const streams = new Map();
  container.FullPaths.forEach((fullPath, index) => {
    const entry = container.FileIndex[index];
    if (entry?.type === 2 && entry.content) streams.set(fullPath.replace(/^Root Entry\//i, "").toLowerCase(), Buffer.from(entry.content));
  });
  const topLevel = (property) => {
    for (const [key, value] of streams) if (!key.includes("/") && key === `__substg1.0_${property}`) return value;
    return null;
  };
  const unicode = (value) => value?.toString("utf16le").replace(/\0+$/, "");
  return (async () => {
    const result = { entries: [], warnings: [], blocks: 0, supported: true };
    const html = topLevel("10130102") || topLevel("1013001f");
    const plain = unicode(topLevel("1000001f")) || topLevel("1000001e")?.toString("latin1");
    const attachments = new Map();
    for (const [key, value] of streams) {
      const match = /^(__attach_version1\.0_#[0-9a-f]+)\/__substg1\.0_(3701|3707|3704)/i.exec(key);
      if (!match) continue;
      const attachment = attachments.get(match[1]) || {};
      if (match[2] === "3701") attachment.data = value;
      else attachment.name ||= key.endsWith("001f") ? unicode(value) : value.toString("latin1").replace(/\0+$/, "");
      attachments.set(match[1], attachment);
    }
    // PR_CLIENT_SUBMIT_TIME is not decoded; the current date is a fine reference for images.
    return extractMailParts(result, {
      html: html && html.toString(/\0/.test(html.toString("latin1").slice(0, 200)) ? "utf16le" : "utf8"),
      plain,
      attachments: [...attachments.values()]
        .filter((attachment) => attachment.data && attachment.name)
        .map((attachment) => ({ content: attachment.data, filename: attachment.name })),
      name,
      reference: context.reference,
      depth,
    });
  })();
}

function merge(target, source) {
  target.entries.push(...(source.entries || []));
  target.warnings.push(...(source.warnings || []));
  target.blocks += source.blocks || 0;
  return target;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp"]);

async function extractBuffer(buffer, name, depth = 0, context = {}) {
  const extension = path.extname(name).slice(1).toLowerCase();
  try {
    if (IMAGE_EXTENSIONS.has(extension)) {
      const result = await extractImage(buffer, name, context);
      // Logos/signatures inside e-mails are silently skipped; a lone image that is
      // not a readable calendar needs a manual check.
      if (depth === 0 && !result.blocks)
        result.warnings.push(`${name}: kalender di gambar tidak terbaca otomatis. Review manual.`);
      return depth === 0 || result.blocks ? result : { supported: true, entries: [], blocks: 0, warnings: [] };
    }
    if (["xlsx", "xls", "xlsm", "csv"].includes(extension)) return { supported: true, ...extractExcel(buffer, name) };
    if (extension === "pdf") return await extractPdf(buffer, name);
    if (depth < 3 && extension === "eml") return await extractEml(buffer, name, depth, context);
    if (depth < 3 && extension === "msg") return await extractMsg(buffer, name, depth, context);
    if (["htm", "html"].includes(extension)) return { supported: true, ...extractHtml(buffer.toString("utf8"), name) };
    if (extension === "txt") return { supported: true, blocks: 0, ...parseText(buffer.toString("utf8"), { source: name }) };
  } catch (error) {
    // Broken inline images (spacers, tracking pixels) inside e-mails are not worth a warning.
    if (depth > 0 && IMAGE_EXTENSIONS.has(extension)) return { supported: true, entries: [], blocks: 0, warnings: [] };
    return { supported: false, entries: [], blocks: 0, warnings: [`${name}: gagal dibaca (${error.message}).`] };
  }
  if (depth > 0) return { supported: true, entries: [], blocks: 0, warnings: [] };
  return {
    supported: false,
    entries: [],
    blocks: 0,
    warnings: [`${name}: format ${extension || "ini"} belum bisa dibaca otomatis (perlu OCR). Review manual.`],
  };
}

function dedupe(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const key = `${roomKey(entry.room)}|${entry.date}`;
    const existing = byKey.get(key);
    // A room/date marked both ways counts as STOP_SALE (the stricter restriction).
    if (!existing || (existing.status === "ON_REQUEST" && entry.status === "STOP_SALE")) byKey.set(key, entry);
  }
  return [...byKey.values()];
}

async function extractStopSales(filePath, displayName = path.basename(filePath)) {
  const buffer = await fs.promises.readFile(filePath);
  const result = await extractBuffer(buffer, displayName);
  const entries = dedupe(result.entries);
  const warnings = [...new Set(result.warnings)].slice(0, 50);
  if (result.supported && !entries.length)
    warnings.push(`${displayName}: tidak ada tanda stop sale (mis. "x", "SS", "Close", sel merah) yang terdeteksi.`);
  return {
    supported: result.supported !== false,
    entries,
    warnings,
    legend: result.legend && Object.keys(result.legend).length ? result.legend : null,
    grid_blocks: result.blocks || 0,
  };
}

// Date a supplier file was updated, from its folder or file name: "updated on 02 Oct",
// "Update on 4 Aug 2026", "as of 02.10.2026", "by 25September, 2026". Days before it
// have passed; suppliers black/grey them out, which is not a stop sale.
function updateDateIn(text, reference = new Date()) {
  const value = String(text ?? "").toLowerCase().replace(/_/g, " ");
  for (const cue of value.matchAll(/\b(?:updated?|as\s+of|per|by)\b\s*(?:on\b)?\s*[:-]?\s*/g)) {
    const rest = value.slice(cue.index + cue[0].length, cue.index + cue[0].length + 30);
    const named = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MONTH_PATTERN})[a-z]*\\.?,?\\s*(\\d{4})?`).exec(rest);
    const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/.exec(rest);
    let day;
    let month;
    let year;
    if (named) [day, month, year] = [Number(named[1]), MONTH_LOOKUP.get(named[2]), named[3] ? Number(named[3]) : null];
    else if (numeric) [day, month, year] = [Number(numeric[1]), Number(numeric[2]), fullYear(numeric[3])];
    else continue;
    if (!year) {
      // "updated on 02 Oct" without a year: the latest such date not after the reference.
      year = reference.getUTCFullYear();
      if (Date.UTC(year, month - 1, day) > reference.getTime() + 2 * 86400000) year -= 1;
    }
    const date = isoDate(year, month, day);
    if (date) return date;
  }
  return null;
}

module.exports = {
  EXTRACTOR_VERSION,
  updateDateIn,
  extractBuffer,
  extractStopSales,
  markStatus,
  parseGrid,
  parseMonthYear,
  parseText,
  roomKey,
};
