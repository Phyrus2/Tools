const express = require("express");
const runMigrations = require("./Database/migrate");
require("dotenv").config();
const cors = require("cors");
const auth = require("./Security/auth");

// SUPPLIER API
const supplier = require("./Controller/data_analyst/excel/Supplier/upload_supplier");

// // PRODUCT API
const product = require("./Controller/data_analyst/excel/Product/upload_product");

// // BOOKED PRODUCT API
const booked_product = require("./Controller/data_analyst/excel/Booked_Product/upload_booked_product");

// // SEARCH BOOKED PRODUCT API
const search = require("./Controller/search_booking/search");
const catalogSearch = require("./Controller/search_catalog/search_catalog");
const performanceAnalytics = require("./Controller/analytics/performance");
const recordDetails = require("./Controller/details/record_details");
const contractScan = require("./Controller/contract_monitoring/scan");
const contractPending = require("./Controller/contract_monitoring/pending");
const contractGroups = require("./Controller/contract_monitoring/groups");
const contractReports = require("./Controller/contract_monitoring/reports");
const contractReportImport = require("./Controller/contract_monitoring/report_import");
const hotelOptions = require("./Controller/contract_monitoring/hotel_options");
const {
  recoverInterruptedScans,
} = require("./Services/contract_monitoring/scanner");

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:4200")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  });
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin))
        return callback(null, true);
      return callback(new Error("Origin tidak diizinkan oleh CORS."));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 86400,
  }),
);
app.use(express.json({ limit: "512kb", type: "application/json" }));

const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => {
  res.json({ success: true, message: "Backend Express berhasil berjalan!" });
});

app.post("/auth/login", auth.login);
app.get("/auth/me", auth.requireAdmin, auth.me);
app.post("/auth/logout", auth.requireAdmin, auth.logout);

app.use(auth.requireAdmin);

//SUPPLIER
app.post("/supplier/import", supplier.importSupplier);
app.get("/supplier/import/latest", supplier.getLatestSupplierImport);
app.post("/supplier/import/:importId/undo", supplier.undoSupplierImport);

//PRODUCT
app.post("/product/import", product.importProduct);

//BOOKED PRODUCT
app.post("/booked-product/import", booked_product.importBookedProduct);
app.post("/booked-product/manual", booked_product.createManualBookedProduct);
app.get(
  "/booked-product/import/status",
  booked_product.getBookedProductImportStatus,
);

//SEARCH BOOKED PRODUCT
app.get("/booked-product/search", search.searchBookedProduct);

// SEARCH MASTER SUPPLIER / PRODUCT
app.get("/catalog/search", catalogSearch.searchCatalog);
app.get("/catalog/categories", catalogSearch.getCatalogCategories);

// SUPPLIER & PRODUCT PERFORMANCE ANALYTICS
app.get("/analytics/overview", performanceAnalytics.overview);
app.get(
  "/analytics/suppliers/:supplierId",
  performanceAnalytics.supplierDetail,
);
app.get("/analytics/products/:productId", performanceAnalytics.productDetail);
app.patch("/analytics/suppliers/:supplierId", recordDetails.updateSupplier);
app.patch("/analytics/products/:productId", recordDetails.updateProduct);
app.get("/booked-product/:bookedProductId", recordDetails.getBookedProduct);
app.patch(
  "/booked-product/:bookedProductId",
  recordDetails.updateBookedProduct,
);

// CONTRACT MONITORING
app.get("/contract-monitoring/scan-sources", contractScan.listSources);
app.post("/contract-monitoring/scan-sources", contractScan.createSource);
app.patch("/contract-monitoring/scan-sources/:id", contractScan.updateSource);
app.delete("/contract-monitoring/scan-sources/:id", contractScan.deleteSource);
app.post("/contract-monitoring/scans", contractScan.startScan);
app.get("/contract-monitoring/scans/:scanId", contractScan.getScan);
app.get("/contract-monitoring/scans/:scanId/results", contractScan.listResults);
app.get("/contract-monitoring/scan-results/:id", contractScan.getResult);
app.post(
  "/contract-monitoring/scan-results/:id/pending",
  contractPending.createPending,
);

app.get("/contract-monitoring/pending", contractPending.listPending);
app.post(
  "/contract-monitoring/pending/import",
  contractPending.importPendingQueue,
);
app.get("/contract-monitoring/pending/:id", contractPending.getPending);
app.patch("/contract-monitoring/pending/:id", contractPending.updatePending);
app.patch(
  "/contract-monitoring/pending/:id/queue-meta",
  contractPending.updateQueueMeta,
);
app.put(
  "/contract-monitoring/pending/:id/suppliers",
  contractPending.saveSuppliers,
);
app.post(
  "/contract-monitoring/pending/:id/queue-unmatched",
  contractPending.queueUnmatched,
);
app.post(
  "/contract-monitoring/pending/:id/start",
  contractPending.startPending,
);
app.post(
  "/contract-monitoring/pending/:id/complete",
  contractPending.completePending,
);
app.post(
  "/contract-monitoring/pending/:id/ignore",
  contractPending.ignorePending,
);
app.post(
  "/contract-monitoring/pending/:id/release",
  contractPending.releasePending,
);

app.get("/contract-monitoring/management-groups", contractGroups.listGroups);
app.post("/contract-monitoring/management-groups", contractGroups.createGroup);
app.post(
  "/contract-monitoring/management-groups/assign-pending",
  contractGroups.assignPending,
);
app.get("/contract-monitoring/management-groups/:id", contractGroups.getGroup);
app.patch(
  "/contract-monitoring/management-groups/:id",
  contractGroups.updateGroup,
);
app.put(
  "/contract-monitoring/management-groups/:id/members",
  contractGroups.updateMembers,
);
app.get(
  "/contract-monitoring/management-groups/:id/history",
  contractGroups.getHistory,
);

app.get("/contract-monitoring/reports", contractReports.listReports);
app.post(
  "/contract-monitoring/reports/import",
  contractReportImport.importReport,
);
app.post(
  "/contract-monitoring/reports/import-skipped",
  contractReportImport.addSkippedReport,
);
app.post("/contract-monitoring/reports", contractReports.createReport);
app.get("/contract-monitoring/reports/:id", contractReports.getReport);
app.patch("/contract-monitoring/reports/:id", contractReports.updateReport);
app.get(
  "/contract-monitoring/suppliers/:supplierId/contracts",
  contractReports.supplierContracts,
);
app.get("/hotel-options", hotelOptions.listHotelOptions);
app.post("/hotel-options/import", hotelOptions.importHotelOptions);
app.post("/hotel-options", hotelOptions.saveManualOption);
app.get("/hotel-options/link-search", hotelOptions.searchLinks);
app.get("/hotel-options/:id/history", hotelOptions.optionHistory);
app.patch("/hotel-options/:id/supplier", hotelOptions.assignHotelOption);
app.patch("/hotel-options/:id", hotelOptions.saveManualOption);
app.delete("/hotel-options/:id", hotelOptions.deleteHotelOption);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Backend Express berhasil berjalan!",
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res
      .status(413)
      .json({ success: false, message: "Ukuran file maksimal 10 MB." });
  }
  return res
    .status(500)
    .json({ success: false, message: "Terjadi kesalahan pada server." });
});

(async () => {
  try {
    await runMigrations();
    await recoverInterruptedScans();
    console.log("✅ Migrasi selesai");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Gagal start server:", err.message);
    process.exit(1);
  }
})();
