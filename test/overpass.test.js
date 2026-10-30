import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPharmaciesQuery, parsePharmacies } from '../src/overpass.js';

test('buildPharmaciesQuery asks for nodes, ways and relations around a point', () => {
  const query = buildPharmaciesQuery({ lat: 60.1699, lon: 24.9384, radius: 2000 });
  assert.match(query, /\[out:json\]\[timeout:25\]/);
  assert.match(query, /node\[amenity="pharmacy"\]\(around:2000,60\.1699,24\.9384\)/);
  assert.match(query, /way\[amenity="pharmacy"\]/);
  assert.match(query, /relation\[amenity="pharmacy"\]/);
  assert.match(query, /out center tags;/);
});

test('parsePharmacies reads a node with a full set of tags', () => {
  const payload = {
    elements: [
      {
        type: 'node',
        id: 123,
        lat: 60.17,
        lon: 24.94,
        tags: {
          amenity: 'pharmacy',
          name: 'Apteekki Kamppi',
          'addr:street': 'Kampinkuja',
          'addr:housenumber': '2',
          'addr:postcode': '00100',
          'addr:city': 'Helsinki',
          opening_hours: 'Mo-Fr 09:00-21:00; Sa 10:00-18:00',
          phone: '+358 9 123 4567',
          website: 'https://example.fi',
          wheelchair: 'yes',
        },
      },
    ],
  };
  const [pharmacy] = parsePharmacies(payload);
  assert.equal(pharmacy.id, 'node/123');
  assert.equal(pharmacy.name, 'Apteekki Kamppi');
  assert.equal(pharmacy.lat, 60.17);
  assert.equal(pharmacy.address, 'Kampinkuja 2, 00100 Helsinki');
  assert.equal(pharmacy.openingHours, 'Mo-Fr 09:00-21:00; Sa 10:00-18:00');
  assert.equal(pharmacy.wheelchair, true);
});

test('parsePharmacies uses the centre of ways and skips elements without a position', () => {
  const payload = {
    elements: [
      { type: 'way', id: 9, center: { lat: 60.1, lon: 24.9 }, tags: { amenity: 'pharmacy' } },
      { type: 'node', id: 10, tags: { amenity: 'pharmacy' } },
    ],
  };
  const pharmacies = parsePharmacies(payload);
  assert.equal(pharmacies.length, 1);
  assert.equal(pharmacies[0].id, 'way/9');
  assert.equal(pharmacies[0].name, 'Pharmacy');
  assert.equal(pharmacies[0].address, null);
});

test('parsePharmacies tolerates an empty or broken payload', () => {
  assert.deepEqual(parsePharmacies({}), []);
  assert.deepEqual(parsePharmacies(null), []);
  assert.deepEqual(parsePharmacies({ elements: [null, 42, {}] }), []);
});

test('parsePharmacies drops duplicate ids', () => {
  const node = { type: 'node', id: 1, lat: 60, lon: 24, tags: { name: 'A' } };
  assert.equal(parsePharmacies({ elements: [node, { ...node }] }).length, 1);
});
