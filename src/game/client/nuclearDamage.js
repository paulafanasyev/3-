import * as Cesium from 'cesium';
import {
  zonesForBomb,
  damageTierAt,
  COLLAPSE,
} from './nuclearBlastModel.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};
const PALETTE = ['#8e877d', '#aaa195', '#6d6963', '#b3a99b', '#77736d', '#938b80'];

/**
 * Persistent, physically-scaled city-damage layer for the in-game test range.
 *
 * Google Photorealistic 3D Tiles are streamed meshes and cannot be edited in
 * place, so this layer drops destructible building proxies over the selected
 * city. Unlike a single stylised blast circle, each proxy's fate is decided by
 * its real distance from ground zero against the weapon's overpressure zones
 * (cube-root scaled), and the fireball, crater and cloud come from the source
 * repository's researched weapon table. It never changes remote tiles or
 * game/server state.
 */
export function createNuclearDamageLayer(viewer) {
  const source = new Cesium.CustomDataSource('nuclear-city-damage');
  viewer.dataSources.add(source);
  const entities = source.entities;
  const zones = [];
  let generation = 0;

  async function groundHeight(lon, lat) {
    const position = Cesium.Cartographic.fromDegrees(lon, lat);
    try {
      if (typeof viewer.scene.sampleHeightMostDetailed === 'function') {
        const [sample] = await viewer.scene.sampleHeightMostDetailed([position]);
        if (sample && Number.isFinite(sample.height)) return sample.height;
      }
    } catch {}
    const terrain = viewer.scene.globe?.getHeight(position);
    return Number.isFinite(terrain) ? terrain : 0;
  }

  // Convert a metre offset to a lat/lon delta at the given latitude.
  const offset = (at, eastM, northM) => {
    const lat = at.lat + northM / 111_320;
    const lon = at.lon + eastM / (111_320 * Math.max(0.15, Math.cos((at.lat * Math.PI) / 180)));
    return { lat, lon };
  };

  async function apply(at, yieldMt, cityName = 'Выбранный город', bomb = null) {
    if (!Number.isFinite(at?.lon) || !Number.isFinite(at?.lat)) return null;
    const seed = hash(`${cityName}:${at.lat.toFixed(3)}:${at.lon.toFixed(3)}:${yieldMt}:${bomb?.id ?? '-'}`);
    let state = seed || 1;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };

    const model = zonesForBomb(bomb, Math.max(0, yieldMt) * 1000);
    const R = model.radiiM;
    // Buildings are only fabricated across the collapse front; intact outskirts
    // stay as the real satellite/tile city, so the overlay blends with reality.
    const collapseRadius = Math.max(R.heavy, R.fireball * 1.25, 120);
    const damageRadius = Math.max(R.light, collapseRadius * 1.15);
    const activeGeneration = generation;
    const baseHeight = await groundHeight(at.lon, at.lat);
    if (activeGeneration !== generation) return null;

    const start = performance.now();
    const zone = { cityName, at: { ...at }, yieldMt, bombId: bomb?.id ?? null, model, radiusKm: R.heavy / 1000, ids: [] };
    const add = (definition) => {
      const entity = entities.add(definition);
      zone.ids.push(entity);
      return entity;
    };
    const seconds = () => (performance.now() - start) / 1000;
    const fade = (from, duration, delay = 0) => new Cesium.CallbackProperty(
      () => from * clamp(1 - (seconds() - delay) / duration, 0, 1),
      false,
    );

    // --- Scorch: concentric damage contours, darkest toward ground zero. ------
    const scorchRings = [
      { radius: R.severe, css: '#0d0b0a', alpha: 0.5, duration: 22 },
      { radius: R.heavy, css: '#201a15', alpha: 0.34, duration: 18 },
      { radius: R.light, css: '#3a2f22', alpha: 0.2, duration: 14 },
    ];
    for (const ring of scorchRings) {
      if (ring.radius < 20) continue;
      const glow = fade(1, ring.duration, 1.4);
      add({
        position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat, baseHeight + 6),
        ellipse: {
          semiMajorAxis: ring.radius,
          semiMinorAxis: ring.radius * 0.9,
          height: baseHeight + 6,
          material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(
            () => Cesium.Color.fromCssColorString(ring.css)
              .withAlpha(ring.alpha * clamp(seconds() / 1.2, 0, 1)),
            false,
          )),
          outline: true,
          outlineColor: new Cesium.CallbackProperty(
            () => Cesium.Color.fromCssColorString('#ff7b36').withAlpha(0.5 * glow.getValue()),
            false,
          ),
          outlineWidth: 2,
        },
      });
    }

    // --- Crater: only for bursts the source table records as making one. -------
    if (model.hasCrater) {
      const cr = model.craterDiameterM / 2;
      add({
        position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat, baseHeight + 4),
        ellipse: {
          semiMajorAxis: cr,
          semiMinorAxis: cr * 0.92,
          height: baseHeight + 4,
          material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(
            () => Cesium.Color.fromCssColorString('#0a0908')
              .withAlpha(0.85 * clamp(seconds() / 3, 0, 1)),
            false,
          )),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#5a4632').withAlpha(0.7),
          outlineWidth: 3,
        },
      });
    }

    // --- Buildings: density set by the collapse-front area; skyline by range. ---
    const areaM2 = Math.PI * collapseRadius * collapseRadius;
    // Only the core (severe→heavy) is animated as it collapses; the outer
    // damaged band is placed as static blocks so per-frame cost stays bounded.
    const count = Math.round(clamp(areaM2 / 12_000, 0, 460));
    const farCount = count > 0 ? Math.round(clamp((areaM2 / 12_000) * 0.5, 40, 220)) : 0;

    const makeCoreBuilding = (distance, angle) => {
      const tier = damageTierAt(model, distance);
      if (tier === 'vaporized') return; // removed by fireball; scorch/crater covers it
      const profile = COLLAPSE[tier];
      const east = Math.cos(angle) * distance;
      const north = Math.sin(angle) * distance;
      const { lat, lon } = offset(at, east, north);

      const centralness = 1 - clamp(distance / damageRadius, 0, 1);
      const footprint = 40 + random() * 95 + centralness * 40;
      const originalHeight = 14 + Math.pow(random(), 0.6) * 60 + centralness * centralness * 190;
      // Blast wave arrives later the farther out it travels → expanding front.
      const arrival = 0.3 + (distance / damageRadius) * 2.4;
      const collapseDelay = arrival + random() * 0.9;
      const collapseDuration = 1.4 + random() * 2.6;
      const targetHeight = Math.max(1.2, originalHeight * profile.heightFraction);
      const spreadBoost = 1 + (1 - profile.heightFraction) * 0.7;

      const cartographic = Cesium.Cartographic.fromDegrees(lon, lat);
      const terrain = viewer.scene.globe?.getHeight(cartographic);
      const ground = Number.isFinite(terrain) ? terrain : baseHeight;
      const collapse = () => clamp(seconds() - collapseDelay, 0, collapseDuration) / collapseDuration;
      const heightNow = () => originalHeight + (targetHeight - originalHeight) * (collapse() ** 0.8);
      const colorIndex = Math.floor(random() * PALETTE.length);

      add({
        position: new Cesium.CallbackProperty(
          () => Cesium.Cartesian3.fromDegrees(lon, lat, ground + heightNow() / 2),
          false,
        ),
        box: {
          dimensions: new Cesium.CallbackProperty(() => {
            const p = collapse();
            const spread = 1 + p * (spreadBoost - 1);
            return new Cesium.Cartesian3(footprint * spread, footprint * spread, Math.max(1.5, heightNow()));
          }, false),
          material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => {
            const p = collapse();
            const intact = Cesium.Color.fromCssColorString(PALETTE[colorIndex]);
            const charred = Cesium.Color.fromCssColorString(
              tier === 'severe' ? '#1b1815' : tier === 'heavy' ? '#2a2521' : '#4a4038',
            );
            return Cesium.Color.lerp(intact, charred, p, new Cesium.Color()).withAlpha(0.97);
          }, false)),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#100f0e').withAlpha(0.65),
        },
      });

      // Fires ignite from thermal radiation, concentrated near ground zero and
      // scaled by the tier's ignition probability.
      if (random() < profile.fireChance * 0.16) {
        const fireDelay = collapseDelay + 0.8 + random() * 2.2;
        const fireFade = fade(0.92, 150, fireDelay);
        add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, ground + 10),
          point: {
            pixelSize: new Cesium.CallbackProperty(
              () => 4 + 12 * Math.abs(Math.sin(seconds() * 4.7 + distance)) * fireFade.getValue(),
              false,
            ),
            color: new Cesium.CallbackProperty(
              () => Cesium.Color.fromCssColorString('#ff6a22').withAlpha(fireFade.getValue()),
              false,
            ),
            outlineColor: Cesium.Color.fromCssColorString('#ffd27a'),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    };

    for (let i = 0; i < count; i += 1) {
      const distance = Math.sqrt(random()) * collapseRadius; // uniform over the disc
      makeCoreBuilding(distance, random() * Math.PI * 2);
    }
    // Outer damaged band: cracked-but-standing structures placed static (no
    // per-frame animation), tapering the destruction toward the light zone while
    // the real tile city shows beyond it.
    for (let i = 0; i < farCount; i += 1) {
      const distance = collapseRadius + random() * (damageRadius - collapseRadius);
      const tier = damageTierAt(model, distance);
      if (tier === 'vaporized') continue;
      const profile = COLLAPSE[tier];
      const angle = random() * Math.PI * 2;
      const { lat, lon } = offset(at, Math.cos(angle) * distance, Math.sin(angle) * distance);
      const centralness = 1 - clamp(distance / damageRadius, 0, 1);
      const footprint = 40 + random() * 95 + centralness * 40;
      const originalHeight = 14 + Math.pow(random(), 0.6) * 60 + centralness * centralness * 190;
      const h = Math.max(2, originalHeight * profile.heightFraction + 1);
      const spread = 1 + (1 - profile.heightFraction) * 0.7;
      const cartographic = Cesium.Cartographic.fromDegrees(lon, lat);
      const terrain = viewer.scene.globe?.getHeight(cartographic);
      const ground = Number.isFinite(terrain) ? terrain : baseHeight;
      const intact = Cesium.Color.fromCssColorString(PALETTE[Math.floor(random() * PALETTE.length)]);
      const charred = Cesium.Color.fromCssColorString(tier === 'light' ? '#4a4038' : '#3a352f');
      add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, ground + h / 2),
        box: {
          dimensions: new Cesium.Cartesian3(footprint * spread, footprint * spread, h),
          material: new Cesium.ColorMaterialProperty(
            Cesium.Color.lerp(intact, charred, 0.5, new Cesium.Color()).withAlpha(0.96),
          ),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#100f0e').withAlpha(0.5),
        },
      });
    }

    // --- Residual smoke: height and width track the researched cloud. ----------
    const cloudTopM = (model.cloudTopKm ? model.cloudTopKm * 1000 : 6000) * 0.45;
    const capM = (model.cloudCapKm ? model.cloudCapKm * 1000 : collapseRadius * 1.6) / 2;
    const smokeCount = clamp(Math.round(collapseRadius / 900), 8, 16);
    for (let i = 0; i < smokeCount; i += 1) {
      const angle = (i / smokeCount) * Math.PI * 2 + random();
      const distance = collapseRadius * (0.12 + random() * 0.7);
      const { lat, lon } = offset(at, Math.cos(angle) * distance, Math.sin(angle) * distance);
      const delay = 2 + random() * 5;
      const smokeFade = fade(0.5, 70, delay);
      const riseHeight = cloudTopM * (0.55 + random() * 0.6);
      const rise = new Cesium.CallbackProperty(
        () => clamp(seconds() - delay, 0, 1) * riseHeight,
        false,
      );
      add({
        position: new Cesium.CallbackProperty(
          () => Cesium.Cartesian3.fromDegrees(lon, lat, baseHeight + rise.getValue()),
          false,
        ),
        ellipsoid: {
          radii: new Cesium.CallbackProperty(() => {
            const r = 80 + rise.getValue() * 0.13 + capM * 0.04;
            return new Cesium.Cartesian3(r, r, r * 1.6);
          }, false),
          material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(
            () => Cesium.Color.fromCssColorString('#514b45').withAlpha(smokeFade.getValue()),
            false,
          )),
        },
      });
    }

    zones.push(zone);
    return {
      cityName,
      bombId: bomb?.id ?? null,
      radiusKm: R.heavy / 1000,
      fireballKm: R.fireball / 1000,
      severeKm: R.severe / 1000,
      heavyKm: R.heavy / 1000,
      lightKm: R.light / 1000,
      craterDiameterM: model.craterDiameterM,
      cloudTopKm: model.cloudTopKm,
      buildingCount: count + farCount,
    };
  }

  function reset() {
    generation += 1;
    entities.removeAll();
    zones.length = 0;
  }

  return {
    apply,
    reset,
    getZones: () => zones.map(({ cityName, yieldMt, radiusKm, bombId }) => ({ cityName, yieldMt, radiusKm, bombId })),
    destroy() { reset(); viewer.dataSources.remove(source, true); },
  };
}
