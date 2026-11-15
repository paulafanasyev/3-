import test from 'node:test';
import assert from 'node:assert/strict';
import profiles from '../data/source-bomb-profiles.json' with { type: 'json' };
import {
  computeBlastZones,
  damageTierAt,
  zonesForBomb,
  nearestAirBurstProfile,
  burstCoupling,
  overpressurePsi,
  positivePhaseSeconds,
  radiusForPressurePsi,
  shockArrivalSeconds,
  shockRadiusM,
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

test('shock arrival matches the DNA curve checkpoints the source cites', () => {
  const mile = 1609.34;
  // 20 kt surface burst, 1 mi: исходник ожидает ~3,1 c.
  assert.ok(Math.abs(shockArrivalSeconds(20, mile, true) - 3.1) < 0.15, shockArrivalSeconds(20, mile, true));
  // 1 Mt surface burst, 2 mi: ~4,5 c.
  assert.ok(Math.abs(shockArrivalSeconds(1000, 2 * mile, true) - 4.5) < 0.25, shockArrivalSeconds(1000, 2 * mile, true));
  // Воздушный взрыв в той же точке приходит позже поверхностного (We = 2W).
  assert.ok(shockArrivalSeconds(1000, 2 * mile, false) > shockArrivalSeconds(1000, 2 * mile, true));
});

test('the front radius inverts the arrival time both ways', () => {
  for (const kt of [0.5, 15, 400, 10400, 50000]) {
    for (const surface of [true, false]) {
      for (const r of [300, 5000, 90_000, 1_200_000]) {
        const t = shockArrivalSeconds(kt, r, surface);
        const back = shockRadiusM(kt, t, surface);
        assert.ok(Math.abs(back - r) / r < 0.01, `${kt} kt ${surface} ${r}: обратно ${back}`);
      }
      assert.ok(shockRadiusM(kt, 0, surface) === 0, 'нулевое время — нулевой радиус');
      assert.ok(shockRadiusM(kt, 1, surface) < shockRadiusM(kt, 10, surface), 'фронт монотонен');
    }
  }
});

test('overpressure falls off as the researched near-field law', () => {
  // 1 kt на 100 м: (2200·1/100)^1.5 = 22^1.5 ≈ 103 psi.
  assert.ok(Math.abs(overpressurePsi(1, 100) / 103.2 - 1) < 0.02, overpressurePsi(1, 100));
  assert.ok(overpressurePsi(1, 200) < overpressurePsi(1, 100));
  // Порог выбитых окон ~0,6 psi обязан лежать дальше порога обрушения.
  const r = (psi) => {
    let lo = 1; let hi = 1e7;
    for (let i = 0; i < 60; i += 1) {
      const mid = Math.sqrt(lo * hi);
      if (overpressurePsi(20, mid) > psi) lo = mid; else hi = mid;
    }
    return Math.sqrt(lo * hi);
  };
  assert.ok(r(0.6) > r(10) * 5, `0,6 psi на ${r(0.6)} м, 10 psi на ${r(10)} м`);
});

test('positive phase duration follows the Brode table and cube-root scaling', () => {
  // Таблица blast_physics.gd::positive_phase для взрыва в воздухе.
  const ps = [1.0, 2.5, 5.0, 10.0, 20.0, 50.0, 100.0];
  const cs = [0.505, 0.401, 0.331, 0.267, 0.208, 0.139, 0.097];
  ps.forEach((p, i) => {
    assert.ok(Math.abs(positivePhaseSeconds(1, p) - cs[i]) < 1e-9, `${p} psi: ${positivePhaseSeconds(1, p)} ≠ ${cs[i]}`);
  });
  // Метка между узлами — по логарифму давления, как в источнике.
  assert.ok(Math.abs(positivePhaseSeconds(1, Math.sqrt(5 * 10)) - (0.331 + 0.267) / 2) < 1e-9);
  // Кубический масштаб: 1 Мт живёт в 10 раз дольше 1 кт на том же давлении.
  assert.ok(Math.abs(positivePhaseSeconds(1000, 1) / positivePhaseSeconds(1, 1) - 10) < 1e-9);
  // Наземный взрыв — отдельная степенная ветка (0,569·p^-0,381); ниже 2,5 psi она не продолжается.
  assert.ok(Math.abs(positivePhaseSeconds(1, 20, true) - 0.569 * 20 ** -0.381) < 1e-9);
  assert.equal(positivePhaseSeconds(1, 1, true), positivePhaseSeconds(1, 2.5, true));
  // Длительность обязана убывать с давлением: именно из неё считается толщина сжатого слоя.
  assert.ok(positivePhaseSeconds(500, 50) < positivePhaseSeconds(500, 5));
});

test('the pressure radius inverts the near-field law and applies the surface factor', () => {
  for (const p of [1, 3, 5, 10, 20, 50, 100]) {
    const r = radiusForPressurePsi(1000, p);
    assert.ok(Math.abs(overpressurePsi(1000, r) / p - 1) < 1e-6, `${p} psi -> ${r} м`);
    // Наземный взрыв даёт то же давление ближе: множитель 0.55…0.90 по
    // таблице surface_factor() из blast_physics.gd.
    const rs = radiusForPressurePsi(1000, p, true);
    assert.ok(rs < r && rs > r * 0.5, `${p} psi: наземный ${rs} против воздушного ${r}`);
  }
  // 1 Мт у земли: 3 psi примерно на 6,3 км — ближе к G&D, чем 10,6 км в воздухе.
  assert.ok(Math.abs(radiusForPressurePsi(1000, 3, true) / 6300 - 1) < 0.02);
  // Кубический масштаб: в 8 раз больший заряд — вдвое дальше то же давление.
  assert.ok(Math.abs(radiusForPressurePsi(8000, 3) / radiusForPressurePsi(1000, 3) - 2) < 1e-9);
  // Давление убывает с дальностью монотонно, без ступенек на узлах таблицы.
  assert.ok(radiusForPressurePsi(500, 4) < radiusForPressurePsi(500, 3));
});

test('ближайший воздушный замер подбирается по логарифму мощности', () => {
  const bombs = profiles.bombs;
  const pick = (kt) => nearestAirBurstProfile(bombs, kt);
  // 150 кт ИЦБМ: ближайший воздушный замер — 500 кт, а не 1,6 Мт прежнего
  // профиля по умолчанию и не 104 кт подземного «Седана».
  assert.equal(pick(150).id, 'ivy_king');
  assert.equal(pick(15).id, 'grable');
  assert.equal(pick(50000).id, 'tsar');
  // Подземные, водные и башенные профили в выборку не попадают никогда:
  // у них другая ножка и другая шляпа, а ИЦБМ рвёт в воздухе.
  for (const kt of [0.3, 20, 104, 1000, 15000]) {
    assert.match(pick(kt).burst_type, /^NUCLEAR_(AIR|LOW_AIR|HIGH_AIR)$/, `${kt} кт дал ${pick(kt).id}`);
  }
  assert.equal(nearestAirBurstProfile(bombs, 0), null);
  assert.equal(nearestAirBurstProfile([], 150), null);
});
