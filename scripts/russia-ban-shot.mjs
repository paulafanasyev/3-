// Кадры запрета: список с перечёркнутыми российскими городами и тот же
// поиск по чужому городу — чтобы правило было видно глазами, а не только тестом.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const base = process.env.RUSSIA_BAN_BASE || 'http://127.0.0.1:4237';
const outDir = process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear';
let server = null;
const up = await fetch(`${base}/kupol`).then((r) => r.ok).catch(() => false);
if (!up) {
  server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '4191', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
}
let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: `${outDir}/chrome-ban-shot`,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/kupol`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForSelector('.k-nrange-trigger', { timeout: 90000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 40000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 40000 });
  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])');
  // Кадр всего полигона: подпись правила видна сразу под поиском.
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `${outDir}/ban-01-panel.png` });
  for (const [name, file] of [['Москва', 'ban-02-moscow.png'], ['Moscow', 'ban-03-moscow-lat.png'], ['Berlin', 'ban-04-berlin.png']]) {
    await page.$eval('#k-nrange-city-query', (el) => { el.value = ''; });
    await page.type('#k-nrange-city-query', name);
    await page.waitForFunction(() => document.querySelector('#k-nrange-city-results')?.options.length > 0, { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: `${outDir}/${file}` });
    console.log(`${file}: ${await page.$eval('#k-nrange-city-results', (s) => [...s.options].slice(0, 6).map((o) => `${o.textContent}${o.disabled ? ' [⛔]' : ''}`).join(' | '))}`);
  }
  // Отказ на глазах: строку выбираем в обход интерфейса.
  await page.$eval('#k-nrange-city-query', (el) => { el.value = ''; });
  await page.type('#k-nrange-city-query', 'Sochi');
  await page.waitForFunction(() => document.querySelector('#k-nrange-city-results')?.options.length > 0, { timeout: 20000 });
  await page.evaluate(() => {
    const select = document.querySelector('#k-nrange-city-results');
    const option = [...select.options].find((o) => o.disabled);
    option.selected = true;
    select.dispatchEvent(new Event('change'));
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${outDir}/ban-05-refusal.png` });
  console.log(`ban-05-refusal.png: ${await page.$eval('[data-status]', (el) => el.textContent)}`);
  console.log('SHOTS OK');
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
}
