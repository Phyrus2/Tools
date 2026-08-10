const express = require("express");
const runMigrations = require("./Database/migrate");
const { importExcel } = require("./Controller/data_analyst/excel/mapping");
const { importProduct } = require("./Controller/data_analyst/excel/mapping_product");
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
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
    
    await importProduct();
  } catch (err) {
    console.error("Gagal start server:", err.message);
    process.exit(1);
  }
})();
