// Разово в CI: правка smoke (ждать новый документ после перезагрузки), сверка sha256, удаляет себя и пушит.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

const FLAG = '/tmp/kupol-fix2.done';
const SHA = 'f7a783504b5ccb6bb86ef51f47cce9b710846a58415e362709df1f674f4f0232';
const PATCH = `diff --git a/scripts/kupol-browser-smoke.mjs b/scripts/kupol-browser-smoke.mjs
index 8f9df62..6017ebf 100644
--- a/scripts/kupol-browser-smoke.mjs
+++ b/scripts/kupol-browser-smoke.mjs
@@ -139,4 +139,6 @@ async function playGame(s) {
   // перезагрузка посреди боя: сессия на сервере жива, окно боя возвращается само
+  // метка живёт только в старом документе: так ждём именно новую страницу, а не успеваем проверить старую
+  await ev('window.__kupolOld = 1; true');
   await s.send('Page.reload', {});
-  g.battleRestored = await waitFor("document.querySelector('.kb-root .kb-scene canvas') && !document.querySelector('.k-start') ? true : null", 40000);
+  g.battleRestored = await waitFor("!window.__kupolOld && document.querySelector('.kb-root .kb-scene canvas') && !document.querySelector('.k-start') ? true : null", 60000);
   if (!g.battleRestored) { g.problems.push('после перезагрузки посреди боя окно боя не вернулось'); return g; }
@@ -163,4 +165,5 @@ async function playGame(s) {
   // перезагрузка страницы: партия возвращается по токену сессии, без окна выбора нации
+  await ev('window.__kupolOld = 1; true');
   await s.send('Page.reload', {});
-  g.resumedTurn = await waitFor("(() => { const st = window.__kupol?.state; return st && !document.querySelector('.k-start') ? st.turn : null; })()", 40000);
+  g.resumedTurn = await waitFor("(() => { const st = window.__kupol?.state; return !window.__kupolOld && st && !document.querySelector('.k-start') ? st.turn : null; })()", 60000);
   if (g.resumedTurn !== g.turnSettled) g.problems.push(\`после перезагрузки партия не вернулась (ход \${g.resumedTurn ?? '—'} вместо \${g.turnSettled})\`);
`;

test('CI: патч smoke — перезагрузка', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG) }, () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  assert.equal(createHash('sha256').update(PATCH).digest('hex'), SHA, 'патч повреждён');
  writeFileSync('/tmp/kupol-fix2.patch', PATCH);
  const sh = (c) => execSync(c, { cwd: root, stdio: 'inherit' });
  sh('git apply /tmp/kupol-fix2.patch');
  rmSync(`${root}/src/game/zzFix2.test.mjs`);
  sh('git add -A scripts/kupol-browser-smoke.mjs src/game/zzFix2.test.mjs');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "smoke: после перезагрузки ждать новый документ"');
  sh('git push origin HEAD:feat/game-design');
});
