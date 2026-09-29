const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERMISSION_KEYS,
  normalizePermissions,
  hasAnyPermission,
} = require('../Security/permissions');

test('permission catalog contains unique stable keys', () => {
  assert.equal(new Set(PERMISSION_KEYS).size, PERMISSION_KEYS.length);
  assert.ok(PERMISSION_KEYS.includes('user_management'));
  assert.ok(PERMISSION_KEYS.includes('contract_monitoring'));
});

test('permission normalization rejects unknown keys and removes duplicates', () => {
  assert.deepEqual(normalizePermissions(['analytics', 'analytics', 'catalog_search']), [
    'analytics',
    'catalog_search',
  ]);
  assert.throws(() => normalizePermissions(['not_a_real_permission']), /tidak dikenal/);
  assert.throws(() => normalizePermissions('analytics'), /harus berupa array/);
});

test('admins bypass page grants while users need one matching permission', () => {
  assert.equal(hasAnyPermission({ role: 'ADMIN', permissions: [] }, ['user_management']), true);
  assert.equal(hasAnyPermission({ role: 'USER', permissions: ['analytics'] }, ['analytics']), true);
  assert.equal(hasAnyPermission({ role: 'USER', permissions: ['analytics'] }, ['hotel_options']), false);
});
