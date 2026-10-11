// Разово в CI: окно тактического боя было скрыто стилями карты (body.kupol > * прятал .kb-root).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

const FLAG = '/tmp/kupol-fix10.done';
const SHA = '4fec1827e8758de2f6437669093e12d3962416dd6ece75146ffcfaf718be80e4';
const PATCH = `diff --git a/scripts/kupol-browser-smoke.mjs b/scripts/kupol-browser-smoke.mjs
index 98dff4f..17f2f89 100644
--- a/scripts/kupol-browser-smoke.mjs
+++ b/scripts/kupol-browser-smoke.mjs
@@ -147,2 +147,5 @@ async function playGame(s) {
   if (!g.battleCanvas) g.problems.push('у боя нет холста three.js');
+  // окно боя должно быть видно игроку, а не только лежать в DOM (стили карты прячут чужие слои body)
+  g.battleVisible = await ev("(() => { const r = document.querySelector('.kb-root'); if (!r || getComputedStyle(r).display === 'none') return false; const b = r.getBoundingClientRect(); return b.width > 0 && b.height > 0; })()");
+  if (!g.battleVisible) g.problems.push('окно боя скрыто: игрок его не видит');
   // перезагрузка посреди боя: сессия на сервере жива, окно боя возвращается само
diff --git a/src/game/client/battle-visible.test.mjs b/src/game/client/battle-visible.test.mjs
new file mode 100644
index 0000000..3822db5
--- /dev/null
+++ b/src/game/client/battle-visible.test.mjs
@@ -0,0 +1,15 @@
+import assert from 'node:assert/strict';
+import test from 'node:test';
+import { readFileSync } from 'node:fs';
+
+// Карта «Купола» прячет все слои body, кроме своих. Окно тактического боя (.kb-root) тоже
+// добавляется прямо в body, поэтому обязано быть в списке исключений, иначе бой идёт невидимым.
+test('стили карты не прячут окно тактического боя', () => {
+  const css = readFileSync(new URL('./hud.css', import.meta.url), 'utf8');
+  const rule = css.split('\\n').find((line) => line.startsWith('body.kupol > *:not('));
+  assert.ok(rule, 'нет правила, скрывающего чужие слои');
+  assert.match(rule, /:not\\(\\.kb-root\\)/);
+  const battle = readFileSync(new URL('./battle/hud.js', import.meta.url), 'utf8');
+  assert.match(battle, /root\\.className = 'kb-root'/);
+  assert.match(battle, /document\\.body\\.appendChild\\(root\\)/);
+});
diff --git a/src/game/client/hud.css b/src/game/client/hud.css
index 9b66139..badff10 100644
--- a/src/game/client/hud.css
+++ b/src/game/client/hud.css
@@ -2,3 +2,3 @@
 body.kupol { margin: 0; overflow: hidden; background: #000; }
-body.kupol > *:not(#kupol-globe):not(#kupol-root):not(#cesium-credits):not(script):not(style):not(link) { display: none !important; }
+body.kupol > *:not(#kupol-globe):not(#kupol-root):not(.kb-root):not(#cesium-credits):not(script):not(style):not(link) { display: none !important; }
 #kupol-globe { position: fixed; inset: 0; }
`;

test('CI: патч видимости боя', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG) }, () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  assert.equal(createHash('sha256').update(PATCH).digest('hex'), SHA, 'патч повреждён');
  writeFileSync('/tmp/kupol-fix10.patch', PATCH);
  const sh = (c) => execSync(c, { cwd: root, stdio: 'inherit' });
  sh('git apply /tmp/kupol-fix10.patch');
  rmSync(`${root}/src/game/zzFix10.test.mjs`);
  sh('git add -A src/game/client/hud.css src/game/client/battle-visible.test.mjs scripts/kupol-browser-smoke.mjs src/game/zzFix10.test.mjs');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "бой: окно тактического боя больше не прячется стилями карты; дымовая проверка следит за видимостью"');
  sh('git push origin HEAD:feat/game-design');
});
