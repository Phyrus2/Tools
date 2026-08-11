const express = require("express");
const runMigrations = require("./Database/migrate");
const { importExcel } = require("./Controller/data_analyst/excel/mapping");
const { importProduct } = require("./Controller/data_analyst/excel/mapping_product");
const { importBookedProduct } = require("./Controller/data_analyst/excel/mapping_booked_product");
require("dotenv").config();

const app = express();
app.use(express.json());

app.get("/users", async (req, res) => {
  const pool = require("./connection");
  try {
    const [rows] = await pool.query("SELECT * FROM users");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await runMigrations();
    console.log("✅ Migrasi selesai");

    await importExcel();
    console.log("✅ Import excel selesai");

    await importProduct();
    console.log("✅ Import product selesai");

    await importBookedProduct();
    console.log("✅ Import booked product selesai");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Gagal start server:", err.message);
    process.exit(1);
  }
})();