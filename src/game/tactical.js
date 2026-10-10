// Тактический бой в реальном времени (как в Shogun: Total War): по желанию игрока атака
// разыгрывается на поле, где каждый юнит стратегической карты — полк из десятков солдат.
// Сервер ведёт бой фиксированными тиками (TICK секунд), часы и кадры — в session.js; клиент шлёт
// только приказы. Всё детерминированно: свой генератор в state.battle.rng.
import { UNITS, VETERAN_MAX } from './data/units.js';
import { TERRAIN } from './data/terrain.js';
import { BUILDINGS } from './data/buildings.js';
import { nextRandom } from './rng.js';
import { unitsAt, isNeutralId } from './rules.js';
import { removeUnit, placeUnit, pushEvent, nameOf } from './state.js';

export const TICK = 0.2; // секунды на тик
export const FIELD = Object.freeze({ w: 640, h: 480, deploy: 130, grid: 33 });
export const TIME_LIMIT = 15 * 60 / TICK; // 15 минут боя: дальше поле за обороной
export const K = Object.freeze({ melee: 0.012, fire: 0.03, moraleLoss: 90, rout: 20, rally: 45, flank: 1.6, rear: 2.2 });

/** Полки по типам юнитов. men — солдат (машин) при 100 HP, range — дальность, м. */
export const TROOPS = Object.freeze({
  warrior: { men: 48, kind: 'foot', melee: 1, armor: 0.8, speed: 1.6, run: 3.4, spacing: 1.3, ranks: 4 },
  archer: { men: 40, kind: 'foot', melee: 0.5, armor: 0.7, speed: 1.6, run: 3.4, spacing: 1.4, ranks: 3, range: 130, fire: 0.6, reload: 12, ammo: 24, projectile: 'arrow' },
  swordsman: { men: 48, kind: 'foot', melee: 1.35, armor: 1.25, speed: 1.5, run: 3.1, spacing: 1.3, ranks: 4 },
  militia: { men: 40, kind: 'foot', melee: 0.8, armor: 0.8, speed: 1.4, run: 3, spacing: 1.3, ranks: 4 },
  infantry: { men: 48, kind: 'foot', melee: 0.8, armor: 1, speed: 1.8, run: 3.8, spacing: 1.8, ranks: 2, range: 220, fire: 0.75, reload: 9, ammo: 40, projectile: 'bullet' },
  artillery: { men: 4, kind: 'gun', melee: 0.15, armor: 1, speed: 1, run: 1.3, spacing: 14, ranks: 1, range: 480, fire: 1.2, reload: 30, ammo: 30, projectile: 'shell', splash: true },
  tank: { men: 4, kind: 'vehicle', melee: 1.6, armor: 2.5, speed: 5, run: 8, spacing: 16, ranks: 1, range: 320, fire: 1.1, reload: 18, ammo: 40, projectile: 'shell' },
  helicopter: { men: 3, kind: 'air', melee: 0, armor: 1.4, speed: 18, run: 30, spacing: 22, ranks: 1, range: 300, fire: 1, reload: 12, ammo: 30, projectile: 'rocket' },
  drone: { men: 3, kind: 'air', melee: 0, armor: 1, speed: 25, run: 40, spacing: 25, ranks: 1, range: 400, fire: 1, reload: 20, ammo: 12, projectile: 'rocket' },
  fighter: { men: 2, kind: 'air', melee: 0, armor: 1.2, speed: 60, run: 90, spacing: 40, ranks: 1, range: 450, fire: 1.2, reload: 25, ammo: 8, projectile: 'rocket' },
  biplane: { men: 3, kind: 'air', melee: 0, armor: 0.8, speed: 30, run: 45, spacing: 30, ranks: 1, range: 250, fire: 0.5, reload: 10, ammo: 30, projectile: 'bullet' },
});
export const FORMATIONS = Object.freeze({
  line: { name: 'Линия', ranksMul: 1, spacingMul: 1, melee: 1, armor: 1, fireTaken: 1 },
  deep: { name: 'Колонна', ranksMul: 2, spacingMul: 0.9, melee: 1.15, armor: 1.15, fireTaken: 1.3 },
  loose: { name: 'Рассыпной строй', ranksMul: 0.5, spacingMul: 2.2, melee: 0.75, armor: 0.9, fireTaken: 0.55 },
});

const rand = (b) => { b.rng = (Math.imul(b.rng, 1664525) + 1013904223) | 0; return (b.rng >>> 0) / 4294967296; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const alive = (r) => r.men > 0 && r.state !== 'fled';
const fighting = (r) => alive(r) && r.state !== 'rout';
export const isTacticalType = (type) => Boolean(TROOPS[type]);

/** Высоты поля: детерминированный рельеф по типу местности клетки боя. */
function buildTerrain(b, code) {
  const amp = { M: 38, F: 12, P: 7, D: 9, T: 6, I: 10 }[code] ?? 8;
  const n = FIELD.grid;
  const waves = Array.from({ length: 5 }, () => ({ fx: 1 + rand(b) * 3, fy: 1 + rand(b) * 3, px: rand(b) * 6.28, py: rand(b) * 6.28, a: 0.3 + rand(b) * 0.7 }));
  const heights = [];
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
    let h = 0;
    for (const w of waves) h += w.a * Math.sin((i / n) * w.fx * 3.14 + w.px) * Math.cos((j / n) * w.fy * 3.14 + w.py);
    heights.push(Math.round(h * amp * 10) / 10);
  }
  const woods = [];
  const patches = { F: 9, P: 3, T: 4, M: 3, D: 0, I: 0 }[code] ?? 2;
  for (let k = 0; k < patches; k += 1) {
    const x = (rand(b) - 0.5) * FIELD.w * 0.9;
    const y = (rand(b) - 0.5) * FIELD.h * 0.9;
    if (Math.abs(y) < 40 && Math.abs(x) < 120) continue; // центр поля оставляем открытым
    woods.push({ x: Math.round(x), y: Math.round(y), r: Math.round(30 + rand(b) * (code === 'F' ? 60 : 35)) });
  }
  return { code, biome: TERRAIN[code]?.id ?? 'plain', heights, n, woods };
}

export function heightAt(t, x, y) {
  const n = t.n;
  const fx = clamp((x / FIELD.w + 0.5) * (n - 1), 0, n - 1.001);
  const fy = clamp((y / FIELD.h + 0.5) * (n - 1), 0, n - 1.001);
  const i = Math.floor(fx); const j = Math.floor(fy);
  const u = fx - i; const v = fy - j;
  const h = (a, c) => t.heights[c * n + a];
  return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
}
const inWoods = (t, p) => t.woods.some((w) => Math.hypot(w.x - p.x, w.y - p.y) < w.r);

function makeRegiment(b, unit, side, slot, count, extra = {}) {
  const type = extra.type ?? unit.type;
  const T = TROOPS[type];
  const hp = unit ? unit.hp : 100;
  const menMax = T.men;
  const men = Math.max(1, Math.round(menMax * hp / 100));
  const dir = side === 'a' ? -1 : 1; // атакующий внизу (y<0), обороняющийся вверху
  const spread = Math.min(70, 340 / Math.max(1, count));
  const x = (slot - (count - 1) / 2) * spread;
  const backRow = T.range && T.kind !== 'air' ? 30 : 0;
  const r = {
    id: `R${b.regiments.length + 1}`, side, owner: extra.owner ?? unit.owner, unitId: unit?.id ?? null, type,
    str: (extra.str ?? UNITS[unit.type].str) * (1 + 0.1 * (unit?.vet ?? 0)),
    men, menStart: men, menMax, morale: 70 + 8 * (unit?.vet ?? 0), fatigue: 0, ammo: T.ammo ?? 0, reloadLeft: 0,
    x, y: dir * (FIELD.deploy + backRow), facing: side === 'a' ? Math.PI / 2 : -Math.PI / 2,
    formation: 'line', state: 'ready', order: { kind: 'hold' }, engaged: null, dmg: 0, kills: 0,
  };
  b.regiments.push(r);
  return r;
}

/** Начинает тактический бой: атакующий стек против всех чужих войск на клетке (и ополчения города). */
export function startBattle(state, map, attacker, cell) {
  const cityId = state.cityAt[cell];
  const city = cityId && state.cities[cityId].owner !== attacker.owner ? state.cities[cityId] : null;
  const b = { id: `B${state.turn}-${attacker.id}`, rng: Math.floor(nextRandom(state) * 2 ** 31), tick: 0, regiments: [], fx: [], result: null };
  b.terrain = buildTerrain(b, map.terrain[cell]);
  const mine = [attacker, ...unitsAt(state, attacker.cell).map((id) => state.units[id])
    .filter((u) => u.id !== attacker.id && u.owner === attacker.owner && isTacticalType(u.type) && u.moves > 0)];
  const theirs = unitsAt(state, cell).map((id) => state.units[id]).filter((u) => u.owner !== attacker.owner && isTacticalType(u.type));
  const defOwner = city?.owner ?? theirs[0]?.owner;
  mine.forEach((u, i) => makeRegiment(b, u, 'a', i, mine.length));
  const dCount = theirs.length + (city ? 1 : 0);
  theirs.forEach((u, i) => makeRegiment(b, u, 'd', i, dCount));
  if (city) {
    const era = isNeutralId(city.owner) ? Math.min(3, Math.floor(state.turn / 50)) : state.nations[city.owner].era;
    const militia = makeRegiment(b, null, 'd', theirs.length, dCount, { type: 'militia', owner: city.owner, str: 6 + era * 8 + city.pop });
    militia.men = militia.menStart = Math.max(8, Math.round(militia.menMax * Math.max(0.35, city.hp / 100)));
  }
  b.city = city ? { id: city.id, name: city.name, x: 0, y: FIELD.deploy + 40, r: 95, walls: city.buildings.includes('walls') } : null;
  b.attacker = { owner: attacker.owner, unitId: attacker.id, from: attacker.cell, name: nameOf(state, attacker.owner) };
  b.defender = { owner: defOwner, cell, name: city ? city.name : nameOf(state, defOwner) };
  b.human = state.nations[attacker.owner]?.human ? 'a' : null;
  for (const u of mine) { u.moves = 0; u.fortified = false; }
  state.battle = b;
  return b;
}

const enemiesOf = (b, r) => b.regiments.filter((o) => o.side !== r.side && alive(o));
function nearest(list, p) {
  let best = null; let d = Infinity;
  for (const o of list) { const k = dist(o, p); if (k < d || (k === d && o.id < best.id)) { d = k; best = o; } }
  return best;
}
const frontage = (r) => {
  const T = TROOPS[r.type]; const F = FORMATIONS[r.formation];
  const ranks = Math.max(1, Math.round(T.ranks * F.ranksMul));
  const files = Math.ceil(r.men / ranks);
  return { w: files * T.spacing * F.spacingMul, d: ranks * T.spacing * F.spacingMul, ranks, files };
};
const reach = (a, o) => {
  const fa = frontage(a); const fo = frontage(o);
  return (fa.d + fo.d) / 2 + Math.min(fa.w, fo.w) * 0.35 + 3;
};
/** Множитель за удар во фланг или в тыл. */
function flankMul(attacker, target) {
  const dx = attacker.x - target.x; const dy = attacker.y - target.y;
  const len = Math.hypot(dx, dy) || 1;
  const dot = (Math.cos(target.facing) * dx + Math.sin(target.facing) * dy) / len;
  return dot > 0.5 ? 1 : dot > -0.5 ? K.flank : K.rear;
}
const heightMul = (b, a, o) => 1 + clamp((heightAt(b.terrain, a.x, a.y) - heightAt(b.terrain, o.x, o.y)) / 25, -0.25, 0.25);
const fortMul = (b, r) => (b.city && r.side === 'd' && Math.hypot(r.x - b.city.x, r.y - b.city.y) < b.city.r ? (b.city.walls ? 1 + BUILDINGS.walls.defense * 2 : 1.4) : 1);

function hurt(b, target, loss, source) {
  if (loss <= 0 || !alive(target)) return;
  target.dmg += loss * target.menMax;
  const before = target.men;
  while (target.dmg >= 1 && target.men > 0) { target.dmg -= 1; target.men -= 1; }
  const dead = before - target.men;
  if (source) source.kills += dead;
  target.morale -= (dead / target.menMax) * K.moraleLoss + loss * 20;
  if (target.men <= 0) target.state = 'dead';
}

function turnTo(r, angle, dt) {
  let d = angle - r.facing;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const max = (TROOPS[r.type].kind === 'air' ? 3 : 1.6) * dt;
  r.facing += clamp(d, -max, max);
}

function moveToward(b, r, p, run, dt) {
  const T = TROOPS[r.type];
  const d = dist(r, p);
  if (d < 1.5) return true;
  let speed = run ? T.run : T.speed;
  if (T.kind !== 'air' && inWoods(b.terrain, r)) speed *= 0.6;
  if (T.kind !== 'air') {
    const ahead = { x: r.x + (p.x - r.x) / d * 4, y: r.y + (p.y - r.y) / d * 4 };
    const slope = (heightAt(b.terrain, ahead.x, ahead.y) - heightAt(b.terrain, r.x, r.y)) / 4;
    speed *= clamp(1 - slope * 1.5, 0.5, 1.2);
    speed *= 1 - r.fatigue / 200;
  }
  const step = Math.min(d, speed * dt);
  turnTo(r, Math.atan2(p.y - r.y, p.x - r.x), dt);
  r.x = clamp(r.x + (p.x - r.x) / d * step, -FIELD.w / 2 + 5, FIELD.w / 2 - 5);
  r.y += (p.y - r.y) / d * step;
  if (run) r.fatigue = Math.min(100, r.fatigue + 0.35 * dt * 5);
  return false;
}

/** ИИ полка: стрелки держат дистанцию, ближний бой идёт на ближайшего, лишние полки обходят с фланга. */
function aiOrder(b, r) {
  const enemies = enemiesOf(b, r).filter((o) => o.state !== 'rout');
  if (!enemies.length) return { kind: 'hold' };
  const T = TROOPS[r.type];
  const target = nearest(enemies, r);
  const d = dist(r, target);
  if (T.range && r.ammo > 0) {
    if (d < T.range * 0.9 && !(d < 25 && T.melee < 0.6)) return { kind: 'hold', target: target.id };
    if (d < 25) return { kind: 'move', x: r.x, y: r.y + (r.side === 'a' ? -60 : 60), run: true };
    return r.side === 'd' && b.tick < 300 ? { kind: 'hold' } : { kind: 'attack', target: target.id, keep: T.range * 0.8 };
  }
  if (r.side === 'd' && d > 180 && b.tick < 900) return { kind: 'hold' };
  const ours = b.regiments.filter((o) => o.side === r.side && fighting(o) && TROOPS[o.type].melee >= 0.8 && !TROOPS[o.type].range);
  const theirs = enemies.filter((o) => TROOPS[o.type].melee >= 0.8 && !TROOPS[o.type].range);
  const idx = ours.indexOf(r);
  if (idx >= theirs.length && theirs.length && d > 60) {
    // обход: точка сбоку от цели, со стороны её фланга
    const side = idx % 2 ? 1 : -1;
    const fx = target.x + Math.cos(target.facing + side * Math.PI / 2) * 70 - Math.cos(target.facing) * 30;
    const fy = target.y + Math.sin(target.facing + side * Math.PI / 2) * 70 - Math.sin(target.facing) * 30;
    return { kind: 'move', x: fx, y: fy, run: false, then: target.id };
  }
  return { kind: 'attack', target: target.id, run: d < 70 };
}

function stepRegiment(b, r, dt) {
  const T = TROOPS[r.type];
  if (!alive(r)) return;
  if (r.state === 'rout') {
    const foe = nearest(enemiesOf(b, r).filter(fighting), r);
    const away = r.side === 'a' ? -FIELD.h : FIELD.h;
    moveToward(b, r, { x: r.x + (foe ? Math.sign(r.x - foe.x) * 30 : 0), y: away }, true, dt);
    if (Math.abs(r.y) > FIELD.h / 2) r.state = 'fled';
    if (r.morale > K.rally && (!foe || dist(foe, r) > 150)) { r.state = 'ready'; r.order = { kind: 'hold' }; }
    r.morale += 0.6 * dt;
    return;
  }
  const human = b.human === r.side && !b.auto;
  if (!human && b.tick % 5 === 0) r.order = aiOrder(b, r);
  const o = r.order;
  const byId = (id) => b.regiments.find((x) => x.id === id);
  // ближний бой: любой враг в зоне досягаемости связывает полк
  const contact = T.kind === 'air' ? null : nearest(enemiesOf(b, r).filter((e) => TROOPS[e.type].kind !== 'air' && dist(e, r) < reach(r, e)), r);
  r.engaged = contact?.id ?? null;
  if (contact) {
    // связанный боем полк разворачивается медленно: удар во фланг и тыл держится долго, как в Shogun
    turnTo(r, Math.atan2(contact.y - r.y, contact.x - r.x), dt * 0.02);
    const F = FORMATIONS[r.formation]; const FC = FORMATIONS[contact.formation];
    const power = r.str * (r.men / r.menMax) * T.melee * F.melee * (1 - r.fatigue / 250) * clamp(r.morale / 60, 0.5, 1.2);
    const guard = contact.str * TROOPS[contact.type].armor * FC.armor * fortMul(b, contact);
    const exposed = flankMul(contact, r) > 1 ? 0.55 : 1; // враг у нас во фланге или тылу: отбиваемся вполсилы
    const mul = flankMul(r, contact) * exposed * heightMul(b, r, contact) * (0.85 + rand(b) * 0.3);
    hurt(b, contact, K.melee * dt * power * mul / guard, r);
    if (mul > 1.3) contact.morale -= 2.5 * dt;
    r.fatigue = Math.min(100, r.fatigue + 0.25 * dt);
    return;
  }
  // стрельба
  if (!T.range || r.ammo <= 0) r.aim = null;
  if (T.range && r.ammo > 0) {
    r.reloadLeft = Math.max(0, r.reloadLeft - 1);
    const wanted = o.target ? byId(o.target) : null;
    const targets = enemiesOf(b, r).filter((e) => dist(e, r) <= T.range && !(T.kind === 'foot' && TROOPS[e.type].kind === 'air' && T.projectile === 'arrow'));
    const target = wanted && alive(wanted) && dist(wanted, r) <= T.range ? wanted : (o.kind !== 'move' ? nearest(targets, r) : null);
    if (target && r.reloadLeft === 0) {
      const d = dist(target, r);
      const acc = clamp(1.15 - d / T.range, 0.2, 1);
      const cover = inWoods(b.terrain, target) ? 0.6 : 1;
      const air = TROOPS[target.type].kind === 'air' ? 0.35 : 1;
      const power = r.str * (r.men / r.menMax) * T.fire * acc * cover * air * FORMATIONS[target.formation].fireTaken * (0.8 + rand(b) * 0.4);
      const guard = target.str * TROOPS[target.type].armor * fortMul(b, target);
      hurt(b, target, K.fire * T.reload * TICK * power / guard, r);
      target.morale -= T.splash ? 3 : 0.6;
      r.ammo -= 1;
      r.reloadLeft = T.reload;
      b.fx.push({ t: b.tick, kind: T.projectile, from: r.id, to: target.id, x: target.x, y: target.y });
      r.aim = target.id;
      if (o.kind === 'hold' || (o.kind === 'attack' && o.keep && d <= o.keep)) turnTo(r, Math.atan2(target.y - r.y, target.x - r.x), dt * 3);
    }
    if (!target) r.aim = null; // цели в зоне нет: башня и статус «огонь» не залипают
    if (target && o.kind === 'attack' && o.keep && dist(target, r) <= o.keep) return;
  }
  if (o.kind === 'move') {
    const done = moveToward(b, r, o, o.run, dt);
    if (done) r.order = o.then ? { kind: 'attack', target: o.then, run: true } : { kind: 'hold' };
  } else if (o.kind === 'attack') {
    const t = byId(o.target);
    if (!t || !alive(t)) r.order = { kind: 'hold' };
    else moveToward(b, r, t, o.run || dist(t, r) < 60, dt);
  } else {
    r.fatigue = Math.max(0, r.fatigue - 0.4 * dt);
  }
  if (!r.engaged) r.morale = Math.min(80 + 8 * (r.vet ?? 0), r.morale + 0.25 * dt);
}

function moraleChecks(b) {
  for (const r of b.regiments) {
    if (!alive(r) || r.state === 'rout') continue;
    if (r.morale < K.rout) {
      r.state = 'rout';
      r.engaged = null;
      // бегство соседей бьёт по духу: как в Shogun, разгром идёт волной
      for (const o of b.regiments) if (o !== r && alive(o) && o.side === r.side && dist(o, r) < 120) o.morale -= 8;
      for (const o of b.regiments) if (alive(o) && o.side !== r.side && dist(o, r) < 150) o.morale += 6;
    }
  }
}

function checkEnd(b) {
  const standing = (side) => b.regiments.some((r) => r.side === side && fighting(r));
  if (!standing('a')) return 'd';
  if (!standing('d')) return 'a';
  if (b.tick >= TIME_LIMIT) return 'd';
  return null;
}

/** Продвигает бой на ticks тиков (клиент шлёт по 1–20). Возвращает победившую сторону или null. */
export function stepBattle(b, ticks = 1) {
  for (let i = 0; i < ticks && !b.result; i += 1) {
    b.tick += 1;
    for (const r of b.regiments) stepRegiment(b, r, TICK);
    // полки не проходят друг сквозь друга: лёгкое расталкивание
    const live = b.regiments.filter(alive).filter((r) => TROOPS[r.type].kind !== 'air');
    for (let p = 0; p < live.length; p += 1) for (let q = p + 1; q < live.length; q += 1) {
      const a = live[p]; const c = live[q];
      const d = dist(a, c); const min = (frontage(a).d + frontage(c).d) / 2 + 2;
      if (d > 0 && d < min) { const push = (min - d) / 2; a.x += (a.x - c.x) / d * push; a.y += (a.y - c.y) / d * push; c.x -= (a.x - c.x) / d * push; c.y -= (a.y - c.y) / d * push; }
    }
    moraleChecks(b);
    if (b.fx.length > 80) b.fx.splice(0, b.fx.length - 80);
    const end = checkEnd(b);
    if (end) b.result = { winner: end };
  }
  return b.result?.winner ?? null;
}

/** Приказ полку игрока. */
export function orderRegiment(b, side, order) {
  const r = b.regiments.find((x) => x.id === order?.regiment);
  if (!r || r.side !== side || !alive(r)) return 'NOT_YOUR_UNIT';
  if (r.state === 'rout') return 'ROUTING';
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  switch (order.kind) {
    case 'move':
      if (!num(order.x) || !num(order.y)) return 'BAD_COMMAND';
      r.order = { kind: 'move', x: clamp(order.x, -FIELD.w / 2, FIELD.w / 2), y: clamp(order.y, -FIELD.h / 2, FIELD.h / 2), run: Boolean(order.run) };
      return null;
    case 'attack': {
      const t = b.regiments.find((x) => x.id === order.target);
      if (!t || t.side === side || !alive(t)) return 'NO_TARGET';
      r.order = { kind: 'attack', target: t.id, run: Boolean(order.run), keep: TROOPS[r.type].range && !order.melee ? TROOPS[r.type].range * 0.8 : 0 };
      return null;
    }
    case 'hold': r.order = { kind: 'hold' }; return null;
    case 'formation':
      if (!FORMATIONS[order.formation] || TROOPS[r.type].kind !== 'foot') return 'BAD_COMMAND';
      r.formation = order.formation; return null;
    default: return 'BAD_COMMAND';
  }
}

/** Итог боя переносится на стратегическую карту: потери в HP, гибель, захват города. */
export function finishBattle(state, map, captureCity) {
  const b = state.battle;
  if (!b?.result) return null;
  const won = b.result.winner === 'a';
  for (const r of b.regiments) {
    if (!r.unitId) continue;
    const u = state.units[r.unitId];
    if (!u) continue;
    const share = r.men / r.menMax;
    if (r.men === 0 || share < 0.1) removeUnit(state, u.id);
    else {
      u.hp = Math.max(5, Math.round(share * 100));
      if ((r.side === 'a') === won) u.vet = Math.min(VETERAN_MAX, (u.vet ?? 0) + 1);
    }
  }
  const cell = b.defender.cell;
  const cityId = state.cityAt[cell];
  const city = cityId && state.cities[cityId].owner !== b.attacker.owner ? state.cities[cityId] : null;
  if (city) {
    const militia = b.regiments.find((r) => r.type === 'militia');
    city.hp = won ? 0 : Math.max(5, Math.round(100 * (militia ? militia.men / militia.menMax : 0.5)));
  }
  const lead = state.units[b.attacker.unitId] ?? b.regiments.filter((r) => r.side === 'a' && r.men > 0 && state.units[r.unitId] && UNITS[state.units[r.unitId].type].domain === 'land').map((r) => state.units[r.unitId])[0];
  let captured = false;
  if (won && lead && UNITS[lead.type].domain === 'land') {
    for (const id of [...unitsAt(state, cell)]) if (state.units[id].owner !== lead.owner) removeUnit(state, id);
    if (city) { captureCity(state, map, lead, city); captured = city.owner === lead.owner; } else placeUnit(state, lead, cell);
  }
  const losses = (side) => b.regiments.filter((r) => r.side === side).reduce((s, r) => s + (r.menStart - r.men), 0);
  const audience = [b.attacker.owner, b.defender.owner].filter((x) => x && !isNeutralId(x));
  const combat = { tactical: true, from: b.attacker.from, to: cell, attackerOwner: b.attacker.owner, defenderOwner: b.defender.owner, won, captured, lossesA: losses('a'), lossesD: losses('d'), seconds: Math.round(b.tick * TICK) };
  pushEvent(state, won ? 'battleWon' : 'battleLost', { attacker: b.attacker.name, defender: b.defender.name }, audience, { combat });
  state.battle = null;
  return combat;
}

/** Снимок боя для клиента: поле, полки, недавние выстрелы. */
export function battleView(b, { terrain = b?.tick === 0 } = {}) {
  if (!b) return null;
  return {
    // рельеф неизменен весь бой: по умолчанию он уходит только до первого тика (12 КБ → ~3 КБ на кадр)
    id: b.id, tick: b.tick, seconds: Math.round(b.tick * TICK), timeLimit: TIME_LIMIT * TICK, field: FIELD, terrain: terrain ? b.terrain : null, city: b.city,
    attacker: b.attacker, defender: b.defender, human: b.human, result: b.result, auto: Boolean(b.auto),
    regiments: b.regiments.map((r) => ({
      id: r.id, side: r.side, owner: r.owner, type: r.type, men: r.men, menStart: r.menStart, menMax: r.menMax,
      x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, facing: Math.round(r.facing * 1000) / 1000,
      formation: r.formation, state: r.state, morale: Math.round(r.morale), fatigue: Math.round(r.fatigue), ammo: r.ammo,
      engaged: r.engaged, order: r.order?.kind ?? 'hold', target: r.order?.target ?? null, aim: r.aim ?? null, range: TROOPS[r.type].range ?? 0, kills: r.kills, ...frontage(r),
      dest: r.order?.kind === 'move' ? [Math.round(r.order.x), Math.round(r.order.y)] : null, run: Boolean(r.order?.run),
    })),
    fx: b.fx.slice(-40),
  };
}
