import assert from 'node:assert/strict';
import test from 'node:test';
import { diplomacyActions } from './diplomacy-ui.js';

const base = () => ({ nationId: 'borea', turn: 8, wars: [], treaties: [], cities: [], nations: [
  { id: 'borea', met: ['cartel'], gold: 100, influence: 50, lastOpTurn: -99 },
  { id: 'cartel', met: ['borea'], intrigue: { stealTech: { success: 40, exposure: 20 }, sabotage: { success: 50, exposure: 20 }, incite: { success: 50, exposure: 20 }, falseFlag: { success: 40, exposure: 20 }, smear: { success: 50, exposure: 20 } } },
], neutrals: [] });

test('дипломатия строит команды с точными payload', () => {
  const s = base(); s.treaties = [{ a: 'borea', b: 'cartel', type: 'trade' }];
  const actions = diplomacyActions(s, 'cartel');
  assert.deepEqual(actions.find((a) => a.action === 'gift').payload, { kind: 'gift', target: 'cartel', gold: 10 });
  assert.deepEqual(actions.find((a) => a.action === 'cancelTreaty').payload, { kind: 'cancelTreaty', target: 'cartel', treaty: 'trade' });
  assert.deepEqual(actions.find((a) => a.action === 'negotiate').payload, { kind: 'negotiate', target: 'cartel', deal: { give: { gold: 10 }, take: {} } });
  assert.deepEqual(actions.find((a) => a.action === 'spy' && a.op === 'smear').payload, { kind: 'spy', op: 'smear', target: 'cartel' });
});

test('серверные ограничения отображаются как disabled', () => {
  const s = base(); s.nations[0].influence = 0; s.nations[0].gold = 0; s.treaties = [{ a: 'borea', b: 'cartel', type: 'nap' }];
  const actions = diplomacyActions(s, 'cartel');
  assert.equal(actions.find((a) => a.action === 'gift').enabled, false);
  assert.equal(actions.find((a) => a.action === 'propose' && a.treaty === 'trade').enabled, false);
  assert.equal(actions.find((a) => a.action === 'demand').enabled, false);
});

test('нейтральный народ доступен для подарка и аннексии', () => {
  const s = base(); s.neutrals = [{ id: 'p1', name: 'Народы', alive: true, relation: 65 }];
  const actions = diplomacyActions(s, 'p1');
  assert.ok(actions.some((a) => a.action === 'gift'));
  assert.ok(actions.some((a) => a.action === 'annex'));
});

test('подсказка договора называет цену в влиянии', () => {
  const titles = diplomacyActions(base(), 'cartel').filter((a) => a.action === 'propose').map((a) => a.title);
  assert.ok(titles.length > 0);
  for (const t of titles) assert.match(t, /^Цена: \d+ влияния\.$/);
});

test('кнопки договоров начинаются с заглавной буквы', () => {
  const labels = diplomacyActions(base(), 'cartel').filter((a) => a.action === 'propose').map((a) => a.label);
  for (const l of labels) assert.equal(l[0], l[0].toUpperCase(), l);
});
