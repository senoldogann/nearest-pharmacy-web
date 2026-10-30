import { HttpError } from './pharmacies.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'nearest-pharmacy-web/1.0 (+https://github.com/senoldogann/nearest-pharmacy-web)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** @type {Map<string, {expires:number, value:any}>} */
const cache = new Map();

/**
 * Turn a typed address into coordinates. Nominatim asks for at most one
 * request per second, so results are cached for a day.
 *
 * @param {{query:string, fetchImpl?:typeof fetch}} args
 */
export async function geocodeAddress({ query, fetchImpl = fetch }) {
  const q = String(query ?? '').trim();
  if (q.length < 2) throw new HttpError(400, 'Type at least two characters');
  if (q.length > 200) throw new HttpError(400, 'That address is too long');

  const hit = cache.get(q.toLowerCase());
  if (hit && hit.expires > Date.now()) return hit.value;

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '0');

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new HttpError(502, `Address search failed: ${err.message}`);
  }
  if (!response.ok) throw new HttpError(502, `Address search answered ${response.status}`);

  const rows = await response.json();
  const results = (Array.isArray(rows) ? rows : []).map((row) => ({
    label: row.display_name,
    lat: Number(row.lat),
    lon: Number(row.lon),
  })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));

  cache.set(q.toLowerCase(), { expires: Date.now() + CACHE_TTL_MS, value: results });
  return results;
}
