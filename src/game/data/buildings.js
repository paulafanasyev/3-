// Постройки городов по эпохам (DESIGN.md §6.2).
export const BUILDINGS = Object.freeze({
  granary: { name: 'Амбар', era: 0, cost: 30, food: 2, tech: 'agriculture' },
  mine: { name: 'Шахта', era: 0, cost: 35, prod: 2, tech: 'bronze' },
  library: { name: 'Библиотека', era: 0, cost: 40, science: 3, tech: 'writing' },
  barracks: { name: 'Казармы', era: 0, cost: 30, veteran: true },
  port: { name: 'Порт', era: 0, cost: 40, gold: 2, food: 1, tech: 'seafaring', coastal: true },
  walls: { name: 'Стены', era: 0, cost: 35, defense: 0.5, tech: 'bronze' },
  factory: { name: 'Завод', era: 1, cost: 90, prodPct: 0.3, tech: 'electricity' },
  university: { name: 'Университет', era: 1, cost: 100, sciencePct: 0.3, tech: 'steam' },
  airfield: { name: 'Аэродром', era: 1, cost: 70, tech: 'flight' },
  research: { name: 'Исследовательский центр', era: 2, cost: 160, sciencePct: 0.4, tech: 'computers' },
  datacenter: { name: 'Сервер-кластер', era: 2, cost: 150, gold: 6, science: 4, tech: 'networks' },
  spaceport: { name: 'Космодром', era: 3, cost: 240, tech: 'satellites', maxLat: 35 },
  observatory: { name: 'Обсерватория дальнего космоса', era: 3, cost: 200, science: 8, tech: 'deepRadar' },
  ark: { name: 'Ковчег', era: 3, cost: 260, finale: 'ark' },
});

/** Скидка на запуск с космодрома ближе к экватору: до −30% на экваторе (§6.2). */
export function launchDiscount(lat) {
  return 0.3 * Math.max(0, 1 - Math.abs(lat) / 35);
}
