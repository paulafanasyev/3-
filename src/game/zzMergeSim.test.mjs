// Разовая проверка в CI (удаляется следующим коммитом): репетиция мержа PR #4 в main.
// Берёт ветку fix/main-i18n-identifiers, прогоняет на ней те же шаги, что бот
// apply-ru-ui.yml делает после каждого пуша в main, и смотрит: изменилось ли что-то,
// целы ли идентификаторы, проходит ли полный npm test. Для сравнения — npm test на main.
// Отчёт пушится в ветку ci/merge-sim. Второй заход: без NODE_TEST_CONTEXT.
import test from 'node:test';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';

const FLAG = '/tmp/kupol-merge-sim2.done';
// NODE_TEST_CONTEXT убираем: иначе вложенный `node --test` считает себя дочерним процессом
// нашего теста, молча пропускает файлы и всегда выходит с кодом 0 (так было в первой репетиции).
const cleanEnv = { ...process.env }; delete cleanEnv.NODE_TEST_CONTEXT;
const run = (cmd, cwd, timeout = 300000) => {
  const r = spawnSync('bash', ['-lc', `set -o pipefail; ${cmd}`], { cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env: cleanEnv });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-6000) };
};

test('CI: репетиция мержа PR #4', { skip: !process.env.GITHUB_ACTIONS, timeout: 1200000 }, () => {
  if (existsSync(FLAG)) return; writeFileSync(FLAG, '1');
  const report = {};
  execSync('git fetch -q origin main fix/main-i18n-identifiers');
  const fix = '/tmp/sim-fix'; const main = '/tmp/sim-main';
  execSync(`git worktree add -f --detach ${fix} origin/fix/main-i18n-identifiers`);
  execSync(`git worktree add -f --detach ${main} origin/main`);
  report.heads = { fix: execSync('git rev-parse origin/fix/main-i18n-identifiers').toString().trim(), main: execSync('git rev-parse origin/main').toString().trim() };
  report.npmCi = run('npm ci --no-audit --no-fund 2>&1 | tail -5', fix, 600000);
  if (!existsSync(`${main}/node_modules`)) symlinkSync(`${fix}/node_modules`, `${main}/node_modules`);
  // шаги бота apply-ru-ui.yml — сначала на ветке PR #4
  report.bot = run('node apply-ru-ui-map-missing.mjs && node apply-ru-ui-map.mjs && node apply-ru-ui-direct.mjs && node build-translation-catalog.mjs', fix);
  report.botDiff = run('git status --short; git diff --stat; git diff -- src | head -c 4000', fix);
  report.idCheck = run('node scripts/repair-i18n-identifiers.mjs --check', fix);
  report.testFixAfterBot = run('npm test 2>&1 | tail -60', fix, 900000);
  report.testMain = run('npm test 2>&1 | tail -60', main, 900000);
  const out = '/tmp/kupol-merge-sim-out'; mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  const header = execSync('git config --get http.https://github.com/.extraheader || true').toString().trim();
  const remote = execSync('git remote get-url origin').toString().trim();
  const sh = (c) => execSync(c, { cwd: out, stdio: 'inherit' });
  sh('git init -q && git checkout -q -b ci/merge-sim && git add -A');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: репетиция мержа PR #4"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/merge-sim`, { cwd: out, stdio: 'inherit' });
  execSync(`git worktree remove --force ${fix} && git worktree remove --force ${main}`);
});
