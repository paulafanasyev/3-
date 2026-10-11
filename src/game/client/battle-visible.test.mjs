import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// Карта «Купола» прячет все слои body, кроме своих. Окно тактического боя (.kb-root) тоже
// добавляется прямо в body, поэтому обязано быть в списке исключений, иначе бой идёт невидимым.
test('стили карты не прячут окно тактического боя', () => {
  const css = readFileSync(new URL('./hud.css', import.meta.url), 'utf8');
  const rule = css.split('\n').find((line) => line.startsWith('body.kupol > *:not('));
  assert.ok(rule, 'нет правила, скрывающего чужие слои');
  assert.match(rule, /:not\(\.kb-root\)/);
  const battle = readFileSync(new URL('./battle/hud.js', import.meta.url), 'utf8');
  assert.match(battle, /root\.className = 'kb-root'/);
  assert.match(battle, /document\.body\.appendChild\(root\)/);
});
