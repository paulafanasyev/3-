import * as Cesium from 'cesium';

/**
 * «Ядерный полигон» — визуальный sandbox. Не отправляет команды на сервер,
 * не расходует боеголовки и не меняет состояние партии.
 */
export function createNuclearRange({ root, viewer, layers }) {
  const style = document.createElement('style');
  style.textContent = `
    .k-nrange-trigger{position:absolute;right:62px;top:80px;z-index:25;pointer-events:auto;padding:9px 13px;border:1px solid rgba(255,190,75,.5);border-radius:10px;background:rgba(22,19,16,.88);color:#ffd58a;font:700 12px "Noto Sans",sans-serif;cursor:pointer;box-shadow:0 5px 18px rgba(0,0,0,.28)}
    .k-nrange-panel{position:absolute;right:16px;top:124px;z-index:55;width:min(340px,calc(100vw - 32px));padding:16px;border:1px solid rgba(255,190,75,.35);border-radius:14px;background:rgba(10,16,25,.96);color:#edf2fa;box-shadow:0 14px 40px rgba(0,0,0,.45);font:13px/1.45 "Noto Sans",sans-serif;pointer-events:auto}
    .k-nrange-panel[hidden]{display:none}.k-nrange-panel h3{margin:0 30px 6px 0;color:#ffd58a;font-size:17px}.k-nrange-panel p{margin:0 0 12px;color:#aebbd0}
    .k-nrange-panel label{display:block;margin:10px 0 5px;color:#c9d4e4}.k-nrange-panel select{width:100%;padding:9px;border:1px solid #46546a;border-radius:8px;background:#172437;color:#fff;font:inherit}
    .k-nrange-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:12px}.k-nrange-panel button{padding:9px 10px;border:1px solid #46546a;border-radius:8px;background:#1b2a3e;color:#eef4ff;font:600 12px "Noto Sans",sans-serif;cursor:pointer}
    .k-nrange-panel button.primary{border-color:#b47b2b;background:linear-gradient(180deg,#e8b65e,#bb7e2e);color:#211607}.k-nrange-panel .k-nrange-close{position:absolute;right:10px;top:9px;padding:3px 8px;border:0;background:transparent;color:#b7c2d2;font-size:20px}
    .k-nrange-status{min-height:34px;margin-top:10px;padding:8px;border-radius:8px;background:rgba(255,255,255,.05);color:#bdc9da;font-size:11px}
    @media(max-width:900px){.k-nrange-trigger{right:60px;top:118px}.k-nrange-panel{top:158px}}
  `;
  root.appendChild(style);

  const trigger = document.createElement('button');
  trigger.className = 'k-nrange-trigger';
  trigger.type = 'button';
  trigger.textContent = '☢ ЯДЕРНЫЙ ПОЛИГОН';
  trigger.setAttribute('aria-expanded','false');
  root.appendChild(trigger);

  const panel = document.createElement('section');
  panel.className = 'k-nrange-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <button class="k-nrange-close" type="button" aria-label="Закрыть">×</button>
    <h3>Ядерный полигон</h3>
    <p>Демонстрация эффектов на глобусе. Испытание не влияет на игровую партию.</p>
    <label for="k-nrange-bomb">Модель испытания</label>
    <select id="k-nrange-bomb">
      <option value="1.6">РДС-37 · 1,6 Мт</option>
      <option value="15">Castle Bravo · 15 Мт</option>
      <option value="50">Царь-бомба · 50 Мт</option>
    </select>
    <div class="k-nrange-status" data-status>Точка: центр текущего вида карты</div>
    <div class="k-nrange-actions">
      <button type="button" data-pick>Выбрать точку</button>
      <button type="button" class="primary" data-test>Запустить тест</button>
    </div>
  `;
  root.appendChild(panel);

  const status = panel.querySelector('[data-status]');
  const pickButton = panel.querySelector('[data-pick]');
  let target = null;
  let selecting = false;

  const close = () => {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded','false');
    selecting = false;
    pickButton.textContent = 'Выбрать точку';
  };
  trigger.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    trigger.setAttribute('aria-expanded', String(!panel.hidden));
  });
  panel.querySelector('.k-nrange-close').addEventListener('click', close);

  const readPoint = (position) => {
    let cartesian;
    if (viewer.scene.pickPositionSupported) cartesian = viewer.scene.pickPosition(position);
    if (!Cesium.defined(cartesian)) cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
    if (!Cesium.defined(cartesian)) return null;
    const c = Cesium.Cartographic.fromCartesian(cartesian);
    return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) };
  };

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((event) => {
    if (!selecting || panel.hidden) return;
    const point = readPoint(event.position);
    if (!point) {
      status.textContent = 'Не удалось определить поверхность. Приблизьте глобус и выберите точку ещё раз.';
      return;
    }
    target = point;
    selecting = false;
    pickButton.textContent = 'Выбрать другую точку';
    status.textContent = `Точка испытания: ${point.lat.toFixed(2)}°, ${point.lon.toFixed(2)}°`;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  pickButton.addEventListener('click', () => {
    selecting = true;
    pickButton.textContent = 'Щёлкните по глобусу…';
    status.textContent = 'Выберите точку на поверхности глобуса';
  });

  panel.querySelector('[data-test]').addEventListener('click', () => {
    const point = target ?? readPoint(new Cesium.Cartesian2(
      viewer.scene.canvas.clientWidth / 2,
      viewer.scene.canvas.clientHeight / 2,
    ));
    if (!point) {
      status.textContent = 'Не удалось определить точку. Нажмите «Выбрать точку» и укажите место на карте.';
      return;
    }
    const yieldMt = Number(panel.querySelector('#k-nrange-bomb').value);
    const ok = layers.playNuclearTest(point, yieldMt);
    status.textContent = ok
      ? `Тест запущен: ${yieldMt.toLocaleString('ru-RU')} Мт · ${point.lat.toFixed(2)}°, ${point.lon.toFixed(2)}°`
      : 'Не удалось запустить визуализацию.';
  });

  return { close, destroy() { handler.destroy(); trigger.remove(); panel.remove(); style.remove(); } };
}
