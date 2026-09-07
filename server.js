const express = require("express");
const runMigrations = require("./Database/migrate");
require("dotenv").config();
const cors = require("cors");


// SUPPLIER API
const supplier = require("./Controller/data_analyst/excel/Supplier/upload_supplier");



// // PRODUCT API
const product = require("./Controller/data_analyst/excel/Product/upload_product");



// // BOOKED PRODUCT API
const booked_product = require("./Controller/data_analyst/excel/Booked_Product/upload_booked_product");

// // SEARCH BOOKED PRODUCT API
const search = require("./Controller/search_booking/search");

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4200')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

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


app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Backend Express berhasil berjalan!'
    });
});

(async () => {
  try {
    await runMigrations();
    console.log("✅ Migrasi selesai");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Gagal start server:", err.message);
    process.exit(1);
  }
})();
