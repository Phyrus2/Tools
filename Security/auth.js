const crypto = require('crypto');
const pool = require('../Database/connection');
const { verifyPassword } = require('./password');

const SESSION_HOURS = 8;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const loginWindows = new Map();
let activePasswordChecks = 0;

function clientKey(req) {
  const cloudflareIp = process.env.TRUST_CLOUDFLARE_IP_HEADER === 'true'
    ? req.get('cf-connecting-ip')
    : null;
  return crypto.createHash('sha256').update(String(cloudflareIp || req.ip || 'unknown')).digest('hex');
}

function allowLoginAttempt(req) {
  const now = Date.now();
  const key = clientKey(req);
  const current = loginWindows.get(key);
  if (!current || now >= current.resetAt) {
    if (loginWindows.size > 10_000) loginWindows.clear();
    loginWindows.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= 30;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest();
}

function bearerToken(req) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') || '');
  return match?.[1] || null;
}

async function login(req, res) {
  res.set('Cache-Control', 'no-store');
  if (!allowLoginAttempt(req)) {
    return res.status(429).json({ success: false, message: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }
  if (activePasswordChecks >= 2) {
    return res.status(429).json({ success: false, message: 'Server sedang memproses login lain. Coba sebentar lagi.' });
  }

  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || username.length > 100 || !password || password.length > 128) {
    return res.status(401).json({ success: false, message: 'Username atau password salah.' });
  }

  const [rows] = await pool.execute(
    `SELECT id, fullname, username, password, role, status, failed_login_attempts, locked_until
     FROM users WHERE username = ? LIMIT 1`,
    [username],
  );
  const user = rows[0];
  activePasswordChecks += 1;
  let passwordValid;
  try {
    passwordValid = await verifyPassword(password, user?.password);
  } finally {
    activePasswordChecks -= 1;
  }
  const locked = user?.locked_until && new Date(user.locked_until).getTime() > Date.now();
  const eligible = user && user.status === 'ACTIVE' && user.role === 'ADMIN';

  if (!passwordValid || locked || !eligible) {
    if (user && !passwordValid) {
      await pool.execute(
        `UPDATE users
         SET failed_login_attempts = LEAST(failed_login_attempts + 1, 255),
             locked_until = CASE WHEN failed_login_attempts + 1 >= ?
               THEN DATE_ADD(NOW(), INTERVAL ? MINUTE) ELSE locked_until END
         WHERE id = ?`,
        [MAX_FAILURES, LOCK_MINUTES, user.id],
      );
    }
    return res.status(401).json({ success: false, message: 'Username atau password salah.' });
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = ?',
      [user.id],
    );
    await connection.execute('DELETE FROM admin_sessions WHERE user_id = ? OR expires_at <= NOW()', [user.id]);
    await connection.execute(
      `INSERT INTO admin_sessions (user_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [user.id, tokenHash(token), SESSION_HOURS],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return res.json({
    success: true,
    token,
    expiresInSeconds: SESSION_HOURS * 3600,
    user: { id: user.id, fullname: user.fullname, username: user.username, role: user.role },
  });
}

async function requireAdmin(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ success: false, message: 'Sesi tidak valid atau telah berakhir.' });

  const [rows] = await pool.execute(
    `SELECT s.id AS session_id, u.id, u.fullname, u.username, u.role
     FROM admin_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()
       AND u.status = 'ACTIVE' AND u.role = 'ADMIN' LIMIT 1`,
    [tokenHash(token)],
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ success: false, message: 'Sesi tidak valid atau telah berakhir.' });

  req.admin = { id: user.id, fullname: user.fullname, username: user.username, role: user.role };
  req.sessionId = user.session_id;
  await pool.execute('UPDATE admin_sessions SET last_used_at = NOW() WHERE id = ?', [user.session_id]);
  return next();
}

async function logout(req, res) {
  await pool.execute('DELETE FROM admin_sessions WHERE id = ?', [req.sessionId]);
  return res.json({ success: true });
}

function me(req, res) {
  return res.json({ success: true, user: req.admin });
}

module.exports = { login, logout, me, requireAdmin };
