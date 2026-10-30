const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Great-circle distance between two WGS84 points, in metres.
 * @param {{lat:number, lon:number}} a
 * @param {{lat:number, lon:number}} b
 * @returns {number}
 */
export function distanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Sort a list of items that carry a `distanceMeters` field, nearest first. */
export function sortByDistance(items) {
  return [...items].sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** "350 m" under a kilometre, "1.2 km" above it. */
export function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

/** Keep the search radius in a range Overpass and the UI can live with. */
export function clampRadius(meters) {
  if (!Number.isFinite(meters)) return 2000;
  return Math.min(20_000, Math.max(200, Math.round(meters)));
}

export function isValidLat(lat) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLon(lon) {
  return Number.isFinite(lon) && lon >= -180 && lon <= 180;
}
