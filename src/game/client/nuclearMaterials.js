// Объёмные материалы для ядерного взрыва в Cesium — перенос look'а из исходного
// Godot-проекта (shaders/explosion_volume.gdshader, dust_wall.gdshader,
// wilson.gdshader, shockwave.gdshader). Там шар — raymarch-объём; в Cesium мы
// берём ту же математику цвета/плотности, но считаем её по поверхности оболочки:
// st даёт координаты, привязанные к сфере, normalEC/eyeVec — наклон к лучу, а
// турбулентность и остывание берутся из тех же формул и тех же констант.
//
// Все uniforms меняются каждый кадр из JS (update(age)), поэтому анимация
// не зависит от czm_time и одинаково работает в программном рендеринге и на GPU.
import * as Cesium from 'cesium';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Cesium 1.138 не отдаёт Vec4 из ESM-входа, а UniformReceiver принимает vec4 как
// обычный {x,y,z,w} — им и задаём цветные uniforms.
const vec4 = (x, y, z, w) => ({ x, y, z, w });

// Общий шумовой префикс. Пеленги unrolled: динамические границы цикла в GLSL ES
// 1.0 компилируются не везде, а SwiftShader падает на них молча.
const NOISE_GLSL = `
float nHash(vec3 p) {
  p = fract(p * 0.3183098861 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float nValue(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(nHash(i + vec3(0.0, 0.0, 0.0)), nHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(nHash(i + vec3(0.0, 1.0, 0.0)), nHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(nHash(i + vec3(0.0, 0.0, 1.0)), nHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(nHash(i + vec3(0.0, 1.0, 1.0)), nHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
// 4 октавы, gain 0.5 — как noise_a в исходнике (SimplexSmooth + FBM 4).
float nFbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  sum += nValue(p) * amp; p *= 2.02; amp *= 0.5;
  sum += nValue(p) * amp; p *= 2.02; amp *= 0.5;
  sum += nValue(p) * amp; p *= 2.02; amp *= 0.5;
  sum += nValue(p) * amp;
  return sum / 0.9375;
}
// Инвертированная ячеечная (Worley-lite) текстура noise_b: соты конвективных
// ячеек, из которых собран шар.
float nCells(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float best = 1.0;
  for (int k = 0; k < 8; k += 1) {
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1)) - 0.5;
    vec3 r = o + 0.5 - f;
    best = min(best, dot(r, r));
  }
  return 1.0 - clamp(sqrt(best) * 1.6, 0.0, 1.0);
}
`;

// Шкала яркости по температуре, снятая с исходника: bb_lum(T)=(T/8000)^4 *
// smoothstep(650,1500,T), плюс температурная рампа цветов огненного шара (8000 K белёсый,
// 3300 K оранжевый, 950 K тлеющий, 600 K пепел).
const TEMP_GLSL = `
float bbLum(float t) {
  float k = t / 8000.0;
  return k * k * k * k * smoothstep(650.0, 1500.0, t);
}
vec3 bbColor(float t) {
  vec3 c = mix(vec3(0.16, 0.11, 0.08), vec3(0.75, 0.26, 0.09), smoothstep(600.0, 1500.0, t));
  c = mix(c, vec3(1.00, 0.62, 0.22), smoothstep(1500.0, 3300.0, t));
  c = mix(c, vec3(1.00, 0.93, 0.82), smoothstep(3300.0, 6000.0, t));
  c = mix(c, vec3(0.92, 0.95, 1.00), smoothstep(6000.0, 8000.0, t));
  return c;
}
`;

function fabricMaterial(type, uniforms, body) {
  return new Cesium.Material({
    fabric: {
      type,
      uniforms,
      source: `${NOISE_GLSL}${TEMP_GLSL}\n${body}`,
    },
  });
}

/**
 * Огненный шар. source:disp=(n1-0.5)*2*noise + (n2-0.5)*noise*0.5, соты
 * cell_lo..cell_hi, лимб 1.08→0.86, плёночная сатурация pow(bc,1.7),
 * albedo mix(0.30,0.13,0.06 → 0.10,0.07,0.05) по skin,
 * alpha = min(clamp((T-1250)/900), 1-smoothstep(1.5*tmax, 6*tmax, t)).
 */
export function createFireballMaterial({ seed = 0, noise = 0.14, noiseScale = 4 } = {}) {
  const uniforms = {
    u_age: 0,
    u_seed: seed,
    u_noise: noise,
    u_noise_scale: noiseScale,
    u_temp: 8000,
    u_alpha: 1,
    u_skin: 0,
    u_tint: vec4(1, 1, 1, 0),
  };
  const material = fabricMaterial('kupolFireball', uniforms, `
uniform float u_age;
uniform float u_seed;
uniform float u_noise;
uniform float u_noise_scale;
uniform float u_temp;
uniform float u_alpha;
uniform float u_skin;
uniform vec4 u_tint;
void czm_getMaterial(czm_materialInput i) {
  czm_material m = czm_getDefaultMaterial(i);
  vec3 q = vec3(i.st * 2.0 - 1.0, u_age * 0.02);
  q.xy *= u_noise_scale;
  float n1 = nFbm(q + vec3(u_seed, u_seed * 0.7, 0.0));
  float n2 = nCells(q * 2.3 + vec3(3.1, 1.7, u_age * 0.35));
  float disp = (n1 - 0.5) * 2.0 * u_noise + (n2 - 0.5) * u_noise * 0.5;

  float facing = clamp(dot(normalize(i.normalEC), normalize(-i.eyeVec)), 0.0, 1.0);
  float limb = 1.0 - facing;
  // Конвективные ячейки: hot-патчи внутри, холоднее по краю.
  float patch = smoothstep(0.15, 0.85, n2 + disp);
  float tloc = u_temp * mix(0.82, 1.12, patch) * mix(1.08, 0.86, smoothstep(0.4, 1.0, limb));

  vec3 bc = bbColor(tloc);
  bc = mix(bc, pow(bc, vec3(1.7)), 0.2);
  bc += u_tint.rgb * u_tint.w * 0.6;

  float lum = bbLum(tloc);
  lum /= 1.0 + lum * 0.35;
  lum *= 1.0 - u_skin * smoothstep(0.35, 0.70, patch) * 0.85;

  m.diffuse = bc * mix(vec3(0.30, 0.13, 0.06), vec3(0.10, 0.07, 0.05), u_skin);
  m.emission = bc * lum * 2.2;
  m.alpha = u_alpha * clamp((tloc - 1250.0) / 900.0, 0.0, 1.0) * (0.72 + 0.28 * n1);
  m.specular = vec3(0.0);
}
`);
  return {
    material,
    update({ age, temp, alpha, skin, tint }) {
      uniforms.u_age = age;
      uniforms.u_temp = temp;
      uniforms.u_alpha = alpha;
      uniforms.u_skin = skin;
      if (tint) {
        uniforms.u_tint = vec4(tint[0], tint[1], tint[2], tint[3]);
      }
    },
  };
}

/**
 * Стелющаяся пыль на фронте. source: top = h*(0.55 + smoothstep noise) +
 * ragged*h*0.7*(cells-0.3), свиток вверх (y - age*h*1.5),
 * a = smoothstep(1.0,0.3,yf+..)*smoothstep(-0.05,0.06,yf)*smoothstep(1.15,0.85,yf)
 *     *(0.6+0.7*cells)*opacity*sil, цвет (0.66,0.58,0.48) по умолчанию.
 */
export function createDustMaterial({ color = [0.66, 0.58, 0.48], seed = 0 } = {}) {
  const uniforms = {
    u_age: 0,
    u_seed: seed,
    u_opacity: 0,
    u_color: vec4(color[0], color[1], color[2], 1),
    u_ragged: 0.8,
  };
  const material = fabricMaterial('kupolDust', uniforms, `
uniform float u_age;
uniform float u_seed;
uniform float u_opacity;
uniform vec4 u_color;
uniform float u_ragged;
void czm_getMaterial(czm_materialInput i) {
  czm_material m = czm_getDefaultMaterial(i);
  // st.y — доля высоты оболочки: 0 снизу, 1 сверху.
  float yf = i.st.y;
  vec3 sp = vec3(i.st.x * 26.0, i.st.y * 5.0 - u_age * 1.5, u_seed);
  float tall = nFbm(sp);
  float fine = nCells(sp * 3.1 + vec3(0.0, u_age * 0.6, 0.0));
  float top = 0.55 + 1.0 * smoothstep(0.25, 0.75, tall) + u_ragged * 0.7 * (fine - 0.3);
  float a = smoothstep(1.0, 0.3, yf + (fine - 0.5) * 0.45)
          * smoothstep(-0.05, 0.06, yf)
          * smoothstep(1.15, 0.85, yf);
  // Кромка сверху: пыль клубится до расчётной высоты top.
  a *= smoothstep(top, top - 0.22, yf);
  float facing = abs(dot(normalize(i.normalEC), normalize(-i.eyeVec)));
  float sil = smoothstep(0.05, 0.45, facing);
  a *= (0.6 + 0.7 * fine) * u_opacity * sil;
  m.diffuse = u_color.rgb * (0.78 + 0.44 * tall);
  m.emission = u_color.rgb * 0.06 * u_opacity;
  m.alpha = clamp(a, 0.0, 0.97);
  m.specular = vec3(0.0);
}
`);
  return {
    material,
    update({ age, opacity }) {
      uniforms.u_age = age;
      uniforms.u_opacity = opacity;
    },
  };
}

/**
 * Гриб/дым: клубящаяся поверхность + подсветка снизу от шара (source:
 * fire.rgb*0.25*r²/(d²+r²)) и whiten_time — выбеление верхушки.
 */
export function createCloudMaterial({ early = [0.34, 0.17, 0.08], late = [0.62, 0.56, 0.5], seed = 0 } = {}) {
  const uniforms = {
    u_age: 0,
    u_seed: seed,
    u_early: vec4(early[0], early[1], early[2], 1),
    u_late: vec4(late[0], late[1], late[2], 1),
    u_mix: 0,
    u_alpha: 0.88,
    u_glow: 0,
    u_billow: 1,
  };
  const material = fabricMaterial('kupolCloud', uniforms, `
uniform float u_age;
uniform float u_seed;
uniform vec4 u_early;
uniform vec4 u_late;
uniform float u_mix;
uniform float u_alpha;
uniform float u_glow;
uniform float u_billow;
void czm_getMaterial(czm_materialInput i) {
  czm_material m = czm_getDefaultMaterial(i);
  vec3 sp = vec3(i.st * 2.0 - 1.0, u_age * 0.05 + u_seed) * (4.0 + u_billow * 3.0);
  float n = nFbm(sp);
  float cells = nCells(sp * 2.1);
  float facing = clamp(dot(normalize(i.normalEC), normalize(-i.eyeVec)), 0.0, 1.0);
  vec3 c = mix(u_early.rgb, u_late.rgb, u_mix);
  c *= 0.66 + 0.72 * n;
  // Солнечная сторона сверху, тёмная снизу; плюс подсветка от шара.
  float up = clamp(i.st.y, 0.0, 1.0);
  c *= mix(0.62, 1.16, up);
  c += vec3(1.0, 0.55, 0.22) * u_glow * (1.0 - up) * (0.4 + 0.6 * cells);
  m.diffuse = c;
  m.emission = c * 0.08 * u_alpha;
  m.alpha = clamp(u_alpha * (0.55 + 0.45 * smoothstep(0.2, 0.8, n)) * mix(0.75, 1.0, facing), 0.0, 0.97);
  m.specular = vec3(0.0);
}
`);
  return {
    material,
    update({ age, mix, alpha, glow, billow }) {
      uniforms.u_age = age;
      uniforms.u_mix = mix;
      uniforms.u_alpha = alpha;
      uniforms.u_glow = glow;
      if (Number.isFinite(billow)) uniforms.u_billow = billow;
    },
  };
}

/**
 * Фронт ударной волны в объёме (не линия на земле): тонкая сферическая оболочка,
 * у которой непрозрачность — профиль из shockwave.gdshader
 * prof = x²·exp(2-2x) c максимумом в одной толщине от лимба, полоса
 * конденсации (0.95,0.96,1.0) при W>300 кт.
 */
export function createShockMaterial({ condensation = 0 } = {}) {
  const uniforms = {
    u_age: 0,
    u_alpha: 0,
    u_condensation: condensation,
    u_seed: 0,
  };
  const material = fabricMaterial('kupolShock', uniforms, `
uniform float u_age;
uniform float u_alpha;
uniform float u_condensation;
uniform float u_seed;
void czm_getMaterial(czm_materialInput i) {
  czm_material m = czm_getDefaultMaterial(i);
  float facing = clamp(dot(normalize(i.normalEC), normalize(-i.eyeVec)), 0.0, 1.0);
  // x — доля толщины от лимба: на краю оболочки луч идёт по касательной, там
  // плотность максимальна (в исходнике prof peaked at s=d, 0 at limb).
  float x = 1.0 - facing;
  float prof = x * x * exp(2.0 - 2.0 * x);
  float patch = smoothstep(0.3, 0.7, nCells(vec3(i.st * 14.0, u_age * 0.4 + u_seed)));
  vec3 c = mix(vec3(1.0, 0.98, 0.94), vec3(0.95, 0.96, 1.0), u_condensation * patch);
  m.diffuse = c;
  m.emission = c * 0.05 * prof;
  m.alpha = clamp(prof * u_alpha * mix(0.55, 1.0, patch), 0.0, 0.9);
  m.specular = vec3(0.0);
}
`);
  return {
    material,
    update({ alpha }) {
      uniforms.u_alpha = alpha;
    },
  };
}

/**
 * Облако Вильсона: приплюснутая толстая оболочка, живёт t0..t0+1.5·(W/20)^⅓,
 * испаряется снизу вверх (clear_y в исходнике), цвет (0.97,0.98,1.0).
 */
export function createWilsonMaterial({ flatten = 0.75, seed = 0 } = {}) {
  const uniforms = {
    u_age: 0,
    u_seed: seed,
    u_alpha: 0,
    u_evap: 0,
    u_flatten: flatten,
  };
  const material = fabricMaterial('kupolWilson', uniforms, `
uniform float u_age;
uniform float u_seed;
uniform float u_alpha;
uniform float u_evap;
uniform float u_flatten;
void czm_getMaterial(czm_materialInput i) {
  czm_material m = czm_getDefaultMaterial(i);
  vec3 sp = vec3(i.st * 2.0 - 1.0, u_age * 0.25 + u_seed) * 6.0;
  float n = nFbm(sp);
  float dens = 0.5 + 0.8 * smoothstep(0.15, 0.85, n);
  // Диск-полоски: band = sin(q.y*7 + (n-0.5)*4)
  float band = sin(i.st.y * 7.0 * 3.14159 + (n - 0.5) * 4.0 + u_seed);
  dens *= mix(1.0, 0.45 + 1.3 * smoothstep(0.6, 0.95, band), 0.6);
  // Испарение открывается снизу вверх.
  float clearY = mix(-1.2, 0.55, u_evap);
  float keep = smoothstep(clearY, clearY + 0.35, i.st.y * 2.0 - 1.0);
  m.diffuse = vec3(0.97, 0.98, 1.0) * (0.82 + 0.3 * n);
  m.emission = vec3(0.10, 0.11, 0.13) * u_alpha;
  m.alpha = clamp(dens * u_alpha * keep * u_flatten, 0.0, 0.97);
  m.specular = vec3(0.0);
}
`);
  return {
    material,
    update({ age, alpha, evap }) {
      uniforms.u_age = age;
      uniforms.u_alpha = alpha;
      uniforms.u_evap = evap;
    },
  };
}

/** Температурная кривая огненного шара по исходнику (blast_physics.gd). */
export function fireballTemperature(yieldKt, ageS) {
  const w = Math.max(1e-4, yieldKt);
  const tMin = 0.0035 * w ** 0.4;
  const t2 = 0.0417 * w ** 0.44;
  if (ageS <= tMin) return 60_000 * Math.exp(Math.log(3300 / 60_000) * (ageS / Math.max(tMin, 1e-6)));
  if (ageS <= t2) {
    const u = clamp((ageS - tMin) / Math.max(1e-6, t2 - tMin), 0, 1);
    return 3300 + (8000 - 3300) * (u * u * (3 - 2 * u));
  }
  // После второго максимума: 8000·pulse(t/t2)^0.25·sqrt(r2/r), пол 600 K.
  const tau = ageS / t2;
  const pulse = (15 / 7) * tau * tau / (1 + (8 / 7) * tau ** 3.75);
  const r2 = 61 * w ** 0.4;
  const r = Math.max(r2, r2 * (1 + 0.55 * Math.log1p(Math.max(0, tau - 1))));
  return Math.max(600, 8000 * Math.max(0, pulse) ** 0.25 * Math.sqrt(r2 / r));
}

/** Момент полного роста шара и время его остывания (t_fireball_max = 10·t2). */
export function fireballTiming(yieldKt) {
  const w = Math.max(1e-4, yieldKt);
  const t2 = 0.0417 * w ** 0.44;
  return { tMin: 0.0035 * w ** 0.4, t2, tMax: 10 * t2 };
}

/** Радиус шара: Sedov-рост, обрезанный исследованным максимумом. */
export function fireballRadius(yieldKt, maxRadiusM, ageS) {
  const { tMax } = fireballTiming(yieldKt);
  const w = Math.max(1e-4, yieldKt);
  const growth = clamp(Math.log1p(ageS / Math.max(0.02, tMax * 0.12)) / Math.log1p(1), 0, 1);
  const sedov = 1.033 * (0.5 * w * 4.184e9 * ageS ** 2 / 1.225) ** 0.2;
  const blended = (sedov ** -4 + maxRadiusM ** -4) ** -0.25;
  return Math.min(maxRadiusM, Math.max(blended, maxRadiusM * growth * 0.35));
}

export const fireballSkin = (yieldKt, ageS) => {
  const { t2 } = fireballTiming(yieldKt);
  return clamp((ageS / t2 - 8) / 32, 0, 1);
};

export const fireballAlpha = (yieldKt, ageS) => {
  const { tMax } = fireballTiming(yieldKt);
  return 1 - clamp((ageS - 1.5 * tMax) / (4.5 * tMax), 0, 1);
};

export const __test = { clamp, NOISE_GLSL };
