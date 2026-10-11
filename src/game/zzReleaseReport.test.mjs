// Разово в CI (удаляется следующим коммитом): приёмка 1.0.0-rc.1 целиком — партия в браузере
// (с перезагрузкой посреди боя), production-сборка с postbuild-проверкой и smoke сервера.
// Отчёт пушится в ветку ci/release-check: логи CI снаружи не видны.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { startDevServer, smokeKupol } from '../../scripts/kupol-browser-smoke.mjs';

const FLAG = '/tmp/kupol-release-report.done';
const cleanEnv = (extra = {}) => { const env = { ...process.env, ...extra }; delete env.NODE_TEST_CONTEXT; return env; };

test('CI: приёмка релиза «Купола»', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG), timeout: 1500000 }, async () => {
  writeFileSync(FLAG, '1');
  const out = '/tmp/kupol-release-out'; mkdirSync(out, { recursive: true });
  const report = { at: new Date().toISOString(), commit: process.env.GITHUB_SHA };
  let devLog = '';
  try {
    const server = await startDevServer({ scenario: 'battle' });
    try { report.browser = await smokeKupol({ url: server.url, game: true, shot: `${out}/game.png` }); } finally { devLog = server.log; server.stop(); }
  } catch (e) { report.browser = { ok: false, error: String(e?.stack ?? e).slice(0, 2000) }; }
  const run = (name, cmd, args, env) => {
    const r = spawnSync(cmd, args, { env: cleanEnv(env), encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
    const tail = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    writeFileSync(`${out}/${name}.log`, tail.slice(-60000));
    report[name] = { status: r.status, signal: r.signal, tail: tail.slice(-2500) };
    return r.status === 0;
  };
  if (run('build', 'npm', ['run', 'build'], { GEV_API_PROXIES: '0' })) run('smoke', 'npm', ['run', 'smoke'], { GEV_API_PROXIES: '0' });
  report.ok = !!report.browser?.ok && report.build?.status === 0 && report.smoke?.status === 0;
  writeFileSync(`${out}/report.json`, JSON.stringify({ ...report, devLog: devLog.slice(-3000) }, null, 2));
  const header = execSync('git config --get http.https://github.com/.extraheader || true').toString().trim();
  const remote = execSync('git remote get-url origin').toString().trim();
  const sh = (c) => execSync(c, { cwd: out, stdio: 'inherit' });
  sh('git init -q && git checkout -q -b ci/release-check && git add -A');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: приёмка релиза"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/release-check`, { cwd: out, stdio: 'inherit' });
  assert.ok(report.ok, JSON.stringify({ browser: report.browser?.problems ?? report.browser?.error, build: report.build?.status, smoke: report.smoke?.status }));
});
