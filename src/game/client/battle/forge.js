// «Кузница» юнитов: все модели боя собираются здесь с нуля, кодом — без сторонних ассетов.
// Пехота — настоящий скелет (бёдра, колени, локти, кисти, хват оружия) и скиннинг, клипы
// idle / walk / run / attack / die; техника — узлы turret / barrel / rotor с анимацией узлов.
// Модели разбиты по эпохам игры (data/techs.js → ERAS): Древность, Индустрия,
// Информационная и Космическая. Тот же код в Node выгружает .glb (scripts/game-units.mjs),
// их можно открыть и доработать в Blender: файл из public/game/units/manifest.json
// перекрывает кованую модель.
// Единицы — метры, +Y вверх, лицом в +Z, стоит на y = 0. Левая сторона бойца — +X.
// Вершины: color (цвет по умолчанию с запечённой окклюзией), team (0 — свой цвет,
// >0 — доля цвета нации), metal (0/1). Одна геометрия и один материал на бойца.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PAL = {
  skin: '#c69a73', skin2: '#a87b56', hair: '#1a1410', cloth: '#2d2b29', indigo: '#26304a', hakama: '#33303d',
  lacquer: '#221c1b', lacquer2: '#5b2620', steel: '#c9cfd6', iron: '#5d6166', gold: '#d2a43c', wood: '#6e4b2a',
  darkwood: '#3b2717', bamboo: '#b9a46a', straw: '#b8a066', leather: '#5b3b22', leather2: '#3a2716', rope: '#c9b98e',
  white: '#e8e2d2', peasant: '#7c6a4a', peasant2: '#5f5038', khaki: '#7b7350', khaki2: '#5f5a3d', olive: '#4c5634',
  olive2: '#5c6741', field: '#5a5e4a', coat: '#4a4a3c', wool: '#6b6450', rubber: '#1c1d1d', dark: '#2a2c2e',
  gun: '#2e3134', camo: '#5d6447', camo2: '#454b33', tan: '#a08d66', black: '#18191a', denim: '#34445e',
  hood: '#4a4f55', glass: '#2a3a46', visor: '#7fe9ff', glow: '#9ff4ff', armor: '#c5c9cc', armor2: '#8b9196',
  ceramic: '#d8d4ca', carbon: '#2c3034', coil: '#b87333',
  team: '#b8352e',
};
const METALS = new Set(['steel', 'iron', 'gold', 'gun', 'armor', 'armor2', 'dark', 'coil']);
const GLOWS = new Set(['glow', 'visor']);
const TEAM = { team: 1, teamDark: 0.45, teamMid: 0.7 };

// ---------- геометрия ----------
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(); const tmpQ = new THREE.Quaternion();
const indexed = (g) => {
  if (!g.index) { const n = g.attributes.position.count; g.setIndex([...Array(n).keys()]); }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.normalizeNormals(); // после scale() нормали не единичные
  return g;
};
let LOW = false; // низкая детализация (дальний план): вдвое меньше сегментов
const sg = (n, min = 4) => (LOW ? Math.max(min, Math.round(n / 2)) : n);
export const G = {
  box: (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z),
  rbox: (w, h, d, x = 0, y = 0, z = 0, r = 0.25) => { // скруглённый ящик: сфера, растянутая в коробку
    const g = new THREE.SphereGeometry(0.5, sg(10, 6), sg(8, 4)); const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      const vx = p.getX(i); const vy = p.getY(i); const vz = p.getZ(i);
      const s = (v) => Math.sign(v) * Math.pow(Math.abs(v * 2), r) / 2;
      p.setXYZ(i, s(vx) * w + x, s(vy) * h + y, s(vz) * d + z);
    }
    g.computeVertexNormals(); return g;
  },
  cyl: (rt, rb, h, x = 0, y = 0, z = 0, seg = 10, open = false, t0 = 0, tl = Math.PI * 2) => new THREE.CylinderGeometry(rt, rb, h, sg(seg), 1, open, t0, tl).translate(x, y, z),
  /** Эллипсоид: сфера, сжатая по осям вокруг своего центра, затем поставленная в точку. */
  ell: (r, [sx, sy, sz], x = 0, y = 0, z = 0, ws = 12, hs = 9, th = Math.PI) => new THREE.SphereGeometry(r, sg(ws, 6), sg(hs, 3), 0, Math.PI * 2, 0, th).scale(sx, sy, sz).translate(x, y, z),
  sph: (r, x = 0, y = 0, z = 0, ws = 12, hs = 9, th = Math.PI) => new THREE.SphereGeometry(r, sg(ws, 6), sg(hs, 3), 0, Math.PI * 2, 0, th).translate(x, y, z),
  cone: (r, h, x = 0, y = 0, z = 0, seg = 10) => new THREE.ConeGeometry(r, h, sg(seg)).translate(x, y, z),
  torus: (R, r, arc = Math.PI * 2, rs = 5, ts = 16) => new THREE.TorusGeometry(R, r, rs, ts, arc),
  /** Усечённый конус между двумя точками. */
  seg: (a, b, r0, r1, seg = 10) => {
    const va = new THREE.Vector3(...a); const vb = new THREE.Vector3(...b); const len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(r1, r0, len, sg(seg), 1);
    tmpQ.setFromUnitVectors(UP, tmpV.subVectors(vb, va).normalize());
    return g.applyQuaternion(tmpQ).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  },
  /** Повернуть вокруг собственного центра и поставить в точку. */
  at: (g, [rx = 0, ry = 0, rz = 0], [x = 0, y = 0, z = 0]) => g.rotateZ(rz).rotateX(rx).rotateY(ry).translate(x, y, z),
  /** Тело вращения по профилю [[r, y], ...], сплющенное по глубине. */
  lathe: (prof, depth = 0.66, seg = 16, x = 0, z = 0) => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), sg(seg, 6)).scale(1, 1, depth).translate(x, 0, z),
  /** Профиль сбоку (в плоскости ZY), выдавленный по X на ширину w. */
  side: (pts, w, x = 0) => {
    const s = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
    return new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 }).rotateY(-Math.PI / 2).translate(x + w / 2, 0, 0);
  },
  /** Профиль сверху (в плоскости XZ), выдавленный вверх на h. */
  plan: (pts, h, y = 0) => {
    const s = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
    return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 }).rotateX(-Math.PI / 2).translate(0, y, 0);
  },
};

/** Набор частей одной модели: геометрия, цвет палитры, кость или узел. */
class Kit {
  constructor() { this.parts = []; }
  add(at, geo, c) {
    if (LOW) { geo.computeBoundingSphere(); if (geo.boundingSphere.radius < 0.035) return this; } // вдали мелочь не видна
    this.parts.push({ at, geo, c }); return this;
  }
  /** Зеркальная пара: f(s) с s = +1 (левая, +X) и s = −1 (правая). */
  pair(f) { for (const s of [1, -1]) f(s, s > 0 ? 'L' : 'R'); return this; }
}

/** Сливает части с одной костью/узлом в геометрию с атрибутами color, team, metal (и skin). */
function bake(parts, { boneIndex = null, aoFoot = true } = {}) {
  const geos = [];
  const col = new THREE.Color();
  for (const p of parts) {
    const g = indexed(p.geo.clone());
    const n = g.attributes.position.count;
    const color = new Float32Array(n * 3); const team = new Float32Array(n); const metal = new Float32Array(n);
    const t = TEAM[p.c] ?? 0;
    col.set(t ? PAL.team : PAL[p.c] ?? p.c); if (t) col.multiplyScalar(t);
    for (let i = 0; i < n; i += 1) {
      const y = g.attributes.position.getY(i);
      const ao = aoFoot ? 0.6 + 0.4 * Math.min(1, Math.max(0, y / 1.4)) : 0.72 + 0.28 * Math.min(1, Math.max(0, y / 1.6));
      color[i * 3] = col.r * ao; color[i * 3 + 1] = col.g * ao; color[i * 3 + 2] = col.b * ao;
      team[i] = t * ao; metal[i] = GLOWS.has(p.c) ? 2 : METALS.has(p.c) ? 1 : 0;
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('team', new THREE.BufferAttribute(team, 1));
    g.setAttribute('metal', new THREE.BufferAttribute(metal, 1));
    if (boneIndex) {
      const bi = boneIndex(p.at); const si = new Uint16Array(n * 4); const sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i += 1) { si[i * 4] = bi; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    }
    geos.push(g);
  }
  return mergeGeometries(geos);
}

// ---------- скелет пехотинца ----------
// [имя, родитель, точка сустава в позе привязки (руки опущены вдоль тела)]
const RIG = [
  ['root', null, [0, 0, 0]], ['hips', 'root', [0, 0.97, 0]], ['spine', 'hips', [0, 1.1, 0]], ['chest', 'spine', [0, 1.28, 0]],
  ['neck', 'chest', [0, 1.49, 0]], ['head', 'neck', [0, 1.57, 0.01]],
  ['armL', 'chest', [0.195, 1.43, 0]], ['foreL', 'armL', [0.215, 1.15, -0.005]], ['handL', 'foreL', [0.228, 0.9, 0.01]], ['gripL', 'handL', [0.23, 0.85, 0.03]],
  ['armR', 'chest', [-0.195, 1.43, 0]], ['foreR', 'armR', [-0.215, 1.15, -0.005]], ['handR', 'foreR', [-0.228, 0.9, 0.01]], ['gripR', 'handR', [-0.23, 0.85, 0.03]],
  ['thighL', 'hips', [0.098, 0.94, 0]], ['shinL', 'thighL', [0.1, 0.52, 0.012]], ['footL', 'shinL', [0.102, 0.09, -0.01]],
  ['thighR', 'hips', [-0.098, 0.94, 0]], ['shinR', 'thighR', [-0.1, 0.52, 0.012]], ['footR', 'shinR', [-0.102, 0.09, -0.01]],
];
const J = Object.fromEntries(RIG.map(([n, , p]) => [n, p]));

/** Тело-основа: каждая часть окрашена своей одеждой (одна оболочка, без «кожи под тканью»). */
function figure(k, o = {}) {
  const c = { skin: 'skin', shirt: 'cloth', sleeve: o.shirt ?? 'cloth', fore: o.sleeve ?? o.shirt ?? 'cloth', pants: 'cloth', shin: o.pants ?? 'cloth', boot: 'leather2', hand: 'skin', belt: 'leather', neck: 'skin', ...o };
  // таз, живот, грудь — профили по высоте
  k.add('hips', G.lathe([[0.04, 0.86], [0.13, 0.875], [0.152, 0.93], [0.155, 1.0], [0.148, 1.08], [0.05, 1.1]], 0.68), c.pants);
  k.add('spine', G.lathe([[0.05, 1.03], [0.152, 1.05], [0.15, 1.14], [0.158, 1.24], [0.05, 1.26]], 0.66), c.shirt);
  k.add('hips', G.cyl(0.162, 0.165, 0.06, 0, 1.06, 0, 16).scale(1, 1, 0.7), c.belt);
  k.add('chest', G.lathe([[0.05, 1.18], [0.158, 1.2], [0.19, 1.3], [0.205, 1.39], [0.2, 1.45], [0.13, 1.5], [0.05, 1.51]], 0.62), c.shirt);
  k.add('neck', G.cyl(0.048, 0.056, 0.12, 0, 1.52, 0.005, 10), c.neck);
  // голова: череп, челюсть, нос, уши, глаза, брови
  k.add('head', G.ell(0.1, [0.92, 1.1, 1.0], 0, 1.67, 0.008, 16, 12), c.skin);
  k.add('head', G.rbox(0.13, 0.07, 0.1, 0, 1.575, 0.035), c.skin);
  k.add('head', G.rbox(0.026, 0.05, 0.034, 0, 1.635, 0.1, 0.4), c.skin);
  k.pair((s) => { k.add('head', G.ell(0.022, [0.5, 1, 0.8], s * 0.092, 1.64, 0.0, 6, 5), c.skin); });
  k.pair((s) => { k.add('head', G.sph(0.012, s * 0.036, 1.66, 0.088, 6, 5), 'black'); k.add('head', G.box(0.04, 0.008, 0.012, s * 0.037, 1.685, 0.092), 'hair'); });
  if (o.hair !== false) k.add('head', G.ell(0.104, [0.95, 1.05, 1.02], 0, 1.665, -0.006, 14, 8, Math.PI * 0.55), o.hair ?? 'hair');
  // руки: дельта, плечо, локоть, предплечье, кисть с большим пальцем
  k.pair((s, L) => {
    k.add(`arm${L}`, G.ell(0.068, [1.05, 0.95, 0.9], s * 0.195, 1.425, 0, 10, 8), c.sleeve);
    k.add(`arm${L}`, G.seg([s * 0.198, 1.42, 0], [s * 0.214, 1.16, -0.005], 0.058, 0.046), c.sleeve);
    k.add(`fore${L}`, G.sph(0.047, s * 0.215, 1.15, -0.005, 8, 6), c.sleeve);
    k.add(`fore${L}`, G.seg([s * 0.215, 1.15, -0.005], [s * 0.227, 0.92, 0.008], 0.046, 0.036), c.fore);
    k.add(`hand${L}`, G.rbox(0.042, 0.092, 0.07, s * 0.229, 0.86, 0.018, 0.3), c.hand);
    k.add(`hand${L}`, G.seg([s * 0.215, 0.89, 0.04], [s * 0.212, 0.85, 0.06], 0.013, 0.011, 5), c.hand);
  });
  // ноги: бедро, колено, голень, стопа
  k.pair((s, L) => {
    k.add(`thigh${L}`, G.seg([s * 0.096, 0.97, 0], [s * 0.1, 0.53, 0.012], 0.096 + (o.wide ?? 0), 0.066 + (o.wide ?? 0) * 0.7, 12), c.pants);
    k.add(`shin${L}`, G.sph(0.062, s * 0.1, 0.52, 0.016, 10, 7), c.knee ?? c.pants);
    k.add(`shin${L}`, G.seg([s * 0.1, 0.52, 0.012], [s * 0.102, 0.1, -0.008], 0.062, 0.042, 12), c.shin);
    k.add(`foot${L}`, G.rbox(0.092, 0.085, 0.25, s * 0.102, 0.045, 0.055, 0.35), c.boot);
  });
  return k;
}

// ---------- снаряжение ----------
const sashimono = (k, mon = 'white') => {
  k.add('chest', G.cyl(0.011, 0.011, 1.25, 0, 1.78, -0.17, 5), 'darkwood');
  k.add('chest', G.at(G.cyl(0.008, 0.008, 0.34, 0, 0, 0, 4), [Math.PI / 2, 0, 0], [0, 2.34, -0.31]), 'darkwood');
  k.add('chest', G.box(0.012, 0.52, 0.3, 0, 2.08, -0.31), 'team');
  k.pair((s) => k.add('chest', new THREE.CircleGeometry(0.075, 14).rotateY(s * Math.PI / 2).translate(s * 0.008, 2.12, -0.31), mon));
};
/** Окэгава-до: горизонтальные пластины кирасы со шнуровкой. */
const dou = (k, c, lace, n = 6) => {
  for (let i = 0; i < n; i += 1) {
    const y = 1.08 + i * (0.38 / n); const r = 0.168 + Math.sin((i / n) * Math.PI) * 0.03;
    k.add(i < 2 ? 'spine' : 'chest', G.cyl(r + 0.012, r + 0.006, 0.38 / n - 0.008, 0, y + 0.03, 0, 16).scale(1, 1, 0.68), c);
    k.add(i < 2 ? 'spine' : 'chest', G.cyl(r + 0.014, r + 0.014, 0.008, 0, y + 0.002, 0, 16).scale(1, 1, 0.69), lace);
  }
  // одоси: вертикальная шнуровка пластин спереди и сзади
  for (const a of [-0.5, -0.17, 0.17, 0.5]) for (const back of [0, 1]) {
    const ang = a + back * Math.PI; const rr = 0.2;
    k.add('chest', G.box(0.012, 0.36, 0.006, Math.sin(ang) * rr, 1.28, Math.cos(ang) * rr * 0.7 + (back ? -0.004 : 0.004)).rotateY(0), lace);
  }
};
/** Кусадзури: пластины-юбка, привязанные к бёдрам (идут вместе с шагом). */
const kusazuri = (k, c, lace, len = 0.26) => {
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6; const x = Math.sin(a); const bone = Math.abs(x) < 0.3 ? 'hips' : x > 0 ? 'thighL' : 'thighR';
    const plate = G.box(0.15, len, 0.022, 0, 1.0 - len / 2, 0).rotateX(-0.16).translate(0, 0, 0.175).rotateY(a).scale(1, 1, 0.78);
    k.add(bone, plate, c);
    for (let j = 1; j < 3; j += 1) k.add(bone, G.box(0.152, 0.012, 0.026, 0, 1.0 - (len * j) / 3, 0).rotateX(-0.16).translate(0, 0, 0.177).rotateY(a).scale(1, 1, 0.78), lace);
  }
};
/** Полы (шинель, кимоно, хакама): левая половина идёт с левым бедром, правая — с правым. */
const skirt = (k, c, y0, r0, r1) => {
  const h = 1.0 - y0;
  k.pair((s, L) => k.add(`thigh${L}`, G.cyl(r0, r1, h, 0, y0 + h / 2, 0, 12, true, s > 0 ? 0 : Math.PI, Math.PI).scale(1, 1, 0.78), c));
  k.add('hips', G.cyl(r0 + 0.004, r0 + 0.004, 0.08, 0, 0.98, 0, 14, true).scale(1, 1, 0.78), c);
};
const jingasa = (k, c = 'lacquer') => {
  k.add('head', G.cone(0.32, 0.13, 0, 1.79, 0, 20), c);
  k.add('head', G.cyl(0.33, 0.33, 0.012, 0, 1.722, 0, 20), c);
  k.add('head', new THREE.CircleGeometry(0.055, 14).rotateX(-1.18).translate(0, 1.79, 0.13), 'team');
};
const yari = (k, len = 3.9) => {
  const g = J.gripR; // древко вдоль +Y через ладонь в позе привязки
  k.add('gripR', G.cyl(0.018, 0.022, len, g[0], g[1] + len / 2 - 1.0, g[2], 6), 'darkwood');
  k.add('gripR', G.cone(0.03, 0.42, g[0], g[1] + len - 1.0 + 0.2, g[2], 4), 'steel');
  k.add('gripR', G.cyl(0.03, 0.03, 0.07, g[0], g[1] + len - 1.0 - 0.02, g[2], 8), 'gold');
};
const katana = (k) => {
  const g = J.gripR;
  k.add('gripR', G.box(0.032, 0.26, 0.032, g[0], g[1] - 0.02, g[2]), 'black');
  k.add('gripR', G.cyl(0.048, 0.048, 0.012, g[0], g[1] + 0.12, g[2], 12), 'gold');
  const blade = G.box(0.026, 0.82, 0.008, 0, 0.41, 0); const p = blade.attributes.position;
  for (let i = 0; i < p.count; i += 1) { const y = p.getY(i); p.setZ(i, p.getZ(i) + (y / 0.82) ** 2 * 0.05); if (y > 0.8) p.setX(i, p.getX(i) * 0.3); }
  blade.computeVertexNormals();
  k.add('gripR', blade.translate(g[0], g[1] + 0.13, g[2]), 'steel');
};
const rifle = (k, { len = 1.1, stock = 'wood', bay = false, optic = false, mag = false, color = 'gun', glow = false } = {}) => {
  const g = J.gripR; const [x, y, z] = g; // ствол вдоль +Y от хвата: приклад сзади, дуло впереди
  k.add('gripR', G.rbox(0.045, 0.34, 0.07, x, y - 0.18, z - 0.01, 0.4), stock);
  k.add('gripR', G.box(0.05, 0.36, 0.06, x, y + 0.12, z + 0.01), color);
  k.add('gripR', G.cyl(0.011, 0.012, len * 0.55, x, y + 0.3 + len * 0.27, z + 0.02, 6), color);
  if (stock === 'wood') k.add('gripR', G.box(0.044, len * 0.45, 0.05, x, y + 0.3 + len * 0.2, z + 0.005), 'wood');
  if (bay) k.add('gripR', G.box(0.008, 0.3, 0.012, x, y + 0.3 + len * 0.55 + 0.12, z + 0.035), 'steel');
  if (optic) k.add('gripR', G.box(0.04, 0.14, 0.05, x, y + 0.12, z - 0.06), 'black');
  if (mag) k.add('gripR', G.box(0.03, 0.07, 0.15, x, y + 0.06, z + 0.1), color === 'gun' ? 'black' : color);
  if (glow) k.add('gripR', G.box(0.054, 0.3, 0.012, x, y + 0.16, z + 0.045), 'glow');
};
const backpack = (k, c, w = 0.3, h = 0.36, roll = null) => {
  k.add('chest', G.rbox(w, h, 0.17, 0, 1.28, -0.2, 0.35), c);
  if (roll) k.add('chest', G.cyl(0.065, 0.065, w + 0.06, 0, 0, 0, 10).rotateZ(Math.PI / 2).translate(0, 1.5, -0.2), roll);
};

// ---------- позы и клипы ----------
const E = (x = 0, y = 0, z = 0) => [x, y, z];
/** Удержание оружия: поза рук и хвата поверх шага (null — руки свободны и машут). */
const HOLD = {
  free: () => ({}),
  spear: () => ({ armR: E(-0.25, 0, 0.12), foreR: E(-1.05), gripR: E(1.3) }),
  sword: () => ({ armR: E(-0.35, 0, 0.18), foreR: E(-1.05, 0, 0), gripR: E(2.1), armL: E(-0.42, 0, -0.3), foreL: E(-1.0, 0, 0), handL: E(0, 0, 0) }),
  bow: () => ({ armL: E(-0.2, 0, -0.05), foreL: E(-0.3), gripL: E(0.5) }),
  rifle: () => ({ armR: E(-0.05, 0, 0.06), foreR: E(-0.45), gripR: E(0.62) }), // «на плечо»: винтовка вертикально у правого бока
};
const ATTACK = {
  spear: (t) => { const th = Math.max(0, Math.sin(t * Math.PI * 2)); const a = -0.55 - th * 0.55; const f = -0.95 + th * 0.75; return { armR: E(a, 0, 0.2), foreR: E(f), gripR: E(Math.PI / 2 - a - f), armL: E(-0.95 - th * 0.3, 0, -0.35), foreL: E(-0.55 + th * 0.2), chest: E(0.1 + th * 0.15, -0.25), spine: E(0.08), thighL: E(-0.5), shinL: E(0.4), thighR: E(0.25), shinR: E(0.2), footL: E(0.1), footR: E(-0.3) }; },
  sword: (t) => { // замах над головой и рубящий удар вниз
    const k = t < 0.55 ? t / 0.55 : 1 - (t - 0.55) / 0.45; const e = k * k * (3 - 2 * k);
    const a = -0.5 - e * 2.3; const f = -0.9 + e * 0.6; const blade = 1.55 - e * 2.3;
    return { armR: E(a, 0, 0.32), foreR: E(f), gripR: E(blade - a - f), armL: E(a + 0.05, 0, -0.32), foreL: E(f), chest: E(0.2 - e * 0.35, -0.2 * (1 - e)), spine: E(0.1), thighL: E(-0.45), shinL: E(0.35), thighR: E(0.3), shinR: E(0.25), footR: E(-0.4) };
  },
  bow: (t) => { // поднять лук, натянуть, выпустить
    const d = t < 0.7 ? Math.min(1, t / 0.55) : Math.max(0, 1 - (t - 0.7) / 0.08);
    return { armL: E(-1.5, 0, 0.1), foreL: E(-0.05), gripL: E(1.48 - 0.2), armR: E(-1.45, 0, -0.35 + d * 0.1), foreR: E(-0.9 - d * 1.35, 0, 0), handR: E(0, 0, 0), chest: E(0, 0.55), head: E(0, -0.5), spine: E(0, 0.25), thighL: E(-0.18), thighR: E(0.18), shinR: E(0.1) };
  },
  rifle: (t) => { // прицел от плеча, выстрел с отдачей
    const kick = t < 0.1 ? t / 0.1 : Math.max(0, 1 - (t - 0.1) / 0.25);
    return { armR: E(-1.1 + kick * 0.15, 0, -0.55), foreR: E(-1.9), gripR: E(Math.PI / 2 + 1.1 + 1.9 - kick * 0.25 + 0.2 - 0.2), armL: E(-1.35, 0, -0.42), foreL: E(-0.55), chest: E(-kick * 0.08, 0.12), head: E(0.15, -0.1), thighL: E(-0.3), shinL: E(0.25), thighR: E(0.25), shinR: E(0.15), footR: E(-0.25) };
  },
  free: (t) => ({ armR: E(-1.2 - Math.sin(t * Math.PI * 2) * 0.6), foreR: E(-0.8), armL: E(-1.0), foreL: E(-1.1) }),
};
function gait(t, run) {
  const f = t * Math.PI * 2; const A = run ? 0.78 : 0.42; const s = Math.sin(f);
  const kneeA = Math.max(0, Math.cos(f)) ** 1.5 * (run ? 1.45 : 0.85) + (run ? 0.25 : 0.08);
  const kneeB = Math.max(0, -Math.cos(f)) ** 1.5 * (run ? 1.45 : 0.85) + (run ? 0.25 : 0.08);
  return {
    thighL: E(-A * s), shinL: E(kneeA), footL: E(-(-A * s + kneeA) * 0.45 + (run ? 0.1 : 0)),
    thighR: E(A * s), shinR: E(kneeB), footR: E(-(A * s + kneeB) * 0.45 + (run ? 0.1 : 0)),
    hips: E(0, 0.09 * s * (run ? 0.6 : 1), 0), spine: E(run ? 0.18 : 0.03), chest: E(run ? 0.1 : 0.02, -0.12 * s), head: E(run ? -0.15 : 0, 0.06 * s),
    armL: E((run ? 0.75 : 0.38) * s, 0, -0.06), foreL: E(run ? -1.25 : -0.28 - Math.max(0, -s) * 0.3),
    armR: E(-(run ? 0.75 : 0.38) * s, 0, 0.06), foreR: E(run ? -1.25 : -0.28 - Math.max(0, s) * 0.3),
    _y: (run ? 0.04 : 0.022) * Math.cos(2 * f) - (run ? 0.06 : 0.015),
  };
}
const idlePose = (t) => ({ chest: E(0.02 * Math.sin(t * Math.PI * 2)), head: E(0.02, 0.12 * Math.sin(t * Math.PI * 2 + 1)), armL: E(0, 0, -0.07), armR: E(0, 0, 0.07), foreL: E(-0.15), foreR: E(-0.15), thighL: E(0, 0, 0.03), thighR: E(0, 0, -0.03), _y: -0.004 * Math.sin(t * Math.PI * 4) });
const diePose = (t) => { const e = Math.min(1, t * 1.6); const s = e * e * (3 - 2 * e); return { hips: E(-1.45 * s, 0, 0.15 * s), spine: E(0.2 * s), chest: E(0.15 * s), head: E(-0.4 * s), armL: E(-2.4 * s, 0, 0.5 * s), armR: E(-2.0 * s, 0, -0.8 * s), foreL: E(-0.3 * s), foreR: E(-0.6 * s), thighL: E(-0.6 * s), shinL: E(0.9 * s), thighR: E(-0.15 * s), shinR: E(0.2 * s), _y: -0.82 * s, _z: -0.5 * s }; };

function poseFor(name, t, hold) {
  const base = name === 'walk' ? gait(t, false) : name === 'run' ? gait(t, true) : name === 'die' ? diePose(t) : idlePose(t);
  if (name === 'attack') return { ...idlePose(t), ...(ATTACK[hold] ?? ATTACK.free)(t) };
  if (name === 'die') return base;
  const h = HOLD[hold]();
  // бег с оружием: та же поза рук, корпус наклонён
  if (name === 'run' && hold !== 'free') for (const k of Object.keys(h)) if (k.startsWith('fore') && k !== 'foreL') h[k] = E(h[k][0] - 0.2);
  return { ...base, ...h };
}
const CLIP_LEN = { idle: 2.4, walk: 1.05, run: 0.64, attack: 1.0, die: 1.0 };
function humanClips(hold, attackLen = 1.0) {
  const e = new THREE.Euler(); const q = new THREE.Quaternion();
  return ['idle', 'walk', 'run', 'attack', 'die'].map((name) => {
    const len = name === 'attack' ? attackLen : CLIP_LEN[name]; const N = name === 'idle' ? 24 : 20;
    const times = []; const rot = Object.fromEntries(RIG.map(([n]) => [n, []])); const pos = [];
    for (let i = 0; i <= N; i += 1) {
      const t = i / N; const p = poseFor(name, name === 'die' ? t : t % 1, hold);
      times.push(t * len);
      for (const [n] of RIG) { const r = p[n] ?? E(); q.setFromEuler(e.set(r[0], r[1], r[2], 'YXZ')); rot[n].push(q.x, q.y, q.z, q.w); }
      const h = J.hips; pos.push(h[0], h[1] + (p._y ?? 0), h[2] + (p._z ?? 0));
    }
    const tracks = RIG.filter(([n]) => rot[n].some((v, i) => (i % 4 === 3 ? Math.abs(v - 1) > 1e-4 : Math.abs(v) > 1e-4)))
      .map(([n]) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, rot[n]));
    tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, pos));
    return new THREE.AnimationClip(name, len, tracks);
  });
}

/** Собирает скиннингованного бойца: Group → SkinnedMesh + кости. */
/** Голова чуть крупнее (на поле боя читается силуэт): масштаб вокруг шеи. */
const bigHead = (k) => { for (const p of k.parts) if (p.at === 'head') p.geo.translate(0, -1.55, 0).scale(1.1, 1.1, 1.1).translate(0, 1.55, 0); return k; };
function humanoid(name, build, hold, opts = {}) {
  const k = new Kit(); build(k); bigHead(k);
  LOW = true; const kLow = new Kit(); build(kLow); bigHead(kLow); LOW = false;
  const bones = {}; const list = [];
  for (const [n, parent, p] of RIG) {
    const b = new THREE.Bone(); b.name = n;
    const pp = parent ? J[parent] : [0, 0, 0]; b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    if (parent) bones[parent].add(b);
    bones[n] = b; list.push(b);
  }
  const idx = Object.fromEntries(list.map((b, i) => [b.name, i]));
  // два уровня детализации на одном скелете: lod0 — вблизи, lod1 — дальний план
  const scene = new THREE.Group(); scene.name = name; scene.add(bones.root); bones.root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  const geos = [k, kLow].map((kit, i) => {
    const geo = bake(kit.parts, { boneIndex: (at) => idx[at] });
    const mesh = new THREE.SkinnedMesh(geo, forgeMaterial()); mesh.name = `${name}_lod${i}`; mesh.userData.lod = i;
    mesh.bind(skeleton, new THREE.Matrix4()); mesh.castShadow = i === 0; mesh.receiveShadow = true; mesh.visible = i === 0;
    scene.add(mesh); return geo;
  });
  return { scene, animations: humanClips(hold, opts.attackLen), kind: 'foot', parts: k.parts, tris: geos[0].index.count / 3, trisLow: geos[1].index.count / 3 };
}

/** Поза в статичную геометрию (расчёт орудия, павшие): части по костям в позе p. */
function posedGeometry(build, p) {
  const k = new Kit(); build(k); bigHead(k);
  const bones = {};
  const e = new THREE.Euler();
  for (const [n, parent, pt] of RIG) {
    const b = new THREE.Object3D(); const pp = parent ? J[parent] : [0, 0, 0];
    b.position.set(pt[0] - pp[0], pt[1] - pp[1], pt[2] - pp[2]);
    const r = p[n] ?? E(); b.quaternion.setFromEuler(e.set(r[0], r[1], r[2], 'YXZ'));
    if (n === 'hips') b.position.y += p._y ?? 0;
    if (parent) bones[parent].add(b); bones[n] = b;
  }
  bones.root.updateMatrixWorld(true);
  const parts = k.parts.map((part) => {
    const bind = new THREE.Matrix4().makeTranslation(...J[part.at]);
    const m = bones[part.at].matrixWorld.clone().multiply(bind.invert());
    return { ...part, geo: part.geo.clone().applyMatrix4(m) };
  });
  return parts;
}

// ---------- бойцы по эпохам ----------
const OUTFIT = {
  // Древность (эпоха 0): Сэнгоку
  ashigaru(k) {
    figure(k, { shirt: 'indigo', pants: 'indigo', shin: 'lacquer2', boot: 'straw', fore: 'lacquer', hair: 'hair' });
    dou(k, 'team', 'lacquer', 5); kusazuri(k, 'lacquer', 'teamDark', 0.2); jingasa(k); sashimono(k);
    k.pair((s, L) => k.add(`arm${L}`, G.at(G.box(0.05, 0.16, 0.15), [0, 0, s * 0.12], [s * 0.24, 1.37, 0]), 'lacquer'));
  },
  samurai(k) {
    figure(k, { shirt: 'teamDark', pants: 'hakama', shin: 'lacquer', boot: 'leather2', fore: 'lacquer', wide: 0.03, hair: 'hair' });
    skirt(k, 'hakama', 0.3, 0.16, 0.24); // широкие хакама
    dou(k, 'teamDark', 'team', 7); kusazuri(k, 'teamDark', 'team', 0.3); sashimono(k, 'gold');
    // кабуто: купол, сикоро, фукигаэси, кувагата, мэмпо
    k.add('head', G.ell(0.128, [1, 0.92, 1.05], 0, 1.69, 0, 18, 9, Math.PI / 2), 'lacquer');
    for (let i = 0; i < 4; i += 1) k.add('head', G.cyl(0.135 + i * 0.03, 0.165 + i * 0.03, 0.05, 0, 1.68 - i * 0.042, -0.01, 18, true, Math.PI * 0.32, Math.PI * 1.36).scale(1, 1, 0.95), i % 2 ? 'team' : 'teamDark');
    k.pair((s) => k.add('head', G.box(0.09, 0.08, 0.016, s * 0.135, 1.69, 0.085).rotateY(s * 0.0), 'lacquer'));
    k.pair((s) => k.add('head', G.at(G.box(0.02, 0.22, 0.012), [0, 0, -s * 0.35], [s * 0.1, 1.86, 0.11]), 'gold'));
    k.add('head', new THREE.CircleGeometry(0.03, 10).translate(0, 1.77, 0.122), 'gold');
    k.add('head', G.rbox(0.12, 0.07, 0.06, 0, 1.585, 0.075), 'iron'); // мэмпо
    k.pair((s) => k.add('head', G.at(G.box(0.05, 0.008, 0.01), [0, 0, s * 0.35], [s * 0.028, 1.6, 0.108]), 'white')); // усы на маске
    // содэ — наплечные щитки на руках
    k.pair((s, L) => { for (let i = 0; i < 4; i += 1) k.add(`arm${L}`, G.at(G.box(0.04, 0.07, 0.22), [0, 0, s * 0.1], [s * (0.26 + i * 0.006), 1.42 - i * 0.07, 0]), i % 2 ? 'team' : 'teamDark'); });
    katana(k);
    k.add('hips', G.at(G.box(0.04, 0.85, 0.045), [1.15, 0, 0], [0.2, 0.95, -0.05]), 'lacquer'); // сая на левом боку
  },
  archer(k) {
    figure(k, { shirt: 'indigo', pants: 'indigo', shin: 'lacquer2', boot: 'straw', fore: 'indigo', hair: 'hair' });
    dou(k, 'team', 'lacquer', 3); kusazuri(k, 'lacquer', 'teamDark', 0.16); jingasa(k, 'lacquer2');
    k.add('chest', G.at(G.rbox(0.13, 0.5, 0.1, 0, 0, 0, 0.4), [0, 0, -0.25], [0.12, 1.3, -0.2]), 'leather'); // эбира
    for (const dx of [-0.03, 0, 0.03]) k.add('chest', G.at(G.box(0.01, 0.34, 0.01), [0, 0, -0.25], [0.2 + dx, 1.62, -0.2]), 'white');
    const g = J.gripL; // юми: асимметричная дуга, хват в нижней трети
    const bow = G.torus(2.4, 0.014, 0.95, 4, 24).rotateZ(Math.PI - 0.475).translate(2.4, 0, 0).rotateY(Math.PI / 2).translate(g[0], g[1] + 0.37, g[2] + 0.02);
    k.add('gripL', bow, 'darkwood');
    k.add('gripL', G.box(0.004, 2.18, 0.004, g[0], g[1] + 0.37, g[2] - 0.25), 'white');
  },
  peasant(k) {
    figure(k, { shirt: 'peasant', pants: 'peasant2', shin: 'skin2', boot: 'straw', fore: 'skin2', hair: 'hair' });
    skirt(k, 'peasant', 0.66, 0.165, 0.23); // полы кимоно
    k.add('head', G.cone(0.36, 0.17, 0, 1.79, 0, 18), 'straw'); k.add('head', G.cyl(0.36, 0.36, 0.01, 0, 1.705, 0, 18), 'straw');
    k.add('hips', G.cyl(0.17, 0.17, 0.05, 0, 1.06, 0, 14).scale(1, 1, 0.72), 'team');
    yari(k, 2.6);
  },
  // Индустрия (эпоха 1)
  militia1(k) {
    figure(k, { shirt: 'wool', pants: 'coat', shin: 'coat', boot: 'leather2', fore: 'wool' });
    k.add('head', G.cyl(0.108, 0.105, 0.06, 0, 1.73, -0.005, 14).scale(1, 1, 1.05), 'coat'); k.add('head', G.box(0.17, 0.012, 0.08, 0, 1.705, 0.11), 'black');
    k.pair((s, L) => s > 0 && k.add(`arm${L}`, G.cyl(0.064, 0.064, 0.06, s * 0.205, 1.32, 0, 10), 'team'));
    k.add('chest', G.at(G.box(0.05, 0.5, 0.02), [0, 0, 0.6], [0, 1.28, 0.14]), 'leather');
    rifle(k, { len: 1.15, stock: 'wood' });
  },
  infantry1(k) {
    figure(k, { shirt: 'teamDark', pants: 'teamDark', shin: 'khaki2', boot: 'leather2', fore: 'teamDark', belt: 'leather2' });
    // шинель: полы на бёдрах, ходят с шагом
    skirt(k, 'teamDark', 0.62, 0.17, 0.25);
    k.add('chest', G.box(0.32, 0.06, 0.05, 0, 1.47, 0.08), 'teamDark');
    // каска с гребнем и полями
    k.add('head', G.ell(0.122, [1, 0.95, 1.08], 0, 1.715, 0, 16, 7, Math.PI / 2), 'olive2');
    k.add('head', G.cyl(0.168, 0.168, 0.012, 0, 1.715, 0.005, 18).scale(1, 1, 1.12), 'olive2');
    k.add('head', G.box(0.02, 0.04, 0.2, 0, 1.83, 0), 'olive2');
    k.add('chest', G.box(0.36, 0.06, 0.07, 0, 1.06 + 0.02, 0.13), 'leather2'); // подсумки
    k.add('chest', G.at(G.box(0.05, 0.56, 0.02), [0, 0, -0.55], [0.02, 1.28, 0.145]), 'leather2');
    backpack(k, 'khaki2', 0.3, 0.34, 'wool');
    rifle(k, { len: 1.2, stock: 'wood', bay: true });
  },
  // Информационная эпоха (2)
  militia2(k) {
    figure(k, { shirt: 'hood', pants: 'denim', shin: 'denim', boot: 'black', fore: 'hood', hand: 'black' });
    k.add('head', G.ell(0.112, [1, 0.85, 1.05], 0, 1.68, 0, 14, 7, Math.PI / 2), 'team');
    k.add('head', G.at(G.box(0.16, 0.012, 0.1), [-0.1, 0, 0], [0, 1.69, 0.12]), 'team');
    k.add('chest', G.rbox(0.33, 0.22, 0.23, 0, 1.2, 0.03, 0.3), 'khaki2'); // разгрузка
    for (const x of [-0.08, 0, 0.08]) k.add('chest', G.box(0.06, 0.1, 0.04, x, 1.18, 0.15), 'khaki2');
    rifle(k, { len: 0.8, stock: 'wood', mag: true });
  },
  infantry2(k) {
    figure(k, { shirt: 'camo', pants: 'camo', shin: 'camo', boot: 'tan', fore: 'camo2', hand: 'black', knee: 'black', belt: 'black' });
    // плитник с подсумками
    k.add('chest', G.rbox(0.36, 0.34, 0.27, 0, 1.3, 0.0, 0.25), 'camo2');
    for (const x of [-0.1, 0, 0.1]) k.add('chest', G.rbox(0.075, 0.12, 0.05, x, 1.2, 0.14, 0.3), 'camo2');
    k.add('chest', G.box(0.1, 0.06, 0.01, 0.09, 1.38, 0.142), 'team'); // нашивка
    // шлем с ушами, креплением ПНВ и очками
    k.add('head', G.ell(0.125, [1, 0.98, 1.06], 0, 1.69, -0.005, 16, 8, Math.PI * 0.56), 'camo2');
    k.add('head', G.box(0.06, 0.05, 0.03, 0, 1.75, 0.125), 'black');
    k.add('head', G.at(G.box(0.12, 0.035, 0.035), [0.3, 0, 0], [0, 1.775, 0.11]), 'black');
    k.pair((s) => k.add('head', G.rbox(0.03, 0.08, 0.07, s * 0.12, 1.66, 0.0), 'black'));
    k.add('head', G.box(0.17, 0.035, 0.025, 0, 1.66, 0.096), 'black'); // гарнитура/маска
    backpack(k, 'camo2', 0.26, 0.3);
    rifle(k, { len: 0.95, stock: 'black', optic: true, mag: true, color: 'gun' });
  },
  // Космическая эпоха (3)
  militia3(k) { // колониальный ополченец: лёгкий скафандр, круглый шлем со светофильтром, ранец жизнеобеспечения
    figure(k, { shirt: 'ceramic', pants: 'ceramic', shin: 'carbon', boot: 'carbon', fore: 'ceramic', hand: 'carbon', knee: 'carbon', belt: 'carbon', hair: false });
    k.add('chest', G.rbox(0.34, 0.2, 0.24, 0, 1.36, 0.01, 0.3), 'ceramic'); // жёсткий нагрудник скафандра
    k.add('chest', G.box(0.16, 0.06, 0.02, 0.06, 1.36, 0.13), 'team'); // нашивка
    k.add('chest', G.cyl(0.14, 0.15, 0.06, 0, 1.5, 0, 16).scale(1, 1, 0.9), 'carbon'); // шейное кольцо шлема
    k.add('head', G.sph(0.145, 0, 1.67, 0.0, 18, 14), 'ceramic'); // круглый шлем скафандра
    k.add('head', G.ell(0.12, [1, 0.74, 0.6], 0, 1.665, 0.088, 18, 12), 'gold'); // золочёный светофильтр
    k.add('head', G.cyl(0.022, 0.022, 0.06, 0, 0, 0, 8).rotateZ(Math.PI / 2).translate(-0.15, 1.66, -0.01), 'carbon'); // разъём связи
    k.add('head', G.box(0.04, 0.03, 0.03, 0.11, 1.74, 0.06), 'glow'); // налобный фонарь
    k.pair((s, L) => k.add(`arm${L}`, G.cyl(0.07, 0.07, 0.07, s * 0.205, 1.3, 0, 12), s > 0 ? 'team' : 'carbon')); // повязка нации
    k.add('chest', G.rbox(0.3, 0.38, 0.16, 0, 1.3, -0.21, 0.3), 'ceramic'); // ранец жизнеобеспечения
    k.pair((s) => k.add('chest', G.cyl(0.05, 0.05, 0.34, s * 0.09, 1.3, -0.31, 12), 'carbon')); // баллоны
    k.add('chest', G.seg([0.12, 1.42, -0.16], [0.13, 1.56, -0.04], 0.018, 0.018, 6), 'carbon'); // шланг к шлему
    k.add('hips', G.box(0.3, 0.05, 0.1, 0, 1.0, 0.12), 'carbon'); // пояс с подсумками
    rifle(k, { len: 0.8, stock: 'carbon', color: 'ceramic', glow: true, mag: true });
  },
  infantry3(k) {
    figure(k, { shirt: 'armor', pants: 'armor2', shin: 'armor', boot: 'armor2', fore: 'armor', hand: 'dark', knee: 'armor2', belt: 'dark', hair: false, wide: 0.012 });
    // экзоброня: кираса, наплечники, гермошлем с визором, силовой ранец со свечением
    k.add('chest', G.rbox(0.38, 0.32, 0.28, 0, 1.32, 0.0, 0.25), 'armor');
    k.add('chest', G.box(0.2, 0.05, 0.02, 0, 1.36, 0.155), 'team');
    k.pair((s, L) => { k.add(`arm${L}`, G.ell(0.085, [1, 0.85, 1.1], s * 0.225, 1.43, 0, 12, 8, Math.PI * 0.6), 'teamMid'); k.add(`fore${L}`, G.rbox(0.07, 0.2, 0.08, s * 0.222, 1.03, 0.005, 0.3), 'armor2'); });
    k.pair((s, L) => k.add(`shin${L}`, G.rbox(0.085, 0.28, 0.09, s * 0.101, 0.3, 0.02, 0.3), 'armor'));
    k.add('head', G.ell(0.132, [1, 1.05, 1.1], 0, 1.665, 0.0, 18, 12), 'armor');
    k.add('head', G.ell(0.1, [1, 0.5, 0.6], 0, 1.67, 0.088, 16, 8), 'visor');
    k.add('chest', G.rbox(0.26, 0.3, 0.14, 0, 1.3, -0.22, 0.3), 'armor2');
    k.pair((s) => k.add('chest', G.cyl(0.035, 0.035, 0.26, s * 0.08, 1.3, -0.3, 10), 'glow'));
    rifle(k, { len: 1.0, stock: 'armor2', color: 'armor2', glow: true, optic: true });
  },
};

// ---------- техника ----------
/** Техника: части на узлах (body / hover / turret / barrel / rotor / tail / prop). */
const NODE_ORDER = ['body', 'hover', 'turret', 'barrel', 'rotor', 'tail', 'prop'];
function machine(name, build, clips = {}, opts = {}) {
  const k = new Kit(); build(k);
  const scene = new THREE.Group(); scene.name = name; const nodes = { body: scene };
  const PIVOT = { body: [0, 0, 0], ...opts.pivots };
  const parentOf = (n) => opts.parent?.[n] ?? 'body';
  let tris = 0;
  for (const n of NODE_ORDER) {
    const parts = k.parts.filter((p) => p.at === n); if (!parts.length && n !== 'hover') continue;
    const pv = PIVOT[n] ?? [0, 0, 0];
    let node = scene;
    if (n !== 'body') {
      node = new THREE.Object3D(); node.name = n;
      const pp = PIVOT[parentOf(n)] ?? [0, 0, 0]; node.position.set(pv[0] - pp[0], pv[1] - pp[1], pv[2] - pp[2]);
      (nodes[parentOf(n)] ?? scene).add(node); nodes[n] = node;
    }
    if (!parts.length) continue;
    const geo = bake(parts, { aoFoot: false }); geo.translate(-pv[0], -pv[1], -pv[2]);
    tris += geo.index.count / 3;
    const mesh = new THREE.Mesh(geo, forgeMaterial()); mesh.name = `${n}_mesh`; mesh.castShadow = true; mesh.receiveShadow = true;
    node.add(mesh);
  }
  const animations = ['idle', 'walk', 'run', 'attack'].map((cn) => {
    const fn = clips[cn] ?? clips.idle; const clip = new THREE.AnimationClip(cn, -1, fn ? fn(nodes) : []);
    if (clip.tracks.length) clip.resetDuration(); else clip.duration = 1;
    return clip;
  });
  return { scene, animations, kind: opts.kind ?? 'vehicle', tris };
}
const spin = (node, axis, speed, len = 1) => { const q = new THREE.Quaternion(); const a = new THREE.Vector3(...axis); const v = []; const t = []; for (let i = 0; i <= 8; i += 1) { q.setFromAxisAngle(a, (i / 8) * Math.PI * 2 * Math.sign(speed)); v.push(q.x, q.y, q.z, q.w); t.push((i / 8) * len / Math.abs(speed)); } return new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, t, v); };
/** Откат ствола вдоль его оси axis (для поднятого ствола ось наклонена). */
const recoil = (node, p, dz, len = 1.2, axis = [0, 0, 1]) => new THREE.VectorKeyframeTrack(`${node}.position`, [0, 0.06, 0.5, len], [...p, p[0] - axis[0] * dz, p[1] - axis[1] * dz, p[2] - axis[2] * dz, ...p, ...p]);
const bob = (node, y0, a, len) => new THREE.VectorKeyframeTrack(`${node}.position`, [0, len / 2, len], [0, y0, 0, 0, y0 + a, 0, 0, y0, 0]);

/** Гусеница: лента-стадион с катками и ленивцем. */
function tracks(k, { len, h, w, x, wheels = 5, r = 0.36, c = 'olive', skirt = false }) {
  k.pair((s) => {
    const sh = new THREE.Shape(); const R = h / 2; sh.moveTo(-len / 2 + R, 0); sh.lineTo(len / 2 - R, 0); sh.absarc(len / 2 - R, R, R, -Math.PI / 2, Math.PI / 2); sh.lineTo(-len / 2 + R, h); sh.absarc(-len / 2 + R, R, R, Math.PI / 2, Math.PI * 1.5);
    k.add('body', new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false, curveSegments: 8 }).rotateY(-Math.PI / 2).translate(s * x + w / 2, 0, 0), 'rubber');
    for (let i = 0; i < wheels; i += 1) k.add('body', G.cyl(r, r, w + 0.04, 0, 0, 0, 14).rotateZ(Math.PI / 2).translate(s * x, r + 0.05, -len / 2 + h / 2 + 0.25 + (i * (len - h - 0.5)) / (wheels - 1)), 'dark');
    // траки: грунтозацепы по верхней и нижней ветви
    const n = Math.round(len / 0.32);
    for (let i = 0; i < n; i += 1) { const z = -len / 2 + h / 2 + (i * (len - h)) / (n - 1); k.add('body', G.box(w + 0.03, 0.04, 0.08, s * x, h + 0.01, z), 'dark'); k.add('body', G.box(w + 0.03, 0.04, 0.08, s * x, -0.01, z), 'dark'); }
    for (const z of [-1, 1]) k.add('body', G.cyl(h * 0.32, h * 0.32, w + 0.08, 0, 0, 0, 12).rotateZ(Math.PI / 2).translate(s * x, h / 2, z * (len / 2 - h / 2)), 'iron');
    if (skirt) k.add('body', G.box(0.06, h * 0.55, len * 0.86, s * (x + w / 2 + 0.05), h * 0.62, 0.1), c);
  });
}
const VEHICLE = {
  tank1: () => machine('tank1', (k) => { // Индустрия: клёпаный средний танк, литая башня, короткая пушка
    tracks(k, { len: 5.8, h: 1.0, w: 0.5, x: 1.3, wheels: 5, r: 0.4 });
    k.add('body', G.side([[-2.8, 0.55], [2.2, 0.55], [2.95, 1.0], [2.0, 1.55], [-2.6, 1.6], [-2.95, 1.1]], 2.3), 'olive');
    k.add('body', G.box(2.4, 0.06, 5.6, 0, 1.08, 0), 'olive2');
    for (const z of [-2, -1, 0, 1, 2]) k.add('body', G.box(2.32, 0.03, 0.03, 0, 1.58, z * 0.5), 'olive2');
    k.pair((s) => k.add('body', G.box(0.04, 0.5, 4.4, s * 1.17, 1.25, -0.1), 'team'));
    k.add('body', G.cyl(0.12, 0.12, 0.7, 0, 0, 0, 8).rotateZ(Math.PI / 2).translate(0.6, 1.6, -2.6), 'dark');
    k.add('turret', G.ell(1.0, [1, 0.62, 1.15], 0, 1.6, -0.15, 18, 8, Math.PI / 2), 'olive');
    k.add('turret', G.cyl(0.32, 0.36, 0.2, 0.35, 2.25, -0.4, 12), 'olive2');
    k.add('turret', G.rbox(0.7, 0.5, 0.4, 0, 2.0, 0.95, 0.4), 'olive2');
    k.add('turret', G.box(1.2, 0.04, 0.05, 0, 2.15, -1.15), 'team');
    k.add('barrel', G.cyl(0.09, 0.11, 2.4, 0, 0, 0, 12).rotateX(Math.PI / 2).translate(0, 2.0, 2.3), 'gun');
    k.add('barrel', G.rbox(0.42, 0.36, 0.3, 0, 2.0, 1.25, 0.4), 'olive2'); // маска пушки
    k.add('turret', G.cyl(0.3, 0.3, 0.06, -0.35, 2.33, -0.5, 12), 'olive2'); // люк
    for (const x of [-0.9, -0.45, 0, 0.45, 0.9]) for (const z of [2.25, -2.5]) k.add('body', G.sph(0.035, x, 1.42, z, 6, 4), 'iron'); // заклёпки
    k.add('body', G.cyl(0.12, 0.14, 0.18, 0, 0, 0, 10).rotateX(Math.PI / 2).translate(0.55, 1.22, 2.55), 'olive2'); k.add('body', G.cyl(0.025, 0.025, 0.5, 0, 0, 0, 6).rotateX(Math.PI / 2).translate(0.55, 1.22, 2.8), 'gun'); // курсовой пулемёт
    k.add('body', G.box(0.08, 0.08, 1.6, -0.85, 1.64, -0.6), 'wood'); k.add('body', G.box(0.25, 0.04, 0.5, -0.85, 1.64, 0.4), 'iron'); // лопата и лом
  }, { attack: () => [recoil('barrel', [0, 0, 0], 0.4)] }, { parent: { barrel: 'turret' }, pivots: { turret: [0, 0, 0], barrel: [0, 0, 0] } }),
  tank2: () => machine('tank2', (k) => { // Информационная эпоха: основной боевой танк, клиновидная башня, динамзащита
    tracks(k, { len: 7.0, h: 0.95, w: 0.62, x: 1.5, wheels: 7, r: 0.36, c: 'camo', skirt: true });
    k.add('body', G.side([[-3.4, 0.55], [2.9, 0.55], [3.6, 0.95], [2.9, 1.35], [-3.3, 1.45], [-3.5, 1.0]], 2.7), 'camo');
    k.add('body', G.box(3.6, 0.05, 6.8, 0, 1.0, 0), 'camo2');
    k.add('turret', G.plan([[-1.1, -1.6], [1.1, -1.6], [1.35, 0.3], [0.5, 1.6], [-0.5, 1.6], [-1.35, 0.3]], 0.72, 1.42), 'camo');
    k.add('turret', G.plan([[-0.95, -1.4], [0.95, -1.4], [1.15, 0.25], [0.42, 1.35], [-0.42, 1.35], [-1.15, 0.25]], 0.12, 2.17), 'camo2');
    k.add('turret', G.cyl(0.32, 0.36, 0.28, -0.5, 2.45, -0.45, 12), 'camo'); k.add('turret', G.cyl(0.3, 0.3, 0.05, -0.5, 2.61, -0.45, 12), 'camo2'); // командирская башенка
    k.add('turret', G.box(0.08, 0.1, 0.9, -0.5, 2.75, 0.0), 'gun'); k.add('turret', G.box(0.18, 0.2, 0.25, -0.5, 2.72, -0.35), 'gun'); // зенитный пулемёт
    k.pair((s) => { for (let i = 0; i < 3; i += 1) k.add('turret', G.at(G.cyl(0.055, 0.055, 0.3, 0, 0, 0, 8), [-0.6, 0, s * 0.3], [s * (1.05 + i * 0.08), 2.12, 0.55 - i * 0.12]), 'gun'); }); // дымовые гранатомёты
    for (let i = 0; i < 4; i += 1) k.add('turret', G.box(1.9, 0.04, 0.04, 0, 1.6 + i * 0.12, -1.95), 'gun'); // корзина на корме башни
    k.add('turret', G.cyl(0.015, 0.012, 2.2, 0.75, 3.2, -1.3, 4), 'black'); // антенна
    k.add('body', G.side([[2.9, 1.35], [3.6, 0.95], [3.62, 0.9], [2.85, 1.42]], 2.6), 'camo2'); // кромка лобового листа
    for (const x of [-1.0, 1.0]) k.add('body', G.cyl(0.18, 0.18, 0.08, 0, 0, 0, 10).rotateX(Math.PI / 2).translate(x, 1.1, 3.52), 'gun'); // фары
    for (let i = 0; i < 3; i += 1) k.pair((s) => k.add('turret', G.at(G.box(0.5, 0.22, 0.32), [0, s * 0.62, 0], [s * (0.85 - i * 0.22), 2.2, 1.15 - i * 0.32]), 'camo2'));
    k.add('turret', G.rbox(0.45, 0.35, 0.5, 0.55, 2.3, -0.6, 0.3), 'camo2');
    k.add('turret', G.box(0.9, 0.25, 0.5, 0, 2.0, -1.75), 'camo2');
    k.add('turret', G.box(1.5, 0.05, 0.08, 0, 2.14, -1.4), 'team');
    k.add('barrel', G.cyl(0.08, 0.1, 5.0, 0, 0, 0, 12).rotateX(Math.PI / 2).translate(0, 1.85, 4.0), 'gun');
    k.add('barrel', G.cyl(0.14, 0.14, 0.6, 0, 0, 0, 12).rotateX(Math.PI / 2).translate(0, 1.85, 3.5), 'gun');
  }, { attack: () => [recoil('barrel', [0, 0, 0], 0.55)] }, { parent: { barrel: 'turret' } }),
  tank3: () => machine('tank3', (k) => { // Космическая эпоха: рельсотронный танк, гранёная керамическая броня, необитаемая башня
    tracks(k, { len: 7.2, h: 0.9, w: 0.66, x: 1.55, wheels: 6, r: 0.34, c: 'carbon' });
    k.pair((s) => { // гранёные надгусеничные экраны со светящейся полосой
      k.add('body', G.side([[-3.7, 0.5], [3.3, 0.5], [3.75, 0.95], [3.4, 1.2], [-3.5, 1.2], [-3.75, 0.85]], 0.1, s * 1.93), 'ceramic');
      k.add('body', G.box(0.03, 0.06, 5.6, s * 1.99, 0.72, -0.1), 'glow');
      k.add('body', G.box(0.03, 0.12, 2.2, s * 1.99, 0.98, -1.2), 'team');
    });
    k.add('body', G.side([[-3.6, 0.6], [3.0, 0.6], [3.85, 0.95], [3.1, 1.45], [-3.2, 1.55], [-3.65, 1.05]], 3.6), 'ceramic'); // корпус: острый клин лба
    k.add('body', G.plan([[-1.7, -3.2], [1.7, -3.2], [1.75, 2.6], [0.9, 3.05], [-0.9, 3.05], [-1.75, 2.6]], 0.06, 1.52), 'carbon'); // крыша корпуса
    for (const x of [-0.9, 0.9]) k.add('body', G.box(0.5, 0.04, 0.5, x, 1.6, 2.4), 'armor2'); // лючки датчиков
    k.add('body', G.box(2.0, 0.22, 0.12, 0, 1.22, -3.6), 'carbon'); k.pair((s) => k.add('body', G.box(0.5, 0.16, 0.06, s * 0.7, 1.22, -3.66), 'glow')); // кормовые теплообменники
    // необитаемая башня: низкий шестигранник с наклонными гранями
    k.add('turret', G.plan([[-1.25, -1.7], [1.25, -1.7], [1.5, 0.2], [0.75, 1.55], [-0.75, 1.55], [-1.5, 0.2]], 0.5, 1.6), 'ceramic');
    k.add('turret', G.plan([[-1.05, -1.5], [1.05, -1.5], [1.25, 0.15], [0.6, 1.3], [-0.6, 1.3], [-1.25, 0.15]], 0.12, 2.1), 'armor2');
    k.add('turret', G.box(1.8, 0.06, 0.08, 0, 2.0, -1.72), 'team');
    k.pair((s) => { for (let i = 0; i < 2; i += 1) k.add('turret', G.at(G.cyl(0.11, 0.11, 0.18, 0, 0, 0, 10), [0, 0, s * Math.PI / 2], [s * 1.42, 1.86, -0.9 + i * 0.5]), 'carbon'); }); // модули активной защиты
    k.add('turret', G.cyl(0.04, 0.04, 0.7, 0.8, 2.55, -1.1, 6), 'carbon'); k.add('turret', G.sph(0.13, 0.8, 2.95, -1.1, 12, 8), 'dark'); k.add('turret', G.box(0.12, 0.06, 0.04, 0.8, 2.95, -0.98), 'glow'); // мачта с обзорным шаром
    // рельсотрон: две шины с разрядником между ними и медные катушки
    k.pair((s) => k.add('barrel', G.box(0.2, 0.3, 5.4, s * 0.2, 1.88, 3.7), 'armor2'));
    k.add('barrel', G.box(0.12, 0.06, 5.2, 0, 1.88, 3.8), 'glow');
    for (let i = 0; i < 5; i += 1) k.add('barrel', G.box(0.72, 0.5, 0.2, 0, 1.88, 1.9 + i * 0.85), 'coil');
    k.add('barrel', G.rbox(0.66, 0.46, 0.5, 0, 1.88, 6.5, 0.4), 'carbon'); // дульный блок
    k.add('barrel', G.rbox(0.9, 0.62, 1.0, 0, 1.88, 1.4, 0.3), 'ceramic'); // маска
  }, { attack: () => [recoil('barrel', [0, 0, 0], 0.35)] }, { parent: { barrel: 'turret' } }),
  gun3: () => machine('gun3', (k) => { // Космическая эпоха: самоходная рельсовая батарея на колёсном шасси 6×6
    k.pair((s) => { for (const z of [-1.9, -0.5, 1.9]) {
      k.add('body', G.cyl(0.58, 0.58, 0.5, 0, 0, 0, 20).rotateZ(Math.PI / 2).translate(s * 1.35, 0.58, z), 'rubber');
      k.add('body', G.cyl(0.32, 0.32, 0.52, 0, 0, 0, 12).rotateZ(Math.PI / 2).translate(s * 1.35, 0.58, z), 'carbon');
      k.add('body', G.cyl(0.08, 0.08, 0.54, 0, 0, 0, 8).rotateZ(Math.PI / 2).translate(s * 1.35, 0.58, z), 'glow');
    } });
    k.add('body', G.side([[-3.2, 0.7], [2.4, 0.7], [2.9, 1.1], [2.7, 1.45], [-3.1, 1.45]], 2.3), 'ceramic'); // рама-корпус
    k.add('body', G.side([[1.4, 1.45], [2.7, 1.45], [2.4, 2.35], [1.5, 2.45]], 2.2), 'ceramic'); // кабина
    k.add('body', G.side([[1.95, 1.75], [2.55, 1.6], [2.33, 2.22], [1.98, 2.28]], 2.24), 'glass'); // остекление
    k.pair((s) => { k.add('body', G.box(0.06, 0.5, 2.6, s * 1.18, 1.15, -1.2), 'team'); k.add('body', G.box(0.16, 0.9, 0.16, s * 1.05, 0.55, -3.05), 'carbon'); k.add('body', G.box(0.42, 0.06, 0.42, s * 1.05, 0.03, -3.05), 'carbon'); }); // борта и выдвижные опоры
    for (let i = 0; i < 3; i += 1) { k.add('body', G.box(1.8, 0.4, 0.5, 0, 1.68, -2.6 + i * 0.6), 'carbon'); k.add('body', G.box(1.82, 0.05, 0.08, 0, 1.9, -2.6 + i * 0.6), 'glow'); } // накопители
    k.add('turret', G.cyl(0.85, 0.95, 0.3, 0, 1.6, -0.5, 18), 'armor2'); // поворотный круг
    k.add('turret', G.side([[-1.3, 1.75], [0.9, 1.75], [0.6, 2.45], [-1.2, 2.5]], 1.3), 'ceramic'); // люлька
    k.pair((s) => k.add('barrel', G.box(0.12, 0.18, 5.6, s * 0.15, 0, 0).rotateX(-0.42).translate(0, 2.55, 1.3), 'armor2'));
    k.add('barrel', G.box(0.1, 0.05, 5.4, 0, 0, 0).rotateX(-0.42).translate(0, 2.55, 1.3), 'glow');
    for (let i = 0; i < 5; i += 1) k.add('barrel', G.box(0.5, 0.32, 0.14, 0, 0, -1.8 + i * 0.95).rotateX(-0.42).translate(0, 2.55, 1.3), 'coil');
  }, { attack: () => [recoil('barrel', [0, 0, 0], 0.5, 2.0, [0, Math.sin(0.42), Math.cos(0.42)])] }, { parent: { barrel: 'turret' }, pivots: { turret: [0, 1.6, -0.5], barrel: [0, 1.6, -0.5] } }),
  gun1: () => machine('gun1', (k) => { // полевое орудие на деревянных колёсах + расчёт
    k.pair((s) => {
      k.add('body', G.torus(0.62, 0.06, Math.PI * 2, 6, 22).rotateY(Math.PI / 2).translate(s * 0.85, 0.64, 0), 'darkwood');
      for (let i = 0; i < 6; i += 1) k.add('body', G.box(0.04, 1.18, 0.05, 0, 0, 0).rotateX((i / 6) * Math.PI).translate(s * 0.85, 0.64, 0), 'wood');
      k.add('body', G.cyl(0.1, 0.1, 0.22, 0, 0, 0, 10).rotateZ(Math.PI / 2).translate(s * 0.85, 0.64, 0), 'iron');
      k.add('body', G.at(G.box(0.12, 0.12, 2.6), [0, s * 0.12, 0], [s * 0.45, 0.35, -1.35]), 'olive');
    });
    k.add('body', G.at(G.box(1.6, 0.85, 0.05), [-0.12, 0, 0], [0, 1.1, 0.3]), 'olive'); k.add('body', G.box(1.6, 0.1, 0.07, 0, 1.53, 0.25), 'team');
    k.add('body', G.box(0.5, 0.3, 0.8, 0, 0.8, 0), 'olive');
    k.add('barrel', G.cyl(0.08, 0.12, 2.6, 0, 0, 0, 12).rotateX(Math.PI / 2 - 0.12).translate(0, 1.02, 1.0), 'gun');
    k.add('barrel', G.cyl(0.075, 0.075, 1.4, 0, 0, 0, 10).rotateX(Math.PI / 2 - 0.12).translate(0, 0.86, 0.3), 'olive2');
    crew(k, OUTFIT.infantry1, [[-1.3, -1.0, 0.5, 'load'], [1.2, -1.4, -0.4, 'kneel'], [0.3, -2.5, 0, 'stand']]);
  }, { attack: () => [recoil('barrel', [0, 0, 0], 0.5, 2.0)] }),
  gun2: () => machine('gun2', (k) => { // буксируемая гаубица на резиновом ходу
    k.pair((s) => {
      k.add('body', G.cyl(0.55, 0.55, 0.35, 0, 0, 0, 18).rotateZ(Math.PI / 2).translate(s * 1.0, 0.55, 0), 'rubber');
      k.add('body', G.cyl(0.3, 0.3, 0.37, 0, 0, 0, 12).rotateZ(Math.PI / 2).translate(s * 1.0, 0.55, 0), 'camo2');
      k.add('body', G.at(G.box(0.16, 0.16, 3.4), [0, s * 0.18, 0], [s * 0.55, 0.3, -1.8]), 'camo');
    });
    k.add('body', G.at(G.box(1.7, 0.7, 0.06), [-0.15, 0, 0], [0, 1.15, 0.5]), 'camo'); k.add('body', G.box(1.7, 0.08, 0.08, 0, 1.5, 0.45), 'team');
    k.add('body', G.rbox(0.7, 0.45, 1.2, 0, 0.95, 0, 0.3), 'camo');
    k.add('barrel', G.cyl(0.09, 0.11, 4.6, 0, 0, 0, 12).rotateX(Math.PI / 2 - 0.2).translate(0, 1.4, 1.9), 'gun');
    k.add('barrel', G.cyl(0.16, 0.16, 0.4, 0, 0, 0, 12).rotateX(Math.PI / 2 - 0.2).translate(0, 1.84, 4.1), 'gun');
    crew(k, OUTFIT.infantry2, [[-1.4, -1.2, 0.5, 'load'], [1.3, -1.6, -0.4, 'kneel'], [0.2, -2.8, 0, 'stand']]);
  }, { attack: () => [recoil('barrel', [0, 0, 0], 0.7, 2.0)] }),
  helicopter: () => machine('helicopter', (k) => { // ударный вертолёт: тандемная кабина, крылья с блоками НУР
    k.add('body', new THREE.CapsuleGeometry(0.75, 3.2, 8, 14).rotateX(Math.PI / 2).scale(0.75, 1, 1), 'olive');
    k.add('body', G.ell(0.62, [0.85, 0.85, 1.9], 0, 0.35, 1.0, 14, 10), 'glass');
    k.add('body', G.seg([0, 0.3, -1.8], [0, 0.55, -6.2], 0.4, 0.14), 'olive');
    k.add('body', G.at(G.box(0.08, 1.2, 0.85), [-0.3, 0, 0], [0, 1.0, -6.1]), 'olive'); k.add('body', G.box(1.6, 0.06, 0.45, 0, 0.55, -5.6), 'olive');
    k.add('body', G.box(0.09, 0.5, 0.5, 0, 1.1, -6.3), 'team');
    k.pair((s) => { k.add('body', G.box(1.3, 0.08, 0.6, s * 1.05, -0.15, -0.2), 'olive2'); k.add('body', G.cyl(0.16, 0.16, 1.3, 0, 0, 0, 10).rotateX(Math.PI / 2).translate(s * 1.5, -0.35, 0), 'dark'); k.add('body', G.seg([s * 0.5, -0.8, 1.0], [s * 0.5, -0.8, -1.4], 0.05, 0.05, 6), 'dark'); });
    k.add('body', G.cyl(0.28, 0.32, 0.5, 0, 0.95, -0.2, 12), 'olive2');
    k.add('body', G.ell(0.42, [0.8, 0.75, 1.4], 0, 0.55, 2.0, 12, 8), 'glass'); // передняя кабина оператора (тандем)
    k.pair((s) => { k.add('body', G.lathe([[0, -1.1], [0.32, -0.9], [0.34, 0.6], [0.24, 0.9], [0, 0.95]], 1, 12).rotateX(Math.PI / 2).translate(s * 0.62, 0.62, -0.5), 'olive2'); k.add('body', G.cyl(0.2, 0.2, 0.04, 0, 0, 0, 10).rotateX(Math.PI / 2).translate(s * 0.62, 0.62, -1.6), 'black'); }); // двигатели
    k.add('body', G.ell(0.18, [1, 1, 1], 0, -0.6, 2.4, 10, 8), 'dark'); k.add('body', G.cyl(0.03, 0.03, 0.9, 0, 0, 0, 6).rotateX(Math.PI / 2).translate(0, -0.7, 2.9), 'gun'); // подбородочная пушка
    k.add('body', G.cyl(0.08, 0.08, 0.35, 0, 1.3, -0.2, 8), 'dark'); k.add('body', G.ell(0.16, [1, 0.6, 1], 0, 1.52, -0.2, 10, 6), 'dark'); // вал и надвтулочная РЛС
    k.add('rotor', G.box(12, 0.05, 0.35, 0, 1.25, -0.2), 'dark'); k.add('rotor', G.box(0.35, 0.05, 12, 0, 1.25, -0.2), 'dark');
    k.add('tail', G.box(0.05, 1.8, 0.18, 0.18, 1.05, -6.15), 'dark'); k.add('tail', G.box(0.05, 0.18, 1.8, 0.18, 1.05, -6.15), 'dark');
  }, Object.fromEntries(['idle', 'walk', 'run', 'attack'].map((c) => [c, () => [spin('rotor', [0, 1, 0], 4, 1), spin('tail', [1, 0, 0], 8, 1)]])), { kind: 'air', pivots: { rotor: [0, 0, -0.2], tail: [0.18, 1.05, -6.15] }, aoFoot: false }),
  drone: () => machine('drone', (k) => { // ударный БПЛА: цельный фюзеляж с горбом спутниковой антенны, длинное сужающееся крыло, V-хвост, толкающий винт
    k.add('body', G.lathe([[0.0, -2.75], [0.16, -2.68], [0.26, -2.3], [0.33, -1.2], [0.37, 0.2], [0.42, 1.3], [0.47, 1.95], [0.43, 2.45], [0.3, 2.8], [0.12, 2.98], [0.0, 3.02]], 1, 18).rotateX(Math.PI / 2).scale(1, 0.82, 1), 'armor2'); // фюзеляж одной деталью: без шва на носу
    k.add('body', G.ell(0.34, [1, 0.55, 1.6], 0, 0.2, 1.75, 16, 8, Math.PI * 0.5), 'armor2'); // горб антенны спутниковой связи
    k.add('body', G.ell(0.17, [1, 1, 1], 0, -0.36, 2.05, 14, 10), 'dark'); k.add('body', G.ell(0.07, [1, 1, 0.6], 0, -0.38, 2.2, 10, 8), 'glass'); // шар оптико-электронной станции
    k.add('body', G.plan([[0.0, 0.7], [7.0, 0.38], [7.0, 0.02], [0.0, -0.32], [-7.0, 0.02], [-7.0, 0.38]], 0.07, 0.04), 'armor2'); // крыло с сужением к концам
    k.pair((s) => k.add('body', G.box(1.6, 0.08, 0.38, s * 6.25, 0.06, 0.2), 'team'));
    k.pair((s) => k.add('body', G.plan([[-0.65, 0.36], [0.65, 0.18], [0.65, -0.16], [-0.65, -0.34]], 0.05, -0.025).rotateZ(Math.PI / 2 - s * 0.82).translate(s * 0.44, 0.5, -2.25), 'armor2')); // V-хвост, сужается к концам
    k.pair((s) => { for (const x of [2.0, 3.3]) { k.add('body', G.box(0.04, 0.16, 0.3, s * x, -0.08, 0.25), 'dark'); k.add('body', G.cyl(0.07, 0.07, 1.1, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(s * x, -0.24, 0.2), 'white'); k.add('body', G.cone(0.07, 0.22, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(s * x, -0.24, 0.86), 'white'); } }); // подвески с ракетами
    k.add('body', G.cyl(0.12, 0.16, 0.25, 0, 0, 0, 12).rotateX(Math.PI / 2).translate(0, 0, -2.82), 'dark'); // втулка винта
    k.add('prop', G.box(1.7, 0.05, 0.14, 0, 0, -2.98), 'dark'); k.add('prop', G.box(0.14, 1.7, 0.05, 0, 0, -2.98).rotateZ(0), 'dark'); k.add('prop', G.cone(0.1, 0.22, 0, 0, 0, 10).rotateX(-Math.PI / 2).translate(0, 0, -3.08), 'armor2');
  }, Object.fromEntries(['idle', 'walk', 'run', 'attack'].map((c) => [c, () => [spin('prop', [0, 0, 1], 6, 1)]])), { kind: 'air', pivots: { prop: [0, 0, -2.98] }, aoFoot: false }),
  fighter: () => machine('fighter', (k) => { // реактивный истребитель: стреловидное крыло, два киля
    k.add('body', G.lathe([[0.0, -4.9], [0.55, -4.85], [0.68, -3.5], [0.7, 0.5], [0.6, 2.4], [0.42, 3.6], [0.18, 4.6], [0.0, 5.0]], 1, 16).rotateX(Math.PI / 2).scale(1, 0.85, 1), 'armor2'); // фюзеляж-«сигара» с плавным носом
    k.add('body', G.cone(0.05, 0.6, 0, 0, 0, 6).rotateX(Math.PI / 2).translate(0, 0, 5.25), 'dark'); // ПВД
    k.add('body', G.ell(0.42, [0.75, 0.7, 2.2], 0, 0.5, 2.5, 14, 10), 'glass');
    k.add('body', G.ell(0.44, [0.8, 0.5, 2.6], 0, 0.36, 1.2, 12, 8), 'armor2'); // гаргрот за кабиной
    k.pair((s) => { k.add('body', G.box(0.42, 0.62, 2.6, s * 0.78, -0.12, 0.6), 'armor2'); k.add('body', G.box(0.44, 0.5, 0.06, s * 0.78, -0.12, 1.92), 'black'); }); // воздухозаборники
    k.pair((s) => { for (const x of [2.4, 4.0]) { k.add('body', G.cyl(0.09, 0.09, 2.2, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(s * x, -0.32, -0.6), 'white'); k.add('body', G.cone(0.09, 0.3, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(s * x, -0.32, 0.65), 'white'); } }); // ракеты под крылом
    k.add('body', G.plan([[0, 2.2], [5.2, -1.8], [5.2, -2.6], [0, -2.4], [-5.2, -2.6], [-5.2, -1.8]], 0.1, -0.1), 'armor2');
    k.pair((s) => { k.add('body', G.at(G.box(0.08, 1.8, 1.3), [0, 0, -s * 0.3], [s * 0.85, 1.0, -3.9]), 'armor2'); k.add('body', G.box(1.5, 0.08, 0.6, s * 4.4, -0.06, -2.2), 'team'); });
    k.add('body', G.cyl(0.5, 0.42, 0.7, 0, 0, 0, 14, true).rotateX(Math.PI / 2).translate(0, 0, -5.1), 'iron'); k.add('body', G.cyl(0.36, 0.36, 0.05, 0, 0, 0, 12).rotateX(Math.PI / 2).translate(0, 0, -5.0), 'glow'); // сопло с форсажем
  }, {}, { kind: 'air', aoFoot: false }),
  fighter3: () => machine('fighter3', (k) => { // Космическая эпоха: аэрокосмический перехватчик, несущий корпус и треугольное крыло
    k.add('body', G.lathe([[0.0, -4.6], [0.7, -4.5], [0.95, -3.0], [1.0, 0.0], [0.8, 2.4], [0.45, 4.2], [0.14, 5.4], [0.0, 5.7]], 1, 20).rotateX(Math.PI / 2).scale(1.15, 0.5, 1), 'ceramic'); // сплющенный несущий фюзеляж
    k.add('body', G.plan([[0.0, 4.6], [0.9, 3.4], [1.3, 0.2], [0.0, 0.4], [-1.3, 0.2], [-0.9, 3.4]], 0.08, -0.04), 'ceramic'); // наплывы-«щёки»
    k.add('body', G.plan([[0.0, 1.6], [1.2, 1.2], [6.2, -3.1], [6.2, -3.7], [1.0, -4.3], [-1.0, -4.3], [-6.2, -3.7], [-6.2, -3.1], [-1.2, 1.2]], 0.1, -0.08), 'ceramic'); // треугольное крыло
    k.pair((s) => k.add('body', G.plan([[s * 5.2, -2.7], [s * 6.2, -3.15], [s * 6.2, -3.7], [s * 5.1, -3.5]], 0.11, -0.075), 'team')); // законцовки цвета нации
    k.add('body', G.plan([[0.0, -0.2], [0.9, -0.6], [0.9, -4.3], [-0.9, -4.3], [-0.9, -0.6]], 0.06, -0.12), 'carbon'); // термозащита снизу
    k.add('body', G.ell(0.36, [0.9, 0.55, 2.4], 0, 0.36, 2.6, 16, 10, Math.PI * 0.5), 'gold'); // кабина со светофильтром
    k.pair((s) => k.add('body', G.at(G.plan([[-0.75, 0.5], [0.75, 0.15], [0.75, -0.35], [-0.75, -0.6]], 0.06, -0.03), [0, 0, Math.PI / 2 - s * 0.45], [s * 1.0, 0.85, -3.6]), 'ceramic')); // разнесённые кили
    k.pair((s) => { k.add('body', G.cyl(0.42, 0.36, 0.9, 0, 0, 0, 16, true).rotateX(Math.PI / 2).translate(s * 0.5, -0.02, -4.8), 'carbon'); k.add('body', G.cyl(0.32, 0.32, 0.05, 0, 0, 0, 14).rotateX(Math.PI / 2).translate(s * 0.5, -0.02, -4.75), 'glow'); }); // два сопла
    k.pair((s) => k.add('body', G.box(0.03, 0.05, 2.4, s * 3.6, -0.02, -2.6), 'glow')); // навигационные полосы
  }, {}, { kind: 'air', aoFoot: false }),
  biplane: () => machine('biplane', (k) => { // Индустрия: биплан с расчалками
    k.add('body', G.seg([0, 0, -3.6], [0, 0.05, 2.0], 0.22, 0.55, 12), 'khaki');
    k.add('body', G.cyl(0.58, 0.55, 0.5, 0, 0, 0, 14).rotateX(Math.PI / 2).translate(0, 0.05, 2.1), 'dark');
    k.add('body', G.box(9, 0.08, 1.4, 0, -0.35, 0.6), 'khaki'); k.add('body', G.box(9.6, 0.08, 1.4, 0, 1.15, 0.8), 'khaki');
    k.pair((s) => { for (const x of [1.6, 3.6]) k.add('body', G.box(0.06, 1.5, 0.06, s * x, 0.4, 0.7), 'wood'); k.add('body', G.box(1.6, 0.09, 1.42, s * 3.6, 1.15, 0.8), 'team'); });
    k.add('body', G.box(2.6, 0.06, 0.8, 0, 0.15, -3.3), 'khaki'); k.add('body', G.box(0.06, 0.9, 0.8, 0, 0.6, -3.4), 'team');
    k.add('body', G.sph(0.2, 0, 0.55, -0.4, 10, 8), 'leather');
    k.add('prop', G.box(2.2, 0.15, 0.06, 0, 0.05, 2.45), 'wood');
    k.pair((s) => { k.add('body', G.seg([s * 0.2, -0.35, 1.0], [s * 0.7, -1.2, 1.1], 0.03, 0.03, 5), 'wood'); k.add('body', G.cyl(0.32, 0.32, 0.12, 0, 0, 0, 14).rotateZ(Math.PI / 2).translate(s * 0.75, -1.25, 1.1), 'rubber'); });
    k.add('body', G.box(1.6, 0.04, 0.04, 0, -1.25, 1.1), 'iron');
  }, Object.fromEntries(['idle', 'walk', 'run', 'attack'].map((c) => [c, () => [spin('prop', [0, 0, 1], 10, 1)]])), { kind: 'air', pivots: { prop: [0, 0.05, 2.45] }, aoFoot: false }),
};
/** Расчёт орудия: позы, запечённые в статичную геометрию. */
function crew(k, outfit, spots) {
  const POSES = {
    load: { armR: E(-1.2, 0, 0.2), foreR: E(-0.9), armL: E(-1.2, 0, -0.2), foreL: E(-0.9), spine: E(0.3), chest: E(0.15), thighL: E(-0.5), shinL: E(0.5), thighR: E(0.3), shinR: E(0.2) },
    kneel: { hips: E(0.05), thighL: E(-1.5), shinL: E(1.55), footL: E(0.0), thighR: E(-0.15), shinR: E(1.8), footR: E(-0.4), armL: E(-0.8), foreL: E(-0.8), armR: E(-0.5), foreR: E(-1.0), _y: -0.42 },
    stand: { armR: E(-0.3, 0, 0.1), foreR: E(-1.4), armL: E(-1.6, 0, -0.1), foreL: E(-0.4), head: E(-0.1) },
  };
  for (const [x, z, yaw, pose] of spots) {
    LOW = true; // расчёт мелкий: хватает низкой детализации
    const posed = posedGeometry((kk) => { outfit(kk); kk.parts = kk.parts.filter((q) => q.at !== 'gripR'); }, POSES[pose]);
    LOW = false;
    for (const p of posed) k.add('body', p.geo.rotateY(yaw).translate(x, 0, z), p.c);
  }
}

// ---------- каталог по эпохам ----------
/** Модели по эпохам: ключ → { era, name, make }. */
export const FORGE = {
  ashigaru_yari: { era: 0, name: 'Асигару-копейщик', make: () => humanoid('ashigaru_yari', (k) => { OUTFIT.ashigaru(k); yari(k); }, 'spear') },
  ashigaru_yumi: { era: 0, name: 'Асигару-лучник', make: () => humanoid('ashigaru_yumi', OUTFIT.archer, 'bow', { attackLen: 1.6 }) },
  samurai: { era: 0, name: 'Самурай', make: () => humanoid('samurai', OUTFIT.samurai, 'sword', { attackLen: 0.9 }) },
  peasant: { era: 0, name: 'Крестьянское ополчение', make: () => humanoid('peasant', OUTFIT.peasant, 'spear') },
  militia1: { era: 1, name: 'Ополченец (Индустрия)', make: () => humanoid('militia1', OUTFIT.militia1, 'rifle', { attackLen: 1.4 }) },
  infantry1: { era: 1, name: 'Стрелок в шинели', make: () => humanoid('infantry1', OUTFIT.infantry1, 'rifle', { attackLen: 1.4 }) },
  gun1: { era: 1, name: 'Полевое орудие', make: VEHICLE.gun1 },
  tank1: { era: 1, name: 'Клёпаный танк', make: VEHICLE.tank1 },
  biplane: { era: 1, name: 'Биплан', make: VEHICLE.biplane },
  militia2: { era: 2, name: 'Ополченец (Информационная эпоха)', make: () => humanoid('militia2', OUTFIT.militia2, 'rifle', { attackLen: 1.0 }) },
  infantry2: { era: 2, name: 'Мотострелок', make: () => humanoid('infantry2', OUTFIT.infantry2, 'rifle', { attackLen: 0.9 }) },
  gun2: { era: 2, name: 'Гаубица', make: VEHICLE.gun2 },
  tank2: { era: 2, name: 'Основной боевой танк', make: VEHICLE.tank2 },
  helicopter: { era: 2, name: 'Ударный вертолёт', make: VEHICLE.helicopter },
  drone: { era: 2, name: 'Ударный беспилотник', make: VEHICLE.drone },
  fighter: { era: 2, name: 'Истребитель', make: VEHICLE.fighter },
  militia3: { era: 3, name: 'Колониальный ополченец', make: () => humanoid('militia3', OUTFIT.militia3, 'rifle', { attackLen: 0.9 }) },
  infantry3: { era: 3, name: 'Экзопехотинец', make: () => humanoid('infantry3', OUTFIT.infantry3, 'rifle', { attackLen: 0.8 }) },
  gun3: { era: 3, name: 'Рельсовая батарея', make: VEHICLE.gun3 },
  tank3: { era: 3, name: 'Рельсотронный танк', make: VEHICLE.tank3 },
  fighter3: { era: 3, name: 'Аэрокосмический перехватчик', make: VEHICLE.fighter3 },
};
/** Какая модель у типа полка в эпохе владельца: старшая доступная не новее эпохи. */
const BY_TYPE = {
  warrior: ['ashigaru_yari'], archer: ['ashigaru_yumi'], swordsman: ['samurai'],
  militia: ['peasant', 'militia1', 'militia2', 'militia3'], infantry: ['infantry1', 'infantry1', 'infantry2', 'infantry3'],
  artillery: ['gun1', 'gun1', 'gun2', 'gun3'], tank: ['tank1', 'tank1', 'tank2', 'tank3'],
  helicopter: ['helicopter'], drone: ['drone'], fighter: ['fighter', 'fighter', 'fighter', 'fighter3'], biplane: ['biplane'],
};
export function forgeKey(type, era = 0) {
  const list = BY_TYPE[type]; if (!list) return null;
  return list[Math.max(0, Math.min(list.length - 1, era ?? 0))];
}
const cache = new Map();
/** Готовая модель (кэш): { scene, animations, kind, tris }. Клонировать SkeletonUtils.clone. */
export function forgeUnit(key) {
  if (!FORGE[key]) return null;
  if (!cache.has(key)) cache.set(key, FORGE[key].make());
  return cache.get(key);
}

// ---------- материал ----------
let shared = null;
// Ткань и металл без текстур: шум по координатам модели (переплетение, складки, потёртости).
const FABRIC = `
float fh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float fn(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fh(i), fh(i + vec3(1,0,0)), f.x), mix(fh(i + vec3(0,1,0)), fh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fh(i + vec3(0,0,1)), fh(i + vec3(1,0,1)), f.x), mix(fh(i + vec3(0,1,1)), fh(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fabric(vec3 p, float metal) {
  if (metal > 1.5) return 1.0;
  float big = fn(p * 9.0); float mid = fn(p * 31.0); float fine = fn(p * 140.0);
  if (metal > 0.5) return 0.86 + 0.1 * big + 0.1 * fn(vec3(p.x * 6.0, p.y * 220.0, p.z * 6.0)); // металл: продольные риски
  float weave = 0.5 + 0.5 * sin(p.x * 900.0) * sin(p.y * 900.0 + p.z * 900.0);
  float fold = sin(p.y * 46.0 + big * 7.0 + p.x * 8.0) * 0.07; // складки ткани
  return 0.74 + 0.26 * big + 0.1 * mid + 0.06 * fine + 0.04 * weave + fold;
}
`;
/** Материал кованых моделей: цвет нации подставляется по атрибуту team, металл — по metal. */
export function forgeMaterial(teamColor = null, variant = 0) {
  if (!teamColor && !variant && shared) return shared;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.04 });
  m.userData.team = { value: new THREE.Color(teamColor ?? PAL.team) };
  m.userData.vari = { value: [0, 1, -1][variant % 3] }; // разброс: загар, выгоревшая ткань
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTeam = m.userData.team; sh.uniforms.uVar = m.userData.vari;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float team;\nattribute float metal;\nvarying float vTeam;\nvarying float vMetal;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTeam = team; vMetal = metal; vObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTeam;\nuniform float uVar;\nvarying float vTeam;\nvarying float vMetal;\nvarying vec3 vObj;\n' + FABRIC)
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vTeam > 0.001) diffuseColor.rgb = uTeam * vTeam;\nfloat fab = fabric(vObj, vMetal);\ndiffuseColor.rgb *= fab;\nif (vTeam < 0.001 && vMetal < 0.5) diffuseColor.rgb *= vec3(1.0 + 0.07 * uVar, 1.0 + 0.01 * uVar, 1.0 - 0.06 * uVar) * (1.0 - 0.05 * abs(uVar));')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.34, min(vMetal, 1.0));')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMetal > 1.5 ? 0.0 : mix(metalnessFactor, 0.82, vMetal);')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n{ float rim = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 3.0); reflectedLight.directDiffuse += diffuseColor.rgb * rim * 0.35 * vec3(1.0, 0.95, 0.85); }')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * step(1.5, vMetal) * 0.6;');
  };
  m.customProgramCacheKey = () => 'forge';
  if (!teamColor && !variant) shared = m;
  return m;
}
/** Павший: кованая фигура в последнем кадре клипа die, лежит на земле (одна геометрия, цвет — из экземпляра). */
export function forgeFallen() {
  LOW = true;
  const parts = posedGeometry((k) => figure(k, { hair: 'hair' }), diePose(1));
  LOW = false;
  const g = mergeGeometries(parts.map((p) => { const q = indexed(p.geo.clone()); return q.index ? q.toNonIndexed() : q; }));
  g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y + 0.02, 0);
  return g;
}
/** Открытые для тестов и выгрузки. */
export const _internal = { RIG, poseFor, posedGeometry, OUTFIT, figure, Kit };
