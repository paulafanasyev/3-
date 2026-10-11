// Геодезическая сетка: икосаэдр, подразбитый `level` раз. Вершины становятся
// ячейками игры (12 пятиугольных, остальные шестиугольные). Полностью
// детерминирована и не зависит от данных, поэтому её не храним в map.json,
// а пересчитываем при загрузке (~20 мс для level 5).
import { fromVector } from './geo.js';

export const GRID_LEVEL = 5;

export function cellCountForLevel(level) {
  return 10 * 4 ** level + 2;
}

function normalize([x, y, z]) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

function icosahedron() {
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalize);
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { vertices, faces };
}

/**
 * Строит сетку. Возвращает массивы координат ячеек (lat/lon, единичные векторы)
 * и списки соседей, отсортированные по возрастанию индекса.
 */
export function buildGrid(level = GRID_LEVEL) {
  let { vertices, faces } = icosahedron();
  for (let step = 0; step < level; step += 1) {
    const cache = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let index = cache.get(key);
      if (index === undefined) {
        const va = vertices[a];
        const vb = vertices[b];
        index = vertices.length;
        vertices.push(normalize([va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]]));
        cache.set(key, index);
      }
      return index;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const neighbors = vertices.map(() => new Set());
  for (const [a, b, c] of faces) {
    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
  }
  // Координаты в lat/lon (z = север). Округляем, чтобы JSON был стабилен.
  const cells = vertices.map((v) => {
    const { lat, lon } = fromVector(v);
    return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
  });
  return {
    level,
    cells,
    vectors: vertices,
    neighbors: neighbors.map((set) => [...set].sort((x, y) => x - y)),
    faces,
  };
}

/** Индекс ближайшей ячейки к точке (линейный поиск, для инструментов и тестов). */
export function nearestCell(grid, point) {
  const la = (point.lat * Math.PI) / 180;
  const lo = (point.lon * Math.PI) / 180;
  const p = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  let best = 0;
  let bestDot = -2;
  for (let i = 0; i < grid.vectors.length; i += 1) {
    const v = grid.vectors[i];
    const dot = v[0] * p[0] + v[1] * p[1] + v[2] * p[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}
