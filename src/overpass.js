/**
 * Overpass (OpenStreetMap) helpers.
 *
 * Every pharmacy in OpenStreetMap is tagged `amenity=pharmacy`. We ask for
 * nodes, ways and relations inside a radius, and ask Overpass to give the
 * centre point of ways and relations so one code path handles all three.
 */
const AMENITY = 'amenity="pharmacy"';

/**
 * @param {{lat:number, lon:number, radius:number}} q
 * @returns {string} Overpass QL
 */
export function buildPharmaciesQuery({ lat, lon, radius }) {
  const around = `(around:${Math.round(radius)},${lat},${lon})`;
  return `[out:json][timeout:25];
(
  node[${AMENITY}]${around};
  way[${AMENITY}]${around};
  relation[${AMENITY}]${around};
);
out center tags;`;
}

/**
 * @param {any} payload Parsed Overpass JSON
 * @returns {Array<{id:string, name:string, lat:number, lon:number, address:string|null, openingHours:string|null, phone:string|null, website:string|null}>}
 */
export function parsePharmacies(payload) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const seen = new Set();
  const out = [];

  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;
    const tags = el.tags ?? {};
    const lat = Number.isFinite(el.lat) ? el.lat : el.center?.lat;
    const lon = Number.isFinite(el.lon) ? el.lon : el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({
      id,
      name: (tags.name ?? tags['name:en'] ?? tags.brand ?? 'Pharmacy').trim(),
      lat,
      lon,
      address: formatAddress(tags),
      openingHours: tags.opening_hours ?? null,
      phone: tags.phone ?? tags['contact:phone'] ?? null,
      website: tags.website ?? tags['contact:website'] ?? null,
      wheelchair: tags.wheelchair === 'yes' ? true : tags.wheelchair === 'no' ? false : null,
    });
  }
  return out;
}

function formatAddress(tags) {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  const city = [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ');
  const parts = [street, city].filter((p) => p && p.length > 0);
  return parts.length > 0 ? parts.join(', ') : null;
}
