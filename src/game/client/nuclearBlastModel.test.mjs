import test from 'node:test';
import assert from 'node:assert/strict';
import profiles from '../data/source-bomb-profiles.json' with { type: 'json' };
import {
  computeBlastZones,
  damageTierAt,
  zonesForBomb,
  burstCoupling,
  OVERPRESSURE,
} from './nuclearBlastModel.js';

const km = (m) => m / 1000;

test('cube-root scaling matches documented blast outcomes', () => {
  // Hiroshima Little Boy (~15 kt air burst): near-total destruction ~1 km.
  const littleBoy = computeBlastZones({ yieldKt: 15, burstType: 'NUCLEAR_AIR' });
  assert.ok(km(littleBoy.radiiM.severe) > 0.7 && km(littleBoy.radiiM.severe) < 1.4);
  // MOAB (~11 t): severe damage in the ~90 m range, not kilometres.
  const moab = computeBlastZones({ yieldKt: 0.011, burstType: 'CONVENTIONAL_SURFACE' });
  assert.ok(km(moab.radiiM.severe) > 0.05 && km(moab.radiiM.severe) < 0.15);
  // A 500 lb bomb is not clamped up to a multi-kilometre zone.
  const mk82 = computeBlastZones({ yieldKt: 0.0001, burstType: 'CONVENTIONAL_SURFACE' });
  assert.ok(km(mk82.radiiM.severe) < 0.05);
  // Tsar Bomba (~50 Mt): heavy destruction on the order of tens of km.
  const tsar = computeBlastZones({ yieldKt: 50000, burstType: 'NUCLEAR_HIGH_AIR' });
  assert.ok(km(tsar.radiiM.severe) > 8 && km(tsar.radiiM.light) > 25);
});

test('radii grow monotonically with the cube root of yield', () => {
  const a = computeBlastZones({ yieldKt: 10 });
  const b = computeBlastZones({ yieldKt: 1000 });
  // 1000 kt is 100x 10 kt; cube-root scaling gives ~4.64x the radius, not 100x.
  const ratio = b.radiiM.heavy / a.radiiM.heavy;
  assert.ok(Math.abs(ratio - Math.cbrt(100)) < 0.01, `expected ${Math.cbrt(100)}, got ${ratio}`);
  assert.ok(a.radiiM.severe < a.radiiM.heavy && a.radiiM.heavy < a.radiiM.light);
});

test('damage tiers order correctly across a profile', () => {
  const z = computeBlastZones({ yieldKt: 300, burstType: 'NUCLEAR_AIR' });
  const r = z.radiiM;
  const mid = (a, b) => (a + b) / 2;
  assert.equal(damageTierAt(z, 0), 'vaporized');
  assert.equal(damageTierAt(z, mid(r.fireball, r.severe)), 'severe');
  assert.equal(damageTierAt(z, mid(r.severe, r.heavy)), 'heavy');
  assert.equal(damageTierAt(z, mid(r.heavy, r.light)), 'light');
  assert.equal(damageTierAt(z, r.outer + 1000), 'standing');
});

test('researched fireball, crater and cloud values are used per named bomb', () => {
  const tsar = profiles.bombs.find((b) => b.id === 'tsar');
  const zones = zonesForBomb(tsar);
  assert.equal(zones.radiiM.fireball, tsar.research.fireball_max_radius_m);
  assert.equal(zones.cloudTopKm, tsar.research.cloud_top_km);
  // Tsar was an air burst: the source table records no crater.
  assert.equal(zones.hasCrater, false);
  // Sedan (104 kt, buried) has a large documented crater.
  const sedan = profiles.bombs.find((b) => b.id === 'sedan');
  const sedanZones = zonesForBomb(sedan);
  assert.equal(sedanZones.hasCrater, true);
  assert.ok(sedanZones.craterDiameterM >= 300);
  // Buried shots couple less energy to the air than a surface burst of the same yield.
  assert.ok(burstCoupling(sedan.burst_type) < burstCoupling('NUCLEAR_SURFACE'));
});

test('overpressure coefficients and outer footprint stay within sane bounds', () => {
  assert.ok(OVERPRESSURE.severe < OVERPRESSURE.heavy && OVERPRESSURE.heavy < OVERPRESSURE.light);
  const tiny = computeBlastZones({ yieldKt: 0.0001 });
  assert.ok(tiny.radiiM.outer >= 2200); // always show a plausible small city field
  const huge = computeBlastZones({ yieldKt: 50000 });
  assert.ok(huge.radiiM.outer <= 70000); // bounded for rendering performance
});
