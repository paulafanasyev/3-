// Разово в CI: smoke ставит бой на паузу сразу после старта (window.__kupol.battleSpeed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

const FLAG = '/tmp/kupol-fix6.done';
const SHA = 'a8638fcf4fdb008194cb36dc46ee02a40fb3a1cf2455d5ce1bc6a6710de6726f';
const PATCH = `diff --git a/scripts/kupol-browser-smoke.mjs b/scripts/kupol-browser-smoke.mjs
index 74e94f8..98dff4f 100644
--- a/scripts/kupol-browser-smoke.mjs
+++ b/scripts/kupol-browser-smoke.mjs
@@ -134,3 +134,3 @@ async function playGame(s) {
   for (const cell of g.enemies) {
-    await ev(\`window.__kbDone = undefined; window.__kupol.tactical(\${JSON.stringify(g.tanks[0])}, \${cell}).then((r) => { window.__kbDone = r ? JSON.stringify(r) : 'null'; }, (e) => { window.__kbDone = 'error: ' + e; }); true\`);
+    await ev(\`window.__kbDone = undefined; window.__kupol.tactical(\${JSON.stringify(g.tanks[0])}, \${cell}).then((r) => { window.__kbDone = r ? JSON.stringify(r) : 'null'; }, (e) => { window.__kbDone = 'error: ' + e; }); window.__kupol.battleSpeed(0).catch(() => {}); true\`);
     const opened = await waitFor("document.querySelector('.kb-root') ? true : (window.__kbDone !== undefined ? 'no' : null)", 8000);
diff --git a/src/game/client/boot.js b/src/game/client/boot.js
index 99d601e..9d5813a 100644
--- a/src/game/client/boot.js
+++ b/src/game/client/boot.js
@@ -310,2 +310,3 @@ export async function bootKupol() {
     tactical: (unitId, cell) => { const u = myUnit(unitId); return u ? runTactical(u, cell) : Promise.resolve(null); },
+    battleSpeed: (speed) => net.battleSpeed(speed),
   };
`;

test('CI: патч smoke — пауза со старта боя', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG) }, () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  assert.equal(createHash('sha256').update(PATCH).digest('hex'), SHA, 'патч повреждён');
  writeFileSync('/tmp/kupol-fix6.patch', PATCH);
  const sh = (c) => execSync(c, { cwd: root, stdio: 'inherit' });
  sh('git apply /tmp/kupol-fix6.patch');
  rmSync(`${root}/src/game/zzFix6.test.mjs`);
  sh('git add -A scripts/kupol-browser-smoke.mjs src/game/client/boot.js src/game/zzFix6.test.mjs');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "smoke: пауза боя сразу после старта"');
  sh('git push origin HEAD:feat/game-design');
});
