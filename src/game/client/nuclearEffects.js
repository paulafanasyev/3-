// Картографический слой ядерного удара: то, что видно на карте, когда объёмный
// гриб (nuclearVolumetrics.js) слишком мелок для марша — фронт ударной волны,
// пылевой лист и кольцо Вильсона. Все радиусы берутся из реальной кинематики
// фронта (кривая DNA), поэтому линия пыли на карте и пылевой вал в объёме
// бегут с одной и той же скоростью.
import * as Cesium from 'cesium';
import { overpressurePsi, shockArrivalSeconds, shockRadiusM } from './nuclearBlastModel.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (value) => clamp(value, 0, 1);
const easeOut = (value) => 1 - (1 - clamp01(value)) ** 3;
const color = (hex, alpha = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(alpha);

// Cesium reads an ellipse's semiMajorAxis and semiMinorAxis in two separate
// calls. A property that samples the wall clock can therefore hand back a
// *larger* value for the minor axis than for the major one, and
// EllipseOutlineGeometry throws "semiMajorAxis must be greater than or equal to
// the semiMinorAxis", which stops the whole scene. These fronts only ever grow,
// so the minor axis reuses the last value the major axis produced (scaled by the
// flattening) and can never overtake it.
function axisPair(compute, flatten = 1) {
  let last = compute();
  return {
    major: new Cesium.CallbackProperty(() => {
      last = compute();
      return last;
    }, false),
    minor: new Cesium.CallbackProperty(() => last * flatten, false),
  };
}

export function createNuclearVisuals(entities, at, startedAt, intercepted = false, scale = 1, zones = null) {
  const added = [];
  const elapsed = () => Math.max(0, (performance.now() - startedAt) / 1000);
  const tint = intercepted ? color('#6bd8ff') : color('#ffb33d');
  // Без расчётных зон остаётся условный масштаб ~1 Мт: удары боёвки не выбирают
  // модель заряда, и им хватает одного кольца осколков.
  const kt = Number(zones?.yieldKt) > 0 ? Number(zones.yieldKt) : 1000;
  const cbrt = Math.cbrt(kt);
  const surface = /SURFACE|GROUND|SUBSURFACE|BURIED/i.test(String(zones?.burstType ?? ''));
  const lightM = Number(zones?.radiiM?.light);
  const unit = Number.isFinite(lightM) ? Math.max(0.01, lightM / 245_000) : scale;

  if (intercepted) {
    const wave = { delay: 0.08, duration: 2.2, max: 52_000 * unit };
    const progress = () => clamp01((elapsed() - wave.delay) / wave.duration);
    const { major, minor } = axisPair(() => Math.max(250, wave.max * easeOut(progress())));
    added.push(entities.add({
      position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat),
      ellipse: {
        semiMajorAxis: major,
        semiMinorAxis: minor,
        material: new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT),
        outline: true,
        outlineColor: new Cesium.CallbackProperty(() => tint.withAlpha(0.58 * (1 - progress())), false),
        outlineWidth: 2,
        height: 80,
      },
    }));
    return added;
  }

  // Фронт живёт, пока не выйдет за пределы зоны лёгких повреждений: дальше его
  // уже не разобрать, и рисовать нечего.
  const showR = Math.max(Number.isFinite(lightM) ? lightM * 2.2 : 245_000 * unit, 4_000 * cbrt);
  const lifeS = Math.max(1.2, shockArrivalSeconds(kt, showR, surface) * 1.3);
  const frontR = () => Math.max(200, shockRadiusM(kt, Math.min(elapsed(), lifeS), surface));
  const frontAge = () => clamp01(elapsed() / lifeS);

  // 1. Пылевой лист: диск до самого фронта, прозрачность — по давлению за
  // фронтом (тот же закон, что у DustLayer в источнике).
  const { major: dustMajor, minor: dustMinor } = axisPair(frontR, 0.995);
  added.push(entities.add({
    position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat, 40),
    ellipse: {
      semiMajorAxis: dustMajor,
      semiMinorAxis: dustMinor,
      height: 40,
      material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => {
        const psi = overpressurePsi(kt, frontR());
        return color('#b9a18a', clamp(clamp01((psi - 0.6) / 2.5) * 0.3 * (1 - frontAge() ** 1.6), 0, 0.34));
      }, false)),
    },
  }));

  // 2. Линия фронта поверх пыли — бледная нитка, пока давление ещё различимо.
  const { major: frontMajor, minor: frontMinor } = axisPair(frontR, 0.999);
  added.push(entities.add({
    position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat),
    ellipse: {
      semiMajorAxis: frontMajor,
      semiMinorAxis: frontMinor,
      material: new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT),
      outline: true,
      outlineColor: new Cesium.CallbackProperty(() => color('#e8f2ff', 0.5 * (1 - frontAge())), false),
      outlineWidth: 3,
      height: 120,
    },
  }));

  // 3. Кольцо Вильсона: конденсация во фронте у воздушных взрывов. По источнику
  // живёт 1,5·(W/20)^⅓ секунд и схлопывается задолго до конца фронта.
  const wilsonLife = 1.5 * (kt / 20) ** (1 / 3) + 0.4;
  const wilsonPeak = 7_000 * cbrt;
  const wilsonProgress = () => clamp01(elapsed() / wilsonLife);
  const { major: wilsonMajor, minor: wilsonMinor } = axisPair(
    () => Math.max(200, wilsonPeak * easeOut(wilsonProgress())),
    0.88,
  );
  added.push(entities.add({
    position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(at.lon, at.lat, 1_800 * cbrt), false),
    ellipse: {
      semiMajorAxis: wilsonMajor,
      semiMinorAxis: wilsonMinor,
      material: new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT),
      outline: true,
      outlineColor: new Cesium.CallbackProperty(() => color('#d8e9ed', 0.62 * (1 - wilsonProgress())), false),
      outlineWidth: 2,
    },
  }));

  // 4. Раскалённые обломки: только внутри зоны сильных разрушений и только
  // первые секунды — потом их уже не видно за пылью.
  const heavyM = Math.max(600, Number(zones?.radiiM?.heavy) || 22_000 * unit);
  for (let i = 0; i < 24; i += 1) {
    // Угол и дальность берём из хеша, а не из арифметической прогрессии: ровная
    // окружность из одинаковых точек читается как часовой циферблат, а не как
    // веер выброса.
    const angle = ((i * 2654435761) % 1000) / 1000 * Math.PI * 2;
    const reach = heavyM * (0.18 + ((i * 7919) % 1000) / 1000 * 0.8);
    const peak = Math.max(200, heavyM * 0.12) + ((i * 3571) % 4_000);
    const delay = 0.2 + (i % 7) * 0.05;
    const duration = 2.4 + (i % 5) * 0.3;
    const progress = () => clamp01((elapsed() - delay) / duration);
    const lon = at.lon + Math.cos(angle) * reach / (111320 * Math.max(0.15, Math.cos(at.lat * Math.PI / 180)));
    const lat = at.lat + Math.sin(angle) * reach / 111320;
    added.push(entities.add({
      position: new Cesium.CallbackProperty(() => {
        const p = easeOut(progress());
        return Cesium.Cartesian3.fromDegrees(
          at.lon + (lon - at.lon) * p,
          at.lat + (lat - at.lat) * p,
          Math.max(0, peak * Math.sin(Math.PI * progress())),
        );
      }, false),
      point: {
        // Метры, не пиксели: осколок в 30 м с 30 км — доли пикселя, и он обязан
        // исчезать, а не висеть жёлтыми пузырями над городом. Крупным он станет,
        // когда к нему подлетят.
        pixelSize: 18 + (i % 4) * 14,
        sizeInMeters: true,
        color: new Cesium.CallbackProperty(() => color(
          progress() < 0.35 ? '#ffcf82' : '#c2551d', 0.75 * (1 - progress())), false),
        outlineWidth: 0,
        disableDepthTestDistance: 0,
      },
    }));
  }

  return added;
}
