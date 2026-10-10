// Процедурные модели полков для сцены боя (battle/view.js): солдаты эпохи Сэнгоку, пехота,
// орудия и техника. Всё собрано из примитивов three.js в коде, без сторонних ассетов.
// Модель смотрит в +Z, стоит на y = 0, единица — метр. Каждая часть: geo, c (ключ палитры
// или 'team' — цвет нации), anim (body|legL|legR|armL|armR|spear|sword|bow|rifle|recoil|turret|rotor|static)
// и at — точка шарнира для подвижных частей.
import * as THREE from 'three';

export const C = {
  skin: '#c4946c', cloth: '#2c2a27', hakama: '#2f2c3a', lacquer: '#2b2422', lacquer2: '#5a2a22', steel: '#cdd2d8',
  wood: '#6b4a2b', darkwood: '#3d2a1a', olive: '#4f5a36', olive2: '#5d6842', dark: '#2a2d2e', straw: '#b39b62',
  gold: '#d4a640', khaki: '#7a734f', rubber: '#1b1c1c', white: '#e9e4d6', leather: '#5a3b24', hair: '#16120f',
  peasant: '#7d6c4c', glass: '#31404a',
};
export const METAL = new Set(['steel', 'gold', 'dark']);

const v3 = new THREE.Vector3();
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (rt, rb, h, x = 0, y = 0, z = 0, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(x, y, z);
const sph = (r, x = 0, y = 0, z = 0, ws = 10, hs = 8, theta = Math.PI) => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, theta).translate(x, y, z);
const P = (geo, c, anim = 'body', at) => ({ geo, c, anim, at });

/** Ноги с шарниром в бедре: бедро, голень (или поножи), стопа. */
function legs({ c = 'cloth', shin = null, wide = 0, boot = 'dark' } = {}) {
  return [-1, 1].flatMap((s) => {
    const anim = s < 0 ? 'legL' : 'legR'; const at = [s * 0.1, 0.88, 0];
    return [
      P(cyl(0.085 + wide, 0.072 + wide * 0.6, 0.46, 0, -0.22, 0, 7), c, anim, at),
      P(cyl(0.068, 0.056, 0.4, 0, -0.62, 0, 7), shin ?? c, anim, at),
      P(box(0.1, 0.07, 0.23, 0, -0.85, 0.045), boot, anim, at),
    ];
  });
}
/** Руки с шарниром в плече: плечо, предплечье, кисть; extra(s) — наплечники и наручи. */
function arms(c, extra = () => []) {
  return [-1, 1].flatMap((s) => {
    const anim = s < 0 ? 'armL' : 'armR'; const at = [s * 0.27, 1.45, 0];
    return [
      P(cyl(0.058, 0.05, 0.3, 0, -0.15, 0, 6), c, anim, at),
      P(cyl(0.05, 0.042, 0.27, 0, -0.44, 0, 6), c, anim, at),
      P(sph(0.046, 0, -0.61, 0.01, 6, 5), 'skin', anim, at),
      ...extra(s).map((p) => ({ ...p, anim, at })),
    ];
  });
}
/** Корпус, шея и голова с лицом. */
function body({ torso = 'cloth', belt = 'leather', head = true } = {}) {
  const parts = [
    P(cyl(0.17, 0.18, 0.2, 0, 0.95, 0, 8).scale(1, 1, 0.72), belt),
    P(cyl(0.2, 0.165, 0.5, 0, 1.24, 0, 8).scale(1, 1, 0.66), torso),
    P(cyl(0.05, 0.056, 0.09, 0, 1.52, 0, 6), 'skin'),
  ];
  if (head) parts.push(
    P(sph(0.108, 0, 1.64, 0.005, 12, 9).scale(0.94, 1.08, 1).translate(0, -0.13, 0), 'skin'),
    P(box(0.026, 0.045, 0.03, 0, 1.635, 0.105), 'skin'), // нос
    P(box(0.022, 0.012, 0.01, -0.038, 1.67, 0.097), 'hair'), P(box(0.022, 0.012, 0.01, 0.038, 1.67, 0.097), 'hair'), // глаза
  );
  return parts;
}
/** Флажок-сасимоно за спиной. */
const sashimono = () => [P(cyl(0.011, 0.011, 1.1, 0, 1.75, -0.17, 4), 'darkwood'), P(box(0.012, 0.46, 0.26, 0, 2.03, -0.31), 'team'), P(new THREE.CircleGeometry(0.07, 10).rotateY(Math.PI / 2).translate(0.008, 2.06, -0.31), 'white'), P(new THREE.CircleGeometry(0.07, 10).rotateY(-Math.PI / 2).translate(-0.008, 2.06, -0.31), 'white')];

/** Ламели доспеха: полосы шнуровки поверх корпуса. */
function lames(y0, y1, n, r0, r1, c) {
  const out = [];
  for (let k = 0; k < n; k += 1) {
    const t = k / Math.max(1, n - 1); const y = y0 + (y1 - y0) * t;
    out.push(P(cyl(r0 + (r1 - r0) * t + 0.008, r0 + (r1 - r0) * t + 0.006, 0.024, 0, y, 0, 8).scale(1, 1, 0.68), c));
  }
  return out;
}
/** Набедренные пластины (кусадзури) по кругу пояса. */
function kusazuri(c, lace) {
  const out = [];
  for (let k = 0; k < 6; k += 1) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const plate = box(0.15, 0.27, 0.025, 0, -0.13, 0).rotateX(-0.18).translate(0, 0.93, 0.17).rotateY(a);
    const band = box(0.152, 0.025, 0.03, 0, -0.05, 0).rotateX(-0.18).translate(0, 0.93, 0.175).rotateY(a);
    out.push(P(plate, c), P(band, lace));
  }
  return out.map((p) => ({ ...p, geo: p.geo.scale(1, 1, 0.8) }));
}

function samurai() {
  const kabuto = [
    P(sph(0.135, 0, 1.69, 0, 14, 7, Math.PI / 2), 'lacquer'),
    P(cyl(0.14, 0.23, 0.13, 0, 1.62, -0.015, 12, true), 'teamDark'), // сикоро
    P(cyl(0.232, 0.232, 0.02, 0, 1.556, -0.015, 12), 'team'),
    P(box(0.07, 0.07, 0.015, -0.14, 1.66, 0.08).rotateY(0), 'lacquer'), P(box(0.07, 0.07, 0.015, 0.14, 1.66, 0.08), 'lacquer'), // фукигаэси
    P(new THREE.TorusGeometry(0.15, 0.016, 4, 14, Math.PI).translate(0, 1.83, 0.11), 'gold'), // маэдатэ
    P(box(0.12, 0.065, 0.05, 0, 1.585, 0.085), 'lacquer2'), // мэмпо
  ];
  const sode = (s) => [P(box(0.06, 0.26, 0.22, s * 0.07, -0.1, 0), 'teamDark'), P(box(0.065, 0.025, 0.225, s * 0.072, -0.04, 0), 'team'), P(box(0.065, 0.025, 0.225, s * 0.072, -0.14, 0), 'team'), P(cyl(0.056, 0.05, 0.24, 0, -0.44, 0, 6), 'lacquer')];
  return [
    ...legs({ c: 'hakama', shin: 'lacquer', wide: 0.03 }),
    ...body({ torso: 'teamDark', belt: 'hakama' }), ...kabuto,
    ...lames(1.04, 1.44, 7, 0.17, 0.2, 'team'),
    ...kusazuri('teamDark', 'team'),
    ...arms('hakama', sode),
    // катана в правой руке: рукоять, цуба, клинок
    P(box(0.034, 0.22, 0.034, 0, -0.02, 0), 'cloth', 'sword', [0.3, 1.0, 0.22]),
    P(cyl(0.05, 0.05, 0.012, 0, 0.1, 0, 10), 'gold', 'sword', [0.3, 1.0, 0.22]),
    P(box(0.028, 0.86, 0.01, 0, 0.54, 0).translate(0, 0, 0), 'steel', 'sword', [0.3, 1.0, 0.22]),
    P(box(0.04, 0.85, 0.05, 0, 0, 0).rotateX(1.25).translate(-0.24, 0.98, -0.04), 'lacquer', 'body'), // сая
    ...sashimono(),
  ];
}
function ashigaru({ archer = false } = {}) {
  const hat = [P(new THREE.ConeGeometry(0.31, 0.12, 16).translate(0, 1.8, 0), 'lacquer'), P(cyl(0.05, 0.05, 0.005, 0, 1.808, 0.16, 8).rotateX(0.35), 'team')];
  const kote = (s) => [P(cyl(0.052, 0.046, 0.26, 0, -0.44, 0, 6), 'lacquer')];
  const parts = [
    ...legs({ c: 'cloth', shin: 'lacquer2' }),
    ...body({ torso: 'team', belt: 'cloth' }), ...hat,
    ...lames(1.08, 1.4, archer ? 2 : 3, 0.17, 0.2, 'lacquer'), // окэгава-до
    ...arms('cloth', kote),
    ...sashimono(),
  ];
  if (archer) {
    parts.push(
      P(new THREE.TorusGeometry(1.6, 0.014, 4, 24, 0.75).rotateZ(Math.PI - 0.375).translate(1.52, 0.2, 0).rotateY(Math.PI / 2), 'darkwood', 'bow', [-0.3, 1.3, 0.28]), // юми: длинная пологая дуга
      P(box(0.005, 1.15, 0.005, 0, 0.2, 0.06), 'white', 'bow', [-0.3, 1.3, 0.28]), // тетива
      P(box(0.16, 0.5, 0.1, 0.14, 1.22, -0.2).rotateZ(-0.2), 'leather'), // эбира
      ...[-0.04, 0, 0.04].map((dx) => P(box(0.012, 0.3, 0.012, 0.2 + dx, 1.58, -0.2), 'white')),
    );
  } else {
    parts.push(
      P(cyl(0.02, 0.02, 3.9, 0, 0, 0, 5), 'darkwood', 'spear', [0.3, 1.15, 0.12]),
      P(new THREE.ConeGeometry(0.035, 0.45, 4).translate(0, 2.17, 0), 'steel', 'spear', [0.3, 1.15, 0.12]),
      P(cyl(0.03, 0.03, 0.06, 0, 1.94, 0, 6), 'gold', 'spear', [0.3, 1.15, 0.12]),
    );
  }
  return parts;
}
function militia() {
  return [
    ...legs({ c: 'peasant', boot: 'straw' }),
    ...body({ torso: 'peasant', belt: 'team' }),
    P(new THREE.ConeGeometry(0.34, 0.16, 14).translate(0, 1.8, 0), 'straw'),
    ...arms('peasant'),
    P(cyl(0.02, 0.02, 2.5, 0, 0, 0, 5), 'wood', 'spear', [0.3, 1.1, 0.1]),
    P(box(0.08, 0.2, 0.01, 0, 1.3, 0), 'steel', 'spear', [0.3, 1.1, 0.1]), // нагината-серп
  ];
}
function rifleman() {
  const helmet = [P(sph(0.148, 0, 1.67, 0, 14, 7, Math.PI / 2).scale(1, 0.85, 1.05).translate(0, 0.25, 0), 'olive2'), P(cyl(0.2, 0.2, 0.018, 0, 1.665, 0.01, 14).scale(1, 1, 1.08), 'olive2')];
  return [
    ...legs({ c: 'olive', shin: 'khaki' }),
    ...body({ torso: 'olive', belt: 'khaki' }), ...helmet,
    P(box(0.05, 0.56, 0.02, -0.09, 1.25, 0.13).rotateZ(0.3), 'khaki'), P(box(0.05, 0.56, 0.02, 0.09, 1.25, 0.13).rotateZ(-0.3), 'khaki'), // ремни
    P(box(0.4, 0.1, 0.06, 0, 1.0, 0.13), 'khaki'), // подсумки
    P(box(0.32, 0.38, 0.18, 0, 1.24, -0.22), 'khaki'), P(cyl(0.06, 0.06, 0.34, 0, 1.47, -0.22, 8).rotateZ(Math.PI / 2).translate(0, 0, 0), 'olive2'), // ранец и скатка
    P(box(0.2, 0.05, 0.36, 0, 1.08, 0.0).scale(1, 1, 0.5), 'team'), // повязка
    ...arms('olive'),
    P(box(0.045, 0.07, 0.42, 0, -0.02, -0.12), 'wood', 'rifle', [0.18, 1.3, 0.15]),
    P(cyl(0.012, 0.012, 0.75, 0, 0, 0, 6).rotateX(Math.PI / 2).translate(0, 0.02, 0.43), 'dark', 'rifle', [0.18, 1.3, 0.15]),
    P(box(0.03, 0.08, 0.06, 0, -0.06, 0.12), 'dark', 'rifle', [0.18, 1.3, 0.15]),
    P(box(0.008, 0.008, 0.28, 0, 0.02, 0.92), 'steel', 'rifle', [0.18, 1.3, 0.15]), // штык
  ];
}

/** Форма гусеницы: стадион с длиной len и высотой h (в плоскости ZY). */
function trackShape(len, h) {
  const s = new THREE.Shape(); const r = h / 2;
  s.moveTo(-len / 2 + r, 0); s.lineTo(len / 2 - r, 0); s.absarc(len / 2 - r, r, r, -Math.PI / 2, Math.PI / 2); s.lineTo(-len / 2 + r, h); s.absarc(-len / 2 + r, r, r, Math.PI / 2, Math.PI * 1.5);
  return s;
}
const sideExtrude = (shape, width, x) => new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 6 }).rotateY(Math.PI / 2).translate(x - width / 2, 0, 0);
function tank() {
  const hull = new THREE.Shape(); // профиль корпуса сбоку: наклонный лоб, корма
  hull.moveTo(-3.1, 0.55); hull.lineTo(2.4, 0.55); hull.lineTo(3.25, 1.05); hull.lineTo(2.2, 1.55); hull.lineTo(-2.9, 1.55); hull.lineTo(-3.2, 1.1); hull.closePath();
  const parts = [P(sideExtrude(hull, 2.4, 0), 'olive')];
  for (const s of [-1, 1]) {
    parts.push(P(sideExtrude(trackShape(6.6, 1.0), 0.62, s * 1.48).translate(0, 0.0, 0), 'rubber'));
    for (let k = 0; k < 6; k += 1) parts.push(P(cyl(0.36, 0.36, 0.66, 0, 0, 0, 12).rotateZ(Math.PI / 2).translate(s * 1.48, 0.42, -2.45 + k * 0.98), 'dark'));
    parts.push(P(box(0.7, 0.06, 6.7, s * 1.5, 1.08, 0), 'olive2')); // надгусеничная полка
    parts.push(P(box(0.05, 0.42, 5.2, s * 1.86, 0.84, 0), 'team')); // экран с полосой нации
    parts.push(P(box(0.3, 0.4, 0.2, s * 0.8, 1.62, -2.6), 'olive2')); // канистры
  }
  parts.push(P(box(0.9, 0.25, 0.35, 0, 1.62, -2.95), 'dark')); // выхлоп
  // башня: граненая, с маской пушки, люком и антенной
  const turret = [
    P(cyl(1.05, 1.3, 0.75, 0, 1.92, -0.35, 8).rotateY(Math.PI / 8), 'olive'),
    P(box(0.9, 0.55, 0.5, 0, 1.92, 0.95), 'olive2'),
    P(cyl(0.38, 0.42, 0.22, 0.42, 2.4, -0.7, 10), 'olive2'),
    P(cyl(0.015, 0.015, 2.4, -0.6, 3.45, -1.1, 4), 'dark'),
    P(cyl(0.1, 0.13, 4.2, 0, 0, 0, 10).rotateX(Math.PI / 2).translate(0, 1.95, 3.2), 'dark'),
    P(cyl(0.18, 0.18, 0.45, 0, 0, 0, 10).rotateX(Math.PI / 2).translate(0, 1.95, 5.2), 'dark'),
    P(box(1.6, 0.06, 0.06, 0, 1.6, -1.3), 'team'),
  ];
  return [...parts, ...turret.map((p) => ({ ...p, anim: 'turret' }))];
}
function crew(x, z, yaw) {
  return [...legs({ c: 'olive' }), ...body({ torso: 'olive' }), P(sph(0.145, 0, 1.68, 0, 10, 6, Math.PI / 2), 'olive2'), ...arms('olive')]
    .map((p) => ({ geo: p.geo.clone().translate(...(p.at ?? [0, 0, 0])).rotateY(yaw).translate(x, 0, z), c: p.c, anim: 'static' }));
}
function artillery() {
  const wheel = (s) => [P(new THREE.TorusGeometry(0.6, 0.07, 6, 18).rotateY(Math.PI / 2).translate(s * 0.85, 0.62, 0), 'darkwood'),
    ...[0, 1, 2, 3, 4, 5].map((k) => P(box(0.04, 1.15, 0.05, 0, 0, 0).rotateX((k / 6) * Math.PI).translate(s * 0.85, 0.62, 0), 'wood')),
    P(cyl(0.1, 0.1, 0.2, 0, 0, 0, 8).rotateZ(Math.PI / 2).translate(s * 0.85, 0.62, 0), 'dark')];
  return [
    P(cyl(0.11, 0.16, 3.0, 0, 0, 0, 12).rotateX(Math.PI / 2 - 0.1).translate(0, 1.05, 0.9), 'dark', 'recoil'),
    P(cyl(0.08, 0.08, 1.6, 0, 0, 0, 8).rotateX(Math.PI / 2 - 0.1).translate(0, 0.86, 0.35), 'olive2', 'recoil'), // противооткатник
    P(box(1.7, 0.9, 0.06, 0, 1.15, 0.35).rotateX(-0.12), 'olive'), P(box(1.7, 0.12, 0.08, 0, 1.6, 0.3), 'team'), // щит
    P(box(0.5, 0.3, 0.8, 0, 0.8, 0), 'olive'),
    P(box(0.14, 0.14, 2.6, -0.35, 0.35, -1.4).rotateY(0.18), 'olive'), P(box(0.14, 0.14, 2.6, 0.35, 0.35, -1.4).rotateY(-0.18), 'olive'), // станины
    ...wheel(-1), ...wheel(1),
    ...crew(-1.4, -1.0, 0.4), ...crew(1.3, -1.5, -0.3), ...crew(0.4, -2.6, 0),
  ];
}
function helicopter() {
  return [
    P(new THREE.CapsuleGeometry(0.95, 3.0, 6, 12).rotateX(Math.PI / 2).scale(0.85, 1, 1), 'olive'),
    P(sph(0.8, 0, 0.15, 1.7, 12, 8).scale(0.9, 0.75, 1.1), 'glass'),
    P(cyl(0.18, 0.32, 5, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(0, 0.35, -4), 'olive'),
    P(box(0.08, 1.3, 0.9, 0, 0.9, -6.3), 'team'), P(box(1.8, 0.06, 0.5, 0, 0.4, -6.0), 'olive'),
    P(box(3.4, 0.12, 0.45, 0, -0.35, 0.2), 'dark'),
    ...[-1, 1].map((s) => P(cyl(0.14, 0.14, 1.2, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(s * 1.6, -0.55, 0.3), 'dark')), // ракетные блоки
    ...[-1, 1].map((s) => P(box(0.06, 0.06, 2.6, s * 0.7, -1.15, 0.2), 'dark')), // полозья
    P(cyl(0.25, 0.25, 0.35, 0, 1.0, 0, 10), 'dark'),
    P(box(12.5, 0.04, 0.34, 0, 1.22, 0), 'dark', 'rotor'), P(box(0.34, 0.04, 12.5, 0, 1.22, 0), 'dark', 'rotor'),
  ];
}
function plane() {
  return [
    P(new THREE.CapsuleGeometry(0.55, 6.2, 6, 12).rotateX(Math.PI / 2), 'olive'),
    P(sph(0.45, 0, 0.45, 1.6, 10, 8).scale(0.8, 0.7, 1.6), 'glass'),
    P(box(10, 0.1, 1.8, 0, -0.1, 0.2).scale(1, 1, 1), 'olive2'), P(box(2.4, 0.1, 1.82, 3.4, -0.1, 0.2), 'team'), P(box(2.4, 0.1, 1.82, -3.4, -0.1, 0.2), 'team'),
    P(box(3.4, 0.08, 0.9, 0, 0.15, -3.3), 'olive'), P(box(0.08, 1.4, 1.0, 0, 0.75, -3.4), 'olive'),
  ];
}

/** Павший: та же фигура, лежащая ничком с раскинутыми руками (одна геометрия, цвет — из экземпляра). */
export function fallenGeometry(mergeGeometries) {
  const geos = [];
  const lay = (g, at, rx = 0, rz = 0) => { const q = g.clone(); if (at) q.rotateX(rx).rotateZ(rz).translate(...at); q.deleteAttribute('uv'); geos.push(q); };
  for (const p of body({ torso: 'cloth' })) lay(p.geo);
  for (const p of legs()) lay(p.geo, p.at, 0, p.at[0] < 0 ? -0.15 : 0.25);
  for (const p of arms('cloth')) lay(p.geo, p.at, -0.3, p.at[0] < 0 ? -1.2 : 0.9);
  const g = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)));
  return g.rotateX(-Math.PI / 2).translate(0, 0.12, 0.85); // лежит на спине, голова назад
}

/** Части модели для типа полка. */
export function partsFor(type) {
  switch (type) {
    case 'swordsman': return samurai();
    case 'warrior': return ashigaru();
    case 'archer': return ashigaru({ archer: true });
    case 'militia': return militia();
    case 'infantry': return rifleman();
    case 'artillery': return artillery();
    case 'tank': return tank();
    case 'helicopter': return helicopter();
    default: return plane();
  }
}
/** Ростовая техника не затеняется по высоте; пехота темнеет к ногам (контактная тень). */
export const isFoot = (type) => !['artillery', 'tank', 'helicopter', 'drone', 'fighter', 'biplane'].includes(type);
export { v3 as _v3 };
