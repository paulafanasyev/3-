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
const PALETTE = ['#b7ada0', '#c6bcac', '#9c9384', '#d0c6b6', '#a59c8f', '#beb2a2'];

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
      { radius: R.severe, css: '#241f1a', alpha: 0.55, duration: 22 },
      { radius: R.heavy, css: '#33291f', alpha: 0.42, duration: 18 },
      { radius: R.light, css: '#4a3d2c', alpha: 0.26, duration: 14 },
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

    // --- Buildings: only inside the collapse front. ----------------------------
    // The light zone is window/door overpressure: buildings stay standing there,
    // so the real tile city is left alone and only the scorch contour marks it.
    // Fabricating rubble out to 43 km of a 50 Mt burst would put ruins on open
    // countryside, which is exactly what does not happen.
    const areaM2 = Math.PI * collapseRadius * collapseRadius;
    const coreRadius = Math.max(1, Math.min(R.severe, collapseRadius));
    const coreAreaM2 = Math.PI * coreRadius * coreRadius;
    // Only the innermost ring is animated while it falls; everything farther out
    // is placed already ruined as static geometry, which Cesium batches and so
    // costs no per-frame work.
    const count = Math.round(clamp(coreAreaM2 / 9_000, 0, 520));
    const infillCount = count > 0 ? Math.round(clamp((areaM2 - coreAreaM2) / 6_000, 0, 2_200)) : 0;
    // Each proxy stands for a whole city cell, so its footprint grows with the
    // cell instead of leaving a levelled 500 km² district dotted with specks.
    const coreCell = Math.sqrt(coreAreaM2 / Math.max(1, count));
    const infillCell = Math.sqrt(Math.max(0, areaM2 - coreAreaM2) / Math.max(1, infillCount));

    const makeCoreBuilding = (distance, angle, cell) => {
      const tier = damageTierAt(model, distance);
      if (tier === 'vaporized') return; // removed by fireball; scorch/crater covers it
      const profile = COLLAPSE[tier];
      const east = Math.cos(angle) * distance;
      const north = Math.sin(angle) * distance;
      const { lat, lon } = offset(at, east, north);

      const centralness = 1 - clamp(distance / damageRadius, 0, 1);
      const footprint = clamp(cell * (0.45 + random() * 0.6), 22, 260);
      const originalHeight = 14 + Math.pow(random(), 0.6) * 60 + centralness * centralness * 190;
      // Blast wave arrives later the farther out it travels → expanding front.
      const arrival = 0.3 + (distance / damageRadius) * 2.4;
      const collapseDelay = arrival + random() * 0.9;
      const collapseDuration = 1.4 + random() * 2.6;
      const targetHeight = Math.max(1.2, originalHeight * profile.heightFraction);
      const spreadBoost = 1 + (1 - profile.heightFraction) * 0.25;

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
              tier === 'severe' ? '#3c352e' : tier === 'heavy' ? '#585045' : '#6e6455',
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

    // A building placed already ruined: no per-frame callbacks, so Cesium
    // batches it with the rest of the static city fabric.
    const placeStaticBuilding = (distance, angle, cell) => {
      const tier = damageTierAt(model, distance);
      if (tier === 'vaporized') return;
      const profile = COLLAPSE[tier];
      const { lat, lon } = offset(at, Math.cos(angle) * distance, Math.sin(angle) * distance);
      const centralness = 1 - clamp(distance / damageRadius, 0, 1);
      const footprint = clamp(cell * (0.45 + random() * 0.6), 22, 260);
      const originalHeight = 14 + Math.pow(random(), 0.6) * 60 + centralness * centralness * 190;
      const h = Math.max(2, originalHeight * profile.heightFraction + 1);
      const spread = 1 + (1 - profile.heightFraction) * 0.25;
      const cartographic = Cesium.Cartographic.fromDegrees(lon, lat);
      const terrain = viewer.scene.globe?.getHeight(cartographic);
      const ground = Number.isFinite(terrain) ? terrain : baseHeight;
      const intact = Cesium.Color.fromCssColorString(PALETTE[Math.floor(random() * PALETTE.length)]);
      const charred = Cesium.Color.fromCssColorString('#544c41');
      add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, ground + h / 2),
        box: {
          dimensions: new Cesium.Cartesian3(footprint * spread, footprint * spread, h),
          material: new Cesium.ColorMaterialProperty(
            Cesium.Color.lerp(intact, charred, 1 - profile.heightFraction, new Cesium.Color()).withAlpha(0.96),
          ),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#100f0e').withAlpha(0.5),
        },
      });
    };

    for (let i = 0; i < count; i += 1) {
      const distance = Math.sqrt(random()) * coreRadius; // uniform over the disc
      makeCoreBuilding(distance, random() * Math.PI * 2, coreCell);
    }
    // Ruined fabric out to the collapse front, sampled uniformly by area.
    for (let i = 0; i < infillCount; i += 1) {
      const distance = Math.sqrt(coreRadius ** 2 + random() * (collapseRadius ** 2 - coreRadius ** 2));
      placeStaticBuilding(distance, random() * Math.PI * 2, infillCell);
    }

    // --- Остаточный дым горящего города. Гриб рисует объёмный проход, и эти
    // тела не должны его подменять: низкие медленные струи над зоной
    // обрушения, а не шары, взлетающие к куполу за одну секунду.
    const cloudTopM = (model.cloudTopKm ? model.cloudTopKm * 1000 : 6000) * 0.45;
    const smokeCount = clamp(Math.round(collapseRadius / 220), 14, 44);
    for (let i = 0; i < smokeCount; i += 1) {
      const angle = (i / smokeCount) * Math.PI * 2 + random();
      const distance = collapseRadius * (0.15 + random() * 0.8);
      const { lat, lon } = offset(at, Math.cos(angle) * distance, Math.sin(angle) * distance);
      const delay = 3 + random() * 12;
      const smokeFade = fade(0.26, 150, delay);
      const riseHeight = cloudTopM * (0.1 + random() * 0.16);
      const riseRate = 70 + random() * 50;
      const rise = new Cesium.CallbackProperty(
        () => clamp((seconds() - delay) / riseRate, 0, 1) * riseHeight,
        false,
      );
      add({
        position: new Cesium.CallbackProperty(
          () => Cesium.Cartesian3.fromDegrees(lon, lat, baseHeight + rise.getValue()),
          false,
        ),
        ellipsoid: {
          radii: new Cesium.CallbackProperty(() => {
            const r = 120 + rise.getValue() * 0.22;
            return new Cesium.Cartesian3(r, r, r * 1.15);
          }, false),
          material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(
            () => Cesium.Color.fromCssColorString('#3a332c').withAlpha(smokeFade.getValue()),
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
      buildingCount: count + infillCount,
      levelledAreaKm2: areaM2 / 1_000_000,
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
