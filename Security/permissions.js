const PERMISSIONS = Object.freeze([
  { key: 'supplier_import', group: 'Import', label: 'Supplier Import' },
  { key: 'product_import', group: 'Import', label: 'Product Import' },
  { key: 'booked_product_import', group: 'Import', label: 'Booked Product Import' },
  { key: 'booking_search', group: 'Search', label: 'Booked Product Search' },
  { key: 'catalog_search', group: 'Search', label: 'Supplier & Product Search' },
  { key: 'analytics', group: 'Analytics', label: 'Performance Analytics' },
  { key: 'contract_monitoring', group: 'Contracts', label: 'Contract Monitoring' },
  { key: 'hotel_options', group: 'Contracts', label: 'Hotel Options' },
  { key: 'stop_sales', group: 'Contracts', label: 'Stop Sale Monitoring' },
  { key: 'user_management', group: 'Administration', label: 'User Management' },
]);

const PERMISSION_KEYS = Object.freeze(PERMISSIONS.map((permission) => permission.key));
const PERMISSION_KEY_SET = new Set(PERMISSION_KEYS);

function normalizePermissions(value) {
  if (!Array.isArray(value)) {
    const error = new Error('Permissions harus berupa array.');
    error.statusCode = 400;
    throw error;
  }
  const normalized = [...new Set(value.map((item) => String(item).trim()))];
  const invalid = normalized.find((permission) => !PERMISSION_KEY_SET.has(permission));
  if (invalid) {
    const error = new Error(`Permission tidak dikenal: ${invalid}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function hasAnyPermission(user, requiredPermissions) {
  if (user?.role === 'ADMIN') return true;
  const granted = new Set(user?.permissions || []);
  return requiredPermissions.some((permission) => granted.has(permission));
}

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_KEY_SET,
  normalizePermissions,
  hasAnyPermission,
};
