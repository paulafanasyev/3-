// Авторские визуальные эффекты для стратегической карты «Купола».
// Слой вдохновлён последовательностью вспышка → тепловое свечение → фронт волны
// → пылевой след, описанной в публичном проекте Atomic Bombs. Код и графика здесь
// написаны независимо; чужие исходники, модели и аудиозаписи не копируются.
import * as Cesium from 'cesium';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const easeOut = (value) => 1 - (1 - clamp01(value)) ** 3;

/**
 * Добавляет к точке игрового события кинематографический визуальный слой.
 * Это только декоративная анимация на карте: она не рассчитывает реальные зоны
 * поражения и не меняет игровую логику, состояние мира или сетевой протокол.
 */
export function createNuclearVisuals(entities, at, startedAt, intercepted = false, scale = 1) {
  const added = [];
  const elapsed = () => Math.max(0, (performance.now() - startedAt) / 1000);
  const tint = intercepted
    ? Cesium.Color.fromCssColorString('#6bd8ff')
    : Cesium.Color.fromCssColorString('#ffb33d');

  // Три разнесённых во времени кольца дают читаемый фронт расширения на глобусе.
  const waves = intercepted
    ? [{ delay: 0.08, duration: 2.2, max: 52_000 }]
    : [
      { delay: 0.10, duration: 3.2, max: 105_000 * scale },
      { delay: 0.48, duration: 4.4, max: 178_000 * scale },
      { delay: 0.92, duration: 5.4, max: 245_000 * scale },
    ];

  for (const wave of waves) {
    const progress = () => clamp01((elapsed() - wave.delay) / wave.duration);
    const radius = new Cesium.CallbackProperty(
      () => Math.max(250, wave.max * easeOut(progress())),
      false,
    );
    const opacity = new Cesium.CallbackProperty(
      () => tint.withAlpha((intercepted ? 0.58 : 0.42) * (1 - progress())),
      false,
    );
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

  if (!intercepted) {
    // Короткий тепловой ореол над эпицентром, быстро переходящий от белого к янтарному.
    const flashAlpha = new Cesium.CallbackProperty(() => {
      const t = elapsed();
      if (t < 0.12) return 0.92;
      if (t > 1.35) return 0;
      return 0.92 * (1 - (t - 0.12) / 1.23) ** 1.7;
    }, false);
    const flashRadius = new Cesium.CallbackProperty(() => {
      const t = clamp01(elapsed() / 1.1);
      return new Cesium.Cartesian3(
        (7_000 + 32_000 * easeOut(t)) * scale,
        7_000 + 32_000 * easeOut(t),
        (5_000 + 19_000 * easeOut(t)) * scale,
      );
    }, false);
    added.push(entities.add({
      position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(at.lon, at.lat, 18_000), false),
      ellipsoid: {
        radii: flashRadius,
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(
          () => Cesium.Color.lerp(Cesium.Color.WHITE, tint, clamp01(elapsed() / 0.8), new Cesium.Color()).withAlpha(flashAlpha.getValue()),
          false,
        )),
      },
    }));

    // Пыльное основание: широкая полупрозрачная юбка, постепенно растворяющаяся.
    const dustAlpha = new Cesium.CallbackProperty(() => {
      const t = elapsed();
      return t < 0.7 || t > 8 ? 0 : 0.22 * Math.min(1, (t - 0.7) / 1.2) * (1 - (t - 0.7) / 7.3);
    }, false);
    const dustRadius = new Cesium.CallbackProperty(() => {
      const t = clamp01((elapsed() - 0.7) / 6.5);
      return (12_000 + 88_000 * easeOut(t)) * scale;
    }, false);
    added.push(entities.add({
      position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat, 900),
      ellipse: {
        semiMajorAxis: dustRadius,
        semiMinorAxis: new Cesium.CallbackProperty(() => dustRadius.getValue() * 0.72, false),
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(
          () => Cesium.Color.fromCssColorString('#b9a18a').withAlpha(Math.max(0, dustAlpha.getValue())),
          false,
        )),
        height: 900,
      },
    }));
  }

  return added;
}
