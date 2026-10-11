// Разово в CI (удаляется следующим коммитом): удалить служебную ветку с отчётом партии.
// Только это имя, без масок.
import test from 'node:test';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const FLAG = '/tmp/kupol-drop-ci-branches.done';
const BRANCHES = ['ci/smoke-game'];

test('CI: удалить служебную ветку ci/smoke-game', { skip: !process.env.GITHUB_ACTIONS }, () => {
  if (existsSync(FLAG)) return; writeFileSync(FLAG, '1');
  for (const b of BRANCHES) execSync(`git push origin --delete ${b} || true`, { stdio: 'inherit', shell: '/bin/bash' });
});
