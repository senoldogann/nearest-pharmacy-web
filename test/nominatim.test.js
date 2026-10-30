import test from 'node:test';
import assert from 'node:assert/strict';
import { viewboxFor, parseNominatimPharmacies } from '../src/nominatim.js';

test('viewboxFor builds a square around the origin', () => {
  const [left, top, right, bottom] = viewboxFor({ lat: 60.17, lon: 24.94, radius: 1000 }).split(',').map(Number);
  assert.ok(left < 24.94 && right > 24.94);
  assert.ok(bottom < 60.17 && top > 60.17);
  assert.ok(right - left > top - bottom, 'at 60° north a degree of longitude is shorter');
});

test('parseNominatimPharmacies maps a result to the shared shape', () => {
  const rows = [
    {
      osm_type: 'node', osm_id: 1, lat: '60.169', lon: '24.943', category: 'amenity', type: 'pharmacy',
      name: 'Kluuvin apteekki',
      address: { road: 'Keskuskatu', house_number: '7', postcode: '00100', city: 'Helsinki' },
      extratags: { opening_hours: 'Mo-Fr 08:00-20:00', phone: '+358 9 621 3663', website: 'https://example.fi' },
    },
    { osm_type: 'node', osm_id: 2, lat: '60.1', lon: '24.9', category: 'shop', type: 'supermarket', name: 'K-market' },
  ];
  const pharmacies = parseNominatimPharmacies(rows);
  assert.equal(pharmacies.length, 1);
  assert.equal(pharmacies[0].id, 'node/1');
  assert.equal(pharmacies[0].address, 'Keskuskatu 7, 00100 Helsinki');
  assert.equal(pharmacies[0].openingHours, 'Mo-Fr 08:00-20:00');
});

test('parseNominatimPharmacies tolerates an empty answer', () => {
  assert.deepEqual(parseNominatimPharmacies([]), []);
  assert.deepEqual(parseNominatimPharmacies(null), []);
});
