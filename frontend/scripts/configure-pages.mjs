import { writeFileSync } from 'node:fs';

const apiUrl = new URL(process.env.API_URL || '');
if (apiUrl.protocol !== 'https:' || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
  throw new Error('API_URL must be an HTTPS URL without credentials, query, or fragment.');
}
writeFileSync(new URL('../dist/frontend/browser/api-config.js', import.meta.url),
  `window.__APP_CONFIG__ = ${JSON.stringify({ apiUrl: apiUrl.href.replace(/\/+$/, '') })};\n`);
