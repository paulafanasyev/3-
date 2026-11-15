// Объёмный рендер ядерного взрыва — перенос explosion_volume.gdshader (Godot) в Cesium.
// В исходнике это raymarch по SDF-фигурам (огненный шар, шляпа гриба, ножка, юбка-вал)
// с текстурным шумом; здесь тот же марш, но пост-процессом: луч строим из глубины сцены,
// координаты — локальные метры ENU вокруг точки взрыва, шум — процедурный (в Cesium нет
// 3D-текстур). Свет — фиксированный «съёмочный» прожектор u_sunDir: сцена игры
// рендерится при выключенном освещении глобуса, поэтому астрономическое солнце
// (czm_sunDirectionWC) освещало бы гриб снизу, вразрез с дневным снимком города.
//
// Все числа формы считаются в blastShapeAt() на CPU по исследовательским ключам профиля
// бомбы (top_keys / cap_d_keys / head_appear_s / fb_fade_s / stem_delay …), поэтому кадр
// можно проверить и без браузера.
import * as Cesium from 'cesium';
import { overpressurePsi, positivePhaseSeconds, radiusForPressurePsi, shockArrivalSeconds, shockRadiusM } from './nuclearBlastModel.js';

// Оптическая толщина сжатого слоя перед фронтом: 0.15·c₀·t⁺ (fx_layers.gd::ShockLayer).
const COMPRESSED_LAYER = 0.15 * 343.0;
// Сдвиг фона ударным фронтом никогда не растягивается дальше нескольких
// пикселей (max_px в shockwave.gdshader) — иначе он читается как мазок.
const SHOCK_MAX_PX = 6;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(v, 0, 1);
const smoothstep = (a, b, x) => {
  const u = clamp01((x - a) / (b - a || 1e-9));
  return u * u * (3 - 2 * u);
};
const lerp = (a, b, u) => a + (b - a) * u;

/** Кусочно-линейный интерполятор ключей [[t, v], …] (те же, что в профиле бомбы). */
export function keyAt(keys, t, fallback = 0) {
  if (!Array.isArray(keys) || keys.length === 0) return fallback;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return lerp(v0, v1, smoothstep(t0, t1, t) ** 0.85);
    }
  }
  return keys[keys.length - 1][1];
}

const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const rgb = (values, fallback) => {
  const v = Array.isArray(values) && values.length >= 3 ? values : fallback;
  return [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2])];
};
const setVec4 = (target, values) => {
  target.x = num(values[0], 0);
  target.y = num(values[1], 0);
  target.z = num(values[2], 0);
  target.w = num(values[3], 0);
};

/**
 * Степень пересчёта профиля под другую мощность: при сходственной геометрии
 * линейры растут как W^⅓, а все времена гриба идут за ними же. Профили в
 * каталоге замерены на своих зарядах, поэтому полигон, выбравший РДС-1 (22 кт)
 * с профилем РДС-37 (1,6 Мт), обязан получить облако в 4,1 раза меньше.
 */
export function yieldScale(profile = {}, yieldKt = 1000) {
  const selfKt = Math.max(0.001, num(profile.yield_kt, Math.max(0.001, num(yieldKt, 1000))));
  return clamp((Math.max(0.001, num(yieldKt, selfKt)) / selfKt) ** (1 / 3), 0.03, 30);
}

const pulseShape = (tau) => (tau <= 0 ? 0 : (15 / 7) * tau * tau / (1 + (8 / 7) * tau ** 3.75));

/**
 * Нормированная тепловая мощность заряда (G&D): первый УФ-импульс плюс второй,
 * более широкий максимум. Из неё источник считает, насколько камера обязана
 * закрыть диафрагму, чтобы шар не размазал весь кадр в молоко.
 */
export function thermalPower(yieldKt = 1000, seconds = 0) {
  const kt = Math.max(0.001, num(yieldKt, 1000));
  if (!(seconds > 0)) return 0;
  const tMin = 0.0035 * kt ** 0.4;
  const tSecond = 0.0417 * kt ** 0.44;
  const y = seconds / (tMin / 6);
  return 0.9 * y * Math.exp(1 - y) + pulseShape(seconds / tSecond);
}

/**
 * Автоэкспозиция по метрологии источника (explosion.gd, «rapatronic look»):
 * пока ослепительный шар в кадре, камера зажимается на 4,5–6 ступеней, поэтому
 * ядро выбелено, а детали гриба проступают только на лимбе и позже, когда шар
 * остыл. Без этого переноса облако выходит серым и плоским при любом свете.
 */
export function meterExposure({
  yieldKt = 1000, seconds = 0, fireballRadius = 0, fireballOpacity = 0,
  fireballTemp = 0, emission = 1600, distanceM = 1e6, halfFovRad = 0.524,
  sunFactor = 1, whiteoutSeconds = 0,
} = {}) {
  const kt = Math.max(0.001, num(yieldKt, 1000));
  const amb = 0.15 + 0.85 * clamp01(sunFactor);
  const base = lerp(4.0, 0.42, clamp01(sunFactor));
  const tSecond = 0.0417 * kt ** 0.44;
  const r = Math.max(0, num(fireballRadius, 0));
  const ill = thermalPower(kt, seconds) * 20 * r * r / Math.max(num(distanceM, 1e6) ** 2, 1) * 1000;
  let lum = ill / amb;
  if (whiteoutSeconds > 0 && seconds < whiteoutSeconds) {
    lum = Math.max(lum, 30 * (1 - seconds / whiteoutSeconds));
  }
  let maxComp = 2;
  if (r > 0 && fireballOpacity > 0.3 && fireballTemp > 1500) {
    const dist = Math.max(num(distanceM, 1), 1);
    const cov = clamp((Math.atan(r / dist) / Math.max(halfFovRad, 0.05)) ** 2 * 6, 0, 0.35);
    const kc = smoothstep(3 * tSecond, 15 * tSecond, seconds);
    maxComp = lerp(lerp(4.5, 6, cov), lerp(1.6, 2.6, cov), kc);
    const x = fireballTemp / 8000;
    const ball = emission * x ** 4 * fireballOpacity / (lerp(16, 6, kc) * amb);
    lum = Math.max(lum, (1 - cov) * (1 + lum) + cov * ball - 1);
    if (kt < 1 && seconds > 3 * tSecond) maxComp = Math.min(maxComp, 0.5);
  }
  const comp = clamp(Math.log2(Math.max(lum, 1)), 0, maxComp);
  return clamp(base * 2 ** -comp, 0.004, 4);
}

/**
 * Состояние облака в расчётный момент s (секунды модельного времени).
 * @param {object} profile профиль бомбы из source-bomb-profiles.json (может быть {})
 * @param {object} zones   расчёт зон из nuclearBlastModel (radiiM/cloudTopKm/cloudCapKm)
 * @param {number} yieldKt мощность в кт
 * @param {number} s       секунды с момента взрыва (модельное время)
 */
export function blastShapeAt(profile = {}, zones = {}, yieldKt = 1000, s = 0) {
  const art = profile.profile ?? profile ?? {};
  const research = profile.research ?? {};
  const kt = Math.max(0.001, num(yieldKt, 1000));
  const cbrt = Math.cbrt(kt);
  const k = yieldScale(profile, kt);
  // Значение из профиля — в метрах/секундах его собственного заряда; запасное —
  // уже посчитано под выбранную мощность, поэтому его не множим.
  const artLen = (value, fallback) => {
    const raw = num(value, Number.NaN);
    return Number.isFinite(raw) ? Math.max(1, raw * k) : fallback;
  };
  const artTime = (value, fallback) => {
    const raw = num(value, Number.NaN);
    return Number.isFinite(raw) ? Math.max(0.001, raw * k) : fallback;
  };
  const keysLen = (keys) => keys.map(([t, v]) => [t * k, v * k]);
  const keysTime = (keys) => keys.map(([t, v]) => [t * k, v]);

  const radii = zones.radiiM ?? {};
  const fireballMax = Math.max(30, artLen(research.fireball_max_radius_m ?? art.fireball_r_m, num(radii.fireball, 200 * cbrt)));
  const cloudTop = Math.max(200, artLen(art.cloud_top_m, num(zones.cloudTopKm, 6) * 1000));
  const capRadius = Math.max(60, artLen(art.cap_radius_m, Math.max(cloudTop * 0.45, num(zones.cloudCapKm, 0) * 500)));
  const stemRadius = Math.max(25, artLen(art.stem_radius_m, capRadius * 0.17));
  const burstHeight = Math.max(0, num(profile.burst_height_m, 0));
  const surface = burstHeight < fireballMax * 0.8;

  // Время: у малых зарядов всё происходит за секунды, у мегатонн — за минуты.
  const appear = Array.isArray(art.head_appear_s) ? art.head_appear_s.map((v) => artTime(v, 0)) : [];
  const tHead0 = num(appear[0], 1.6 * cbrt ** 0.35);
  const tHead1 = Math.max(tHead0 * 1.5, num(appear[1], 6 * cbrt ** 0.35));
  const fade = Array.isArray(art.fb_fade_s) ? art.fb_fade_s.map((v) => artTime(v, 0)) : [];
  const tFade0 = num(fade[0], tHead1 * 1.6);
  const tFade1 = Math.max(tFade0 * 1.2, num(fade[1], tHead1 * 4));
  const tStem = artTime(art.stem_delay, tHead0 * 0.9);
  // Время стабилизации гриба = 3·tau подъёма облака
  // (blast_physics.gd::cloud_stabilization_time) — по нему источник гасит
  // пыль у земли: у мегатонн это минуты, а не секунды.
  const tStab = artTime(art.t_stab_s, 3 * clamp(165 * (kt / 1000) ** 0.1, 60, 250));
  const tFull = Array.isArray(art.top_keys) && art.top_keys.length
    ? art.top_keys[art.top_keys.length - 1][0] * k
    : tHead1 * 10;

  const topKeys = Array.isArray(art.top_keys) ? keysLen(art.top_keys)
    : [[0, burstHeight], [tHead1, burstHeight + cloudTop * 0.3], [tHead1 * 4, burstHeight + cloudTop * 0.72], [tFull, burstHeight + cloudTop]];
  // Ключи купола даны на паспортном горизонте испытания (у «Айви Кинг» — 600 с,
  // у «Айви Майк» — 1800 с), а подъём облака кончается на tFull: 100 и 360 с.
  // Без сжатия показ обрывается на «гвозде» — кадр 15.11 strike29 дал шляпу
  // 3,3 км при вершине 16,2 км. Сжимаем ось времени купола так, чтобы
  // документированный диаметр доставал до конца подъёма; там, где кривая и без
  // того шире потолка, правит riseLimit, и сжатие ничего не меняет.
  const capKeysRaw = Array.isArray(art.cap_d_keys) && art.cap_d_keys.length ? art.cap_d_keys : null;
  const capSquash = capKeysRaw
    ? Math.min(1, tFull / (capKeysRaw[capKeysRaw.length - 1][0] * k))
    : 1;
  const capKeys = capKeysRaw
    ? capKeysRaw.map(([t, v]) => [t * k * capSquash, v * k])
    : [[tHead0, fireballMax * 1.6], [tHead1 * 2.4, capRadius * 1.5], [tFull, capRadius * 2.2]];
  const aspectKeys = Array.isArray(art.cap_aspect_keys) ? keysTime(art.cap_aspect_keys) : [[0, 0.78], [tFull, 0.42]];

  const topY = Math.max(burstHeight, keyAt(topKeys, s, cloudTop));
  // Диаметр шляпы ограничен долей высоты облака: у реальных ядерных грибов он
  // 0,5-0,65 подъёма. Без потолка документированный купол РДС-37 (28 км)
  // надевался уже на трети подъёма: шляпа 22 км в поперечнике при вершине 14 км
  // ложилась на землю мячом и прятала ножку целиком (кадр 15.11 rds37_s209).
  // Потолок считаем от cloudTop, а не от текущей вершины: высота подъёма в
  // начальный момент содержит отметку подрыва — число самолёта, не функцию
  // мощности, — и масштабирование заряду по W^⅓ ломалось бы на этом остатке.
  const riseLimit = cloudTop * (0.50 + 0.15 * smoothstep(tFull * 0.5, tFull * 1.6, s));
  const capD = Math.min(riseLimit, Math.max(fireballMax * 0.8, keyAt(capKeys, s, capRadius * 2)));
  const capR = capD * 0.5 * (1 + num(art.overshoot, 0.1) * Math.exp(-Math.max(0, s - tHead1) / (tHead1 * 2)));
  const halfH = Math.max(capR * 0.12, capR * keyAt(aspectKeys, s, 0.55));
  const headY = Math.max(burstHeight + halfH, topY - halfH);

  // Огненный шар: рост по Седову, остывание по температурной кривой, затем втягивается в шляпу.
  const tMin = 0.0035 * kt ** 0.4;
  const t2 = 0.0417 * kt ** 0.44;
  const tMax = 10 * t2;
  const growth = clamp01(Math.log1p(s / Math.max(0.02, tMax * 0.12)));
  const sedov = 1.033 * (0.5 * kt * 4.184e9 * s * s / 1.225) ** 0.2;
  const fbR = Math.max(1, Math.min(fireballMax, (sedov ** -4 + fireballMax ** -4) ** -0.25) * lerp(0.35, 1, growth));
  let temp;
  if (s <= tMin) temp = 60_000 * Math.exp(Math.log(3300 / 60_000) * (s / Math.max(tMin, 1e-6)));
  else if (s <= t2) temp = lerp(3300, 8000, smoothstep(tMin, t2, s));
  else {
    const tau = s / Math.max(t2, 1e-6);
    const pulse = (15 / 7) * tau * tau / (1 + (8 / 7) * tau ** 3.75);
    const r2 = 61 * kt ** 0.4;
    const r = Math.max(r2, headY > r2 ? headY : r2 * (1 + 0.55 * Math.log1p(Math.max(0, tau - 1))));
    temp = Math.max(600, 8000 * Math.max(0, pulse) ** 0.25 * Math.sqrt(r2 / r));
  }
  const fbOpacity = clamp01(1 - smoothstep(tFade0, tFade1, s))
    * clamp01(1 - smoothstep(tHead1 * 3.2, tHead1 * 7, s));
  // Шар поднимается вместе с зарождающейся шляпой: физически это один и тот же газ.
  const fbY = lerp(burstHeight > 0 ? burstHeight : fbR * 0.55, headY, smoothstep(tHead0 * 0.5, tHead1 * 1.4, s));
  const skin = clamp01((s / Math.max(t2, 1e-6) - 8) / 32);

  const headDens = smoothstep(tHead0 * 0.6, tHead1, s)
    * (num(art.cap_keep, 1) > 0 ? 1 : 1 - smoothstep(tFull * 1.4, tFull * 3, s));
  const whiten = clamp01(s / Math.max(0.05, artTime(art.whiten_time, 0.2)) / Math.max(1, tHead1));
  const headEarly = rgb(art.head_color_early, [0.34, 0.17, 0.08]);
  const headLate = rgb(art.head_color_late, [0.62, 0.56, 0.50]);

  const stemDens = smoothstep(tStem, tStem * 1.8 + 0.4, s)
    * num(art.stem_density, surface ? 0.75 : 0.4)
    * (1 - smoothstep(tFull * 2.2, tFull * 4.5, s) * 0.55);
  const stemTop = Math.max(0, headY + halfH * 0.15) * smoothstep(tStem, tStem * 2.6 + 1, s);

  // Юбка у основания — skirt_state() источника: для ядерного взрыва это низкий
  // сплошной холм под ножкой гриба (inner = 0, skirt_front = 0), ограниченный
  // радиусом 3 psi. Полая стена с гребнем бывает только у колонных типов
  // (BURIED/UNDERWATER), и там правит _base_surge по своим ключам. Кольца пыли
  // на самом фронте в объёме источника нет вовсе: «баранка» и белая «скатерть»
  // до горизонта были выдумкой переноса.
  const kind = String(profile.burst_type ?? '');
  const column = kind.includes('BURIED') || kind.includes('UNDERWATER') || art.col_height !== undefined;
  const slant = shockRadiusM(kt, s, surface);
  const frontR = Math.sqrt(Math.max(0, slant * slant - burstHeight * burstHeight));
  const frontPsi = overpressurePsi(kt, slant);
  // Поднимает грунт отражённая волна у земли: юбка стартует, когда фронт дошёл
  // до точки подрыва и обогнал огненный шар.
  const tArrived = shockArrivalSeconds(kt, Math.max(burstHeight, 1), false);
  const tHit = num(art.skirt_early, 0) ? tArrived : Math.max(tArrived, tMax * 0.5);
  let surgeR = 0;
  let surgeH = 0;
  let surgeDens = 0;
  let surgeInner = 0;
  if (column) {
    const t0 = num(art.surge_start, 1e9);
    if (s >= t0) {
      const tau = Math.max(0.001, num(art.surge_tau, 60) * k);
      const rmax = Math.max(1, num(art.surge_r, 1000) * k);
      const x = s - t0;
      surgeR = rmax * (1 - Math.exp(-x / tau)) + Math.max(1, num(art.col_radius, 20) * k);
      surgeH = lerp(num(art.surge_h0, 50) * k, num(art.surge_h1, 150) * k, clamp01(x / (tau * 3)));
      surgeDens = num(art.surge_density, 0.9) * clamp01(x / 3) * clamp(1 - (x - tau * 4) / (tau * 4), 0, 1);
      surgeInner = num(art.surge_inner, 0) * clamp01(x / (tau * 2));
    }
  } else {
    const skirtAmt = num(art.skirt, (surface || art.dusty) ? 1 : 0.25);
    const rmax = artLen(art.skirt_max_r, radiusForPressurePsi(kt, 3, surface) * 0.9);
    const r = Math.min(frontR, rmax);
    if (s > 0 && skirtAmt > 0 && r > 0 && s >= tHit) {
      const grow = clamp01(r / Math.max(rmax, 1));
      const hk = surface || art.dusty ? 1 : 0.45;
      surgeR = r + Math.min(s - tHit, 40);
      surgeH = Math.max(r * 0.05, fireballMax * 0.1) * num(art.skirt_height, 1) * hk
        * (0.55 + 0.45 * grow) + Math.min(s, 6) * 0.6;
      const fade = Array.isArray(art.skirt_fade_s) && art.skirt_fade_s.length > 1
        ? 1 - smoothstep(art.skirt_fade_s[0] * k, art.skirt_fade_s[1] * k, s)
        : 1 - smoothstep(0.3 * tStab, 1.6 * tStab, s);
      surgeDens = skirtAmt * fade * clamp01((s - tHit) / Math.max(tMax, 0.2));
    }
  }

  // Кольца конденсации, ледяные шапки и купол грунта — три слоя источника,
  // которые мы до сих пор не переносили: без них гриб теряет и «воротник»
  // Браво, и пилеус над шляпой, и холм выброса у Седана.
  // rise_norm из explosion_profile.gd (tau = t_stab/3).
  const riseTau = Math.max(1, tStab / 3);
  const riseNorm = (x) => Math.tanh(Math.max(0, x) / riseTau);
  // Радиус ножки в момент s (stem_state): растёт от следа шара к stem_r, но не
  // больше трети шляпы — им источник меряет кольца.
  const rx = clamp01(s / Math.max(tStab * 0.4, 1));
  const stemNow = Math.min(lerp(Math.max(fireballMax * 0.35, stemRadius * 0.35), stemRadius, Math.sqrt(rx)),
    capR * num(art.stem_cap_ratio, 0.3));
  // Влажность для колец — своя формула источника: clamp((H-0.3)/0.5, 0.15, 1).
  const humRing = clamp((num(art.site_humidity, 0.45) - 0.3) / 0.5, 0.15, 1);
  const emptyRing = { y: 0, r: 0, th: 0, op: 0 };
  const rings = [];
  const ringList = Array.isArray(art.ring_list) ? art.ring_list : null;
  if (ringList) {
    // Явные документированные кольца: [t_on, life, y, radius, half_thickness, (op)]
    for (let i = 0; i < Math.min(ringList.length, 4); i += 1) {
      const rg = ringList[i];
      const tOn = num(rg[0], 1e9) * k;
      const life = Math.max(1, num(rg[1], 1) * k);
      const x0 = (s - tOn) / life;
      if (x0 < 0 || x0 > 1.6) { rings.push(emptyRing); continue; }
      let op = smoothstep(0, 0.12, x0) * (1 - smoothstep(0.7, 1.6, x0)) * Math.max(humRing, 0.6);
      const half = num(rg[4], 0) * k;
      let ry = num(rg[2], 0) * k * (1 + 0.15 * x0);
      // Кольцо не имеет права утонуть в ещё живой шляпе: источник опускает его
      // под нижний край головы.
      if (headDens > 0.05 && ry < headY) ry = Math.min(ry, headY - halfH - 2 * half);
      if (rg.length > 5) op *= num(rg[5], 1);
      rings.push({ y: ry, r: num(rg[3], 0) * k * (1 + 0.25 * x0), th: half, op });
    }
  } else {
    const n = Math.round(num(art.rings, 0));
    const rT0 = num(art.ring_t0, 0.03);
    const rLife = num(art.ring_life, 0.12);
    for (let i = 0; i < Math.min(n, 4); i += 1) {
      const tOn = tStab * (rT0 + 0.02 * i);
      const life = Math.max(1e-3, tStab * rLife);
      if (s < tOn || s > tOn + life * 2) { rings.push(emptyRing); continue; }
      const x = (s - tOn) / life;
      const rr = Math.max(stemNow, stemRadius * 0.5) * (2.2 + 0.4 * i) * (1 + 0.3 * x);
      rings.push({
        y: cloudTop * (0.25 + 0.13 * i) * (0.6 + 0.4 * riseNorm(s)),
        r: rr,
        th: clamp(rr * 0.05, 60, 400),
        op: smoothstep(0, 0.2, x) * (1 - smoothstep(0.8, 2.0, x)) * humRing,
      });
    }
  }
  while (rings.length < 4) rings.push(emptyRing);

  // Лёд: which=0 — нарамка (pileus) над шляпой, which=1 — второй ярус, «юбка-колокол».
  const iceShell = (cfg, which) => {
    if (!cfg || typeof cfg !== 'object' || Object.keys(cfg).length === 0) return { y: 0, r: 0, half: 0, op: 0 };
    const tOn = num(cfg.t_on, 0.06) * tStab;
    const dur = Math.max(1e-3, num(cfg.dur, 0.35) * tStab);
    if (s < tOn) return { y: 0, r: 0, half: 0, op: 0 };
    const x = (s - tOn) / dur;
    const op = smoothstep(0, 0.15, x) * (1 - smoothstep(0.7, 1.4, x)) * num(cfg.opacity, 0.8);
    if (!(op > 0)) return { y: 0, r: 0, half: 0, op: 0 };
    if (which === 0) {
      const r = capR * num(cfg.r_rel, 1.1);
      return { y: headY + halfH + halfH * num(cfg.lift, 0.1) - r * 0.25, r, half: r * 0.3, op };
    }
    return {
      y: cloudTop * num(cfg.height_rel, 0.7),
      r: num(cfg.radius_m, capRadius * 1.4) * k * clamp01(0.3 + 0.7 * x),
      half: Math.max(1, num(cfg.half_m, 3000) * k),
      op,
    };
  };
  const ice = iceShell(art.ice_cap, 0);
  const ice2 = iceShell(art.tier2, 1);

  // Купол грунта (Седан, камуфлет): сферическая шапка, потом прорыв кракелюра.
  let domeR = 0;
  let domeH = 0;
  let domeCrack = 0;
  const domeBase = num(art.dome_r, 0) * k;
  if (domeBase > 0 && s > 0) {
    const tRise = Math.max(0.001, num(art.dome_time, 1) * k);
    const tBurst = num(art.dome_burst, num(art.dome_time, 1)) * k;
    const x = clamp01(s / tRise);
    let h = num(art.dome_h, 0) * k * x ** 1.7;
    if (s > tBurst) h *= clamp01(1 - (s - tBurst) / (0.4 * k));
    domeR = domeBase;
    domeH = h;
    domeCrack = clamp01((s - tRise * 0.6) / Math.max(tRise, 0.1));
  }

  const wind = Array.isArray(art.wind) ? art.wind : [2, -1];

  // Сфера-ограничитель обязана обнимать ЖИВЫЕ части с запасом по шуму и сносу.
  // Слишком щедрая — раздувает луч и шаг мариновки, и гриб не досчитывается до
  // дальнего края (он и рассыпался на отдельные шары); слишком тесная — режет облако.
  const cellH = 0.35 * halfH + 0.08 * capR;
  const ampH = Math.min(num(art.head_noise_amp, 0.16) * Math.min(capR, halfH * 1.8), halfH * 0.60, cellH * 0.85);
  const ampS = stemRadius * 0.6;
  const ampK = surgeH * 1.05;
  const driftM = Math.hypot(num(wind[0], 2), num(wind[1], -1)) * s * 1.5;
  // Тонкие слои (кольца, шапки, купол) обязаны попадать в ограничитель, иначе
  // марш их просто не увидит.
  const extrasTop = Math.max(ice.op > 0 ? ice.y + ice.half : 0, ice2.op > 0 ? ice2.y + ice2.half : 0,
    ...rings.map((rg) => (rg.op > 0 ? rg.y + rg.th : 0)));
  const extrasWide = Math.max(ice.op > 0 ? ice.r : 0, ice2.op > 0 ? ice2.r : 0, domeR,
    ...rings.map((rg) => (rg.op > 0 ? rg.r : 0)));
  const liveTop = Math.max(
    headDens > 0.05 ? headY + halfH + ampH : 0,
    stemDens > 0.05 ? stemTop + ampS : 0,
    fbOpacity > 0.05 ? fbY + fbR : 0,
    surgeDens > 0.05 ? surgeH + ampK : 0,
    extrasTop,
    domeH,
  );
  const liveWide = Math.max(
    headDens > 0.05 ? capR + ampH : 0,
    stemDens > 0.05 ? stemNow * 1.6 + ampS : 0,
    fbOpacity > 0.05 ? fbR : 0,
    surgeDens > 0.05 ? surgeR + ampK : 0,
    extrasWide,
  ) + driftM;

  return {
    simTime: s,
    alive: s < tFull * 6 && headDens + fbOpacity + surgeDens > 0.002,
    // Окна формирования — по ним водитель выбирает степень сжатия времени и
    // длительность показа; themselves уже пересчитаны под выбранную мощность.
    timing: { tHead0, tHead1, tFade0, tFade1, tStem, tFull, fireballMax, cloudTop, capRadius, stemRadius },
    fireball: {
      y: fbY, r: fbR, temp, opacity: fbOpacity, skin,
      squash: num(art.fireball_squash, surface ? 1.05 : 1),
      mottle: clamp01(smoothstep(t2 * 6, t2 * 30, s) * (1 - smoothstep(tFade0, tFade1, s))),
      noise: num(art.fireball_noise, 0.14),
      noiseScale: num(art.fireball_noise_scale, 10),
      // Источник (explosion_profile.gd): emis = emission_scale(1600) * fireball_brightness.
      // Мягкий тонмап в шейдере рассчитан именно на этот порядок, а не на единицы.
      emission: 1600 * num(art.fireball_brightness, 1),
      cut: surface ? -1e9 : 0,
      tint: rgb(art.fireball_tint, [1, 1, 1]),
      tintStrength: Array.isArray(art.fireball_tint) ? num(art.fireball_tint[3], 0) : 0,
    },
    head: {
      y: headY, r: capR, halfH, density: headDens,
      torus: smoothstep(tHead1 * 0.8, tHead1 * 3.2, s),
      // У ядерных профилей head_lobes нет: всю cauliflower-иерархию держат
      // октавы шума, а не три смещённых эллипсоида.
      lobes: num(art.head_lobes, 0),
      roll: clamp(0.55 * smoothstep(tHead1, tFull, s), 0, 0.6),
      colA: headEarly, colB: headLate, colMix: whiten,
      darkBase: clamp01(num(art.dark_base, 0.6)),
      heatK: temp, heatGlow: clamp01(fbOpacity * 1.2) * num(art.core_glow, 1.2),
      heatRadius: 1.3, cellRel: num(art.head_noise_scale, 0.55),
      noiseAmp: num(art.head_noise_amp, 0.16), billow: num(art.billow_sharp, 1.3),
      erosion: num(art.erosion, 0.8), lobeGain: num(art.head_lobe_gain, 1), rampK: num(art.head_ramp, 1),
    },
    stem: {
      // Радиус ножки берём уже ограниченный третьим шляпы (stem_state выше):
      // без this гриб выходил «гвоздём» — колонна 850 м под шапкой 2000 м.
      y0: 0, y1: stemTop, r: stemNow, density: stemDens,
      flare: num(art.stem_flare, 1.35), waist: 0.22,
      // Ножка — вихрь, а не труба: пыль вынесена к краю, ось прозрачнее.
      hollow: clamp01(num(art.stem_hollow, 0.5)), rise: 1.2,
      col: rgb(art.stem_color, [0.30, 0.24, 0.18]), stretch: num(art.stem_stretch, 1.1),
      wobble: num(art.stem_wobble, 0.28), twist: num(art.stem_twist, 0),
      topFlare: num(art.stem_top_flare, 0.5),
    },
    skirt: {
      // У ядерного взрыва юбка — сплошной низкий холм под ножкой, а не кольцо:
      // inner = 0 и skirt_front = 0 (explosion_profile.gd::skirt_state). Полый
      // вал с фронтом появляется только у колонных типов (BURIED/UNDERWATER).
      r: surgeR, h: surgeH, density: surgeDens, inner: surgeInner,
      front: column ? 1 : 0, col: rgb(art.skirt_color ?? art.dust_color, [0.55, 0.48, 0.40]),
    },
    wind: [num(wind[0], 2), num(wind[1], -1)],
    // y, радиус, полутолщина, непрозрачность — ровно как vec4 в источнике.
    rings: rings.map((rg) => [rg.y, rg.r, rg.th, rg.op]),
    ice: [ice.y, ice.r, ice.half, ice.op],
    ice2: [ice2.y, ice2.r, ice2.half, ice2.op],
    dome: [domeR, domeH, domeCrack, 0],
    // -1 по всем каналам означает «цвет грунта», как в dome_color по умолчанию.
    domeCol: rgb(art.dome_color, [-1, -1, -1]),
    windH: Math.max(cloudTop * 0.5, 50),
    churn: num(art.churn_abs, 0.12),
    groundCol: rgb(art.dust_color, [0.36, 0.33, 0.29]),
    shock: (() => {
      // Фронт — отдельный слой источника (shockwave.gdshader + fx_layers.gd):
      // чистая рефракция фона, а не линия. Пока фронт внутри огненного шара,
      // он не виден вовсе; оптическая толщина = 0.15·c₀·t⁺; амплитуда — по
      // типу и мощности взрыва; конденсация только для больших зарядов во
      // влажном воздухе.
      const nuclear = !kind.includes('CONVENTIONAL');
      const out = smoothstep(1.2, 1.6, slant / Math.max(fbR, 1));
      const amp = (nuclear ? lerp(0.2, 1.0, smoothstep(0.5, 3.0, kt)) : 0.2)
        * num(art.shock_refraction, 1.0)
        * (kind.includes('UNDERWATER') ? 0.2 : 1)
        * out;
      const on = slant > 1 && frontPsi > 0.05 && amp > 0 && !kind.includes('BURIED');
      const thick = clamp(COMPRESSED_LAYER * positivePhaseSeconds(kt, frontPsi, surface), 0.1, slant * 0.08);
      const stemH = burstHeight > 0 && slant > burstHeight * 1.1
        ? Math.min(slant * 0.25, burstHeight * 1.5) : 0;
      const hum = clamp01((num(art.site_humidity, 0.45) - 0.45) / 0.35);
      const ownKt = num(profile.yield_kt, kt);
      const tEnd = ownKt > 10000 ? 40 : 12;
      const cond = on && nuclear
        ? smoothstep(300, 5000, kt) * num(art.shock_condensation, 1.0) * hum
          * smoothstep(ownKt > 10000 ? 1.5 : 4.0, 10.0, frontPsi)
          * (1 - smoothstep(tEnd * 0.5, tEnd, s)) * out
        : 0;
      return on ? {
        y: burstHeight, r: slant, psi: frontPsi, thick,
        stem: stemH, cond, condW: slant * 0.06, amp,
      } : { y: 0, r: 0, psi: 0, thick: 0, stem: 0, cond: 0, condW: 0, amp: 0 };
    })(),
    bound: {
      y: liveTop * 0.5,
      r: Math.max(Math.hypot(liveWide, liveTop * 0.5), 60),
    },
    life: clamp01(s / (tFull * 1.6)),
  };
}

const FS = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;

uniform vec3 u_ax0;
uniform vec3 u_ax1;
uniform vec3 u_ax2;
uniform vec3 u_cam;
uniform vec3 u_rayDir;
uniform vec3 u_rayUp;
uniform vec3 u_rayRight;
uniform vec2 u_rayTan;
uniform vec3 u_bound;
uniform float u_boundR;
uniform float u_seed;
uniform float u_age;
uniform float u_exposure;
uniform vec4 u_fb;
uniform vec4 u_fbLook;
uniform vec4 u_fbShape;
uniform vec4 u_fbTint;
uniform float u_fbCut;
uniform vec4 u_head;
uniform vec4 u_headShape;
uniform vec4 u_headColA;
uniform vec4 u_headColB;
uniform vec4 u_headHeat;
uniform vec4 u_headDetail;
uniform float u_headRamp;
uniform float u_lobes;
uniform vec4 u_stem;
uniform vec4 u_stemShape;
uniform vec4 u_stemCol;
uniform float u_stemWobble;
uniform float u_stemTwist;
uniform float u_stemTopFlare;
uniform vec4 u_skirt;
uniform vec4 u_skirtCol;
uniform float u_skirtFront;
// Четыре кольца конденсации вместо массива: SwiftShader + Cesium
// PostProcessStage не везде переваривают uniform vec4[4], а динамический
// индекс по такому массиву — самое хрупкое место.
uniform vec4 u_ring0;
uniform vec4 u_ring1;
uniform vec4 u_ring2;
uniform vec4 u_ring3;
uniform vec4 u_ice;
uniform vec4 u_ice2;
uniform vec4 u_dome;
uniform vec4 u_domeCol;
uniform vec3 u_wind;
uniform float u_windH;
uniform float u_churn;
uniform vec3 u_groundCol;
uniform float u_sunI;
// Направление солнца в локальной системе (восток, вверх, север). Берём не
// czm_sunDirectionWC: сцена игры рисуется при выключенном освещении, то есть
// земля всегда «дневная», а астрономическое солнце над Лондоном в 02:00 UTC
// стоит под горизонтом — и гриб получал свет снизу, из-за чего нижняя сторона
// шляпы была ярче верхней. JS подаёт реальное солнце, а когда оно ниже
// горизонта — фиктивный «съёмочный» свет.
uniform vec3 u_sunDir;
uniform float u_flash;
uniform float u_life;
uniform float u_dbg;
uniform float u_stepScale;
uniform vec4 u_shock;
uniform vec4 u_shock2;
uniform vec4 u_shock3;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
vec3 blackbody(float t) {
  float h = clamp(t, 800.0, 40000.0) / 100.0;
  float r = h <= 66.0 ? 1.0 : clamp(1.29293618606 * pow(h - 60.0, -0.1332047592), 0.0, 1.0);
  float g = h <= 66.0 ? clamp(0.39008157876 * log(h) - 0.63184144378, 0.0, 1.0)
                      : clamp(1.12989086089 * pow(h - 60.0, -0.0755148492), 0.0, 1.0);
  float b = h >= 66.0 ? 1.0 : (h <= 19.0 ? 0.0 : clamp(0.54320678911 * log(h - 10.0) - 1.19625408914, 0.0, 1.0));
  return pow(vec3(r, g, b), vec3(2.2));
}
// Видимая яркость тела по температуре, та же кривая, что в исходнике.
float bbLum(float t) {
  float x = t / 8000.0;
  return x * x * x * x * smoothstep(650.0, 1500.0, t);
}
float hg(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (6.2831853 * pow(max(0.0001, 1.0 + g2 - 2.0 * g * mu), 1.5));
}

// --- процедурный шум вместо 3D-текstur noise_a/noise_b из исходника -------------
float nHash(vec3 p) {
  p = fract(p * 0.3183098861 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float nValue(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(nHash(i), nHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(nHash(i + vec3(0.0, 1.0, 0.0)), nHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(nHash(i + vec3(0.0, 0.0, 1.0)), nHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(nHash(i + vec3(0.0, 1.0, 1.0)), nHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float nlf(vec3 p) {
  // В тайле noise_a лежит 4..64 октав fbm, а не одна особенность: без этого
  // множителя низкочастотный warp растягивается на весь гриб.
  p *= 4.0;
  return mix(mix(nValue(p), nValue(p * 2.07 + 5.0), 0.5), nValue(p * 4.3 + 11.0), 0.28);
}
// Инвертированная ячеечатая текстура: соты конвективных валов (аналог noise_b).
float nbl(vec3 p) {
  // В тайле noise_b — 6 ячеек Worley. При cell ≈ 0.29 R это даёт валы шляпы
  // ≈ 0.44 R с собственными суб-валами на следующих октавах (0.30/0.85/2.1).
  p *= 6.0;
  vec3 i = floor(p);
  vec3 f = fract(p);
  float best = 1.0;
  for (int k = 0; k < 8; k += 1) {
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 j = vec3(nHash(i + o - 0.5), nHash(i + o + vec3(3.7, 1.1, 5.3)), nHash(i + o + vec3(9.1, 6.3, 2.7)));
    vec3 r = o + j * 0.7 - f;
    best = min(best, dot(r, r));
  }
  return clamp(1.0 - sqrt(best) * 1.35, 0.0, 1.0);
}

vec3 w2l(vec3 v) {
  return vec3(dot(u_ax0, v), dot(u_ax1, v), dot(u_ax2, v));
}
// Снос ветром: низ остаётся, верх уходит по ветру (в исходнике — shear ниже
// wind_h). Ножка над 0.8 своей высоты уже несётся вместе со шляпой.
vec3 windAt(float y, float rigid) {
  float hy = clamp(max(u_head.y, u_fb.y) / max(u_windH, 1.0), 0.0, 1.5);
  float wy = clamp(y / max(u_windH, 1.0), 0.0, 1.5);
  float blend = max(rigid, u_stem.z > 0.0 ? smoothstep(0.8 * u_stem.y, u_stem.y, y) : 0.0);
  return u_wind * u_age * mix(wy, hy, blend);
}

// ------------------------------------------------------------------ формы
float sdfFireball(vec3 p) {
  if (u_fb.w <= 0.0) return 1e9;
  vec3 q = p - u_fb.xyz;
  q.y /= u_fbShape.x;
  return length(q) - u_fb.w;
}
float sdfHeadBase(vec3 q) {
  float R = u_head.w;
  float H = u_headShape.x;
  float blob = sdEllipsoid(q, vec3(R, H, R));
  if (u_lobes > 0.0) {
    float sa = u_seed * 2.399;
    vec3 o1 = vec3(cos(sa) * R * 0.42, H * 0.12, sin(sa) * R * 0.42);
    vec3 o2 = vec3(cos(sa + 2.3) * R * 0.38, -H * 0.18, sin(sa + 2.3) * R * 0.38);
    vec3 o3 = vec3(cos(sa + 4.2) * R * 0.30, H * 0.28, sin(sa + 4.2) * R * 0.30);
    float l1 = sdEllipsoid(q - o1, vec3(R * 0.68, H * 0.78, R * 0.62));
    float l2 = sdEllipsoid(q - o2, vec3(R * 0.62, H * 0.70, R * 0.66));
    float l3 = sdEllipsoid(q - o3, vec3(R * 0.55, H * 0.72, R * 0.58));
    blob = mix(blob, smin(smin(l1, l2, H * 0.25), l3, H * 0.25), u_lobes);
  }
  float rxz = length(q.xz);
  float dome = sdEllipsoid(q - vec3(0.0, H * 0.20, 0.0), vec3(R * 0.90, H * 0.80, R * 0.90));
  float tor = length(vec2((rxz - R * 0.62) * 0.92, q.y + H * 0.25)) - H * 0.62;
  float mush = smin(dome, tor, H * 0.30);
  mush = max(mush, -(length(vec2(rxz, (q.y + H * 1.05) * 1.4)) - R * 0.12));
  return mix(blob, mush, u_headShape.y);
}
float sdfHead(vec3 p) {
  if (u_head.w <= 0.0 || u_headShape.z <= 0.0) return 1e9;
  return sdfHeadBase(p - u_head.xyz);
}
float stemRadiusAt(float y) {
  float h01 = clamp((y - u_stem.x) / max(u_stem.y - u_stem.x, 1.0), 0.0, 1.0);
  // Ножка не цилиндр: у земли раструб, в середине — талия, под шляпой она
  // расходится в шею и затягивается в голову. Именно ровная колонна с ровно
  // срезанным верхом и давала «гвоздь» вместо гриба.
  float r = u_stem.z * (1.0 + (u_stemShape.x - 1.0) * exp(-h01 * 3.0));
  r *= 1.0 - u_stemShape.y * sin(min(h01 * 1.1, 0.94) * 3.14159) * 0.5;
  float neck = smoothstep(0.62, 1.0, h01);
  r *= 1.0 + (0.55 + u_stemTopFlare) * neck * neck;
  return r;
}
float sdfStem(vec3 p) {
  if (u_stem.z <= 0.0 || u_stem.w <= 0.0) return 1e9;
  float r = stemRadiusAt(p.y);
  float d = length(p.xz) - r;
  float dv = max(u_stem.x - p.y, p.y - u_stem.y);
  return max(d, dv);
}
float sdfSkirt(vec3 p) {
  if (u_skirt.x <= 0.0 || u_skirt.z <= 0.0) return 1e9;
  float r = length(p.xz);
  float h = u_skirt.y;
  float R = u_skirt.x;
  float x = r / max(R, 1.0);
  float prof = mix(1.0, 0.3, smoothstep(0.15, 1.0, x)) * (1.0 - smoothstep(0.72, 1.25, x));
  prof = mix(prof, mix(0.45, 1.0, smoothstep(0.5, 0.95, x)) * (1.0 - smoothstep(0.95, 1.25, x)), u_skirtFront);
  float hh = h * prof;
  float d = max(p.y - hh, -p.y - h * 0.15);
  d = max(d, r - R * 1.3 - h * 0.5);
  d = max(d, (R * u_skirt.w - r) * 0.5);
  return d;
}
float sdfRingOne(vec4 rg, vec3 p, float r) {
  if (rg.w <= 0.0) return 1e9;
  // плоский диск-воротник без отверстия: радиус rg.y, полутолщина rg.z
  float th = max(rg.z, rg.y * 0.012);
  return max(r - rg.y, abs(p.y - rg.x) - th * (1.0 - 0.7 * smoothstep(0.4, 1.0, r / max(rg.y, 1.0))));
}
float sdfRings(vec3 p) {
  float r = length(p.xz);
  float d = 1e9;
  d = min(d, sdfRingOne(u_ring0, p, r));
  d = min(d, sdfRingOne(u_ring1, p, r));
  d = min(d, sdfRingOne(u_ring2, p, r));
  d = min(d, sdfRingOne(u_ring3, p, r));
  return d;
}
float sdfShell(vec3 p, vec4 s) {
  if (s.w <= 0.0) return 1e9;
  vec3 q = p - vec3(0.0, s.x, 0.0);
  // сплошная низкоплотная линза (пилеус / ледяная шапка), снизу открыта колоколом
  return max(sdEllipsoid(q, vec3(s.y, s.z, s.y)), -q.y - s.z * 0.35);
}
float sdfDome(vec3 p) {
  if (u_dome.y <= 0.05) return 1e9;
  float R = u_dome.x;
  float h = u_dome.y;
  float rr = length(p.xz) / max(R, 1.0);
  // купол грунта: сферическая шапка, прочитанная как height-field
  float d = (p.y - h * exp(-2.2 * rr * rr)) * 0.6;
  return max(d, -p.y);
}
// Плотность без шума — для длинных теневых лучей.
float cheapDensity(vec3 p) {
  float d = 0.0;
  if (u_head.w > 0.0) d += clamp(-sdfHead(p) / (u_headShape.x * 0.8), 0.0, 1.0) * u_headShape.z;
  // Мягкая верхняя граница столба как у источника: аналитическая плоскость
  // вершины иначе отбрасывает на поднимающуюся голову ножом резаную полосу.
  if (u_stem.z > 0.0) {
    float stopC = u_stem.y;
    d += clamp(-sdfStem(p) / u_stem.z, 0.0, 1.0) * u_stem.w
      * smoothstep(stopC, stopC - 0.35 * (stopC - u_stem.x), p.y);
  }
  if (u_fb.w > 0.0) d += clamp(-sdfFireball(p) / (u_fb.w * 0.3), 0.0, 1.0) * u_fbLook.w * 2.0;
  if (u_skirt.x > 0.0) d += clamp(-sdfSkirt(p) / (u_skirt.y * 1.2), 0.0, 1.0) * u_skirt.z;
  return d;
}

// ------------------------------------------------------------------ функции плотности
// Каждый слой принимает уже посчитанный SDF: марш и так вычисляет все восемь
// расстояний ради общего минимума, а повторный вызов той же функции внутри
// плотности
// удваивал работу на каждом шаге, где луч зацепил облако. Обёртки без base
// остаются для световых тапов, где точка другая.
float headDensity(vec3 p, float baseIn, out float cauli, out vec3 bump) {
  cauli = 0.5;
  bump = vec3(0.5);
  if (u_head.w <= 0.0) return 0.0;
  vec3 q = p - u_head.xyz;
  float R = u_head.w;
  float H = u_headShape.x;
  float base = baseIn;
  float amp = u_headDetail.x * min(R, H * mix(1.8, 1.2, smoothstep(0.5, 1.0, u_headShape.y)));
  // Выпуклость долек не имеет права съесть оболочку, но и не имеет права
  // утонуть в полосе сглаживания: смещение должно быть кратно больше неё,
  // иначе купол — бледное суфле без рельефа.
  amp = min(amp, H * 0.60);
  if (base > amp * 1.2) return 0.0;
  float rxz = length(q.xz);
  vec2 dir = rxz > 1e-3 ? q.xz / rxz : vec2(1.0, 0.0);
  float a = R * 0.62;
  vec2 rc = vec2(rxz - a, q.y + H * 0.25);
  float roll = min(u_headShape.w, 0.6) * u_headShape.y * smoothstep(0.15 * R, 0.5 * R, rxz);
  vec2 rr = vec2(cos(roll) * rc.x - sin(roll) * rc.y, sin(roll) * rc.x + cos(roll) * rc.y);
  vec3 qn = vec3(dir.x * (rr.x + a), rr.y - H * 0.25, dir.y * (rr.x + a));
  // Ячейка обязана укладываться в купол ~10 раз. При клетке в четверть купола
  // шляпа — не рваное облако, а четыре надувных шара рядом: ровно это и
  // показывал замер «грубо 7.2» при взгляде с 30 км.
  float cell = (0.35 * H + 0.08 * R) * max(0.25, u_headHeat.w);
  // Смещение меньше клетки: при смещении крупнее клетки дольки перестают
  // касаться друг друга и купол распадается на надувные шары. 0.6 давал гладкий
  // «пластиковый» купол, 0.85 возвращает рваный край без распада.
  amp = min(amp, cell * 0.85);
  vec3 np = qn / cell + vec3(u_seed * 1.3, u_seed * 0.37, u_seed * 0.71) + vec3(0.3, -1.0, 0.2) * (u_age * u_churn);
  float warp = nlf(np * 0.07) - 0.5;
  float b1 = nbl(np * 0.11 + warp * 0.22);
  float b2 = nbl(np * 0.30 + 5.3);
  float b3 = nbl(np * 0.85 + 11.0);
  float b4 = nbl(np * 2.1 + 17.0);
  float sharp = u_headDetail.y;
  bump = vec3(b1, b2, b3);
  cauli = pow(b1, sharp) * 0.50 + pow(b2, sharp) * 0.30 + b3 * 0.14 + b4 * 0.06;
  // Клетка мельче пикселя не имеет права качать форму: с орбиты край шляпы
  // начинает мерцать песком, а не рваться дольками.
  float ang = R / max(length(u_cam - u_head.xyz), 1.0);
  float fine = smoothstep(0.02, 0.09, ang);
  float shapeN = pow(b1, sharp) * 0.56 + pow(b2, sharp) * 0.30 + (b3 * 0.10 + b4 * 0.04) * fine;
  // Замер на шляпе R=3438/H=1598 при amp=390: множитель 1.30 давал дольку
  // всего ~150 м — 4% радиуса, и купол выглядел мыльным комком, а не
  // cauliflower. 1.75 поднимает рельеф до ~210 м, не трогая ни клетку, ни
  // соотношение amp/cell (0.85), которая держит купол от распада на шары.
  float dn = base - ((shapeN - 0.42) * 1.75 * u_headDetail.w + warp * 0.45) * amp;
  float edge = H * 0.04 * u_headRamp;
  float dens = smoothstep(edge, -edge * 2.5, dn);
  // тонкая бахрома по краю, без крапинок внутри
  dens *= 1.0 - u_headDetail.z * 0.3 * (1.0 - dens) * smoothstep(0.35, 0.65, 1.0 - b2);
  if (u_headHeat.y > 0.0) {
    float dc = length(vec2(rc.x, rc.y + H * 0.25)) / max(H * u_headHeat.z, 1.0);
    dens *= 1.0 - 0.95 * exp(-dc * dc * 2.0) * clamp(u_headHeat.y / 300.0, 0.0, 1.0);
  }
  if (u_fb.w > 0.0 && u_fbLook.w > 0.3) {
    vec3 qf = (p - u_fb.xyz) / u_fb.w;
    qf.y /= u_fbShape.x;
    dens *= mix(1.0, smoothstep(0.8, 1.15, length(qf)), clamp((u_fbLook.w - 0.3) / 0.5, 0.0, 1.0) * 0.85);
  }
  dens *= smoothstep(0.015, 0.08, dens);
  return dens * u_headShape.z;
}
float headDensity(vec3 p, out float cauli, out vec3 bump) {
  return headDensity(p, sdfHead(p), cauli, bump);
}
float stemDensity(vec3 p, float baseIn, out float nOut) {
  nOut = 0.5;
  if (u_stem.z <= 0.0 || u_stem.w <= 0.0) return 0.0;
  float base = baseIn;
  float r = stemRadiusAt(p.y);
  if (base > r) return 0.0;
  float env = smoothstep(r, r * 0.7, base);
  vec3 pt = p;
  if (u_stemTwist != 0.0) {
    float ang = u_stemTwist * p.y / max(u_stem.z, 1.0);
    pt.xz = vec2(cos(ang) * p.x - sin(ang) * p.z, sin(ang) * p.x + cos(ang) * p.z);
  }
  // колебание оси: ножка извивается, а не труба
  pt.xz += vec2(nlf(vec3(p.y / (8.0 * r), u_age * 0.01, u_seed)) - 0.5) * r * 0.8 * u_stemWobble;
  // Ячейка шума привязана к радиусу ножки, а не к утроенному: иначе поперёк
  // колонны укладывается одна ячейка и столб выглядит полированным цилиндром.
  // Растяжение по вертикали 0.4 давало ячейку в 2.75 раза выше, чем шире: колонна
  // из 10 км набирала 14 «блинов» и читалась как позвоночник, а не как пыль.
  // Изотропная клетка даёт продольные складки, а не горизонтальные диски.
  vec3 np = vec3(pt.x, (pt.y - u_age * u_stemShape.w) * 1.15 / max(u_stemCol.w, 1.0), pt.z) / max(u_stem.z * 0.45, 1.0) + vec3(u_seed * 0.21);
  // Клетка шума обязана быть крупнее шага марша, а перепад складки за шаг —
  // влезать в полосу сглаживания. nbl внутри умножает координату на 6, nlf на 4,
  // поэтому сота = 374/(s*6) м, прожилка = 374/(s*4) м (374 = u_stem.z*0.45).
  // Замеренные провалы: сота 104 м при шаге 88 м — песок (сэмел перескакивает
  // через всю соту), сота 693 м — связка шаров (две соты на диаметре 1664 м).
  // 445 м — это 5 шагов и 3.7 соты поперёк колонны: складка ещё различима,
  // но уже не дискретна.
  // Worley F1 — это ШАРЫ: его изо-поверхности замкнуты вокруг точек затравки,
  // поэтому две октавы nbl читаются как связка налипших комлей на любой клетке
  // (замерено и при 693 м, и при 445 м). Пыльной колонне нужен облачный шум:
  // nlf сам смешивает три решётки (базовая, x2.07, x4.3), то есть даёт складку
  // 275 м с прожилками 133 и 64 м в одном тапе. Worley оставлен одной слабой
  // октавой — редкие комли, и она гаснет, когда колонна мелка на экране.
  // Цена не изменилась: четыре тапа было, четыре стало.
  // Край разгрузили сильнее, чем наделили: перепад 0.62*0.55r = 0.34r при шаге
  // 88 м даёт 45-55 м на шаг против полосы сглаживания 224 м — он больше не
  // рвётся в крапинки и больше не надувается шарами.
  // Цена вопроса измерена тем же шумом в JS (tmp/noise-spread.mjs): у суммы
  // трёх октав sd = 0.08 (размах 0.19..0.80), поэтому усиление 0.85 давало
  // среднеквадратичную складку 31 м — кадр от него не двигался вообще. При 2.4
  // это 88 м, из них 59 м на длине волны 275 м, то есть складка 2.7 пикселя
  // при 12.5 пикселях периода: читается ребром, а не шаром.
  // Полосу сглаживания пришлось расширить до 333 м: худший перепад на шаг
  // 88 м при таком усилении 282 м, и уже полоса 224 м край рвёт в крапинки.
  float fineS = smoothstep(0.012, 0.05, r / max(length(u_cam - p), 1.0));
  float n = nlf(np * 0.34 + 1.0) * 0.5 + nlf(np * 0.1 + 5.0) * 0.3 + nbl(np * 0.1 + 3.0) * 0.2 * fineS;
  float lf = nlf(np * 0.05 + 4.0);
  nOut = n;
  float dn = base - ((n - 0.45) * 2.4 * u_headDetail.w + (lf - 0.5) * 0.9) * r * 0.55;
  float dens = smoothstep(r * 0.07 * u_headRamp, -r * 0.33 * u_headRamp, dn);
  // Ножка — вихрь у самой земли: пыль вынесена к краю, ось прозрачнее там,
  // где её действительно поднимает кольцо обломков. Выше столб плотный по
  // всему сечению: сплошное разжижение оси (0.5 до вершины) делало ножку
  // просвечивающей, и в кадре она темнее, чем в реальности.
  float coreIn = clamp(-base / max(r, 1.0), 0.0, 1.0);
  float lowK = smoothstep(u_stem.y * 0.45, 0.0, p.y);
  dens *= 1.0 - u_stemShape.z * coreIn * coreIn * (0.3 + 0.7 * lowK);
  dens *= smoothstep(u_stem.y + r * 0.5, u_stem.y - r * 3.0 * (0.5 + 0.8 * lf), p.y);
  return dens * u_stem.w * env;
}
float stemDensity(vec3 p, out float nOut) {
  return stemDensity(p, sdfStem(p), nOut);
}
float skirtDensity(vec3 p, float baseIn, out float nOut) {
  nOut = 0.5;
  if (u_skirt.x <= 0.0 || u_skirt.z <= 0.0) return 0.0;
  float h = u_skirt.y;
  float base = baseIn;
  if (base > h * 0.9) return 0.0;
  vec3 np = p / max(h * 2.4, 1.0) + vec3(u_seed * 0.5, -u_age * 0.0015, u_seed);
  float n = nbl(np * 0.5) * 0.6 + nbl(np * 1.5 + 2.0) * 0.4;
  float lf = nlf(np * 0.12);
  nOut = n;
  // Полоса прохода обязана быть сопоставима с самим шумом: при h=300 м и
  // грани 12 м юбка рассыпалась по земле gravel-крапинками, а не катилась
  // сплошной пыльной волной.
  float dn = base - ((n - 0.45) * 0.9 + (lf - 0.5) * 1.4) * h * 0.5;
  return smoothstep(h * 0.5, -h * 0.9, dn) * smoothstep(-h * 0.05, h * 0.15, p.y + h * 0.1) * u_skirt.z;
}
float skirtDensity(vec3 p, out float nOut) {
  return skirtDensity(p, sdfSkirt(p), nOut);
}
// Кольца конденсации: ламинарные листы — шум растянут по горизонтали, иначе
// каждый диск превращается в ватный матрас (цикл 3 источника).
float ringDensity(vec3 ph, float rdd) {
  if (rdd >= 900.0) return 0.0;
  vec3 lam = ph * vec3(0.00035, 0.004, 0.00035);
  float n = nlf(lam + u_seed) * 0.6 + nbl(ph * vec3(0.0011, 0.006, 0.0011) + u_seed) * 0.4;
  float op = max(max(u_ring0.w, u_ring1.w), max(u_ring2.w, u_ring3.w));
  float rr = max(max(u_ring0.y, u_ring1.y), max(u_ring2.y, u_ring3.y));
  float rim = length(ph.xz) / max(rr, 1.0);
  return smoothstep(rr * 0.004, -rr * 0.01, rdd - (n - 0.5) * rr * 0.03)
    * (1.0 - smoothstep(0.75 + 0.2 * n, 1.05, rim)) * op * (0.35 + 0.65 * smoothstep(0.3, 0.7, n));
}
float ringDensity(vec3 ph) {
  return ringDensity(ph, sdfRings(ph));
}
// Ледяная линза (k=0) и второй ярус-колокол (k=1); di_w — плотность,
// взвешенная по оптическому масштабу, для экстинкции и альбедо.
void shellCore(vec4 sh, int k, vec3 psh, vec3 ph, float dsh, out float di, out float diw) {
  di = 0.0;
  diw = 0.0;
  if (sh.w <= 0.0) return;
  if (dsh >= sh.z * 0.4) return;
  float fk = float(k);
  float n = nlf(ph / max(sh.y * 0.5, 1.0) + u_seed + fk * 3.0) * 0.6
    + nbl(ph / max(sh.z * 0.8, 1.0) + fk) * 0.4;
  float dk = smoothstep(sh.z * 0.1, -sh.z * 0.3, dsh - (n - 0.5) * sh.z * 0.5) * sh.w * 0.3;
  if (k == 1) dk *= 1.0 - smoothstep(0.6, 1.0, length(psh.xz) / max(sh.y, 1.0));
  di = dk;
  diw = dk / max(sh.z, 5.0);
}
void shellDensity(vec4 sh, int k, vec3 p, vec3 ph, out float di, out float diw) {
  if (sh.w <= 0.0) { di = 0.0; diw = 0.0; return; }
  vec3 psh = k == 1 ? p : ph;
  float dsh = sdfShell(psh, sh);
  if (k == 1) dsh = abs(dsh + sh.z * 0.25) - sh.z * 0.25;
  shellCore(sh, k, psh, ph, dsh, di, diw);
}
float fireballDensity(vec3 p, out float lqOut, out float blotch) {

  lqOut = 2.0;
  blotch = 0.5;
  if (u_fb.w <= 0.0 || u_fbLook.w <= 0.0) return 0.0;
  vec3 q = (p - u_fb.xyz) / u_fb.w;
  q.y /= u_fbShape.x;
  float lq = length(q);
  if (lq > 1.0 + u_fbLook.z * 1.6 + 0.08) return 0.0;
  vec3 nq = q * u_fbShape.z * 0.18 + vec3(u_seed, u_seed * 0.7, u_age * 0.02);
  vec3 nr = mat3(vec3(0.80, 0.36, -0.48), vec3(-0.60, 0.48, -0.64), vec3(0.0, 0.80, 0.60)) * nq;
  float n1 = nlf(nq);
  float n2 = nbl(nr * 2.3 + 3.1);
  float disp = (n1 - 0.5) * 2.0 * u_fbLook.z + (n2 - 0.5) * u_fbLook.z * 0.5;
  if (u_fbShape.y > 0.0) disp += u_fbShape.y * (nbl(q * 2.2 + u_seed) - 0.5) * 0.10;
  float dd = lq - 1.0 - disp;
  if (u_fbCut > -1e8) dd = max(dd, (u_fbCut - p.y) / max(u_fb.w, 1.0) + (n1 - 0.5) * 0.08);
  lqOut = lq;
  blotch = nlf(nr * 0.9 + 7.7) * 0.6 + n2 * 0.25 + n1 * 0.15;
  return smoothstep(0.05, -0.12, dd);
}

// AgX — тот же тонмаппер, что у источника: Godot рендерит сцену в
// TONE_MAPPER_AGX (agx_white 16, agx_contrast 1.9). Приближение сигмоидой
// по логарифмической шкале — Minimal AgX (iolite-engine), константы Filament.
const mat3 AGX_SRGB_TO_2020 = mat3(
  0.6274, 0.0691, 0.0164,
  0.3293, 0.9195, 0.0880,
  0.0433, 0.0113, 0.8956);
const mat3 AGX_2020_TO_SRGB = mat3(
  1.6605, -0.1246, -0.0182,
  -0.5876, 1.1329, -0.1006,
  -0.0728, -0.0083, 1.1187);
const mat3 AGX_INSET = mat3(
  0.856627153315983, 0.137318972929847, 0.11189821299995,
  0.0951212405381588, 0.761241990602591, 0.0767994186031903,
  0.0482516061458583, 0.101439036467562, 0.811302368396859);
const mat3 AGX_OUTSET = mat3(
  1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
  -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
  -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
const float AGX_MIN_EV = -12.47393;
const float AGX_MAX_EV = 4.026069;

vec3 agxTone(vec3 scene) {
  vec3 c = AGX_SRGB_TO_2020 * max(scene, vec3(0.0));
  c = AGX_INSET * c;
  c = max(c, vec3(1e-10));
  c = clamp(log2(c), AGX_MIN_EV, AGX_MAX_EV);
  c = clamp((c - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV), 0.0, 1.0);
  vec3 x2 = c * c;
  vec3 x4 = x2 * x2;
  c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4
    - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
  // contrast 1.9 против базовых 1.0: кривая AgX приподнята степенью, как в Punchy
  c = pow(clamp(c, 0.0, 1.0), vec3(1.35));
  c = AGX_OUTSET * c;
  c = pow(max(c, vec3(0.0)), vec3(2.2));
  return clamp(AGX_2020_TO_SRGB * c, 0.0, 1.0);
}

vec3 toDisplay(vec3 linear) {
  return mix(linear * 12.92, 1.055 * pow(max(linear, vec3(0.0)), vec3(0.41666)) - 0.055,
    step(vec3(0.0031308), linear));
}

// Вспышка — засветка всего кадра. Отдельная униформа и отдельный вызов на каждом
// выходе из main(): объём к тому моменту уже мог быть отброшен (сфера-ограничитель
// не попала в луч), а свет доходит в любом случае.
vec4 flashVeil(vec4 c) {
  if (u_flash <= 0.0) return c;
  float f = clamp(u_flash, 0.0, 1.0);
  c.rgb = mix(c.rgb, vec3(1.0, 0.98, 0.94), f) + vec3(1.0, 0.94, 0.82) * f * f * 0.55;
  return c;
}

void main() {
  vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
  vec4 outColor = sceneColor;
  if (u_boundR <= 0.0) {
    // u_dbg=6 — карта ОТКАЗОВ: где проход вообще не запускается и почему.
    // МАДЖЕНТА = ограничитель выключен (u_boundR<=0), ОРАНЖЕВЫЙ = луч мимо
    // ограничителя (disc<=0), КРАСНЫЙ = отсечён глубиной сцены, ЗЕЛЁНЫЙ = марш
    // реально прошёл. Без этой карты «пустое небо» неотличимо от «марш
    // ничего не нашёл».
    if (u_dbg > 5.5 && u_dbg < 6.5) { out_FragColor = vec4(1.0, 0.0, 1.0, 1.0); return; }
    out_FragColor = flashVeil(outColor);
    return;
  }
  float depth = czm_readDepth(depthTexture, v_textureCoordinates);
  vec2 ndc = 2.0 * v_textureCoordinates - vec2(1.0);
  vec4 posEC = czm_inverseProjection * vec4(ndc, depth, 1.0);
  posEC = posEC / posEC.w;
  if (depth >= 1.0) posEC.z = -czm_currentFrustum.y;
  float sceneT = length(posEC.xyz);
  // Направление луча — по явному базису камеры, а не по czm_inverseProjection:
  // в пост-процессе этот автоматический униформ раскрывает вертикальный веер
  // примерно втрое шире фрустума, и марш уходит мимо гриба. posEC остаётся
  // только как дистанция до рельефа (она от масштаба осей не зависит).
  vec3 dirW = normalize(u_rayDir + u_rayRight * (ndc.x * u_rayTan.x) + u_rayUp * (ndc.y * u_rayTan.y));
  vec3 rd = w2l(dirW);
  vec3 ro = u_cam;

  // Ударный фронт — рефракция фона (shockwave.gdshader, рисуется ДО объёма,
  // поэтому задевает только непрозрачную сцену). Сжатый слой воздуха с
  // dn = 1.3e-5·Δp отклоняет лучи, скользящие вдоль сферы, и фон смещается
  // наружу в мягкой полосе чуть внутри проекции лимба: x²e^(2−2x) с нулём на
  // самом лимбе. Ни линий, ни дуг: полоса исчезает, когда её толщина меньше
  // пары пикселей, а сдвиг ограничен шестью пикселями.
  if (u_shock.x > 0.0) {
    vec3 cc = vec3(0.0, u_shock.y, 0.0);
    vec3 oc = cc - ro;
    float R = u_shock.x;
    float tc = dot(oc, rd);
    // за камерой фронт уже прошёл (|R| < |oc|) — преломлять нечего
    if (dot(oc, oc) > R * R && tc > 0.0) {
      vec3 pt = ro + rd * tc;
      vec3 perp = pt - cc;
      float b = length(perp);
      float sInside = R - b;
      float d = max(u_shock.w, 0.05);
      float sMax = max(d * 6.0, u_shock2.y > 0.0 ? u_shock2.z * 5.0 : 0.0);
      // Источник считает yl от земли (ground_y = −hob); у нас локальная y уже
      // отсчитана от земли под точкой подрыва, поэтому вычитать высоту взрыва не надо.
      float yl = pt.y;
      float above = smoothstep(0.0, max(d, 1.0), yl);
      float tEntry = tc - sqrt(max(R * R - b * b, 0.0));
      float dPx = d / tc * u_shock3.y;
      if (sInside > 0.0 && sInside <= sMax && above > 0.0 && sceneT > tEntry && dPx > 0.75) {
        float x = sInside / d;
        float prof = x * x * exp(2.0 - 2.0 * x);
        float stem = u_shock2.x > 0.0 ? 1.0 - smoothstep(0.0, u_shock2.x, yl) : 0.0;
        float defl = 1.3e-5 * u_shock.z * sqrt(2.0 * R / d) * prof * u_shock2.w * (1.0 + stem);
        defl *= smoothstep(0.75, 3.0, dPx);
        float par = clamp((sceneT - tc) / max(sceneT, 1.0), 0.0, 1.0);
        float dispPx = min(defl * u_shock3.y * par, u_shock3.x);
        vec3 perpU = perp / max(b, 1e-3);
        vec2 dir = vec2(dot(perpU, w2l(u_rayRight)), dot(perpU, w2l(u_rayUp)));
        dir /= max(length(dir), 1e-6);
        vec2 off = dir * dispPx * u_shock3.zw;
        float aRef = clamp(dispPx * 1.5, 0.0, 1.0);
        // Полоса конденсации: только во влажном воздухе за большим фронтом,
        // всегда рваная пятнами, никогда не геометрическая обводка.
        float ca = 0.0;
        vec3 ccol = vec3(0.0);
        if (u_shock2.y > 0.0) {
          float xc = sInside / max(u_shock2.z, 1.0);
          float band = xc * xc * exp(2.0 - 2.0 * xc);
          band *= smoothstep(0.3, 0.7, nbl(perpU * 0.8 + vec3(xc * 0.12, 0.0, R * 1e-4)));
          ca = u_shock2.y * band * 0.2 * smoothstep(0.5, 2.0, u_shock2.z / tc * u_shock3.y);
          vec3 L = u_sunDir;
          float lit = 0.6 + 0.4 * clamp(dot(perpU, L) * 0.5 + 0.5, 0.0, 1.0);
          ccol = vec3(0.95, 0.96, 1.0) * lit;
        }
        float a = clamp(max(aRef, ca) * above, 0.0, 1.0);
        vec3 bg = texture(colorTexture, clamp(v_textureCoordinates + off, vec2(0.0), vec2(1.0))).rgb;
        outColor.rgb = mix(outColor.rgb, mix(bg, ccol, clamp(ca / max(max(aRef, ca), 1e-4), 0.0, 1.0)), a);
      }
    }
  }

  // Сфера-ограничитель всего облака: вне неё — ни одного шага.
  vec3 oc = ro - u_bound;
  float bq = dot(oc, rd);
  float cq = dot(oc, oc) - u_boundR * u_boundR;
  float disc = bq * bq - cq;
  if (disc <= 0.0) {
    if (u_dbg > 5.5 && u_dbg < 6.5) { out_FragColor = vec4(1.0, 0.5, 0.0, 1.0); return; }
    out_FragColor = flashVeil(outColor);
    return;
  }
  float tEnter = max(-bq - sqrt(disc), 0.0);
  float tExit = min(min(-bq + sqrt(disc), sceneT), tEnter + 1e7);
  if (tExit <= tEnter + 1.0) {
    // u_dbg=5: КРАСНЫЙ = луч отсечён глубиной сцены (sceneT не пустил марш
    // внутрь ограничителя). Без этого канала «пустое небо с шариком» выглядит
    // как «марш ничего не нашёл», хотя марш вообще не запускался.
    if (u_dbg > 4.5 && u_dbg < 5.5) { out_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
    out_FragColor = flashVeil(outColor);
    return;
  }

  float span = tExit - tEnter;
  float minf = 1e9;
  if (u_head.w > 0.0) minf = min(minf, u_headShape.x * 0.6);
  if (u_stem.z > 0.0) minf = min(minf, u_stem.z * 0.8);
  if (u_fb.w > 0.0) minf = min(minf, u_fb.w * 0.5);
  if (u_skirt.x > 0.0) minf = min(minf, u_skirt.y * 1.2);
  // Тончайший конденсационный лист НЕ входит в глобальный шаг: источник
  // уточняет шаг только локально, рядом с листом (см. t += в конце марша).
  // Если положить его в minf, шаг падает вчетверо и бюджет луча обрывается
  // на середине облака — ровно тот «рассыпанный гриб», который мы чинили.
  float thMin = 1e9;
  if (u_ring0.w > 0.0) thMin = min(thMin, max(u_ring0.z, u_ring0.y * 0.012));
  if (u_ring1.w > 0.0) thMin = min(thMin, max(u_ring1.z, u_ring1.y * 0.012));
  if (u_ring2.w > 0.0) thMin = min(thMin, max(u_ring2.z, u_ring2.y * 0.012));
  if (u_ring3.w > 0.0) thMin = min(thMin, max(u_ring3.z, u_ring3.y * 0.012));
  float hint = max(max(min(u_head.w, u_headShape.x * 2.0), u_fb.w), max(u_stem.z * 2.0, u_skirt.y * 2.0));
  // Шаг —uniform по всему лучу, но не крупнее четверти самой тонкой живой
  // структуры (иначе срезы/полосы). Бюджет итераций считается ИЗ шага, а не
  // равен числу шагов: иначе на большом облаке луч обрывается в середине и
  // гриб рассыпается на отдельные шары.
  // u_stepScale — единственный честный рычаг стоимости: он множит сам шаг,
  // а значит и число итераций (span/dt = 876/stepScale). Прежний «бюджет шагов»
  // u_steps ничего не решал: при span/minf = 219 любой бюджет 32..144 давал
  // один и тот же шаг, и адаптация по нему была ложной (замер A/B: кадры
  // совпали побайтово), поэтому uniform убран совсем.
  float stepScale = clamp(u_stepScale, 0.6, 2.5);
  float dt = min(minf * 0.25 * stepScale, span / 8.0);
  dt = max(dt, hint * 0.004);
  float maxIter = min(span / dt, 520.0) + 48.0;
  vec2 fc = gl_FragCoord.xy + vec2(fract(u_age * 7.13) * 5.588);
  float dither = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
  float t = tEnter + dt * dither;

  vec3 L = normalize(u_sunDir + vec3(0.0, 1e-4, 0.0));
  float mu = dot(rd, L);
  float phase = mix(hg(mu, 0.55), hg(mu, -0.2), 0.35) * 12.566;
  phase = mix(1.0, clamp(phase, 0.0, 12.0), 0.8);
  // 3.2 на солнце давали клиппинг: шляпа с 30 км — сплошной белый лист без
  // теней, т.е. без формы. Форма важнее яркости: 1.5 оставляет свету запас
  // и возвращает различие между освещённым краем и внутренней тенью.
  vec3 sunC = vec3(1.0, 0.96, 0.9) * max(u_sunI, 0.05) * 1.5;
  vec3 amb = vec3(0.26, 0.30, 0.38) * max(u_sunI, 0.05);
  vec3 headCol = mix(u_headColA.rgb, u_headColB.rgb, u_headColA.w);
  float shLen = max(min(u_head.w, u_headShape.x * 2.5), max(u_fb.w * 1.5, u_stem.z * 3.0)) + 1.0;
  float margin = hint * 0.4;

  vec3 acc = vec3(0.0);
  float tauHead = 0.0;
  float tauStem = 0.0;
  float tauSkirt = 0.0;
  float tauFb = 0.0;
  float tauOther = 0.0;
  float T = 1.0;
  float firstHit = -1.0;
  for (int i = 0; i < 568; i += 1) {
    if (float(i) > maxIter || t > tExit || T < 0.006) break;
    vec3 p0 = ro + rd * t;
    vec3 driftS = windAt(p0.y, 0.0);
    vec3 driftR = windAt(p0.y, 1.0);
    vec3 p = p0 - driftS;
    vec3 ph = p0 - driftR;
    float sdome = sdfDome(p0);
    float sdH = sdfHead(ph);
    float sdS = sdfStem(p);
    float sdK = sdfSkirt(p);
    float sdR = sdfRings(ph);
    float sdI = sdfShell(ph, u_ice);
    float sd = min(min(min(sdfFireball(ph), sdH), min(sdS, sdK)),
      min(min(sdR, sdI), min(sdfShell(ph, u_ice2), sdome)));
    if (sd > margin) {
      t += max(sd - margin * 0.9, dt);
      t = tEnter + (ceil((t - tEnter) / dt) + dither) * dt;
      continue;
    }
    float cauli;
    float sn;
    float kn;
    float lq;
    float blotch;
    vec3 headBump;
    float dh = headDensity(ph, sdH, cauli, headBump);
    float ds = stemDensity(p, sdS, sn);
    float dk = skirtDensity(p, sdK, kn);
    float df = fireballDensity(ph, lq, blotch);
    float fbo = df * u_fbLook.w;
    float dr = ringDensity(ph, sdR);
    float di0;
    float diw0;
    shellCore(u_ice, 0, ph, ph, sdI, di0, diw0);
    float di1;
    float diw1;
    shellDensity(u_ice2, 1, p, ph, di1, diw1);
    float di = di0 + di1;
    float diw = diw0 + diw1;
    float dd = 0.0;
    float dcrack = 0.0;
    if (sdome < u_dome.x * 0.05) {
      float cn = nlf(p0 / max(u_dome.x * 0.6, 1.0) + u_seed);
      dcrack = u_dome.z * (1.0 - smoothstep(0.0, 0.035, abs(cn - 0.5)));
      dd = smoothstep(u_dome.x * 0.01, -u_dome.x * 0.02,
        sdome - (nlf(p0 / max(u_dome.x * 0.5, 1.0) + u_seed) - 0.5) * u_dome.y * 0.2);
      dd *= smoothstep(1.5 * u_dome.x, 1.1 * u_dome.x, length(p0.xz));
    }
    float total = dh + ds + dk + fbo + dr + di + dd;
    if (total > 0.002) {
      if (firstHit < 0.0) firstHit = t;
      // Экстинкция меряем так, чтобы оптическая толщина СКВОЗЬ голову была
      // 5-7, а сквозь ножку 2-4: при преждешних 22/7 луч насыщался за 1-2 шага,
      // и из всего объёма рисовалась только наружная скорлупа — плоский белый
      // «гвоздь» вместо гриба с освещённой изнутри шапкой.
      float kh = 4.0 / max(min(u_head.w, u_headShape.x * 2.0), 1.0);
      float kst = 3.0 / max(u_stem.z, 1.0);
      float kk = 1.6 / max(u_skirt.y, 1.0);
      float kf = 8.0 / max(u_fb.w, 1.0);
      float kr = 1.0 / 600.0;
      float kd = 4.0 / max(u_dome.y * 0.1, 0.5);
      float wsum = dh * kh + ds * kst + dk * kk + fbo * kf + dr * kr + diw + dd * kd;
      float trans = exp(-wsum * dt);
      tauHead += dh * kh * dt;
      tauStem += ds * kst * dt;
      tauSkirt += dk * kk * dt;
      tauFb += fbo * kf * dt;
      tauOther += (dr * kr + diw + dd * kd) * dt;
      // Альбедо считается ВСЕГДА, под гейтом остаются только тапы. Пропущенный
      // сэмел всё равно множил T: луч прятал сцену и не добавлял цвета, поэтому
      // на тонкой ножке столб рассыпался тёмными крапинками, а в пустом небе
      // оставалось чёрное пятно (dot-probe: 43 пикселя rgb [0,0,0] против неба
      // [51,79,105] вокруг).
      // 0.78+0.32*cauli давало разброс ±16%: на белом куполе это не видно.
      vec3 cHead = headCol * (0.52 + 0.85 * cauli);
      cHead *= 1.0 - 0.45 * clamp(-ph.y / max(u_headShape.x, 1.0), 0.0, 1.0) * u_headColB.w;
      // Ножка — не один тон. У земли это вырванный грунт (коричневый
      // u_stemCol), но выше трети высоты столб уже конденсат и потому светлый,
      // как шляпа: с альбедо грунта 0.30/0.24/0.18 почти против белой шляпы
      // ножка на 350-450 с читалась чёрной полосой, и никаким терминатором
      // это не лечилось (замер: пол 0.12→0.32 двинул яркость кадра на 0.3).
      // Разброс по шуму был 0.8+0.35sn — ±9% при реальном sd шума 0.08:
      // продольные полосы на столбе не читались ни при каком коэффициенте,
      // пока не измерили сами распределение (tmp/noise-spread.mjs). Теперь
      // отсчёт от среднего шума 0.47 и плечо 2.6 → ±21% на одно sd.
      vec3 cStem = mix(u_stemCol.rgb, headCol,
        smoothstep(0.18, 0.75, clamp(p.y / max(u_stem.y, 1.0), 0.0, 1.0)) * 0.72)
        * (1.0 + (sn - 0.47) * 2.6);
      vec3 cSkirt = u_skirtCol.rgb * (0.8 + 0.35 * kn) * 0.65;
      vec3 cFb = mix(vec3(0.30, 0.13, 0.06), vec3(0.10, 0.07, 0.05), clamp(u_fbShape.w, 0.0, 1.0));
      vec3 cDome = (u_domeCol.x >= 0.0 ? u_domeCol.rgb : u_groundCol * vec3(0.62, 0.58, 0.52))
        * (1.0 - 0.6 * dcrack);
      // кольца и ледяные линзы — почти белый рассеиватель, как в источнике
      vec3 albedo = (cHead * dh * kh + cStem * ds * kst + cSkirt * dk * kk + cFb * fbo * kf
        + vec3(0.97) * (dr * kr + diw) + cDome * dd * kd) / max(wsum, 1e-9);
      // Тонкий сэмел затенять нечем, поэтому его честный свет — прямой, но без
      // тапов. 0.85, а не 1.1: вереница тонких слоёв на полном солнце
      // выливалась бы в пересвет, а ноль (прежний пропуск блока) — в чёрные
      // дыры. 0.85 — середина между ними, ближе к незатениённому значению.
      vec3 light = sunC * 0.85 + amb * 0.8;
      vec3 emit = vec3(0.0);
      // Блок тапов стоит дороже самого марша (замер: 120-кратный проход без
      // него стоит столько же, сколько весь проход с ним), поэтому он только
      // там, где сэмел ещё есть чем оплатить. Светящийся огонь (fbo) не
      // трогаем никогда — он и есть картинка в первые секунды.
      bool lit = fbo > 0.0 || T * min(wsum * dt, 1.0) >= 0.002;
      if (lit) {

      // Свет — как в источнике: макроформа по градиенту аналитического SDF,
      // микро тень двумя зашумлёнными тапами к солнцу, протяжённая тень тремя
      // тапами дешёвой плотности; всё это домножается на AgX-тонмаппинг в конце.
      float wh = dh * kh;
      float wst = ds * kst;
      float kmix = (wh * kh + wst * kst) / max(wh + wst, 1e-9);
      float macroH = 1.0;
      float macroS = 1.0;
      if (dh > 0.0 && u_head.w > 0.0) {
        vec3 q = ph - u_head.xyz;
        float e = u_headShape.x * 0.08;
        vec3 nrm = normalize(vec3(
          sdfHeadBase(q + vec3(e, 0.0, 0.0)) - sdfHeadBase(q - vec3(e, 0.0, 0.0)),
          sdfHeadBase(q + vec3(0.0, e, 0.0)) - sdfHeadBase(q - vec3(0.0, e, 0.0)),
          sdfHeadBase(q + vec3(0.0, 0.0, e)) - sdfHeadBase(q - vec3(0.0, 0.0, e))));
        // Нормаль от одного sdfHeadBase — гладкий эллипсоид: рельеф «капусты»
        // светом не трогается, и купол с альбедо 0.85 превращается в белый
        // лист. Возмущаем нормаль тем же шумом, что строит дольки, — рельеф
        // начинает отбрасывать тень на себя, и детализация становится видимой.
        nrm = normalize(nrm + (headBump - 0.5) * 1.4);
        macroH = 0.18 + 0.82 * smoothstep(-0.6, 0.9, dot(nrm, L));
      }
      if (ds > 0.0) {
        vec2 nr = normalize(p.xz + vec2(1e-3));
        float sdn = dot(vec3(nr.x, 0.15, nr.y), L);
        // Терминатор резче, тень настоящая, плюс продольные складки по азимуту
        // от уже посчитанного шума ножки — новых тапов это не стоит. Пол 0.12
        // перегибал: столб из пыли оптически толстый, множественное
        // рассеяние держит теневую сторону примерно на трети солнечной, а при
        // 0.12 ножка на 350-450 с читалась чёрной полосой (замер: средняя
        // яркость кадра 70.7 → 64.2 против прежнего кадра).
        float flute = 0.80 + 0.20 * sin(atan(p.z, p.x) * 6.0 + sn * 4.0);
        macroS = (0.32 + 0.78 * smoothstep(-0.8, 0.55, sdn)) * flute;
      }
      float wother = max(wsum - wh - wst, 0.0);
      float macro = (macroH * wh + macroS * wst + 0.85 * wother) / max(wsum, 1e-9);
      float c2;
      float s2;
      float hl = min(u_head.w, u_headShape.x * 1.5);
      float dhL = dh > 0.0 ? headDensity(ph + L * hl * 0.03, c2, headBump) : 0.0;
      float dhL2 = dh > 0.0 ? headDensity(ph + L * hl * 0.08, c2, headBump) : 0.0;
      float dsL = ds > 0.0 ? stemDensity(p + L * u_stem.z * 0.15, s2) : 0.0;
      float odLocal = (dhL * 0.03 + dhL2 * 0.05) * kh * hl + dsL * kst * u_stem.z * 0.12;
      float micro = mix(1.0, exp(-odLocal * 0.6), 0.65);
      float od = cheapDensity(p + L * shLen * 0.12) * 0.25
        + cheapDensity(p + L * shLen * 0.35) * 0.35
        + cheapDensity(p + L * shLen * 0.80) * 0.40;
      float odFar = od * shLen * (wh + wst > 0.0 ? kmix : kh) * 0.35;
      float farS = exp(-odFar);
      float tSun = macro * micro * farS;
      float sunlit = tSun * mix(1.0, phase, 0.5) * 1.1 + 0.16 * exp(-odFar * 0.45) * (0.35 + 0.65 * macro);
      float odUp = cheapDensity(p + vec3(0.0, shLen * 0.3, 0.0));
      float dhUp = dh > 0.0 ? headDensity(ph + vec3(0.0, hl * 0.12, 0.0), c2, headBump) : 0.0;
      // Пол был 0.35 и почти не трогал картинку: нижняя сторона шляпы и теневая
      // сторона столба оставались освещёнными «изнутри». Небо даёт рассеянный
      // свет, но не имеет права отменять тень совсем.
      float ao = exp(-odUp * 1.7 - dhUp * 2.0) * 0.74 + 0.16;
      light = sunC * sunlit + amb * ao * 0.9;
      float hgt = clamp(p.y / max(shLen * 2.0, 1.0), 0.0, 1.0);
      light += u_groundCol * (sunC * max(L.y, 0.0) * 0.3) * (1.0 - 0.6 * hgt) * (1.0 - ao * 0.4);
      if (u_fb.w > 0.0 && u_fbLook.w > 0.0) {
        float dfb = max(length(ph - u_fb.xyz) - u_fb.w * 0.7, 0.0);
        float fl = bbLum(u_fbLook.x) * u_fbLook.y * u_fbLook.w;
        // листы освещены шаром, но в камеру рассеивают его не целиком:
        // mix(0.25, 0.4) по доле листов в этом пикселе (иначе воротник светится неоном)
        float ringK = (dr * kr + diw) / max(wsum, 1e-9);
        light += blackbody(u_fbLook.x) * fl * mix(0.25, 0.4, ringK)
          * (u_fb.w * u_fb.w) / (dfb * dfb + u_fb.w * u_fb.w) * (1.0 - fbo);
      }

      if (fbo > 0.0) {
        float cellLo = u_fbLook.x < 3500.0 ? 0.92 : 0.86;
        float cellHi = u_fbLook.x < 3500.0 ? 1.05 : 1.08;
        float tloc = u_fbLook.x * mix(cellLo, cellHi, smoothstep(0.15, 0.85, blotch))
          * mix(1.08, 0.86, smoothstep(0.4, 1.0, lq));
        vec3 bc = blackbody(tloc);
        bc = mix(bc, pow(bc, vec3(1.7)), 0.2);
        bc += u_fbTint.rgb * u_fbTint.w * 0.6;
        float lum = bbLum(tloc) * u_fbLook.y;
        lum /= 1.0 + lum * u_exposure / 6.0;
        lum *= 1.0 + u_fbShape.y * (0.7 * smoothstep(0.8, 1.0, lq) - 0.25);
        lum *= 1.0 - clamp(u_fbShape.w, 0.0, 1.0) * smoothstep(0.35, 0.7, blotch) * 0.85;
        emit += bc * lum * (fbo * kf) / max(wsum, 1e-9);
      }
      if (dh > 0.0 && u_headHeat.y > 0.0) {
        vec3 qh = ph - u_head.xyz;
        float rxz = length(qh.xz);
        vec2 rc = vec2(rxz - u_head.w * 0.62, qh.y + u_headShape.x * 0.25);
        float dc = length(rc) / max(u_headShape.x * u_headHeat.z, 1.0);
        float glow = exp(-dc * dc * 1.6) * (0.55 + 0.45 * smoothstep(0.2, 0.8, cauli));
        float tloc = mix(850.0, u_headHeat.x, glow);
        emit += blackbody(tloc) * bbLum(tloc) * u_headHeat.y * glow * (dh * kh) / max(wsum, 1e-9);
      }
      // трещины в куполе грунта светятся расплавом ровно столько, сколько жив
      // сам купол (dome_u.z — доля подъёма после прорыва газа).
      if (dd > 0.0 && dcrack > 0.0 && u_fbLook.w > 0.0) {
        emit += blackbody(1500.0) * bbLum(1500.0) * u_fbLook.y * dcrack * (dd * kd) / max(wsum, 1e-9);
      }
      }
      acc += T * (albedo * light + emit) * (1.0 - trans);
      T *= trans;
    }
    // у тонких конденсационных листов шаг удваиваем: иначе лист из 1-2 сэмплов
    // мигает и превращается в полосы.
    t += (thMin < 1e8 && sdR < 2.0 * thMin) ? min(dt, thMin * 0.5) : dt;
  }
  // u_life — гашение по стенам, а не по модельным секундам: облако живёт минутами,
  // показ мы обрываем десятками секунд, и обрыв обязан быть растворением, а не щелчком.
  float alpha = clamp((1.0 - T) * u_life, 0.0, 1.0);
  // Диагностика марша: что луч действительно находит в объёме. В игре u_dbg=0.
  //  1 = итоговое покрытие (alpha), 2 = оптические толщины head/stem/skirt,
  //  3 = оставшаяся прозрачность T, 4 = огонь/прочие слои + где луч впервые зацепил.
  if (u_dbg > 0.5) {
    if (u_dbg < 1.5) { out_FragColor = vec4(vec3(alpha), 1.0); return; }
    if (u_dbg < 2.5) {
      out_FragColor = vec4(1.0 - exp(-tauHead), 1.0 - exp(-tauStem), 1.0 - exp(-tauSkirt), 1.0);
      return;
    }
    if (u_dbg < 3.5) { out_FragColor = vec4(vec3(T), 1.0); return; }
    // u_dbg=5 для пикселей, где марш всё-таки запустился: R/G = log(sceneT)
    // (красный = ближняя геометрия съедает луч, зелёный = небо далеко),
    // B = доля tEnter в tExit (камера внутри ограничителя даёт ноль).
    if (u_dbg > 4.5 && u_dbg < 5.5) {
      float lg = clamp(log(max(sceneT, 1.0)) / log(10.0) / 5.0, 0.0, 1.0);
      out_FragColor = vec4(1.0 - lg, lg, clamp(tEnter / max(tExit, 1.0), 0.0, 1.0), 1.0);
      return;
    }
    if (u_dbg > 5.5 && u_dbg < 6.5) {
      // ЗЕЛЁНЫЙ = марш прошёл хотя бы один шаг; СИНИЙ = tEnter >= 1 м, то есть
      // луч вошёл в ограничитель снаружи (камера ВНЕ его); КРАСНЫЙ = что-то
      // всё-таки накрыло (alpha>0.01).
      out_FragColor = vec4(step(0.01, alpha), 1.0, step(1.0, tEnter), 1.0);
      return;
    }
    out_FragColor = vec4(1.0 - exp(-tauFb), 1.0 - exp(-tauOther),
      firstHit > 0.0 ? clamp(firstHit / max(tExit, 1.0), 0.0, 1.0) : 1.0, 1.0);
    return;
  }
  if (alpha < 0.004) {
    out_FragColor = flashVeil(outColor);
    return;
  }
  float th = firstHit > 0.0 ? firstHit : (tEnter + tExit) * 0.5;
  // Дымка: чем дальше облако, тем сильнее оно тонет в голубизне атмосферы.
  // Туман и экспозиция считаются в линейном свете — тонмаппер поверх них.
  float fog = clamp(1.0 - exp(-pow(max(th - 20000.0, 0.0) / 180000.0, 1.3)), 0.0, 0.7);
  vec3 sceneLin = acc * u_exposure;
  sceneLin = mix(sceneLin, vec3(0.42, 0.50, 0.60) * max(u_sunI, 0.3) * u_exposure, fog);
  outColor.rgb = mix(outColor.rgb, toDisplay(agxTone(sceneLin)), alpha);
  out_FragColor = flashVeil(outColor);
}
`;

// Лестница: (потолок полной цены прохода в мс, размер растера, множитель
// шага). Полная цена — цена при растере 1.0 и шаге 1.0; стоимость
// масштабируется как px² (пикселей) и 1/stepScale (числа итераций), поэтому
// нормировка именно такая. Пороги — бюджет на сам марш, а не на кадр: сцена
// без объёма имеет свою цену, и наказывать объём за глобус незачем. Замер
// этой машины (960×540, без GPU): полный проход стоит 31,5 и 49,5 с на кадр,
// растер 0,3 при шаге 2,5 — 3,6-5,3 с; на видеокарте те же проходы укладываются
// в миллисекунды и лестница остаётся на верхней ступени.
const RUNGS = [
  [400, 0.3, 2.5],
  [150, 0.4, 2.2],
  [60, 0.55, 1.8],
  [20, 0.75, 1.4],
  [8, 1, 1],
];
// Оценка ПОЛНОЙ цены прохода, накопленная между взрывами. Нужна потому, что
// растер можно выбрать только при создании прохода: запись stage._textureScale
// позже цену кадра не меняет (замер 15.11: tex=1, выставленный адаптацией,
// дал кадр 7,8 с, а tex=1, заданный при создании, — 31,5 и 49,5 с).
let fullMsPrior = 0;
// Ступень по накопленной цене: берём самую качественную, чей прогноз влезает в
// её же бюджет. Приор неизвестен (первый взрыв сессии) — средняя ступень.
const rungForFullMs = (fullMs) => {
  if (!(fullMs > 0)) return 1;
  for (let r = RUNGS.length - 1; r >= 0; r -= 1) {
    if (fullMs * RUNGS[r][1] * RUNGS[r][1] / RUNGS[r][2] <= RUNGS[r][0]) return r;
  }
  return 0;
};

/**
 * Ставит объёмный взрыв в сцену и ведёт его по часам.
 * @returns {{destroy: () => void, isDestroyed: () => boolean, state: () => object}}
 */
export function createNuclearVolumetrics({
  scene, at, profile = {}, zones = {}, yieldKt = 1000, startedAt = 0,
  timeScale = null, lifeSeconds = null, onDone = () => {},
} = {}) {
  if (!scene?.postProcessStages || typeof Cesium.PostProcessStage !== 'function') {
    return { destroy: () => {}, isDestroyed: () => true, state: () => null, shown: () => false };
  }
  // Начало координат — ЗЕМЛЯ под целью, а не точка взрыва. Форма уже считает
  // высоту внутри себя: ключи облака идут от burstHeight (строка 169), а
  // горизонтальный радиус фронта — из сечения сферы радиуса slant центром на
  // высоте burstHeight (строка 242), то есть y=0 у неё пол. Поднимать ещё и
  // начало координат — двойной счёт: на кадрах 15.11 гриб стоял на 1550 м
  // выше выжженного города, и разрыв читался как «взрыв не над городом».
  const origin = Cesium.Cartesian3.fromDegrees(at.lon, at.lat, 0);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin, Cesium.Ellipsoid.WGS84, new Cesium.Matrix4());
  const inv = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4());
  // Столбцы матрицы ENU — это базис восток/север/верх в ECEF; через них
  // шейдер переводит мировые координаты в локальные метры гриба.
  const col4 = new Cesium.Cartesian4();
  const axis = (col) => {
    Cesium.Matrix4.getColumn(enu, col, col4);
    return new Cesium.Cartesian3(col4.x, col4.y, col4.z);
  };
  const east = axis(0);
  const north = axis(1);
  const up = axis(2);
  // Свет гриба — «съёмочный» солнце-прожектор, а не астрономический: сцена
  // игры рисуется при выключенном освещении глобуса, то есть земля всегда
  // дневная, а настоящее солнце в 02:00 UTC над Лондоном стоит под горизонтом.
  // (восток, вверх, север), возвышение 28°, азимут 130° от севера.
  // 45°/40° давали шапку-молочко: съёмочный глаз стоит северо-восточнее цели и
  // смотрит на юго-запад, то есть свет пришёл почти из-за камеры, и купол
  // засвечивался ровно. Замер 15.11 (sun1, 40 с, один кадр на четыре ракурса):
  // низкое солнце сбоку поднимает фактуру купола 0.0816 → 0.0862 и оставляет
  // правый борт в тени — шар перестаёт быть блином.
  const STUDY_SUN = [0.676, 0.470, -0.568];
  // Степень сжатия времени подбираем по окну формирования шляпы: за полчаса
  // реальных секунд зритель обязан успеть увидеть и шар, и вставший гриб.
  const timing = blastShapeAt(profile, zones, yieldKt, 0).timing;
  // Якорь — полностью оформившееся облако. Прошлая формула (окно шляпы на 30
  // реальных секунд) обрывала показ на 0.29–0.53 от tFull, и ни один гриб не
  // доходил до задокументированного купола: у «Малыша» шляпа так и оставалась
  // леденцом. Теперь tFull наступает за FULL_WINDOW реальных секунд, а старт
  // подъёма шляпы не сжимается ниже HEAD1_MIN_SECONDS.
  const FULL_WINDOW = 150;
  const HEAD1_MIN_SECONDS = 3;
  const rate = Number.isFinite(timeScale)
    ? timeScale
    : clamp(Math.max(timing.tFull / FULL_WINDOW, timing.tHead1 / HEAD1_MIN_SECONDS), 1, 8);
  // Последние секунды показа облако растворяется, а не исчезает щелчком.
  const FADE_SECONDS = 6;
  const life = Number.isFinite(lifeSeconds)
    ? lifeSeconds
    : clamp(timing.tFull / rate, 40, 200);

  const uniforms = {
    // Локальная система шейдера — (восток, вверх, север): все SDF источника
    // считают вертикалью вторую координату. Перестановка осей сохраняет длины
    // и скалярные произведения, поэтому сфера-ограничитель и свет не ломаются.
    u_ax0: east, u_ax1: up, u_ax2: north,
    u_cam: new Cesium.Cartesian3(),
    u_rayDir: new Cesium.Cartesian3(0, 0, -1),
    u_rayUp: new Cesium.Cartesian3(0, 1, 0),
    u_rayRight: new Cesium.Cartesian3(1, 0, 0),
    u_rayTan: new Cesium.Cartesian2(1, 1),
    u_bound: new Cesium.Cartesian3(),
    u_boundR: 0,
    u_seed: Math.random() * 100,
    u_age: 0,
    u_exposure: 1,
    u_fb: new Cesium.Cartesian4(), u_fbLook: new Cesium.Cartesian4(),
    u_fbShape: new Cesium.Cartesian4(), u_fbTint: new Cesium.Cartesian4(), u_fbCut: -1e9,
    u_head: new Cesium.Cartesian4(), u_headShape: new Cesium.Cartesian4(),
    u_headColA: new Cesium.Cartesian4(), u_headColB: new Cesium.Cartesian4(),
    u_headHeat: new Cesium.Cartesian4(), u_headDetail: new Cesium.Cartesian4(), u_lobes: 0,
    u_headRamp: 1,
    u_stem: new Cesium.Cartesian4(), u_stemShape: new Cesium.Cartesian4(), u_stemCol: new Cesium.Cartesian4(),
    u_stemWobble: 0, u_stemTwist: 0, u_stemTopFlare: 0,
    u_skirt: new Cesium.Cartesian4(), u_skirtCol: new Cesium.Cartesian4(), u_skirtFront: 0,
    u_ring0: new Cesium.Cartesian4(), u_ring1: new Cesium.Cartesian4(),
    u_ring2: new Cesium.Cartesian4(), u_ring3: new Cesium.Cartesian4(),
    u_ice: new Cesium.Cartesian4(), u_ice2: new Cesium.Cartesian4(),
    u_dome: new Cesium.Cartesian4(), u_domeCol: new Cesium.Cartesian4(-1, -1, -1, 0),
    u_wind: new Cesium.Cartesian3(), u_windH: 1000, u_churn: 0.05,
    u_groundCol: new Cesium.Cartesian3(0.36, 0.33, 0.29),
    u_sunI: 1,
    u_sunDir: new Cesium.Cartesian3(STUDY_SUN[0], STUDY_SUN[1], STUDY_SUN[2]),
    u_flash: 0,
    u_life: 1,
    u_dbg: 0,
    u_stepScale: 1,
    u_shock: new Cesium.Cartesian4(),
    u_shock2: new Cesium.Cartesian4(),
    u_shock3: new Cesium.Cartesian4(6, 1000, 1 / 1280, 1 / 720),
  };
  const ringUniforms = [uniforms.u_ring0, uniforms.u_ring1, uniforms.u_ring2, uniforms.u_ring3];
  const scratchLocal = new Cesium.Cartesian3();
  const scratchSun = new Cesium.Cartesian3();
  const scratchIcrf = new Cesium.Matrix3();
  const scratchTo = new Cesium.Cartesian3();

  /** Доля солнечного света: 0 ночью, 1 при высоком солнце. */
  const sunFactor = (time) => {
    try {
      const t = time ?? scene.clock.currentTime;
      const icrf = Cesium.Transforms.computeIcrfToFixedMatrix(t, scratchIcrf);
      const sun = Cesium.Simon1994PlanetaryPositions?.computeSunPositionInEarthInertialFrame?.(t, scratchSun)
        ?? (scene.light?.position ? Cesium.Cartesian3.clone(scene.light.position, scratchSun) : null);
      if (!icrf || !sun) return 1;
      Cesium.Matrix3.multiplyByVector(icrf, sun, sun);
      const elevation = Cesium.Cartesian3.dot(Cesium.Cartesian3.normalize(sun, scratchSun), up);
      return smoothstep(-0.06, 0.22, elevation);
    } catch {
      return 1;
    }
  };
  let stage = null;
  let removed = false;
  let lastState = null;

  // Растер выбирается один раз — здесь, по накопленной цене прохода. Шаг
  // (u_stepScale) остаётся живым рычагом на весь показ, растер после создания
  // поменять нельзя: запись stage._textureScale цену кадра не меняет (замер
  // 15.11), а пересоздавать проход посреди показа незачем — цена кадра внутри
  // одного взрыва от растера уже не зависит.
  const startRung = rungForFullMs(fullMsPrior);
  const rasterPx = RUNGS[startRung][1];
  try {
    stage = scene.postProcessStages.add(new Cesium.PostProcessStage({
      name: `kupol-blast-${Math.floor(uniforms.u_seed * 1000)}`,
      fragmentShader: FS,
      uniforms,
      textureScale: rasterPx,
    }));
  } catch (error) {
    console.warn('[Купол] объёмный взрыв недоступен:', error);
    stage = null;
    return { destroy: () => {}, isDestroyed: () => true, state: () => null, shown: () => false };
  }

  const destroy = () => {
    if (removed) return;
    removed = true;
    try {
      if (stage && !stage.isDestroyed()) scene.postProcessStages.remove(stage);
    } catch { /* сцена уже удалена вместе со сценой */ }
    stage = null;
  };

  // preRender поднимается как (scene, time): брать первый аргумент за время —
  // значит передать Scene в sunFactor и получить NaN в u_sunI и всей экспозиции.
  let prevFrameMs = 0;
  // Цена прохода = пиксели растера² × число шагов. Мерим её ОТДЕЛЬНО от
  // рельефа: интервал кадров, где проход исполнялся, минус интервал кадров,
  // где его не было. По-старому «адаптация» смотрела на полный кадр и
  // наказывала объём за карту: на этой машине без GPU подложка стоит 4-8 с,
  // а марш — 40, и сваливать их в одну цифру нельзя.
  let idleMs = 0;
  let blastMs = 0;
  let blastSamples = 0;
  let stepScale = RUNGS[startRung][2];
  uniforms.u_stepScale = stepScale;
  let adaptFrames = 99;
  let lastAdaptAt = 0;
  // Ступень выбирается с гистерезисом: вниз (ухудшать) — как только полная
  // цена перескочила потолок ступени, вверх (улучшать) — только когда она
  // упала ниже половины этого потолка. Без зазора лестница ходила бы туда-
  // сюда на шуме замеров, а прыжок шага виден как дыхание облака.
  let rung = startRung;
  const adaptQuality = (uniforms, nowMs) => {
    if (blastSamples < 2 || idleMs <= 0) return;
    adaptFrames += 1;
    // Дебаунс по времени, а не по числу кадров: 30 кадров на медленной машине
    // — это минуты, за которые показ заканчивается, и лестница не успевала
    // упасть ни разу (замер: кадр 25-28 с при показе в 150 с).
    if (adaptFrames < 2 || nowMs - lastAdaptAt < 1200) return;
    adaptFrames = 0;
    lastAdaptAt = nowMs;
    const costMs = blastMs - idleMs;
    if (costMs <= 0) return;
    // Нормировка по ФАКТИЧЕСКОМУ растрёу этого прохода: растер за время показа
    // не двигается, поэтому ступень здесь меняет только шаг, а растер
    // перевыберется на следующем взрыве — по этому же полному ценнику.
    const fullMs = costMs * stepScale / Math.max(1e-6, rasterPx * rasterPx);
    fullMsPrior = fullMsPrior > 0 ? fullMsPrior * 0.6 + fullMs * 0.4 : fullMs;
    while (rung > 0 && fullMs > RUNGS[rung][0]) rung -= 1;
    while (rung < RUNGS.length - 1 && fullMs < RUNGS[rung + 1][0] * 0.4) rung += 1;
    if (Math.abs(RUNGS[rung][2] - stepScale) > 0.01) {
      stepScale = RUNGS[rung][2];
      uniforms.u_stepScale = stepScale;
    }
  };

  const update = () => {
    if (removed || !stage) return;
    // Пишем ЧЕРЕЗ stage.uniforms, а не в наш объект. Cesium при первом
    // исполнении перекладывает униформы в stage._actualUniforms и обновляет их
    // дальше только сеттером акцессора (getUniformValueGetterAndSetter), а
    // uniformMap для растера читает именно _actualUniforms. Запись в наш
    // исходный объект меняет его, но не GPU, поэтому скаляры замирали на
    // значениях первого кадра: замеренные u_boundR = 370 м вместо 9675 и
    // u_age = 0.71 вместо 450 — марш отсекался шариком новорождённого огня,
    // а снос ветром и вовсе не двигался. Cartesian3/4 живут по ссылке, им это
    // не мешало, поэтому форма гриба менялась, а всё остальное — нет.
    const uniforms = stage.uniforms;
    // Системные часы не зависят от управляемого в тестах игрового таймера.
    const nowMs = Date.now();
    // Первый вызов — синхронный, из createNuclearVolumetrics, ещё до какого
    // либо кадра: prevFrameMs нулевой именно на нём.
    const beforeFirstFrame = prevFrameMs === 0;
    // stage.enabled на входе — то, с чем проход реально отрисовался в ПРОШЛОМ
    // кадре: ниже update() переставляет его заново.
    const wasShown = stage.enabled;
    if (prevFrameMs) {
      // Потолок 180 с: на программном растере честный марш даёт и 80-секундные
      // кадры, а срез на 60 с занижал бы цену ровно там, где она важнее всего.
      const dtMs = clamp(nowMs - prevFrameMs, 0, 180000);
      if (wasShown) {
        blastMs = blastMs ? blastMs * 0.75 + dtMs * 0.25 : dtMs;
        blastSamples += 1;
      } else {
        idleMs = idleMs ? idleMs * 0.75 + dtMs * 0.25 : dtMs;
      }
    }
    prevFrameMs = nowMs;
    const ageReal = Math.max(0, (performance.now() - startedAt) / 1000);
    if (ageReal > life) {
      destroy();
      onDone();
      return;
    }
    const s = ageReal * rate;
    const st = blastShapeAt(profile, zones, yieldKt, s);
    lastState = st;
    if (!st.alive) {
      destroy();
      onDone();
      return;
    }
    const camera = scene.camera;
    Cesium.Matrix4.multiplyByPoint(inv, camera.positionWC, scratchLocal);
    // scratchLocal — ENU (восток, север, верх); шейдеру подаём (восток, верх, север)
    uniforms.u_cam.x = scratchLocal.x;
    uniforms.u_cam.y = scratchLocal.z;
    uniforms.u_cam.z = scratchLocal.y;
    // Луч считаем из самой камеры: czm_inverseProjection внутри пост-процесса
    // разворачивает вертикальный веер примерно втрое шире фрустума, и объём
    // начинает жить не в тех пикселях, где его видит наблюдатель.
    const frustum = camera.frustum;
    const tanY = Math.tan(((frustum.fovy ?? 0.6) + 1e-6) / 2);
    const aspect = frustum.aspectRatio || (scene.canvas.width / Math.max(scene.canvas.height, 1)) || 1;
    Cesium.Cartesian3.clone(camera.directionWC, uniforms.u_rayDir);
    Cesium.Cartesian3.clone(camera.upWC, uniforms.u_rayUp);
    Cesium.Cartesian3.clone(camera.rightWC, uniforms.u_rayRight);
    uniforms.u_rayTan.x = tanY * aspect;
    uniforms.u_rayTan.y = tanY;
    // Ограничивающая сфера — тоже в локальных метрах, её центр на оси взрыва.
    // Радиус отдаём позже, вместе с оценкой крупности: если облако закрывает
    // меньше пикселя, марш не нужен вовсе, а вспышка обязана остаться.
    uniforms.u_bound.x = 0;
    uniforms.u_bound.y = st.bound.y;
    uniforms.u_bound.z = 0;

    const fb = st.fireball;
    uniforms.u_fb.x = 0; uniforms.u_fb.y = fb.y; uniforms.u_fb.z = 0; uniforms.u_fb.w = fb.opacity > 0.002 ? fb.r : 0;
    uniforms.u_fbLook.x = fb.temp; uniforms.u_fbLook.y = fb.emission; uniforms.u_fbLook.z = fb.noise; uniforms.u_fbLook.w = fb.opacity;
    uniforms.u_fbShape.x = fb.squash; uniforms.u_fbShape.y = fb.mottle; uniforms.u_fbShape.z = fb.noiseScale; uniforms.u_fbShape.w = fb.skin;
    uniforms.u_fbTint.x = fb.tint[0]; uniforms.u_fbTint.y = fb.tint[1]; uniforms.u_fbTint.z = fb.tint[2]; uniforms.u_fbTint.w = fb.tintStrength;
    uniforms.u_fbCut = fb.cut;

    const hd = st.head;
    uniforms.u_head.x = 0; uniforms.u_head.y = hd.y; uniforms.u_head.z = 0; uniforms.u_head.w = hd.density > 0.002 ? hd.r : 0;
    uniforms.u_headShape.x = hd.halfH; uniforms.u_headShape.y = hd.torus; uniforms.u_headShape.z = hd.density; uniforms.u_headShape.w = hd.roll;
    uniforms.u_headColA.x = hd.colA[0]; uniforms.u_headColA.y = hd.colA[1]; uniforms.u_headColA.z = hd.colA[2]; uniforms.u_headColA.w = hd.colMix;
    uniforms.u_headColB.x = hd.colB[0]; uniforms.u_headColB.y = hd.colB[1]; uniforms.u_headColB.z = hd.colB[2]; uniforms.u_headColB.w = hd.darkBase;
    uniforms.u_headHeat.x = hd.heatK; uniforms.u_headHeat.y = hd.heatGlow; uniforms.u_headHeat.z = hd.heatRadius; uniforms.u_headHeat.w = hd.cellRel;
    uniforms.u_headDetail.x = hd.noiseAmp; uniforms.u_headDetail.y = hd.billow; uniforms.u_headDetail.z = hd.erosion; uniforms.u_headDetail.w = hd.lobeGain;
    uniforms.u_headRamp = hd.rampK;
    uniforms.u_lobes = hd.lobes;

    const sm = st.stem;
    uniforms.u_stem.x = sm.y0; uniforms.u_stem.y = sm.y1; uniforms.u_stem.z = sm.density > 0.002 ? sm.r : 0; uniforms.u_stem.w = sm.density;
    uniforms.u_stemShape.x = sm.flare; uniforms.u_stemShape.y = sm.waist; uniforms.u_stemShape.z = sm.hollow; uniforms.u_stemShape.w = sm.rise;
    uniforms.u_stemCol.x = sm.col[0]; uniforms.u_stemCol.y = sm.col[1]; uniforms.u_stemCol.z = sm.col[2]; uniforms.u_stemCol.w = sm.stretch;
    uniforms.u_stemWobble = sm.wobble; uniforms.u_stemTwist = sm.twist; uniforms.u_stemTopFlare = sm.topFlare;

    const sk = st.skirt;
    uniforms.u_skirt.x = sk.r; uniforms.u_skirt.y = sk.h; uniforms.u_skirt.z = sk.density; uniforms.u_skirt.w = sk.inner;
    uniforms.u_skirtCol.x = sk.col[0]; uniforms.u_skirtCol.y = sk.col[1]; uniforms.u_skirtCol.z = sk.col[2]; uniforms.u_skirtCol.w = 0;
    uniforms.u_skirtFront = sk.front;

    // Тонкие слои: четыре конденсационных воротника, ледяная линза, второй ярус
    // и купол грунта. set() на vec4 uniform не вызываем — Cesium читает поля.
    for (let i = 0; i < 4; i += 1) {
      const rg = st.rings[i] || [0, 0, 0, 0];
      const u = ringUniforms[i];
      u.x = rg[0]; u.y = rg[1]; u.z = rg[2]; u.w = rg[3];
    }
    setVec4(uniforms.u_ice, st.ice);
    setVec4(uniforms.u_ice2, st.ice2);
    setVec4(uniforms.u_dome, st.dome);
    uniforms.u_domeCol.x = st.domeCol[0];
    uniforms.u_domeCol.y = st.domeCol[1];
    uniforms.u_domeCol.z = st.domeCol[2];

    uniforms.u_wind.x = st.wind[0]; uniforms.u_wind.y = 0; uniforms.u_wind.z = st.wind[1];
    uniforms.u_windH = st.windH;
    uniforms.u_churn = st.churn;
    uniforms.u_groundCol.x = st.groundCol[0]; uniforms.u_groundCol.y = st.groundCol[1]; uniforms.u_groundCol.z = st.groundCol[2];
    // Фронт: (радиус, высота центра, Δp на фронте, толщина слоя) + (Mach-стебель,
    // конденсация, её ширина, амплитуда) + (предел сдвига в пикселях, пикселей на
    // радиан, 1/ширина, 1/высота кадра).
    uniforms.u_shock.x = st.shock.r; uniforms.u_shock.y = st.shock.y;
    uniforms.u_shock.z = st.shock.psi; uniforms.u_shock.w = st.shock.thick;
    uniforms.u_shock2.x = st.shock.stem; uniforms.u_shock2.y = st.shock.cond;
    uniforms.u_shock2.z = st.shock.condW; uniforms.u_shock2.w = st.shock.amp;
    uniforms.u_shock3.x = SHOCK_MAX_PX;
    uniforms.u_shock3.y = 0.5 * scene.canvas.height / Math.max(tanY, 1e-6);
    uniforms.u_shock3.z = 1 / Math.max(scene.canvas.width, 1);
    uniforms.u_shock3.w = 1 / Math.max(scene.canvas.height, 1);
    uniforms.u_age = s;

    // Вспышка — на реальных часах, не на сжатом модельном времени: на плёнках
    // испытаний кадр белает ровно на миг, а уже потом проступает шар.
    const ft = Math.max(0, ageReal - 0.01);
    uniforms.u_flash = ft > 2.4 ? 0 : 1.3 * (1 - Math.exp(-ft / 0.035)) * Math.exp(-ft / 0.32);
    uniforms.u_life = 1 - smoothstep(life - FADE_SECONDS, life - 0.05, ageReal);

    // Шаг и сам проход соразмерны тому, насколько крупно облако занимает экран:
    // из космоса marched-объём стоит дороже, чем выглядит.
    const dist = Cesium.Cartesian3.distance(camera.positionWC, origin);
    const cover = clamp(dist > 1 ? st.bound.r / dist : 1, 0, 1);
    uniforms.u_boundR = cover > 0.0009 ? st.bound.r : 0;
    // Рычаги качества — размер растера и множитель шага, оба по ЗАМЕРЕННОЙ
    // цене прохода (adaptQuality). Бюджет шагов u_steps удалён: min(span/u_steps,
    // minf*0.25) всегда выигрывал по второй причине, поэтому 32..144 ничего
    // не меняли (замер A/B: кадры совпали побайтово).
    adaptQuality(uniforms, nowMs);
    Cesium.Cartesian3.subtract(origin, camera.positionWC, scratchTo);
    const angle = Math.acos(clamp(
      Cesium.Cartesian3.dot(Cesium.Cartesian3.normalize(scratchTo, scratchTo), camera.directionWC),
      -1, 1,
    ));
    const fov = camera.frustum.fovy ?? Cesium.Math.toRadians(60);
    const half = fov * (camera.frustum.aspectRatio ? 0.5 * Math.max(1, camera.frustum.aspectRatio) : 0.8);
    // Экспозиция кадра считается по шару, как в источнике: ослепительная фаза
    // зажимает камеру, и только после её остывания проступает подсвеченный гриб.
    // Глобус игры рисуется при выключенном освещении: земля всегда «дневная»,
    // и в 02:00 UTC над Лондоном снимок яркий. Значит и облако обязано получать
    // столько же света, сколько видит глаз, а не астрономическую высоту солнца,
    // иначе гриб становится чёрным силуэтом на освещённом фоне.
    const day = scene.globe.enableLighting ? sunFactor(scene.clock.currentTime) : 1;
    uniforms.u_sunI = day;
    // Направление света — STUDY_SUN, а не астрономическое солнце. Движок
    // Cesium 1.138 не отдаёт позицию солнца наружу: у scene.sun есть только
    // show и glowFactor, настоящий вектор живёт в UniformState и доступен
    // шейдеру как czm_sunDirectionWC. Пользы от него в этой сцене нет:
    // земля рисуется при выключенном освещении и всегда «дневная», а солнце
    // в 02:00 UTC над Лондоном стоит под горизонтом — гриб получал свет снизу
    // и нижняя сторона шляпы оказывалась ярче верхней. Фиксированное направление
    // с высотой ~45° согласовано с картинкой-снимком в любое время суток.
    uniforms.u_sunDir.x = STUDY_SUN[0];
    uniforms.u_sunDir.y = STUDY_SUN[1];
    uniforms.u_sunDir.z = STUDY_SUN[2];
    uniforms.u_exposure = meterExposure({
      yieldKt, seconds: s, fireballRadius: fb.r, fireballOpacity: fb.opacity,
      fireballTemp: fb.temp, emission: fb.emission, distanceM: dist,
      halfFovRad: half, sunFactor: day,
      whiteoutSeconds: num(profile.profile?.whiteout_s, 0),
    });
    const reaches = dist < st.bound.r * 1.4;
    const onScreen = cover > 0.0009 && (reaches || angle - Math.asin(clamp(st.bound.r / Math.max(dist, 1), 0, 1)) < half);
    // Рычаг — enabled, а не show. Cesium фильтрует активные стадии по
    // stage.enabled && stage._isSupported (PostProcessStageCollection), а
    // PostProcessStage.execute проверяет только _enabled: слова show в модуле
    // одиночной стадии нет вообще. До this марш выполнялся каждый кадр
    // взрыва, даже когда гриб был за спиной камеры, — «выключение» лишь
    // казалось выключением.
    // Первый кадр показа марш не исполняется: только так получается честный
    // интервал «кадр без объёма», из которого родится idleMs. Без него
    // адаптация не запускалась ни разу, пока гриб в кадре (замер 15.11:
    // 57-61 с на кадр, показ в 150 с = два кадра, гриба на снимках нет).
    // Потеря одного кадра почти ничего: вспышка на ageReal = 0 равна нулю.
    stage.enabled = beforeFirstFrame ? false : (onScreen || uniforms.u_flash > 0.002);
  };

  const removeListener = scene.preRender.addEventListener(update);
  update();

  return {
    destroy: () => {
      if (typeof removeListener === 'function') removeListener();
      destroy();
    },
    isDestroyed: () => removed,
    // Жив ли объёмный проход. Знакам карты (nuclearEffects.js) довольно и этого:
    // они уступают маршу в тот же миг, как он создан. По stage.enabled судить
    // нельзя — update() вызывается сразу при создании и на первом проходе
    // оставляет enabled=false (кадр без марша нужен адаптации), то есть в момент
    // решения знаков марш всегда выглядел бы «не рисующим».
    shown: () => !removed && !!stage,
    state: () => lastState,
    durationSeconds: life,
    timeScale: rate,
  };
}
