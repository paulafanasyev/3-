import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMap } from './map.js';
import { createGame, addUnit, addCity } from './state.js';
import { applyCommand } from './commands.js';
import { endTurn } from './turn.js';
import { pairKey, atWar } from './rules.js';
import { attitude, remember, moodOf, say } from './leaders.js';
import { credibility, evaluateDemand } from './negotiation.js';
import { LEADERS } from './data/leaders.js';

const map = loadMap();

function setup(seed = 31) {
  const s = createGame({ seed, setup: { player: 'borea' }, map });
  for (const n of Object.values(s.nations)) {
    n.met = Object.keys(s.nations).filter((x) => x !== n.id);
    n.influence = 200;
    n.gold = 300;
  }
  return s;
}

test('у каждой стартовой нации свой вымышленный лидер с чертами и портретом', () => {
  const s = setup();
  const names = new Set();
  for (const n of Object.values(s.nations)) {
    assert.ok(n.leader.name && n.leader.title && n.leader.portrait.endsWith('.png'), n.id);
    for (const v of Object.values(n.leader.traits)) assert.ok(v >= 0 && v <= 1);
    names.add(n.leader.name);
  }
  assert.equal(names.size, 4);
  assert.deepEqual(s.nations.cartel.leader, LEADERS.cartel);
});

test('память лидера: обида снижает отношение, злопамятный забывает медленнее', () => {
  const s = setup();
  const before = attitude(s, 'borea', 'cartel');
  remember(s, 'borea', 'cartel', 'grievance', 50, 'test');
  remember(s, 'cartel', 'borea', 'grievance', 50, 'test');
  assert.ok(attitude(s, 'borea', 'cartel') < before - 20);
  for (let i = 0; i < 30; i += 1) endTurn(s, map);
  // Ингвар (злопамятность 0.9) помнит дольше Сабины (0.4)
  assert.ok(s.memory['borea>cartel'].grievance > s.memory['cartel>borea'].grievance);
  assert.equal(moodOf(-80).id, 'hostile');
  assert.equal(moodOf(60).id, 'friend');
});

test('сделка: выгодная принимается, невыгодная получает встречное предложение', () => {
  const s = setup();
  s.nations.borea.techs = ['agriculture', 'bronze', 'writing'];
  s.nations.meridian.techs = ['seafaring'];
  s.relations[pairKey('borea', 'meridian')] = 20;
  // просим много, даём мало: Лига отвечает встречным
  const greedy = applyCommand(s, 'borea', { kind: 'negotiate', target: 'meridian', deal: { give: { gold: 1 }, take: { techs: ['seafaring'] } } }, map);
  assert.equal(greedy.ok, false);
  assert.equal(greedy.error, 'COUNTER');
  assert.ok(greedy.counter.give.gold > 1 || greedy.counter.give.techs.length > 0);
  assert.ok(greedy.reply.text.length > 0);
  assert.equal(greedy.reply.leader, 'Таэль Ноэрис');
  // встречное предложение принимается как есть
  const accepted = applyCommand(s, 'borea', { kind: 'negotiate', target: 'meridian', deal: greedy.counter }, map);
  assert.equal(accepted.ok, true);
  assert.ok(s.nations.borea.techs.includes('seafaring'));
});

test('сделка валидируется: чужие технологии, столица и пустая сделка отклоняются', () => {
  const s = setup();
  s.nations.borea.techs = ['writing'];
  assert.equal(applyCommand(s, 'borea', { kind: 'negotiate', target: 'cartel', deal: { give: { techs: ['rocketry'] } } }, map).error, 'TECH_UNAVAILABLE');
  assert.equal(applyCommand(s, 'borea', { kind: 'negotiate', target: 'cartel', deal: { give: { gold: 10_000 } } }, map).error, 'NOT_ENOUGH_GOLD');
  assert.equal(applyCommand(s, 'borea', { kind: 'negotiate', target: 'cartel', deal: {} }, map).error, 'EMPTY_DEAL');
  const zone = map.startZones.find((z) => z.id === 'atlantic');
  const capital = addCity(s, map, 'cartel', zone.cell, 'Т', { capital: true });
  assert.equal(applyCommand(s, 'borea', { kind: 'negotiate', target: 'cartel', deal: { take: { cities: [capital.id] } } }, map).error, 'CAPITAL_NOT_FOR_SALE');
});

test('ультиматум: слабый осторожный уступает, сильный гордый отказывает; блеф раскрывается', () => {
  const s = setup();
  const zone = map.startZones.find((z) => z.id === 'north');
  for (let i = 0; i < 12; i += 1) addUnit(s, 'auris', 'tank', zone.cell);
  // Борея (осторожность 0.7) против армии Аурис уступает
  const weak = evaluateDemand(s, 'borea', 'auris', { gold: 100 });
  assert.equal(weak.accept, true);
  // Аурис (гордость 0.75) при равных силах — нет
  const proud = evaluateDemand(s, 'auris', 'cartel', { gold: 100 });
  assert.equal(proud.accept, false);
  const r = applyCommand(s, 'cartel', { kind: 'demand', target: 'auris', take: { gold: 100 } }, map);
  assert.equal(r.ok, true);
  assert.equal(r.accepted, false);
  assert.ok(r.reply.text);
  const before = credibility(s, 'cartel');
  for (let i = 0; i < 4; i += 1) endTurn(s, map);
  if (!atWar(s, 'cartel', 'auris')) assert.ok(credibility(s, 'cartel') < before, 'угроза без войны — раскрытый блеф');
});

test('ультиматум игроку приходит в очередь; отказ можно наказать войной', () => {
  const s = setup();
  const r = applyCommand(s, 'cartel', { kind: 'demand', target: 'borea', take: { gold: 50 } }, map);
  assert.equal(r.queued, true);
  const offer = s.offers.find((o) => o.type === 'demand' && o.to === 'borea');
  assert.ok(offer.reply.text);
  assert.equal(applyCommand(s, 'borea', { kind: 'respond', offerId: offer.id, accept: true }, map).ok, true);
  assert.equal(s.nations.borea.gold, 250);
  assert.equal(s.nations.cartel.gold, 350);
  assert.ok(s.memory['borea>cartel'].grievance > 0, 'вымогательство запоминается');
});

test('реплики детерминированы и зависят от характера', () => {
  const s = setup();
  const a = say(s, 'cartel', 'rejectDeal', { target: 'Борея' });
  const b = say(s, 'cartel', 'rejectDeal', { target: 'Борея' });
  assert.deepEqual(a, b);
  assert.equal(a.leader, 'Сабина Ортелли');
  assert.notEqual(say(s, 'borea', 'demandRefuse').text, say(s, 'cartel', 'demandRefuse').text);
});
