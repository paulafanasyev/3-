// Свободный полёт камеры над Землёй в стратегическом виде «Купола»: мышь (обзор,
// колесо) остаётся родной для Cesium, а клавиши дают непрерывное движение, как в
// God's Eye View. Шаг считается по дуге эллипсоида, а не прямым translate():
// линейный сдвиг на орбитальных скоростях уносил бы камеру вверх по касательной.
import * as Cesium from 'cesium';

const A = Cesium.Ellipsoid.WGS84.maximumRadius;
const B = Cesium.Ellipsoid.WGS84.minimumRadius;
const E2 = 1 - (B * B) / (A * A);
const MAX_LAT = Cesium.Math.toRadians(89.5);
const YAW_RATE = 1.1; // рад/с
const SPEED_FRACTION = 0.28; // долей высоты в секунду — так же летает источник
const BOOST = 4;
const CREEP = 0.15;
const MIN_HEIGHT = 30;

const ROLES = new Map([
  ['w', 'fwd'], ['ц', 'fwd'], ['arrowup', 'fwd'],
  ['s', 'back'], ['ы', 'back'], ['arrowdown', 'back'],
  ['a', 'left'], ['ф', 'left'], ['arrowleft', 'left'],
  ['d', 'right'], ['в', 'right'], ['arrowright', 'right'],
  ['q', 'yawLeft'], ['й', 'yawLeft'],
  ['e', 'yawRight'], ['у', 'yawRight'],
  ['z', 'down'], ['я', 'down'], ['pagedown', 'down'],
  ['x', 'up'], ['ч', 'up'], ['pageup', 'up'],
  ['shift', 'boost'], ['control', 'creep'],
]);

// Меридианный и поперечный радиусы кривизны WGS84 для данной широты.
export function curvatureRadii(latRad) {
  const s = Math.sin(latRad);
  const w = 1 - E2 * s * s;
  const n = A / Math.sqrt(w);
  return { n, m: (n * (1 - E2)) / w };
}

/**
 * Смещение точки на поверхности по дуге: northM/eastM — метры к северу и востоку.
 * Чистая функция, чтобы сверять геометрию без браузера.
 */
export function groundStep({ latRad, lonRad, northM, eastM }) {
  const { n, m } = curvatureRadii(latRad);
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, latRad + northM / m));
  const cos = Math.max(0.02, Math.cos(latRad));
  let lon = lonRad + eastM / (n * cos);
  if (lon > Math.PI) lon -= 2 * Math.PI;
  if (lon < -Math.PI) lon += 2 * Math.PI;
  return { latRad: lat, lonRad: lon };
}

export function flightSpeed(heightM) {
  return Math.min(4e6, Math.max(30, Math.abs(heightM) * SPEED_FRACTION));
}

export function createFlightVector(held) {
  let fwd = 0; let side = 0; let lift = 0; let yaw = 0;
  for (const role of held) {
    if (role === 'fwd') fwd += 1;
    else if (role === 'back') fwd -= 1;
    else if (role === 'left') side -= 1;
    else if (role === 'right') side += 1;
    else if (role === 'up') lift += 1;
    else if (role === 'down') lift -= 1;
    else if (role === 'yawLeft') yaw -= 1;
    else if (role === 'yawRight') yaw += 1;
  }
  let scale = 1;
  if (held.has('boost')) scale *= BOOST;
  if (held.has('creep')) scale *= CREEP;
  return { fwd, side, lift, yaw, scale };
}

export function attachCameraFlight(viewer) {
  const held = new Set();
  let enabled = true;

  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.altKey || event.metaKey) return;
    if (event.ctrlKey && event.key.toLowerCase() !== 'control') return;
    const target = event.target?.tagName;
    if (target === 'INPUT' || target === 'TEXTAREA' || target === 'SELECT') return;
    const role = ROLES.get(String(event.key).toLowerCase());
    if (!role || !enabled) return;
    // любое ручное движение отнимает камеру у авто-наводки испытания
    if (held.size === 0) viewer.camera.cancelFlight();
    held.add(role);
    if (role !== 'boost' && role !== 'creep') event.preventDefault();
  };
  const onKeyUp = (event) => {
    const role = ROLES.get(String(event.key).toLowerCase());
    if (role) held.delete(role);
  };
  const onBlur = () => held.clear();

  const tick = () => {
    const nowMs = performance.now();
    if (!held.size) { tick.lastMs = nowMs; return; }
    const dt = Math.min(0.25, Math.max(0, nowMs - (tick.lastMs ?? nowMs)) / 1000);
    tick.lastMs = nowMs;
    if (dt <= 0) return;

    const camera = viewer.camera;
    const v = createFlightVector(held);
    const carto = Cesium.Cartographic.fromCartesian(camera.positionWC, Cesium.Ellipsoid.WGS84);
    const heading = camera.heading + v.yaw * YAW_RATE * dt;
    const speed = flightSpeed(carto.height) * v.scale;
    // Вперёд идём по азимуту камеры, а не по её 3D-направлению: в стратегическом
    // виде взгляд почти отвесно вниз, и проекция направления на землю обнулила бы W.
    const along = v.fwd * speed * dt;
    const across = v.side * speed * dt;
    const north = along * Math.cos(heading) - across * Math.sin(heading);
    const east = along * Math.sin(heading) + across * Math.cos(heading);
    const next = groundStep({ latRad: carto.latitude, lonRad: carto.longitude, northM: north, eastM: east });
    const height = Math.max(MIN_HEIGHT, carto.height + v.lift * speed * dt);

    camera.setView({
      destination: Cesium.Cartesian3.fromRadians(next.lonRad, next.latRad, height),
      orientation: { heading, pitch: camera.pitch, roll: camera.roll },
    });
  };

  const removeTick = viewer.clock.onTick.addEventListener(tick);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    setEnabled(value) { enabled = Boolean(value); held.clear(); },
    isEnabled: () => enabled,
    destroy() {
      removeTick();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      held.clear();
    },
  };
}
