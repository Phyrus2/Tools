const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pool = require("../../Database/connection");
const {
  detectSignedStatus,
  normalizeWindowsPath,
  parseSqlUtc,
  parseWitaDateTime,
  toSqlUtc,
} = require("../../Utils/contract_monitoring");

const activeJobs = new Set();

function configuredServerId() {
  return String(process.env.SERVER_ID || "office").trim() || "office";
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest();
}

async function* walkFiles(directory) {
  const handle = await fs.promises.opendir(directory);
  for await (const entry of handle) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walkFiles(fullPath);
    else if (entry.isFile()) yield fullPath;
  }
}

function safeConfiguredRoot(source) {
  const yearRoot = path.resolve(source.base_path, String(source.year));
  if (path.isAbsolute(source.target_folder)) throw new Error("Target folder harus berupa path relatif.");
  const configuredRoot = path.resolve(yearRoot, source.target_folder);
  const relative = path.relative(yearRoot, configuredRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Target folder berada di luar base path yang dikonfigurasi.");
  }
  return configuredRoot;
}

async function upsertResult(connection, runId, source, filePath, stat) {
  const normalizedPath = normalizeWindowsPath(filePath);
  const pathHash = hash(normalizedPath);
  const fingerprint = hash(`${source.id}\0${normalizedPath}\0${Math.trunc(stat.mtimeMs)}\0${stat.size}`);
  const fileName = path.basename(filePath);
  const extension = path.extname(fileName).slice(1).toLowerCase() || null;
  const [result] = await connection.execute(
    `INSERT INTO contract_scan_results
       (source_id, full_path, parent_path, file_name, extension, date_modified_utc,
        file_size, path_hash, fingerprint, detected_signed_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), last_seen_at = CURRENT_TIMESTAMP(3)`,
    [
      source.id,
      filePath,
      path.dirname(filePath),
      fileName,
      extension,
      toSqlUtc(stat.mtime),
      stat.size,
      pathHash,
      fingerprint,
      detectSignedStatus(fileName),
    ],
  );
  await connection.execute(
    "INSERT IGNORE INTO contract_scan_run_results (scan_run_id, scan_result_id) VALUES (?, ?)",
    [runId, result.insertId],
  );
  return result.affectedRows === 1;
}

async function processSource(connection, run, source) {
  const sourceLink = run.sources.find((item) => item.id === source.id);
  const startMs = sourceLink.windowStart.getTime();
  const endMs = sourceLink.windowEnd.getTime();
  const warnings = [];
  let totalFiles = 0;
  let newFiles = 0;
  const root = safeConfiguredRoot(source);
  const realRoot = await fs.promises.realpath(root);

  try {
    for await (const filePath of walkFiles(realRoot)) {
      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch (error) {
        warnings.push({ path: filePath, message: error.message });
        continue;
      }
      if (stat.mtimeMs < startMs || stat.mtimeMs > endMs) continue;
      totalFiles += 1;
      try {
        if (await upsertResult(connection, run.id, source, filePath, stat)) newFiles += 1;
      } catch (error) {
        warnings.push({ path: filePath, message: error.message });
      }
    }
  } catch (error) {
    warnings.push({ path: realRoot, message: error.message });
  }

  if (warnings.length) {
    await connection.execute(
      `UPDATE contract_scan_run_sources
          SET status = 'FAILED', error_message = ?
        WHERE scan_run_id = ? AND source_id = ?`,
      [JSON.stringify(warnings.slice(0, 100)), run.id, source.id],
    );
  } else {
    await connection.execute(
      `UPDATE contract_scan_run_sources
          SET status = 'COMPLETED'
        WHERE scan_run_id = ? AND source_id = ?`,
      [run.id, source.id],
    );
    if (run.mode === "AUTO" || !sourceLink.checkpointBefore) {
      await connection.execute(
        `UPDATE contract_scan_sources
            SET last_successful_checkpoint_utc = ?, updated_by = ?
          WHERE id = ?`,
        [toSqlUtc(sourceLink.windowEnd), run.requestedBy, source.id],
      );
    }
  }

  return { totalFiles, newFiles, warnings };
}

async function executeScan(run) {
  let connection;
  const errors = [];
  let totalFiles = 0;
  let newFiles = 0;
  let warningCount = 0;
  try {
    connection = await pool.getConnection();
    await connection.execute(
      "UPDATE contract_scan_runs SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [run.id],
    );
    for (const source of run.sourceRows) {
      try {
        const result = await processSource(connection, run, source);
        totalFiles += result.totalFiles;
        newFiles += result.newFiles;
        warningCount += result.warnings.length;
        if (result.warnings.length) errors.push({ source_id: source.id, warnings: result.warnings.slice(0, 100) });
      } catch (error) {
        warningCount += 1;
        errors.push({ source_id: source.id, message: error.message });
        await connection.execute(
          `UPDATE contract_scan_run_sources SET status = 'FAILED', error_message = ?
            WHERE scan_run_id = ? AND source_id = ?`,
          [error.message, run.id, source.id],
        );
      }
    }
    const failedCount = errors.length;
    const status = failedCount === 0
      ? "COMPLETED"
      : failedCount === run.sourceRows.length ? "FAILED" : "PARTIAL";
    await connection.execute(
      `UPDATE contract_scan_runs
          SET status = ?, total_files = ?, new_files = ?, warning_count = ?,
              error_summary = ?, finished_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
      [status, totalFiles, newFiles, warningCount, errors.length ? JSON.stringify(errors) : null, run.id],
    );
  } catch (error) {
    if (connection) {
      await connection.execute(
        `UPDATE contract_scan_runs
            SET status = 'FAILED', error_summary = ?, finished_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?`,
        [JSON.stringify([{ message: error.message }]), run.id],
      );
    } else {
      console.error(`Contract scan ${run.id} could not acquire a database connection:`, error);
    }
  } finally {
    activeJobs.delete(run.id);
    connection?.release();
  }
}

async function createScan({ mode, start, end, sourceIds, requestedBy }) {
  const serverId = configuredServerId();
  const params = [serverId];
  const filters = ["server_id = ?", "enabled = 1", "deleted_at IS NULL", "module_key IN ('CONTRACT', 'QUOTE_TICKET')"];
  if (sourceIds?.length) {
    filters.push(`id IN (${sourceIds.map(() => "?").join(",")})`);
    params.push(...sourceIds);
  }
  const [sourceRows] = await pool.execute(
    `SELECT *, CAST(last_successful_checkpoint_utc AS CHAR) AS checkpoint_text
       FROM contract_scan_sources WHERE ${filters.join(" AND ")} ORDER BY year, id`,
    params,
  );
  if (!sourceRows.length) throw new Error("Tidak ada scan source aktif untuk server ini.");
  if (sourceIds?.length && sourceRows.length !== new Set(sourceIds).size) {
    throw new Error("Sebagian scan source tidak ditemukan atau tidak aktif.");
  }

  const capturedNow = new Date();
  let customStart = null;
  let customEnd = null;
  if (mode === "CUSTOM") {
    customStart = parseWitaDateTime(start, "Waktu mulai");
    customEnd = parseWitaDateTime(end, "Waktu selesai");
    if (customStart > customEnd) throw new Error("Waktu selesai tidak boleh lebih awal dari waktu mulai.");
  }

  const sources = sourceRows.map((source) => {
    const checkpointBefore = parseSqlUtc(source.checkpoint_text);
    if (mode === "AUTO" && !checkpointBefore) {
      throw new Error(`Source ${source.id} belum memiliki checkpoint. Jalankan custom scan terlebih dahulu.`);
    }
    return {
      id: source.id,
      checkpointBefore,
      windowStart: mode === "AUTO" ? checkpointBefore : customStart,
      windowEnd: mode === "AUTO" ? capturedNow : customEnd,
    };
  });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO contract_scan_runs
         (server_id, mode, requested_start_wita, requested_end_wita,
          captured_now_utc, status, requested_by)
       VALUES (?, ?, ?, ?, ?, 'QUEUED', ?)`,
      [
        serverId,
        mode,
        mode === "CUSTOM" ? String(start).replace("T", " ") : null,
        mode === "CUSTOM" ? String(end).replace("T", " ") : null,
        toSqlUtc(capturedNow),
        requestedBy,
      ],
    );
    for (const source of sources) {
      await connection.execute(
        `INSERT INTO contract_scan_run_sources
           (scan_run_id, source_id, window_start_utc, window_end_utc, checkpoint_before_utc)
         VALUES (?, ?, ?, ?, ?)`,
        [
          result.insertId,
          source.id,
          toSqlUtc(source.windowStart),
          toSqlUtc(source.windowEnd),
          source.checkpointBefore ? toSqlUtc(source.checkpointBefore) : null,
        ],
      );
    }
    await connection.commit();
    const run = {
      id: result.insertId,
      mode,
      requestedBy,
      sourceRows,
      sources,
    };
    activeJobs.add(run.id);
    setImmediate(() => {
      void executeScan(run).catch((error) => console.error(`Unhandled contract scan ${run.id} error:`, error));
    });
    return { id: run.id, serverId, sourceCount: sources.length };
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") throw new Error("Masih ada scan yang berjalan pada server ini.");
    throw error;
  } finally {
    connection.release();
  }
}

async function recoverInterruptedScans() {
  await pool.execute(
    `UPDATE contract_scan_runs
        SET status = 'FAILED', finished_at = CURRENT_TIMESTAMP(3),
            error_summary = JSON_ARRAY(JSON_OBJECT('message', 'Proses server berhenti saat scan berlangsung.'))
      WHERE server_id = ? AND status IN ('QUEUED', 'RUNNING')`,
    [configuredServerId()],
  );
}

module.exports = {
  configuredServerId,
  createScan,
  recoverInterruptedScans,
  safeConfiguredRoot,
};
