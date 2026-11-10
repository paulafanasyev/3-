// Cesium port of the source project's layered explosion sequence:
// flash, fireball, expanding shock fronts, Wilson condensation ring, dust wall and ejecta.
// Godot shaders are engine-specific; their timing/profile data is adapted to Cesium entities.
import * as Cesium from 'cesium';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const easeOut = (value) => 1 - (1 - clamp01(value)) ** 3;
const color = (hex, alpha = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(alpha);

export function createNuclearVisuals(entities, at, startedAt, intercepted = false, scale = 1) {
  const added = [];
  const elapsed = () => Math.max(0, (performance.now() - startedAt) / 1000);
  const tint = intercepted ? color('#6bd8ff') : color('#ffb33d');
  const waves = intercepted
    ? [{ delay: 0.08, duration: 2.2, max: 52_000 }]
    : [
      { delay: 0.10, duration: 3.2, max: 105_000 * scale },
      { delay: 0.48, duration: 4.4, max: 178_000 * scale },
      { delay: 0.92, duration: 5.4, max: 245_000 * scale },
    ];

  // Multiple shock fronts, each with its own propagation timing.
  for (const wave of waves) {
    const progress = () => clamp01((elapsed() - wave.delay) / wave.duration);
    const radius = new Cesium.CallbackProperty(() => Math.max(250, wave.max * easeOut(progress())), false);
    const opacity = new Cesium.CallbackProperty(() => tint.withAlpha((intercepted ? 0.58 : 0.42) * (1 - progress())), false);
    added.push(entities.add({
      position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat),
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius,
        material: new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT),
        outline: true,
        outlineColor: opacity,
        outlineWidth: intercepted ? 2 : 3,
        height: 80,
      },
    }));
  }

  if (intercepted) return added;

  // Thermal flash / fireball glow.
  const flashAlpha = new Cesium.CallbackProperty(() => {
    const t = elapsed();
    if (t < 0.12) return 0.92;
    if (t > 1.35) return 0;
    return 0.92 * (1 - (t - 0.12) / 1.23) ** 1.7;
  }, false);
  const flashRadius = new Cesium.CallbackProperty(() => {
    const t = easeOut(elapsed() / 1.1);
    return new Cesium.Cartesian3((7_000 + 32_000 * t) * scale, (7_000 + 32_000 * t) * scale, (5_000 + 19_000 * t) * scale);
  }, false);
  added.push(entities.add({
    position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(at.lon, at.lat, 18_000 * scale), false),
    ellipsoid: {
      radii: flashRadius,
      material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(
        () => Cesium.Color.lerp(Cesium.Color.WHITE, tint, clamp01(elapsed() / 0.8), new Cesium.Color()).withAlpha(flashAlpha.getValue()),
        false,
      )),
    },
  }));

  // Low dust sheet and a second, broader dust-wall front.
  const dustAlpha = new Cesium.CallbackProperty(() => {
    const t = elapsed();
    return t < 0.7 || t > 15 ? 0 : 0.28 * Math.min(1, (t - 0.7) / 1.2) * (1 - (t - 0.7) / 14.3);
  }, false);
  const dustRadius = new Cesium.CallbackProperty(() => 12_000 + 88_000 * scale * easeOut((elapsed() - 0.7) / 7.5), false);
  added.push(entities.add({
    position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat, 900),
    ellipse: {
      semiMajorAxis: dustRadius,
      semiMinorAxis: new Cesium.CallbackProperty(() => dustRadius.getValue() * 0.72, false),
      material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(
        () => color('#b9a18a', Math.max(0, dustAlpha.getValue())),
        false,
      )),
      height: 900,
    },
  }));

  // Wilson condensation ring: a short-lived pale ring above the ground.
  const wilsonRadius = new Cesium.CallbackProperty(() => (2_000 + 34_000 * scale * easeOut((elapsed() - 0.25) / 4.8)), false);
  const wilsonAlpha = new Cesium.CallbackProperty(() => {
    const t = elapsed();
    return color('#d8e9ed', t < 0.3 || t > 7 ? 0 : 0.62 * (1 - (t - 0.3) / 6.7));
  }, false);
  added.push(entities.add({
    position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(at.lon, at.lat, 1_800 * scale), false),
    ellipse: {
      semiMajorAxis: wilsonRadius,
      semiMinorAxis: new Cesium.CallbackProperty(() => wilsonRadius.getValue() * 0.88, false),
      material: new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT),
      outline: true,
      outlineColor: wilsonAlpha,
      outlineWidth: 2,
    },
  }));

  // Stylized ejecta / hot fragments, following deterministic radial trajectories.
  for (let i = 0; i < 36; i += 1) {
    const angle = (i / 36) * Math.PI * 2;
    const reach = (18_000 + ((i * 7919) % 31_000)) * scale;
    const peak = (1_500 + ((i * 3571) % 8_000)) * scale;
    const delay = 0.25 + (i % 7) * 0.07;
    const duration = 2.8 + (i % 5) * 0.32;
    const progress = () => clamp01((elapsed() - delay) / duration);
    const lon = at.lon + Math.cos(angle) * reach / (111320 * Math.max(0.15, Math.cos(at.lat * Math.PI / 180)));
    const lat = at.lat + Math.sin(angle) * reach / 111320;
    added.push(entities.add({
      position: new Cesium.CallbackProperty(() => {
        const p = progress();
        return Cesium.Cartesian3.fromDegrees(
          at.lon + (lon - at.lon) * easeOut(p),
          at.lat + (lat - at.lat) * easeOut(p),
          Math.max(0, peak * Math.sin(Math.PI * p)),
        );
      }, false),
      point: {
        pixelSize: 3 + (i % 4),
        color: new Cesium.CallbackProperty(() => color('#ff9a42', 0.9 * (1 - progress())), false),
        outlineColor: color('#fff0c0', 0.8),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }));
  }

  return added;
}
