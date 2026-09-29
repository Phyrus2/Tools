const pool = require('../Database/connection');
const { hashPassword, validatePassword, verifyPassword } = require('../Security/password');

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,100}$/;
const verificationFailures = new Map();

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

function passwordVerificationAllowed(sessionId) {
  const now = Date.now();
  const current = verificationFailures.get(sessionId);
  if (!current || now >= current.resetAt) {
    verificationFailures.delete(sessionId);
    return true;
  }
  return current.count < 5;
}

function recordPasswordFailure(sessionId) {
  const now = Date.now();
  const current = verificationFailures.get(sessionId);
  if (!current || now >= current.resetAt) {
    verificationFailures.set(sessionId, { count: 1, resetAt: now + 15 * 60_000 });
  } else {
    current.count += 1;
  }
  if (verificationFailures.size > 10_000) verificationFailures.clear();
}

async function verifyCurrentPassword(sessionId, password, passwordHash) {
  if (!passwordVerificationAllowed(sessionId)) {
    throw httpError(429, 'Terlalu banyak percobaan password. Coba kembali dalam 15 menit.');
  }
  const valid = await verifyPassword(typeof password === 'string' ? password : '', passwordHash);
  if (!valid) {
    recordPasswordFailure(sessionId);
    throw httpError(400, 'Password saat ini tidak sesuai.');
  }
  verificationFailures.delete(sessionId);
}

async function audit(connection, actorId, action, details = null) {
  await connection.execute(
    `INSERT INTO user_management_audit (actor_user_id, target_user_id, action, details)
     VALUES (?, ?, ?, ?)`,
    [actorId, actorId, action, details ? JSON.stringify(details) : null],
  );
}

async function updateProfile(req, res) {
  const fullname = cleanFullname(req.body?.fullname);
  const username = cleanUsername(req.body?.username);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id, fullname, username, password FROM users WHERE id = ? FOR UPDATE',
      [req.admin.id],
    );
    const current = rows[0];
    if (!current) throw httpError(404, 'User tidak ditemukan.');
    await verifyCurrentPassword(req.sessionId, req.body?.currentPassword, current.password);

    await connection.execute(
      'UPDATE users SET fullname = ?, username = ? WHERE id = ?',
      [fullname, username, req.admin.id],
    );
    await connection.execute(
      'DELETE FROM admin_sessions WHERE user_id = ? AND id <> ?',
      [req.admin.id, req.sessionId],
    );
    await audit(connection, req.admin.id, 'PROFILE_UPDATED', {
      before: { fullname: current.fullname, username: current.username },
      after: { fullname, username },
    });
    await connection.commit();
    return res.json({
      success: true,
      user: { ...req.admin, fullname, username },
    });
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') throw httpError(409, 'Username sudah digunakan.');
    throw error;
  } finally {
    connection.release();
  }
}

async function changePassword(req, res) {
  const currentPassword = req.body?.currentPassword;
  const newPassword = req.body?.newPassword;
  if (typeof currentPassword === 'string' && currentPassword === newPassword) {
    throw httpError(400, 'Password baru harus berbeda dari password saat ini.');
  }
  try {
    validatePassword(newPassword);
  } catch (error) {
    throw httpError(400, error.message);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT password FROM users WHERE id = ? FOR UPDATE',
      [req.admin.id],
    );
    if (!rows[0]) throw httpError(404, 'User tidak ditemukan.');
    await verifyCurrentPassword(req.sessionId, currentPassword, rows[0].password);
    const passwordHash = await hashPassword(newPassword);

    await connection.execute(
      'UPDATE users SET password = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      [passwordHash, req.admin.id],
    );
    await connection.execute(
      'DELETE FROM admin_sessions WHERE user_id = ? AND id <> ?',
      [req.admin.id, req.sessionId],
    );
    await audit(connection, req.admin.id, 'SELF_PASSWORD_CHANGED');
    await connection.commit();
    return res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { updateProfile, changePassword };
