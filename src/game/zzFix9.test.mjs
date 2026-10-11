// Разово в CI: кнопка «Расторгнуть» ничего не делала (нет обработчика), договоры с заглавной буквы.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

const FLAG = '/tmp/kupol-fix9.done';
const SHA = '69a8f82fdaf7a67ef8b640348d2e5ceb0098090ad8e380dbb219b35643965bab';
const PATCH = `diff --git a/src/game/client/boot.js b/src/game/client/boot.js
index 9d5813a..765132c 100644
--- a/src/game/client/boot.js
+++ b/src/game/client/boot.js
@@ -103,2 +103,3 @@ export async function bootKupol() {
     annex: (d) => send({ kind: 'annex', target: d.target }),
+    cancelTreaty: (d) => { if (confirm('Расторгнуть договор? Это ударит по отношениям и репутации.')) send({ kind: 'cancelTreaty', target: d.target, treaty: d.treaty }).then((r) => r.ok && hud.toast('Договор расторгнут')); },
     negotiate: (d) => send({ kind: 'negotiate', target: d.target, deal: { give: { gold: Math.max(1, Math.floor(Number(d.amount) || 0)) }, take: {} } }),
diff --git a/src/game/client/diplomacy-ui.js b/src/game/client/diplomacy-ui.js
index 1bea78f..3025ae2 100644
--- a/src/game/client/diplomacy-ui.js
+++ b/src/game/client/diplomacy-ui.js
@@ -61,3 +61,4 @@ export function diplomacyActions(snapshot, targetId) {
         const enough = influence >= costs;
-        add(TREATY_NAMES[type] ?? type, { kind: 'propose', target: targetId, treaty: type }, {
+        const name = TREATY_NAMES[type] ?? type;
+        add(name.charAt(0).toUpperCase() + name.slice(1), { kind: 'propose', target: targetId, treaty: type }, {
           action: 'propose', treaty: type, title: \`Цена: \${costs} влияния.\`, ...reason(enough, 'Недостаточно влияния.'),
diff --git a/src/game/client/diplomacy-ui.test.mjs b/src/game/client/diplomacy-ui.test.mjs
index 3350831..ddb58fa 100644
--- a/src/game/client/diplomacy-ui.test.mjs
+++ b/src/game/client/diplomacy-ui.test.mjs
@@ -38 +38,6 @@ test('подсказка договора называет цену в влия
 });
+
+test('кнопки договоров начинаются с заглавной буквы', () => {
+  const labels = diplomacyActions(base(), 'cartel').filter((a) => a.action === 'propose').map((a) => a.label);
+  for (const l of labels) assert.equal(l[0], l[0].toUpperCase(), l);
+});
`;

test('CI: патч расторжения договора', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG) }, () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  assert.equal(createHash('sha256').update(PATCH).digest('hex'), SHA, 'патч повреждён');
  writeFileSync('/tmp/kupol-fix9.patch', PATCH);
  const sh = (c) => execSync(c, { cwd: root, stdio: 'inherit' });
  sh('git apply /tmp/kupol-fix9.patch');
  rmSync(`${root}/src/game/zzFix9.test.mjs`);
  sh('git add -A src/game/client/boot.js src/game/client/diplomacy-ui.js src/game/client/diplomacy-ui.test.mjs src/game/zzFix9.test.mjs');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "дипломатия: работает «Расторгнуть договор», названия договоров с заглавной буквы"');
  sh('git push origin HEAD:feat/game-design');
});
