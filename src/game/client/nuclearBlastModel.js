/**
 * Physical blast-effects model for the in-game nuclear test range.
 *
 * Every blast/overpressure radius follows the cube-root scaling law
 *   R = coefficient · Y^(1/3)
 * (Glasstone & Dolan, "The Effects of Nuclear Weapons"), which is the same
 * basis used by public blast calculators. Coefficients are calibrated against
 * documented outcomes: Hiroshima (~15 kt) severe zone ≈ 1 km, a MOAB (~11 t)
 * severe zone ≈ 90 m, a 500 lb bomb ≈ 20 m, and Tsar Bomba (~50 Mt) severe
 * zone ≈ 15 km.
 *
 * Fireball radius, crater dimensions and cloud geometry are taken from the
 * source repository's researched weapon table (`source-bomb-profiles.json`)
 * when a profile is supplied, so each named bomb behaves like that bomb, not
 * like a generic yield.
 *
 * This module is pure (no Cesium, no DOM) so its numbers can be unit-tested.
 * It models abstract damage for gameplay, not targeting data.
 */

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const cbrt = (value) => Math.cbrt(Math.max(0, value));

/** Ground-range coefficient (km) per kiloton^(1/3) for each overpressure band. */
export const OVERPRESSURE = Object.freeze({
  severe: 0.41, // ~20 psi — reinforced structures destroyed, near-total collapse
  heavy: 0.68, // ~5 psi — most residential and commercial buildings collapse
  light: 1.36, // ~1 psi — windows and façades fail, injuries, fires ignite
});

/** Metres per kiloton^(1/3) used when the researched fireball radius is absent. */
export const FIREBALL_COEFFICIENT = 55;

/**
 * Fraction of the blast that reaches ground level, by burst mode. Air bursts
 * couple efficiently over a wide area; buried and underwater shots dump most
 * energy into the ground or water.
 */
export function burstCoupling(burstType = '') {
  const t = String(burstType).toUpperCase();
  if (t.includes('HIGH_AIR')) return 0.85;
  if (t.includes('UNDERWATER')) return 0.28;
  if (t.includes('BURIED')) return 0.55;
  if (t.includes('TOWER')) return 0.82;
  if (t.includes('CONVENTIONAL')) return 1.0;
  return 1.0; // SURFACE and AIR bursts
}

/**
 * @param {object} input
 * @param {number} input.yieldKt    yield of the weapon in kilotons (authoritative energy)
 * @param {string} [input.burstType] e.g. NUCLEAR_AIR, NUCLEAR_SURFACE, CONVENTIONAL_SURFACE
 * @param {object|null} [input.research] the weapon's researched `research` block from the source table
 * @returns {object} radii in metres plus damage-tier helpers
 */
export function computeBlastZones({ yieldKt = 0, burstType = '', research = null } = {}) {
  const kt = Math.max(0, num(yieldKt) ?? 0);
  const root = cbrt(kt);
  const coupling = burstCoupling(burstType);

  const severeKm = OVERPRESSURE.severe * root * coupling;
  const heavyKm = OVERPRESSURE.heavy * root * coupling;
  const lightKm = OVERPRESSURE.light * root * coupling;

  // Fireball radius: trust the researched value (including an explicit 0 for
  // buried/underwater shots where no fireball reaches the surface), otherwise
  // fall back to cube-root scaling.
  const researchedFireball = research ? num(research.fireball_max_radius_m) : null;
  const fireballM = researchedFireball !== null ? researchedFireball : FIREBALL_COEFFICIENT * root;

  const craterDiameterM = (research && num(research.crater_diameter_m)) || 0;
  const craterDepthM = (research && num(research.crater_depth_m)) || 0;
  const cloudTopKm = (research && num(research.cloud_top_km)) || null;
  const cloudCapKm = (research && num(research.cloud_cap_diameter_km)) || null;

  // The blast footprint we render the surviving city across. Outer outskirts
  // keep standing so the scene reads as a real metro area that was hit.
  const outerKm = Math.min(70, Math.max(lightKm * 1.3, fireballM / 1000 * 1.4, 2.2));

  return {
    yieldKt: kt,
    burstType: String(burstType || 'SURFACE'),
    coupling,
    radiiM: {
      fireball: fireballM,
      severe: severeKm * 1000,
      heavy: heavyKm * 1000,
      light: lightKm * 1000,
      outer: outerKm * 1000,
    },
    craterDiameterM,
    craterDepthM,
    cloudTopKm,
    cloudCapKm,
    hasCrater: craterDiameterM > 0,
  };
}

/**
 * Damage tier for a point at `distanceM` from ground zero.
 * Order: vaporized (inside fireball) → severe → heavy → light → standing.
 */
export function damageTierAt(zones, distanceM) {
  const r = zones.radiiM;
  if (distanceM <= r.fireball) return 'vaporized';
  if (distanceM <= r.severe) return 'severe';
  if (distanceM <= r.heavy) return 'heavy';
  if (distanceM <= r.light) return 'light';
  return 'standing';
}

/**
 * Collapse profile per tier: fraction of the original height that survives as
 * rubble, plus the delay (seconds) before collapse begins. The delay grows with
 * distance so destruction visibly spreads outward with the blast wave, arriving
 * later at the outer rings — the way an airblast actually overruns a city.
 */
export const COLLAPSE = Object.freeze({
  vaporized: { heightFraction: 0.0, tilt: 0, fireChance: 1.0 },
  severe: { heightFraction: 0.06, tilt: 0.12, fireChance: 0.95 },
  heavy: { heightFraction: 0.28, tilt: 0.24, fireChance: 0.7 },
  light: { heightFraction: 0.68, tilt: 0.16, fireChance: 0.4 },
  standing: { heightFraction: 0.97, tilt: 0.04, fireChance: 0.12 },
});

/** Build a ready-to-consume descriptor that pairs a bomb's research with a chosen yield. */
export function zonesForBomb(bomb, yieldKt) {
  const resolvedYield = num(yieldKt) ?? (bomb ? num(bomb.yield_kt) : null) ?? 0;
  return computeBlastZones({
    yieldKt: resolvedYield,
    burstType: bomb ? bomb.burst_type : 'SURFACE',
    research: bomb ? bomb.research : null,
  });
}
