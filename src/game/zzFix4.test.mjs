// Разово в CI: smoke ставит бой на паузу перед перезагрузкой (сценарный бой слишком короткий).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

const FLAG = '/tmp/kupol-fix4.done';
const SHA = '2ed97cc2793e01a8ac2b43e6d116b9f41c2cb8e8b7484204e8c0518ea4d6c9d8';
const PATCH = `diff --git a/scripts/kupol-browser-smoke.mjs b/scripts/kupol-browser-smoke.mjs
index d39f194..74e94f8 100644
--- a/scripts/kupol-browser-smoke.mjs
+++ b/scripts/kupol-browser-smoke.mjs
@@ -139,3 +139,7 @@ async function playGame(s) {
   if (g.battleCell === undefined) { g.problems.push('тактический бой не открылся'); return g; }
+  // пауза сразу: в сценарии танк против воина бой кончается за секунды, а ниже нужна перезагрузка посреди боя
+  await ev("document.querySelector('.kb-root [data-pause]')?.click(); true");
   await sleep(1500);
+  g.pausedActive = await ev("(() => { const el = document.querySelector('.kb-result'); return !(el && el.style.display === 'flex'); })()");
+  if (!g.pausedActive) { g.problems.push('бой закончился раньше паузы: перезагрузку посреди боя проверить нельзя'); return g; }
   g.regiments = await ev("document.querySelectorAll('.kb-cards > *').length");
`;

test('CI: патч smoke — пауза перед перезагрузкой', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG) }, () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  assert.equal(createHash('sha256').update(PATCH).digest('hex'), SHA, 'патч повреждён');
  writeFileSync('/tmp/kupol-fix4.patch', PATCH);
  const sh = (c) => execSync(c, { cwd: root, stdio: 'inherit' });
  sh('git apply /tmp/kupol-fix4.patch');
  rmSync(`${root}/src/game/zzFix4.test.mjs`);
  sh('git add -A scripts/kupol-browser-smoke.mjs src/game/zzFix4.test.mjs');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "smoke: пауза боя перед перезагрузкой"');
  sh('git push origin HEAD:feat/game-design');
});
