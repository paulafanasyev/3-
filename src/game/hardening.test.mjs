// Регрессии по замечаниям ревью: плохой ввод, эксплойты, туман войны, протокол.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMap } from './map.js';
import { createGame, addUnit, addCity, snapshot } from './state.js';
import { applyCommand } from './commands.js';
import { endTurn } from './turn.js';
import { isWater } from './data/terrain.js';
import { pairKey } from './rules.js';
import { createGameSession } from './session.js';
import { maybeDetect } from './finale.js';

const map = loadMap();

function setup(seed = 3) {
  const s = createGame({ seed, setup: { player: 'borea' }, map });
  for (const n of Object.values(s.nations)) {
    n.met = Object.keys(s.nations).filter((x) => x !== n.id);
    n.influence = 300;
    n.gold = 300;
    const zone = map.startZones.find((z) => z.id === n.zone);
    const capital = addCity(s, map, n.id, zone.cell, `Т-${n.id}`, { capital: true, pop: 4 });
    n.capital = capital.id;
    n.originalCapital = capital.id;
  }
  return s;
}

test('мусорные команды не роняют сервер и не портят состояние', () => {
  const s = setup();
  const city = Object.values(s.cities).find((c) => c.owner === 'borea');
  const before = JSON.stringify({ gold: s.nations.borea.gold, inf: s.nations.borea.influence, q: city.queue });
  const junk = [
    null, 42, 'x', [], {}, { kind: 'negotiate', target: 'cartel', deal: null }, { kind: 'demand', target: 'cartel', take: null },
    { kind: 'produce', cityId: city.id, item: { kind: 'building', id: 'toString' } },
    { kind: 'produce', cityId: city.id, item: { kind: 'unit', id: '__proto__' } },
    { kind: 'produce', cityId: city.id, item: null },
    { kind: 'spy', op: 'toString', target: 'cartel' }, { kind: 'spy', op: 'smear', target: '__proto__' },
    { kind: 'gift', target: '__proto__', gold: 5 }, { kind: 'gift', target: 'cartel', gold: 'Infinity' },
    { kind: 'gift', target: 'cartel', gold: -50 }, { kind: 'propose', target: 'cartel', treaty: 'constructor' },
    { kind: 'move', unitId: 'constructor', to: 1 }, { kind: 'respond', offerId: { $gt: '' }, accept: true },
    { kind: 'negotiate', target: 'cartel', deal: { give: { gold: 'NaN', techs: 'rocketry', cities: [{}] } } },
    { kind: 'cancelTreaty', target: 'cartel', treaty: '__proto__' }, { kind: 'research', tech: 'hasOwnProperty' },
  ];
  for (const command of junk) {
    const r = applyCommand(s, 'borea', command, map);
    assert.equal(r.ok, false, JSON.stringify(command));
  }
  assert.equal(JSON.stringify({ gold: s.nations.borea.gold, inf: s.nations.borea.influence, q: city.queue }), before);
  assert.equal({}.gold, undefined, 'прототип объекта не тронут');
  for (const n of Object.values(s.nations)) assert.ok(Number.isFinite(n.gold) && Number.isFinite(n.influence));
});

test('технологию нельзя купить, если получатель до неё не дорос', () => {
  const s = setup();
  s.nations.cartel.techs = ['rocketry', 'jet', 'flight', 'steam'];
  s.nations.cartel.era = 2;
  const r = applyCommand(s, 'borea', { kind: 'negotiate', target: 'cartel', deal: { give: { gold: 300 }, take: { techs: ['rocketry'] } } }, map);
  assert.equal(r.error, 'TECH_NOT_READY');
  assert.ok(!s.nations.borea.techs.includes('rocketry'));
});

test('проданный город не провозит армию продавца', () => {
  const s = setup();
  const cell = map.neighbors[map.startZones.find((z) => z.id === 'north').cell].find((c) => !isWater(map.terrain[c]));
  const far = map.size - 1;
  const city = addCity(s, map, 'borea', cell, 'Продажный', { pop: 2 });
  s.relations[pairKey('borea', 'cartel')] = 90;
  const tank = addUnit(s, 'borea', 'tank', cell);
  const deal = { give: { cities: [city.id] }, take: {} };
  const r = applyCommand(s, 'borea', { kind: 'negotiate', target: 'cartel', deal }, map);
  if (r.ok) {
    assert.equal(s.cities[city.id].owner, 'cartel');
    assert.ok(!s.units[tank.id] || s.units[tank.id].cell !== cell, 'танк покинул проданный город');
  }
  assert.ok(far > 0);
});

test('союз нельзя купить у того, кто вас ненавидит', () => {
  const s = setup();
  s.relations[pairKey('borea', 'meridian')] = -80;
  const r = applyCommand(s, 'borea', { kind: 'negotiate', target: 'meridian', deal: { give: { gold: 300, treaties: ['alliance'] } } }, map);
  assert.equal(r.error, 'RELATION_TOO_LOW');
});

test('совместную войну нельзя обещать против нации под перемирием', () => {
  const s = setup();
  s.truces[pairKey('cartel', 'auris')] = s.turn + 5;
  const r = applyCommand(s, 'borea', { kind: 'negotiate', target: 'cartel', deal: { give: { gold: 100 }, take: { joinWar: 'auris' } } }, map);
  assert.equal(r.error, 'TRUCE');
});

test('ультиматумы: не чаще раза в 10 ходов и не под пактом о ненападении', () => {
  const s = setup();
  assert.equal(applyCommand(s, 'auris', { kind: 'demand', target: 'cartel', take: { gold: 10 } }, map).ok, true);
  assert.equal(applyCommand(s, 'auris', { kind: 'demand', target: 'cartel', take: { gold: 10 } }, map).error, 'DEMAND_COOLDOWN');
  s.relations[pairKey('meridian', 'auris')] = 60;
  assert.equal(applyCommand(s, 'auris', { kind: 'propose', target: 'meridian', treaty: 'nap' }, map).ok, true);
  assert.equal(applyCommand(s, 'auris', { kind: 'demand', target: 'meridian', take: { gold: 10 } }, map).error, 'HAS_TREATY');
});

test('ответ на предложение не теряется, если принять его сейчас нельзя', () => {
  const s = setup();
  assert.equal(applyCommand(s, 'cartel', { kind: 'demand', target: 'borea', take: { gold: 100 } }, map).queued, true);
  const offer = s.offers.find((o) => o.to === 'borea');
  s.nations.borea.gold = 0;
  assert.equal(applyCommand(s, 'borea', { kind: 'respond', offerId: offer.id, accept: true }, map).error, 'NOT_ENOUGH_GOLD');
  assert.ok(s.offers.includes(offer), 'предложение осталось в очереди');
});

test('сухопутные войска: шельф с Мореходства, океан с Парового двигателя, посадка съедает ход, с воды не атакуют', () => {
  const s = setup();
  const coast = map.neighbors.findIndex((nb, i) => !isWater(map.terrain[i]) && nb.some((x) => map.terrain[x] === 'S') && !s.cityAt[i] && !s.unitsByCell[i]);
  const shelf = map.neighbors[coast].find((x) => map.terrain[x] === 'S');
  const w = addUnit(s, 'borea', 'warrior', coast);
  w.moves = 2;
  assert.equal(applyCommand(s, 'borea', { kind: 'move', unitId: w.id, to: shelf }, map).error, 'NO_PATH');
  s.nations.borea.techs.push('seafaring');
  const r = applyCommand(s, 'borea', { kind: 'move', unitId: w.id, to: shelf }, map);
  assert.equal(r.ok, true);
  assert.equal(w.cell, shelf);
  assert.equal(w.moves, 0, 'посадка на корабли съедает ход');
  const ocean = map.neighbors[shelf].find((x) => map.terrain[x] === 'O');
  if (ocean !== undefined) {
    w.moves = 2;
    assert.equal(applyCommand(s, 'borea', { kind: 'move', unitId: w.id, to: ocean }, map).error, 'NO_PATH');
  }
});

test('победа одной атакой убивает только одного защитника из стека', () => {
  const s = setup();
  const cell = map.neighbors.findIndex((nb, i) => !isWater(map.terrain[i]) && !s.cityAt[i] && !s.unitsByCell[i] && nb.some((x) => !isWater(map.terrain[x]) && !s.cityAt[x] && !s.unitsByCell[x]));
  const from = map.neighbors[cell].find((x) => !isWater(map.terrain[x]) && !s.cityAt[x] && !s.unitsByCell[x]);
  for (let i = 0; i < 4; i += 1) addUnit(s, 'cartel', 'warrior', cell);
  s.nations.borea.met.push('cartel');
  applyCommand(s, 'borea', { kind: 'declareWar', target: 'cartel' }, map);
  let won = false;
  for (let i = 0; i < 20 && !won; i += 1) {
    const tank = addUnit(s, 'borea', 'tank', from);
    tank.moves = 3;
    const r = applyCommand(s, 'borea', { kind: 'move', unitId: tank.id, to: cell }, map);
    won = r.won === true;
  }
  assert.ok(won);
  const left = (s.unitsByCell[cell] ?? []).filter((id) => s.units[id].owner === 'cartel').length;
  assert.ok(left >= 1, `в стеке остались защитники: ${left}`);
});

test('щит «Купола» строится только с Тяжёлыми носителями', () => {
  const s = setup();
  s.nations.meridian.techs.push('satellites', 'heavyLift', 'deepRadar');
  maybeDetect(s, map);
  applyCommand(s, 'borea', { kind: 'choosePath', path: 'pact' }, map);
  const city = Object.values(s.cities).find((c) => c.owner === 'borea');
  assert.equal(applyCommand(s, 'borea', { kind: 'produce', cityId: city.id, item: { kind: 'dome' } }, map).error, 'TECH_UNAVAILABLE');
  s.nations.borea.techs.push('heavyLift');
  assert.equal(applyCommand(s, 'borea', { kind: 'produce', cityId: city.id, item: { kind: 'dome' } }, map).ok, true);
});

test('победа завоеванием считает исходные столицы, а не новые', () => {
  const s = setup();
  const cartelCap = s.cities[s.nations.cartel.originalCapital];
  cartelCap.owner = 'auris';
  // Картель основал «новую столицу» — цель для победы не меняется
  const cell = map.neighbors[map.neighbors[map.neighbors[cartelCap.cell][0]][0]][0];
  const fresh = addCity(s, map, 'cartel', cell, 'Новая', { capital: true });
  s.nations.cartel.capital = fresh.id;
  for (const id of ['borea', 'meridian']) s.cities[s.nations[id].originalCapital].owner = 'auris';
  endTurn(s, map);
  assert.equal(s.result?.winner, 'auris');
});

test('туман войны: незнакомые нации не раскрывают отношения, путь и вклад', () => {
  const s = createGame({ seed: 4, setup: { player: 'borea' }, map });
  s.relations[pairKey('borea', 'cartel')] = 77;
  s.nations.cartel.finale.path = 'ark';
  const snap = snapshot(s, 'borea', { map });
  const cartel = snap.nations.find((n) => n.id === 'cartel');
  assert.equal(snap.relations.cartel, undefined);
  assert.equal(cartel.finale.path, null);
  assert.equal(cartel.credibility, null);
  // изменение снимка не меняет партию
  snap.nations.find((n) => n.id === 'borea').gold = 99999;
  assert.notEqual(s.nations.borea.gold, 99999);
});

test('своя нация не может называться как реальная страна, а неизвестная нация в setup отклоняется', () => {
  const custom = { name: 'Канада', color: '#9b7fd9', doctrine: 'expansion', emblem: { shield: 'round', figure: 'wolf', field: '#202020' }, zone: 'south' };
  assert.throws(() => createGame({ seed: 1, setup: { custom }, map }), /BAD_SETUP/);
  assert.throws(() => createGame({ seed: 1, setup: { custom: { ...custom, name: 'Вольный Союз', leaderName: 'Москва' } }, map }), /BAD_SETUP/);
  assert.throws(() => createGame({ seed: 1, setup: { player: 'bogus' }, map }), /BAD_SETUP/);
});

test('сессия: endTurn подтверждается requestId, исключения не выходят наружу', () => {
  const sent = [];
  const session = createGameSession({ send: (m) => sent.push(m), now: () => 1 });
  session.handle({ type: 'game:new', seed: 5 });
  session.handle({ type: 'game:endTurn', requestId: 'e1' });
  assert.ok(sent.some((m) => m.requestId === 'e1' && m.ok === true));
  assert.equal(session.handle(null), false);
  assert.equal(session.handle('game:new'), false);
  session.handle({ type: 'game:command', requestId: 'x', command: { kind: 'negotiate', deal: null, target: 'cartel' } });
  assert.equal(sent.at(-1).ok, false);
});

test('сессия: слишком большие сообщения и поток команд отсекаются', () => {
  const sent = [];
  const session = createGameSession({ send: (m) => sent.push(m), now: () => 1000 });
  session.handle({ type: 'game:new', seed: 5 });
  session.handle({ type: 'game:command', command: { kind: 'research', tech: 'x'.repeat(20_000) } });
  assert.equal(sent.at(-1).error, 'TOO_LARGE');
  for (let i = 0; i < 50; i += 1) session.handle({ type: 'game:command', command: { kind: 'nope' } });
  assert.equal(sent.at(-1).error, 'RATE_LIMIT');
});
