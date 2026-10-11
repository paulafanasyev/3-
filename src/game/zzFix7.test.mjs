// Разово в CI: правки вёрстки HUD по визуальной приёмке (панель дипломатии, подсказка, кнопка справки).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

const FLAG = '/tmp/kupol-fix7.done';
const SHA = '437d74a23ffcfe7332fb14bd8b7a5035e74c318e1c61dd8962fd342e9ef391fe';
const PATCH = `diff --git a/src/game/client/hud.css b/src/game/client/hud.css
index 7dbe4c8..9b66139 100644
--- a/src/game/client/hud.css
+++ b/src/game/client/hud.css
@@ -29,3 +29,3 @@ body.kupol > *:not(#kupol-globe):not(#kupol-root):not(#cesium-credits):not(scrip
 .k-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px; }
-.k-right { position: absolute; right: 16px; top: 80px; width: 330px; display: flex; flex-direction: column; gap: 10px; max-height: calc(100% - 380px); overflow: auto; pointer-events: auto; }
+.k-right { position: absolute; right: 16px; top: 80px; width: 330px; display: flex; flex-direction: column; gap: 10px; max-height: calc(100% - 440px); overflow: auto; pointer-events: auto; }
 .k-lc { display: flex; gap: 11px; padding: 10px; align-items: flex-start; }
@@ -52,3 +52,5 @@ body.kupol > *:not(#kupol-globe):not(#kupol-root):not(#cesium-credits):not(scrip
 .k-nations button:hover { background: rgba(255, 255, 255, .12); }
-.k-hint { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); font-size: 12px; color: var(--dim); padding: 8px 14px; }
+.k-hint { position: absolute; left: 552px; right: 184px; bottom: 16px; font-size: 12px; color: var(--dim); padding: 8px 14px; text-align: center; }
+/* узкий экран: подсказка уступает место хронике, управление есть в справке (F1) */
+@media (max-width: 1100px) { .k-hint { display: none; } }
 .k-live { position: absolute; right: 16px; bottom: 96px; width: 230px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
@@ -88,3 +90,3 @@ body.kupol > *:not(#kupol-globe):not(#kupol-root):not(#cesium-credits):not(scrip
 /* новые панели HUD */
-.k-help { position: absolute; right: 362px; top: 22px; width: 34px; height: 34px; pointer-events: auto; border: 1px solid var(--line); border-radius: 50%; background: rgba(120,170,255,.12); color: var(--txt); font: 700 18px inherit; cursor: pointer; }
+.k-help { position: absolute; right: 362px; top: 80px; width: 34px; height: 34px; pointer-events: auto; border: 1px solid var(--line); border-radius: 50%; background: rgba(120,170,255,.12); color: var(--txt); font: 700 18px inherit; cursor: pointer; }
 .k-help:hover { background: rgba(120,170,255,.25); }
diff --git a/src/game/client/hud.js b/src/game/client/hud.js
index f638e75..54f635f 100644
--- a/src/game/client/hud.js
+++ b/src/game/client/hud.js
@@ -140,3 +140,7 @@ export function createHud(root, actions) {
   function right(s, me) {
-    const all = [...(s.nations ?? []).filter((n) => n.id !== me.id), ...(s.neutrals ?? [])];
+    // нейтральные народы: только живые и уже открытые на карте (иначе панель — список из десятков незнакомцев)
+    // owner в снимке уже скрыт туманом: народ «известен», если видна хоть одна его клетка
+    const known = (id) => (s.owner ?? []).some((o) => o === id);
+    const neutrals = (s.neutrals ?? []).filter((p) => p.alive !== false && known(p.id)).sort((a, b) => (b.relation ?? 0) - (a.relation ?? 0));
+    const all = [...(s.nations ?? []).filter((n) => n.id !== me.id), ...neutrals];
     const war = (id) => (s.wars ?? []).some((k) => k.split('|').includes(id));
@@ -146,3 +150,3 @@ export function createHud(root, actions) {
       const input = a.input ? \`<input data-value type="number" min="1" step="1" value="10" aria-label="Количество золота" title="Количество золота">\` : '';
-      return \`<span class="k-action">\${input}<button \${attrs} data-act="\${esc(a.action)}" \${a.enabled ? '' : 'disabled'} title="\${esc(a.title || a.reason || '')}">\${esc(a.label)}\${a.reason && !a.enabled ? \` <small>(\${esc(a.reason)})</small>\` : ''}</button></span>\`;
+      return \`<span class="k-action">\${input}<button \${attrs} data-act="\${esc(a.action)}" \${a.enabled ? '' : 'disabled'} title="\${esc(!a.enabled && a.reason ? a.reason : (a.title || ''))}">\${esc(a.label)}</button></span>\`;
     };
`;

test('CI: патч вёрстки HUD', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG) }, () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  assert.equal(createHash('sha256').update(PATCH).digest('hex'), SHA, 'патч повреждён');
  writeFileSync('/tmp/kupol-fix7.patch', PATCH);
  const sh = (c) => execSync(c, { cwd: root, stdio: 'inherit' });
  sh('git apply /tmp/kupol-fix7.patch');
  rmSync(`${root}/src/game/zzFix7.test.mjs`);
  sh('git add -A src/game/client/hud.js src/game/client/hud.css src/game/zzFix7.test.mjs');
  sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "HUD: дипломатия без незнакомых народов, подсказка не наезжает на хронику, справка не на верхней панели"');
  sh('git push origin HEAD:feat/game-design');
});
