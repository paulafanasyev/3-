import test from 'node:test';
import assert from 'node:assert/strict';
import { curvatureRadii, groundStep, flightSpeed, createFlightVector } from './cameraFlight.js';

const DEG = Math.PI / 180;

test('equator curvatures match the published WGS84 radii', () => {
  const { n, m } = curvatureRadii(0);
  assert.ok(Math.abs(n - 6378137) < 1, `n=${n}`);
  assert.ok(Math.abs(m - 6335439.3) < 2, `m=${m}`);
  // полюсный меридианный радиус — ровно 6399593.959 м
  const pole = curvatureRadii(90 * DEG);
  assert.ok(Math.abs(pole.m - 6399593.959) < 1, `m(90)=${pole.m}`);
});

test('one degree of latitude is ~111 km and a degree of longitude shrinks with cos(latitude)', () => {
  const at = (lat) => groundStep({ latRad: lat * DEG, lonRad: 0, northM: 111_000, eastM: 0 });
  const dLat = (lat) => (at(lat).latRad / DEG - lat);
  assert.ok(Math.abs(dLat(0) - 1) < 0.01, `dLat(0)=${dLat(0)}`);
  assert.ok(Math.abs(dLat(60) - 1) < 0.01, `dLat(60)=${dLat(60)}`);

  const east = groundStep({ latRad: 60 * DEG, lonRad: 0, northM: 0, eastM: 55_500 });
  assert.ok(Math.abs(east.lonRad / DEG - 1) < 0.02, `lon=${east.lonRad / DEG}`);
});

test('flying north past the pole clamps instead of mirroring the path', () => {
  const over = groundStep({ latRad: 89 * DEG, lonRad: 0, northM: 400_000, eastM: 0 });
  assert.ok(over.latRad / DEG <= 89.5 + 1e-9, `lat=${over.latRad / DEG}`);
});

test('the step wraps past the antimeridian instead of drifting out of range', () => {
  const over = groundStep({ latRad: 0, lonRad: 179.5 * DEG, northM: 0, eastM: 111_000 });
  assert.ok(Math.abs(over.lonRad / DEG + 179.5) < 0.01, `lon=${over.lonRad / DEG}`);
});

test('flight speed tracks altitude and is clamped at both ends', () => {
  assert.equal(flightSpeed(100), 30);
  assert.ok(Math.abs(flightSpeed(100_000) - 28_000) < 1);
  assert.equal(flightSpeed(1e12), 4e6);
});

test('held roles map to unit vectors with boost and creep multipliers', () => {
  const base = { fwd: 0, side: 0, lift: 0, yaw: 0, scale: 1 };
  assert.deepEqual(createFlightVector(new Set(['fwd'])), { ...base, fwd: 1 });
  assert.deepEqual(createFlightVector(new Set(['back'])), { ...base, fwd: -1 });
  assert.deepEqual(createFlightVector(new Set(['yawLeft'])), { ...base, yaw: -1 });
  assert.deepEqual(createFlightVector(new Set(['yawRight'])), { ...base, yaw: 1 });
  assert.deepEqual(createFlightVector(new Set(['up'])), { ...base, lift: 1 });
  assert.deepEqual(createFlightVector(new Set(['down'])), { ...base, lift: -1 });
  assert.deepEqual(createFlightVector(new Set(['fwd', 'boost'])), { ...base, fwd: 1, scale: 4 });
  assert.deepEqual(createFlightVector(new Set(['creep'])), { ...base, scale: 0.15 });
  // встречные клавиши гасят друг друга, а не складываются в шум
  assert.deepEqual(createFlightVector(new Set(['fwd', 'back'])), base);
});
