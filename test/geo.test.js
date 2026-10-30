import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, formatDistance, sortByDistance, clampRadius, isValidLat, isValidLon } from '../src/geo.js';

const HELSINKI = { lat: 60.1699, lon: 24.9384 };
const TRAMPOLINE = { lat: 60.1686, lon: 24.9418 }; // about 250 m from Senate Square

test('distanceMeters measures a short city distance', () => {
  const d = distanceMeters(HELSINKI, TRAMPOLINE);
  assert.ok(d > 180 && d < 320, `expected ~250 m, got ${d}`);
});

test('distanceMeters is symmetric and zero for the same point', () => {
  assert.equal(distanceMeters(HELSINKI, HELSINKI), 0);
  assert.equal(
    distanceMeters(HELSINKI, TRAMPOLINE).toFixed(6),
    distanceMeters(TRAMPOLINE, HELSINKI).toFixed(6),
  );
});

test('distanceMeters matches a known long distance (Helsinki–Oulu ~ 540 km)', () => {
  const oulu = { lat: 65.0121, lon: 25.4651 };
  const km = distanceMeters(HELSINKI, oulu) / 1000;
  assert.ok(km > 520 && km < 560, `expected ~540 km, got ${km}`);
});

test('sortByDistance returns a new list, nearest first', () => {
  const input = [
    { name: 'far', distanceMeters: 900 },
    { name: 'near', distanceMeters: 120 },
    { name: 'middle', distanceMeters: 400 },
  ];
  const sorted = sortByDistance(input);
  assert.deepEqual(sorted.map((p) => p.name), ['near', 'middle', 'far']);
  assert.deepEqual(input.map((p) => p.name), ['far', 'near', 'middle']);
});

test('formatDistance uses metres under a kilometre and kilometres above', () => {
  assert.equal(formatDistance(0), '0 m');
  assert.equal(formatDistance(247), '250 m');
  assert.equal(formatDistance(999), '1000 m');
  assert.equal(formatDistance(1000), '1.0 km');
  assert.equal(formatDistance(12_400), '12 km');
  assert.equal(formatDistance(NaN), '—');
});

test('clampRadius keeps a sane radius', () => {
  assert.equal(clampRadius(NaN), 2000);
  assert.equal(clampRadius(10), 200);
  assert.equal(clampRadius(1500), 1500);
  assert.equal(clampRadius(999_999), 20_000);
});

test('coordinate validation', () => {
  assert.ok(isValidLat(60.17));
  assert.ok(!isValidLat(91));
  assert.ok(!isValidLat(NaN));
  assert.ok(isValidLon(-24.9));
  assert.ok(!isValidLon(181));
});
