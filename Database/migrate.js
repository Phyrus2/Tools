const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureDatabaseExists() {
  // Koneksi sementara TANPA database, hanya untuk memastikan database-nya ada
  const rootConnection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
  });

  try {
    await rootConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``
    );
    console.log(`✅ Database "${process.env.DB_NAME}" siap dipakai`);
  } finally {
    await rootConnection.end();
  }
}

async function runMigrations() {
  // 1. Pastikan database ada DULU, sebelum pool di connection.js dibuat
  await ensureDatabaseExists();

  // 2. Baru require pool dari connection.js (database sudah pasti ada)
  const pool = require('./connection');

  try {
    // 3. Buat tabel pencatat migration kalau belum ada
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Ambil daftar migration yang sudah dijalankan
    const [executedRows] = await pool.query('SELECT name FROM migrations');
    const executedNames = executedRows.map(row => row.name);

    // 5. Baca semua file .sql, urutkan berdasarkan nama (001, 002, dst)
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(file => file.endsWith('.sql'))
      .sort();

    let ranCount = 0;

    for (const file of files) {
      if (executedNames.includes(file)) {
        console.log(`⏭️  Skip (sudah dijalankan): ${file}`);
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`▶️  Menjalankan: ${file}`);
      await pool.query(sql);
      await pool.query('INSERT INTO migrations (name) VALUES (?)', [file]);

      console.log(`✅ Selesai: ${file}`);
      ranCount++;
    }

    if (ranCount === 0) {
      console.log('✨ Tidak ada migration baru. Database sudah up to date.');
    } else {
      console.log(`🎉 ${ranCount} migration berhasil dijalankan.`);
    }
  } catch (err) {
    console.error('❌ Migration gagal:', err.message);
    throw err;
  }
}

module.exports = runMigrations;

// Kalau file ini dijalankan langsung lewat `node migrate.js`
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}