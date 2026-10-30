import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { clearCache } from '../src/pharmacies.js';

const OVERPASS_FIXTURE = {
  elements: [
    { type: 'node', id: 3, lat: 60.1710, lon: 24.9450, tags: { name: 'Far Pharmacy', 'addr:street': 'Mannerheimintie', 'addr:housenumber': '10' } },
    { type: 'node', id: 1, lat: 60.1700, lon: 24.9390, tags: { name: 'Near Pharmacy', opening_hours: 'Mo-Su 08:00-22:00' } },
    { type: 'way', id: 2, center: { lat: 60.1695, lon: 24.9400 }, tags: { name: 'Middle Pharmacy', 'addr:city': 'Helsinki' } },
  ],
};

function fakeFetch(url) {
  const href = String(url);
  if (href.includes('overpass-api.de')) {
    return Promise.resolve(new Response(JSON.stringify(OVERPASS_FIXTURE), { status: 200 }));
  }
  if (href.includes('nominatim')) {
    return Promise.resolve(new Response(JSON.stringify([
      { display_name: 'Kamppi, Helsinki, Finland', lat: '60.1680', lon: '24.9310' },
      { display_name: 'Kamppi, Espoo, Finland', lat: '60.2000', lon: '24.7000' },
    ]), { status: 200 }));
  }
  return Promise.reject(new Error(`unexpected fetch ${href}`));
}

async function withServer(fn) {
  clearCache();
  const server = createServer({ fetchImpl: fakeFetch });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/pharmacies returns pharmacies sorted by distance', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/pharmacies?lat=60.1699&lon=24.9384&radius=2000`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.radius, 2000);
    assert.equal(body.count, 3);
    assert.deepEqual(body.pharmacies.map((p) => p.name), ['Near Pharmacy', 'Middle Pharmacy', 'Far Pharmacy']);
    assert.ok(body.pharmacies[0].distanceMeters < body.pharmacies[2].distanceMeters);
    assert.equal(body.pharmacies[2].address, 'Mannerheimintie 10');
  });
});

test('GET /api/pharmacies rejects missing or invalid coordinates', async () => {
  await withServer(async (base) => {
    const missing = await fetch(`${base}/api/pharmacies?radius=2000`);
    assert.equal(missing.status, 400);

    const invalid = await fetch(`${base}/api/pharmacies?lat=abc&lon=24.9`);
    assert.equal(invalid.status, 400);
    const body = await invalid.json();
    assert.match(body.error, /valid WGS84/);
  });
});

test('GET /api/geocode turns an address into coordinates', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/geocode?q=Kamppi`);
    assert.equal(response.status, 200);
    const { results } = await response.json();
    assert.equal(results.length, 2);
    assert.equal(results[0].label, 'Kamppi, Helsinki, Finland');
    assert.equal(results[0].lat, 60.168);
  });
});

test('GET /api/geocode needs a real query', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/geocode?q=a`);
    assert.equal(response.status, 400);
  });
});

test('the server serves the app and refuses path traversal', async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Nearest Pharmacy/);
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);

    const missing = await fetch(`${base}/../server.js`);
    assert.ok([403, 404].includes(missing.status));
  });
});

test('a failing pharmacy index becomes a 503 with a readable message', async () => {
  const server = createServer({ fetchImpl: () => Promise.reject(new Error('network down')) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/pharmacies?lat=60&lon=24`);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /try again/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('when every Overpass instance is busy the address index answers instead', async () => {
  clearCache();
  const fetchImpl = (url) => {
    const href = String(url);
    if (href.includes('nominatim')) {
      return Promise.resolve(new Response(JSON.stringify([
        {
          osm_type: 'node', osm_id: 77, lat: '60.1700', lon: '24.9400', category: 'amenity', type: 'pharmacy',
          name: 'Fallback Pharmacy', address: { road: 'Aleksanterinkatu', house_number: '1', city: 'Helsinki' },
          extratags: { opening_hours: 'Mo-Sa 09:00-21:00' },
        },
        {
          osm_type: 'node', osm_id: 78, lat: '60.4000', lon: '24.9400', category: 'amenity', type: 'pharmacy',
          name: 'Too Far Pharmacy',
        },
      ]), { status: 200 }));
    }
    return Promise.resolve(new Response('busy', { status: 502 }));
  };
  const server = createServer({ fetchImpl });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/pharmacies?lat=60.1699&lon=24.9384&radius=1500`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, 'nominatim');
    assert.equal(body.count, 1);
    assert.equal(body.pharmacies[0].name, 'Fallback Pharmacy');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a busy Overpass instance is skipped for the next mirror', async () => {
  clearCache();
  const calls = [];
  const fetchImpl = (url) => {
    calls.push(new URL(url).host);
    if (calls.length === 1) {
      return Promise.resolve(new Response('busy', { status: 502 }));
    }
    return Promise.resolve(new Response(JSON.stringify(OVERPASS_FIXTURE), { status: 200 }));
  };
  const server = createServer({ fetchImpl });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/pharmacies?lat=60.17&lon=24.94`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).count, 3);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'overpass-api.de');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
