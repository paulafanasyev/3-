// Разовая правка в CI (удаляется следующим коммитом): 4-й круг полировки gun3 / fighter3.
// Вставляет строки после уникальных якорей forge.js, сверяет git-хэш итогового файла
// с проверенной локально версией и только тогда коммитит в feat/game-design.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const FILE = 'src/game/client/battle/forge.js';
const WANT = '3fcab5bd773405a2f07ffa5823b3f2537bd568d5';
const FLAG = '/tmp/kupol-forge-r4.done';

export function patchForge(src) {
  const ins = [
    ["k.add('body', G.box(2.32, 0.08, 4.0, 0, 1.47, -1.0), 'carbon'); // кромка рамы\n",
      "    k.pair((s) => { k.add('body', G.box(0.36, 0.14, 0.05, s * 0.75, 1.0, 2.92), 'glow'); k.add('body', G.box(0.08, 0.2, 0.14, s * 1.17, 2.0, 2.2), 'carbon'); }); // фары и зеркала\n" +
      "    k.add('body', G.box(1.4, 0.08, 0.5, 0, 2.48, 1.95), 'carbon'); k.add('body', G.cyl(0.025, 0.025, 0.7, 0.6, 2.85, 1.7, 6), 'carbon'); // крыша кабины и антенна\n"],
    ["k.add('barrel', G.box(0.4, 0.26, 0.22, 0, 0, 2.78).rotateX(-0.42).translate(0, 2.55, 1.3), 'carbon'); // дульный блок\n",
      "    k.pair((s) => k.add('turret', G.seg([s * 0.32, 1.85, -0.2], [s * 0.32, 2.5, 1.15], 0.07, 0.05, 8), 'armor2')); // гидроцилиндры подъёма\n"],
    ["k.pair((s) => k.add('body', G.box(0.03, 0.05, 2.4, s * 3.6, -0.02, -2.6), 'glow')); // навигационные полосы\n",
      "    k.pair((s) => { k.add('body', G.cyl(0.1, 0.1, 2.0, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(s * 2.5, -0.3, -1.2), 'carbon'); k.add('body', G.cone(0.1, 0.3, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(s * 2.5, -0.3, -0.05), 'ceramic'); k.add('body', G.box(0.04, 0.14, 0.6, s * 2.5, -0.16, -1.2), 'carbon'); }); // ракеты на пилонах\n" +
      "    k.add('body', G.box(0.12, 0.03, 3.4, 0, 0.62, -1.5), 'team'); // хребтовая полоса цвета нации\n" +
      "    k.add('body', G.cone(0.06, 0.5, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(0, 0, 5.9), 'carbon'); // носовой датчик\n"],
  ];
  let out = src.replace('без «кожи под ткань»', 'без «кожи под тканью»');
  for (const [anchor, add] of ins) {
    assert.equal(out.split(anchor).length, 2, `якорь не уникален: ${anchor.slice(0, 40)}`);
    if (!out.includes(anchor + add)) out = out.replace(anchor, anchor + add);
  }
  return out;
}

test('CI: 4-й круг forge.js', { skip: !process.env.GITHUB_ACTIONS }, () => {
  if (existsSync(FLAG)) return; writeFileSync(FLAG, '1');
  writeFileSync(FILE, patchForge(readFileSync(FILE, 'utf8')));
  assert.equal(execSync(`git hash-object ${FILE}`).toString().trim(), WANT);
  const sh = (c) => execSync(c, { stdio: 'inherit' });
  sh(`git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "forge: 4-й круг (gun3 фары/зеркала/гидроцилиндры, fighter3 ракеты/датчик)" -- ${FILE}`);
  sh('git push origin HEAD:feat/game-design');
});
