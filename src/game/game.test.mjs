import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMap } from './map.js';
import { createGame, snapshot, stateHash, addUnit, addCity } from './state.js';
import { applyCommand } from './commands.js';
import { endTurn } from './turn.js';
import { NATIONS } from './data/nations.js';
import { isWater } from './data/terrain.js';
import { visibleCells, hasTech } from './rules.js';

const map = loadMap();

function autoplay(seed, turns) {
  const s = createGame({ seed, setup: { player: 'borea' }, map });
  s.nations.borea.human = false;
  s.nations.borea.ai = NATIONS[0].ai;
  for (let i = 0; i < turns && s.status === 'running'; i += 1) endTurn(s, map);
  return s;
}

test('createGame: четыре нации в Северной Америке, игрок отмечен, у каждой поселенец и воин', () => {
  const s = createGame({ seed: 3, setup: { player: 'auris' }, map });
  assert.equal(Object.keys(s.nations).length, 4);
  assert.equal(s.player, 'auris');
  assert.equal(s.nations.auris.human, true);
  for (const n of Object.values(s.nations)) {
    const units = Object.values(s.units).filter((u) => u.owner === n.id).map((u) => u.type).sort();
    assert.deepEqual(units, ['settler', 'warrior']);
    for (const u of Object.values(s.units).filter((x) => x.owner === n.id)) assert.ok(map.naCells.has(u.cell) || !isWater(map.terrain[u.cell]));
  }
  assert.ok(Object.values(s.cities).every((c) => c.owner.startsWith('p')), 'на старте города только у нейтралов');
});

test('своя нация: валидный ввод принимается, плохой отклоняется', () => {
  const custom = { name: 'Вольный Союз', color: '#9b7fd9', doctrine: 'expansion', emblem: { shield: 'round', figure: 'wolf', field: '#202020' }, zone: 'south' };
  const s = createGame({ seed: 1, setup: { custom }, map });
  assert.equal(s.player, 'player');
  assert.equal(s.nations.player.name, 'Вольный Союз');
  assert.equal(s.nations.player.zone, 'south');
  assert.equal(s.nations.auris, undefined, 'своя нация заменяет стартовую в этой зоне');
  assert.throws(() => createGame({ seed: 1, setup: { custom: { ...custom, name: 'Я' } }, map }), /BAD_SETUP/);
  assert.throws(() => createGame({ seed: 1, setup: { custom: { ...custom, doctrine: 'nukes' } }, map }), /BAD_SETUP/);
});

test('детерминизм: один сид и одни команды дают одинаковую партию до конца', () => {
  const a = autoplay(7, 400);
  const b = autoplay(7, 400);
  assert.equal(a.status, 'over');
  assert.equal(stateHash(a), stateHash(b));
  const c = autoplay(8, 40);
  const d = autoplay(7, 40);
  assert.notEqual(stateHash(c), stateHash(d));
});

test('инварианты после партии: ресурсы не отрицательные, индексы согласованы', () => {
  const s = autoplay(11, 150);
  for (const n of Object.values(s.nations)) {
    assert.ok(n.gold >= 0 && n.influence >= 0 && n.sciencePool >= 0, n.id);
    assert.ok(n.reputation >= 0 && n.reputation <= 100);
  }
  for (const u of Object.values(s.units)) assert.ok(s.unitsByCell[u.cell].includes(u.id));
  for (const [cell, ids] of Object.entries(s.unitsByCell)) for (const id of ids) assert.equal(s.units[id].cell, Number(cell));
  for (const c of Object.values(s.cities)) {
    assert.equal(s.cityAt[c.cell], c.id);
    assert.ok(c.pop >= 1 && c.pop <= 20);
    assert.equal(s.owner[c.cell], c.owner, 'клетка города принадлежит владельцу города');
  }
  for (const cell of Object.keys(s.cityAt)) assert.ok(!isWater(map.terrain[cell]));
});

test('команды: чужие юниты, плохие места для города и недоступные технологии отклоняются', () => {
  const s = createGame({ seed: 5, setup: { player: 'borea' }, map });
  const settler = Object.values(s.units).find((u) => u.owner === 'borea' && u.type === 'settler');
  const enemy = Object.values(s.units).find((u) => u.owner === 'cartel');
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'found', unitId: enemy.id }, map), { ok: false, error: 'NOT_YOUR_UNIT' });
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'research', tech: 'rocketry' }, map), { ok: false, error: 'TECH_UNAVAILABLE' });
  assert.equal(applyCommand(s, 'borea', { kind: 'research', tech: 'agriculture' }, map).ok, true);
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'nonsense' }, map), { ok: false, error: 'BAD_COMMAND' });
  const r = applyCommand(s, 'borea', { kind: 'found', unitId: settler.id }, map);
  assert.equal(r.ok, true);
  const city = s.cities[r.cityId];
  assert.equal(city.capital, true);
  assert.equal(s.nations.borea.capital, city.id);
  // второй город вплотную нельзя
  const settler2 = addUnit(s, 'borea', 'settler', map.neighbors[city.cell][0]);
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'found', unitId: settler2.id }, map), { ok: false, error: 'TOO_CLOSE_TO_CITY' });
  // город на воде нельзя
  const water = map.neighbors.findIndex((_, i) => isWater(map.terrain[i]));
  const settler3 = addUnit(s, 'borea', 'settler', water);
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'found', unitId: settler3.id }, map), { ok: false, error: 'BAD_CITY_SITE' });
  // производство: мечник без железа и технологии недоступен
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'produce', cityId: city.id, item: { kind: 'unit', id: 'swordsman' } }, map), { ok: false, error: 'TECH_UNAVAILABLE' });
  assert.equal(applyCommand(s, 'borea', { kind: 'produce', cityId: city.id, item: { kind: 'unit', id: 'warrior' } }, map).ok, true);
  // покупка за золото
  s.nations.borea.gold = 500;
  const buy = applyCommand(s, 'borea', { kind: 'buy', cityId: city.id }, map);
  assert.equal(buy.ok, true);
  assert.ok(buy.price > 0 && s.nations.borea.gold === 500 - buy.price);
});

test('атаковать крупную нацию можно только после объявления войны', () => {
  const s = createGame({ seed: 5, setup: { player: 'borea' }, map });
  const warrior = Object.values(s.units).find((u) => u.owner === 'borea' && u.type === 'warrior');
  const target = map.neighbors[warrior.cell].find((c) => !isWater(map.terrain[c]) && !s.unitsByCell[c] && !s.cityAt[c]);
  const enemy = addUnit(s, 'cartel', 'warrior', target);
  warrior.moves = 2;
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'move', unitId: warrior.id, to: target }, map), { ok: false, error: 'NOT_AT_WAR' });
  assert.deepEqual(applyCommand(s, 'borea', { kind: 'declareWar', target: 'cartel' }, map), { ok: false, error: 'NOT_MET' });
  s.nations.borea.met.push('cartel');
  assert.equal(applyCommand(s, 'borea', { kind: 'declareWar', target: 'cartel' }, map).ok, true);
  const r = applyCommand(s, 'borea', { kind: 'move', unitId: warrior.id, to: target }, map);
  assert.equal(r.ok, true);
  assert.equal(r.attacked, true);
  assert.ok(s.units[enemy.id] === undefined || s.units[warrior.id] === undefined || s.units[warrior.id].hp < 100);
});

test('снимок скрывает чужие юниты вне обзора и неразведанные клетки', () => {
  const s = createGame({ seed: 2, setup: { player: 'borea' }, map });
  const visible = visibleCells(s, map, 'borea');
  const far = Object.values(s.units).find((u) => u.owner === 'auris');
  assert.ok(!visible.has(far.cell));
  const snap = snapshot(s, 'borea', { map });
  assert.ok(!snap.units.some((u) => u.id === far.id));
  assert.ok(snap.units.every((u) => u.owner === 'borea' || visible.has(u.cell)));
  const unexplored = snap.explored.indexOf('0');
  assert.equal(snap.owner[unexplored], undefined);
  assert.equal(snap.nations.find((n) => n.id === 'auris').era, null, 'эпоха незнакомой нации скрыта');
  assert.equal(snap.finale, null);
});

test('города растут и исследования завершаются со временем', () => {
  const s = autoplay(4, 80);
  const majors = Object.values(s.cities).filter((c) => !c.owner.startsWith('p'));
  assert.ok(majors.length >= 8, `городов у наций: ${majors.length}`);
  assert.ok(Object.values(s.nations).every((n) => n.techs.length >= 4));
  assert.ok(Object.keys(s.nations).some((id) => hasTech(s, id, 'seafaring')));
});

test('ИИ строит флот и разведывает океан', () => {
  const s = autoplay(301, 120);
  const ships = Object.values(s.units).filter((u) => ['galley', 'ironclad'].includes(u.type));
  assert.ok(ships.length >= 1, 'хотя бы один корабль');
  const explored = Object.values(s.explored).map((cells) => cells.reduce((a, b) => a + b, 0));
  assert.ok(Math.max(...explored) > 1500, `разведано клеток: ${Math.max(...explored)}`);
});
