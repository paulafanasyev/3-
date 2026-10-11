// Разово в CI: пересборка Kupol.exe с исправленным окном боя и пре-релиз «Купол» 1.0.0-rc.2 для Windows.
// Старый пре-релиз rc.1 не удаляется: в его описание добавляется пометка, что он устарел.
// Никогда не роняет CI: отчёт — в ветку ci/win-release.
import test from 'node:test';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FLAG = '/tmp/kupol-winrc2.done';
const REPO = 'paulafanasyev/3-';
const TAG = 'kupol-v1.0.0-rc.2-win';
const OLD_TAG = 'kupol-v1.0.0-rc.1-win';

test('CI: пре-релиз Kupol.exe rc.2', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG), timeout: 1500000 }, async () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  const header = execSync('git config --get http.https://github.com/.extraheader || true', { cwd: root }).toString().trim();
  const report = { commit: process.env.GITHUB_SHA, at: new Date().toISOString(), ok: false, steps: [] };
  const out = '/tmp/kupol-win-rc2';
  try {
    const log = execSync('node scripts/build-kupol-windows.mjs --smoke 2>&1', { cwd: root, env: { ...process.env, KUPOL_WIN_OUT: out }, maxBuffer: 256 * 1024 * 1024 }).toString();
    report.buildTail = log.slice(-1500);
    const build = JSON.parse(readFileSync(`${out}/report.json`, 'utf8'));
    report.smoke = { ok: build.smoke?.ok, turn: build.smoke?.turn };
    if (!build.smoke?.ok) throw new Error('Linux-проверка запускателя не прошла');
    const zip = readFileSync(`${out}/Kupol-win64.zip`);
    const sha = createHash('sha256').update(zip).digest('hex');
    report.zip = { bytes: zip.length, sha };
    const css = execSync(`unzip -p "${out}/Kupol-win64.zip" 'Kupol/resources/app/dist/assets/*.css' | grep -c ':not(.kb-root)' || true`).toString().trim();
    report.steps.push(`css с .kb-root в исключениях: ${css}`);
    const basic = header.replace(/^AUTHORIZATION:\s*basic\s*/i, '');
    const token = Buffer.from(basic, 'base64').toString().split(':').pop();
    const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'kupol-ci' };
    const body = [
      '«Купол» 1.0.0-rc.2 — сборка для Windows (64 бит).',
      '',
      '**Что нового по сравнению с rc.1:** окно тактического боя снова видно (раньше бой шёл «вслепую», под картой); работает «Расторгнуть договор»; в подсказках договоров указана цена.',
      '',
      '**Как запустить**',
      '1. Скачайте `Kupol-win64.zip` ниже и распакуйте целиком в любую папку.',
      '2. Запустите `Kupol.exe` — игра откроется в браузере.',
      '3. Если Windows покажет «Система Windows защитила ваш компьютер», нажмите «Подробнее» → «Выполнить в любом случае»: файл не подписан сертификатом.',
      '4. Чтобы выйти, закройте чёрное окно сервера.',
      '',
      'Интернет и Node.js не нужны. Игра доступна только с этого компьютера (127.0.0.1).',
      'Пре-релиз: запуск проверен под Linux тем же запускателем, на Windows — ждём отзывов.',
      '',
      `SHA-256 архива: \`${sha}\``,
    ].join('\n');
    let rel = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, { headers: h });
    if (rel.status === 200) { rel = await rel.json(); report.steps.push('релиз rc.2 уже был'); }
    else {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_name: TAG, target_commitish: process.env.GITHUB_SHA, name: '«Купол» 1.0.0-rc.2 для Windows', body, prerelease: true, draft: false, make_latest: 'true' }) });
      const txt = await r.text();
      report.steps.push(`создание релиза: ${r.status}`);
      if (r.status !== 201) throw new Error(`релиз не создан: ${txt.slice(0, 500)}`);
      rel = JSON.parse(txt);
    }
    report.release = rel.html_url;
    for (const a of rel.assets ?? []) if (a.name === 'Kupol-win64.zip') {
      const d = await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${a.id}`, { method: 'DELETE', headers: h });
      report.steps.push(`старый архив rc.2 удалён: ${d.status}`);
    }
    const up = await fetch(`https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=Kupol-win64.zip`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/zip' }, body: zip });
    const upTxt = await up.text();
    report.steps.push(`загрузка архива: ${up.status}`);
    if (up.status !== 201) throw new Error(`архив не загружен: ${upTxt.slice(0, 500)}`);
    report.asset = JSON.parse(upTxt).browser_download_url;
    const old = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${OLD_TAG}`, { headers: h });
    if (old.status === 200) {
      const o = await old.json();
      const note = `> ⚠️ Устарел: в этой сборке окно тактического боя скрыто. Скачайте [«Купол» 1.0.0-rc.2](${rel.html_url}).\n\n`;
      if (!String(o.body ?? '').startsWith('> ⚠️')) {
        const p = await fetch(`https://api.github.com/repos/${REPO}/releases/${o.id}`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: note + (o.body ?? '') }) });
        report.steps.push(`пометка на rc.1: ${p.status}`);
      }
    }
    report.ok = true;
  } catch (e) {
    report.error = String(e?.message ?? e).slice(0, 1500);
  }
  const pub = '/tmp/kupol-winrc2-out';
  mkdirSync(pub, { recursive: true });
  writeFileSync(`${pub}/report.json`, JSON.stringify(report, null, 2));
  const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
  const o = (c) => execSync(c, { cwd: pub, stdio: 'inherit' });
  o('git init -q && git checkout -q -b ci/win-release && git add -A');
  o('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: пре-релиз rc.2 для Windows"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/win-release`, { cwd: pub, stdio: 'inherit' });
});
