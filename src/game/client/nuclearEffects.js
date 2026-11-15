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

// У point sizeInMeters в этом Cesium не работает: пробой point-probe.mjs меряли
// 60, 150 и 300 «метров» с 1,5 и 8,3 км — каждый раз рисовалось ровно столько
// же ПИКСЕЛЕЙ, то есть размер от дистанции не зависел вообще. Поэтому метры
// считаем сами: проецируем точку и точку в 100 метрах выше по up камеры. Та же
// проба подтвердила пересчёт — 300 м с 8,3 км дали запрошенные 30,1 px и
// нарисованные 30×30, а 30 м с 8,3 км погасли сами, не дотянув до пикселя.
function metersToPixels(meters, position, scene) {
  if (!scene) return 0;
  const a = Cesium.SceneTransforms.worldToWindowCoordinates(scene, position);
  if (!a) return 0;
  const up = Cesium.Cartesian3.multiplyByScalar(scene.camera.upWC, 100, new Cesium.Cartesian3());
  const b = Cesium.SceneTransforms.worldToWindowCoordinates(
    scene,
    Cesium.Cartesian3.add(position, up, new Cesium.Cartesian3()),
  );
  if (!b) return 0;
  return meters * Math.hypot(b.x - a.x, b.y - a.y) / 100;
}

export function createNuclearVisuals(entities, at, startedAt, intercepted = false, scale = 1, zones = null, scene = null, volumeShown = null) {
  const added = [];
  const elapsed = () => Math.max(0, (performance.now() - startedAt) / 1000);
  // Знаки карты уступают объёмному проходу: два слоя одного предмета в кадре
  // складываются в серый блин с пунктиром интерфейса.
  // Знаки карты уступают объёмному проходу: два слоя одного предмета в кадре
  // складываются в серый блин с пунктиром интерфейса. Гасим их заменой свойства
  // новым объектом (hideMapSigns): перечитывание CallbackProperty — show, цвет,
  // радиус — геометрию не трогает, и замер 15.11 оставил в кадре диск при
  // show=false, нулевой альфе и радиусе в один метр.
  const volumeLive = typeof volumeShown === 'function' ? volumeShown() : false;
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
  //
  // Лист и нитка фронта — условные знаки стратегической карты. Пока объёмный
  // проход жив, они только портят кадр: полигон с камеры выглядит серым блином
  // с пунктиром интерфейса поверх настоящего гриба.
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
    // Камень из воронки — единицы метров, не пузыри в 60 px: с 8 км он не
    // разрешается ничем, а крупным станет, когда к нему подлетят.
    const fragmentM = 3 + (i % 4) * 3;
    let pos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    added.push(entities.add({
      position: new Cesium.CallbackProperty(() => {
        const p = easeOut(progress());
        pos = Cesium.Cartesian3.fromDegrees(
          at.lon + (lon - at.lon) * p,
          at.lat + (lat - at.lat) * p,
          Math.max(0, peak * Math.sin(Math.PI * progress())),
        );
        return pos;
      }, false),
      point: {
        pixelSize: new Cesium.CallbackProperty(() => metersToPixels(fragmentM, pos, scene), false),
        color: new Cesium.CallbackProperty(() => color(
          progress() < 0.35 ? '#ffcf82' : '#c2551d', 0.75 * (1 - progress())), false),
        outlineWidth: 0,
        disableDepthTestDistance: 0,
      },
    }));
  }

  if (volumeLive) hideMapSigns(added);

  return added;
}

/**
 * Гасит картографические знаки удара. Работает только замена свойства новым
 * объектом: Cesium перестраивает геометрию эллипса по событию changed, а
 * CallbackProperty он перечитывает, но геометрию от него не пересобирает —
 * на кадре остаётся диск, запечённый до марша (замер 15.11).
 */
export function hideMapSigns(items) {
  for (const item of items) {
    if (item?.ellipse) item.ellipse.show = new Cesium.ConstantProperty(false);
  }
}
