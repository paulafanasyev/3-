// Разово в CI (удаляется следующим коммитом): удалить три служебные ветки с отчётами проверок.
// Только эти три имени, без масок.
import test from 'node:test';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const FLAG = '/tmp/kupol-drop-ci-branches.done';
const BRANCHES = ['ci/browser-check', 'ci/merge-sim', 'ci/smoke-proof'];

test('CI: удалить служебные ветки ci/*', { skip: !process.env.GITHUB_ACTIONS }, () => {
  if (existsSync(FLAG)) return; writeFileSync(FLAG, '1');
  for (const b of BRANCHES) execSync(`git push origin --delete ${b} || true`, { stdio: 'inherit', shell: '/bin/bash' });
});
