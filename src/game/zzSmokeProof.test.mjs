// Разовая проверка в CI (удаляется следующим коммитом): доказать, что browserSmoke ловит падение.
// 1) где Chrome на раннере; 2) дымовая проверка на настоящем коде; 3) она же на копии,
// где boot.js снова сломан (старая ошибка viewer.screenSpaceCameraController). Отчёт — в ci/smoke-proof.
import test from 'node:test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';

const FLAG = '/tmp/kupol-smoke-proof.done';

test('CI: browserSmoke ловит сломанный boot.js', { skip: !process.env.GITHUB_ACTIONS, timeout: 400000 }, async () => {
  if (existsSync(FLAG)) return; writeFileSync(FLAG, '1');
  const report = { chrome: null, real: null, broken: null, brokenPatched: false };
  try {
    const real = await import(path.resolve('scripts/kupol-browser-smoke.mjs'));
    report.chrome = real.findChrome();
    const s1 = await real.startDevServer();
    try { report.real = await real.smokeKupol({ url: s1.url }); } finally { s1.stop(); }

    const wt = '/tmp/kupol-broken';
    execSync(`git worktree add -f --detach ${wt} HEAD`);
    symlinkSync(path.resolve('node_modules'), `${wt}/node_modules`);
    const boot = `${wt}/src/game/client/boot.js`;
    const src = readFileSync(boot, 'utf8');
    const bad = src.replace('viewer.scene.screenSpaceCameraController.enableCollisionDetection', 'viewer.screenSpaceCameraController.enableCollisionDetection');
    report.brokenPatched = bad !== src;
    writeFileSync(boot, bad);
    const broken = await import(`${wt}/scripts/kupol-browser-smoke.mjs`);
    const s2 = await broken.startDevServer();
    try { report.broken = await broken.smokeKupol({ url: s2.url }); } finally { s2.stop(); }
  } catch (e) { report.error = String(e?.stack ?? e).slice(0, 1500); }
  report.verdict = report.real?.ok === true && report.broken?.ok === false && report.brokenPatched
    ? 'проверка работает: настоящий код проходит, сломанный boot.js ловится' : 'НЕ доказано — смотри поля отчёта';
  const out = '/tmp/kupol-smoke-proof-out'; mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  const header = execSync('git config --get http.https://github.com/.extraheader || true').toString().trim();
  const remote = execSync('git remote get-url origin').toString().trim();
  const sh = (c) => execSync(c, { cwd: out, stdio: 'inherit' });
  sh('git init -q && git checkout -q -b ci/smoke-proof && git add -A');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: доказательство дымовой проверки"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/smoke-proof`, { cwd: out, stdio: 'inherit' });
});
