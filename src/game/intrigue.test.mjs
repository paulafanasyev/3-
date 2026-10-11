import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMap } from './map.js';
import { createGame, addCity, snapshot } from './state.js';
import { applyCommand } from './commands.js';
import { OPS, opChances, hasCasusBelli, CASUS_BELLI_TURNS, EXPOSED_REPUTATION, counterIntel } from './intrigue.js';

const map = loadMap();

function setup(seed) {
  const s = createGame({ seed, setup: { player: 'borea' }, map });
  for (const n of Object.values(s.nations)) {
    n.met = Object.keys(s.nations).filter((x) => x !== n.id);
    n.influence = 500;
    n.gold = 500;
  }
  for (const n of Object.values(s.nations)) {
    const zone = map.startZones.find((z) => z.id === n.zone);
    addCity(s, map, n.id, zone.cell, `Т-${n.id}`, { capital: true, pop: 4 });
  }
  return s;
}

test('операция стоит влияния и золота, агентам нужен отдых', () => {
  const s = setup(41);
  s.nations.meridian.techs = ['writing'];
  const r = applyCommand(s, 'borea', { kind: 'spy', op: 'smear', target: 'meridian' }, map);
  assert.equal(r.ok, true);
  assert.equal(s.nations.borea.influence, 500 - OPS.smear.influence);
  assert.equal(s.nations.borea.gold, 500 - OPS.smear.gold);
  assert.equal(applyCommand(s, 'borea', { kind: 'spy', op: 'smear', target: 'meridian' }, map).error, 'AGENTS_BUSY');
  assert.equal(applyCommand(s, 'cartel', { kind: 'spy', op: 'nukes', target: 'meridian' }, map).error, 'BAD_COMMAND');
  assert.equal(applyCommand(s, 'cartel', { kind: 'spy', op: 'stealTech', target: 'auris' }, map).error, 'NOTHING_TO_STEAL');
});

test('раскрытый заговор: репутация, обида и повод к войне без штрафов', () => {
  let exposed = null;
  for (let seed = 1; seed < 60 && !exposed; seed += 1) {
    const s = setup(seed);
    const rep = s.nations.cartel.reputation;
    const r = applyCommand(s, 'cartel', { kind: 'spy', op: 'sabotage', target: 'auris' }, map);
    if (r.exposed) exposed = { s, r, rep };
  }
  assert.ok(exposed, 'хотя бы один заговор раскрыт');
  const { s, r, rep } = exposed;
  assert.equal(s.nations.cartel.reputation, rep - EXPOSED_REPUTATION);
  assert.ok(s.memory['auris>cartel'].grievance > 0);
  assert.equal(hasCasusBelli(s, 'auris', 'cartel'), true);
  assert.equal(s.casusBelli['auris>cartel'], s.turn + CASUS_BELLI_TURNS);
  assert.ok(r.reply.text);
  // война по поводу не стоит Аурис репутации
  const aurisRep = s.nations.auris.reputation;
  assert.equal(applyCommand(s, 'auris', { kind: 'declareWar', target: 'cartel' }, map).ok, true);
  assert.equal(s.nations.auris.reputation, aurisRep);
});

test('кража технологии даёт технологию цели, которой не было', () => {
  let done = null;
  for (let seed = 1; seed < 60 && !done; seed += 1) {
    const s = setup(seed);
    s.nations.meridian.techs = ['writing', 'bronze'];
    const r = applyCommand(s, 'borea', { kind: 'spy', op: 'stealTech', target: 'meridian' }, map);
    if (r.success) done = { s, r };
  }
  assert.ok(done);
  assert.ok(['writing', 'bronze'].includes(done.r.effect.tech));
  assert.ok(done.s.nations.borea.techs.includes(done.r.effect.tech));
});

test('контрразведка: сервер-кластеры снижают шанс успеха', () => {
  const s = setup(5);
  const before = opChances(s, 'cartel', 'meridian', 'stealTech').success;
  for (const c of Object.values(s.cities).filter((x) => x.owner === 'meridian')) c.buildings.push('datacenter', 'research');
  assert.ok(counterIntel(s, 'meridian') > 0.1);
  assert.ok(opChances(s, 'cartel', 'meridian', 'stealTech').success < before);
});

test('снимок показывает лидеров, их настроение и шансы операций', () => {
  const s = setup(7);
  const snap = snapshot(s, 'borea', { map });
  const cartel = snap.nations.find((n) => n.id === 'cartel');
  assert.equal(cartel.leader.name, 'Сабина Ортелли');
  assert.ok(typeof cartel.mood === 'string');
  assert.ok(cartel.intrigue.stealTech.success > 0 && cartel.intrigue.stealTech.success <= 100);
  assert.equal(cartel.credibility, 100);
});
