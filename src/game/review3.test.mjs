// Регрессии по третьему раунду ревью: снежный ком завоеваний, финал, переговоры, ввод, карта, тексты.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMap } from './map.js';
import { buildGrid, nearestCell } from './grid.js';
import { createGame, addUnit, addCity, snapshot } from './state.js';
import { applyCommand, resolveAttack } from './commands.js';
import { cityYield, empirePenalty, pairKey } from './rules.js';
import { isWater } from './data/terrain.js';
import { createGameSession } from './session.js';
import { maybeDetect, outcomeFor, partialLoss, UNTRACKED_FACTOR, INTERCEPTOR_CAP, SHIELD_CAP } from './finale.js';
import { attitude } from './leaders.js';
import { LEADER_LINES } from './i18n/ru.js';
import { LAKES } from './data/geoOverrides.js';

const map = loadMap();

function setup(seed = 3) {
  const s = createGame({ seed, setup: { player: 'borea' }, map });
  for (const n of Object.values(s.nations)) {
    n.met = Object.keys(s.nations).filter((x) => x !== n.id);
    n.gold = 300;
    const zone = map.startZones.find((z) => z.id === n.zone);
    const capital = addCity(s, map, n.id, zone.cell, `Т-${n.id}`, { capital: true, pop: 4 });
    n.capital = capital.id;
    n.originalCapital = capital.id;
  }
  return s;
}

test('захваченный город: оккупация режет доход, столица переезжает, захватчик не получает вторую столицу', () => {
  const s = setup();
  const cap = s.cities[s.nations.cartel.capital];
  const second = addCity(s, map, 'cartel', map.neighbors[map.neighbors[map.neighbors[cap.cell][0]][0]][0], 'Запасная', { pop: 3 });
  const before = cityYield(s, map, cap);
  s.wars.push(pairKey('auris', 'cartel'));
  cap.hp = 1;
  const attacker = addUnit(s, 'auris', 'tank', map.neighbors[cap.cell][1]);
  for (let i = 0; i < 20 && cap.owner === 'cartel'; i += 1) { cap.hp = 1; attacker.hp = 100; resolveAttack(s, map, attacker, cap.cell); }
  assert.equal(cap.owner, 'auris');
  assert.equal(cap.capital, false);
  assert.ok(cap.occupiedUntil > s.turn);
  assert.equal(s.nations.cartel.capital, second.id);
  assert.equal(second.capital, true);
  const after = cityYield(s, map, cap);
  assert.ok(after.prod < before.prod * 0.6, `доход оккупированного города ${after.prod} vs ${before.prod}`);
});

test('размер державы: после 12 городов доход падает, но не больше чем на 40%', () => {
  const s = setup();
  assert.equal(empirePenalty(s, 'borea'), 0);
  let k = 0;
  for (const c of map.cells.keys()) {
    if (k >= 40) break;
    if (!isWater(map.terrain[c]) && !s.cityAt[c] && c % 7 === 0) { addCity(s, map, 'borea', c, `Г${k}`); k += 1; }
  }
  assert.ok(empirePenalty(s, 'borea') === 0.4);
});

test('Ковчег: только в столице и только с Тяжёлыми носителями', () => {
  const s = setup();
  s.nations.meridian.techs.push('satellites', 'heavyLift', 'deepRadar');
  maybeDetect(s, map);
  assert.ok(s.finale.detectedTurn);
  const n = s.nations.borea;
  n.era = 3;
  applyCommand(s, 'borea', { kind: 'choosePath', path: 'ark' }, map);
  const cap = s.cities[n.capital];
  const other = addCity(s, map, 'borea', map.neighbors[map.neighbors[map.neighbors[cap.cell][2]][2]][2], 'Окраина');
  assert.equal(applyCommand(s, 'borea', { kind: 'produce', cityId: cap.id, item: { kind: 'building', id: 'ark' } }, map).ok, false);
  n.techs.push('heavyLift');
  assert.equal(applyCommand(s, 'borea', { kind: 'produce', cityId: other.id, item: { kind: 'building', id: 'ark' } }, map).ok, false);
  assert.equal(applyCommand(s, 'borea', { kind: 'produce', cityId: cap.id, item: { kind: 'building', id: 'ark' } }, map).ok, true);
});

test('финал: спасение возможно без слежения, обломки бьют тем слабее, чем выше защита', () => {
  assert.equal(outcomeFor(UNTRACKED_FACTOR * (INTERCEPTOR_CAP + SHIELD_CAP)), 'saved');
  assert.equal(partialLoss(0.5), 0.5);
  assert.ok(partialLoss(0.92) < 0.1);
  assert.ok(partialLoss(0.99) >= 0.05);
});

test('переговоры: технологию даром не отдают даже лучшему другу', () => {
  const s = setup();
  s.relations[pairKey('borea', 'meridian')] = 100;
  s.nations.borea.reputation = 100;
  s.nations.meridian.techs.push('agriculture');
  s.nations.borea.techs = s.nations.borea.techs.filter((t) => t !== 'agriculture');
  const r = applyCommand(s, 'borea', { kind: 'negotiate', target: 'meridian', deal: { give: {}, take: { techs: ['agriculture'] } } }, map);
  assert.equal(r.ok, false);
  assert.ok(!s.nations.borea.techs.includes('agriculture'));
});

test('отношение лидера учитывает репутацию: нации с плохой репутацией не верят', () => {
  const s = setup();
  s.relations[pairKey('borea', 'meridian')] = 40;
  s.nations.borea.reputation = 70;
  const good = attitude(s, 'meridian', 'borea');
  s.nations.borea.reputation = 10;
  assert.ok(attitude(s, 'meridian', 'borea') < good - 15);
});

test('ввод: геттер-ловушка, Proxy и кириллица сверх 16 КБ не роняют сервер', () => {
  const s = setup();
  const trap = Object.defineProperty({}, 'kind', { get() { throw new Error('boom'); } });
  assert.doesNotThrow(() => applyCommand(s, 'borea', trap, map));
  assert.equal(applyCommand(s, 'borea', trap, map).error, 'BAD_COMMAND');
  assert.equal(applyCommand(s, 'borea', { kind: 'move', unitId: 'u1', to: '5' }, map).ok, false);
  const sent = [];
  const session = createGameSession({ send: (m) => sent.push(m), now: () => 1000 });
  session.handle({ type: 'game:new', seed: 5 });
  session.handle({ type: 'game:command', command: { kind: 'research', tech: 'я'.repeat(9000) } });
  assert.equal(sent.at(-1).error, 'TOO_LARGE');
  const proxy = new Proxy({}, { get() { throw new Error('trap'); } });
  assert.doesNotThrow(() => session.handle(proxy));
});

test('туман войны: до встречи не видны лидер и доктрина; точка удара не вычисляется из снимка', () => {
  const s = createGame({ seed: 4, setup: { player: 'borea' }, map });
  s.nations.borea.techs.push('satellites', 'heavyLift', 'deepRadar');
  maybeDetect(s, map);
  const snap = snapshot(s, 'borea', { map });
  const cartel = snap.nations.find((n) => n.id === 'cartel');
  assert.equal(cartel.leader, null);
  assert.equal(cartel.doctrine, null);
  assert.equal(snap.finale.impactCell, undefined);
  const area = snap.finale.impactArea;
  const truth = map.cells[s.finale.impactCell];
  const grid = buildGrid(5);
  assert.notEqual(nearestCell(grid, area), s.finale.impactCell);
  assert.ok(Math.abs(area.lat - truth.lat) < 30);
});

test('карта: Великие озёра — вода, по Панамскому перешейку можно дойти посуху', () => {
  const grid = buildGrid(5);
  for (const lake of LAKES) assert.ok(isWater(map.terrain[nearestCell(grid, lake)]), lake.name);
  const a = nearestCell(grid, { lat: 19, lon: -99 });
  const b = nearestCell(grid, { lat: 4.6, lon: -74 });
  const seen = new Set([a]); const q = [a];
  while (q.length) { const c = q.shift(); for (const n of map.neighbors[c]) if (!seen.has(n) && !isWater(map.terrain[n])) { seen.add(n); q.push(n); } }
  assert.ok(seen.has(b));
});

test('реплики лидеров не склоняют название собеседника и не зависят от пола', () => {
  for (const [situation, tones] of Object.entries(LEADER_LINES)) {
    for (const lines of Object.values(tones)) {
      for (const line of lines) {
        assert.ok(!line.includes('{target}'), `${situation}: ${line}`);
        assert.ok(!/\b(Рада|Рад|Готова|Готов|я|мне|Мне)\b/u.test(line), `${situation}: ${line}`);
      }
    }
  }
});
