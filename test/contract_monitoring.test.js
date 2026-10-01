const test = require("node:test");
const assert = require("node:assert/strict");
const {
  contractStatus,
  parseContractReferenceStatuses,
  detectSignedStatus,
  normalizeName,
  parseContractPeriods,
  parseWitaDateTime,
  similarity,
  topRecommendations,
} = require("../Utils/contract_monitoring");

test("WITA input is converted to the same absolute UTC instant on every server timezone", () => {
  assert.equal(parseWitaDateTime("2026-09-22T08:30").toISOString(), "2026-09-22T00:30:00.000Z");
});

test("invalid WITA calendar input is rejected", () => {
  assert.throws(() => parseWitaDateTime("2026-02-30T08:30"), /tidak valid/);
});

test("signed detection does not classify unsigned as signed", () => {
  assert.equal(detectSignedStatus("Hotel ABC signed.pdf"), "SIGNED");
  assert.equal(detectSignedStatus("Hotel ABC unsigned.pdf"), "BELUM_SIGNED");
  assert.equal(detectSignedStatus("Hotel ABC signed draft.pdf"), "DRAFT");
});

test("supplier file normalization removes generic contract words and year", () => {
  assert.equal(normalizeName("PT. Hotel_Mawar CONTRACT RATES 2027.pdf"), "hotel mawar");
});

test("contract period ranges expand into independent years", () => {
  assert.deepEqual(parseContractPeriods("26-27"), ["2026", "2027"]);
  assert.deepEqual(parseContractPeriods("2026 - 2027"), ["2026", "2027"]);
  assert.deepEqual(parseContractPeriods("2026/28"), ["2026", "2027", "2028"]);
  assert.deepEqual(parseContractPeriods("2027"), ["2027"]);
});

test("fuzzy recommendation ranks the matching supplier first", () => {
  const results = topRecommendations(
    "Mawar Resort signed 2027.pdf",
    "D:\\Contracts\\Bali\\Mawar Resort",
    [
      { id: 1, name: "Mawar Resort" },
      { id: 2, name: "Melati Travel" },
    ],
  );
  assert.equal(results[0].id, 1);
  assert.ok(similarity("Mawar Resort", "PT Mawar Resort") > 0.9);
});

test("supplier recommendation can use the immediate parent folder instead of filename", () => {
  const results = topRecommendations(
    "Contract Rates signed 2027.pdf",
    "D:\\Contracts\\Bali\\Mawar Resort",
    [
      { id: 1, name: "Mawar Resort" },
      { id: 2, name: "Contract Rates" },
    ],
    0.42,
    5,
    "parent",
  );
  assert.equal(results[0].id, 1);
  assert.equal(results.some((result) => result.id === 2), false);
});

test("contract becomes expired only after validity end in WITA", () => {
  const now = new Date("2026-09-22T02:00:00.000Z");
  assert.equal(contractStatus("2026-09-21", now), "EXPIRED");
  assert.equal(contractStatus("2026-09-22", now), "ACTIVE");
  assert.equal(contractStatus("2027-01-01", now), "ACTIVE");
});

test("period statuses are derived from contract reference only", () => {
  assert.deepEqual(
    parseContractReferenceStatuses("2026 Signed / 2027 Pending", "2026-01-01"),
    [
      { period: "2026", status: "SIGNED" },
      { period: "2027", status: "PENDING" },
    ],
  );
  assert.deepEqual(parseContractReferenceStatuses("REF-123", "2026-01-01"), []);
});
