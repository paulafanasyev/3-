import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, snapshot, addCity, addUnit } from './state.js';
import { applyCommand } from './commands.js';
import { endTurn } from './turn.js';
import { loadMap, cellsWithin } from './map.js';
import { isWater } from './data/terrain.js';
import { declareWar } from './diplomacy.js';
import { interceptChance, NUKE } from './nuclear.js';
import { orderRegiment, startBattle } from './tactical.js';

const map = loadMap();

function deadTargetState() {
  const state = createGame({ seed: 71, setup: { player: 'borea' }, map });
  state.nations.auris.alive = false;
  state.nations.borea.met.push('auris');
  state.nations.auris.met.push('borea');
  return state;
}

test('endTurn отклоняется во время активного боя с русским кодом ошибки', () => {
  const state = createGame({ seed: 1, map });
  state.battle = {};
  assert.deepEqual(endTurn(state, map), { ok: false, error: 'BATTLE_ACTIVE', state });
  assert.equal(state.turn, 1);
});

test('дипломатические команды не принимают выбывшую нацию', () => {
  const state = deadTargetState();
  for (const command of [
    { kind: 'declareWar', target: 'auris' },
    { kind: 'propose', target: 'auris', treaty: 'nap' },
    { kind: 'gift', target: 'auris', gold: 1 },
    { kind: 'proposePeace', target: 'auris' },
    { kind: 'cancelTreaty', target: 'auris', treaty: 'nap' },
    { kind: 'negotiate', target: 'auris', deal: { give: { gold: 1 }, take: { gold: 1 } } },
    { kind: 'demand', target: 'auris', take: { gold: 1 } },
    { kind: 'spy', target: 'auris', op: 'smear' },
  ]) assert.equal(applyCommand(state, 'borea', command, map).error, 'UNKNOWN_NATION', command.kind);
});

test('сложность нормализуется и усиливает экономику ИИ, снимок содержит значение', () => {
  const easy = createGame({ seed: 81, setup: { player: 'borea', difficulty: 'easy' }, map });
  const hard = createGame({ seed: 81, setup: { player: 'borea', difficulty: 'hard' }, map });
  const fallback = createGame({ seed: 81, setup: { player: 'borea', difficulty: 'invalid' }, map });
  assert.equal(easy.difficulty, 'easy');
  assert.equal(hard.difficulty, 'hard');
  assert.equal(fallback.difficulty, 'normal');
  for (let i = 0; i < 12; i += 1) { endTurn(easy, map); endTurn(hard, map); }
  const aiWealth = (s) => Object.values(s.nations).filter((n) => !n.human).reduce((sum, n) => sum + n.gold + n.sciencePool, 0)
    + Object.values(s.cities).filter((c) => !s.nations[c.owner]?.human).reduce((sum, c) => sum + c.prod, 0);
  assert.ok(aiWealth(hard) > aiWealth(easy), `${aiWealth(hard)} should exceed ${aiWealth(easy)}`);
  assert.equal(snapshot(hard, hard.player, { map }).difficulty, 'hard');
});

function nukeState() {
  const state = createGame({ seed: 91, setup: { player: 'borea' }, map });
  const land = [...map.naCells].filter((c) => !isWater(map.terrain[c]) && !state.cityAt[c]);
  const free = (c) => !Object.values(state.cities).some((x) => x.cell === c) && !(state.unitsByCell[c] ?? []).length;
  const home = land.find(free); const far = land.find((c) => free(c) && !cellsWithin(map, home, 4).includes(c));
  const source = addCity(state, map, 'borea', home, 'Источник', { capital: true });
  const target = addCity(state, map, 'auris', far, 'Цель', { pop: 5 });
  source.buildings.push('silo');
  state.nations.borea.met.push('auris'); state.nations.auris.met.push('borea');
  state.explored.borea[target.cell] = 1;
  declareWar(state, 'borea', 'auris');
  return { state, source, target, missile: addUnit(state, 'borea', 'icbm', source.cell) };
}

test('перехват целиком ограничен потолком, а пуск без шахты в своём городе запрещён', () => {
  const { state, target, missile, source } = nukeState();
  for (let i = 0; i < 8; i += 1) addUnit(state, 'auris', 'interceptor', target.cell);
  addUnit(state, 'auris', 'satellite', target.cell);
  assert.equal(interceptChance(state, 'auris'), NUKE.interceptCap);
  source.buildings = [];
  assert.equal(applyCommand(state, 'borea', { kind: 'nuke', unitId: missile.id, to: target.cell }, map).error, 'NEED_SILO');
});

test('координаты ядерного удара отсутствуют в общем событии', () => {
  const { state, target, missile } = nukeState();
  const result = applyCommand(state, 'borea', { kind: 'nuke', unitId: missile.id, to: target.cell }, map);
  assert.equal(result.ok, true);
  const publicEvent = state.events.find((e) => e.key === 'nuclearStrike' && e.audience === 'all');
  const privateEvent = state.events.find((e) => e.key === 'nuclearStrike' && Array.isArray(e.audience));
  assert.ok(publicEvent);
  assert.equal(Object.hasOwn(publicEvent, 'cell'), false);
  assert.equal(privateEvent.cell, target.cell);
  assert.equal(privateEvent.fromCell, missile.cell);
});

function battleState() {
  const state = createGame({ seed: 101, setup: { player: 'auris' }, map });
  let a = null; let d = null;
  for (let c = 0; c < state.owner.length && d === null; c += 1) {
    if (state.cityAt[c] || state.owner[c] || state.unitsByCell[c]?.length) continue;
    for (const n of map.neighbors[c]) if (!state.cityAt[n] && !state.owner[n] && !state.unitsByCell[n]?.length && map.terrain[n] === 'P' && map.terrain[c] === 'P') { a = c; d = n; break; }
  }
  const attacker = addUnit(state, 'auris', 'tank', a); attacker.moves = 3;
  addUnit(state, 'borea', 'warrior', d);
  state.wars.push('auris|borea');
  startBattle(state, map, attacker, d);
  return state;
}

test('приказ в нулевую координату допустим, пакет приказов атомарен', () => {
  const state = battleState();
  const regiment = state.battle.regiments.find((r) => r.side === 'a');
  assert.equal(orderRegiment(state.battle, 'a', { regiment: regiment.id, kind: 'move', x: 0, y: 0 }), null);
  const before = structuredClone(regiment.order);
  const result = applyCommand(state, 'auris', { kind: 'battleOrder', orders: [
    { regiment: regiment.id, kind: 'move', x: 10, y: 10 },
    { regiment: 'missing', kind: 'move', x: 20, y: 20 },
  ] }, map);
  assert.equal(result.error, 'NOT_YOUR_UNIT');
  assert.deepEqual(regiment.order, before);
});
