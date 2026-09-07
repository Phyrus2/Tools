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

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4200')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  });
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin tidak diizinkan oleh CORS.'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400,
}));
app.use(express.json({ limit: '16kb', type: 'application/json' }));

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Backend Express berhasil berjalan!' });
});

app.post('/auth/login', auth.login);
app.get('/auth/me', auth.requireAdmin, auth.me);
app.post('/auth/logout', auth.requireAdmin, auth.logout);

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


app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Backend Express berhasil berjalan!'
    });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: 'Ukuran file maksimal 10 MB.' });
  }
  return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
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
