// Живая проверка запрета в браузере: список городов, отказ при выборе,
// подпись в панели и работающий чужой город. Запускается из купол-verify.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const base = process.env.RUSSIA_BAN_BASE || `http://127.0.0.1:${Number(process.env.RUSSIA_BAN_PORT || 4189)}`;
const port = new URL(base).port || '80';
let serverOutput = '';
let server = null;
const alreadyUp = await fetch(`${base}/kupol`).then((r) => r.ok).catch(() => false);
if (!alreadyUp) {
  server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: port, HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (c) => { serverOutput += c.toString(); });
  server.stderr.on('data', (c) => { serverOutput += c.toString(); });
}

const checks = [];
function check(condition, message, detail = '') {
  checks.push({ ok: Boolean(condition), message, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${message}${detail ? ` — ${detail}` : ''}`);
  if (!condition) process.exitCode = 1;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok && (await fetch(`${base}/kupol`)).ok) return;
    } catch { /* сервер ещё стартует */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`превью не поднялось: ${serverOutput.slice(0, 400)}`);
}

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: `${process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear'}/chrome-ban`,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
      '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.k-nrange-trigger', { timeout: 90000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 40000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 40000 });
  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])');
  check(true, 'игра поднялась, полигон открыт');

  const note = await page.$eval('.k-nrange-panel', (el) => el.innerText);
  const toastBefore = await page.$eval('.k-nrange-toast', (el) => ({ hidden: el.hidden, text: el.textContent }));
  check(!/ядеркой не летают/.test(note) && toastBefore.hidden,
    'до нажатия кнопки правило молчит: в панели строки нет, пищалка скрыта', JSON.stringify(toastBefore));

  const readRows = async (query) => {
    await page.$eval('#k-nrange-city-query', (el) => { el.value = ''; });
    await page.type('#k-nrange-city-query', query);
    await page.waitForFunction((q) => {
      const s = document.querySelector('#k-nrange-city-results');
      return s && s.options.length > 0 && [...s.options].some((o) => o.textContent.toLowerCase().includes(q.toLowerCase()));
    }, { timeout: 20000 }, query);
    return page.$eval('#k-nrange-city-results', (select) => [...select.options].map((o) => ({
      text: o.textContent, disabled: o.disabled, value: o.value,
    })));
  };

  const rowNamed = (rows, name) => rows.find((r) => r.text.startsWith(`${name} ·`));
  for (const name of ['Moscow', 'Sevastopol', 'Kyzyl']) {
    const rows = await readRows(name);
    const row = rowNamed(rows, name);
    check(row && !row.disabled && !row.text.startsWith('⛔'), `${name} наводится как обычный город`, row ? JSON.stringify(row) : `нет строки, rows=${JSON.stringify(rows).slice(0, 200)}`);
  }
  for (const name of ['Tokyo', 'Hanoi']) {
    const rows = await readRows(name);
    const row = rowNamed(rows, name);
    check(row && !row.disabled && !row.text.startsWith('⛔'), `${name} доступен как был`, row ? JSON.stringify(row) : 'нет строки');
  }

  // Чужой город выбирается и наводится — запрет не должен задевать остальной мир.
  await readRows('Tokyo');
  await page.select('#k-nrange-city-results', (await readRows('Tokyo')).find((r) => r.text.startsWith('Tokyo ·')).value);
  const chosen = await page.$eval('[data-status]', (el) => el.textContent);
  check(/Выбран город: Tokyo/.test(chosen), 'чужой город выбирается и наводится', chosen);

  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'), { timeout: 120000 });
  check(true, 'испытание над чужим городом по-прежнему идёт до конца');

  const gate = await page.evaluate(async () => {
    const layers = window.__kupol.layers;
    const banned = await layers.playNuclearTest({ lat: 55.754, lon: 37.614 }, 50);
    const before = performance.now();
    const clean = await layers.playNuclearTest({ lat: 52.52, lon: 13.405 }, 0.021, { damage: false });
    return { banned, cleanMs: Math.round(performance.now() - before), cleanOk: Boolean(clean?.ok) };
  });
  check(gate.banned.ok === false && gate.banned.error === 'NUKE_BANNED_RUSSIA' && gate.banned.banned === 'Россия',
    'запрет держит и layers.playNuclearTest', JSON.stringify(gate.banned));
  check(gate.cleanOk, 'иностральная точка в том же вызове разрешена', `ok=${gate.cleanOk}, ${gate.cleanMs} мс`);

  // Наводка на Москву разрешена и сама по себе ничему не учит: правило
  // вспыхивает только по кнопке. Поэтому проверка идёт в два шага.
  await readRows('Moscow');
  await page.select('#k-nrange-city-results', (await readRows('Moscow')).find((r) => r.text.startsWith('Moscow ·')).value);
  const aimed = await page.evaluate(() => ({
    status: document.querySelector('[data-status]').textContent,
    toast: document.querySelector('.k-nrange-toast').hidden,
    shame: Boolean(document.querySelector('.k-shame')),
  }));
  check(/Выбран город: Moscow/.test(aimed.status) && aimed.toast && !aimed.shame,
    'выбор российской цели не поднимает ни отказа, ни позора', JSON.stringify(aimed));

  await page.click('[data-test]');
  await page.waitForSelector('.k-shame', { timeout: 20000 });
  const fired = await page.evaluate(() => ({
    toastHidden: document.querySelector('.k-nrange-toast').hidden,
    toast: document.querySelector('.k-nrange-toast').textContent,
    status: document.querySelector('[data-status]').textContent,
  }));
  check(!fired.toastHidden && /ядеркой не летают/.test(fired.toast) && /заперт до перезапуска/.test(fired.toast),
    'кнопка запуска по российской цели показывает пищалку', JSON.stringify(fired));
  check(/ядеркой не летают/.test(fired.status), 'тот же отказ читается в строке состояния', fired.status);
  check(true, 'тот же отказ поднимает экран позора');
  const locked = await page.evaluate(() => ({
    test: document.querySelector('[data-test]').disabled,
    pick: document.querySelector('[data-pick]').disabled,
    query: document.querySelector('#k-nrange-city-query').disabled,
  }));
  check(locked.test && locked.pick && locked.query, 'полигон заперт до перезапуска', JSON.stringify(locked));
  await page.click('[data-test]').catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const afterFire = await page.$eval('[data-status]', (el) => el.textContent);
  check(!/Испытание выполнено/.test(afterFire), 'на замке пуск не проходит', afterFire);

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await page.waitForSelector('.k-nrange-trigger', { timeout: 90000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 40000 }).catch(() => {});
  const restarted = await page.evaluate(() => ({
    shame: Boolean(document.querySelector('.k-shame')),
    testDisabled: document.querySelector('[data-test]')?.disabled ?? null,
  }));
  check(!restarted.shame && restarted.testDisabled === false, 'перезагрузка страницы снимает бан', JSON.stringify(restarted));

  check(pageErrors.length === 0, `нет непойманных ошибок страницы (${pageErrors.length})`, pageErrors.slice(0, 3).join(' | '));
  console.log(`ИТОГ: ${checks.filter((c) => c.ok).length}/${checks.length}`);
} catch (error) {
  console.error(`RUSSIA BAN SMOKE FAIL: ${error.stack || error}`);
  if (serverOutput) console.error(serverOutput.slice(0, 800));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
}
