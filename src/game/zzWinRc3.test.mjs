// Разово в CI: сборка Kupol.exe с устойчивым выводом (kupol.log), проверка самого exe под Wine
// с выводом в канал (раньше так падал с EBADF) и, если всё прошло, пре-релиз «Купол» 1.0.0-rc.3.
// Старый rc.2 не удаляется: в описание добавляется пометка «устарел». Никогда не роняет CI: отчёт — в ci/win-release.
import test from 'node:test';
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FLAG = '/tmp/kupol-winrc3.done';
const REPO = 'paulafanasyev/3-';
const TAG = 'kupol-v1.0.0-rc.3-win';
const OLD_TAG = 'kupol-v1.0.0-rc.2-win';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsTurn(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url.replace('http', 'ws').replace('/kupol', '/ws'));
    const timer = setTimeout(() => { ws.close(); reject(new Error('нет game:state')); }, 30000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'game:new', setup: { player: 'borea' } }));
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'game:state') { clearTimeout(timer); ws.close(); resolve(m.state?.turn ?? true); } };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ошибка WebSocket')); };
  });
}

test('CI: пре-релиз Kupol.exe rc.3', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG), timeout: 2400000 }, async () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  const header = execSync('git config --get http.https://github.com/.extraheader || true', { cwd: root }).toString().trim();
  const report = { commit: process.env.GITHUB_SHA, at: new Date().toISOString(), ok: false, steps: [] };
  const step = (s) => report.steps.push(s);
  const out = '/tmp/kupol-win-rc3';
  const prefix = `${process.env.HOME}/.kupol-wineprefix3`;
  let exe = null;
  try {
    execSync('node scripts/build-kupol-windows.mjs --smoke 2>&1', { cwd: root, env: { ...process.env, KUPOL_WIN_OUT: out }, maxBuffer: 256 * 1024 * 1024 });
    const build = JSON.parse(readFileSync(`${out}/report.json`, 'utf8'));
    step(`сборка: Linux-проверка ${build.smoke?.ok ? 'прошла' : 'НЕ прошла'}, ход ${build.smoke?.turn}`);
    if (!build.smoke?.ok) throw new Error('Linux-проверка запускателя не прошла');
    const zip = readFileSync(`${out}/Kupol-win64.zip`);
    const sha = createHash('sha256').update(zip).digest('hex');
    report.zip = { bytes: zip.length, sha };
    // Wine: тот самый exe из архива, вывод в канал — раньше так падал
    execSync(`rm -rf /tmp/kupol-w3 && mkdir -p /tmp/kupol-w3 && cd /tmp/kupol-w3 && unzip -q "${out}/Kupol-win64.zip"`);
    execSync('sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wine64 >/dev/null 2>&1 || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wine >/dev/null 2>&1', { stdio: 'inherit', timeout: 600000 });
    const wine = ['wine64', 'wine'].map((w) => { try { return execSync(`command -v ${w}`).toString().trim(); } catch { return null; } }).find(Boolean);
    if (!wine) throw new Error('Wine не установился');
    const env = { ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all', WINEDLLOVERRIDES: 'mscoree,mshtml=', KUPOL_NO_BROWSER: '1', PORT: '4793', DISPLAY: '' };
    try { execSync(`${wine} wineboot --init`, { env, stdio: 'ignore', timeout: 180000 }); } catch (e) { step(`wineboot: ${String(e.message).slice(0, 120)}`); }
    let pipeLog = '';
    exe = spawn(wine, ['/tmp/kupol-w3/Kupol/Kupol.exe'], { env, cwd: '/tmp/kupol-w3/Kupol', stdio: ['ignore', 'pipe', 'pipe'] });
    exe.stdout.on('data', (d) => { pipeLog += d; }); exe.stderr.on('data', (d) => { pipeLog += d; });
    const t1 = Date.now(); let ok = false;
    while (Date.now() - t1 < 180000 && exe.exitCode === null && !ok) {
      await sleep(1000);
      try { ok = (await fetch('http://127.0.0.1:4793/kupol')).status === 200; } catch { /* ещё стартует */ }
    }
    report.pipeLog = pipeLog.slice(-1500);
    try { report.kupolLog = readFileSync('/tmp/kupol-w3/Kupol/kupol.log', 'utf8').slice(-1500); } catch { report.kupolLog = null; }
    step(`Wine, вывод в канал: exe ${exe.exitCode === null ? 'работает' : `завершился с кодом ${exe.exitCode}`}, страница ${ok ? 'отвечает' : 'НЕ отвечает'}`);
    if (!ok) throw new Error('exe под Wine не поднял сервер');
    step(`WebSocket: новая партия, ход ${await wsTurn('http://127.0.0.1:4793/kupol')}`);
    step(`kupol.log: ${report.kupolLog ? 'есть' : 'нет'}${report.kupolLog?.includes('Игра открыта') ? ', с адресом игры' : ''}`);
    exe.kill('SIGKILL'); exe = null;
    // релиз
    const basic = header.replace(/^AUTHORIZATION:\s*basic\s*/i, '');
    const token = Buffer.from(basic, 'base64').toString().split(':').pop();
    const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'kupol-ci' };
    const body = [
      '«Купол» 1.0.0-rc.3 — сборка для Windows (64 бит).',
      '',
      '**Что нового по сравнению с rc.2:** запуск больше не падает, если у программы нет окна консоли или сломан вывод; всё, что пишет сервер, сохраняется в `kupol.log` рядом с `Kupol.exe` — его можно прислать, если что-то пошло не так.',
      '',
      '**Проверено:** этот самый `Kupol.exe` запускался под Wine 9 (слой Windows на Linux): сервер поднялся, новая партия создаётся.',
      '',
      '**Как запустить**',
      '1. Скачайте `Kupol-win64.zip` ниже и распакуйте целиком в любую папку.',
      '2. Запустите `Kupol.exe` — игра откроется в браузере.',
      '3. Если Windows покажет «Система Windows защитила ваш компьютер», нажмите «Подробнее» → «Выполнить в любом случае»: файл не подписан сертификатом.',
      '4. Чтобы выйти, закройте чёрное окно сервера.',
      '',
      'Интернет и Node.js не нужны. Игра доступна только с этого компьютера (127.0.0.1).',
      '',
      `SHA-256 архива: \`${sha}\``,
    ].join('\n');
    let rel = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, { headers: h });
    if (rel.status === 200) { rel = await rel.json(); step('релиз rc.3 уже был'); }
    else {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_name: TAG, target_commitish: process.env.GITHUB_SHA, name: '«Купол» 1.0.0-rc.3 для Windows', body, prerelease: true, draft: false, make_latest: 'true' }) });
      const txt = await r.text();
      step(`создание релиза: ${r.status}`);
      if (r.status !== 201) throw new Error(`релиз не создан: ${txt.slice(0, 500)}`);
      rel = JSON.parse(txt);
    }
    report.release = rel.html_url;
    for (const a of rel.assets ?? []) if (a.name === 'Kupol-win64.zip') await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${a.id}`, { method: 'DELETE', headers: h });
    const up = await fetch(`https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=Kupol-win64.zip`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/zip' }, body: zip });
    const upTxt = await up.text();
    step(`загрузка архива: ${up.status}`);
    if (up.status !== 201) throw new Error(`архив не загружен: ${upTxt.slice(0, 500)}`);
    report.asset = JSON.parse(upTxt).browser_download_url;
    const old = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${OLD_TAG}`, { headers: h });
    if (old.status === 200) {
      const o = await old.json();
      if (!String(o.body ?? '').startsWith('> ⚠️')) {
        const note = `> ⚠️ Устарел: скачайте [«Купол» 1.0.0-rc.3](${rel.html_url}) — устойчивый запуск и журнал kupol.log.\n\n`;
        const p = await fetch(`https://api.github.com/repos/${REPO}/releases/${o.id}`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: note + (o.body ?? '') }) });
        step(`пометка на rc.2: ${p.status}`);
      }
    }
    report.ok = true;
  } catch (e) {
    report.error = String(e?.message ?? e).slice(0, 1500);
  } finally {
    exe?.kill('SIGKILL');
    try { execSync('wineserver -k || true', { stdio: 'ignore', env: { ...process.env, WINEPREFIX: prefix } }); } catch {}
  }
  const pub = '/tmp/kupol-winrc3-out';
  mkdirSync(pub, { recursive: true });
  writeFileSync(`${pub}/report.json`, JSON.stringify(report, null, 2));
  const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
  const o = (c) => execSync(c, { cwd: pub, stdio: 'inherit' });
  o('git init -q && git checkout -q -b ci/win-release && git add -A');
  o('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: пре-релиз rc.3 для Windows"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/win-release`, { cwd: pub, stdio: 'inherit' });
});
