import test from 'node:test';
import assert from 'node:assert/strict';
import profiles from '../data/source-bomb-profiles.json' with { type: 'json' };
import { blastShapeAt, keyAt, yieldScale } from './nuclearVolumetrics.js';
import { radiusForPressurePsi, shockRadiusM, zonesForBomb } from './nuclearBlastModel.js';

const probe = (bomb, s) => blastShapeAt(bomb, zonesForBomb(bomb, bomb.yield_kt), bomb.yield_kt, s);

test('keyAt holds the first and last key instead of extrapolating', () => {
  const keys = [[10, 100], [20, 400]];
  assert.equal(keyAt(keys, 0, 7), 100);
  assert.equal(keyAt(keys, 500, 7), 400);
  assert.ok(keyAt(keys, 15, 7) > 100 && keyAt(keys, 15, 7) < 400);
  assert.equal(keyAt(undefined, 15, 7), 7);
  assert.equal(keyAt([], 15, 7), 7);
});

test('yieldScale rescales a profile by the cube root of the yield ratio', () => {
  const rds37 = profiles.bombs.find((b) => b.id === 'rds37');
  assert.ok(Math.abs(yieldScale(rds37, rds37.yield_kt) - 1) < 1e-9, 'свой заряд не масштабируется');
  const small = yieldScale(rds37, 200);
  assert.ok(Math.abs(small - (200 / rds37.yield_kt) ** (1 / 3)) < 1e-9);
  // В 8 раз меньший заряд даёт вдвое меньшее облако и вдвое более быстрый подъём.
  const half = probe(rds37, 30);
  const big = blastShapeAt(rds37, zonesForBomb(rds37, rds37.yield_kt * 8), rds37.yield_kt * 8, 60);
  assert.ok(Math.abs(big.head.r / half.head.r - 2) < 0.01, `шляпа ${big.head.r}/${half.head.r}`);
  assert.ok(Math.abs(big.head.halfH / half.head.halfH - 2) < 0.01, `толщина ${big.head.halfH}/${half.head.halfH}`);
  assert.ok(Math.abs(big.timing.tHead1 / half.timing.tHead1 - 2) < 0.01, `время ${big.timing.tHead1}/${half.timing.tHead1}`);
  // Высота низа шляпы растёт меньше вдвое: точка подрыва — выбор самолёта,
  // а не функция мощности, и её пересчёт по W^⅓ был бы подменой физики.
  const lift = big.head.y / half.head.y;
  assert.ok(lift > 1 && lift < 2, `подъём ${lift}`);
});

test('thin layers stay inside their own bound sphere', () => {
  for (const bomb of profiles.bombs) {
    const zones = zonesForBomb(bomb, bomb.yield_kt);
    for (const s of [0.5, 3, 12, 16, 20, 40, 60, 120, 256, 400]) {
      const st = blastShapeAt(bomb, zones, bomb.yield_kt, s);
      const layers = [...st.rings.map((rg) => ({ v: rg, th: rg[2], op: rg[3] })),
        { v: st.ice, th: st.ice[2], op: st.ice[3] },
        { v: st.ice2, th: st.ice2[2], op: st.ice2[3] }];
      for (const { v, th, op } of layers) {
        if (!(op > 0)) continue;
        // Марш обрывается на сфере u_bound: слой снаружи сферы не рисуется
        // вовсе, и «слой есть» превращается в «слоя нет». Радиус листа идёт
        // без запаса, а по вертикали проверяем верхнюю кромку.
        const far = Math.hypot(v[1], v[0] + th - st.bound.y);
        assert.ok(far <= st.bound.r * 1.001,
          `${bomb.id} @${s}: слой y=${Math.round(v[0])} r=${Math.round(v[1])} вне сферы ${Math.round(st.bound.r)}/${Math.round(st.bound.y)}`);
      }
      if (st.dome[1] > 0) {
        const far = Math.hypot(st.dome[0], st.dome[1] - st.bound.y);
        assert.ok(far <= st.bound.r * 1.001,
          `${bomb.id} @${s}: купол ${Math.round(st.dome[0])}/${Math.round(st.dome[1])} вне сферы ${Math.round(st.bound.r)}`);
      }
    }
  }
});

test('every catalogued bomb produces a finite, bounded shape over an hour', () => {
  for (const bomb of profiles.bombs) {
    const zones = zonesForBomb(bomb, bomb.yield_kt);
    for (const s of [0.01, 0.1, 1, 5, 20, 60, 200, 900, 4000]) {
      const st = blastShapeAt(bomb, zones, bomb.yield_kt, s);
      const scalars = [
        st.bound.r, st.bound.y, st.fireball.r, st.fireball.temp, st.fireball.opacity,
        st.head.y, st.head.r, st.head.halfH, st.head.density,
        st.stem.y1, st.stem.r, st.stem.density, st.skirt.r, st.skirt.h, st.skirt.density,
        st.shock.r, st.shock.y, st.shock.psi, st.shock.thick,
        st.shock.stem, st.shock.cond, st.shock.condW, st.shock.amp, st.life,
        ...st.rings.flat(), ...st.ice, ...st.ice2, ...st.dome,
      ];
      for (const value of scalars) {
        assert.ok(Number.isFinite(value), `${bomb.id} @${s}: ${value} не число`);
      }
      assert.ok(st.bound.r > 0, `${bomb.id} @${s}: ограничивающая сфера ${st.bound.r}`);
      assert.ok(st.fireball.r <= st.timing.fireballMax + 1e-6, `${bomb.id} @${s}: шар ${st.fireball.r} больше замера ${st.timing.fireballMax}`);
      assert.ok(st.fireball.temp >= 600 && st.fireball.temp <= 60_000, `${bomb.id} @${s}: температура ${st.fireball.temp}`);
      for (const density of [st.fireball.opacity, st.head.density]) {
        assert.ok(density >= 0 && density <= 1.000001, `${bomb.id} @${s}: плотность ${density}`);
      }
      // Плотность грунта — множитель ослабления, а не доля: art.skirt
      // в профилях источника доходит до 1.5.
      assert.ok(st.skirt.density >= 0 && st.skirt.density <= 2, `${bomb.id} @${s}: плотность грунта ${st.skirt.density}`);
    }
  }
});

test('ground dust rides the front until the three-psi radius holds it back', () => {
  for (const id of ['trinity', 'little_boy', 'castle_bravo', 'tsar']) {
    const bomb = profiles.bombs.find((b) => b.id === id);
    const zones = zonesForBomb(bomb, bomb.yield_kt);
    const art = bomb.profile ?? bomb;
    const surface = zones.burstType !== 'NUCLEAR_AIR' && zones.burstType !== 'NUCLEAR_HIGH_AIR';
    const hob = Math.max(0, bomb.burst_height_m ?? 0);
    const k = yieldScale(bomb, bomb.yield_kt);
    const rmax = Math.max(1, (art.skirt_max_r ?? radiusForPressurePsi(bomb.yield_kt, 3, surface) * 0.9) * k);
    for (const s of [1, 2, 4, 8, 16, 32, 64, 128, 512]) {
      const st = blastShapeAt(bomb, zones, bomb.yield_kt, s);
      const slant = shockRadiusM(bomb.yield_kt, s, surface);
      const front = Math.min(Math.sqrt(Math.max(0, slant * slant - hob * hob)), rmax);
      assert.ok(st.skirt.r <= front + 41, `${id} @${s}: пыль ${st.skirt.r} обгоняет предел ${front}`);
      if (st.skirt.density > 0) {
        assert.ok(st.skirt.r >= front * 0.99 - 1, `${id} @${s}: пыль ${st.skirt.r} отстаёт от ${front}`);
      }
    }
    // Дальше радиуса 3 psi грунт не летит: у мегатонного взрыва на минутах
    // юбка в разы меньше фронта, а не «скатерть» до горизонта.
    const late = blastShapeAt(bomb, zones, bomb.yield_kt, 512);
    const slant = shockRadiusM(bomb.yield_kt, 512, surface);
    assert.ok(late.skirt.r < slant, `${id}: юбка ${late.skirt.r} не ограничена фронтом ${slant}`);
  }
});

test('the dust at the ground never outgrows the ceiling of its own kind', () => {
  const artNum = (value, fallback) => (Number.isFinite(value) ? value : fallback);
  for (const bomb of profiles.bombs) {
    const zones = zonesForBomb(bomb, bomb.yield_kt);
    const art = bomb.profile ?? bomb;
    const k = yieldScale(bomb, bomb.yield_kt);
    const kind = String(bomb.burst_type ?? '');
    const column = kind.includes('BURIED') || kind.includes('UNDERWATER') || art.col_height !== undefined;
    for (const s of [1, 8, 64, 512, 4000]) {
      const st = blastShapeAt(bomb, zones, bomb.yield_kt, s);
      if (column) {
        const ceiling = Math.max(artNum(art.surge_h0, 50) * k, artNum(art.surge_h1, 150) * k) + 1;
        assert.ok(st.skirt.h <= ceiling, `${bomb.id} @${s}: вал ${st.skirt.h} > ${ceiling}`);
        assert.equal(st.skirt.front, 1, `${bomb.id} @${s}: у колонны нет гребня фронта`);
      } else {
        // Холм, а не стена: 5% своего радиуса (или 10% шара), art-множитель и
        // рост только первые шесть секунд.
        const ceiling = Math.max(st.skirt.r * 0.05, st.timing.fireballMax * 0.1)
          * artNum(art.skirt_height, 1) + 3.6 + 1e-6;
        assert.ok(st.skirt.h <= ceiling, `${bomb.id} @${s}: холм ${st.skirt.h} > ${ceiling}`);
        assert.equal(st.skirt.inner, 0, `${bomb.id} @${s}: юбка полая внутри`);
        assert.equal(st.skirt.front, 0, `${bomb.id} @${s}: на юбке гребень фронта`);
      }
    }
  }
});

test('the cloud dies out instead of running forever', () => {
  for (const bomb of profiles.bombs) {
    const zones = zonesForBomb(bomb, bomb.yield_kt);
    const early = blastShapeAt(bomb, zones, bomb.yield_kt, 0.5);
    assert.ok(early.timing.tFull > 0, `${bomb.id}: нет времени полного подъёма`);
    const late = blastShapeAt(bomb, zones, bomb.yield_kt, early.timing.tFull * 7);
    assert.equal(late.alive, false, `${bomb.id}: облако живо на ${late.simTime} c`);
  }
});

test('fireball timing follows the researched curve, not a guessed one', () => {  const kt = 1000;
  const t2 = 0.0417 * kt ** 0.44;
  const peak = blastShapeAt({}, {}, kt, t2);
  const after = blastShapeAt({}, {}, kt, t2 * 40);
  assert.ok(peak.fireball.temp > 7000, `второй максимум ${peak.fireball.temp}`);
  assert.ok(after.fireball.temp < peak.fireball.temp * 0.5, `остывание ${after.fireball.temp}`);
  // Радиус в этой модели только растёт к замеренному пределу: сжатие шара
  // показывает не он, а skin/opacity, которые втягивают шар в ножку.
  assert.ok(after.fireball.r >= peak.fireball.r, `радиус ${after.fireball.r} < ${peak.fireball.r}`);
  assert.ok(after.fireball.r <= after.timing.fireballMax + 1e-6, `предел ${after.fireball.r}/${after.timing.fireballMax}`);
  assert.ok(after.fireball.skin > peak.fireball.skin, 'кожа не спеет');
});

test('the blast front is a refraction shell, not a drawn line', () => {
  for (const id of ['trinity', 'little_boy', 'castle_bravo', 'tsar']) {
    const bomb = profiles.bombs.find((b) => b.id === id);
    const zones = zonesForBomb(bomb, bomb.yield_kt);
    let prevR = null;
    for (const s of [1, 4, 16, 64, 256, 1024]) {
      const st = blastShapeAt(bomb, zones, bomb.yield_kt, s);
      if (st.shock.r === 0) {
        // Фронт, который не видно (далеко за шаром, давление упало), обязан
        // выключаться целиком — иначе в шейдере остаётся невидимая геометрия.
        assert.equal(st.shock.amp, 0, `${id} @${s}: амплитуда при погасшем фронте`);
        assert.equal(st.shock.thick, 0, `${id} @${s}: толщина при погасшем фронте`);
        prevR = null;
        continue;
      }
      // Сфера фронта живёт в наклонной дальности, как в источнике, а не в радиусе пылевого вала.
      assert.equal(st.shock.y, Math.max(0, bomb.burst_height_m ?? 0), `${id} @${s}: центр фронта не в точке подрыва`);
      if (prevR !== null && prevR !== undefined) {
        assert.ok(st.shock.r > prevR, `${id} @${s}: фронт ${st.shock.r} не догнал предыдущий ${prevR}`);
      }
      prevR = st.shock.r;
      assert.ok(st.shock.thick >= 0.1 && st.shock.thick <= st.shock.r * 0.08 + 1e-9,
        `${id} @${s}: толщина слоя ${st.shock.thick}`);
      assert.ok(st.shock.amp > 0 && st.shock.amp <= 4, `${id} @${s}: амплитуда ${st.shock.amp}`);
      assert.ok(st.shock.cond >= 0 && st.shock.cond <= 4, `${id} @${s}: конденсация ${st.shock.cond}`);
      // Фронт, обогнавший шар хотя бы в 1,2 его радиуса, иначе он с шаром
      // неотделим и рисовать его рано (FxLayersLib ShockLayer::update).
      assert.ok(st.shock.r > st.fireball.r * 1.2, `${id} @${s}: фронт ${st.shock.r} ещё в шаре ${st.fireball.r}`);
    }
  }
  // Полоса конденсации — достояние больших зарядов: малый заряд не имеет права
  // рисовать в небе геометрический купол (источник платит за это отдельной правкой).
  const small = probe(profiles.bombs.find((b) => b.id === 'little_boy'), 30);
  assert.equal(small.shock.cond, 0, 'малый заряд дал конденсацию');
});

test('condensation rings, ice lenses and the soil dome copy the source keys', () => {
  const byId = (id) => profiles.bombs.find((b) => b.id === id);
  // У «Малыша» в профиле источника нет ни колец, ни шапок, ни купола: слои
  // обязаны молчать, а не выдумываться из воздуха.
  const little = byId('little_boy');
  for (const s of [1, 10, 60, 300, 1200]) {
    const st = probe(little, s);
    assert.equal(st.rings.length, 4, `${s}: слотов кольца всегда четыре`);
    for (const rg of st.rings) assert.equal(rg[3], 0, `${s}: кольцо при отсутствии ключа`);
    assert.equal(st.ice[3], 0, `${s}: линза при отсутствии ключа`);
    assert.equal(st.ice2[3], 0, `${s}: второй ярус при отсутствии ключа`);
    assert.equal(st.dome[1], 0, `${s}: купол при отсутствии ключа`);
  }
  // Замок Браво: три документированных кольца на 12/16/20 s, каждое живёт
  // свою жизнь и гаснет к 1.6·life; пустой tier2 = ноль, а не «по умолчанию».
  const bravo = byId('castle_bravo');
  assert.deepEqual(bravo.profile.ring_list.map((rg) => rg[0]), [12, 16, 20]);
  const r14 = probe(bravo, 14);
  assert.ok(r14.rings[0][3] > 0.9, `первое кольцо @14: ${r14.rings[0][3]}`);
  assert.equal(r14.rings[1][3], 0, 'второе кольцо вспыхнуло раньше t_on');
  assert.equal(r14.ice2[3], 0, 'пустой tier2 обязан быть нулём');
  const r30 = probe(bravo, 30);
  assert.ok(r30.rings[1][3] > 0.9 && r30.rings[2][3] > 0.9, `кольца 2 и 3 @30: ${r30.rings.map((rg) => rg[3])}`);
  assert.ok(r30.rings[2][0] > r30.rings[0][0], 'верхнее кольцо ниже нижнего');
  const r45 = probe(bravo, 45);
  assert.equal(r45.rings[0][3], 0, `первое кольцо не погасло к 1.6·life: ${r45.rings[0][3]}`);
  assert.ok(r45.ice[3] > 0, 'ледяная шапка Браво не появилась');
  // Первое кольцо прижимается к низу шляпы: у наземного подрыва шляпа лежит на
  // грунте, и зажим источника уводит воротник к нулевой отметке.
  const h14 = r14.head;
  assert.ok(Math.abs(r14.rings[0][0] - (h14.y - h14.halfH - 2 * r14.rings[0][2])) < 1,
    `зажим кольца ${r14.rings[0][0]} против ${h14.y - h14.halfH}`);
  // Царь-бомба: пилеус над шляпой и второй ярус-колокол на 59.8 км (= 0.92 cloud_top).
  const tsar = byId('tsar');
  const t120 = probe(tsar, 120);
  assert.ok(t120.ice[3] > 0.7, `пилеус @120: ${t120.ice[3]}`);
  assert.equal(t120.ice2[3], 0, 'второй ярус вылез раньше t_on');
  const t400 = probe(tsar, 400);
  assert.equal(Math.round(t400.ice2[0]), Math.round(t400.timing.cloudTop * 0.92), `высота яруса ${t400.ice2[0]}`);
  assert.ok(t400.ice2[1] < 47500 && t400.ice2[1] > 0, `радиус яруса растёт от нуля: ${t400.ice2[1]}`);
  // Sedan: купол грунта встаёт за dome_time и прорывается газом за 0.4 s.
  const sedan = byId('sedan');
  const d05 = probe(sedan, 0.5);
  const d30 = probe(sedan, 3.0);
  const d40 = probe(sedan, 4.0);
  assert.ok(d05.dome[1] > 0 && d05.dome[1] < 90, `подъём купола @0.5: ${d05.dome[1]}`);
  assert.equal(Math.round(d30.dome[1]), 90, `плато купола @3: ${d30.dome[1]}`);
  assert.ok(d30.dome[2] > 0.4 && d30.dome[2] <= 1, `трещины @3: ${d30.dome[2]}`);
  assert.equal(d40.dome[1], 0, 'купол не схлопнулся после прорыва газа');
});
