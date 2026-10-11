// «Купол» в настоящем браузере: dev-сервер без ключа Google, headless Chrome без внешней сети.
// Игра должна запуститься, показать холст Cesium и встроенный глобус Natural Earth, а затем
// пройти партию: выбор нации → тактический бой автобоем (сценарий battle) → конец хода.
// Идёт в CI (GITHUB_ACTIONS) или локально с KUPOL_BROWSER_SMOKE=1; без Chrome — пропуск.
// Ловит то, чего не видят юнит-тесты: например, падение boot.js на старте.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { findChrome, startDevServer, smokeKupol } from '../../scripts/kupol-browser-smoke.mjs';

const wanted = !!process.env.GITHUB_ACTIONS || process.env.KUPOL_BROWSER_SMOKE === '1';
const chrome = wanted ? findChrome() : null;
// в CI файл попадает и в `npm test`, и в `npm run test:game` — второй раз не гоняем
const once = process.env.GITHUB_RUN_ID ? `/tmp/kupol-browser-smoke-${process.env.GITHUB_RUN_ID}` : null;
const skip = !wanted ? 'только в CI или с KUPOL_BROWSER_SMOKE=1' : !chrome ? 'нет Chrome/Chromium' : once && existsSync(once) ? 'уже прошла в этом прогоне' : false;

test('браузер: /kupol без ключей и интернета — глобус, тактический бой, конец хода', { skip, timeout: 240000 }, async () => {
  if (once) writeFileSync(once, '1');
  const server = await startDevServer({ scenario: 'battle' });
  try {
    const report = await smokeKupol({ url: server.url, chrome, offline: true, game: true });
    assert.ok(report.ok, `${report.problems.join('; ')}\n${JSON.stringify(report, null, 2)}\n--- dev-сервер ---\n${server.log.slice(-1500)}`);
  } finally { server.stop(); }
});
