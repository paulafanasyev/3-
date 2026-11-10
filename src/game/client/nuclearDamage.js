import * as Cesium from 'cesium';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * Stylized, persistent city-damage layer for the in-game test range.
 * Google Photorealistic 3D Tiles are streamed meshes and cannot be edited in place;
 * this layer places destructible-looking building proxies, rubble, fire and smoke
 * over the selected city. It never changes the remote tiles or game/server state.
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

  async function apply(at, yieldMt, cityName = 'Выбранный город') {
    if (!Number.isFinite(at?.lon) || !Number.isFinite(at?.lat)) return null;
    const seed = hash(`${cityName}:${at.lat.toFixed(3)}:${at.lon.toFixed(3)}:${yieldMt}`);
    let state = seed || 1;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const radiusKm = clamp(1.4 + Math.pow(Math.max(0.01, yieldMt), 0.27) * 2.3, 1.8, 24);
    const radiusM = radiusKm * 1000;
    const activeGeneration = generation;
    const baseHeight = await groundHeight(at.lon, at.lat);
    if (activeGeneration !== generation) return null;
    const start = performance.now();
    const zone = { cityName, at: { ...at }, yieldMt, radiusKm, ids: [] };
    const add = (definition) => {
      const entity = entities.add(definition);
      zone.ids.push(entity);
      return entity;
    };
    const fade = (from, duration, delay = 0) => new Cesium.CallbackProperty(() => {
      const t = Math.max(0, (performance.now() - start) / 1000 - delay);
      return from * clamp(1 - t / duration, 0, 1);
    }, false);
    const scorchFade = fade(0.55, 16, 1.5);

    // Charred ground footprint; intentionally an illustrative game effect, not a physical damage contour.
    add({
      position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat, baseHeight + 8),
      ellipse: {
        semiMajorAxis: radiusM,
        semiMinorAxis: radiusM * 0.82,
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(
          () => Cesium.Color.fromCssColorString('#171514').withAlpha(0.48 * clamp((performance.now() - start) / 1800, 0, 1)),
          false,
        )),
        outline: true,
        outlineColor: new Cesium.CallbackProperty(() => Cesium.Color.fromCssColorString('#ff7b36').withAlpha(scorchFade.getValue()), false),
        outlineWidth: 2,
        height: baseHeight + 8,
      },
    });

    // Procedural urban blocks. They collapse into persistent low rubble after the flash.
    const count = 190;
    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * radiusM;
      const east = Math.cos(angle) * distance;
      const north = Math.sin(angle) * distance;
      const lat = at.lat + north / 111320;
      const lon = at.lon + east / (111320 * Math.max(0.15, Math.cos(at.lat * Math.PI / 180)));
      const width = 45 + random() * 115;
      const depth = 45 + random() * 115;
      const originalHeight = 18 + Math.pow(random(), 0.55) * 145;
      const collapseDelay = 0.7 + random() * 1.8;
      const collapseDuration = 1.8 + random() * 3.2;
      const rubbleHeight = 2 + random() * 8;
      const cartographic = Cesium.Cartographic.fromDegrees(lon, lat);
      const terrain = viewer.scene.globe?.getHeight(cartographic);
      const ground = Number.isFinite(terrain) ? terrain : baseHeight;
      const collapse = () => clamp((performance.now() - start) / 1000 - collapseDelay, 0, collapseDuration) / collapseDuration;
      const heightNow = () => originalHeight + (rubbleHeight - originalHeight) * (collapse() ** 0.82);
      const material = new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => {
        const p = collapse();
        const color = Cesium.Color.lerp(
          Cesium.Color.fromCssColorString(randomColor(i)),
          Cesium.Color.fromCssColorString('#242321'),
          p,
          new Cesium.Color(),
        );
        return color.withAlpha(0.96);
      }, false));
      add({
        position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(lon, lat, ground + heightNow() / 2), false),
        box: {
          dimensions: new Cesium.CallbackProperty(() => {
            const p = collapse();
            const spread = 1 + p * 0.65;
            return new Cesium.Cartesian3(width * spread, depth * spread, Math.max(1.5, heightNow()));
          }, false),
          material,
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#100f0e').withAlpha(0.7),
        },
      });
      if (i % 13 === 0) {
        const fireDelay = 1.3 + random() * 2.5;
        const fireFade = fade(0.92, 90, fireDelay);
        add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, ground + 12),
          point: {
            pixelSize: new Cesium.CallbackProperty(() => 4 + 11 * Math.abs(Math.sin((performance.now() - start) / 210 + i)) * fireFade.getValue(),
            false),
            color: new Cesium.CallbackProperty(() => Cesium.Color.fromCssColorString('#ff6a22').withAlpha(fireFade.getValue()), false),
            outlineColor: Cesium.Color.fromCssColorString('#ffd27a'),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    }

    // Rising smoke columns. Their opacity decays; rubble remains until reset.
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const distance = radiusM * (0.18 + random() * 0.68);
      const lon = at.lon + Math.cos(angle) * distance / (111320 * Math.max(0.15, Math.cos(at.lat * Math.PI / 180)));
      const lat = at.lat + Math.sin(angle) * distance / 111320;
      const delay = 2 + random() * 5;
      const smokeFade = fade(0.48, 55, delay);
      const riseHeight = 900 + random() * 1500;
      const rise = new Cesium.CallbackProperty(() => clamp((performance.now() - start) / 1000 - delay, 0, 1) * riseHeight, false);
      add({
        position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(lon, lat, baseHeight + rise.getValue()), false),
        ellipsoid: {
          radii: new Cesium.CallbackProperty(() => {
            const r = 90 + rise.getValue() * 0.14;
            return new Cesium.Cartesian3(r, r, r * 1.55);
          }, false),
          material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() =>
            Cesium.Color.fromCssColorString('#514b45').withAlpha(smokeFade.getValue()), false)),
        },
      });
    }
    zones.push(zone);
    return { cityName, radiusKm, buildingCount: count };
  }

  function randomColor(index) {
    const palette = ['#8e877d', '#aaa195', '#6d6963', '#b3a99b', '#77736d'];
    return palette[index % palette.length];
  }

  function reset() {
    generation += 1;
    entities.removeAll();
    zones.length = 0;
  }

  return {
    apply,
    reset,
    getZones: () => zones.map(({ cityName, yieldMt, radiusKm }) => ({ cityName, yieldMt, radiusKm })),
    destroy() { reset(); viewer.dataSources.remove(source, true); },
  };
}
