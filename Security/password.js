const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const DUMMY_HASH = 'scrypt$131072$8$1$STpvR2RBMkJWYVFxTkg3d1VWaA$UvkUExbsqvCYx0qZ8Lkd4fI5oW0V2gVBCcH3xbklgWYlpeDFU4bDEi7G+Wt59kEExZJKtDnk0s+8RWjbrI25pA';

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 128) {
    throw new Error('Password harus terdiri dari 14 sampai 128 karakter.');
  }
  const common = ['password', 'admin123', 'qwerty', 'letmein'];
  const lowered = password.toLowerCase();
  if (common.some((word) => lowered.includes(word))) {
    throw new Error('Password terlalu mudah ditebak. Hindari kata umum seperti password atau admin.');
  }
}

async function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function verifyPassword(password, encodedHash) {
  const value = typeof encodedHash === 'string' && encodedHash.startsWith('scrypt$')
    ? encodedHash
    : DUMMY_HASH;
  const parts = value.split('$');
  if (parts.length !== 6) return false;

  const [, n, r, p, saltValue, hashValue] = parts;
  const expected = Buffer.from(hashValue, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;

  try {
    const actual = await scrypt(String(password), Buffer.from(saltValue, 'base64url'), KEY_LENGTH, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, expected) && value === encodedHash;
  } catch {
    return false;
  }
}

module.exports = { hashPassword, validatePassword, verifyPassword };
