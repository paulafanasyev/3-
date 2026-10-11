// Разово в CI: выкладывает Kupol-win64.zip (из ветки ci/windows-build, проверка sha256)
// как пре-релиз «Купол 1.0.0-rc.1 для Windows». Никогда не роняет CI: отчёт — в ветку ci/win-release.
import test from 'node:test';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const FLAG = '/tmp/kupol-winrelease.done';
const ZIP_SHA = '6f19125578580aa42216a631724c07283a0f63bf401f4acb0753502a84d1d46a';
const REPO = 'paulafanasyev/3-';
const TAG = 'kupol-v1.0.0-rc.1-win';
const BODY = [
  '«Купол» 1.0.0-rc.1 — сборка для Windows (64 бит).',
  '',
  '**Как запустить**',
  '1. Скачайте `Kupol-win64.zip` ниже и распакуйте целиком в любую папку.',
  '2. Запустите `Kupol.exe` — игра откроется в браузере.',
  '3. Если Windows покажет «Система Windows защитила ваш компьютер», нажмите «Подробнее» → «Выполнить в любом случае»: файл не подписан сертификатом.',
  '4. Чтобы выйти, закройте чёрное окно сервера.',
  '',
  'Интернет и Node.js не нужны. Игра доступна только с этого компьютера (127.0.0.1).',
  'Это пре-релиз: проверен запуск того же запускателя под Linux, на Windows — ждём отзывов.',
  '',
  `SHA-256 архива: \`${ZIP_SHA}\``,
].join('\n');

test('CI: пре-релиз Kupol.exe', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG), timeout: 600000 }, async () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  const header = execSync('git config --get http.https://github.com/.extraheader || true', { cwd: root }).toString().trim();
  const report = { commit: process.env.GITHUB_SHA, at: new Date().toISOString(), ok: false, steps: [] };
  try {
    const basic = header.replace(/^AUTHORIZATION:\s*basic\s*/i, '');
    const token = Buffer.from(basic, 'base64').toString().split(':').pop();
    const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'kupol-ci' };
    const zipRes = await fetch(`https://raw.githubusercontent.com/${REPO}/ci/windows-build/Kupol-win64.zip`);
    const zip = Buffer.from(await zipRes.arrayBuffer());
    const sha = createHash('sha256').update(zip).digest('hex');
    report.steps.push(`архив ${zip.length} байт, sha ${sha}`);
    if (sha !== ZIP_SHA) throw new Error('sha256 архива не совпал');
    let rel = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, { headers: h });
    if (rel.status === 200) { rel = await rel.json(); report.steps.push('релиз уже был'); }
    else {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_name: TAG, target_commitish: process.env.GITHUB_SHA, name: '«Купол» 1.0.0-rc.1 для Windows', body: BODY, prerelease: true, draft: false }) });
      const txt = await r.text();
      report.steps.push(`создание релиза: ${r.status}`);
      if (r.status !== 201) throw new Error(`релиз не создан: ${txt.slice(0, 500)}`);
      rel = JSON.parse(txt);
    }
    report.release = rel.html_url;
    const has = (rel.assets ?? []).find((a) => a.name === 'Kupol-win64.zip');
    if (has) report.asset = has.browser_download_url;
    else {
      const up = await fetch(`https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=Kupol-win64.zip`, { method: 'POST',
        headers: { ...h, 'Content-Type': 'application/zip' }, body: zip });
      const txt = await up.text();
      report.steps.push(`загрузка архива: ${up.status}`);
      if (up.status !== 201) throw new Error(`архив не загружен: ${txt.slice(0, 500)}`);
      report.asset = JSON.parse(txt).browser_download_url;
    }
    report.ok = true;
  } catch (e) {
    report.error = String(e?.message ?? e).slice(0, 1500);
  }
  const pub = '/tmp/kupol-winrelease-out';
  mkdirSync(pub, { recursive: true });
  writeFileSync(`${pub}/report.json`, JSON.stringify(report, null, 2));
  const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
  const o = (c) => execSync(c, { cwd: pub, stdio: 'inherit' });
  o('git init -q && git checkout -q -b ci/win-release && git add -A');
  o('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: пре-релиз для Windows"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/win-release`, { cwd: pub, stdio: 'inherit' });
});
