// Сцена тактического боя на three.js: рельеф, лес, полки из отдельных солдат, знамёна,
// стрелы, трассеры, разрывы и павшие. Сервер присылает снимок боя (tactical.js → battleView),
// сцена плавно интерполирует полки между снимками и сама анимирует солдат.
// Модели: если в /game/units/manifest.json есть glTF для типа (CC0/CC-BY, см. CREDITS.md),
// берётся он; иначе — процедурные низкополигональные фигуры, собранные здесь.
// Производительность: части солдата слиты по типу движения (тело, ноги, руки, оружие) в общие
// геометрии с цветами в вершинах — 6–8 вызовов отрисовки на полк; эффекты берутся из пулов.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BIOME = {
  plain: ['#5d7a32', '#7a9142', '#6b5a3a'], forest: ['#435c27', '#5b7231', '#4f4430'], desert: ['#a88d58', '#c4a874', '#8f7148'],
  tundra: ['#77846a', '#98a388', '#6f6656'], mountain: ['#67684f', '#8a886d', '#6a5f4c'], ice: ['#cfd8de', '#eef2f4', '#a9b3b8'],
};
const HAZE = '#cdc4ab';
const AIR_ALT = { helicopter: 38, drone: 70, fighter: 110, biplane: 60 };
const hash = (i, k = 0) => { let h = (i * 374761393 + k * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Высота поля по сетке сервера (та же билинейная интерполяция, что в tactical.js). */
export function fieldHeight(terrain, field, x, y) {
  const n = terrain.n;
  const fx = Math.min(n - 1.001, Math.max(0, (x / field.w + 0.5) * (n - 1)));
  const fy = Math.min(n - 1.001, Math.max(0, (y / field.h + 0.5) * (n - 1)));
  const i = Math.floor(fx); const j = Math.floor(fy); const u = fx - i; const v = fy - j;
  const h = (a, c) => terrain.heights[c * n + a];
  return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
}
/** Высота с дальними холмами за краем поля (для земли, деревьев и пикинга). */
function groundHeight(t, field, x, y) {
  const inside = Math.max(Math.abs(x) / (field.w / 2), Math.abs(y) / (field.h / 2));
  let h = fieldHeight(t, field, x, y);
  if (inside > 1) h += (inside - 1) ** 1.6 * 55 * (0.6 + 0.4 * Math.sin(x * 0.01 + y * 0.013));
  return h;
}

function canvasTexture(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
// мягкая детальная текстура травы: низкий контраст, без «серого шума»
const grassTexture = () => {
  const t = canvasTexture(512, (g, s) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 14000; i += 1) {
      const v = 185 + Math.floor(hash(i, 1) * 70);
      g.fillStyle = `rgba(${v},${v},${v - 10},0.55)`;
      g.fillRect(hash(i, 2) * s, hash(i, 3) * s, 1 + hash(i, 4) * 1.5, 2 + hash(i, 5) * 5);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(28, 21); t.anisotropy = 8; return t;
};
const puffTexture = (inner, outer) => canvasTexture(128, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
  r.addColorStop(0, inner); r.addColorStop(1, outer); g.fillStyle = r; g.fillRect(0, 0, s, s);
});
/** Клочковатый дым: несколько пятен внутри круга, чтобы облака не были идеальными кругами. */
const smokeTexture = (rgb) => canvasTexture(128, (g, s) => {
  for (let i = 0; i < 9; i += 1) {
    const x = s / 2 + (hash(i, 3) - 0.5) * s * 0.4; const y = s / 2 + (hash(i, 4) - 0.5) * s * 0.4; const r = s * (0.18 + hash(i, 5) * 0.16);
    const grd = g.createRadialGradient(x, y, 1, x, y, r); grd.addColorStop(0, `rgba(${rgb},0.45)`); grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  }
});
/** Знамя-нобори: полотно цвета нации, белый круг-мон и тёмная кайма, как на флагах кланов. */
const monCache = new Map();
function monTexture(color) {
  if (monCache.has(color)) return monCache.get(color);
  const t = canvasTexture(128, (g, s) => {
    g.fillStyle = color; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, s, s * 0.08); g.fillRect(0, s * 0.92, s, s * 0.08);
    g.fillStyle = '#f4efe2'; g.beginPath(); g.arc(s / 2, s * 0.3, s * 0.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(s / 2, s * 0.3, s * 0.09, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 3; k += 1) { g.fillStyle = 'rgba(244,239,226,0.85)'; g.fillRect(s * 0.42, s * (0.58 + k * 0.1), s * 0.16, s * 0.05); }
  });
  monCache.set(color, t); return t;
}

// ---------- процедурные модели ----------
function box(w, h, d, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
function cyl(rt, rb, h, x = 0, y = 0, z = 0, seg = 8) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y, z); return g; }

const C = {
  skin: '#c99a74', cloth: '#2c2a27', lacquer: '#221d1d', steel: '#c9ced4', wood: '#6b4a2b', olive: '#4d5634',
  dark: '#2a2d2e', straw: '#b39b62', gold: '#d4a640', khaki: '#6f6a4a', rubber: '#1b1c1c',
};
const METAL = new Set(['steel', 'gold', 'dark']);

/** Части фигуры: geo, c (ключ цвета или 'team'), anim: body|legL|legR|armL|armR|spear|sword|bow|rifle|recoil|turret|rotor|static. */
function partsFor(type) {
  const legs = (c = 'cloth') => [
    { geo: box(0.18, 0.86, 0.21, 0, -0.42, 0), c, anim: 'legL', at: [-0.11, 0.88, 0] },
    { geo: box(0.18, 0.86, 0.21, 0, -0.42, 0), c, anim: 'legR', at: [0.11, 0.88, 0] },
  ];
  const arms = (c) => [
    { geo: box(0.13, 0.64, 0.14, 0, -0.3, 0), c, anim: 'armL', at: [-0.32, 1.46, 0] },
    { geo: box(0.13, 0.64, 0.14, 0, -0.3, 0), c, anim: 'armR', at: [0.32, 1.46, 0] },
  ];
  const head = { geo: new THREE.SphereGeometry(0.135, 10, 8).translate(0, 1.63, 0), c: 'skin', anim: 'body' };
  const sashimono = [
    { geo: cyl(0.015, 0.015, 1.3, 0, 1.75, -0.2, 4), c: 'wood', anim: 'body' },
    { geo: box(0.02, 0.66, 0.36, 0, 2.07, -0.38), c: 'team', anim: 'body' }, // флажок за спиной, как у асигару
  ];
  switch (type) {
    case 'warrior': return [...legs(), head, ...arms('team'),
      { geo: box(0.48, 0.64, 0.3, 0, 1.18, 0), c: 'team', anim: 'body' },
      { geo: box(0.5, 0.1, 0.32, 0, 0.9, 0), c: 'cloth', anim: 'body' },
      { geo: new THREE.ConeGeometry(0.34, 0.18, 12).translate(0, 1.79, 0), c: 'straw', anim: 'body' }, // дзингаса
      { geo: cyl(0.022, 0.022, 3.8, 0, 0, 0, 5), c: 'wood', anim: 'spear', at: [0.3, 1.15, 0.12] },
      { geo: new THREE.ConeGeometry(0.05, 0.42, 5).translate(0, 2.1, 0), c: 'steel', anim: 'spear', at: [0.3, 1.15, 0.12] },
      ...sashimono];
    case 'swordsman': return [...legs(), head, ...arms('lacquer'),
      { geo: box(0.52, 0.68, 0.34, 0, 1.18, 0), c: 'lacquer', anim: 'body' },
      { geo: box(0.54, 0.2, 0.36, 0, 1.38, 0.01), c: 'team', anim: 'body' },
      { geo: box(0.72, 0.14, 0.32, 0, 1.47, 0), c: 'lacquer', anim: 'body' }, // наплечники-содэ
      { geo: box(0.56, 0.32, 0.34, 0, 0.84, 0), c: 'team', anim: 'body' }, // кусадзури
      { geo: new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.67, 0), c: 'lacquer', anim: 'body' }, // кабуто
      { geo: box(0.42, 0.03, 0.42, 0, 1.65, -0.02), c: 'lacquer', anim: 'body' },
      { geo: new THREE.TorusGeometry(0.17, 0.02, 4, 12, Math.PI).translate(0, 1.86, 0.12), c: 'gold', anim: 'body' }, // маэдатэ
      { geo: box(0.035, 1.1, 0.06, 0, 0.55, 0), c: 'steel', anim: 'sword', at: [0.32, 1.0, 0.22] },
      { geo: box(0.08, 0.22, 0.08, 0, -0.05, 0), c: 'cloth', anim: 'sword', at: [0.32, 1.0, 0.22] },
      { geo: box(0.05, 0.9, 0.06, 0, 0, 0).rotateX(1.2).translate(-0.3, 0.98, -0.05), c: 'lacquer', anim: 'body' }, // ножны-сая у бедра
      { geo: box(0.04, 0.5, 0.05, 0, 0, 0).rotateX(1.0).translate(-0.24, 1.0, 0.12), c: 'gold', anim: 'body' }, // рукоять вакидзаси
      ...sashimono];
    case 'archer': return [...legs(), head, ...arms('team'),
      { geo: box(0.46, 0.62, 0.28, 0, 1.18, 0), c: 'team', anim: 'body' },
      { geo: new THREE.ConeGeometry(0.34, 0.16, 12).translate(0, 1.78, 0), c: 'straw', anim: 'body' },
      { geo: new THREE.TorusGeometry(1.0, 0.02, 4, 18, Math.PI * 0.9).rotateZ(Math.PI / 2 - 0.45 * Math.PI).rotateY(Math.PI / 2), c: 'wood', anim: 'bow', at: [-0.32, 1.3, 0.28] },
      { geo: cyl(0.09, 0.08, 0.6, 0.16, 1.3, -0.22, 6), c: 'wood', anim: 'body' }, // колчан
      ...sashimono];
    case 'militia': return [...legs(), head, ...arms('team'),
      { geo: box(0.46, 0.62, 0.28, 0, 1.18, 0), c: 'team', anim: 'body' },
      { geo: cyl(0.022, 0.022, 2.4, 0, 0, 0, 5), c: 'wood', anim: 'spear', at: [0.3, 1.1, 0.1] }];
    case 'infantry': return [...legs('olive'), head, ...arms('olive'),
      { geo: box(0.5, 0.64, 0.32, 0, 1.18, 0), c: 'olive', anim: 'body' },
      { geo: box(0.52, 0.12, 0.34, 0, 1.08, 0), c: 'team', anim: 'body' }, // повязка нации
      { geo: box(0.34, 0.4, 0.18, 0, 1.2, -0.24), c: 'khaki', anim: 'body' }, // ранец
      { geo: new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2).translate(0, 1.65, 0), c: 'olive', anim: 'body' },
      { geo: cyl(0.25, 0.25, 0.025, 0, 1.66, 0.02, 12), c: 'olive', anim: 'body' }, // поля каски
      { geo: box(0.05, 0.07, 1.1, 0, 0, 0.3), c: 'dark', anim: 'rifle', at: [0.18, 1.3, 0.15] },
      { geo: box(0.02, 0.02, 0.35, 0, 0, 0.98), c: 'steel', anim: 'rifle', at: [0.18, 1.3, 0.15] }];
    case 'artillery': return [
      { geo: cyl(0.16, 0.22, 2.8, 0, 0, 0, 10).rotateX(Math.PI / 2 - 0.12).translate(0, 1.0, 0.7), c: 'dark', anim: 'recoil' },
      { geo: box(1.6, 1.1, 0.08, 0, 1.0, 0.25), c: 'olive', anim: 'static' }, // щит орудия
      { geo: box(0.9, 0.35, 2.2, 0, 0.6, -0.5), c: 'team', anim: 'static' },
      { geo: new THREE.TorusGeometry(0.6, 0.1, 6, 14).rotateY(Math.PI / 2).translate(-0.8, 0.6, 0), c: 'wood', anim: 'static' },
      { geo: new THREE.TorusGeometry(0.6, 0.1, 6, 14).rotateY(Math.PI / 2).translate(0.8, 0.6, 0), c: 'wood', anim: 'static' },
      { geo: box(0.42, 1.65, 0.32, -1.5, 0.82, -0.9), c: 'olive', anim: 'static' }, // расчёт
      { geo: box(0.42, 1.65, 0.32, 1.5, 0.82, -1.2), c: 'olive', anim: 'static' }];
    case 'tank': {
      const wheels = [];
      for (let k = 0; k < 5; k += 1) for (const sx of [-1.6, 1.6]) wheels.push({ geo: cyl(0.42, 0.42, 0.5, 0, 0, 0, 10).rotateZ(Math.PI / 2).translate(sx, 0.45, -2.4 + k * 1.2), c: 'rubber', anim: 'static' });
      return [
        { geo: box(3.0, 1.0, 6.4, 0, 1.0, 0), c: 'olive', anim: 'static' },
        { geo: box(3.4, 0.25, 6.6, 0, 1.35, 0), c: 'olive', anim: 'static' }, // надгусеничные полки
        { geo: box(0.75, 0.9, 6.9, -1.6, 0.48, 0), c: 'dark', anim: 'static' },
        { geo: box(0.75, 0.9, 6.9, 1.6, 0.48, 0), c: 'dark', anim: 'static' },
        ...wheels,
        { geo: box(3.42, 0.28, 1.0, 0, 1.52, -2.4), c: 'team', anim: 'static' },
        { geo: cyl(1.25, 1.45, 0.85, 0, 1.95, -0.3, 14), c: 'olive', anim: 'turret' },
        { geo: cyl(0.4, 0.45, 0.3, 0.4, 2.5, -0.7, 10), c: 'olive', anim: 'turret' }, // люк командира
        { geo: cyl(0.02, 0.02, 2.2, -0.7, 3.4, -1.1, 4), c: 'dark', anim: 'turret' }, // антенна
        { geo: cyl(0.11, 0.13, 4.4, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(0, 2.0, 2.6), c: 'dark', anim: 'turret' },
        { geo: cyl(0.17, 0.17, 0.5, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(0, 2.0, 4.7), c: 'dark', anim: 'turret' }];
    }
    case 'helicopter': return [
      { geo: new THREE.CapsuleGeometry(0.95, 3.2, 4, 10).rotateX(Math.PI / 2), c: 'olive', anim: 'static' },
      { geo: box(1.2, 0.5, 1.2, 0, 0.1, 1.9), c: 'dark', anim: 'static' }, // остекление
      { geo: box(0.3, 0.5, 5, 0, 0.3, -4), c: 'olive', anim: 'static' },
      { geo: box(0.1, 1.2, 0.8, 0, 0.8, -6.3), c: 'team', anim: 'static' },
      { geo: box(3.6, 0.15, 0.5, 0, -0.3, 0.2), c: 'dark', anim: 'static' }, // пилоны с ракетами
      { geo: box(13, 0.05, 0.38, 0, 1.2, 0), c: 'dark', anim: 'rotor' },
      { geo: box(0.38, 0.05, 13, 0, 1.2, 0), c: 'dark', anim: 'rotor' }];
    default: return [ // самолёты и беспилотники
      { geo: new THREE.CapsuleGeometry(0.6, 6, 4, 10).rotateX(Math.PI / 2), c: 'olive', anim: 'static' },
      { geo: box(10, 0.12, 1.8, 0, 0, 0.3), c: 'team', anim: 'static' },
      { geo: box(3.4, 0.1, 1, 0, 0.2, -3.2), c: 'olive', anim: 'static' },
      { geo: box(0.1, 1.4, 1, 0, 0.8, -3.3), c: 'olive', anim: 'static' }];
  }
}

/** Сливает части по типу движения (и металлу/нет) в одну геометрию с цветами в вершинах. */
function mergedParts(type, teamColor) {
  const groups = new Map();
  for (const p of partsFor(type)) {
    const metal = METAL.has(p.c);
    const key = `${p.anim}|${p.at?.join(',') ?? ''}|${metal ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, { anim: p.anim, at: p.at ?? null, metal, geos: [] });
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.deleteAttribute('uv');
    const col = new THREE.Color(p.c === 'team' ? teamColor : C[p.c]);
    const n = g.attributes.position.count; const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    groups.get(key).geos.push(g);
  }
  return [...groups.values()].map((g) => ({ anim: g.anim, at: g.at ? new THREE.Matrix4().makeTranslation(...g.at) : null, metal: g.metal, geo: mergeGeometries(g.geos) }));
}

const MATTE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 });
const SHINY = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.8 });
const WOOD = new THREE.MeshStandardMaterial({ color: C.wood, roughness: 0.9 });

const fieldToWorld = (x, y, h, out = new THREE.Vector3()) => out.set(x, h, -y);
const SHARED = new Set([MATTE, SHINY, WOOD]); // общие для всех боёв: не освобождаются вместе с одним видом
const aoTex = canvasTexture(128, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(0,0,0,0.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); }, false);
const aoGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const headGeo = new THREE.ConeGeometry(1.2, 3, 3).rotateX(Math.PI / 2); // наконечник стрелки приказа
const aoMat = new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
SHARED.add(aoMat);

export function createBattleView(container, { colorOf = () => '#c8574d', modelBase = '/game/units/' } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 4000);
  const cam = { target: new THREE.Vector3(0, 0, 60), yaw: 0, pitch: 0.42, dist: 190 };
  const disposables = new Set(); // геометрии, материалы и текстуры этой сцены: освобождаются в dispose()
  const track = (x) => { disposables.add(x); return x; };

  // постобработка: MSAA в HDR-буфере, мягкое свечение только у огня и трассеров
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.35, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // небо и свет: низкое тёплое солнце и дымка в цвет горизонта
  const skyGeo = track(new THREE.SphereGeometry(2500, 32, 16));
  const skyCols = [];
  for (let i = 0; i < skyGeo.attributes.position.count; i += 1) {
    const y = skyGeo.attributes.position.getY(i) / 2500;
    const c = new THREE.Color(HAZE).lerp(new THREE.Color('#7f9fc4'), Math.min(1, Math.max(0, y * 1.6)) ** 0.8);
    skyCols.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyCols, 3));
  scene.add(new THREE.Mesh(skyGeo, track(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }))));
  scene.fog = new THREE.Fog(HAZE, 260, 1300);
  scene.add(new THREE.HemisphereLight('#d6e2f5', '#5a4c34', 1.35));
  const sun = new THREE.DirectionalLight('#ffe0b0', 2.6);
  sun.position.set(-260, 230, 160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -340, right: 340, top: 280, bottom: -280, near: 10, far: 900 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.5; sun.shadow.radius = 2;
  scene.add(sun);

  let terrainKey = null;
  const world = new THREE.Group(); scene.add(world);
  let view = null; let terrain = null;
  const regs = new Map();
  const bodies = { meshes: null, count: 0, falling: [] };
  let lastFxTick = -1;
  const models = {};
  let field = { w: 640, h: 480 };
  const fxTex = {
    fire: track(puffTexture('rgba(255,236,170,1)', 'rgba(255,90,0,0)')), smoke: track(smokeTexture('95,90,84')),
    dust: track(smokeTexture('176,156,116')), boom: track(smokeTexture('38,34,30')), flash: track(puffTexture('rgba(255,250,220,1)', 'rgba(255,200,80,0)')),
  };

  fetch(`${modelBase}manifest.json`).then((r) => (r.ok ? r.json() : {})).then((manifest) => {
    const loader = new GLTFLoader();
    for (const [type, m] of Object.entries(manifest ?? {})) {
      loader.load(modelBase + m.file, (gltf) => { models[type] = { ...m, gltf }; for (const r of regs.values()) if (r.type === type) r.rebuild = true; }, undefined, () => {});
    }
  }).catch(() => {});

  const H = (x, y) => (terrain ? fieldHeight(terrain, field, x, y) : 0);

  // ---------- пулы эффектов: никаких new Mesh/Material на выстрел ----------
  const pools = {};
  function pool(key, make, size) {
    if (!pools[key]) { pools[key] = { free: [], make, size }; for (let i = 0; i < size; i += 1) { const o = make(); o.visible = false; scene.add(o); pools[key].free.push(o); } }
    const p = pools[key];
    return p.free.pop() ?? null;
  }
  const release = (key, o) => { o.visible = false; pools[key].free.push(o); };
  const arrowGeo = track(mergeGeometries([box(0.025, 0.025, 0.95), box(0.06, 0.06, 0.12, 0, 0, 0.5), box(0.12, 0.01, 0.12, 0, 0, -0.42)]));
  const arrowMat = track(new THREE.MeshBasicMaterial({ color: '#d6c39a' }));
  const tracerGeo = track(box(0.07, 0.07, 1));
  const tracerMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 0.8), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  const ringGeo = track(new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2));
  const debrisGeo = track(box(0.25, 0.25, 0.25));
  const debrisMat = track(new THREE.MeshStandardMaterial({ color: '#3b3128', roughness: 1 }));
  const live = []; // активные эффекты: { key, obj, born, life, ... }

  function spritePuff(tex, p, size, life, { delay = 0, rise = 3, additive = false, opacity = 0.9 } = {}) {
    const s = pool(`sp-${tex}`, () => new THREE.Sprite(track(new THREE.SpriteMaterial({ map: fxTex[tex], transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }))), 140);
    if (!s) return;
    s.position.copy(p); s.scale.setScalar(size); s.material.rotation = hash(live.length, 3) * 6.28; s.material.opacity = 0;
    live.push({ key: `sp-${tex}`, obj: s, born: clock + delay, life, size, rise, opacity, kind: 'puff' });
  }
  function explode(p) {
    const lift = (y) => p.clone().add(new THREE.Vector3(0, y, 0));
    spritePuff('flash', lift(2), 18, 0.25, { additive: true });
    spritePuff('fire', lift(2), 13, 1.2, { additive: true, rise: 1.5 });
    spritePuff('fire', lift(1), 7, 0.8, { additive: true, delay: 0.1 });
    for (let k = 0; k < 3; k += 1) spritePuff('boom', lift(3 + k * 2), 12 + k * 4, 4 + k, { delay: 0.05 + k * 0.15, rise: 4, opacity: 0.85 });
    spritePuff('dust', p, 22, 3.5, { rise: 1, opacity: 0.7 });
    const ring = pool('ring', () => new THREE.Mesh(ringGeo, track(new THREE.MeshBasicMaterial({ color: '#f3dcae', transparent: true, depthWrite: false }))), 30);
    if (ring) { ring.position.copy(lift(0.4)); ring.scale.setScalar(1); live.push({ key: 'ring', obj: ring, born: clock, life: 0.6, kind: 'ring' }); }
    for (let k = 0; k < 8; k += 1) {
      const d = pool('debris', () => new THREE.Mesh(debrisGeo, debrisMat), 160);
      if (!d) break;
      d.position.copy(lift(0.5));
      const a = hash(k, live.length) * 6.28; const sp = 6 + hash(k, 9) * 8;
      live.push({ key: 'debris', obj: d, born: clock, life: 1.6, kind: 'debris', v: new THREE.Vector3(Math.cos(a) * sp * 0.5, 9 + hash(k, 7) * 8, Math.sin(a) * sp * 0.5) });
    }
  }

  function buildTerrain(t) {
    for (const o of world.children) o.traverse?.((x) => { x.geometry?.dispose?.(); if (x.material && !SHARED.has(x.material)) { x.material.map?.dispose?.(); x.material.dispose?.(); } });
    world.clear();
    const [c0, c1, dirt] = (BIOME[t.biome] ?? BIOME.plain).map((c) => new THREE.Color(c));
    const W = field.w * 2.6; const D = field.h * 2.6;
    const geo = new THREE.PlaneGeometry(W, D, 200, 150).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position; const cols = []; const rock = new THREE.Color('#7a7466'); const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i); const y = -pos.getZ(i);
      pos.setY(i, groundHeight(t, field, x, y));
      const n = 0.5 + 0.5 * Math.sin(x * 0.03 + Math.cos(y * 0.02) * 2) * Math.cos(y * 0.035 - x * 0.008);
      c.copy(c0).lerp(c1, n * 0.85 + hash(i) * 0.15);
      // пятна вытоптанной земли и тропа через центр поля
      const blot = Math.max(0, Math.sin(x * 0.021 + 1.7) * Math.cos(y * 0.026 - 0.4) - 0.55) * 2.2;
      const path = Math.max(0, 1 - Math.abs(x - Math.sin(y * 0.012) * 40) / 7) * (Math.abs(y) < field.h * 0.6 ? 0.55 : 0);
      c.lerp(dirt, Math.min(0.75, blot + path));
      if (t.woods.some((w) => Math.hypot(w.x - x, w.y - y) < w.r)) c.multiplyScalar(0.75);
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i += 1) { const slope = 1 - nrm.getY(i); if (slope > 0.12) { c.setRGB(cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]).lerp(rock, Math.min(1, (slope - 0.12) * 4)); geo.attributes.color.setXYZ(i, c.r, c.g, c.b); } }
    const ground = new THREE.Mesh(geo, track(new THREE.MeshStandardMaterial({ vertexColors: true, map: track(grassTexture()), roughness: 0.97 })));
    ground.receiveShadow = true; ground.name = 'ground';
    world.add(ground);
    // лес: хвойные в лесу и тундре, лиственные на равнине; кроны из двух ярусов
    const conifer = t.biome === 'forest' || t.biome === 'tundra' || t.biome === 'mountain';
    const trees = [];
    t.woods.forEach((w, k) => { const n = Math.round((w.r * w.r) / 45); for (let i = 0; i < n; i += 1) { const a = hash(i, k) * 6.283; const rr = Math.sqrt(hash(i, k + 50)) * w.r; trees.push([w.x + Math.cos(a) * rr, w.y + Math.sin(a) * rr, 0.7 + hash(i, k + 99) * 0.7]); } });
    for (let i = 0; i < 300; i += 1) { const x = (hash(i, 7) - 0.5) * W * 0.95; const y = (hash(i, 8) - 0.5) * D * 0.95; if (Math.abs(x) > field.w * 0.55 || Math.abs(y) > field.h * 0.55) trees.push([x, y, 0.8 + hash(i, 9)]); }
    const trunkGeo = cyl(0.25, 0.4, 4, 0, 2, 0, 6);
    const crownGeo = conifer
      ? mergeGeometries([new THREE.ConeGeometry(2.3, 5.5, 8).translate(0, 5.6, 0), new THREE.ConeGeometry(1.7, 4.5, 8).translate(0, 8.4, 0)])
      : mergeGeometries([new THREE.IcosahedronGeometry(2.6, 1).translate(0, 5.6, 0), new THREE.IcosahedronGeometry(1.9, 1).translate(0.9, 7.2, 0.4)]);
    const trunks = new THREE.InstancedMesh(trunkGeo, WOOD, trees.length);
    const crowns = new THREE.InstancedMesh(crownGeo, track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true })), trees.length);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const leaf = new THREE.Color(); const up = new THREE.Vector3(0, 1, 0); const v = new THREE.Vector3(); const sc = new THREE.Vector3();
    trees.forEach(([x, y, s], i) => {
      q.setFromAxisAngle(up, hash(i, 3) * 6.28);
      m.compose(v.set(x, groundHeight(t, field, x, y) - 0.3, -y), q, sc.set(s, s * (0.85 + hash(i, 4) * 0.4), s));
      trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, leaf.set(conifer ? '#2f4a26' : '#4d6a2a').offsetHSL((hash(i, 5) - 0.5) * 0.05, 0, (hash(i, 6) - 0.5) * 0.12));
    });
    for (const mesh of [trunks, crowns]) { mesh.castShadow = true; mesh.receiveShadow = true; world.add(mesh); }
    // трава и камни
    const tuftGeo = mergeGeometries([0, 1, 2].map((k) => new THREE.PlaneGeometry(0.06, 0.5).translate(0, 0.25, 0).rotateZ((k - 1) * 0.35).rotateY(k * 1.05)));
    const tufts = new THREE.InstancedMesh(tuftGeo, track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide })), 9000);
    for (let i = 0; i < 9000; i += 1) {
      const x = (hash(i, 61) - 0.5) * field.w * 1.1; const y = (hash(i, 62) - 0.5) * field.h * 1.1;
      q.setFromAxisAngle(up, hash(i, 63) * 6.28);
      const s = 0.7 + hash(i, 64) * 0.8;
      m.compose(v.set(x, fieldHeight(t, field, x, y) - 0.05, -y), q, sc.set(s, s * (0.7 + hash(i, 65)), s));
      tufts.setMatrixAt(i, m); tufts.setColorAt(i, leaf.copy(c1).offsetHSL((hash(i, 66) - 0.5) * 0.05, 0.05, (hash(i, 67) - 0.6) * 0.18));
    }
    tufts.receiveShadow = true; world.add(tufts);
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.9, 0), track(new THREE.MeshStandardMaterial({ color: '#8a857a', roughness: 0.95, flatShading: true })), 160);
    for (let i = 0; i < 160; i += 1) {
      const x = (hash(i, 71) - 0.5) * field.w * 1.2; const y = (hash(i, 72) - 0.5) * field.h * 1.2; const s = 0.4 + hash(i, 73) * (t.biome === 'mountain' ? 2.5 : 1.1);
      q.setFromEuler(new THREE.Euler(hash(i, 74) * 3, hash(i, 75) * 3, 0));
      m.compose(v.set(x, fieldHeight(t, field, x, y) - 0.2, -y), q, sc.set(s, s * 0.6, s)); rocks.setMatrixAt(i, m);
    }
    rocks.castShadow = rocks.receiveShadow = true; world.add(rocks);
    // кустарник по опушкам и полю
    const bushGeo = mergeGeometries([new THREE.IcosahedronGeometry(0.9, 0).translate(0, 0.6, 0), new THREE.IcosahedronGeometry(0.7, 0).translate(0.7, 0.45, 0.2), new THREE.IcosahedronGeometry(0.6, 0).translate(-0.6, 0.4, -0.2)]);
    const bushes = new THREE.InstancedMesh(bushGeo, track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true })), 420);
    for (let i = 0; i < 420; i += 1) {
      const w = t.woods[i % Math.max(1, t.woods.length)];
      const nearWood = w && i % 3 !== 0;
      const a = hash(i, 91) * 6.28; const rr = nearWood ? w.r * (0.9 + hash(i, 92) * 0.5) : 0;
      const x = nearWood ? w.x + Math.cos(a) * rr : (hash(i, 93) - 0.5) * field.w * 1.2; const y = nearWood ? w.y + Math.sin(a) * rr : (hash(i, 94) - 0.5) * field.h * 1.2;
      const s = 0.6 + hash(i, 95) * 1.1;
      q.setFromAxisAngle(up, hash(i, 96) * 6.28);
      m.compose(v.set(x, groundHeight(t, field, x, y) - 0.15, -y), q, sc.set(s, s * 0.8, s)); bushes.setMatrixAt(i, m);
      bushes.setColorAt(i, leaf.set('#4a6328').offsetHSL((hash(i, 97) - 0.5) * 0.06, 0, (hash(i, 98) - 0.5) * 0.14));
    }
    bushes.castShadow = bushes.receiveShadow = true; world.add(bushes);
    // дальние горы двумя планами в дымке
    for (const [radius, height, tint, count] of [[1700, 420, '#9da39a', 26], [2150, 620, '#b7b8ad', 22]]) {
      const peaks = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), track(new THREE.MeshBasicMaterial({ color: tint, fog: false })), count);
      for (let i = 0; i < count; i += 1) {
        const a = (i / count) * 6.283 + hash(i, radius) * 0.2; const h = height * (0.55 + hash(i, radius + 1) * 0.6);
        m.compose(v.set(Math.cos(a) * radius, h / 2 - 40, Math.sin(a) * radius), q.setFromAxisAngle(up, hash(i, 5) * 3), sc.set(h * 1.4, h, h * 1.2)); peaks.setMatrixAt(i, m);
      }
      world.add(peaks);
    }
    const cloudTex = track(smokeTexture('255,255,255'));
    for (let i = 0; i < 22; i += 1) {
      const cl = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.7 + hash(i, 81) * 0.3 })));
      const a = hash(i, 82) * 6.28; const r = 800 + hash(i, 83) * 800;
      cl.position.set(Math.cos(a) * r, 240 + hash(i, 84) * 200, Math.sin(a) * r); cl.scale.set(420 + hash(i, 85) * 300, 120 + hash(i, 86) * 80, 1);
      world.add(cl);
    }
    // город: дома и стены вокруг ополчения
    if (view.city) {
      const cty = view.city; const houses = [];
      for (let i = 0; i < 70; i += 1) { const a = hash(i, 11) * 6.283; const r = 18 + Math.sqrt(hash(i, 12)) * (cty.r - 18); houses.push([cty.x + Math.cos(a) * r, cty.y + Math.sin(a) * r, a]); }
      const hb = new THREE.InstancedMesh(box(7, 4, 6, 0, 2, 0), track(new THREE.MeshStandardMaterial({ color: '#cbbd9e', roughness: 0.9 })), houses.length);
      const hr = new THREE.InstancedMesh(new THREE.ConeGeometry(5.6, 3, 4).rotateY(Math.PI / 4).translate(0, 5.5, 0), track(new THREE.MeshStandardMaterial({ color: '#4b3c34', roughness: 0.7 })), houses.length);
      houses.forEach(([x, y, a], i) => { q.setFromAxisAngle(up, a); m.compose(fieldToWorld(x, y, H(x, y) - 0.2, v), q, sc.set(1, 1, 1)); hb.setMatrixAt(i, m); hr.setMatrixAt(i, m); });
      for (const mesh of [hb, hr]) { mesh.castShadow = mesh.receiveShadow = true; world.add(mesh); }
      if (cty.walls) {
        const segs = 48; const wall = new THREE.InstancedMesh(box(cty.r * 6.283 / segs + 0.5, 6, 2.2, 0, 3, 0), track(new THREE.MeshStandardMaterial({ color: '#9b9384', roughness: 0.95 })), segs);
        for (let i = 0; i < segs; i += 1) { const a = (i / segs) * 6.283; const x = cty.x + Math.cos(a) * cty.r; const y = cty.y + Math.sin(a) * cty.r; q.setFromAxisAngle(up, a + Math.PI / 2); m.compose(fieldToWorld(x, y, H(x, y) - 0.5, v), q, sc.set(1, 1, 1)); wall.setMatrixAt(i, m); }
        wall.castShadow = wall.receiveShadow = true; world.add(wall);
      }
    }
    // павшие: торс, голова, раскинутые руки и ноги
    const bodyGeo = mergeGeometries([box(0.44, 0.22, 0.62, 0, 0.11, 0.1), new THREE.SphereGeometry(0.13, 8, 6).translate(0, 0.12, 0.55),
      box(0.17, 0.18, 0.85, -0.11, 0.09, -0.62).rotateY(0.12), box(0.17, 0.18, 0.85, 0.11, 0.09, -0.62).rotateY(-0.2),
      box(0.6, 0.12, 0.13, -0.45, 0.07, 0.25).rotateY(0.3), box(0.6, 0.12, 0.13, 0.45, 0.07, 0.15).rotateY(-0.5)].map((g) => { g.deleteAttribute('uv'); return g; }));
    bodies.meshes = new THREE.InstancedMesh(bodyGeo, track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 })), 4000);
    bodies.meshes.count = 0; bodies.count = 0; bodies.meshes.receiveShadow = true; bodies.meshes.castShadow = true; world.add(bodies.meshes);
    // кровь и следы: тёмные пятна под павшими
    const stainGeo = new THREE.CircleGeometry(0.9, 10).rotateX(-Math.PI / 2);
    bodies.stains = new THREE.InstancedMesh(stainGeo, track(new THREE.MeshBasicMaterial({ color: '#2a1b12', transparent: true, opacity: 0.45, depthWrite: false })), 4000);
    bodies.stains.count = 0; world.add(bodies.stains);
  }

  function makeRegiment(r) {
    const group = new THREE.Group();
    const color = new THREE.Color(colorOf(r.owner));
    const model = models[r.type];
    const entry = { id: r.id, type: r.type, group, color, meshes: [], parts: [], soldiers: [], cur: { ...r }, prev: { ...r }, t0: performance.now(), owned: [] };
    if (model) {
      // glTF: отдельный клон на солдата со своим микшером анимаций
      for (let i = 0; i < r.menMax; i += 1) {
        const obj = SkeletonUtils.clone(model.gltf.scene); obj.scale.setScalar(model.scale ?? 1);
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const mixer = new THREE.AnimationMixer(obj);
        const clip = (name) => model.gltf.animations.find((a) => a.name === (model.clips?.[name] ?? name));
        entry.soldiers.push({ obj, mixer, actions: Object.fromEntries(['idle', 'walk', 'run', 'attack', 'die'].map((k) => [k, clip(k) ? mixer.clipAction(clip(k)) : null])), playing: null });
        group.add(obj);
      }
    } else {
      const shade = new THREE.Color();
      for (const p of mergedParts(r.type, color)) {
        const mesh = new THREE.InstancedMesh(p.geo, p.metal ? SHINY : MATTE, r.menMax);
        for (let i = 0; i < r.menMax; i += 1) mesh.setColorAt(i, shade.setScalar(0.88 + hash(i, 31) * 0.12));
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
        group.add(mesh); entry.meshes.push(mesh); entry.parts.push(p); entry.owned.push(p.geo);
      }
    }
    // знамя полка (нобори) на перекладине; полотно колышется
    const flagGeo = new THREE.PlaneGeometry(1.4, 3.6, 6, 1).translate(0.75, 5, 0);
    entry.flagBase = flagGeo.attributes.position.array.slice();
    const flagMat = new THREE.MeshStandardMaterial({ map: monTexture(colorOf(r.owner)), side: THREE.DoubleSide, roughness: 0.75 });
    const pole = new THREE.Mesh(cyl(0.05, 0.05, 7, 0, 3.5, 0, 6), WOOD);
    const flag = new THREE.Mesh(flagGeo, flagMat);
    const crossbar = new THREE.Mesh(cyl(0.03, 0.03, 1.5, 0, 0, 0, 4).rotateZ(Math.PI / 2).translate(0.75, 6.82, 0), WOOD);
    const banner = new THREE.Group(); banner.add(pole, flag, crossbar); pole.castShadow = flag.castShadow = true;
    entry.owned.push(flagGeo, flagMat, pole.geometry, crossbar.geometry);
    if (!['tank', 'helicopter', 'drone', 'fighter', 'biplane', 'artillery'].includes(r.type)) group.add(banner);
    entry.banner = banner; entry.flag = flag;
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffe8a0', transparent: true, opacity: 0.75, depthWrite: false, depthTest: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.045, 64).rotateX(-Math.PI / 2), ringMat);
    ring.visible = false; ring.renderOrder = 10; group.add(ring); entry.ring = ring; entry.owned.push(ring.geometry, ringMat);
    // мягкая тень-контакт под строем: бойцы не «висят» над рельефом
    const ao = new THREE.Mesh(aoGeo, aoMat); ao.renderOrder = 1; group.add(ao); entry.ao = ao;
    // линия приказа: от полка к цели или точке марша
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const lineMat = new THREE.LineDashedMaterial({ color: '#ffe8a0', dashSize: 3, gapSize: 2, transparent: true, opacity: 0.85, depthTest: false });
    const line = new THREE.Line(lineGeo, lineMat); line.visible = false; line.renderOrder = 11; line.frustumCulled = false;
    scene.add(line); entry.line = line; entry.owned.push(lineGeo, lineMat);
    const headMat = new THREE.MeshBasicMaterial({ color: '#ffe8a0', transparent: true, depthTest: false });
    const head = new THREE.Mesh(headGeo, headMat); head.renderOrder = 11; head.visible = false; scene.add(head); entry.head = head; entry.owned.push(headMat);
    scene.add(group);
    regs.set(r.id, entry);
    return entry;
  }
  function dropRegiment(e) {
    scene.remove(e.group); scene.remove(e.line); scene.remove(e.head);
    for (const x of e.owned) x.dispose?.();
    for (const m of e.meshes) m.dispose();
  }

  /** Позиции солдат полка: шеренги по строю, лёгкий разброс, в рукопашной — свалка. */
  const slotBuf = [];
  function slotsOf(r, time, out = slotBuf) {
    const files = Math.max(1, r.files); const sp = (r.w / files) || 1.3;
    const chaos = r.engaged ? 1.1 : r.state === 'rout' ? 6 : 0.22;
    const cos = Math.cos(r.facing); const sin = Math.sin(r.facing);
    out.length = r.men;
    for (let i = 0; i < r.men; i += 1) {
      const file = i % files; const rank = Math.floor(i / files);
      let lx = (file - (files - 1) / 2) * sp + (hash(i, 1) - 0.5) * sp * chaos;
      let ly = -rank * sp + (hash(i, 2) - 0.5) * sp * chaos;
      if (r.engaged && rank === 0) ly += 0.6 + Math.sin(time * 3 + i) * 0.4; // передняя шеренга рубится
      if (r.state === 'rout') { lx *= 1.8; ly *= 2.5; }
      const s = out[i] ?? (out[i] = [0, 0]);
      s[0] = r.x + ly * cos - lx * sin; s[1] = r.y + ly * sin + lx * cos;
    }
    return out;
  }

  const bodyM = new THREE.Matrix4(); const bodyQ = new THREE.Quaternion(); const bodyV = new THREE.Vector3(); const bodyS = new THREE.Vector3(1, 1, 1); const bodyC = new THREE.Color(); const dark = new THREE.Color('#1e1a16'); const upY = new THREE.Vector3(0, 1, 0);
  function update(v) {
    if (!v) return;
    clock = performance.now() / 1000; // эффекты из этого снимка отсчитываются от текущего времени
    const first = !view;
    if (v.terrain) terrain = v.terrain;
    view = v; field = v.field;
    if (v.id !== terrainKey && terrain) { terrainKey = v.id; for (const e of regs.values()) dropRegiment(e); regs.clear(); buildTerrain(terrain); }
    const now = performance.now();
    for (const r of v.regiments) {
      let e = regs.get(r.id);
      if (!e || e.rebuild) { if (e) dropRegiment(e); e = makeRegiment(r); e.prev = { ...r }; }
      else e.prev = interp(e, now);
      // павшие: убыль солдат ложится телами у передней шеренги
      const lost = (e.cur.men ?? r.men) - r.men;
      if (lost > 0 && bodies.meshes) {
        const slots = slotsOf(e.cur, now / 1000, []);
        for (let k = 0; k < lost && bodies.count < 4000; k += 1) {
          const n = bodies.count;
          const [x, y] = slots[Math.floor(hash(n, 77) * Math.min(slots.length, Math.max(1, e.cur.files ?? 10)))] ?? [r.x, r.y];
          const jx = x + (hash(n, 5) - 0.5) * 2; const jy = y + (hash(n, 6) - 0.5) * 2;
          bodyQ.setFromAxisAngle(upY, hash(n, 9) * 6.28);
          bodyM.compose(fieldToWorld(jx, jy, H(jx, jy), bodyV), bodyQ, bodyS);
          bodies.meshes.setMatrixAt(n, bodyM);
          bodies.falling.push({ n, x: jx, y: jy, yaw: hash(n, 9) * 6.28, born: now / 1000 + hash(n, 13) * 0.3 }); // падает, а не появляется лёжа
          bodies.meshes.setColorAt(n, bodyC.copy(e.color).multiplyScalar(0.3).lerp(dark, 0.5));
          bodyV.y += 0.04; bodyM.compose(bodyV, bodyQ, bodyS.set(0.8 + hash(n, 2) * 0.8, 1, 0.8 + hash(n, 3) * 0.8)); bodyS.set(1, 1, 1);
          bodies.stains.setMatrixAt(n, bodyM);
          bodies.count += 1;
        }
        bodies.meshes.count = bodies.stains.count = bodies.count;
        bodies.meshes.instanceMatrix.needsUpdate = true; bodies.stains.instanceMatrix.needsUpdate = true;
        if (bodies.meshes.instanceColor) bodies.meshes.instanceColor.needsUpdate = true;
      }
      e.cur = { ...r }; e.t0 = now;
    }
    // эффекты: новые выстрелы; выстрел из прошлого кадра появляется уже в полёте
    let newest = lastFxTick;
    for (const f of v.fx) if (f.t > newest) newest = f.t;
    for (const f of v.fx) {
      if (f.t <= lastFxTick) continue;
      const from = v.regiments.find((r) => r.id === f.from); const to = v.regiments.find((r) => r.id === f.to);
      if (from && to) spawnFx(f.kind, from, to, f.t, (newest - f.t) * 0.2);
    }
    lastFxTick = newest;
    if (first) {
      const mine = v.regiments.filter((r) => r.side === (v.human ?? 'a'));
      const cx = mine.reduce((s, r) => s + r.x, 0) / Math.max(1, mine.length);
      cam.target.set(cx, 0, -(mine[0]?.y ?? -130) - 70); cam.yaw = 0;
    }
  }

  const interp = (e, now) => {
    const k = Math.min(1, (now - e.t0) / 110); // кадры сервера каждые 100 мс
    const a = e.prev; const b = e.cur;
    let df = b.facing - a.facing; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI;
    return { ...b, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, facing: a.facing + df * k };
  };

  const fxS = new THREE.Vector3(); const fxT = new THREE.Vector3();
  function spawnFx(kind, from, to, tick, age = 0) {
    const n = kind === 'arrow' ? Math.min(16, Math.ceil(from.men / 2.5)) : kind === 'bullet' ? Math.min(10, Math.ceil(from.men / 4)) : 1;
    for (let i = 0; i < n; i += 1) {
      const sx = from.x + (hash(tick, i) - 0.5) * from.w; const sy = from.y + (hash(tick, i + 40) - 0.5) * 2;
      const tx = to.x + (hash(tick, i + 80) - 0.5) * to.w; const ty = to.y + (hash(tick, i + 120) - 0.5) * (to.d + 4);
      const life = kind === 'arrow' ? 1.6 : kind === 'bullet' ? 0.2 : kind === 'rocket' ? 0.9 : 0.7;
      const isArrow = kind === 'arrow';
      const obj = pool(isArrow ? 'arrow' : 'tracer', () => new THREE.Mesh(isArrow ? arrowGeo : tracerGeo, isArrow ? arrowMat : tracerMat), isArrow ? 400 : 200);
      const born = clock - age + hash(tick, i + 7) * (isArrow ? 0.25 : 0.1);
      const s = fieldToWorld(sx, sy, H(sx, sy) + 1.5 + (AIR_ALT[from.type] ?? 0), fxS.clone());
      const t = fieldToWorld(tx, ty, H(tx, ty) + 0.8 + (AIR_ALT[to.type] ?? 0), fxT.clone());
      if (obj) { obj.scale.set(1, 1, kind === 'bullet' ? 5 : kind === 'arrow' ? 1 : 2.5); live.push({ key: isArrow ? 'arrow' : 'tracer', obj, born, life, kind, s, t, boom: kind === 'shell' || kind === 'rocket' }); }
      if (!isArrow && clock - born < 0.3) {
        spritePuff('flash', s.clone(), kind === 'shell' ? 5 : 1.4, 0.1, { additive: true, delay: born - clock });
        spritePuff('smoke', s.clone().add(new THREE.Vector3(0, 0.3, 0)), kind === 'shell' ? 4 : 1.2, 2.2, { delay: born - clock, rise: 2, opacity: 0.6 });
      }
    }
  }

  const fxP = new THREE.Vector3(); const fxA = new THREE.Vector3();
  function animateFx(time, dt) {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const f = live[i]; const k = (time - f.born) / f.life;
      if (k < 0) { f.obj.visible = false; continue; }
      if (k >= 1) {
        release(f.key, f.obj);
        if (f.boom) explode(f.t);
        live.splice(i, 1); continue;
      }
      f.obj.visible = true;
      if (f.kind === 'puff') {
        f.obj.scale.setScalar(f.size * (1 + k * 1.4));
        f.obj.position.y += dt * f.rise;
        f.obj.material.opacity = f.opacity * Math.min(1, k * 8) * (1 - k);
        f.obj.material.rotation += dt * (f.spin ?? 0.25); // клубы дыма медленно вращаются
        continue;
      }
      if (f.kind === 'ring') { f.obj.scale.setScalar(1 + k * 16); f.obj.material.opacity = 0.7 * (1 - k); continue; }
      if (f.kind === 'debris') { f.v.y -= 22 * dt; f.obj.position.addScaledVector(f.v, dt); f.obj.rotation.x += dt * 6; if (f.obj.position.y < H(f.obj.position.x, -f.obj.position.z)) f.obj.visible = false; continue; }
      const arc = f.kind === 'arrow' ? f.s.distanceTo(f.t) * 0.28 : 0;
      fxP.copy(f.s).lerp(f.t, k); fxP.y += Math.sin(k * Math.PI) * arc;
      const k2 = Math.min(1, k + 0.02); fxA.copy(f.s).lerp(f.t, k2); fxA.y += Math.sin(k2 * Math.PI) * arc;
      f.obj.position.copy(fxP); f.obj.lookAt(fxA);
    }
  }

  // ---------- анимация солдат: без аллокаций в цикле ----------
  const m4 = new THREE.Matrix4(); const base = new THREE.Matrix4(); const local = new THREE.Matrix4(); const rot = new THREE.Matrix4();
  const q = new THREE.Quaternion(); const eul = new THREE.Euler(); const v3 = new THREE.Vector3(); const sc3 = new THREE.Vector3();
  const dustV = new THREE.Vector3();
  const frustum = new THREE.Frustum(); const projM = new THREE.Matrix4(); const sphere = new THREE.Sphere();
  function animateRegiment(e, time, now) {
    const r = interp(e, now);
    const hidden = r.state === 'fled' || r.state === 'dead' || r.men === 0;
    e.group.visible = !hidden;
    const sel = e.ring.visible;
    if (hidden) { e.line.visible = false; e.head.visible = false; return; }
    const air = AIR_ALT[r.type] ?? 0;
    const hb = H(r.x, r.y);
    sphere.center.set(r.x, hb + air, -r.y); sphere.radius = Math.max(r.w, r.d) + 10;
    const visible = frustum.intersectsSphere(sphere);
    e.group.visible = visible; // вне кадра полк не рисуется вовсе
    const far = camera.position.distanceTo(sphere.center) > 320; // дальний план: без анимации конечностей
    const moving = Math.hypot(e.cur.x - e.prev.x, e.cur.y - e.prev.y) > 0.05 || r.state === 'rout';
    const yawBase = Math.atan2(Math.cos(r.facing), -Math.sin(r.facing)); // facing на поле → поворот модели вокруг Y
    const target = r.target ? view.regiments.find((x) => x.id === r.target) : null;
    const aimAt = r.aim ? view.regiments.find((x) => x.id === r.aim) : null; // целимся только в того, по кому реально стреляем
    const aim = aimAt ? Math.atan2(Math.cos(Math.atan2(aimAt.y - r.y, aimAt.x - r.x)), -Math.sin(Math.atan2(aimAt.y - r.y, aimAt.x - r.x))) - yawBase : 0;
    if (visible && (!far || (Math.floor(time * 10) + e.id.length) % 3 === 0)) {
      const slots = slotsOf(r, time);
      if (e.soldiers.length) {
        e.soldiers.forEach((s, i) => {
          s.obj.visible = i < slots.length;
          if (!s.obj.visible) return;
          const [x, y] = slots[i];
          fieldToWorld(x, y, H(x, y) + air, s.obj.position); s.obj.rotation.y = yawBase + (r.state === 'rout' ? Math.PI : 0);
          const want = r.engaged ? 'attack' : moving ? (r.state === 'rout' ? 'run' : 'walk') : 'idle';
          const act = s.actions[want] ?? s.actions.idle;
          if (act && s.playing !== act) { s.playing?.fadeOut(0.2); act.reset().fadeIn(0.2).play(); act.time = hash(i, 3) * act.getClip().duration; s.playing = act; }
          s.mixer.update(1 / 60);
        });
      } else {
        e.meshes.forEach((mesh, pi) => {
          const p = e.parts[pi];
          mesh.count = slots.length;
          for (let i = 0; i < slots.length; i += 1) {
            const [x, y] = slots[i];
            const ph = time * (r.state === 'rout' ? 9 : r.run ? 8 : 6) * (0.8 + hash(i, 12) * 0.45) + hash(i, 4) * 6.28; // у каждого свой темп: свалка не синхронна
            const yaw = yawBase + (r.state === 'rout' ? Math.PI : 0) + (r.engaged ? (hash(i, 8) - 0.5) * 0.8 : (hash(i, 8) - 0.5) * 0.08);
            const bob = moving ? Math.abs(Math.sin(ph)) * 0.06 : 0;
            const roll = air && r.type !== 'helicopter' ? Math.sin(time * 0.7 + i) * 0.3 : 0;
            const foot = !air && r.type !== 'tank' && r.type !== 'artillery';
            // наклон корпуса: бегом вперёд, в рукопашной — на удар, у бегущих — назад через плечо
            const lean = !foot || far ? 0 : r.engaged ? 0.12 + Math.max(0, Math.sin(ph * 1.3)) * 0.18 : r.state === 'rout' ? 0.25 : moving ? (r.run ? 0.2 : 0.07) : 0;
            q.setFromEuler(eul.set(lean, yaw, roll + (foot ? (hash(i, 23) - 0.5) * 0.06 : 0), 'YXZ'));
            const tall = foot ? 0.93 + hash(i, 21) * 0.14 : 1;
            const wide = foot ? 0.92 + hash(i, 22) * 0.16 : 1;
            const lunge = r.engaged && !far ? Math.max(0, Math.sin(ph * 1.3)) * 0.35 : 0; // выпад корпусом на удар
            base.compose(fieldToWorld(x + Math.cos(r.facing) * lunge, y + Math.sin(r.facing) * lunge, H(x, y) + bob + air + (air ? Math.sin(time + i) * 1.5 : 0), v3), q, sc3.set(tall * wide, tall, tall * wide));
            const swing = far ? 0 : 1;
            if (p.at) local.copy(p.at); else local.identity();
            switch (p.anim) {
              case 'legL': local.multiply(rot.makeRotationX(moving ? Math.sin(ph) * 0.6 * swing : 0)); break;
              case 'legR': local.multiply(rot.makeRotationX(moving ? -Math.sin(ph) * 0.6 * swing : 0)); break;
              case 'armL': local.multiply(rot.makeRotationX((r.engaged ? -1.1 + Math.sin(ph) * 0.4 : moving ? -Math.sin(ph) * 0.45 : -0.15) * swing)); break;
              case 'armR': local.multiply(rot.makeRotationX((r.engaged ? -1.6 + Math.sin(ph * 1.3) * 0.9 : moving ? Math.sin(ph) * 0.45 : -0.5) * swing)); break;
              case 'spear': local.multiply(rot.makeRotationX(r.engaged ? 1.25 + Math.sin(ph) * 0.25 * swing : r.order === 'attack' && !moving ? 1.3 : 0.12)); break;
              case 'sword': local.multiply(rot.makeRotationX(r.engaged ? -2.2 + Math.sin(ph * 1.3) * 1.1 * swing : -0.5)); break;
              case 'rifle': local.multiply(rot.makeRotationX(r.aim && !moving ? -0.05 : -0.9)); break;
              case 'recoil': local.makeTranslation(0, 0, -Math.max(0, Math.sin(time * 1.3 + i)) * 0.4); break;
              case 'rotor': local.makeRotationY(time * 22); break;
              case 'turret': local.makeRotationY(aim); break; // башня смотрит на цель, а не по синусоиде
              default: break;
            }
            m4.multiplyMatrices(base, local);
            mesh.setMatrixAt(i, m4);
          }
          mesh.instanceMatrix.needsUpdate = true;
        });
      }
      if (moving && !air && r.men > 0 && hash(Math.floor(time * 4), e.id.length * 13 + (r.x | 0)) < 0.2) spritePuff('dust', fieldToWorld(r.x, r.y, hb + 0.8, dustV), Math.max(6, r.w * 0.5), 2.4, { rise: 1.2, opacity: 0.45 });
    }
    // знамя и колыхание полотна
    fieldToWorld(r.x - Math.cos(r.facing) * (r.d / 2 + 1.5), r.y - Math.sin(r.facing) * (r.d / 2 + 1.5), hb, e.banner.position);
    e.banner.rotation.y = yawBase;
    if (visible && !far) {
      const pos = e.flag.geometry.attributes.position; const b = e.flagBase;
      for (let i = 0; i < pos.count; i += 1) { const x = b[i * 3]; pos.array[i * 3 + 2] = Math.sin(time * 3 + x * 2.6 + e.id.length) * 0.22 * (x / 1.4); }
      pos.needsUpdate = true;
    }
    fieldToWorld(r.x, r.y, hb + 0.15, e.ao.position); e.ao.rotation.y = yawBase; e.ao.scale.set(r.w + 4, 1, r.d + 4); e.ao.visible = !air;
    fieldToWorld(r.x, r.y, hb + 0.3, e.ring.position); e.ring.scale.setScalar(Math.max(r.w, r.d) * 0.48 + 1);
    // линия приказа у выбранного полка
    const goal = r.dest ? { x: r.dest[0], y: r.dest[1] } : target && r.order === 'attack' ? target : null;
    e.line.visible = Boolean(goal) && (sel || r.side === (view.human ?? 'a')) && visible; // свои приказы видны всегда, выбранные — ярче
    e.line.material.opacity = sel ? 0.9 : 0.3;
    e.head.visible = e.line.visible;
    if (e.line.visible) {
      fieldToWorld(goal.x, goal.y, H(goal.x, goal.y) + 0.6, e.head.position);
      e.head.lookAt(fieldToWorld(r.x, r.y, hb + 0.6, v3)); e.head.rotateY(Math.PI); // наконечник смотрит от полка к цели
      e.head.material.opacity = e.line.material.opacity;
      const pts = e.line.geometry.attributes.position;
      pts.setXYZ(0, r.x, hb + 0.6, -r.y); pts.setXYZ(1, goal.x, H(goal.x, goal.y) + 0.6, -goal.y); pts.needsUpdate = true;
      e.line.computeLineDistances(); e.line.material.color.set(r.order === 'attack' ? '#ff8a6e' : r.run ? '#ffd166' : '#ffe8a0'); e.head.material.color.copy(e.line.material.color);
    }
  }

  // павшие падают за 0,6 с: от вертикали к земле, с лёгким креном
  const fallM = new THREE.Matrix4(); const fallQ = new THREE.Quaternion(); const fallE = new THREE.Euler(); const fallV = new THREE.Vector3(); const one3 = new THREE.Vector3(1, 1, 1);
  function animateBodies() {
    if (!bodies.falling.length) return;
    for (let i = bodies.falling.length - 1; i >= 0; i -= 1) {
      const b = bodies.falling[i]; const k = Math.min(1, Math.max(0, (clock - b.born) / 0.6));
      const ease = k * k * (3 - 2 * k);
      fallQ.setFromEuler(fallE.set(-(1 - ease) * Math.PI / 2, b.yaw, (1 - ease) * 0.3, 'YXZ'));
      fieldToWorld(b.x, b.y, H(b.x, b.y) + (1 - ease) * 0.9, fallV);
      fallM.compose(fallV, fallQ, one3);
      bodies.meshes.setMatrixAt(b.n, fallM);
      if (k >= 1) bodies.falling.splice(i, 1);
    }
    bodies.meshes.instanceMatrix.needsUpdate = true;
  }

  // маркеры приказов: вспышка-кольцо в точке на 1,2 с, сразу по клику (до ответа сервера)
  const markers = [];
  const markerGeo = track(new THREE.RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2));
  const ORDER_COLORS = { attack: '#ff6b4e', run: '#ffd166', move: '#ffe8a0', reject: '#ff2a2a' };
  function showOrder(x, y, kind = 'move') {
    const mk = pool('marker', () => { const o = new THREE.Mesh(markerGeo, track(new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }))); o.renderOrder = 12; return o; }, 16);
    if (!mk) return;
    mk.material.color.set(ORDER_COLORS[kind] ?? ORDER_COLORS.move);
    fieldToWorld(x, y, H(x, y) + 0.4, mk.position); mk.visible = true;
    markers.push({ mk, born: clock });
  }
  function animateMarkers() {
    for (let i = markers.length - 1; i >= 0; i -= 1) {
      const m = markers[i]; const k = (clock - m.born) / 1.2;
      if (k >= 1) { release('marker', m.mk); markers.splice(i, 1); continue; }
      m.mk.scale.setScalar(2 + 5 * (1 - (1 - k) ** 3)); m.mk.material.opacity = 1 - k;
    }
  }

  function resize() {
    const w = container.clientWidth || window.innerWidth; const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function placeCamera() {
    cam.target.x = Math.max(-field.w * 0.75, Math.min(field.w * 0.75, cam.target.x));
    cam.target.z = Math.max(-field.h * 0.75, Math.min(field.h * 0.75, cam.target.z));
    const ground = terrain ? H(cam.target.x, -cam.target.z) : 0;
    const off = v3.set(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)).multiplyScalar(cam.dist);
    camera.position.copy(cam.target).add(off); camera.position.y += ground;
    const under = terrain ? groundHeight(terrain, field, camera.position.x, -camera.position.z) + 3 : 0;
    if (camera.position.y < under) camera.position.y = under;
    camera.lookAt(cam.target.x, ground + 2, cam.target.z);
  }

  // управление камерой в общем цикле кадра: WASD/стрелки, Q/E, колесо, средняя кнопка, край экрана
  const keys = new Set();
  let mouse = null;
  function moveCamera(dt) {
    const s = cam.dist * 0.9 * dt;
    const fx = -Math.sin(cam.yaw); const fz = -Math.cos(cam.yaw);
    let dx = 0; let dz = 0;
    if (keys.has('w') || keys.has('arrowup') || keys.has('ц')) { dx += fx; dz += fz; }
    if (keys.has('s') || keys.has('arrowdown') || keys.has('ы')) { dx -= fx; dz -= fz; }
    if (keys.has('a') || keys.has('arrowleft') || keys.has('ф')) { dx += fz; dz -= fx; }
    if (keys.has('d') || keys.has('arrowright') || keys.has('в')) { dx -= fz; dz += fx; }
    if (mouse) {
      const edge = 24; const w = window.innerWidth; const h = window.innerHeight;
      if (mouse.x < edge) { dx += fz; dz -= fx; } else if (mouse.x > w - edge) { dx -= fz; dz += fx; }
      if (mouse.y < edge) { dx += fx; dz += fz; } else if (mouse.y > h - edge) { dx -= fx; dz -= fz; }
    }
    cam.target.x += dx * s; cam.target.z += dz * s;
    if (keys.has('q') || keys.has('й')) cam.yaw += 1.6 * dt;
    if (keys.has('e') || keys.has('у')) cam.yaw -= 1.6 * dt;
  }

  // кольца дальности стрельбы у выбранных стрелков, лучников, батарей и техники
  let rangeIds = [];
  const rangeGeo = track(new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2));
  const rangeMeshes = [];
  function animateRanges() {
    let n = 0;
    for (const id of rangeIds) {
      const e = regs.get(id); const r = e && interp(e, performance.now());
      if (!r || !r.range || r.state === 'dead' || r.state === 'fled') continue;
      let m = rangeMeshes[n];
      if (!m) { m = new THREE.Mesh(rangeGeo, track(new THREE.MeshBasicMaterial({ color: '#9fd3ff', transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }))); m.renderOrder = 9; scene.add(m); rangeMeshes[n] = m; }
      fieldToWorld(r.x, r.y, H(r.x, r.y) + 0.5, m.position); m.scale.setScalar(r.range); m.visible = true; n += 1;
    }
    for (let i = n; i < rangeMeshes.length; i += 1) rangeMeshes[i].visible = false;
  }

  // адаптивное качество: если кадр стабильно дольше 22 мс, снижаем DPR, затем bloom и тени
  const perf = { acc: 0, n: 0, level: 0 };
  function adapt(cpu) {
    // меряем время самого кадра (CPU), а не интервал rAF: при 60 Гц интервал всегда ~16 мс
    perf.acc += cpu / 1000; perf.n += 1;
    if (perf.n < 120) return;
    const avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0;
    if (avg < 0.008 && perf.level > 0) { // запас появился: возвращаем качество по одной ступени
      if (perf.level === 3) { sun.castShadow = true; renderer.shadowMap.enabled = true; }
      if (perf.level === 2) bloom.enabled = true;
      if (perf.level === 1) { renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); resize(); }
      perf.level -= 1; return;
    }
    if (avg > 0.02 && perf.level < 3) {
      perf.level += 1;
      if (perf.level === 1) { renderer.setPixelRatio(1); resize(); }
      if (perf.level === 2) bloom.enabled = false;
      if (perf.level === 3) { sun.castShadow = false; renderer.shadowMap.enabled = false; }
    }
  }

  let clock = 0; let lastT = 0;
  function frame(time = performance.now()) {
    const t = time / 1000; const dt = Math.min(0.1, lastT ? t - lastT : 1 / 60); lastT = t; clock = t;
    const cpu0 = performance.now();
    animateRanges();
    moveCamera(dt);
    placeCamera();
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const e of regs.values()) animateRegiment(e, t, time);
    animateFx(t, dt);
    animateBodies();
    animateMarkers();
    composer.render(dt);
    if (running) adapt(performance.now() - cpu0);
  }
  let raf = 0; let running = false;
  function loop(t) { if (!running) return; frame(t); raf = requestAnimationFrame(loop); }

  const onKey = (e) => { if (e.target.closest?.('input,textarea')) return; const k = e.key.toLowerCase(); if (e.type === 'keydown') keys.add(k); else keys.delete(k); };
  const onBlur = () => keys.clear();
  const onWheel = (e) => { e.preventDefault(); cam.dist = Math.min(600, Math.max(16, cam.dist * (e.deltaY > 0 ? 1.12 : 0.89))); cam.pitch = 0.22 + Math.min(0.9, cam.dist / 480); };
  let drag = null;
  const onDown = (e) => { if (e.button === 1) { e.preventDefault(); drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }; } };
  // край экрана двигает камеру только над полем, не над панелями
  const onMove = (e) => { mouse = e.target === renderer.domElement ? { x: e.clientX, y: e.clientY } : null; if (drag) { cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.005; cam.pitch = Math.min(1.4, Math.max(0.1, drag.pitch + (e.clientY - drag.y) * 0.004)); } };
  const onUp = () => { drag = null; };
  const onLeave = () => { mouse = null; };
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey); window.addEventListener('blur', onBlur);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
  renderer.domElement.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  document.addEventListener('mouseleave', onLeave);
  window.addEventListener('resize', resize);

  /** Экран → координаты поля: луч против рельефа (марш по лучу), без перебора 30 тыс. треугольников. */
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); const rp = new THREE.Vector3();
  function pickField(clientX, clientY) {
    if (!terrain) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin; const d = ray.ray.direction;
    let lo = 0; let hi = 0; let hit = false;
    for (let s = 0; s < 4000; s += 4) {
      rp.copy(o).addScaledVector(d, s);
      if (rp.y <= groundHeight(terrain, field, rp.x, -rp.z)) { lo = Math.max(0, s - 4); hi = s; hit = true; break; }
    }
    if (!hit) return null; // луч ушёл в небо: приказа нет
    for (let k = 0; k < 12; k += 1) { const mid = (lo + hi) / 2; rp.copy(o).addScaledVector(d, mid); if (rp.y > groundHeight(terrain, field, rp.x, -rp.z)) lo = mid; else hi = mid; }
    rp.copy(o).addScaledVector(d, hi);
    if (Math.abs(rp.x) > field.w / 2 || Math.abs(rp.z) > field.h / 2) return null; // за пределами поля боя
    return { x: rp.x, y: -rp.z };
  }
  /** Ближайший полк к точке поля (в пределах его строя). */
  function regimentAt(p, side = null) {
    let best = null; let bd = Infinity;
    for (const r of view?.regiments ?? []) {
      if (side && r.side !== side) continue;
      if (r.state === 'dead' || r.state === 'fled') continue;
      const d = Math.hypot(r.x - p.x, r.y - p.y) - Math.max(r.w, r.d) / 2;
      if (d < bd) { bd = d; best = r; }
    }
    return bd < 12 ? best : null;
  }
  const sv = new THREE.Vector3();
  function screenOf(r) {
    const e = regs.get(r.id); const cur = e ? interp(e, performance.now()) : r;
    fieldToWorld(cur.x, cur.y, H(cur.x, cur.y) + 9 + (AIR_ALT[r.type] ?? 0), sv).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (sv.x + 1) / 2 * rect.width, y: rect.top + (1 - sv.y) / 2 * rect.height, visible: sv.z < 1 && Math.abs(sv.x) < 1.1 && Math.abs(sv.y) < 1.1, dist: camera.position.distanceTo(fieldToWorld(cur.x, cur.y, H(cur.x, cur.y), rp)) };
  }

  resize();
  return {
    update, frame, resize, pickField, regimentAt, screenOf, showOrder, camera: cam, renderer,
    get field() { return field; }, get terrain() { return terrain; },
    /** Видимая область земли (м) для рамки миникарты. */
    viewSize() { const h = 2 * cam.dist * Math.tan((camera.fov * Math.PI) / 360) / Math.max(0.35, Math.sin(cam.pitch)); return { w: h * camera.aspect * 0.8, h: h * 0.8, yaw: cam.yaw }; },
    /** Кольцо дальности стрельбы вокруг выбранных стрелков. */
    showRange(ids) { rangeIds = ids; },
    focus(x, y) { cam.target.set(x, 0, -y + 40); },
    select(ids) { for (const e of regs.values()) e.ring.visible = ids.includes(e.id); },
    start() { running = true; raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    dispose() {
      running = false; cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('resize', resize);
      document.removeEventListener('mouseleave', onLeave);
      for (const e of regs.values()) dropRegiment(e);
      scene.traverse((o) => { if (o.geometry !== aoGeo && o.geometry !== headGeo) o.geometry?.dispose?.(); if (o.material && !Array.isArray(o.material) && !SHARED.has(o.material)) o.material.dispose?.(); });
      for (const x of disposables) x.dispose?.();
      composer.dispose?.(); rt.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
