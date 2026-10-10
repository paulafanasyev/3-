import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMap, cellsWithin } from './map.js';
import { createGame, snapshot, addUnit, addCity } from './state.js';
import { applyCommand } from './commands.js';
import { endTurn } from './turn.js';
import { declareWar } from './diplomacy.js';
import { cellYield, cityYield, visibleCells } from './rules.js';
import { isWater } from './data/terrain.js';
import { winterFactor, interceptChance, NUKE, DISMANTLE_SHIELD } from './nuclear.js';
import { choosePath } from './finale.js';

const map = loadMap();

/** Две нации знакомы и воюют, у Бореи ракета в столице, у Аурис город-цель. */
function setup() {
  const s = createGame({ seed: 5, setup: { player: 'borea' }, map });
  const land = [...map.naCells].filter((c) => !isWater(map.terrain[c]) && !s.cities[s.cityAt?.[c]]);
  const free = (c) => !Object.values(s.cities).some((x) => x.cell === c) && !(s.unitsByCell[c] ?? []).length;
  const home = land.find(free);
  const far = land.filter((c) => free(c) && !cellsWithin(map, home, 4).includes(c))[0];
  const a = addCity(s, map, 'borea', home, 'Северск', { capital: true, pop: 4 });
  const b = addCity(s, map, 'auris', far, 'Мишень', { pop: 9 });
  a.buildings.push('silo');
  s.nations.borea.techs.push('fission');
  s.nations.borea.met.push('auris'); s.nations.auris.met.push('borea');
  const icbm = addUnit(s, 'borea', 'icbm', home);
  return { s, a, b, icbm };
}

test('ядерный удар: без войны и без разведки нельзя', () => {
  const { s, b, icbm } = setup();
  assert.equal(applyCommand(s, 'borea', { kind: 'nuke', unitId: icbm.id, to: b.cell }, map).error, 'NOT_EXPLORED');
  s.explored.borea[b.cell] = 1;
  assert.equal(applyCommand(s, 'borea', { kind: 'nuke', unitId: icbm.id, to: b.cell }, map).error, 'NOT_AT_WAR');
  assert.equal(applyCommand(s, 'borea', { kind: 'nuke', unitId: icbm.id, to: 'x' }, map).error, 'NO_TARGET');
  assert.equal(applyCommand(s, 'auris', { kind: 'nuke', unitId: icbm.id, to: b.cell }, map).error, 'NOT_YOUR_UNIT');
  assert.ok(s.units[icbm.id], 'ракета на месте');
});

test('ядерный удар: город теряет население и постройки, осадки, мир реагирует', () => {
  const { s, b, icbm } = setup();
  s.explored.borea[b.cell] = 1;
  b.buildings.push('granary', 'library', 'walls');
  declareWar(s, 'borea', 'auris');
  const rep = s.nations.borea.reputation;
  const r = applyCommand(s, 'borea', { kind: 'nuke', unitId: icbm.id, to: b.cell }, map);
  assert.equal(r.ok, true);
  assert.equal(r.intercepted, false, 'без перехватчиков ракету не сбить');
  assert.equal(s.units[icbm.id], undefined, 'боеголовка израсходована');
  assert.equal(b.pop, Math.round(9 * NUKE.popFactor));
  assert.equal(b.hp, 0);
  assert.deepEqual(b.buildings, ['granary']);
  for (const c of cellsWithin(map, b.cell, 1)) {
    assert.deepEqual(cellYield(s, map, c, 'auris'), { food: 0, prod: 0, gold: 0 });
    assert.ok(!(s.unitsByCell[c] ?? []).some((id) => s.units[id].owner === 'auris' && s.units[id].type !== 'interceptor'));
  }
  assert.equal(s.nations.borea.reputation, Math.max(0, rep - NUKE.reputation));
  assert.ok(s.casusBelli['meridian>borea'] > s.turn, 'остальные получают повод к войне');
  assert.ok(s.events.some((e) => e.key === 'nuclearStrike' && e.cell === b.cell));
  assert.ok(winterFactor(s) < 1, 'ядерная зима');
  const snap = snapshot(s, 'auris', { map });
  assert.ok(snap.nuclear.fallout.some(([c]) => c === b.cell));
  assert.equal(snap.nuclear.strikes.at(-1).cell, b.cell);
  // осадки рассеиваются
  for (let i = 0; i < NUKE.falloutTurns + 1; i += 1) endTurn(s, map);
  assert.equal(Object.keys(s.fallout).filter((c) => Number(c) === b.cell).length, 0);
});

test('перехват: перехватчики и спутник дают шанс сбить ракету, но не больше потолка', () => {
  const { s, b } = setup();
  assert.equal(interceptChance(s, 'auris'), 0);
  for (let i = 0; i < 8; i += 1) addUnit(s, 'auris', 'interceptor', b.cell);
  assert.equal(interceptChance(s, 'auris'), NUKE.interceptCap);
  addUnit(s, 'auris', 'satellite', b.cell);
  assert.equal(interceptChance(s, 'auris'), NUKE.interceptCap + NUKE.earlyWarning);
  // при многих пусках часть ракет сбивают
  s.explored.borea[b.cell] = 1;
  declareWar(s, 'borea', 'auris');
  let intercepted = 0;
  for (let i = 0; i < 20; i += 1) {
    const u = addUnit(s, 'borea', 'icbm', Object.values(s.cities).find((c) => c.owner === 'borea').cell);
    if (applyCommand(s, 'borea', { kind: 'nuke', unitId: u.id, to: b.cell }, map).intercepted) intercepted += 1;
  }
  assert.ok(intercepted > 5 && intercepted < 20, `сбито ${intercepted}`);
  assert.ok(winterFactor(s) >= NUKE.winterFloor, 'зима ограничена снизу');
});

test('разоружение в «Купол» и орбитальная разведка', () => {
  const { s, a, b, icbm } = setup();
  assert.equal(applyCommand(s, 'borea', { kind: 'dismantle', unitId: icbm.id }, map).error, 'NO_FINALE');
  s.finale.detectedTurn = s.turn; s.finale.impactTurn = s.turn + 25;
  assert.equal(applyCommand(s, 'borea', { kind: 'dismantle', unitId: icbm.id }, map).error, 'NOT_IN_PACT');
  choosePath(s, 'borea', 'pact');
  const shield = s.finale.shield;
  assert.equal(applyCommand(s, 'borea', { kind: 'dismantle', unitId: icbm.id }, map).ok, true);
  assert.equal(s.finale.shield, shield + DISMANTLE_SHIELD);
  const sat = addUnit(s, 'borea', 'satellite', a.cell);
  assert.ok(!visibleCells(s, map, 'borea').has(b.cell));
  assert.equal(applyCommand(s, 'borea', { kind: 'recon', unitId: sat.id, to: b.cell }, map).ok, true);
  assert.ok(visibleCells(s, map, 'borea').has(b.cell), 'спутник открыл город');
  assert.equal(s.explored.borea[b.cell], 1);
  assert.equal(applyCommand(s, 'borea', { kind: 'recon', unitId: sat.id, to: b.cell }, map).error, 'RECON_COOLDOWN');
  assert.ok(snapshot(s, 'borea', { map }).nuclear.recon.some((z) => z.cell === b.cell));
});

test('ядерная зима урезает еду во всех городах', () => {
  const { s, a } = setup();
  const before = cityYield(s, map, a).food;
  s.nuclear.strikes.push({ turn: s.turn, from: 'borea', to: 'auris', cell: 0, intercepted: false }, { turn: s.turn, from: 'borea', to: 'auris', cell: 0, intercepted: false });
  assert.ok(Math.abs(cityYield(s, map, a).food - before * 0.9) < 1e-9);
});
