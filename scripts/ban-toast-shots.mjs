// Кадры нового правила: до нажатия кнопки о запрете на экране нет ничего,
// после нажатия по российскому городу пищалка выскакивает. Видимость доказывается
// пикселями — тот же клип с пищалкой и без неё: слово «hidden» в DOM и высокий
// z-index ещё не значит, что игрок видит строку, а elementFromPoint слепит
// pointer-events:none.
import puppeteer from 'puppeteer';

const base = process.env.BAN_TOAST_BASE || 'http://127.0.0.1:4237';
const outDir = process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear';
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const shots = [];
const pixels = { clip: null, differs: false };
const read = () => ({
  toastHidden: document.querySelector('.k-nrange-toast')?.hidden ?? null,
  toastText: document.querySelector('.k-nrange-toast')?.textContent ?? null,
  rect: (() => {
    const el = document.querySelector('.k-nrange-toast');
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width),
      display: getComputedStyle(el).display, zIndex: getComputedStyle(el).zIndex,
    };
  })(),
  shame: Boolean(document.querySelector('.k-shame')),
  status: document.querySelector('[data-status]')?.textContent ?? null,
  panelBanText: /запрещ|ядеркой не летают|⛔/.test(document.querySelector('.k-nrange-panel')?.textContent ?? ''),
});

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: chrome,
  userDataDir: `${outDir}/chrome-ban-toast`,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/kupol`, { waitUntil: 'networkidle2', timeout: 120000 }).catch(() => {});
  await page.waitForSelector('.k-nrange-trigger', { timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 60000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 60000 });
  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])');
  await new Promise((r) => setTimeout(r, 4000));

  // 1) Наводка на Москву есть, слова о запрете — нет.
  await page.type('#k-nrange-city-query', 'Москва');
  await page.waitForFunction(() => document.querySelector('#k-nrange-city-results')?.options.length > 0, { timeout: 30000 });
  await page.evaluate(() => {
    const select = document.querySelector('#k-nrange-city-results');
    select.selectedIndex = 0;
    select.dispatchEvent(new Event('change'));
  });
  await new Promise((r) => setTimeout(r, 3500));
  const aimed = await page.evaluate(read);
  await page.screenshot({ path: `${outDir}/ban-toast-01-aimed.png` });
  shots.push(['ban-toast-01-aimed.png', aimed]);

  // 2) Нажатие «Запустить испытание»: пищалка должна быть видна глазами.
  // elementFromPoint тут слепой: у пищалки pointer-events:none, и удар в её
  // центр всегда отдаёт то, что под ней. Поэтому проверка пиксельная — тот же
  // клип дважды, с пищалкой и без неё: совпали байты — игрок ничего не видит,
  // каким бы высоким ни был z-index.
  await page.click('[data-test]');
  await new Promise((r) => setTimeout(r, 1500));
  const fired = await page.evaluate(read);
  shots.push(['ban-toast-02-refusal.png', fired]);
  // Пищалка гаснет сама через 9 s, а кадр SwiftShader закрывается дольше: на
  // время съёмки авто-скрытие обнуляем у самого элемента. Это костыль замерщика,
  // в игре таймер работает как описано в nuclear-range.js.
  await page.evaluate(() => {
    const el = document.querySelector('.k-nrange-toast');
    Object.defineProperty(el, 'hidden', { get: () => false, set: () => {}, configurable: true });
  });
  const clip = await page.evaluate(() => {
    const el = document.querySelector('.k-nrange-toast');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  });
  const shown = await page.screenshot({ clip });
  await page.evaluate(() => { document.querySelector('.k-nrange-toast').style.visibility = 'hidden'; });
  const bare = await page.screenshot({ clip });
  await page.evaluate(() => { document.querySelector('.k-nrange-toast').style.visibility = ''; });
  pixels.clip = clip;
  pixels.differs = Buffer.compare(shown, bare) !== 0;
  pixels.bytes = shown.length;
  await page.screenshot({ path: `${outDir}/ban-toast-02-refusal.png` });

  for (const [file, state] of shots) console.log(`${file}: ${JSON.stringify(state)}`);
  console.log(`ПИКСЕЛИ: ${JSON.stringify(pixels)}`);
  const ok = !aimed.panelBanText && aimed.toastHidden && !aimed.shame
    && !fired.toastHidden && /ядеркой не летают/.test(fired.toastText || '') && fired.shame
    && pixels.clip && pixels.clip.width > 100 && pixels.differs;
  console.log(ok ? 'КАДРЫ OK' : 'КАДРЫ НЕ ПОДТВЕРЖДЕНЫ');
} finally {
  await browser.close();
}
