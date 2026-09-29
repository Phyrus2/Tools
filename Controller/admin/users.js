const pool = require('../../Database/connection');
const { hashPassword, validatePassword } = require('../../Security/password');
const { PERMISSIONS, PERMISSION_KEYS, normalizePermissions } = require('../../Security/permissions');

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,100}$/;
const MANAGED_ROLES = new Set(['ADMIN', 'USER']);
const MANAGED_STATUSES = new Set(['ACTIVE', 'INACTIVE']);

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanFullname(value) {
  const fullname = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (fullname.length < 2 || fullname.length > 150) {
    throw httpError(400, 'Nama lengkap harus terdiri dari 2 sampai 150 karakter.');
  }
  return fullname;
}

function cleanUsername(value) {
  const username = typeof value === 'string' ? value.trim() : '';
  if (!USERNAME_PATTERN.test(username)) {
    throw httpError(400, 'Username harus 3-100 karakter dan hanya boleh berisi huruf, angka, titik, underscore, atau tanda minus.');
  }
  return username;
}

function cleanRole(value) {
  const role = String(value || 'USER').toUpperCase();
  if (!MANAGED_ROLES.has(role)) throw httpError(400, 'Role tidak valid.');
  return role;
}

function cleanStatus(value) {
  const status = String(value || 'ACTIVE').toUpperCase();
  if (!MANAGED_STATUSES.has(status)) throw httpError(400, 'Status tidak valid.');
  return status;
}

function assertCanManageRole(actor, targetRole, requestedRole = targetRole) {
  if (actor.role !== 'ADMIN' && (targetRole === 'ADMIN' || requestedRole === 'ADMIN')) {
    throw httpError(403, 'Hanya admin yang dapat membuat atau mengubah akun admin.');
  }
}

function assertCanManageTarget(actor, target) {
  if (actor.role !== 'ADMIN' && (target.role === 'ADMIN' || Boolean(target.manages_users))) {
    throw httpError(403, 'Hanya admin yang dapat mengubah akun dengan hak administrasi.');
  }
}

function assertCanGrantPermissions(actor, permissions) {
  if (actor.role !== 'ADMIN' && permissions.includes('user_management')) {
    throw httpError(403, 'Hanya admin yang dapat memberikan akses User Management.');
  }
}

async function audit(connection, actorId, targetId, action, details = null) {
  await connection.execute(
    `INSERT INTO user_management_audit (actor_user_id, target_user_id, action, details)
     VALUES (?, ?, ?, ?)`,
    [actorId, targetId, action, details ? JSON.stringify(details) : null],
  );
}

async function replacePermissions(connection, userId, permissions, actorId) {
  await connection.execute('DELETE FROM user_permissions WHERE user_id = ?', [userId]);
  for (const permission of permissions) {
    await connection.execute(
      'INSERT INTO user_permissions (user_id, permission_key, granted_by) VALUES (?, ?, ?)',
      [userId, permission, actorId],
    );
  }
}

async function activeAdminIdsForUpdate(connection) {
  const [rows] = await connection.execute(
    `SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE`,
  );
  return rows.map((row) => Number(row.id));
}

async function getTargetForUpdate(connection, userId) {
  const [rows] = await connection.execute(
    `SELECT u.id, u.fullname, u.username, u.role, u.status,
            EXISTS(
              SELECT 1 FROM user_permissions p
              WHERE p.user_id = u.id AND p.permission_key = 'user_management'
            ) AS manages_users
     FROM users u WHERE u.id = ? FOR UPDATE`,
    [userId],
  );
  if (!rows[0]) throw httpError(404, 'User tidak ditemukan.');
  return rows[0];
}

async function validatedPasswordHash(password) {
  try {
    validatePassword(password);
  } catch (error) {
    throw httpError(400, error.message);
  }
  return hashPassword(password);
}

function serializeUser(row, permissionMap) {
  return {
    id: Number(row.id),
    fullname: row.fullname,
    username: row.username,
    role: row.role,
    status: row.status,
    last_login: row.last_login,
    created_at: row.created_at,
    updated_at: row.updated_at,
    permissions: row.role === 'ADMIN' ? [...PERMISSION_KEYS] : (permissionMap.get(Number(row.id)) || []),
  };
}

async function listPermissionCatalog(req, res) {
  return res.json({ success: true, permissions: PERMISSIONS });
}

async function listUsers(req, res) {
  const [users] = await pool.execute(
    `SELECT id, fullname, username, role, status, last_login, created_at, updated_at
     FROM users ORDER BY fullname, username`,
  );
  const [permissionRows] = await pool.execute(
    'SELECT user_id, permission_key FROM user_permissions ORDER BY permission_key',
  );
  const permissionMap = new Map();
  for (const row of permissionRows) {
    const userId = Number(row.user_id);
    const current = permissionMap.get(userId) || [];
    current.push(row.permission_key);
    permissionMap.set(userId, current);
  }
  return res.json({
    success: true,
    users: users.map((user) => serializeUser(user, permissionMap)),
  });
}

async function createUser(req, res) {
  const fullname = cleanFullname(req.body?.fullname);
  const username = cleanUsername(req.body?.username);
  const role = cleanRole(req.body?.role);
  const status = cleanStatus(req.body?.status);
  const permissions = normalizePermissions(req.body?.permissions || []);
  assertCanManageRole(req.admin, 'USER', role);
  assertCanGrantPermissions(req.admin, permissions);
  const passwordHash = await validatedPasswordHash(req.body?.password);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO users (fullname, username, password, role, status)
       VALUES (?, ?, ?, ?, ?)`,
      [fullname, username, passwordHash, role, status],
    );
    const userId = Number(result.insertId);
    if (role !== 'ADMIN') await replacePermissions(connection, userId, permissions, req.admin.id);
    await audit(connection, req.admin.id, userId, 'USER_CREATED', { role, status, permissions });
    await connection.commit();
    return res.status(201).json({ success: true, userId });
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') throw httpError(409, 'Username sudah digunakan.');
    throw error;
  } finally {
    connection.release();
  }
}

async function updateUser(req, res) {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(userId) || userId < 1) throw httpError(400, 'ID user tidak valid.');
  if (userId === req.admin.id) throw httpError(400, 'Gunakan halaman My Profile untuk mengubah akun sendiri.');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const target = await getTargetForUpdate(connection, userId);
    assertCanManageTarget(req.admin, target);
    const fullname = req.body?.fullname === undefined ? target.fullname : cleanFullname(req.body.fullname);
    const username = req.body?.username === undefined ? target.username : cleanUsername(req.body.username);
    const role = req.body?.role === undefined ? target.role : cleanRole(req.body.role);
    const status = req.body?.status === undefined ? target.status : cleanStatus(req.body.status);
    assertCanManageRole(req.admin, target.role, role);

    if (target.role === 'ADMIN' && target.status === 'ACTIVE' && (role !== 'ADMIN' || status !== 'ACTIVE')) {
      const activeAdminIds = await activeAdminIdsForUpdate(connection);
      if (activeAdminIds.length <= 1) throw httpError(409, 'Admin aktif terakhir tidak dapat dinonaktifkan atau diturunkan rolenya.');
    }

    await connection.execute(
      `UPDATE users SET fullname = ?, username = ?, role = ?, status = ? WHERE id = ?`,
      [fullname, username, role, status, userId],
    );
    if (role === 'ADMIN') await connection.execute('DELETE FROM user_permissions WHERE user_id = ?', [userId]);
    await connection.execute('DELETE FROM admin_sessions WHERE user_id = ?', [userId]);
    await audit(connection, req.admin.id, userId, 'USER_UPDATED', {
      before: { fullname: target.fullname, username: target.username, role: target.role, status: target.status },
      after: { fullname, username, role, status },
    });
    await connection.commit();
    return res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') throw httpError(409, 'Username sudah digunakan.');
    throw error;
  } finally {
    connection.release();
  }
}

async function updatePermissions(req, res) {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(userId) || userId < 1) throw httpError(400, 'ID user tidak valid.');
  const permissions = normalizePermissions(req.body?.permissions);
  assertCanGrantPermissions(req.admin, permissions);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const target = await getTargetForUpdate(connection, userId);
    assertCanManageTarget(req.admin, target);
    assertCanManageRole(req.admin, target.role);
    if (target.role === 'ADMIN') throw httpError(400, 'Admin selalu memiliki seluruh akses dan tidak memakai permission khusus.');
    await replacePermissions(connection, userId, permissions, req.admin.id);
    await connection.execute('DELETE FROM admin_sessions WHERE user_id = ?', [userId]);
    await audit(connection, req.admin.id, userId, 'PERMISSIONS_UPDATED', { permissions });
    await connection.commit();
    return res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function resetPassword(req, res) {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(userId) || userId < 1) throw httpError(400, 'ID user tidak valid.');
  if (userId === req.admin.id) throw httpError(400, 'Gunakan halaman My Profile untuk mengganti password sendiri.');
  const passwordHash = await validatedPasswordHash(req.body?.password);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const target = await getTargetForUpdate(connection, userId);
    assertCanManageTarget(req.admin, target);
    assertCanManageRole(req.admin, target.role);
    await connection.execute(
      `UPDATE users SET password = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
      [passwordHash, userId],
    );
    await connection.execute('DELETE FROM admin_sessions WHERE user_id = ?', [userId]);
    await audit(connection, req.admin.id, userId, 'PASSWORD_RESET');
    await connection.commit();
    return res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function logoutSessions(req, res) {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(userId) || userId < 1) throw httpError(400, 'ID user tidak valid.');
  if (userId === req.admin.id) throw httpError(400, 'Gunakan tombol Log out untuk mengakhiri sesi akun sendiri.');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const target = await getTargetForUpdate(connection, userId);
    assertCanManageTarget(req.admin, target);
    assertCanManageRole(req.admin, target.role);
    await connection.execute('DELETE FROM admin_sessions WHERE user_id = ?', [userId]);
    await audit(connection, req.admin.id, userId, 'SESSIONS_REVOKED');
    await connection.commit();
    return res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  listPermissionCatalog,
  listUsers,
  createUser,
  updateUser,
  updatePermissions,
  resetPassword,
  logoutSessions,
};
