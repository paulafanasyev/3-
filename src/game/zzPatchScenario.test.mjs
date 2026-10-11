// Разовая правка в CI (удаляется следующим коммитом): сценарий battle для dev-сервера
// и ручки window.__kupol.tactical/endTurn в boot.js. Правки по уникальным якорям, хэши
// исходника и результата сверяются с проверенными локально, затем коммит в feat/game-design.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const FLAG = '/tmp/kupol-patch-scenario.done';
const PATCHES = {
  "src/game/session.js": [
    "56a3ed042bb4a37de200a63146b218796bb80474",
    "cef8ea5c7842a1875e11caf8a679163bc6a9af73",
    [
      [
        "export function createGameSession({ send, now = () => Date.now(), map = loadMap(), timers = { setInterval, clearInterval } } = {}) {",
        "/** onNewGame(game, map) — необязательная подготовка свежей партии до первого снимка (сценарии dev-сервера). */\nexport function createGameSession({ send, now = () => Date.now(), map = loadMap(), timers = { setInterval, clearInterval }, onNewGame = null } = {}) {"
      ],
      [
        "        lastEventSeq = 0;\n        broadcast();\n        return true;",
        "        lastEventSeq = 0;\n        if (onNewGame) onNewGame(game, map);\n        broadcast();\n        return true;"
      ]
    ]
  ],
  "scripts/kupol-dev.mjs": [
    "e08d41c86a39ea044d33a8df2c5f6f3ab671dd3c",
    "ad8b78dd6f42a6baf5098eb3b57e52b2906879d4",
    [
      [
        "import { createGameSession } from '../src/game/session.js';\n",
        "import { createGameSession } from '../src/game/session.js';\nimport { SCENARIOS } from '../src/game/scenarios.js';\n"
      ],
      [
        "const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });\n",
        "const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });\n// KUPOL_SCENARIO=battle — готовая ситуация для проверок в браузере (scripts/kupol-browser-smoke.mjs)\nconst scenario = SCENARIOS[process.env.KUPOL_SCENARIO] ?? null;\nif (process.env.KUPOL_SCENARIO && !scenario) console.warn(`[Купол] неизвестный сценарий: ${process.env.KUPOL_SCENARIO}`);\n"
      ],
      [
        "  const game = createGameSession({ send });",
        "  const game = createGameSession({ send, onNewGame: scenario });"
      ]
    ]
  ],
  "src/game/client/boot.js": [
    "960648476fb0133c6abfbce1e816fbf775f198f4",
    "8e5bb05ee082922278d1e5196fdd5b7220641b01",
    [
      [
        "    const r = await send({ kind: 'battle', unitId: unit.id, to: cell });\n    if (!r.ok) return;",
        "    const r = await send({ kind: 'battle', unitId: unit.id, to: cell });\n    if (!r.ok) return null;"
      ],
      [
        "    selection.cell = myUnit(selection.unitId)?.cell ?? selection.cell;\n    redraw();\n  }",
        "    selection.cell = myUnit(selection.unitId)?.cell ?? selection.cell;\n    redraw();\n    return combat;\n  }"
      ],
      [
        "  window.__kupol = { viewer, get state() { return state; } };",
        "  // ручки для отладки и дымовой проверки в браузере: те же команды, что у мыши и Enter\n  window.__kupol = {\n    viewer, get state() { return state; },\n    endTurn,\n    tactical: (unitId, cell) => { const u = myUnit(unitId); return u ? runTactical(u, cell) : Promise.resolve(null); },\n  };"
      ]
    ]
  ]
};
const hash = (f) => execSync(`git hash-object ${f}`).toString().trim();

test('CI: сценарий battle и ручки боя', { skip: !process.env.GITHUB_ACTIONS }, () => {
  if (existsSync(FLAG)) return; writeFileSync(FLAG, '1');
  for (const [file, [from, want, pairs]] of Object.entries(PATCHES)) {
    assert.equal(hash(file), from, `${file}: исходник не тот`);
    let t = readFileSync(file, 'utf8');
    for (const [a, b] of pairs) { assert.equal(t.split(a).length, 2, `${file}: якорь`); t = t.replace(a, () => b); }
    writeFileSync(file, t);
    assert.equal(hash(file), want, `${file}: результат не тот`);
  }
  const files = Object.keys(PATCHES).join(' ');
  execSync(`git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "kupol: сценарий battle для dev-сервера, ручки tactical/endTurn в window.__kupol" -- ${files}`, { stdio: 'inherit' });
  execSync('git push origin HEAD:feat/game-design', { stdio: 'inherit' });
});
