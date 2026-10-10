import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEADERS } from '../data/leaders.js';

// avatar-svg.js — закрытый код из репо ai-english-teacher; без него тесты лиц пропускаются
const renderer = fileURLToPath(new URL('./avatar-svg.js', import.meta.url));
const skip = existsSync(renderer) ? false : 'нет avatar-svg.js (см. CREDITS.md)';

test('у каждого лидера есть лицо на каждое настроение', { skip }, async () => {
  const { LEADER_FACES, LEADER_MOODS, renderLeaderSVG } = await import('./leaderFaces.js');
  for (const id of Object.keys(LEADERS)) {
    assert.ok(LEADER_FACES[id], id);
    assert.equal(LEADER_FACES[id].name, LEADERS[id].name);
    for (const mood of LEADER_MOODS) {
      const svg = renderLeaderSVG(id, { mood });
      assert.ok(svg.startsWith('<svg') && svg.trim().endsWith('</svg>'));
      assert.ok(svg.includes(`aria-label="${LEADERS[id].name}"`));
      assert.ok(svg.includes('id="leader-pin"'));
    }
  }
});

test('мимика: враждебный хмурится, друг улыбается, борода только у Ингвара', { skip }, async () => {
  const { renderLeaderSVG } = await import('./leaderFaces.js');
  assert.ok(renderLeaderSVG('cartel', { mood: 'hostile' }).includes('id="leader-frown"'));
  assert.ok(!renderLeaderSVG('cartel', { mood: 'friend' }).includes('id="leader-frown"'));
  assert.ok(renderLeaderSVG('cartel', { mood: 'friend' }).includes('data-viseme="encourage"'));
  assert.ok(renderLeaderSVG('borea').includes('id="leader-beard"'));
  assert.ok(!renderLeaderSVG('auris').includes('id="leader-beard"'));
});

test('рот поддерживает виземы для анимации речи', { skip }, async () => {
  const { renderLeaderSVG } = await import('./leaderFaces.js');
  assert.ok(renderLeaderSVG('meridian', { viseme: 'O' }).includes('data-viseme="O"'));
});
