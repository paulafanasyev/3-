// Зум камеры делаем сам, а не через Cesium. Замер в живой игре: один щелчок
// колеса, после которого дали дойти инерции, снимает 59% высоты, а десять
// щелчков подряд каждые 40 мс не двигают камеру вообще — следующий твин обрывает
// предыдущий. Здесь шаг детерминированный: множитель расстояния до точки в
// центре кадра, поэтому колесо, трекпад и кнопки «+/−» ведут себя одинаково.
import * as Cesium from 'cesium';

export const MIN_RANGE = 1; // метр: ближе к крыше уже некуда
export const MAX_RANGE = 4.5e7; // 45 000 км: весь диск Земли в кадре с запасом
export const BUTTON_FACTOR = 1.8; // что делает одно нажатие «+» или «−»
const WHEEL_LOG_PER_PIXEL = 0.0035;

// Chrome отдаёт deltaY в пикселях (0), Firefox на Linux — в строках (1),
// PageDown-скролл — страницами (2).
const DELTA_UNIT = [1, 16, 100];

/** Множитель расстояния для события колеса: deltaY меньше нуля — ближе. */
export function wheelFactor({ deltaY, deltaMode = 0 } = {}) {
  const pixels = Number(deltaY) * (DELTA_UNIT[deltaMode] ?? 1);
  if (!Number.isFinite(pixels) || pixels === 0) return 1;
  return Math.exp(-pixels * WHEEL_LOG_PER_PIXEL);
}

/** Новое расстояние до точки в центре кадра, зажатое пределами. */
export function nextRange({ range, factor, min = MIN_RANGE, max = MAX_RANGE }) {
  if (!Number.isFinite(range) || range <= 0 || !Number.isFinite(factor) || factor <= 0) return range;
  return Math.min(max, Math.max(min, range / factor));
}

export function attachCameraZoom(viewer) {
  const scene = viewer.scene;
  const controller = scene.screenSpaceCameraController;
  // Колесо НЕ вычёсывается из controller.zoomEventTypes: этот список живёт на
  // внутреннем перечислении движений (LEFT_DRAG 0 … PINCH 4), которого нет в
  // публичном API. Подстановка туда ScreenSpaceEventType.RIGHT_DRAG даёт
  // undefined, и через кадр рендер встаёт с «reading 'eventType'» — замерено.
  // Поэтому событие перехватывается на window и до canvas не доходит.
  controller.minimumZoomDistance = MIN_RANGE;
  controller.maximumZoomDistance = MAX_RANGE;

  const center = new Cesium.Cartesian2();

  // Расстояние до земли ровно по лучу в центр экрана: тогда наклонная камера
  // наезжает на точку, а не ползёт вверх по эллипсоиду.
  const groundRange = () => {
    const camera = viewer.camera;
    center.x = scene.canvas.clientWidth / 2;
    center.y = scene.canvas.clientHeight / 2;
    const ray = camera.getPickRay(center);
    const hit = ray && scene.globe.pick(ray, scene);
    const from = hit ?? Cesium.Cartesian3.fromRadians(
      camera.positionCartographic.longitude, camera.positionCartographic.latitude, 0,
    );
    return Cesium.Cartesian3.distance(camera.positionWC, from);
  };

  const zoomBy = (factor) => {
    const camera = viewer.camera;
    const range = groundRange();
    const wanted = nextRange({ range, factor });
    const delta = range - wanted;
    if (Math.abs(delta) <= 0.5) return wanted;
    // вызов через тернарник оторвал бы метод от камеры: zoomIn живёт на this
    if (delta > 0) camera.zoomIn(delta);
    else camera.zoomOut(-delta);
    return wanted;
  };

  const onWheel = (event) => {
    // список городов в панели полигона обязан скроллиться как обычно: под
    // перехват попадает только то, что пришло прямо на глобус
    if (event.target !== scene.canvas) return;
    const factor = wheelFactor(event);
    if (factor === 1) return;
    event.preventDefault();
    event.stopPropagation();
    // авто-наводка кадра испытания не имеет права держать камеру: игрок волен
    // залететь колесом в гриб прямо во время подлёта
    viewer.camera.cancelFlight();
    zoomBy(factor);
  };
  const onPointerDown = () => viewer.camera.cancelFlight();

  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  scene.canvas.addEventListener('pointerdown', onPointerDown);

  return {
    zoomIn: () => zoomBy(BUTTON_FACTOR),
    zoomOut: () => zoomBy(1 / BUTTON_FACTOR),
    range: groundRange,
    destroy() {
      window.removeEventListener('wheel', onWheel, { capture: true });
      scene.canvas.removeEventListener('pointerdown', onPointerDown);
    },
  };
}
