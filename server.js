const express = require("express");
const runMigrations = require("./Database/migrate");
require("dotenv").config();
const cors = require("cors");
const auth = require("./Security/auth");
const userAdmin = require("./Controller/admin/users");
const profile = require("./Controller/profile");

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
app.get("/auth/me", auth.requireAuth, auth.me);
app.post("/auth/logout", auth.requireAuth, auth.logout);

app.use(auth.requireAuth);

// SELF-SERVICE PROFILE
app.patch("/profile", profile.updateProfile);
app.post("/profile/change-password", profile.changePassword);

// USER MANAGEMENT
app.get("/admin/permissions", auth.requirePermission("user_management"), userAdmin.listPermissionCatalog);
app.get("/admin/users", auth.requirePermission("user_management"), userAdmin.listUsers);
app.post("/admin/users", auth.requirePermission("user_management"), userAdmin.createUser);
app.patch("/admin/users/:id", auth.requirePermission("user_management"), userAdmin.updateUser);
app.put("/admin/users/:id/permissions", auth.requirePermission("user_management"), userAdmin.updatePermissions);
app.post("/admin/users/:id/reset-password", auth.requirePermission("user_management"), userAdmin.resetPassword);
app.post("/admin/users/:id/logout-sessions", auth.requirePermission("user_management"), userAdmin.logoutSessions);

//SUPPLIER
app.post("/supplier/import", auth.requirePermission("supplier_import"), supplier.importSupplier);
app.get("/supplier/import/latest", auth.requirePermission("supplier_import"), supplier.getLatestSupplierImport);
app.post("/supplier/import/:importId/undo", auth.requirePermission("supplier_import"), supplier.undoSupplierImport);

//PRODUCT
app.post("/product/import", auth.requirePermission("product_import"), product.importProduct);
app.post("/product/manual", auth.requirePermission("product_import"), contractReportImport.createManualProduct);

//BOOKED PRODUCT
app.post("/booked-product/import", auth.requirePermission("booked_product_import"), booked_product.importBookedProduct);
app.post("/booked-product/manual", auth.requirePermission("booked_product_import"), booked_product.createManualBookedProduct);
app.get(
  "/booked-product/import/status",
  auth.requirePermission("booked_product_import", "booking_search"),
  booked_product.getBookedProductImportStatus,
);

//SEARCH BOOKED PRODUCT
app.get("/booked-product/search", auth.requirePermission("booking_search"), search.searchBookedProduct);

// SEARCH MASTER SUPPLIER / PRODUCT
app.get("/catalog/search", auth.requirePermission("catalog_search"), catalogSearch.searchCatalog);
app.get("/catalog/categories", auth.requirePermission("catalog_search"), catalogSearch.getCatalogCategories);
app.patch("/catalog/suppliers/:supplierId/status", auth.requirePermission("catalog_search"), catalogSearch.updateSupplierStatus);

// SUPPLIER & PRODUCT PERFORMANCE ANALYTICS
app.get("/analytics/overview", auth.requirePermission("analytics"), performanceAnalytics.overview);
app.get(
  "/analytics/suppliers/:supplierId",
  auth.requirePermission("analytics"),
  performanceAnalytics.supplierDetail,
);
app.get("/analytics/products/:productId", auth.requirePermission("analytics"), performanceAnalytics.productDetail);
app.patch("/analytics/suppliers/:supplierId", auth.requirePermission("analytics"), recordDetails.updateSupplier);
app.patch("/analytics/products/:productId", auth.requirePermission("analytics"), recordDetails.updateProduct);
app.get("/booked-product/:bookedProductId", auth.requirePermission("analytics", "booking_search", "booked_product_import"), recordDetails.getBookedProduct);
app.patch(
  "/booked-product/:bookedProductId",
  auth.requirePermission("analytics", "booked_product_import"),
  recordDetails.updateBookedProduct,
);

// CONTRACT MONITORING
app.use("/contract-monitoring", auth.requirePermission("contract_monitoring"));
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
app.delete(
  "/contract-monitoring/pending/:id/suppliers/:pendingSupplierId",
  contractPending.removePendingSupplier,
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
app.delete(
  "/contract-monitoring/management-groups/:id",
  contractGroups.deleteGroup,
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
app.post(
  "/contract-monitoring/reports/one-time",
  contractReportImport.addOneTimeSupplier,
);
app.post("/contract-monitoring/products/manual", contractReportImport.createManualProduct);
app.post("/contract-monitoring/reports", contractReports.createReport);
app.get("/contract-monitoring/reports/:id", contractReports.getReport);
app.patch("/contract-monitoring/reports/:id", contractReports.updateReport);
app.get(
  "/contract-monitoring/suppliers/:supplierId/contracts",
  contractReports.supplierContracts,
);
app.get("/hotel-options", auth.requirePermission("hotel_options"), hotelOptions.listHotelOptions);
app.post("/hotel-options/import", auth.requirePermission("hotel_options"), hotelOptions.importHotelOptions);
app.post("/hotel-options/pending/:id/complete", auth.requirePermission("hotel_options"), contractPending.completeHotelOptionPending);
app.post("/hotel-options", auth.requirePermission("hotel_options"), hotelOptions.saveManualOption);
app.get("/hotel-options/link-search", auth.requirePermission("hotel_options"), hotelOptions.searchLinks);
app.get("/hotel-options/:id/history", auth.requirePermission("hotel_options"), hotelOptions.optionHistory);
app.patch("/hotel-options/:id/supplier", auth.requirePermission("hotel_options"), hotelOptions.assignHotelOption);
app.patch("/hotel-options/:id", auth.requirePermission("hotel_options"), hotelOptions.saveManualOption);
app.delete("/hotel-options/:id", auth.requirePermission("hotel_options"), hotelOptions.deleteHotelOption);

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
  if (Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 500) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }
  return res
    .status(500)
    .json({ success: false, message: "Terjadi kesalahan pada server." });
});

(async () => {
  try {
    await runMigrations();
    const managementBackfill = await contractGroups.backfillPendingManagementGroups();
    if (
      managementBackfill.pending ||
      managementBackfill.unlinked ||
      managementBackfill.skipped
    ) {
      console.log(
        `Management group backfill: ${managementBackfill.pending} pending linked, ` +
          `${managementBackfill.groupsCreated} groups created, ` +
          `${managementBackfill.membersAdded} members added, ` +
          `${managementBackfill.unlinked} unconfirmed pending unlinked, ` +
          `${managementBackfill.skipped} skipped.`,
      );
    }
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
