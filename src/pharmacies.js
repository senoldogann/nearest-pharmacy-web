import { clampRadius, isValidLat, isValidLon, distanceMeters, sortByDistance } from './geo.js';
import { buildPharmaciesQuery, parsePharmacies } from './overpass.js';
import { findPharmaciesWithNominatim } from './nominatim.js';

/**
 * Public Overpass instances, tried in order. The main instance is fast but
 * occasionally reports "all query workers are busy"; the mirrors cover that.
 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const USER_AGENT = 'nearest-pharmacy-web/1.0 (+https://github.com/senoldogann/nearest-pharmacy-web)';
const ATTEMPT_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

/** @type {Map<string, {expires:number, value:any}>} */
const cache = new Map();

/**
 * Pharmacies within `radius` metres of the origin, nearest first.
 * Results are cached for ten minutes per rounded location.
 *
 * @param {{lat:number, lon:number, radius?:number, fetchImpl?:typeof fetch, endpoints?:string[]}} args
 */
export async function findNearbyPharmacies({
  lat,
  lon,
  radius = 2000,
  fetchImpl = fetch,
  endpoints = OVERPASS_ENDPOINTS,
}) {
  if (!isValidLat(lat) || !isValidLon(lon)) {
    throw new HttpError(400, 'lat and lon must be valid WGS84 coordinates');
  }
  const r = clampRadius(radius);
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${r}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let found;
  let source = 'overpass';
  try {
    const payload = await queryOverpass({ lat, lon, radius: r, fetchImpl, endpoints });
    found = parsePharmacies(payload);
  } catch (err) {
    try {
      found = await findPharmaciesWithNominatim({ lat, lon, radius: r, fetchImpl });
      source = 'nominatim';
    } catch {
      throw new HttpError(503, err.message);
    }
  }

  const origin = { lat, lon };
  const pharmacies = sortByDistance(
    found
      .filter((p) => distanceMeters(origin, p) <= r)
      .map((p) => ({
        ...p,
        distanceMeters: Math.round(distanceMeters(origin, p)),
      })),
  );

  const value = { origin, radius: r, source, count: pharmacies.length, pharmacies };
  remember(key, value);
  return value;
}

async function queryOverpass({ lat, lon, radius, fetchImpl, endpoints }) {
  const body = new URLSearchParams({ data: buildPharmaciesQuery({ lat, lon, radius }) });
  const failures = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (!response.ok) {
        failures.push(`${new URL(endpoint).host}: ${response.status}`);
        continue;
      }
      return await response.json();
    } catch (err) {
      failures.push(`${new URL(endpoint).host}: ${err.name === 'TimeoutError' ? 'timeout' : err.message}`);
    }
  }

  throw new HttpError(
    503,
    'The OpenStreetMap pharmacy index is busy right now. Please try again in a minute.',
    failures,
  );
}

export function clearCache() {
  cache.clear();
}

function remember(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
