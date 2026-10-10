import assert from 'node:assert/strict';
import test from 'node:test';
import { createCellGeometry, borderEdges, chainSegments } from './geometry.js';

const geo = createCellGeometry();

test('клиентская сетка: у каждой ячейки 5 или 6 вершин, рёбра ведут к соседям', () => {
  assert.equal(geo.size, 10242);
  for (let i = 0; i < geo.size; i += 97) {
    const r = geo.rings[i];
    assert.ok(r.points.length === 5 || r.points.length === 6);
    assert.deepEqual(r.edges.map((e) => e.neighbor).sort((a, b) => a - b), geo.neighbors[i]);
  }
});

test('поиск ячейки по точке и граница одной ячейки', () => {
  const c = geo.cells[1234];
  assert.equal(geo.nearest(c.lat, c.lon), 1234);
  const owner = new Array(geo.size).fill(null); owner[1234] = 'borea';
  const edges = borderEdges(geo, owner, 'borea');
  assert.equal(edges.length, geo.rings[1234].points.length);
  const lines = chainSegments(edges);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, edges.length + 1);
});
