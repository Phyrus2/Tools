const pool = require("../../Database/connection");
const { normalizeName, todayWita } = require("../../Utils/contract_monitoring");
const { badRequest, isValidationError, parseId, textValue } = require("./common");

function supplierIds(value) {
  if (!Array.isArray(value)) throw new Error("Supplier IDs harus berupa array.");
  const ids = Array.from(new Set(value.map(parseId)));
  if (ids.some((id) => !id)) throw new Error("Supplier ID tidak valid.");
  return ids;
}

function pendingIds(value) {
  if (!Array.isArray(value) || !value.length)
    throw new Error("Pilih minimal satu pending item.");
  const ids = Array.from(new Set(value.map(parseId)));
  if (ids.some((id) => !id)) throw new Error("Pending item ID tidak valid.");
  return ids;
}

async function ensureSuppliers(connection, ids) {
  if (!ids.length) return;
  const [rows] = await connection.execute(
    `SELECT supplier_id FROM suppliers WHERE supplier_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  if (rows.length !== ids.length) throw new Error("Sebagian supplier tidak ditemukan.");
}

async function applyMembers(connection, groupId, desiredIds, userId) {
  await ensureSuppliers(connection, desiredIds);
  const [currentRows] = await connection.execute(
    `SELECT id, supplier_id FROM supplier_management_group_history
      WHERE group_id = ? AND end_date IS NULL FOR UPDATE`,
    [groupId],
  );
  const currentIds = new Set(currentRows.map((row) => row.supplier_id));
  const desired = new Set(desiredIds);
  const date = todayWita();
  const removed = currentRows.filter((row) => !desired.has(row.supplier_id));
  const added = desiredIds.filter((id) => !currentIds.has(id));
  for (const row of removed) {
    await connection.execute(
      "UPDATE supplier_management_group_history SET end_date = ? WHERE id = ?",
      [date, row.id],
    );
  }
  for (const id of added) {
    const [result] = await connection.execute(
      `UPDATE supplier_management_group_history
          SET end_date = NULL, created_by = ?
        WHERE supplier_id = ? AND group_id = ? AND start_date = ?`,
      [userId, id, groupId, date],
    );
    if (!result.affectedRows) {
      await connection.execute(
        `INSERT INTO supplier_management_group_history
           (supplier_id, group_id, start_date, created_by) VALUES (?, ?, ?, ?)`,
        [id, groupId, date, userId],
      );
    }
  }
  return { added, removed: removed.map((row) => row.supplier_id) };
}

async function listGroups(req, res) {
  try {
    const keyword = String(req.query.q || "").trim();
    const params = [];
    let where = "";
    if (keyword) {
      where = "WHERE g.name LIKE ?";
      params.push(`%${keyword.replace(/[\\%_]/g, "\\$&")}%`);
    }
    const [rows] = await pool.execute(
      `SELECT g.id, g.name, g.normalized_name, g.status, g.created_at, g.updated_at,
              COUNT(h.id) AS active_member_count
         FROM contract_management_groups g
         LEFT JOIN supplier_management_group_history h
           ON h.group_id = g.id AND h.end_date IS NULL
         ${where}
        GROUP BY g.id ORDER BY g.name`,
      params,
    );
    const [memberRows] = await pool.execute(
      `SELECT h.group_id, CONCAT('jambix-', h.supplier_id) AS member_key
         FROM supplier_management_group_history h
        WHERE h.end_date IS NULL
       UNION
       SELECT p.management_group_id AS group_id,
              CASE
                WHEN ps.supplier_id IS NOT NULL THEN CONCAT('jambix-', ps.supplier_id)
                WHEN TRIM(COALESCE(ps.detected_supplier_name, '')) <> ''
                  THEN CONCAT('detected-', LOWER(TRIM(ps.detected_supplier_name)))
                ELSE CONCAT('pending-', p.id)
              END AS member_key
         FROM contract_pending p
         JOIN contract_pending_suppliers ps ON ps.pending_id = p.id
        WHERE p.management_group_id IS NOT NULL
          AND p.status NOT IN ('DONE', 'IGNORED')`,
    );
    const membersByGroup = new Map();
    for (const member of memberRows) {
      if (!membersByGroup.has(member.group_id))
        membersByGroup.set(member.group_id, new Set());
      membersByGroup.get(member.group_id).add(member.member_key);
    }
    for (const group of rows)
      group.active_member_count = membersByGroup.get(group.id)?.size || 0;
    return res.json({ success: true, groups: rows });
  } catch (error) {
    console.error("List contract management groups error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil management group." });
  }
}

async function createGroup(req, res) {
  const connection = await pool.getConnection();
  try {
    const name = textValue(req.body?.name, "Nama group", { required: true, max: 255 });
    const normalized = normalizeName(name, { keepGeneric: true, keepCompanySuffixes: true });
    if (!normalized) throw new Error("Nama group tidak valid.");
    const members = req.body?.supplier_ids === undefined ? [] : supplierIds(req.body.supplier_ids);
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO contract_management_groups (name, normalized_name, created_by)
       VALUES (?, ?, ?)`,
      [name, normalized, req.admin.id],
    );
    await applyMembers(connection, result.insertId, members, req.admin.id);
    await connection.commit();
    return res.status(201).json({ success: true, message: "Management group berhasil dibuat.", id: result.insertId });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "Nama management group sudah digunakan." });
    if (isValidationError(error) || /supplier|group/i.test(error.message || "")) return badRequest(res, error);
    console.error("Create contract management group error:", error);
    return res.status(500).json({ success: false, message: "Gagal membuat management group." });
  } finally {
    connection.release();
  }
}

async function assignPending(req, res) {
  const connection = await pool.getConnection();
  try {
    const selectedPendingIds = pendingIds(req.body?.pending_ids);
    const requestedGroupId = req.body?.group_id ? parseId(req.body.group_id) : null;
    const requestedName = requestedGroupId
      ? null
      : textValue(req.body?.name, "Nama group", { required: true, max: 255 });
    if (req.body?.group_id && !requestedGroupId)
      throw new Error("Management group ID tidak valid.");

    await connection.beginTransaction();
    const placeholders = selectedPendingIds.map(() => "?").join(",");
    const [pendingRows] = await connection.execute(
      `SELECT p.id, p.claimed_by, ps.supplier_id
         FROM contract_pending p
         JOIN contract_pending_suppliers ps ON ps.pending_id = p.id
        WHERE p.id IN (${placeholders}) AND p.status NOT IN ('DONE', 'IGNORED')
        FOR UPDATE`,
      selectedPendingIds,
    );
    const foundPendingIds = new Set(pendingRows.map((row) => row.id));
    if (foundPendingIds.size !== selectedPendingIds.length)
      throw new Error("Sebagian pending item tidak ditemukan atau sudah selesai.");
    if (pendingRows.some((row) => row.claimed_by && row.claimed_by !== req.admin.id))
      throw new Error("Sebagian pending item sedang diproses oleh user lain.");
    const selectedSupplierIds = Array.from(
      new Set(pendingRows.map((row) => row.supplier_id).filter(Boolean)),
    );
    let groupId = requestedGroupId;
    let groupName = requestedName;
    if (groupId) {
      const [groups] = await connection.execute(
        "SELECT id, name FROM contract_management_groups WHERE id = ? AND status = 'ACTIVE' FOR UPDATE",
        [groupId],
      );
      if (!groups.length) throw new Error("Management group tidak ditemukan atau tidak aktif.");
      groupName = groups[0].name;
      const [memberRows] = await connection.execute(
        "SELECT supplier_id FROM supplier_management_group_history WHERE group_id = ? AND end_date IS NULL",
        [groupId],
      );
      await applyMembers(
        connection,
        groupId,
        Array.from(new Set([...memberRows.map((row) => row.supplier_id), ...selectedSupplierIds])),
        req.admin.id,
      );
    } else {
      const normalized = normalizeName(groupName, {
        keepGeneric: true,
        keepCompanySuffixes: true,
      });
      if (!normalized) throw new Error("Nama group tidak valid.");
      const [created] = await connection.execute(
        `INSERT INTO contract_management_groups (name, normalized_name, created_by)
         VALUES (?, ?, ?)`,
        [groupName, normalized, req.admin.id],
      );
      groupId = created.insertId;
      await applyMembers(connection, groupId, selectedSupplierIds, req.admin.id);
    }

    await connection.execute(
      `UPDATE contract_pending
          SET is_management_contract = 1, management_group_id = ?, management_name = ?, version = version + 1
        WHERE id IN (${placeholders})`,
      [groupId, groupName, ...selectedPendingIds],
    );
    await connection.commit();
    return res.status(requestedGroupId ? 200 : 201).json({
      success: true,
      id: groupId,
      name: groupName,
      pending_count: selectedPendingIds.length,
      supplier_count: selectedSupplierIds.length,
      message: `${selectedPendingIds.length} pending item berhasil dimasukkan ke management ${groupName}.`,
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY")
      return res.status(409).json({ success: false, message: "Nama management group sudah digunakan." });
    if (isValidationError(error) || /pending|supplier|group|management|diproses/i.test(error.message || ""))
      return badRequest(res, error);
    console.error("Assign pending management group error:", error);
    return res.status(500).json({ success: false, message: "Gagal membuat management dari pending queue." });
  } finally {
    connection.release();
  }
}

async function getGroup(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Management group ID tidak valid." });
  try {
    const [groups] = await pool.execute("SELECT * FROM contract_management_groups WHERE id = ?", [id]);
    if (!groups.length) return res.status(404).json({ success: false, message: "Management group tidak ditemukan." });
    const [members] = await pool.execute(
      `SELECT s.supplier_id, s.company_name, s.category_supplier, h.start_date
         FROM supplier_management_group_history h
         JOIN suppliers s ON s.supplier_id = h.supplier_id
        WHERE h.group_id = ? AND h.end_date IS NULL ORDER BY s.company_name`,
      [id],
    );
    return res.json({ success: true, group: { ...groups[0], members } });
  } catch (error) {
    console.error("Get contract management group error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil management group." });
  }
}

async function updateGroup(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Management group ID tidak valid." });
  try {
    const name = textValue(req.body?.name, "Nama group", { required: true, max: 255 });
    const normalized = normalizeName(name, { keepGeneric: true, keepCompanySuffixes: true });
    const status = String(req.body?.status || "ACTIVE").toUpperCase();
    if (!normalized || !["ACTIVE", "INACTIVE"].includes(status)) throw new Error("Nama atau status group tidak valid.");
    const [result] = await pool.execute(
      "UPDATE contract_management_groups SET name = ?, normalized_name = ?, status = ? WHERE id = ?",
      [name, normalized, status, id],
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "Management group tidak ditemukan." });
    return res.json({ success: true, message: "Management group berhasil diperbarui." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "Nama management group sudah digunakan." });
    if (isValidationError(error) || /group/i.test(error.message || "")) return badRequest(res, error);
    console.error("Update contract management group error:", error);
    return res.status(500).json({ success: false, message: "Gagal memperbarui management group." });
  }
}

async function updateMembers(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Management group ID tidak valid." });
  const connection = await pool.getConnection();
  try {
    const members = supplierIds(req.body?.supplier_ids);
    await connection.beginTransaction();
    const [groups] = await connection.execute("SELECT id FROM contract_management_groups WHERE id = ? FOR UPDATE", [id]);
    if (!groups.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Management group tidak ditemukan." });
    }
    const changes = await applyMembers(connection, id, members, req.admin.id);
    await connection.commit();
    return res.json({ success: true, message: "Anggota group berhasil diperbarui.", changes });
  } catch (error) {
    await connection.rollback();
    if (isValidationError(error) || /supplier/i.test(error.message || "")) return badRequest(res, error);
    console.error("Update contract management group members error:", error);
    return res.status(500).json({ success: false, message: "Gagal memperbarui anggota group." });
  } finally {
    connection.release();
  }
}

async function getHistory(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Management group ID tidak valid." });
  try {
    const [rows] = await pool.execute(
      `SELECT h.id, h.supplier_id, s.company_name, h.start_date, h.end_date,
              h.created_by, h.created_at
         FROM supplier_management_group_history h
         JOIN suppliers s ON s.supplier_id = h.supplier_id
        WHERE h.group_id = ? ORDER BY h.start_date DESC, h.id DESC`,
      [id],
    );
    return res.json({ success: true, history: rows });
  } catch (error) {
    console.error("Get contract management group history error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengambil riwayat group." });
  }
}

module.exports = { assignPending, createGroup, getGroup, getHistory, listGroups, updateGroup, updateMembers };
