import { readFileSync, writeFileSync } from 'node:fs';

const apiUrl = new URL(process.env.API_URL || '');
if (apiUrl.protocol !== 'https:' || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
  throw new Error('API_URL must be an HTTPS URL without credentials, query, or fragment.');
}
const outputDirectory = new URL('../dist/frontend/browser/', import.meta.url);
writeFileSync(new URL('api-config.js', outputDirectory),
  `window.__APP_CONFIG__ = ${JSON.stringify({ apiUrl: apiUrl.href.replace(/\/+$/, '') })};\n`);

// GitHub Pages may cache this small file after a tunnel URL changes. A unique
// query value on every deployment makes browsers fetch the current API URL.
const buildId = String(process.env.BUILD_ID || Date.now()).replace(/[^A-Za-z0-9_.-]/g, '');
const indexPath = new URL('index.html', outputDirectory);
const indexHtml = readFileSync(indexPath, 'utf8').replace(
  /api-config\.js(?:\?v=[^"']*)?/,
  `api-config.js?v=${buildId}`,
);
writeFileSync(indexPath, indexHtml);
