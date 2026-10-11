import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMap } from './map.js';
import { createGame } from './state.js';
import { applyCommand } from './commands.js';
import { evaluateTreaty, TREATY_RULES } from './diplomacy.js';
import { pairKey, treatyBetween } from './rules.js';

const map = loadMap();

function met(state) {
  for (const n of Object.values(state.nations)) n.met = Object.keys(state.nations).filter((x) => x !== n.id);
  for (const n of Object.values(state.nations)) n.influence = 100;
}

test('ИИ отклоняет союз при плохих отношениях и принимает при хороших', () => {
  const s = createGame({ seed: 9, setup: { player: 'borea' }, map });
  met(s);
  s.relations[pairKey('borea', 'meridian')] = -30;
  assert.equal(evaluateTreaty(s, 'meridian', 'borea', 'alliance').accept, false);
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'propose', target: 'meridian', treaty: 'alliance' }, map), { ok: false, error: 'REJECTED' });
  s.relations[pairKey('borea', 'meridian')] = 70;
  assert.equal(applyCommand(s, 'borea', { kind: 'propose', target: 'meridian', treaty: 'alliance' }, map).ok, true);
  assert.ok(treatyBetween(s, 'borea', 'meridian', 'alliance'));
  assert.equal(s.nations.borea.influence, 100 - TREATY_RULES.alliance.influence);
});

test('ИИ не идёт на научный пакт с сильно отстающим', () => {
  const s = createGame({ seed: 9, setup: { player: 'borea' }, map });
  met(s);
  s.relations[pairKey('borea', 'auris')] = 40;
  s.nations.auris.techs = ['agriculture', 'bronze', 'iron', 'writing', 'seafaring', 'wheel'];
  assert.equal(evaluateTreaty(s, 'auris', 'borea', 'research').accept, false);
});

test('разрыв союза бьёт по репутации, война рвёт пакт о ненападении', () => {
  const s = createGame({ seed: 9, setup: { player: 'borea' }, map });
  met(s);
  s.relations[pairKey('borea', 'cartel')] = 80;
  assert.equal(applyCommand(s, 'borea', { kind: 'propose', target: 'cartel', treaty: 'alliance' }, map).ok, true);
  const rep = s.nations.borea.reputation;
  assert.equal(applyCommand(s, 'borea', { kind: 'cancelTreaty', target: 'cartel', treaty: 'alliance' }, map).ok, true);
  assert.equal(s.nations.borea.reputation, rep - TREATY_RULES.alliance.breakReputation);
  s.relations[pairKey('borea', 'meridian')] = 50;
  assert.equal(applyCommand(s, 'borea', { kind: 'propose', target: 'meridian', treaty: 'nap' }, map).ok, true);
  const rep2 = s.nations.borea.reputation;
  assert.equal(applyCommand(s, 'borea', { kind: 'declareWar', target: 'meridian' }, map).ok, true);
  assert.equal(treatyBetween(s, 'borea', 'meridian', 'nap'), undefined);
  assert.equal(s.nations.borea.reputation, rep2 - TREATY_RULES.nap.breakReputation);
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'proposePeace', target: 'meridian' }, map), { ok: false, error: 'REJECTED' }, 'мир не раньше чем через 5 ходов');
});

test('предложение от ИИ игроку приходит в очередь и принимается командой respond', () => {
  const s = createGame({ seed: 9, setup: { player: 'borea' }, map });
  met(s);
  s.relations[pairKey('borea', 'cartel')] = 30;
  const r = applyCommand(s, 'cartel', { kind: 'propose', target: 'borea', treaty: 'trade' }, map);
  assert.equal(r.queued, true);
  const offer = s.offers.find((o) => o.to === 'borea');
  assert.ok(offer);
  assert.equal(applyCommand(s, 'borea', { kind: 'respond', offerId: offer.id, accept: true }, map).ok, true);
  assert.ok(treatyBetween(s, 'borea', 'cartel', 'trade'));
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'respond', offerId: offer.id, accept: true }, map), { ok: false, error: 'BAD_OFFER' });
});
