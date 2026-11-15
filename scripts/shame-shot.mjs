// Живая проверка экрана позора: отказ по запрещённому городу поднимает герб на
// весь экран, включает гимн и запирает полигон; перезагрузка страницы снимает замок.
// Замеряем, а не верим на слово: currentTime/duration аудио, naturalWidth герба,
// disabled у кнопок и текст накладного окна целиком.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const base = process.env.RUSSIA_BAN_BASE || 'http://127.0.0.1:4237';
const outDir = process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear';
let server = null;
const up = await fetch(`${base}/kupol`).then((r) => r.ok).catch(() => false);
let serverOutput = '';
if (!up) {
  server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: new URL(base).port, HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (c) => { serverOutput += c.toString(); });
  server.stderr.on('data', (c) => { serverOutput += c.toString(); });
  // свой сервер поднимается не мгновенно: без ожидания страница стартует в пустоту
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const ready = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)
      && await fetch(`${base}/kupol`).then((r) => r.ok).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
}
let browser;
const fails = [];
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) fails.push(label);
};

try {
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: `${outDir}/chrome-shame-shot`,
    // Кадр снимается поверх живого глобуса на swiftshader: 30 с по умолчанию не хватает.
    protocolTimeout: 240000,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  // Собираем все Audio-объекты страницы: без этого гимн не измерить — он не в DOM.
  await page.evaluateOnNewDocument(() => {
    window.__audios = [];
    const Native = window.Audio;
    window.Audio = function (...args) { const el = new Native(...args); window.__audios.push(el); return el; };
    window.Audio.prototype = Native.prototype;
  });
  const requests = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/audio/state/') || url.includes('/game/state/')) requests.push(`${url.split('/').slice(-1)[0]}:${response.status()}`);
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${base}/kupol`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForSelector('.k-nrange-trigger', { timeout: 90000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 40000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 40000 });
  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])');
  check(await page.$eval('[data-test]', (el) => !el.disabled), 'полигон открыт и кнопка пуска активна');

  await page.type('#k-nrange-city-query', 'Sochi');
  await page.waitForFunction(() => document.querySelector('#k-nrange-city-results')?.options.length > 0, { timeout: 20000 });
  await page.evaluate(() => {
    const select = document.querySelector('#k-nrange-city-results');
    const option = [...select.options].find((o) => o.disabled);
    option.selected = true;
    select.dispatchEvent(new Event('change'));
  });

  await page.waitForSelector('.k-shame', { timeout: 20000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('.k-shame-emblem');
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 30000 });
  const overlay = await page.$eval('.k-shame', (el) => ({
    text: el.innerText.replace(/\s+/g, ' ').trim(),
    w: el.getBoundingClientRect().width,
    h: el.getBoundingClientRect().height,
    role: el.getAttribute('role'),
  }));
  const emblem = await page.$eval('.k-shame-emblem', (el) => ({ natural: el.naturalWidth, shown: Math.round(el.getBoundingClientRect().width) }));
  await page.screenshot({ path: `${outDir}/shame-01-overlay.png` });

  check(overlay.w >= 1400 && overlay.h >= 880, 'герб перекрывает весь экран', `${Math.round(overlay.w)}×${Math.round(overlay.h)}`);
  check(emblem.natural >= 400 && emblem.shown >= 200, 'векторный герб отрисован', `naturalWidth=${emblem.natural}, на экране ${emblem.shown} px`);
  check(/ПОГАНЫЙ ПРЕДАТЕЛЬ/i.test(overlay.text), 'экран называет игрока поганым предателем');
  check(/переданы|правоохран|\bIP\b/i.test(overlay.text) === false, 'ни слова о передаче IP или MAC в полицию', overlay.text.slice(0, 40));
  await new Promise((r) => setTimeout(r, 3500));
  const audio = await page.evaluate(() => window.__audios.map((el) => ({
    src: el.currentSrc.split('/').pop(), paused: el.paused, t: Math.round(el.currentTime * 10) / 10,
    d: Number.isFinite(el.duration) ? Math.round(el.duration) : null,
    buffered: el.buffered.length ? Math.round(el.buffered.end(el.buffered.length - 1)) : null,
    err: el.error?.name ?? null,
  })));
  const anthem = audio.find((a) => a.src.startsWith('anthem-russia'));
  check(Boolean(anthem) && !anthem.paused && anthem.t > 0.5, 'гимн играет', JSON.stringify(anthem));
  check(Boolean(anthem) && (anthem.d ?? anthem.buffered) > 60, 'длительность гимна измерена браузером', JSON.stringify({ d: anthem?.d, buffered: anthem?.buffered }));
  check(requests.some((r) => /^emblem-russia\.svg:(200|206)$/.test(r)), 'герб отдан без 404', requests.join(' '));
  check(requests.some((r) => /^anthem-russia-instrumental\.ogg:(200|206)$/.test(r)), 'гимн отдан без 404 (200 или диапазон)', requests.join(' '));
  // Range — то, за счёт чего браузер знает настоящую длину гимна, а не наугад.
  const rangeProbe = await page.evaluate(async () => {
    const r = await fetch('/audio/state/anthem-russia-instrumental.ogg', { headers: { Range: 'bytes=900000-' } });
    const body = await r.arrayBuffer();
    return { status: r.status, cr: r.headers.get('content-range'), bytes: body.byteLength, accept: r.headers.get('accept-ranges') };
  });
  check(rangeProbe.status === 206 && rangeProbe.bytes === 970341 - 900000 && /^bytes 900000-970340\/970341$/.test(rangeProbe.cr ?? ''),
    'отдаёт диапазон байтов', JSON.stringify(rangeProbe));

  check(await page.$eval('[data-test]', (el) => el.disabled), 'кнопка пуска заперта');
  check(await page.$eval('[data-pick]', (el) => el.disabled), 'выбор точки заперт');
  const status = await page.$eval('[data-status]', (el) => el.textContent);
  check(/ядеркой не летают/.test(status), 'полигон помнит, за что именно запрет', status);

  // Кнопка «Выключить гимн» обязана глушить звук, иначе экран нельзя пережить.
  await page.click('.k-shame [data-sound]');
  await new Promise((r) => setTimeout(r, 600));
  const muted = await page.evaluate(() => window.__audios.filter((el) => el.currentSrc.includes('anthem')).map((el) => el.paused));
  check(muted.every((p) => p === true), 'кнопка глушит гимн', JSON.stringify(muted));

  // Бан держится до перезагрузки: после reload окна нет, кнопки живые.
  await page.reload({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForSelector('.k-nrange-trigger', { timeout: 90000 });
  const stillShamed = await page.$('.k-shame');
  if (stillShamed) {
    await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 40000 }).catch(() => {});
    check(false, 'позор пережил перезагрузку страницы');
  } else {
    check(true, 'перезагрузка страницы снимает бан');
  }
  check(await page.$eval('[data-test]', (el) => !el.disabled), 'после перезапуска полигон снова стреляет');
  await page.screenshot({ path: `${outDir}/shame-02-after-reload.png` });
  check(pageErrors.length === 0, 'в браузере нет непойманных ошибок', pageErrors.slice(0, 3).join(' | '));
  console.log(`SHOTS: ${outDir}/shame-01-overlay.png, ${outDir}/shame-02-after-reload.png`);
  console.log(`TEXT: ${overlay.text}`);
  console.log(fails.length === 0 ? 'SHAME SHOTS PASS' : `SHAME SHOTS FAIL: ${fails.join('; ')}`);
  if (fails.length) process.exitCode = 1;
} catch (error) {
  console.error(`SHAME SHOTS FAIL: ${error.stack || error}`);
  if (serverOutput) console.error(serverOutput.slice(0, 600));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
}
