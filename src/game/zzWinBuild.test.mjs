// Разово в CI: собирает «Купол» для Windows (scripts/build-kupol-windows.mjs --smoke),
// проверяет тот же запускатель под Linux и выкладывает Kupol-win64.zip в ветку ci/windows-build.
// Никогда не роняет CI: результат и лог — в report.json той же ветки.
import test from 'node:test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';

const FLAG = '/tmp/kupol-winbuild.done';

test('CI: сборка Kupol.exe', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG), timeout: 1500000 }, () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  const out = '/tmp/kupol-win';
  const pub = '/tmp/kupol-win-publish';
  mkdirSync(pub, { recursive: true });
  const result = { commit: process.env.GITHUB_SHA, at: new Date().toISOString(), ok: false };
  let log = '';
  try {
    log = execSync('node scripts/build-kupol-windows.mjs --smoke 2>&1', { cwd: root, env: { ...process.env, KUPOL_WIN_OUT: out }, maxBuffer: 256 * 1024 * 1024 }).toString();
    result.ok = true;
  } catch (e) {
    log = String(e.stdout ?? '') + String(e.stderr ?? '') + String(e.message ?? e);
  }
  result.log = log.slice(-12000);
  try { result.build = JSON.parse(readFileSync(`${out}/report.json`, 'utf8')); if (result.build.smoke) result.build.smoke.log = result.build.smoke.log.slice(-3000); } catch {}
  const zip = `${out}/Kupol-win64.zip`;
  if (existsSync(zip)) {
    result.zipBytes = statSync(zip).size;
    result.zipSha256 = execSync(`sha256sum "${zip}"`).toString().split(' ')[0];
    result.listing = execSync(`unzip -l "${zip}" | tail -n 25`).toString();
    if (result.zipBytes < 95 * 1048576) copyFileSync(zip, `${pub}/Kupol-win64.zip`);
    else result.note = 'архив больше 95 МБ — в git не кладу';
  }
  writeFileSync(`${pub}/report.json`, JSON.stringify(result, null, 2));
  const header = execSync('git config --get http.https://github.com/.extraheader || true', { cwd: root }).toString().trim();
  const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
  const o = (c) => execSync(c, { cwd: pub, stdio: 'inherit' });
  o('git init -q && git checkout -q -b ci/windows-build && git add -A');
  o('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: Купол для Windows"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/windows-build`, { cwd: pub, stdio: 'inherit' });
});
