// Nuclear God's Eye: deterministic game core. Pure state + functions, no I/O.
// Positions are generated randomly inside abstract zones; nothing here encodes
// real installations or operational data.
import {
  ballisticAltitudeKm, haversineKm, interpolateGreatCircle, isValidPoint, moveToward,
} from './geo.js';
import { nextRandom } from './rng.js';
import { DEFAULT_ROSTER, PAYLOADS, UNIT_TYPES } from './units.js';

export const SIDES = Object.freeze(['blue', 'red']);
export const DEFAULT_ZONES = Object.freeze({
  blue: { label: 'Западный блок', latMin: 20, latMax: 55, lonMin: -120, lonMax: -60 },
  red: { label: 'Восточный блок', latMin: 20, latMax: 55, lonMin: 40, lonMax: 110 },
});
export const DEFAULT_DEFCON_DURATIONS_S = Object.freeze({ 5: 45, 4: 45, 3: 60, 2: 60, 1: 420 });
export const SCORE = Object.freeze({ unitDestroyed: 10, friendlyFire: -10, civilianHit: -1 });

const MAX_TICK_S = 5;
const MAX_EVENTS = 200;
const FLIGHT_ALTITUDE_KM = 10;
const GEOSTATIONARY_ALTITUDE_KM = 35786;

export function enemyOf(side) {
  return side === 'blue' ? 'red' : 'blue';
}

function newSideStats() {
  return { score: 0, kills: 0, unitsLost: 0, civilianLosses: 0, intercepts: 0 };
}

function pushEvent(state, event) {
  state.eventSeq += 1;
  state.events.push({ seq: state.eventSeq, time: Math.round(state.time * 100) / 100, ...event });
  if (state.events.length > MAX_EVENTS) state.events.shift();
}

function randomIn(state, min, max) {
  return min + nextRandom(state) * (max - min);
}

function spawnUnit(state, side, type) {
  const def = UNIT_TYPES[type];
  const zone = state.zones[side];
  const lat = def.orbital ? 0 : randomIn(state, zone.latMin, zone.latMax);
  const lon = randomIn(state, zone.lonMin, zone.lonMax);
  let altKm = 0;
  if (def.orbital) altKm = GEOSTATIONARY_ALTITUDE_KM;
  else if (def.mobile && def.speedKmS >= 1) altKm = FLIGHT_ALTITUDE_KM;
  return {
    id: `u${state.nextId++}`,
    side,
    type,
    lat,
    lon,
    altKm,
    alive: true,
    ammo: def.ammo ?? 0,
    destination: null,
    revealedTo: { blue: side === 'blue', red: side === 'red' },
  };
}

export function createGame(options = {}) {
  const seed = Number.isInteger(options.seed) ? options.seed >>> 0 : 1;
  const state = {
    version: 1,
    seed,
    rng: seed,
    time: 0,
    defcon: 5,
    phaseElapsed: 0,
    status: 'running',
    winner: null,
    durations: { ...DEFAULT_DEFCON_DURATIONS_S, ...(options.defconDurations || {}) },
    rules: { interceptChanceOverride: options.interceptChanceOverride ?? null },
    zones: options.zones || DEFAULT_ZONES,
    sides: { blue: newSideStats(), red: newSideStats() },
    units: [],
    missiles: [],
    events: [],
    eventSeq: 0,
    nextId: 1,
  };
  const roster = options.roster || DEFAULT_ROSTER;
  for (const side of SIDES) {
    for (const [type, count] of Object.entries(roster)) {
      if (!UNIT_TYPES[type]) throw new Error(`Unknown unit type: ${type}`);
      for (let i = 0; i < count; i += 1) state.units.push(spawnUnit(state, side, type));
    }
  }
  pushEvent(state, { type: 'defcon', defcon: state.defcon });
  return state;
}

const ok = (extra = {}) => ({ ok: true, ...extra });
const reject = (error) => ({ ok: false, error });

export function applyCommand(state, side, command) {
  if (state.status !== 'running') return reject('GAME_FINISHED');
  if (!SIDES.includes(side)) return reject('BAD_SIDE');
  if (!command || typeof command.kind !== 'string') return reject('BAD_COMMAND');
  const unit = state.units.find((candidate) => candidate.id === command.unitId);
  if (!unit || unit.side !== side) return reject('UNKNOWN_UNIT');
  if (!unit.alive) return reject('UNIT_DESTROYED');
  const def = UNIT_TYPES[unit.type];
  const target = { lat: Number(command.lat), lon: Number(command.lon) };
  if (!isValidPoint(target)) return reject('BAD_TARGET');

  switch (command.kind) {
    case 'move': {
      if (!def.mobile) return reject('NOT_MOBILE');
      if (state.defcon > 4) return reject('DEFCON_TOO_HIGH');
      unit.destination = target;
      return ok();
    }
    case 'launch': {
      if (def.role !== 'launcher') return reject('NOT_A_LAUNCHER');
      if (state.defcon !== 1) return reject('DEFCON_TOO_HIGH');
      if (unit.ammo <= 0) return reject('NO_AMMO');
      const distanceKm = haversineKm(unit, target);
      if (distanceKm > def.rangeKm) return reject('OUT_OF_RANGE');
      unit.ammo -= 1;
      unit.revealedTo[enemyOf(side)] = true;
      const payload = PAYLOADS[def.payload];
      const missile = {
        id: `m${state.nextId++}`,
        side,
        payload: def.payload,
        from: { lat: unit.lat, lon: unit.lon },
        to: target,
        distanceKm,
        flightS: Math.max(1, distanceKm / payload.speedKmS),
        elapsedS: 0,
        progress: 0,
        lat: unit.lat,
        lon: unit.lon,
        altKm: 0,
        engagedBy: [],
        done: false,
      };
      state.missiles.push(missile);
      pushEvent(state, { type: 'launch', side, unitId: unit.id, missileId: missile.id, payload: def.payload });
      return ok({ missileId: missile.id });
    }
    default:
      return reject('UNKNOWN_COMMAND');
  }
}

function advancePhase(state) {
  while (state.defcon > 1 && state.phaseElapsed >= state.durations[state.defcon]) {
    state.phaseElapsed -= state.durations[state.defcon];
    state.defcon -= 1;
    pushEvent(state, { type: 'defcon', defcon: state.defcon });
  }
}

function moveUnits(state, dt) {
  for (const unit of state.units) {
    if (!unit.alive || !unit.destination) continue;
    const def = UNIT_TYPES[unit.type];
    const next = moveToward(unit, unit.destination, def.speedKmS * dt);
    unit.lat = next.lat;
    unit.lon = next.lon;
    if (next.arrived) unit.destination = null;
  }
}

function updateVisibility(state) {
  for (const side of SIDES) {
    const sensors = state.units.filter((u) => u.alive && u.side === side && UNIT_TYPES[u.type].sensorRangeKm);
    if (!sensors.length) continue;
    for (const unit of state.units) {
      if (unit.side === side || unit.revealedTo[side]) continue;
      if (sensors.some((s) => haversineKm(s, unit) <= UNIT_TYPES[s.type].sensorRangeKm)) {
        unit.revealedTo[side] = true;
        pushEvent(state, { type: 'reveal', side, unitId: unit.id });
      }
    }
  }
}

function interceptChance(state, unit, def) {
  if (typeof state.rules.interceptChanceOverride === 'number') return state.rules.interceptChanceOverride;
  let chance = def.interceptChance;
  const allies = state.units.filter((u) => u.alive && u.side === unit.side);
  const warning = allies.find((u) => UNIT_TYPES[u.type].role === 'warning');
  if (warning) chance += UNIT_TYPES[warning.type].defenseBonus;
  const awacs = allies.find((u) => {
    const d = UNIT_TYPES[u.type];
    return d.role === 'awacs' && haversineKm(u, unit) <= d.bonusRangeKm;
  });
  if (awacs) chance += UNIT_TYPES[awacs.type].defenseBonus;
  return Math.min(0.95, chance);
}

function tryIntercept(state, missile) {
  const defender = enemyOf(missile.side);
  for (const unit of state.units) {
    if (!unit.alive || unit.side !== defender || unit.ammo <= 0) continue;
    const def = UNIT_TYPES[unit.type];
    if (def.role !== 'defense' || def.defends !== missile.payload) continue;
    if (missile.engagedBy.includes(unit.id)) continue;
    if (haversineKm(unit, missile) > def.defenseRangeKm) continue;
    missile.engagedBy.push(unit.id);
    unit.ammo -= 1;
    const success = nextRandom(state) < interceptChance(state, unit, def);
    pushEvent(state, { type: 'intercept', side: defender, unitId: unit.id, missileId: missile.id, success });
    if (success) {
      missile.done = true;
      state.sides[defender].intercepts += 1;
      return;
    }
  }
}

function rescueFactor(state, center) {
  let factor = 0;
  for (const unit of state.units) {
    if (!unit.alive) continue;
    const def = UNIT_TYPES[unit.type];
    if (def.role === 'rescue' && haversineKm(unit, center) <= def.rescueRangeKm) factor += def.rescueFactor;
  }
  return Math.min(0.6, factor);
}

function detonate(state, missile, civilianSampler) {
  missile.done = true;
  const payload = PAYLOADS[missile.payload];
  const center = { lat: missile.to.lat, lon: missile.to.lon };
  let destroyed = 0;
  let friendlyFire = 0;
  for (const unit of state.units) {
    if (!unit.alive || UNIT_TYPES[unit.type].orbital) continue;
    if (haversineKm(unit, center) > payload.blastRadiusKm) continue;
    unit.alive = false;
    unit.destination = null;
    state.sides[unit.side].unitsLost += 1;
    if (unit.side === missile.side) friendlyFire += 1;
    else destroyed += 1;
  }
  const raw = civilianSampler ? Math.max(0, Math.floor(Number(civilianSampler(center, payload.blastRadiusKm)) || 0)) : 0;
  const civilians = Math.round(raw * (1 - rescueFactor(state, center)));
  const attacker = state.sides[missile.side];
  attacker.kills += destroyed;
  attacker.civilianLosses += civilians;
  attacker.score += destroyed * SCORE.unitDestroyed + friendlyFire * SCORE.friendlyFire + civilians * SCORE.civilianHit;
  pushEvent(state, {
    type: 'detonation',
    side: missile.side,
    missileId: missile.id,
    lat: center.lat,
    lon: center.lon,
    radiusKm: payload.blastRadiusKm,
    destroyed,
    friendlyFire,
    civilians,
  });
}

function flyMissiles(state, dt, civilianSampler) {
  for (const missile of state.missiles) {
    missile.elapsedS += dt;
    const t = Math.min(1, missile.elapsedS / missile.flightS);
    const position = interpolateGreatCircle(missile.from, missile.to, t);
    missile.lat = position.lat;
    missile.lon = position.lon;
    missile.progress = t;
    missile.altKm = missile.payload === 'ballistic' ? ballisticAltitudeKm(missile.distanceKm, t) : FLIGHT_ALTITUDE_KM;
    if (t >= 0.5) tryIntercept(state, missile);
    if (!missile.done && t >= 1) detonate(state, missile, civilianSampler);
  }
  state.missiles = state.missiles.filter((missile) => !missile.done);
}

function checkEnd(state) {
  if (state.defcon !== 1) return;
  const timeUp = state.phaseElapsed >= state.durations[1];
  const anyAmmo = state.units.some((u) => u.alive && UNIT_TYPES[u.type].role === 'launcher' && u.ammo > 0);
  const exhausted = !anyAmmo && state.missiles.length === 0;
  if (!timeUp && !exhausted) return;
  state.status = 'finished';
  const { blue, red } = state.sides;
  if (blue.score === red.score) state.winner = 'draw';
  else state.winner = blue.score > red.score ? 'blue' : 'red';
  pushEvent(state, { type: 'finished', winner: state.winner, reason: timeUp ? 'time' : 'exhausted' });
}

/** Advance the simulation by dtS seconds of game time. */
export function tick(state, dtS, hooks = {}) {
  if (state.status !== 'running' || !(dtS > 0)) return state;
  const dt = Math.min(dtS, MAX_TICK_S);
  state.time += dt;
  state.phaseElapsed += dt;
  advancePhase(state);
  moveUnits(state, dt);
  updateVisibility(state);
  flyMissiles(state, dt, hooks.civilianSampler);
  checkEnd(state);
  return state;
}

/** What `side` is allowed to see (fog of war applied). */
export function snapshot(state, side, { sinceSeq = 0 } = {}) {
  return {
    version: state.version,
    time: Math.round(state.time * 100) / 100,
    defcon: state.defcon,
    phaseRemainingS: Math.max(0, Math.round((state.durations[state.defcon] - state.phaseElapsed) * 10) / 10),
    status: state.status,
    winner: state.winner,
    side,
    zones: state.zones,
    sides: structuredClone(state.sides),
    units: state.units
      .filter((u) => u.side === side || u.revealedTo[side] || UNIT_TYPES[u.type].orbital)
      .map((u) => {
        const def = UNIT_TYPES[u.type];
        const own = u.side === side;
        return {
          id: u.id,
          side: u.side,
          type: u.type,
          label: def.label,
          model: def.model,
          marker: def.marker ?? null,
          lat: u.lat,
          lon: u.lon,
          altKm: u.altKm,
          alive: u.alive,
          ammo: own ? u.ammo : null,
          destination: own ? u.destination : null,
        };
      }),
    missiles: state.missiles.map((m) => ({
      id: m.id,
      side: m.side,
      payload: m.payload,
      lat: m.lat,
      lon: m.lon,
      altKm: m.altKm,
      progress: m.progress,
      to: m.side === side ? m.to : null,
    })),
    events: state.events.filter((event) => event.seq > sinceSeq),
  };
}
