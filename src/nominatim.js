/**
 * Nominatim (OpenStreetMap's own search) as a fallback source.
 *
 * Overpass is the better tool for "everything inside a radius", but its
 * public instances sometimes report that every query worker is busy. When
 * that happens we ask Nominatim for pharmacies inside the same square, which
 * it answers from the same OpenStreetMap data with opening hours included.
 */
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'nearest-pharmacy-web/1.0 (contact@senoldogan.dev)';
const MIN_INTERVAL_MS = 1100; // Nominatim's usage policy: at most one request a second

let lastRequestAt = 0;

/** Square around the origin, as Nominatim's viewbox (left, top, right, bottom). */
export function viewboxFor({ lat, lon, radius }) {
  const latDelta = radius / 111_320;
  const lonDelta = radius / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lon - lonDelta, lat + latDelta, lon + lonDelta, lat - latDelta]
    .map((n) => n.toFixed(6))
    .join(',');
}

/** @param {any[]} rows Nominatim jsonv2 rows */
export function parseNominatimPharmacies(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.category === 'amenity' && row.type === 'pharmacy')
    .map((row) => {
      const tags = row.extratags ?? {};
      const address = row.address ?? {};
      const street = [address.road, address.house_number].filter(Boolean).join(' ');
      const city = [address.postcode, address.city ?? address.town ?? address.village]
        .filter(Boolean)
        .join(' ');
      const parts = [street, city].filter(Boolean);
      return {
        id: `${row.osm_type ?? 'osm'}/${row.osm_id ?? row.place_id}`,
        name: (row.name || address.amenity || 'Pharmacy').trim(),
        lat: Number(row.lat),
        lon: Number(row.lon),
        address: parts.length > 0 ? parts.join(', ') : null,
        openingHours: tags.opening_hours ?? null,
        phone: tags.phone ?? tags['contact:phone'] ?? null,
        website: tags.website ?? tags['contact:website'] ?? null,
        wheelchair: tags.wheelchair === 'yes' ? true : tags.wheelchair === 'no' ? false : null,
      };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * @param {{lat:number, lon:number, radius:number, fetchImpl?:typeof fetch}} args
 */
export async function findPharmaciesWithNominatim({ lat, lon, radius, fetchImpl = fetch }) {
  await throttle();
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', 'pharmacy');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '50');
  url.searchParams.set('bounded', '1');
  url.searchParams.set('viewbox', viewboxFor({ lat, lon, radius }));
  url.searchParams.set('extratags', '1');
  url.searchParams.set('addressdetails', '1');

  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
  return parseNominatimPharmacies(await response.json());
}

async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}
