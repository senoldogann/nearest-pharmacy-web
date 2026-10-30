import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNearbyPharmacies, HttpError } from './src/pharmacies.js';
import { geocodeAddress } from './src/geocode.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(here, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data: https://*.tile.openstreetmap.org https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "script-src 'self' https://unpkg.com",
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

/**
 * @param {{fetchImpl?: typeof fetch}} [options]
 * @returns {import('node:http').Server}
 */
export function createServer({ fetchImpl = fetch } = {}) {
  return createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, 'Method not allowed');
      }
      if (url.pathname === '/api/health') {
        return sendJson(res, 200, { ok: true });
      }
      if (url.pathname === '/api/pharmacies') {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        const radius = Number(url.searchParams.get('radius') ?? '2000');
        if (!url.searchParams.has('lat') || !url.searchParams.has('lon')) {
          throw new HttpError(400, 'lat and lon are required');
        }
        const result = await findNearbyPharmacies({ lat, lon, radius, fetchImpl });
        return sendJson(res, 200, result);
      }
      if (url.pathname === '/api/geocode') {
        const results = await geocodeAddress({ query: url.searchParams.get('q') ?? '', fetchImpl });
        return sendJson(res, 200, { results });
      }
      if (url.pathname.startsWith('/api/')) {
        throw new HttpError(404, 'Unknown endpoint');
      }
      return await sendStatic(res, url.pathname);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(err);
      return sendJson(res, status, { error: err.message ?? 'Something went wrong' });
    }
  });
}

async function sendStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 404, { error: 'Not found' });
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  createServer().listen(port, () => {
    console.log(`Nearest Pharmacy running at http://localhost:${port}`);
  });
}
