// Выгрузка кованых юнитов (src/game/client/battle/forge.js) в .glb — для Blender и правок вручную.
// npm run game:units → public/game/units/forge/<ключ>.glb и список по эпохам в index.json.
// Доработанный файл подключается через public/game/units/manifest.json:
//   { "infantry@2": { "file": "forge/infantry2.glb" } } — тип@эпоха или просто тип.
// Атрибуты _TEAM (доля цвета нации) и _METAL (0 — ткань, 1 — металл, 2 — свечение) сохраняются:
// в Blender это Color Attributes / Attributes, игра по ним красит полк в цвет нации.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FORGE, forgeUnit } from '../src/game/client/battle/forge.js';

// GLTFExporter в Node: ему нужен FileReader, которого тут нет
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`; this.onloadend?.(); }); }
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'game', 'units', 'forge');
mkdirSync(out, { recursive: true });
const exporter = new GLTFExporter();
const ERA = ['Древность', 'Индустрия', 'Информационная эпоха', 'Космическая эпоха'];
const index = {};
for (const [key, def] of Object.entries(FORGE)) {
  const u = forgeUnit(key);
  const glb = await exporter.parseAsync(u.scene, { binary: true, animations: u.animations });
  writeFileSync(join(out, `${key}.glb`), Buffer.from(glb));
  (index[ERA[def.era]] ??= []).push({ key, name: def.name, file: `forge/${key}.glb`, triangles: Math.round(u.tris), clips: u.animations.map((a) => a.name) });
  console.log(`${ERA[def.era].padEnd(22)} ${key.padEnd(14)} ${String(Math.round(u.tris)).padStart(6)} треуг. ${(glb.byteLength / 1024).toFixed(0)} КБ`);
}
writeFileSync(join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
