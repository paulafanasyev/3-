// Зум и полёт камеры вокруг испытания. Числа проверяем напрямую, а вшивку в
// интерфейс — по исходникам: без браузера видно только, что рычаг на месте.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUTTON_FACTOR, MAX_RANGE, MIN_RANGE, nextRange, wheelFactor } from './cameraZoom.js';
import { readSourceText } from '../../../scripts/readSourceText.mjs';

const read = (relative) => readSourceText(new URL(relative, import.meta.url));
const zoomSource = read('./cameraZoom.js');
const bootSource = read('./boot.js');
const hudSource = read('./hud.js');
const hudCss = read('./hud.css');
const rangeSource = read('./nuclear-range.js');
// запреты ниже ищут именно код: в комментариях имена Cesium поминаются вслух,
// и проверка по всему файлу спотыкалась бы о собственное объяснение
const zoomCode = zoomSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('one wheel notch is a real step, and the sign puts you closer', () => {
  const up = wheelFactor({ deltaY: -100 });
  assert.ok(up > 1.3 && up < 1.6, `notch should close in by ~40%, got x${up.toFixed(3)}`);
  assert.equal(wheelFactor({ deltaY: 100 }), 1 / up);
  assert.equal(wheelFactor({ deltaY: 0 }), 1);
  assert.equal(wheelFactor({}), 1);
  // строки Firefox и страницы скролла стоят дороже пикселей за то же событие
  assert.ok(wheelFactor({ deltaY: -100, deltaMode: 1 }) > up);
  assert.ok(wheelFactor({ deltaY: -100, deltaMode: 2 }) > wheelFactor({ deltaY: -100, deltaMode: 1 }));
});

test('the range is clamped to a metre below and the whole disc above', () => {
  assert.equal(MIN_RANGE, 1);
  assert.ok(MAX_RANGE >= 4e7, 'must clear the full Earth disc');
  assert.equal(nextRange({ range: 1000, factor: 2 }), 500);
  assert.equal(nextRange({ range: 2, factor: 1e6 }), MIN_RANGE);
  assert.equal(nextRange({ range: 1e6, factor: 1e-6 }), MAX_RANGE);
  assert.ok(Number.isNaN(nextRange({ range: Number.NaN, factor: 2 })), 'garbage in must not become a move');
});

test('the buttons take exactly the step the wheel takes', () => {
  assert.equal(nextRange({ range: 1_000_000, factor: BUTTON_FACTOR }), 1_000_000 / BUTTON_FACTOR);
  assert.match(zoomSource, /zoomIn: \(\) => zoomBy\(BUTTON_FACTOR\)/);
  assert.match(zoomSource, /zoomOut: \(\) => zoomBy\(1 \/ BUTTON_FACTOR\)/);
  assert.match(hudSource, /data-act="zoomIn"/);
  assert.match(hudSource, /data-act="zoomOut"/);
  assert.match(bootSource, /zoomIn: \(\) => zoom\.zoomIn\(\)/);
  assert.match(bootSource, /zoomOut: \(\) => zoom\.zoomOut\(\)/);
});

test('the wheel is taken over before Cesium sees it, not by editing its event list', () => {
  // zoomEventTypes живёт на внутреннем перечислении движений (0…4), которого
  // нет в публичном API: подставь туда ScreenSpaceEventType — и получишь
  // undefined вместо типа, а через кадр — остановленный рендер
  assert.doesNotMatch(zoomCode, /controller\.zoomEventTypes\s*=/, 'must not write Cesium internal event list');
  assert.doesNotMatch(zoomCode, /ScreenSpaceEventType\.(RIGHT_DRAG|PINCH)\b/, 'no invented enum members');
  assert.match(zoomCode, /window\.addEventListener\('wheel', onWheel, \{ capture: true, passive: false \}\)/);
  assert.match(zoomCode, /event\.stopPropagation\(\)/);
  assert.match(zoomCode, /if \(event\.target !== scene\.canvas\) return;/);
  assert.match(zoomCode, /controller\.minimumZoomDistance = MIN_RANGE/);
  assert.match(zoomCode, /controller\.maximumZoomDistance = MAX_RANGE/);
});

test('the zoom move stays bound to the camera', () => {
  // тернарник вида (? camera.zoomIn : camera.zoomOut)(x) отрывает метод от
  // камеры, и на первом же щелчке падает внутри Cesium
  assert.doesNotMatch(zoomSource, /\?\s*camera\.zoomIn\s*:/);
  assert.match(zoomSource, /camera\.zoomIn\(delta\)/);
  assert.match(zoomSource, /camera\.zoomOut\(-delta\)/);
});

test('any manual input takes the camera away from the auto-framed shot', () => {
  // и колесо, и касание: игрок должен успеть улететь из кадра до того, как
  // долетит сама авто-наводка испытания
  assert.equal(zoomSource.match(/viewer\.camera\.cancelFlight\(\)/g).length, 2);
  assert.match(zoomSource, /addEventListener\('pointerdown', onPointerDown\)/);
});

test('the panel hands the keyboard back to the flight', () => {
  // выбор города и пуск испытания — те два момента, после которых игрок жмёт W
  assert.match(rangeSource, /const releaseKeys = \(\) => document\.activeElement\?\.blur\?\.\(\)/);
  assert.equal(rangeSource.match(/releaseKeys\(\)/g).length, 2);
});

test('the polygon hides the party interface and gives it back', () => {
  assert.match(rangeSource, /root\.classList\.toggle\('k-cinema', open\)/);
  assert.match(rangeSource, /const close = \(\) => setOpen\(false\)/);
  assert.match(rangeSource, /root\.classList\.remove\('k-cinema'\)/);
  const cinema = hudCss.match(/#kupol-root\.k-cinema[^{]*\{[^}]*visibility: hidden/);
  assert.ok(cinema, 'cinema rule missing from hud.css');
  for (const menu of ['k-top', 'k-left', 'k-right', 'k-chron', 'k-end', 'k-hint', 'k-live']) {
    assert.match(cinema[0], new RegExp(`\\.${menu}\\b`), `${menu} must disappear during the test`);
  }
  assert.doesNotMatch(cinema[0], /\.k-zoom\b/, 'the zoom pad must survive cinema');
  assert.match(hudCss, /\.k-zoom \{[^}]*position: absolute/);
});
