// Разово в CI: подсказка договора показывала «Цена: undefined влияния» — исправление и тест.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

const FLAG = '/tmp/kupol-fix8.done';
const SHA = 'b63b835026784ce9b8b3a297c464b7b7ba6a4e4db34e2b2c43b3b70acaa85aaa';
const PATCH = `diff --git a/src/game/client/diplomacy-ui.js b/src/game/client/diplomacy-ui.js
index d2e4c7e..1bea78f 100644
--- a/src/game/client/diplomacy-ui.js
+++ b/src/game/client/diplomacy-ui.js
@@ -62,3 +62,3 @@ export function diplomacyActions(snapshot, targetId) {
         add(TREATY_NAMES[type] ?? type, { kind: 'propose', target: targetId, treaty: type }, {
-          action: 'propose', treaty: type, title: \`Цена: \${costs[type]} влияния.\`, ...reason(enough, 'Недостаточно влияния.'),
+          action: 'propose', treaty: type, title: \`Цена: \${costs} влияния.\`, ...reason(enough, 'Недостаточно влияния.'),
         });
diff --git a/src/game/client/diplomacy-ui.test.mjs b/src/game/client/diplomacy-ui.test.mjs
index f7e24ae..3350831 100644
--- a/src/game/client/diplomacy-ui.test.mjs
+++ b/src/game/client/diplomacy-ui.test.mjs
@@ -32 +32,7 @@ test('нейтральный народ доступен для подарка 
 });
+
+test('подсказка договора называет цену в влиянии', () => {
+  const titles = diplomacyActions(base(), 'cartel').filter((a) => a.action === 'propose').map((a) => a.title);
+  assert.ok(titles.length > 0);
+  for (const t of titles) assert.match(t, /^Цена: \\d+ влияния\\.$/);
+});
`;

test('CI: патч цены договора', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG) }, () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  assert.equal(createHash('sha256').update(PATCH).digest('hex'), SHA, 'патч повреждён');
  writeFileSync('/tmp/kupol-fix8.patch', PATCH);
  const sh = (c) => execSync(c, { cwd: root, stdio: 'inherit' });
  sh('git apply /tmp/kupol-fix8.patch');
  rmSync(`${root}/src/game/zzFix8.test.mjs`);
  sh('git add -A src/game/client/diplomacy-ui.js src/game/client/diplomacy-ui.test.mjs src/game/zzFix8.test.mjs');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "дипломатия: подсказка договора называет цену в влиянии"');
  sh('git push origin HEAD:feat/game-design');
});
