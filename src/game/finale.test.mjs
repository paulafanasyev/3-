import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMap } from './map.js';
import { createGame, addCity, addUnit } from './state.js';
import { applyCommand } from './commands.js';
import { endTurn } from './turn.js';
import {
  outcomeFor, maybeDetect, defenseLevel, resolveImpact, IMPACT_DELAY, PATH_LOCK, SHIELD_TARGET,
} from './finale.js';

const map = loadMap();

function detected(seed = 21) {
  const s = createGame({ seed, setup: { player: 'borea' }, map });
  for (const n of Object.values(s.nations)) {
    const zone = map.startZones.find((z) => z.id === n.zone);
    addCity(s, map, n.id, zone.cell, `Т-${n.id}`, { capital: true, pop: 4 });
  }
  s.nations.meridian.techs.push('satellites', 'heavyLift', 'deepRadar');
  assert.equal(maybeDetect(s, map), true);
  return s;
}

test('пороги исхода: 49% провал, 50% частичный, 99% частичный, 100% спасение', () => {
  assert.equal(outcomeFor(0.49), 'fail');
  assert.equal(outcomeFor(0.5), 'partial');
  assert.equal(outcomeFor(0.99), 'partial');
  assert.equal(outcomeFor(1), 'saved');
});

test('обнаружение: удар через 25 ходов, точка удара на суше наций', () => {
  const s = detected();
  assert.equal(s.finale.impactTurn, s.turn + IMPACT_DELAY);
  assert.ok(s.owner[s.finale.impactCell] && !s.owner[s.finale.impactCell].startsWith('p'));
  assert.equal(maybeDetect(s, map), false, 'второй раз не обнаруживается');
});

test('в пакт можно вступить до 15-го хода отсчёта; выход после — предательство', () => {
  const s = detected();
  assert.equal(applyCommand(s, 'borea', { kind: 'choosePath', path: 'pact' }, map).ok, true);
  s.turn = s.finale.detectedTurn + PATH_LOCK + 1;
  assert.deepEqual(applyCommand(s, 'cartel', { kind: 'choosePath', path: 'pact' }, map), { ok: false, error: 'PATH_LOCKED' });
  const rep = s.nations.borea.reputation;
  assert.equal(applyCommand(s, 'borea', { kind: 'choosePath', path: 'ark' }, map).ok, true);
  assert.equal(s.nations.borea.finale.betrayed, true);
  assert.equal(s.nations.borea.reputation, rep - 50);
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'choosePath', path: 'nukes' }, map), { ok: false, error: 'BAD_PATH' });
});

test('вклад: золото и наука идут в щит только у участников пакта', () => {
  const s = detected();
  s.nations.borea.gold = 100;
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'contribute', gold: 50 }, map), { ok: false, error: 'NOT_IN_PACT' });
  applyCommand(s, 'borea', { kind: 'choosePath', path: 'pact' }, map);
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'contribute', gold: 500 }, map), { ok: false, error: 'NOT_ENOUGH_GOLD' });
  assert.equal(applyCommand(s, 'borea', { kind: 'contribute', gold: 50 }, map).ok, true);
  assert.equal(s.nations.borea.gold, 50);
  assert.ok(s.finale.shield > 0 && s.nations.borea.finale.contribution === s.finale.shield);
});

test('итог: побеждает крупнейший вклад; без защиты — провал и концовка по выбору игрока', () => {
  const s = detected();
  for (const id of ['borea', 'cartel', 'meridian']) applyCommand(s, id, { kind: 'choosePath', path: 'pact' }, map);
  s.nations.cartel.finale.contribution = 900;
  s.nations.meridian.finale.contribution = 400;
  s.finale.shield = SHIELD_TARGET; // щит полный
  s.finale.tracking = true;
  const capital = Object.values(s.cities).find((c) => c.owner === 'meridian');
  capital.buildings.push('spaceport');
  for (let i = 0; i < 6; i += 1) addUnit(s, 'meridian', 'interceptor', capital.cell);
  const level = defenseLevel(s);
  assert.ok(level.defense >= 1, `защита ${level.defense}`);
  s.turn = s.finale.impactTurn;
  const r = resolveImpact(s, map);
  assert.equal(r.outcome, 'saved');
  assert.equal(r.winner, 'cartel');

  const f = detected(22);
  applyCommand(f, 'borea', { kind: 'choosePath', path: 'ark' }, map);
  Object.values(f.cities).find((c) => c.owner === 'borea').buildings.push('ark');
  f.turn = f.finale.impactTurn;
  const fail = resolveImpact(f, map);
  assert.equal(fail.outcome, 'fail');
  assert.equal(fail.ending, 'lastRefuge');
  assert.equal(fail.winner, null);

  const g = detected(23);
  g.turn = g.finale.impactTurn;
  assert.equal(resolveImpact(g, map).ending, 'silence');
});

test('партия заканчивается финалом через endTurn', () => {
  const s = detected();
  s.turn = s.finale.impactTurn;
  endTurn(s, map);
  assert.equal(s.status, 'over');
  assert.ok(['saved', 'partial', 'fail'].includes(s.result.outcome));
});
