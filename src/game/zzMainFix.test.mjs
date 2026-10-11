// Разовая задача CI (удаляется следующим коммитом): создать от main ветку fix/main-i18n-identifiers
// с починкой идентификаторов, переведённых ботом русификации, и тестом-сторожем. В main не пишет.
import test from 'node:test';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const BRANCH = 'fix/main-i18n-identifiers';
test('CI: ветка починки main', { skip: !process.env.GITHUB_ACTIONS }, () => {
  const sh = (cmd, cwd = process.cwd()) => execSync(cmd, { cwd, stdio: 'inherit' });
  if (execSync(`git ls-remote --heads origin ${BRANCH}`).toString().trim()) return; // уже создана
  const dir = `${process.cwd()}/.mainfix`;
  if (existsSync(dir)) return; // параллельный прогон уже работает
  sh('git fetch origin main');
  sh(`git worktree add -B ${BRANCH} ${dir} origin/main`);
  try {
    sh(`cp scripts/repair-i18n-identifiers.mjs ${dir}/scripts/ && cp src/i18nIdentifiers.test.mjs ${dir}/src/`);
    sh('node scripts/repair-i18n-identifiers.mjs', dir);
    sh('node --test src/i18nIdentifiers.test.mjs src/data/rocketLaunches.test.mjs', dir);
    sh('git add -A', dir);
    sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -m "fix: restore Latin identifiers broken by i18n (rocketLaunches) + guard test"', dir);
    sh(`git push origin ${BRANCH}`, dir);
  } finally {
    sh(`git worktree remove --force ${dir}`);
  }
});
