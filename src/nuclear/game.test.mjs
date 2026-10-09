import assert from 'node:assert/strict';
import test from 'node:test';
import { runAi } from './ai.js';
import { applyCommand, createGame, snapshot, tick } from './game.js';
import { haversineKm } from './geo.js';
import { DEFAULT_ROSTER, UNIT_TYPES } from './units.js';

// Two small zones ~1500 km apart on the equator: far beyond any blast radius.
const TEST_ZONES = {
  blue: { label: 'B', latMin: 0, latMax: 0.5, lonMin: 0, lonMax: 0.5 },
  red: { label: 'R', latMin: 0, latMax: 0.5, lonMin: 13.5, lonMax: 14 },
};
const FAST = { 5: 1, 4: 1, 3: 1, 2: 1, 1: 1000 };

function toDefcon1(state) {
  for (let i = 0; i < 4; i += 1) tick(state, 1);
  assert.equal(state.defcon, 1);
}

function runUntil(state, predicate, hooks, limit = 500) {
  for (let i = 0; i < limit && !predicate(); i += 1) tick(state, 1, hooks);
}

const unitOf = (state, side, type) => state.units.find((u) => u.side === side && u.type === type);

test('every unit type has a valid model or marker and the default roster is known', () => {
  for (const [type, def] of Object.entries(UNIT_TYPES)) {
    assert.ok(def.model || def.marker, `${type} needs a model or marker`);
    if (def.model) assert.match(def.model, /\.glb$/);
  }
  for (const type of Object.keys(DEFAULT_ROSTER)) assert.ok(UNIT_TYPES[type], type);
});

test('createGame is deterministic for a seed and spawns the full roster per side', () => {
  const a = createGame({ seed: 42 });
  const b = createGame({ seed: 42 });
  assert.deepEqual(a.units, b.units);
  const perSide = Object.values(DEFAULT_ROSTER).reduce((sum, n) => sum + n, 0);
  assert.equal(a.units.filter((u) => u.side === 'blue').length, perSide);
  assert.equal(a.units.filter((u) => u.side === 'red').length, perSide);
});

test('DEFCON steps down from 5 to 1 on schedule', () => {
  const state = createGame({ defconDurations: FAST });
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    tick(state, 1);
    seen.push(state.defcon);
  }
  assert.deepEqual(seen, [4, 3, 2, 1]);
});

test('launch is refused before DEFCON 1 and moves are refused at DEFCON 5', () => {
  const state = createGame({ zones: TEST_ZONES, roster: { icbm_silo: 1, recon_drone: 1 } });
  const silo = unitOf(state, 'blue', 'icbm_silo');
  const drone = unitOf(state, 'blue', 'recon_drone');
  assert.deepEqual(applyCommand(state, 'blue', { kind: 'launch', unitId: silo.id, lat: 0, lon: 14 }), { ok: false, error: 'DEFCON_TOO_HIGH' });
  assert.deepEqual(applyCommand(state, 'blue', { kind: 'move', unitId: drone.id, lat: 1, lon: 1 }), { ok: false, error: 'DEFCON_TOO_HIGH' });
  assert.deepEqual(applyCommand(state, 'blue', { kind: 'move', unitId: silo.id, lat: 1, lon: 1 }), { ok: false, error: 'NOT_MOBILE' });
  assert.deepEqual(applyCommand(state, 'blue', { kind: 'move', unitId: drone.id, lat: 200, lon: 1 }), { ok: false, error: 'BAD_TARGET' });
  const redSilo = unitOf(state, 'red', 'icbm_silo');
  assert.deepEqual(applyCommand(state, 'blue', { kind: 'launch', unitId: redSilo.id, lat: 0, lon: 0 }), { ok: false, error: 'UNKNOWN_UNIT' });
});

test('mobile units travel at their speed once DEFCON allows it', () => {
  const state = createGame({ zones: TEST_ZONES, roster: { recon_drone: 1 }, defconDurations: { 5: 1 } });
  tick(state, 1);
  assert.equal(state.defcon, 4);
  const drone = unitOf(state, 'blue', 'recon_drone');
  const start = { lat: drone.lat, lon: drone.lon };
  assert.equal(applyCommand(state, 'blue', { kind: 'move', unitId: drone.id, lat: 20, lon: 0 }).ok, true);
  tick(state, 5);
  tick(state, 5);
  const travelled = haversineKm(start, drone);
  assert.ok(Math.abs(travelled - 20) < 0.5, `travelled ${travelled} km`);
});

test('a ballistic strike destroys the target, scores, and ends the game', () => {
  const state = createGame({ zones: TEST_ZONES, roster: { icbm_silo: 1 }, defconDurations: FAST });
  toDefcon1(state);
  const blueSilo = unitOf(state, 'blue', 'icbm_silo');
  const redSilo = unitOf(state, 'red', 'icbm_silo');
  const result = applyCommand(state, 'blue', { kind: 'launch', unitId: blueSilo.id, lat: redSilo.lat, lon: redSilo.lon });
  assert.equal(result.ok, true);
  assert.deepEqual(applyCommand(state, 'blue', { kind: 'launch', unitId: blueSilo.id, lat: redSilo.lat, lon: redSilo.lon }), { ok: false, error: 'NO_AMMO' });
  runUntil(state, () => state.missiles.length === 0);
  assert.equal(redSilo.alive, false);
  assert.equal(blueSilo.alive, true);
  assert.equal(state.sides.blue.score, 10);
  assert.equal(state.sides.blue.kills, 1);
  assert.equal(state.status, 'finished');
  assert.equal(state.winner, 'blue');
});

test('ABM can intercept an incoming ballistic missile', () => {
  const state = createGame({
    zones: TEST_ZONES,
    roster: { icbm_silo: 1, abm_site: 1 },
    defconDurations: FAST,
    interceptChanceOverride: 1,
  });
  toDefcon1(state);
  const blueSilo = unitOf(state, 'blue', 'icbm_silo');
  const redSilo = unitOf(state, 'red', 'icbm_silo');
  applyCommand(state, 'blue', { kind: 'launch', unitId: blueSilo.id, lat: redSilo.lat, lon: redSilo.lon });
  runUntil(state, () => state.missiles.length === 0);
  assert.equal(redSilo.alive, true);
  assert.equal(state.sides.red.intercepts, 1);
  assert.ok(state.events.some((e) => e.type === 'intercept' && e.success === true));
  assert.equal(unitOf(state, 'red', 'abm_site').ammo, UNIT_TYPES.abm_site.ammo - 1);
});

test('hybrid layer: live civilian traffic near the blast costs the attacker points', () => {
  const state = createGame({ zones: TEST_ZONES, roster: { icbm_silo: 1 }, defconDurations: FAST });
  toDefcon1(state);
  const blueSilo = unitOf(state, 'blue', 'icbm_silo');
  const redSilo = unitOf(state, 'red', 'icbm_silo');
  applyCommand(state, 'blue', { kind: 'launch', unitId: blueSilo.id, lat: redSilo.lat, lon: redSilo.lon });
  runUntil(state, () => state.missiles.length === 0, { civilianSampler: () => 7 });
  assert.equal(state.sides.blue.civilianLosses, 7);
  assert.equal(state.sides.blue.score, 10 - 7);
});

test('fog of war hides enemy launchers until they fire', () => {
  const state = createGame({ zones: TEST_ZONES, roster: { icbm_silo: 1 }, defconDurations: FAST });
  assert.equal(snapshot(state, 'blue').units.filter((u) => u.side === 'red').length, 0);
  toDefcon1(state);
  const blueSilo = unitOf(state, 'blue', 'icbm_silo');
  const redSilo = unitOf(state, 'red', 'icbm_silo');
  applyCommand(state, 'red', { kind: 'launch', unitId: redSilo.id, lat: blueSilo.lat, lon: blueSilo.lon });
  const visible = snapshot(state, 'blue').units.filter((u) => u.side === 'red');
  assert.equal(visible.length, 1);
  assert.equal(visible[0].ammo, null, 'enemy ammo stays hidden');
});

test('mutual strike ends in a draw', () => {
  const state = createGame({ zones: TEST_ZONES, roster: { icbm_silo: 1 }, defconDurations: FAST });
  toDefcon1(state);
  const blueSilo = unitOf(state, 'blue', 'icbm_silo');
  const redSilo = unitOf(state, 'red', 'icbm_silo');
  applyCommand(state, 'blue', { kind: 'launch', unitId: blueSilo.id, lat: redSilo.lat, lon: redSilo.lon });
  applyCommand(state, 'red', { kind: 'launch', unitId: redSilo.id, lat: blueSilo.lat, lon: blueSilo.lon });
  runUntil(state, () => state.status !== 'running');
  assert.equal(state.winner, 'draw');
});

test('AI strikes a revealed target at DEFCON 1', () => {
  const state = createGame({ zones: TEST_ZONES, roster: { icbm_silo: 1 }, defconDurations: FAST });
  toDefcon1(state);
  const blueSilo = unitOf(state, 'blue', 'icbm_silo');
  assert.equal(runAi(state, 'red').length, 0, 'nothing revealed yet');
  blueSilo.revealedTo.red = true;
  state.ai.red.nextDecisionAt = 0;
  const results = runAi(state, 'red');
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(state.missiles.length, 1);
});
