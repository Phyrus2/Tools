const express = require("express");
const runMigrations = require("./Database/migrate");
require("dotenv").config();
const cors = require("cors");


// SUPPLIER API
const supplier = require("./Controller/data_analyst/excel/Supplier/upload_supplier");



// // PRODUCT API
const product = require("./Controller/data_analyst/excel/Product/upload_product");



// // BOOKED PRODUCT API
// const { importBookedProduct } = require("./Controller/data_analyst/excel/mapping_booked_product");


const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

//SUPPLIER
app.post("/supplier/import", supplier.importSupplier);

//PRODUCT
app.post("/product/import", product.importProduct);


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