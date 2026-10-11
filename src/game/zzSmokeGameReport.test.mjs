// Разово в CI (удаляется следующим коммитом): тот же прогон партии, что в browserSmoke, но
// отчёт целиком пушится в ветку ci/smoke-game — логи CI снаружи не видны.
import test from 'node:test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { startDevServer, smokeKupol } from '../../scripts/kupol-browser-smoke.mjs';

const FLAG = '/tmp/kupol-smoke-game-report.done';

test('CI: отчёт о партии в браузере', { skip: !process.env.GITHUB_ACTIONS, timeout: 300000 }, async () => {
  if (existsSync(FLAG)) return; writeFileSync(FLAG, '1');
  const out = '/tmp/kupol-smoke-game-out'; mkdirSync(out, { recursive: true });
  let report; let log = '';
  try {
    const server = await startDevServer({ scenario: 'battle' });
    try { report = await smokeKupol({ url: server.url, game: true, shot: `${out}/game.png` }); } finally { log = server.log; server.stop(); }
  } catch (e) { report = { error: String(e?.stack ?? e).slice(0, 2000) }; }
  writeFileSync(`${out}/report.json`, JSON.stringify({ ...report, devLog: log.slice(-3000) }, null, 2));
  const header = execSync('git config --get http.https://github.com/.extraheader || true').toString().trim();
  const remote = execSync('git remote get-url origin').toString().trim();
  const sh = (c) => execSync(c, { cwd: out, stdio: 'inherit' });
  sh('git init -q && git checkout -q -b ci/smoke-game && git add -A');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: отчёт о партии в браузере"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/smoke-game`, { cwd: out, stdio: 'inherit' });
});
