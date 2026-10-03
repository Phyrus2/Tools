const { roomKey } = require("./extractor");

function dateRange(start, end) {
  const dates = [];
  let cursor = new Date(`${start}T00:00:00Z`);
  const finish = new Date(`${end}T00:00:00Z`);
  for (let guard = 0; cursor <= finish && guard < 4000; guard += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dates;
}

function contiguousRanges(dates) {
  const sorted = [...dates].sort();
  if (!sorted.length) return [];
  const result = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const date of sorted.slice(1)) {
    const expected = new Date(`${previous}T00:00:00Z`).getTime() + 86400000;
    if (new Date(`${date}T00:00:00Z`).getTime() !== expected) {
      result.push({ start_date: start, end_date: previous });
      start = date;
    }
    previous = date;
  }
  result.push({ start_date: start, end_date: previous });
  return result;
}

function countDays(actions, change) {
  return actions.filter((item) => item.change === change)
    .reduce((sum, item) => sum + dateRange(item.start_date, item.end_date).length, 0);
}

function snapshotGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = `${roomKey(entry.room)}|${entry.status}`;
    if (!groups.has(key)) groups.set(key, { room: entry.room, status: entry.status, dates: new Set() });
    groups.get(key).dates.add(entry.date);
  }
  return groups;
}

// Compares the stop-sale content of two files (room x date), not their raw bytes/cells.
// Without a baseline every detected date is reported as CURRENT, never as a change.
// INCREMENTAL documents only announce new closures, so absence is not a re-open.
// Days before fromDate (the file's update date) have passed and are left out on both
// sides, otherwise every day that went by between two files would look re-opened.
function compareSnapshots(previousEntries, currentEntries, { hasBaseline, incremental = false, fromDate = null }) {
  const upcoming = (entries) => (fromDate ? entries.filter((entry) => entry.date >= fromDate) : entries);
  const before = snapshotGroups(upcoming(previousEntries));
  const after = snapshotGroups(upcoming(currentEntries));
  const changes = [];
  const context = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const oldGroup = before.get(key);
    const newGroup = after.get(key);
    const label = newGroup?.room || oldGroup.room;
    const status = newGroup?.status || oldGroup.status;
    const oldDates = oldGroup?.dates || new Set();
    const newDates = newGroup?.dates || new Set();
    const push = (target, dates, change) => {
      for (const range of contiguousRanges(dates))
        target.push({ ...range, change, product_id: null, product_name: label, restriction_status: status });
    };
    if (!hasBaseline) {
      push(context, newDates, "CURRENT");
      continue;
    }
    push(changes, [...newDates].filter((date) => !oldDates.has(date)), "ADDED");
    if (!incremental) push(changes, [...oldDates].filter((date) => !newDates.has(date)), "REMOVED");
    push(context, [...newDates].filter((date) => oldDates.has(date)), "UNCHANGED");
  }
  const sort = (a, b) => a.product_name.localeCompare(b.product_name) || a.start_date.localeCompare(b.start_date);
  return { changes: changes.sort(sort), context: context.sort(sort) };
}

function comparisonFromSummary(summary) {
  const actions = [...(summary.calendar_changes || []), ...(summary.current_stop_sales || [])];
  return {
    actions,
    summary: {
      added_days: countDays(actions, "ADDED"),
      removed_days: countDays(actions, "REMOVED"),
      unchanged_days: countDays(actions, "UNCHANGED"),
      current_days: countDays(actions, "CURRENT"),
    },
    extraction: summary.extraction || null,
    preview: Boolean(summary.preview),
    update_date: summary.update_date || null,
  };
}

// Compact form of a file's stop sales, stored with the job so a later compare uses
// exactly what this file said (live Google Sheets change; OCR is slow to repeat).
function toSnapshot(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.room}|${entry.status}`;
    if (!groups.has(key)) groups.set(key, { room: entry.room, status: entry.status, dates: [] });
    groups.get(key).dates.push(entry.date);
  }
  return [...groups.values()].map((group) => ({
    room: group.room,
    status: group.status,
    ranges: contiguousRanges(group.dates).map((range) => [range.start_date, range.end_date]),
  }));
}

function fromSnapshot(snapshot) {
  return (snapshot || []).flatMap((group) =>
    group.ranges.flatMap(([start, end]) => dateRange(start, end).map((date) => ({ room: group.room, status: group.status, date }))));
}

module.exports = { compareSnapshots, comparisonFromSummary, contiguousRanges, countDays, dateRange, fromSnapshot, toSnapshot };
