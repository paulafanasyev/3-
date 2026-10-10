// Тактический бой: детерминизм, итог на карте, блокировка партии, отступление, фланги.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMap } from './map.js';
import { createGame, addUnit, stateHash } from './state.js';
import { applyCommand } from './commands.js';
import { pairKey } from './rules.js';
import { isWater } from './data/terrain.js';
import { stepBattle, orderRegiment, TROOPS } from './tactical.js';

const map = loadMap();

function scenario(A, D, seed = 7) {
  const s = createGame({ seed, setup: { player: 'auris' }, map });
  let a = null; let d = null;
  for (let c = 0; c < map.size && d === null; c += 1) {
    if (map.terrain[c] !== 'P' || s.cityAt[c] || s.owner[c] || s.unitsByCell[c]?.length) continue;
    for (const n of map.neighbors[c]) if (!isWater(map.terrain[n]) && !s.cityAt[n] && !s.owner[n] && !s.unitsByCell[n]?.length) { a = c; d = n; break; }
  }
  s.wars.push(pairKey('auris', 'borea'));
  const ua = A.map((t) => addUnit(s, 'auris', t, a));
  const ud = D.map((t) => addUnit(s, 'borea', t, d));
  for (const u of ua) u.moves = 2;
  return { s, a, d, ua, ud };
}
const auto = (s) => { let r; let n = 0; do { r = applyCommand(s, 'auris', { kind: 'battleAdvance', auto: true }, map); n += 1; } while (r.ok && !r.finished && n < 50); return r; };

test('бой: стек атакующего и все защитники клетки выходят полками на поле', () => {
  const { s, ua, d } = scenario(['swordsman', 'archer'], ['warrior', 'warrior', 'archer']);
  const r = applyCommand(s, 'auris', { kind: 'battle', unitId: ua[0].id, to: d }, map);
  assert.equal(r.ok, true);
  assert.equal(r.battle.regiments.filter((x) => x.side === 'a').length, 2);
  assert.equal(r.battle.regiments.filter((x) => x.side === 'd').length, 3);
  assert.equal(r.battle.regiments[0].men, TROOPS.swordsman.men);
  assert.equal(applyCommand(s, 'auris', { kind: 'fortify', unitId: ua[1].id }, map).error, 'BATTLE_ACTIVE');
});

test('бой детерминирован: одинаковый сид и приказы дают одинаковый итог', () => {
  const run = () => {
    const { s, ua, d } = scenario(['swordsman', 'archer', 'warrior'], ['warrior', 'swordsman', 'archer']);
    applyCommand(s, 'auris', { kind: 'battle', unitId: ua[0].id, to: d }, map);
    applyCommand(s, 'auris', { kind: 'battleOrder', orders: [{ regiment: 'R1', kind: 'formation', formation: 'deep' }] }, map);
    auto(s);
    return stateHash(s);
  };
  assert.equal(run(), run());
});

test('итог боя переносится на карту: победитель занимает клетку, потери уходят в HP', () => {
  const { s, ua, ud, d } = scenario(['tank', 'infantry'], ['warrior']);
  applyCommand(s, 'auris', { kind: 'battle', unitId: ua[0].id, to: d }, map);
  const r = auto(s);
  assert.equal(r.finished, true);
  assert.equal(r.combat.won, true);
  assert.equal(s.battle, null);
  assert.equal(s.units[ua[0].id].cell, d);
  assert.ok(!s.units[ud[0].id] || s.units[ud[0].id].hp < 100);
  assert.ok(s.events.some((e) => e.key === 'battleWon' && e.combat?.tactical));
});

test('отступление: бой проигран, но полки игрока живы и стоят на месте', () => {
  const { s, ua, a, d } = scenario(['warrior'], ['swordsman', 'swordsman']);
  applyCommand(s, 'auris', { kind: 'battle', unitId: ua[0].id, to: d }, map);
  const r = applyCommand(s, 'auris', { kind: 'battleRetreat' }, map);
  assert.equal(r.combat.won, false);
  assert.equal(s.units[ua[0].id].cell, a);
});

test('ИИ-нация не может начать ручной бой, приказ чужому полку отклоняется', () => {
  const { s, ud } = scenario(['warrior'], ['warrior']);
  const back = map.neighbors[ud[0].cell][0];
  assert.equal(applyCommand(s, 'borea', { kind: 'battle', unitId: ud[0].id, to: back }, map).ok, false);
  const { s: s2, ua, d } = scenario(['warrior'], ['warrior']);
  applyCommand(s2, 'auris', { kind: 'battle', unitId: ua[0].id, to: d }, map);
  assert.equal(orderRegiment(s2.battle, 'a', { regiment: 'R2', kind: 'hold' }), 'NOT_YOUR_UNIT');
});

test('удар в тыл страшнее удара в лоб', () => {
  const casualties = (rear) => {
    const { s, ua, d } = scenario(['swordsman'], ['swordsman']);
    applyCommand(s, 'auris', { kind: 'battle', unitId: ua[0].id, to: d }, map);
    const [me, foe] = s.battle.regiments;
    foe.x = 0; foe.y = 0; foe.facing = -Math.PI / 2; foe.order = { kind: 'hold' };
    me.x = 0; me.y = rear ? 6 : -6; me.facing = rear ? -Math.PI / 2 : Math.PI / 2; s.battle.human = 'a'; me.order = { kind: 'hold' };
    me.morale = 999; foe.morale = 999; // не даём бежать: меряем только потери
    stepBattle(s.battle, 50);
    return foe.menStart - foe.men;
  };
  assert.ok(casualties(true) > casualties(false) * 1.5);
});
