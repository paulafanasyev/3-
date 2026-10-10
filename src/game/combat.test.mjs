import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMap } from './map.js';
import { createGame, addUnit, stateHash } from './state.js';
import { applyCommand } from './commands.js';
import { declareWar } from './diplomacy.js';
import { isWater } from './data/terrain.js';

const map = loadMap();

function duel() {
  const s = createGame({ seed: 9, setup: { player: 'borea' }, map });
  const land = [...map.naCells].filter((c) => !isWater(map.terrain[c]) && !s.cityAt[c] && !(s.unitsByCell[c] ?? []).length);
  const a = land.find((c) => map.neighbors[c].some((n) => land.includes(n)));
  const b = map.neighbors[a].find((n) => land.includes(n));
  s.nations.borea.met.push('cartel'); s.nations.cartel.met.push('borea');
  const atk = addUnit(s, 'borea', 'swordsman', a);
  const def = addUnit(s, 'cartel', 'warrior', b);
  atk.moves = 2;
  return { s, atk, def, b };
}

test('прогноз боя: шансы и силы без изменений партии', () => {
  const { s, atk, def, b } = duel();
  def.fortified = true;
  const before = stateHash(s);
  const r = applyCommand(s, 'borea', { kind: 'odds', unitId: atk.id, to: b }, map);
  assert.equal(r.ok, true);
  assert.equal(stateHash(s), before, 'прогноз ничего не меняет');
  assert.equal(r.preview.attacker, 'swordsman');
  assert.equal(r.preview.defender, 'warrior');
  assert.ok(r.preview.odds > 0 && r.preview.odds < 100);
  assert.ok(r.preview.mods.some((m) => m.text.startsWith('укрепился')));
  assert.equal(r.preview.atWar, false);
  assert.equal(applyCommand(s, 'borea', { kind: 'odds', unitId: atk.id, to: atk.cell }, map).error, 'NO_TARGET');
});

test('бой: событие несёт клетки, типы, шансы и итог для анимации', () => {
  const { s, atk, b } = duel();
  declareWar(s, 'borea', 'cartel');
  const r = applyCommand(s, 'borea', { kind: 'move', unitId: atk.id, to: b }, map);
  assert.equal(r.attacked, true);
  const e = s.events.findLast((x) => x.key === 'battleWon' || x.key === 'battleLost');
  assert.equal(e.combat.to, b);
  assert.equal(e.combat.attacker, 'swordsman');
  assert.equal(e.combat.defender, 'warrior');
  assert.equal(e.combat.won, e.key === 'battleWon');
  assert.ok(e.combat.hpBefore >= e.combat.attackerHp);
});
