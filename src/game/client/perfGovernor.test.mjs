import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CLIMB_MS, DECIDE_MS, MAX_FRAME_MS, MIN_SAMPLES, RUNGS, TOP_RUNG, WINDOW,
  applyRung, attachPerfGovernor, decide, median,
} from './perfGovernor.js';
import { readSourceText } from '../../../scripts/readSourceText.mjs';

const governorSource = readSourceText(fileURLToPath(new URL('./perfGovernor.js', import.meta.url)));
const bootSource = readSourceText(fileURLToPath(new URL('./boot.js', import.meta.url)));

// Подделка часов и requestAnimationFrame: движок проверяется без браузера, но
// ровно тем же кодом, который работает в игре.
function fakeFrame({ ms, count = 60, busy = {}, hidden = false }) {
  const scene = { msaaSamples: 9, globe: { maximumScreenSpaceError: 9 }, skyAtmosphere: { show: 9 }, fog: { enabled: 9 } };
  scene.globe.showGroundAtmosphere = 9;
  const viewer = { resolutionScale: 9 };
  const classes = new Set();
  const root = { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } };
  const notices = [];
  let time = 1000;
  let pending = null;
  const governor = attachPerfGovernor({ scene, viewer, root }, {
    isBusy: () => busy.flag,
    isHidden: () => hidden,
    onNotice: (text) => notices.push(text),
    now: () => time,
    request: (cb) => { pending = cb; return 1; },
  });
  const pump = (n = count) => {
    for (let i = 0; i < n; i += 1) {
      time += ms;
      const cb = pending;
      pending = null;
      cb();
    }
  };
  return { governor, scene, viewer, root, classes, notices, pump, busy, advance: (d) => { time += d; } };
}

test('the top rung is the current default, so nothing is downgraded at start', () => {
  assert.equal(RUNGS[TOP_RUNG].msaa, 4);
  assert.equal(RUNGS[TOP_RUNG].scale, 1);
  assert.equal(RUNGS[TOP_RUNG].sse, 2);
  assert.equal(RUNGS[TOP_RUNG].sky, true);
  assert.equal(RUNGS[TOP_RUNG].fog, true);
  assert.equal(RUNGS[TOP_RUNG].blur, true);
  // Верхняя ступень обязана совпадать с тем, что пишет boot.js, иначе «полное
  // качество» в игре — это не то полное качество, которое рисовали и проверяли.
  assert.match(bootSource, /msaaSamples: 4,/);
});

test('rungs only get cheaper going down', () => {
  for (let r = TOP_RUNG; r > 0; r -= 1) {
    assert.ok(RUNGS[r - 1].scale <= RUNGS[r].scale, `ступень ${r - 1} не должна рисовать больше пикселей, чем ${r}`);
    assert.ok(RUNGS[r - 1].msaa <= RUNGS[r].msaa, `ступень ${r - 1} не должна брать больше MSAA, чем ${r}`);
    assert.ok(RUNGS[r - 1].sse >= RUNGS[r].sse, `ступень ${r - 1} не должна тянуть больше тайлов, чем ${r}`);
  }
});

test('median takes the middle, not the average, so one hitch cannot speak', () => {
  assert.equal(median([16, 16, 900, 16, 16]), 16);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), null);
});

test('the table moves down on a slow frame and up only after the cooldown', () => {
  assert.deepEqual(decide({ rung: 3, fps: 22, ready: true, at: 9e9, droppedAt: null }), { next: 2, down: true });
  assert.equal(decide({ rung: 3, fps: 45, ready: true, at: 9e9, droppedAt: null }), null, 'мёртвая зона не двигает качество');
  assert.equal(decide({ rung: 0, fps: 5, ready: true, at: 9e9, droppedAt: null }), null, 'ниже эконом ступени нет');
  assert.equal(decide({ rung: 3, fps: 120, ready: true, at: 9e9, droppedAt: null }), null, 'выше полном ступени нет');
  assert.equal(decide({ rung: 1, fps: 120, ready: true, at: 5e3, droppedAt: 0 }), null, 'сразу после понижения не поднимаемся');
  assert.deepEqual(decide({ rung: 1, fps: 120, ready: true, at: CLIMB_MS, droppedAt: 0 }), { next: 2, down: false });
  assert.equal(decide({ rung: 2, fps: 5, ready: false, at: 9e9, droppedAt: null }), null, 'не готового образца не хватает');
});

test('applyRung writes every knob it claims to move', () => {
  const scene = { msaaSamples: 4, globe: { maximumScreenSpaceError: 2, showGroundAtmosphere: true }, skyAtmosphere: { show: true }, fog: { enabled: true } };
  const viewer = { resolutionScale: 1 };
  const classes = new Set();
  const root = { classList: { toggle: (n, on) => (on ? classes.add(n) : classes.delete(n)) } };
  applyRung({ scene, viewer, root }, 0);
  assert.equal(scene.msaaSamples, 1);
  assert.equal(viewer.resolutionScale, 0.7);
  assert.equal(scene.globe.maximumScreenSpaceError, 3.5);
  assert.equal(scene.skyAtmosphere.show, false);
  assert.equal(scene.fog.enabled, false);
  assert.equal(scene.globe.showGroundAtmosphere, false);
  assert.ok(classes.has('k-perf-flat'), 'низкая ступень снимает размытие панелей');
  applyRung({ scene, viewer, root }, TOP_RUNG);
  assert.equal(viewer.resolutionScale, 1);
  assert.ok(!classes.has('k-perf-flat'), 'полная ступень возвращает размытие');
});

test('a slow player really loses a rung and says so once', () => {
  const rig = fakeFrame({ ms: 1000 / 12 });
  rig.pump();
  assert.equal(rig.governor.state().rung, TOP_RUNG - 1, '12 fps обязаны сдвинуть ступень');
  assert.equal(rig.scene.msaaSamples, 2);
  assert.equal(rig.notices.length, 1);
  assert.match(rig.notices[0], /высоко/);
});

test('a one-second frame player is not made to wait forty seconds', () => {
  // Кадр ~1,05 с — это замеренный в живом браузере медленный игрок. Решение
  // приходит, как только готов образец: по счёту и по сроку, но не по сорока
  // кадрам, которые на такой машине означали бы минуту ожидания.
  const rig = fakeFrame({ ms: 1050 });
  rig.pump(MIN_SAMPLES - 1);
  assert.equal(rig.governor.state().rung, TOP_RUNG, 'короткого счёта мало');
  rig.pump(1);
  assert.ok(rig.governor.state().rung < TOP_RUNG, `ступень упала на ${MIN_SAMPLES} кадре, а не на ${WINDOW}`);
});

test('a hitch longer than MAX_FRAME_MS is not a frame', () => {
  const rig = fakeFrame({ ms: MAX_FRAME_MS + 500 });
  rig.pump(60);
  assert.equal(rig.governor.state().rung, TOP_RUNG, 'кадры-паузы не имеют права трогать качество');
  assert.equal(rig.governor.state().frames, 0, 'окно заполняется только настоящими кадрами');
});

test('a hidden page is not a player at all', () => {
  // Фоновую вкладку браузер рисует раз в секунду; без этого окно наполнилось
  // бы «кадрами» человека, который на игру не смотрит.
  const rig = fakeFrame({ ms: 500, hidden: true });
  rig.pump(60);
  assert.equal(rig.governor.state().frames, 0, 'окно скрытой вкладки остаётся пустым');
  assert.equal(rig.governor.state().rung, TOP_RUNG);
  assert.equal(rig.notices.length, 0);
});

test('nothing moves before the sample is long enough in count and in time', () => {
  const rig = fakeFrame({ ms: 250 });
  rig.pump(8);
  assert.equal(rig.governor.state().rung, TOP_RUNG, 'пока образец короткий — решения запрещены');
  rig.pump(3);
  assert.equal(rig.governor.state().rung, TOP_RUNG, '11 кадров ещё не MIN_SAMPLES');
  rig.pump(1);
  assert.equal(rig.governor.state().rung, TOP_RUNG - 1, `12 кадров по ${DECIDE_MS / 12} мс закрыли и счёт, и срок`);
});

test('the showcase is untouchable, and one bad sample buys exactly one step', () => {
  const rig = fakeFrame({ ms: 150, busy: { flag: true } });
  rig.pump(30); // 30 × 150 мс: окно готово, но витрина открыта
  assert.equal(rig.governor.state().rung, TOP_RUNG, 'занятая сцена не имеет права терять качество');
  rig.busy.flag = false;
  rig.pump(1);
  assert.equal(rig.governor.state().rung, TOP_RUNG - 1, 'как только витрина закрылась, адаптив возвращается');
  // Шаг за шагом, а не каскадом: второму шагу нужен свой полный образец. Иначе
  // один плохой уронил бы качество до пола, не измерив ничего после первого
  // переключения.
  rig.pump(19);
  assert.equal(rig.governor.state().rung, TOP_RUNG - 1, 'неполный образец не имеет права на второй шаг');
  rig.pump(1);
  assert.equal(rig.governor.state().rung, TOP_RUNG - 2, 'полный новый образец двигает вторую ступень');
});

test('leaving the polygon restores full quality and a fresh sample', () => {
  const rig = fakeFrame({ ms: 100 });
  rig.pump(40);
  assert.ok(rig.governor.state().rung < TOP_RUNG);
  rig.governor.toFull();
  assert.equal(rig.governor.state().rung, TOP_RUNG);
  assert.equal(rig.viewer.resolutionScale, 1);
  assert.equal(rig.governor.state().frames, 0, 'после витрины окно начинается заново');
  assert.equal(rig.governor.state().fps, null, 'без образца частоты не существует');
  rig.busy.flag = true;
  rig.pump(20);
  assert.equal(rig.governor.state().frames, 20, 'счётчик кадров игрока снова наполнен');
  assert.ok(rig.governor.state().fps > 0);
  assert.equal(rig.governor.state().rung, TOP_RUNG, 'пока витрина открыта — решения запрещены');
});

test('the governor keeps its own ladder away from the blast ladder', () => {
  // Ступени объёмного взрыва выбираются по накопленной цене прохода в
  // nuclearVolumetrics.js; этот модуль их не переписывает и трогает только
  // настройки viewer.
  assert.doesNotMatch(governorSource, /nuclearVolumetrics|RUNGS\[\d\]\[1\]/);
});

test('the polygon tells the game when the showcase starts', () => {
  assert.match(bootSource, /isBusy: \(\) => rangeOpen \|\| layers\.nuclearLive\(\)/);
  assert.match(bootSource, /if \(open\) perf\.toFull\(\)/);
  assert.match(bootSource, /attachPerfGovernor/);
});
