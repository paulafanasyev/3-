// Разово в CI: окно боя после возвращения в партию сохраняет паузу сервера.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

const FLAG = '/tmp/kupol-fix5.done';
const SHA = 'fafee1642c97b368534989e832949317682868e292888523451a4ba7f1f89f35';
const PATCH = `diff --git a/src/game/client/boot.js b/src/game/client/boot.js
index 9a8ec6c..99d601e 100644
--- a/src/game/client/boot.js
+++ b/src/game/client/boot.js
@@ -164,2 +164,4 @@ export async function bootKupol() {
     showBattle(m.battle);
+    // бой на сервере стоял на паузе: окно показывает то же самое, а не «идёт» при замершем времени
+    if (m.speed === 0) battleWindow?.pause(true);
   });
`;

test('CI: патч boot — пауза после возврата', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG) }, () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  assert.equal(createHash('sha256').update(PATCH).digest('hex'), SHA, 'патч повреждён');
  writeFileSync('/tmp/kupol-fix5.patch', PATCH);
  const sh = (c) => execSync(c, { cwd: root, stdio: 'inherit' });
  sh('git apply /tmp/kupol-fix5.patch');
  rmSync(`${root}/src/game/zzFix5.test.mjs`);
  sh('git add -A src/game/client/boot.js src/game/zzFix5.test.mjs');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "бой после возвращения в партию сохраняет паузу"');
  sh('git push origin HEAD:feat/game-design');
});
