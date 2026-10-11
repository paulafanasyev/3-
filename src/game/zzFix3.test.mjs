// Разово в CI: диагностика браузерного smoke (журнал сокета, состояние страницы после перезагрузки).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

const FLAG = '/tmp/kupol-fix3.done';
const SHA = 'b4ca33e695a744a51335a08f4f2b5736223e037ffa956b60e03a15ec17e7d067';
const PATCH = `diff --git a/scripts/kupol-browser-smoke.mjs b/scripts/kupol-browser-smoke.mjs
index 6017ebf..d39f194 100644
--- a/scripts/kupol-browser-smoke.mjs
+++ b/scripts/kupol-browser-smoke.mjs
@@ -74,3 +74,3 @@ export async function smokeKupol({ url, chrome = findChrome(), offline = true, t
   const proc = spawn(chrome, args, { stdio: 'ignore' });
-  const report = { offline, url, exceptions: [], consoleErrors: [], natural: { ok: 0, fail: 0 }, toasts: [], canvas: false, bootError: null, waitedMs: 0 };
+  const report = { offline, url, ws: [], exceptions: [], consoleErrors: [], natural: { ok: 0, fail: 0 }, toasts: [], canvas: false, bootError: null, waitedMs: 0 };
   try {
@@ -81,2 +81,7 @@ export async function smokeKupol({ url, chrome = findChrome(), offline = true, t
       if (m.method === 'Network.responseReceived' && /NaturalEarthII\\/\\d/.test(m.params.response.url)) report.natural[m.params.response.status < 400 ? 'ok' : 'fail'] += 1;
+      // журнал сокета партии: тип сообщения и важные поля (для разбора падений после перезагрузки)
+      if (m.method === 'Network.webSocketFrameReceived' || m.method === 'Network.webSocketFrameSent') {
+        let t = '?'; try { const x = JSON.parse(m.params.response.payloadData); t = \`\${x.type}\${x.ok !== undefined ? \`:\${x.ok}\` : ''}\${x.battle ? \`:t\${x.battle.tick}\` : ''}\${x.command?.kind ? \`:\${x.command.kind}\` : ''}\`; } catch { /* не JSON */ }
+        report.ws.push(\`\${m.method.endsWith('Sent') ? '>' : '<'}\${t}\`); if (report.ws.length > 80) report.ws.splice(0, report.ws.length - 80);
+      }
     });
@@ -143,3 +148,6 @@ async function playGame(s) {
   g.battleRestored = await waitFor("!window.__kupolOld && document.querySelector('.kb-root .kb-scene canvas') && !document.querySelector('.k-start') ? true : null", 60000);
-  if (!g.battleRestored) { g.problems.push('после перезагрузки посреди боя окно боя не вернулось'); return g; }
+  if (!g.battleRestored) {
+    g.afterReload = await ev("JSON.stringify({ old: !!window.__kupolOld, kupol: !!window.__kupol, turn: window.__kupol?.state?.turn ?? null, start: !!document.querySelector('.k-start'), roots: document.querySelectorAll('.kb-root').length, scene: !!document.querySelector('.kb-scene'), canvas: !!document.querySelector('.kb-root canvas'), status: document.querySelector('.k-status')?.textContent ?? null, reconnect: document.querySelector('.k-reconnect')?.style.display ?? null, token: (() => { try { return !!sessionStorage.getItem('kupol.session'); } catch { return 'err'; } })(), body: document.body.innerText.slice(0, 300) })");
+    g.problems.push('после перезагрузки посреди боя окно боя не вернулось'); return g;
+  }
   await sleep(1000);
`;

test('CI: патч smoke — диагностика', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG) }, () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  assert.equal(createHash('sha256').update(PATCH).digest('hex'), SHA, 'патч повреждён');
  writeFileSync('/tmp/kupol-fix3.patch', PATCH);
  const sh = (c) => execSync(c, { cwd: root, stdio: 'inherit' });
  sh('git apply /tmp/kupol-fix3.patch');
  rmSync(`${root}/src/game/zzFix3.test.mjs`);
  sh('git add -A scripts/kupol-browser-smoke.mjs src/game/zzFix3.test.mjs');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "smoke: журнал сокета и состояние страницы после перезагрузки"');
  sh('git push origin HEAD:feat/game-design');
});
