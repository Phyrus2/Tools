const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { jsPDF } = require("jspdf");
const { extractBuffer, parseMonthYear, parseText } = require("../Services/stop_sales/extractor");
const { compareSnapshots, fromSnapshot, toSnapshot } = require("../Services/stop_sales/compare");

function datesFor(entries, room) {
  return entries.filter((entry) => entry.room === room).map((entry) => entry.date).sort();
}

function header(days) {
  return ["Oct-26", ...Array.from({ length: days }, (_, index) => index + 1)];
}

test("month headers accept short and long supplier formats", () => {
  assert.deepEqual(parseMonthYear("Oct-26"), { month: 10, year: 2026 });
  assert.deepEqual(parseMonthYear("Oktober 2026"), { month: 10, year: 2026 });
  assert.deepEqual(parseMonthYear("10/2026"), { month: 10, year: 2026 });
  assert.equal(parseMonthYear("Deluxe 2"), null);
});

test("excel grid only counts stop-sale marks, not allotment numbers or notes", async () => {
  const rows = [
    ["The Hotel"],
    header(10),
    ["Deluxe", "x", "x", "", "SS", "", "", "", "", "", ""],
    ["Suite", 5, 5, 3, "OR", 2, "promo", "", "", "", "x"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Oct");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const result = await extractBuffer(buffer, "stop.xlsx");
  assert.deepEqual(datesFor(result.entries, "Deluxe"), ["2026-10-01", "2026-10-02", "2026-10-04"]);
  assert.deepEqual(
    result.entries.filter((entry) => entry.room === "Suite").map((entry) => [entry.date, entry.status]),
    [["2026-10-04", "ON_REQUEST"], ["2026-10-10", "STOP_SALE"]],
  );
});

test("letter-code calendars follow the text legend (C closed, R on request, O open)", async () => {
  const rows = [
    ["NOTE:"],
    ["O : OPEN"],
    ["R : ON REQUEST"],
    ["C : CLOSED"],
    ["January-27"],
    ["ROOM TYPE/ DATE", "01", "02", "03", "04", "05", "06", "07", "08"],
    ["SUITE DUPLEX", "C", "C", "O", "R", "R", "O", "O", "C"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Inventory");
  const result = await extractBuffer(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "inventory.xlsx");
  assert.deepEqual(
    result.entries.map((entry) => [entry.date, entry.status]),
    [
      ["2027-01-01", "STOP_SALE"], ["2027-01-02", "STOP_SALE"], ["2027-01-04", "ON_REQUEST"],
      ["2027-01-05", "ON_REQUEST"], ["2027-01-08", "STOP_SALE"],
    ],
  );
});

test("legend rows, banner fills and notes on spare sheets are not rooms", async () => {
  const rows = [
    ["", "", "CLOSE OUT CALENDAR"],
    ["", "= AVAILABLE"],
    ["O", "= REOPEN"],
    ["X", "= CLOSE", "OCTOBER' 2026"],
    ["No.", "Room", 1, 2, 3, 4, 5, 6, 7, 8],
    [1, "Junior Suite", "X", "X", "", "O", "", "", "", "X"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  // Title and spacer rows are filled across the whole width (a banner, not a legend swatch).
  for (const r of [0, 1, 2]) {
    for (let c = 2; c <= 9; c += 1) {
      const address = XLSX.utils.encode_cell({ r, c });
      sheet[address] = { ...(sheet[address] || { t: "z" }), s: { patternType: "solid", fgColor: { rgb: "DCE6F2" } } };
    }
  }
  const notes = XLSX.utils.aoa_to_sheet([["all inclusive FSBB out TA, close 12-14 Oct 2026"]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "TA");
  XLSX.utils.book_append_sheet(workbook, notes, "Sheet1");
  const result = await extractBuffer(XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true }), "close-out.xlsx");
  assert.deepEqual([...new Set(result.entries.map((entry) => entry.room))], ["Junior Suite"]);
  assert.deepEqual(datesFor(result.entries, "Junior Suite"), ["2026-10-01", "2026-10-02", "2026-10-08"]);
});

function workbookBuffer(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("month-column lists ('8,17,18' under September) roll the year over at January", async () => {
  const buffer = workbookBuffer({
    Sheet: [
      ["STOP SALE"],
      ["ROOM TYPE", "", "2026"],
      ["", "November", "December", "January"],
      ["Garden Villa", "8,17-18", "", "2"],
      ["Note : new additional stop sale"],
    ],
  });
  const result = await extractBuffer(buffer, "lists.xls");
  assert.deepEqual(datesFor(result.entries, "Garden Villa"), ["2026-11-08", "2026-11-17", "2026-11-18", "2027-01-02"]);
});

test("transposed calendars (rows are months, room is the block title) use the title year", async () => {
  const buffer = workbookBuffer({
    Sheet: [
      ["STOP SALES REPORT RESORT 2027"],
      ["", "STANDARD ROOM"],
      ["MONTH", "DATE 29 AUGUST 2026"],
      ["", 1, 2, 3, 4, 5, 6, 7, 8],
      ["January", "", "", "X", "X"],
      ["February", "", "", "", "", "", "", "", "X"],
    ],
  });
  const result = await extractBuffer(buffer, "transposed.xlsx");
  assert.deepEqual(datesFor(result.entries, "STANDARD ROOM"), ["2027-01-03", "2027-01-04", "2027-02-08"]);
});

test("date rows (one row per date, one column per room) follow the X/O legend", async () => {
  const dates = Array.from({ length: 8 }, (_, index) => `${index + 1}-Sep-26`);
  const buffer = workbookBuffer({
    Sheet: [
      ["O", "Room available"],
      ["X", "Room not available"],
      ["Date", "Deluxe Room", "Suite"],
      ["", "", "One bedroom"],
      ...dates.map((date, index) => [date, index < 2 ? "X" : "O", index === 7 ? "X" : "O"]),
    ],
  });
  const result = await extractBuffer(buffer, "daterows.xlsx");
  assert.deepEqual(datesFor(result.entries, "Deluxe Room"), ["2026-09-01", "2026-09-02"]);
  assert.deepEqual(datesFor(result.entries, "Suite One bedroom"), ["2026-09-08"]);
});

test("stored snapshots round-trip to the same entries", () => {
  const entries = [
    { room: "Deluxe", status: "STOP_SALE", date: "2026-10-01" },
    { room: "Deluxe", status: "STOP_SALE", date: "2026-10-02" },
    { room: "Deluxe", status: "ON_REQUEST", date: "2026-10-05" },
  ];
  const snapshot = toSnapshot(entries);
  assert.deepEqual(snapshot[0].ranges, [["2026-10-01", "2026-10-02"]]);
  assert.deepEqual(fromSnapshot(snapshot), entries);
});

function calendarImage() {
  const { createCanvas } = require("@napi-rs/canvas");
  const cell = 22;
  const labelWidth = 170;
  const canvas = createCanvas(labelWidth + cell * 31 + 10, 140);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const top = 30;
  const rooms = ["Deluxe King", "Deluxe Twin"];
  // Red = closed: Deluxe King 3-5, Deluxe Twin 10.
  const red = { 0: [3, 4, 5], 1: [10] };
  context.fillStyle = "#ff0000";
  for (const [row, days] of Object.entries(red))
    for (const day of days) context.fillRect(labelWidth + (day - 1) * cell, top + cell * (Number(row) + 1), cell, cell);
  context.strokeStyle = "#000000";
  context.lineWidth = 1;
  for (let row = 0; row <= rooms.length + 1; row += 1) {
    context.beginPath();
    context.moveTo(0, top + row * cell + 0.5);
    context.lineTo(labelWidth + cell * 31, top + row * cell + 0.5);
    context.stroke();
  }
  for (let column = 0; column <= 31; column += 1) {
    context.beginPath();
    context.moveTo(labelWidth + column * cell + 0.5, top);
    context.lineTo(labelWidth + column * cell + 0.5, top + cell * (rooms.length + 1));
    context.stroke();
  }
  context.fillStyle = "#000000";
  context.font = "14px Arial";
  context.fillText("2026", 4, 18);
  context.fillText("October", 4, top + 16);
  for (let day = 1; day <= 31; day += 1) context.fillText(String(day), labelWidth + (day - 1) * cell + 3, top + 16);
  rooms.forEach((room, index) => context.fillText(room, 70, top + cell * (index + 1) + 16));
  return canvas.toBuffer("image/png");
}

test("calendar screenshots (e.g. pasted in e-mails) are read from table lines, OCR and red cells", { timeout: 120000 }, async () => {
  const result = await extractBuffer(calendarImage(), "stop-sell.png");
  assert.deepEqual(datesFor(result.entries, "Deluxe King"), ["2026-10-03", "2026-10-04", "2026-10-05"]);
  assert.deepEqual(datesFor(result.entries, "Deluxe Twin"), ["2026-10-10"]);
});

function calendarPdf({ coverDay }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [400, 200] });
  doc.setFontSize(6);
  const columnX = (day) => 80 + day * 20;
  const rowY = (row) => 40 + row * 10;
  doc.text("Oct-26", 20, rowY(0));
  for (let day = 1; day <= 10; day += 1) doc.text(String(day), columnX(day), rowY(0));
  // Green = Closed, orange = Re Open; both carry an "x".
  doc.setFillColor(84, 130, 53);
  doc.rect(columnX(1) - 6, rowY(1) - 6, 40, 8, "F");
  doc.setFillColor(255, 192, 0);
  doc.rect(columnX(3) - 6, rowY(1) - 6, 20, 8, "F");
  doc.text("Deluxe", 20, rowY(1));
  for (const day of [1, 2, 3, 5, coverDay]) doc.text("x", columnX(day), rowY(1));
  // A white cell painted after the text hides the "x" (as Excel exports do).
  doc.setFillColor(255, 255, 255);
  doc.rect(columnX(coverDay) - 6, rowY(1) - 6, 20, 8, "F");
  doc.setFillColor(84, 130, 53);
  doc.rect(columnX(1) - 6, rowY(3) - 6, 20, 8, "F");
  doc.text("x", columnX(1), rowY(3));
  doc.text("Closed", columnX(1) + 16, rowY(3));
  doc.setFillColor(255, 192, 0);
  doc.rect(columnX(1) - 6, rowY(4) - 6, 20, 8, "F");
  doc.text("x", columnX(1), rowY(4));
  doc.text("Re Open", columnX(1) + 16, rowY(4));
  return Buffer.from(doc.output("arraybuffer"));
}

test("pdf calendar follows the colour legend and ignores hidden x marks", async () => {
  const result = await extractBuffer(calendarPdf({ coverDay: 8 }), "stop.pdf");
  assert.equal(result.supported, true);
  // Day 3 is "Re Open" (orange), day 5 has an x on a plain cell, day 8 is covered.
  assert.deepEqual(datesFor(result.entries, "Deluxe"), ["2026-10-01", "2026-10-02", "2026-10-05"]);
  assert.equal(result.entries.some((entry) => /closed|open/i.test(entry.room)), false);
});

test("email html table and free text are both read", async () => {
  const html = `<table>
    <tr><td>Oct 2026</td>${Array.from({ length: 8 }, (_, index) => `<td>${index + 1}</td>`).join("")}</tr>
    <tr><td>Garden View</td><td></td><td bgcolor="#ff0000"></td><td>x</td><td></td><td></td><td></td><td></td><td></td></tr>
  </table>`;
  const eml = [
    "From: hotel@example.com",
    "Subject: Stop sale",
    'Content-Type: multipart/alternative; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
    "--b1--",
  ].join("\r\n");
  const result = await extractBuffer(Buffer.from(eml), "update.eml");
  assert.deepEqual(datesFor(result.entries, "Garden View"), ["2026-10-02", "2026-10-03"]);

  const text = parseText("Dear partner,\nPlease stop sale Deluxe Room 12-14 Oct 2026\nSent: 3 Oct 2026", { source: "mail" });
  assert.deepEqual(datesFor(text.entries, "Deluxe Room"), ["2026-10-12", "2026-10-13", "2026-10-14"]);
});

test("compare reports only real stop-sale differences", () => {
  const entry = (room, date, status = "STOP_SALE") => ({ room, date, status });
  const before = [entry("Deluxe", "2026-10-01"), entry("Deluxe", "2026-10-02"), entry("Suite", "2026-10-05")];
  const same = compareSnapshots(before, [...before], { hasBaseline: true });
  assert.deepEqual(same.changes, []);

  // Room names are matched case/space-insensitively between the two files.
  const after = [entry("DELUXE ", "2026-10-02"), entry("DELUXE ", "2026-10-03"), entry("Suite", "2026-10-05")];
  const diff = compareSnapshots(before, after, { hasBaseline: true });
  assert.deepEqual(
    diff.changes.map((item) => [item.change, item.start_date]),
    [["REMOVED", "2026-10-01"], ["ADDED", "2026-10-03"]],
  );

  const incremental = compareSnapshots(before, [entry("Deluxe", "2026-10-09")], { hasBaseline: true, incremental: true });
  assert.deepEqual(incremental.changes.map((item) => item.change), ["ADDED"]);

  const first = compareSnapshots([], before, { hasBaseline: false });
  assert.deepEqual(first.changes, []);
  assert.equal(first.context.every((item) => item.change === "CURRENT"), true);
});

test("one day header serves several month blocks labelled beside the rooms (Oct-26, Nov-26)", async () => {
  const days = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, "0"));
  const block = (label, deluxe, suite) => [
    ["", "Deluxe", ...deluxe],
    [label, "", ...Array(31).fill("")],
    ["", "Suite", ...suite],
  ];
  const marks = (closed) => days.map((_, index) => (closed.includes(index + 1) ? "X" : "O"));
  const buffer = workbookBuffer({
    Chart: [
      ["X", "= Room type is fully booked, Close out."],
      ["R", "= Based on request, rate and terms will be advised"],
      ["Month", "Room Type", ...days],
      ...block("Oct-26", marks([1, 2]), marks([])),
      ...block("Nov-26", marks([]), marks([30])),
    ],
  });
  const result = await extractBuffer(buffer, "chart.xlsx");
  assert.deepEqual(datesFor(result.entries, "Deluxe"), ["2026-10-01", "2026-10-02"]);
  assert.deepEqual(datesFor(result.entries, "Suite"), ["2026-11-30"]);
});

test("day rows with month x room-code columns spell out codes and skip old tables", async () => {
  const dayRows = Array.from({ length: 31 }, (_, index) => [
    index + 1, index < 2 ? "x" : "", "", "x", index + 1, index === 4 ? "x" : "", index === 0 ? "x" : "",
  ]);
  const buffer = workbookBuffer({
    Sheet: [
      ["MONTHS", "Jan'24", "", "Feb'24", "MONTHS", "Jan'27", ""],
      ["TYPE", "DSV", "DGV", "DSV", "TYPE", "DSV", "DGV"],
      ...dayRows,
      [],
      ["DSV", "DELUXE SEA VIEW ROOM"],
    ],
  });
  const result = await extractBuffer(buffer, "dayrows.xlsx");
  assert.deepEqual(datesFor(result.entries, "DELUXE SEA VIEW ROOM"), ["2027-01-05"]);
  assert.deepEqual(datesFor(result.entries, "DGV"), ["2027-01-01"]);
});

test("free text reads listed days and ignores print timestamps", () => {
  const { entries } = parseText(
    "Stop Sales Notification | Soori Bali | 20 & 21 August 2027\nPeriod : 20 & 21 August 2027\n2 of 2 03/08/2026, 10:29",
    { source: "mail", reference: new Date("2026-08-01T00:00:00Z") },
  );
  assert.deepEqual([...new Set(entries.map((entry) => `${entry.room} ${entry.date}`))], ["All rooms 2027-08-20", "All rooms 2027-08-21"]);
});

test("days before the update date are past, not re-opened or closed", () => {
  const { updateDateIn } = require("../Services/stop_sales/extractor");
  const reference = new Date("2026-10-03T00:00:00Z");
  assert.equal(updateDateIn("PARADISUS BY MELIA BALI - updated on 02 Oct", reference), "2026-10-02");
  assert.equal(updateDateIn("Inventory Update AI 2027 as of 02.10.2026.pdf", reference), "2026-10-02");
  assert.equal(updateDateIn("Close Out Information by 25September, 2026.xlsx", reference), "2026-09-25");
  // Old file (1 Aug) closed 1-5 Aug; new file (updated 3 Aug) blacks out 1-2 Aug as past.
  const before = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"].map((date) => ({ room: "Deluxe", status: "STOP_SALE", date }));
  const after = before.slice(2);
  const { changes, context } = compareSnapshots(before, after, { hasBaseline: true, fromDate: "2026-08-03" });
  assert.deepEqual(changes, []);
  assert.deepEqual(context.map((item) => [item.start_date, item.end_date]), [["2026-08-03", "2026-08-05"]]);
});
