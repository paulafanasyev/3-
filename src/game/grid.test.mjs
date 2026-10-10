import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGrid, cellCountForLevel, nearestCell } from './grid.js';

test('сетка уровня 5: 10 242 ячейки, 12 пятиугольников, симметричное соседство', () => {
  const g = buildGrid(5);
  assert.equal(g.cells.length, cellCountForLevel(5));
  assert.equal(g.cells.length, 10242);
  assert.equal(g.neighbors.filter((n) => n.length === 5).length, 12);
  assert.ok(g.neighbors.every((n) => n.length === 5 || n.length === 6));
  g.neighbors.forEach((list, i) => list.forEach((j) => assert.ok(g.neighbors[j].includes(i))));
});

test('сетка детерминирована и ближайшая ячейка находится корректно', () => {
  const a = buildGrid(3);
  const b = buildGrid(3);
  assert.deepEqual(a.cells, b.cells);
  const i = nearestCell(a, a.cells[17]);
  assert.equal(i, 17);
});
