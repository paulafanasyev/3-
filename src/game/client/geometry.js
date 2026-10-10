// Геометрия игровой сетки для клиента: контуры ячеек, рёбра границ, поиск ячейки по точке.
// Чистый модуль без Cesium: работает и в браузере, и в тестах под Node.
import { buildGrid, GRID_LEVEL } from '../grid.js';

const DEG = 180 / Math.PI;
const toLatLon = ([x, y, z]) => {
  const l = Math.hypot(x, y, z);
  return { lat: Math.asin(z / l) * DEG, lon: Math.atan2(y, x) * DEG };
};

/**
 * Готовит сетку: для каждой ячейки — центр и упорядоченный контур из центров
 * прилегающих треугольников, для каждого ребра — сосед за ним.
 */
export function createCellGeometry(level = GRID_LEVEL) {
  const grid = buildGrid(level);
  const { vectors, faces } = grid;
  const centroid = faces.map(([a, b, c]) => {
    const v = [0, 1, 2].map((k) => vectors[a][k] + vectors[b][k] + vectors[c][k]);
    return toLatLon(v);
  });
  const facesOf = vectors.map(() => []);
  faces.forEach((f, i) => { for (const v of f) facesOf[v].push(i); });
  // упорядочиваем треугольники вокруг вершины по углу в касательной плоскости
  const rings = vectors.map((c, i) => {
    const ref = Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const e1 = cross(ref, c); const e2 = cross(c, e1);
    const angle = (fi) => {
      const [a, b, d] = faces[fi];
      const v = [0, 1, 2].map((k) => vectors[a][k] + vectors[b][k] + vectors[d][k]);
      return Math.atan2(dot(v, e2), dot(v, e1));
    };
    const ordered = [...facesOf[i]].sort((x, y) => angle(x) - angle(y));
    // ребро между соседними треугольниками k и k+1 отделяет ячейку от общей вершины этих треугольников
    const edges = ordered.map((fa, k) => {
      const fb = ordered[(k + 1) % ordered.length];
      const shared = faces[fa].filter((v) => v !== i && faces[fb].includes(v))[0];
      return { a: centroid[fa], b: centroid[fb], neighbor: shared };
    });
    return { points: ordered.map((f) => centroid[f]), edges };
  });
  return {
    size: vectors.length,
    cells: grid.cells,
    neighbors: grid.neighbors,
    rings,
    nearest(lat, lon) {
      const la = lat / DEG; const lo = lon / DEG;
      const p = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
      let best = 0; let bestDot = -2;
      for (let i = 0; i < vectors.length; i += 1) {
        const v = vectors[i];
        const d = v[0] * p[0] + v[1] * p[1] + v[2] * p[2];
        if (d > bestDot) { bestDot = d; best = i; }
      }
      return best;
    },
  };
}

/** Рёбра, по которым проходит граница владельца `owner` (сосед — другой владелец или ничей). */
export function borderEdges(geometry, ownerOf, owner) {
  const out = [];
  for (let i = 0; i < geometry.size; i += 1) {
    if (ownerOf[i] !== owner) continue;
    for (const e of geometry.rings[i].edges) if (ownerOf[e.neighbor] !== owner) out.push([e.a, e.b]);
  }
  return out;
}

/**
 * Склеивает отрезки границы в ломаные: так Cesium рисует сотню линий вместо тысяч.
 * Отрезки с общими концами соединяются; ключ конца округлён до 1e-6°.
 */
export function chainSegments(segments) {
  const key = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const byStart = new Map();
  for (const s of segments) {
    const k = key(s[0]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(s);
  }
  const used = new Set();
  const lines = [];
  for (const s of segments) {
    if (used.has(s)) continue;
    used.add(s);
    const line = [s[0], s[1]];
    for (;;) {
      const next = (byStart.get(key(line[line.length - 1])) ?? []).find((x) => !used.has(x));
      if (!next) break;
      used.add(next);
      line.push(next[1]);
    }
    lines.push(line);
  }
  return lines;
}

/** Ячейка пересекает антимеридиан: такие контуры рисуем, сдвинув долготы в один диапазон. */
export function unwrapRing(points) {
  const lon0 = points[0].lon;
  return points.map((p) => {
    let { lon } = p;
    while (lon - lon0 > 180) lon -= 360;
    while (lon - lon0 < -180) lon += 360;
    return { lat: p.lat, lon };
  });
}
