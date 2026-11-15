// Качество картинки подстраивается под тот компьютер, где игра реально идёт.
// Цифры с мастерской машины для этого не годятся: в headless-Chrome на
// SwiftShader счётчик кадров выдаёт 0,3 fps при CPU/кадр 10-20 мс, а парный
// прогон 15.11 (scripts/kupol-fps.mjs: база → рычаг → база-контроль) показал
// p50 3128 мс против 9,4 мс в той же сцене минуту спустя и 9 из 10 рычагов
// тонущими в этом дрейфе. Ограничитель там — часы браузера, а не сцена. Единственные
// часы, которым можно верить, стоят у игрока, поэтому частоту кадров считает
// этот модуль и по ней двигает ступени. Замерщики (kupol-fps.mjs,
// perf-governor-check.mjs, gpu-probe.mjs) лежат рядом в scripts/; снимки и профиль
// Chrome они пишут в KUPOL_QA_OUT — по умолчанию каталог вне репозитория, поэтому
// в git не попадают.
//
// Ступени идут от настроек, которые дёргаются на лету без пересборки viewer.
// Верхняя ступень совпадает с дефолтом boot.js (снято живьём: msaa 4, scale 1,
// sse 2, атмосфера и туман включены, blur панелей включён) — старт на полном
// качестве, вниз двигатель уходит сам.
export const RUNGS = [
  { name: 'эконом', msaa: 1, scale: 0.7, sse: 3.5, sky: false, fog: false, blur: false },
  { name: 'средне', msaa: 1, scale: 0.85, sse: 2.5, sky: true, fog: true, blur: false },
  { name: 'высоко', msaa: 2, scale: 1, sse: 2, sky: true, fog: true, blur: true },
  { name: 'полно', msaa: 4, scale: 1, sse: 2, sky: true, fog: true, blur: true },
];
export const TOP_RUNG = RUNGS.length - 1;
export const LOW_FPS = 30; // медиана кадра ниже — ступень вниз
export const HIGH_FPS = 55; // выше и держится — ступень вверх
export const WINDOW = 40; // потолок окна: дальше память и смысл не растут
export const MIN_SAMPLES = 12; // минимальный образец, ниже которого не решения
export const DECIDE_MS = 3000; // и он же обязан покрыть временем, а не только счётом
export const WARMUP_MS = 2500; // старт и догрузка тайлов показателем не считаются
export const CLIMB_MS = 8000; // после понижения не поднимаемся раньше срока
// Кадр длиннее трёх секунд — это не слабая видеокарта, это стоп загрузчика или
// вкладка, которой никто не рисует. Такой выбор выбрасывается: иначе одна пауза
// уронила бы качество до «эконом» без всякого основания.
//
// Потолок именно три секунды, а не одна: замер в живом браузере 15.11
// (scripts/perf-governor-check.mjs, SwiftShader, 560x315) дал ~1,05 с на кадр,
// т.е. с порогом в 1000 мс окно не наполнялось никогда и адаптив молчал ровно
// на том игроке, для которого он и написан.
export const MAX_FRAME_MS = 3000;

export function median(samples) {
  if (!samples.length) return null;
  const sorted = samples.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Куда двигать ступень. Решение должно быть дороже колебаний: один выбор медианы
 * не имеет права переключать качество, поэтому нужен полный окно-образец.
 */
export function decide({ rung, fps, ready, at = 0, droppedAt = null }) {
  if (!ready || !(fps > 0)) return null;
  if (fps < LOW_FPS && rung > 0) return { next: rung - 1, down: true };
  const cooled = droppedAt === null || at - droppedAt >= CLIMB_MS;
  if (fps > HIGH_FPS && rung < TOP_RUNG && cooled) return { next: rung + 1, down: false };
  return null;
}

/**
 * Переставляет ступень качества на viewer. Отдельно от движка потому, что тесты
 * проверяют таблицу решений без Cesium, а живой браузер — что настройки дёрнулись.
 */
export function applyRung(target, rung, { blurClass = 'k-perf-flat' } = {}) {
  const r = RUNGS[rung];
  const { scene, viewer, root } = target;
  scene.msaaSamples = r.msaa;
  viewer.resolutionScale = r.scale;
  scene.globe.maximumScreenSpaceError = r.sse;
  scene.skyAtmosphere.show = r.sky;
  scene.fog.enabled = r.fog;
  scene.globe.showGroundAtmosphere = r.fog;
  // Размытие панелей — это композитинг поверх каждого кадра: на слабой карте
  // стоит дороже половины сцены. Отключается классом, чтобы не трогать стили.
  if (root?.classList) root.classList.toggle(blurClass, !r.blur);
  return r;
}

/**
 * Счётчик кадров игрока и переключатель качества.
 * @param {{viewer: object, scene: object, root?: object}} target
 * @param {{isBusy?: () => boolean, onNotice?: (text: string) => void,
 *   now?: () => number, request?: (cb: () => void) => number}} hooks
 */
export function attachPerfGovernor(target, {
  isBusy = () => false, isHidden = () => (typeof document !== 'undefined' && document.hidden),
  onNotice = () => {}, now = () => performance.now(),
  request = (cb) => requestAnimationFrame(cb), blurClass = 'k-perf-flat',
} = {}) {
  let rung = TOP_RUNG;
  let droppedAt = null;
  let startedAt = now();
  const samples = []; // { at, dt } — возраст окна считается по первому элементу
  let last = startedAt;
  let stopped = false;
  let notices = 0;

  const dts = () => samples.map((s) => s.dt);
  // Образец готов, когда его хватает и счётом, и временем. Только счёт дал бы
  // 40-секундное ожидание решения на машине, которая рисует кадр секунду: ровно
  // там, где помощь нужна вчера.
  const ready = (at) => samples.length >= MIN_SAMPLES
    && at - (samples[0].at - samples[0].dt) >= DECIDE_MS;

  const state = () => ({
    rung, name: RUNGS[rung].name, scale: RUNGS[rung].scale, msaa: RUNGS[rung].msaa,
    frames: samples.length,
    fps: samples.length >= MIN_SAMPLES ? Math.round(1000 / median(dts())) : null,
  });

  const tick = () => {
    if (stopped) return;
    const at = now();
    const dt = at - last;
    last = at;
    // Скрытая вкладка — не игрок: браузер рисует её раз в секунду, и по таким
    // «кадрам» качество уехало бы в пол без всякой вины видеокарты.
    if (isHidden()) {
      samples.length = 0;
      request(tick);
      return;
    }
    if (dt > 0 && dt <= MAX_FRAME_MS) samples.push({ at, dt });
    if (samples.length > WINDOW) samples.shift();
    // Витрина не трогается: открытый полигон и живой гриб — тот самый кадр,
    // который игрок разглядывает. Понизить качество ровно на нём означало бы
    // измерить красоту по замерщику.
    if (!isBusy() && at - startedAt > WARMUP_MS && ready(at)) {
      const move = decide({ rung, fps: 1000 / median(dts()), ready: true, at, droppedAt });
      if (move) {
        applyRung(target, move.next, { blurClass });
        if (move.down) {
          droppedAt = at;
          // Одно сообщение на понижение, а не на каждый кадр: игрок должен
          // понять, что произошло, а не читать бегущую строку.
          if (notices < 2) {
            notices += 1;
            onNotice(`Качество: ${RUNGS[move.next].name} (кадр ${Math.round(1000 / median(dts()))} fps)`);
          }
        }
        rung = move.next;
        // Окно обнуляется: шагу нужна своя выборка медианы. Без этого один
        // плохой образец уронил бы ступень до пола за те же пять секунд, не
        // измерив ничего после первого переключения (ловит тест на витрине).
        samples.length = 0;
      }
    }
    request(tick);
  };
  request(tick);

  return {
    state,
    /** Полное качество по требованию: так входит полигон. */
    toFull() {
      applyRung(target, TOP_RUNG, { blurClass });
      rung = TOP_RUNG;
      // После витрины отсчёт начинается заново: иначе первые же тяжёлые кадры
      // полёта уронят ступень без разбора.
      startedAt = now();
      samples.length = 0;
      last = startedAt;
    },
    destroy() { stopped = true; },
  };
}
