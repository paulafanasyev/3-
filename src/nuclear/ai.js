// Simple opponent: patrols recon toward the enemy zone, then at DEFCON 1
// strikes the highest-priority revealed target in range.
import { applyCommand, enemyOf } from './game.js';
import { haversineKm } from './geo.js';
import { nextRandom } from './rng.js';
import { UNIT_TYPES } from './units.js';

const TARGET_PRIORITY = Object.freeze({ launcher: 3, defense: 2, awacs: 1, recon: 1, rescue: 0 });
const ALREADY_TARGETED_KM = 50;

export function runAi(state, side, { decisionIntervalS = 4 } = {}) {
  if (state.status !== 'running') return [];
  state.ai ??= {};
  const memory = (state.ai[side] ??= { nextDecisionAt: 0 });
  if (state.time < memory.nextDecisionAt) return [];
  memory.nextDecisionAt = state.time + decisionIntervalS;

  const results = [];
  const enemy = enemyOf(side);
  const zone = state.zones[enemy];
  const own = state.units.filter((u) => u.side === side && u.alive);

  if (state.defcon <= 4) {
    for (const unit of own) {
      const role = UNIT_TYPES[unit.type].role;
      if ((role !== 'recon' && role !== 'awacs') || unit.destination) continue;
      const lat = zone.latMin + nextRandom(state) * (zone.latMax - zone.latMin);
      const lon = zone.lonMin + nextRandom(state) * (zone.lonMax - zone.lonMin);
      results.push(applyCommand(state, side, { kind: 'move', unitId: unit.id, lat, lon }));
    }
  }

  if (state.defcon === 1) {
    const aimed = state.missiles.filter((m) => m.side === side).map((m) => m.to);
    const targets = state.units
      .filter((u) => u.side === enemy && u.alive && u.revealedTo[side] && !UNIT_TYPES[u.type].orbital)
      .filter((u) => !aimed.some((point) => haversineKm(point, u) < ALREADY_TARGETED_KM))
      .sort((a, b) => (TARGET_PRIORITY[UNIT_TYPES[b.type].role] ?? 0) - (TARGET_PRIORITY[UNIT_TYPES[a.type].role] ?? 0));
    for (const target of targets) {
      const launcher = own.find((u) => {
        const def = UNIT_TYPES[u.type];
        return def.role === 'launcher' && u.ammo > 0 && haversineKm(u, target) <= def.rangeKm;
      });
      if (!launcher) continue;
      results.push(applyCommand(state, side, { kind: 'launch', unitId: launcher.id, lat: target.lat, lon: target.lon }));
      break;
    }
  }
  return results;
}
