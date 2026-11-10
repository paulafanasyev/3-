import * as Cesium from 'cesium';
import populatedPlaces from '../data/populated_places.json';
import { NUCLEAR_AUDIO_SAMPLES, defaultNuclearSound } from './nuclearAudio.js';

const BOMBS = [
  { id: 'fat-man', name: 'Толстяк (Fat Man)', country: 'США', year: '1945', yieldKt: 21, kind: 'Плутониевая атомная бомба' },
  { id: 'little-boy', name: 'Малыш (Little Boy)', country: 'США', year: '1945', yieldKt: 15, kind: 'Урановая атомная бомба' },
  { id: 'rds-1', name: 'РДС-1', country: 'СССР', year: '1949', yieldKt: 22, kind: 'Атомная бомба' },
  { id: 'rds-2', name: 'РДС-2', country: 'СССР', year: '1951', yieldKt: 38, kind: 'Атомная бомба' },
  { id: 'rds-3', name: 'РДС-3', country: 'СССР', year: '1951', yieldKt: 41, kind: 'Атомная бомба' },
  { id: 'ivy-mike', name: 'Ivy Mike', country: 'США', year: '1952', yieldKt: 10400, kind: 'Термоядерное устройство' },
  { id: 'rds-4', name: 'РДС-4', country: 'СССР', year: '1953', yieldKt: 28, kind: 'Тактическая атомная бомба' },
  { id: 'rds-5', name: 'РДС-5', country: 'СССР', year: '1953', yieldKt: 10, kind: 'Атомная бомба' },
  { id: 'rds-6s', name: 'РДС-6с', country: 'СССР', year: '1953', yieldKt: 400, kind: 'Термоядерное устройство' },
  { id: 'castle-bravo', name: 'Castle Bravo', country: 'США', year: '1954', yieldKt: 15000, kind: 'Термоядерная бомба' },
  { id: 'castle-romeo', name: 'Castle Romeo', country: 'США', year: '1954', yieldKt: 11000, kind: 'Термоядерная бомба' },
  { id: 'castle-yankee', name: 'Castle Yankee', country: 'США', year: '1954', yieldKt: 13500, kind: 'Термоядерная бомба' },
  { id: 'mk17', name: 'Mk 17', country: 'США', year: '1954', yieldKt: 10000, kind: 'Стратегическая термоядерная бомба (оценка)' },
  { id: 'rds-37', name: 'РДС-37', country: 'СССР', year: '1955', yieldKt: 1600, kind: 'Термоядерная бомба' },
  { id: 'grapple-x', name: 'Grapple X', country: 'Великобритания', year: '1957', yieldKt: 1800, kind: 'Термоядерная бомба' },
  { id: 'grapple-y', name: 'Grapple Y', country: 'Великобритания', year: '1958', yieldKt: 3000, kind: 'Термоядерная бомба' },
  { id: 'b41', name: 'B41', country: 'США', year: '1961', yieldKt: 25000, kind: 'Стратегическая термоядерная бомба (расчётная максимальная мощность)' },
  { id: 'tsar', name: 'Царь-бомба (АН602)', country: 'СССР', year: '1961', yieldKt: 50000, kind: 'Термоядерная авиабомба' },
  { id: 'b53', name: 'B53', country: 'США', year: '1962', yieldKt: 9000, kind: 'Стратегическая термоядерная бомба' },
  { id: 'china-test-6', name: 'Испытание № 6', country: 'Китай', year: '1967', yieldKt: 3300, kind: 'Термоядерное испытание' },
  { id: 'canopus', name: 'Canopus', country: 'Франция', year: '1968', yieldKt: 2600, kind: 'Термоядерное испытание' },
];
const CITIES = populatedPlaces.places;
const formatYield = (kt) => kt >= 1000 ? `${(kt / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} Мт` : `${kt.toLocaleString('ru-RU')} кт`;

export function createNuclearRange({ root, viewer, layers }) {
  const style = document.createElement('style');
  style.textContent = `
    .k-nrange-trigger{position:absolute;right:62px;top:80px;z-index:25;pointer-events:auto;padding:9px 13px;border:1px solid rgba(255,190,75,.5);border-radius:10px;background:rgba(22,19,16,.9);color:#ffd58a;font:700 12px "Noto Sans",sans-serif;cursor:pointer;box-shadow:0 5px 18px rgba(0,0,0,.28)}
    .k-nrange-panel{position:absolute;right:16px;top:124px;z-index:55;width:min(390px,calc(100vw - 32px));max-height:calc(100vh - 150px);overflow:auto;padding:16px;border:1px solid rgba(255,190,75,.35);border-radius:14px;background:rgba(10,16,25,.97);color:#edf2fa;box-shadow:0 14px 40px rgba(0,0,0,.45);font:13px/1.45 "Noto Sans",sans-serif;pointer-events:auto}
    .k-nrange-panel[hidden]{display:none}.k-nrange-panel h3{margin:0 30px 6px 0;color:#ffd58a;font-size:17px}.k-nrange-panel p{margin:0 0 12px;color:#aebbd0}
    .k-nrange-panel label{display:block;margin:10px 0 5px;color:#c9d4e4}.k-nrange-panel select,.k-nrange-panel input{box-sizing:border-box;width:100%;padding:9px;border:1px solid #46546a;border-radius:8px;background:#172437;color:#fff;font:inherit}
    .k-nrange-panel select[size]{height:116px}.k-nrange-panel .k-nrange-check{display:flex;align-items:center;gap:9px}.k-nrange-panel .k-nrange-check input{width:auto;accent-color:#d89a42}
    .k-nrange-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:12px}.k-nrange-panel button{padding:9px 10px;border:1px solid #46546a;border-radius:8px;background:#1b2a3e;color:#eef4ff;font:600 12px "Noto Sans",sans-serif;cursor:pointer}
    .k-nrange-panel button.primary{border-color:#b47b2b;background:linear-gradient(180deg,#e8b65e,#bb7e2e);color:#211607}.k-nrange-panel button:disabled{opacity:.55;cursor:wait}
    .k-nrange-panel .k-nrange-close{position:absolute;right:10px;top:9px;padding:3px 8px;border:0;background:transparent;color:#b7c2d2;font-size:20px}
    .k-nrange-status{min-height:34px;margin-top:10px;padding:8px;border-radius:8px;background:rgba(255,255,255,.05);color:#bdc9da;font-size:11px}
    .k-nrange-muted{font-size:10px;color:#8998ad;margin-top:5px}
    @media(max-width:900px){.k-nrange-trigger{right:60px;top:118px}.k-nrange-panel{top:158px}}
  `;
  root.appendChild(style);

  const trigger = document.createElement('button');
  trigger.className = 'k-nrange-trigger';
  trigger.type = 'button';
  trigger.textContent = '☢ ИСПЫТАТЕЛЬНЫЙ ПОЛИГОН';
  trigger.setAttribute('aria-expanded', 'false');
  root.appendChild(trigger);

  const panel = document.createElement('section');
  panel.className = 'k-nrange-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <button class="k-nrange-close" type="button" aria-label="Закрыть">×</button>
    <h3>Испытательный полигон</h3>
    <p>Отдельный игровой сценарий. Выберите город, устройство и звуковую дорожку.</p>
    <label for="k-nrange-city-query">Город — каталог God's Eye View / Natural Earth</label>
    <input id="k-nrange-city-query" type="search" placeholder="Например: Москва, Tokyo, Hanoi" autocomplete="off">
    <select id="k-nrange-city-results" size="5" aria-label="Результаты поиска города"></select>
    <div class="k-nrange-muted">В каталоге ${CITIES.length.toLocaleString('ru-RU')} городов и населённых пунктов. Поиск работает локально.</div>
    <label for="k-nrange-bomb">Модель испытания</label>
    <select id="k-nrange-bomb">${BOMBS.map((bomb) => `<option value="${bomb.id}">${bomb.name} · ${formatYield(bomb.yieldKt)} · ${bomb.year}</option>`).join('')}</select>
    <div class="k-nrange-status" data-bomb-info aria-live="polite"></div>
    <label for="k-nrange-sound">Звуковая дорожка — библиотека источника</label>
    <select id="k-nrange-sound">${NUCLEAR_AUDIO_SAMPLES.map((sample) => `<option value="${sample.id}">${sample.name}</option>`).join('')}</select>
    <div class="k-nrange-muted">20 пар исходных OGG: фронт взрыва и отложенный гул. Для исторических моделей по умолчанию выбрана наиболее близкая доступная запись.</div>
    <label class="k-nrange-check"><input type="checkbox" data-damage checked> Показывать разрушение города</label>
    <div class="k-nrange-status" data-status>Город не выбран. Можно также указать точку на глобусе.</div>
    <div class="k-nrange-actions">
      <button type="button" data-pick>Указать точку на карте</button>
      <button type="button" class="primary" data-test>Запустить испытание</button>
      <button type="button" data-reset>Сбросить разрушения</button>
      <button type="button" data-close>Закрыть полигон</button>
    </div>
    <div class="k-nrange-muted">Разрушения — процедурная игровая визуализация поверх карты. Исходные Google 3D Tiles не изменяются; состояние основной партии и сервера не затрагивается.</div>
  `;
  root.appendChild(panel);

  const status = panel.querySelector('[data-status]');
  const bombInfo = panel.querySelector('[data-bomb-info]');
  const bombSelect = panel.querySelector('#k-nrange-bomb');
  const soundSelect = panel.querySelector('#k-nrange-sound');
  const cityQuery = panel.querySelector('#k-nrange-city-query');
  const cityResults = panel.querySelector('#k-nrange-city-results');
  const damageToggle = panel.querySelector('[data-damage]');
  const testButton = panel.querySelector('[data-test]');
  const pickButton = panel.querySelector('[data-pick]');
  let target = null;
  let targetName = '';
  let selecting = false;
  let matches = [];

  const updateBombInfo = () => {
    const bomb = BOMBS.find((item) => item.id === bombSelect.value) ?? BOMBS[0];
    bombInfo.textContent = `${bomb.country} · ${bomb.year} · ${formatYield(bomb.yieldKt)} · ${bomb.kind}`;
    soundSelect.value = defaultNuclearSound(bomb.id);
  };
  bombSelect.addEventListener('change', updateBombInfo);
  updateBombInfo();

  const flyToCity = (city) => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(city[2], city[1], 135000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-48), roll: 0 },
      duration: 2.6,
    });
  };

  const updateCityResults = () => {
    const query = cityQuery.value.trim().toLocaleLowerCase();
    cityResults.replaceChildren();
    matches = [];
    if (query.length < 2) return;
    matches = CITIES
      .filter((city) => city[0].toLocaleLowerCase().includes(query))
      .sort((a, b) => {
        const ap = a[0].toLocaleLowerCase().startsWith(query) ? 1 : 0;
        const bp = b[0].toLocaleLowerCase().startsWith(query) ? 1 : 0;
        return bp - ap || b[4] - a[4] || a[3] - b[3] || a[0].localeCompare(b[0]);
      })
      .slice(0, 14);
    for (const [index, city] of matches.entries()) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${city[0]} · ${city[1].toFixed(3)}, ${city[2].toFixed(3)}`;
      cityResults.appendChild(option);
    }
  };
  cityQuery.addEventListener('input', updateCityResults);
  cityResults.addEventListener('change', () => {
    const city = matches[Number(cityResults.value)];
    if (!city) return;
    target = { lon: city[2], lat: city[1] };
    targetName = city[0];
    status.textContent = `Выбран город: ${city[0]} · ${city[1].toFixed(3)}°, ${city[2].toFixed(3)}°`;
    flyToCity(city);
  });
  cityResults.addEventListener('dblclick', () => cityResults.dispatchEvent(new Event('change')));

  const close = () => {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    selecting = false;
    pickButton.textContent = 'Указать точку на карте';
  };
  trigger.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    trigger.setAttribute('aria-expanded', String(!panel.hidden));
  });
  panel.querySelector('.k-nrange-close').addEventListener('click', close);
  panel.querySelector('[data-close]').addEventListener('click', close);

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
    targetName = 'Пользовательская точка';
    selecting = false;
    pickButton.textContent = 'Указать другую точку';
    status.textContent = `Точка испытания: ${point.lat.toFixed(3)}°, ${point.lon.toFixed(3)}°`;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  pickButton.addEventListener('click', () => {
    selecting = true;
    pickButton.textContent = 'Щёлкните по глобусу…';
    status.textContent = 'Выберите точку на поверхности глобуса';
  });

  testButton.addEventListener('click', async () => {
    if (!target) {
      status.textContent = 'Сначала выберите город в списке или укажите точку на глобусе.';
      return;
    }
    const bomb = BOMBS.find((item) => item.id === bombSelect.value) ?? BOMBS[0];
    testButton.disabled = true;
    status.textContent = `Запускаю ${bomb.name} над ${targetName}…`;
    try {
      const result = await layers.playNuclearTest(target, bomb.yieldKt / 1000, {
        bombId: bomb.id,
        soundId: soundSelect.value,
        cityName: targetName,
        damage: damageToggle.checked,
      });
      status.textContent = result?.ok
        ? `Испытание выполнено: ${bomb.name} · ${formatYield(bomb.yieldKt)} · ${targetName}${result.damage ? `. Игровая зона разрушений: ${result.damage.radiusKm.toFixed(1)} км, объектов: ${result.damage.buildingCount}.` : '. Без разрушений.'}`
        : 'Не удалось запустить визуализацию.';
    } catch (error) {
      status.textContent = `Ошибка испытания: ${String(error?.message || error)}`;
    } finally {
      testButton.disabled = false;
    }
  });

  panel.querySelector('[data-reset]').addEventListener('click', () => {
    layers.resetNuclearDamage();
    status.textContent = 'Все игровые разрушения и следы испытаний очищены.';
  });

  return {
    close,
    destroy() {
      handler.destroy();
      trigger.remove();
      panel.remove();
      style.remove();
    },
  };
}
