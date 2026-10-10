// Типы местности. Код — один символ в строке map.terrain (по ячейке).
// Доходы и модификаторы из docs/game/DESIGN.md §4.3.
export const TERRAIN = Object.freeze({
  O: { id: 'ocean', name: 'Океан', water: true, food: 1, prod: 0, gold: 0, move: 1, defense: 1 },
  S: { id: 'shelf', name: 'Шельф', water: true, food: 1, prod: 0, gold: 1, move: 1, defense: 1 },
  P: { id: 'plain', name: 'Равнина', water: false, food: 2, prod: 1, gold: 0, move: 1, defense: 1 },
  F: { id: 'forest', name: 'Лес', water: false, food: 1, prod: 2, gold: 0, move: 2, defense: 1.25 },
  D: { id: 'desert', name: 'Степь и пустыня', water: false, food: 0, prod: 1, gold: 0, move: 1, defense: 1 },
  T: { id: 'tundra', name: 'Тундра', water: false, food: 1, prod: 0, gold: 0, move: 1, defense: 1 },
  I: { id: 'ice', name: 'Ледник', water: false, food: 0, prod: 0, gold: 0, move: 3, defense: 1 },
  M: { id: 'mountain', name: 'Горы', water: false, food: 0, prod: 2, gold: 0, move: 3, defense: 1.5 },
});

export const LAND_CODES = Object.freeze(['P', 'F', 'D', 'T', 'I', 'M']);

export const isWater = (code) => code === 'O' || code === 'S';

/** Прибрежная суша даёт +1 еды (рыболовство) и позволяет строить порт. */
export const COAST_FOOD_BONUS = 1;

/** Стратегические ресурсы и вероятность появления на типе местности. */
export const STRATEGIC = Object.freeze({
  iron: { name: 'Железо', era: 0, weights: { M: 0.12, F: 0.05, P: 0.04, T: 0.03 } },
  oil: { name: 'Нефть', era: 1, weights: { D: 0.1, S: 0.03, T: 0.05, P: 0.015 } },
  silicon: { name: 'Кремний', era: 2, weights: { D: 0.07, P: 0.03, M: 0.03 } },
  rare: { name: 'Редкоземельные металлы', era: 3, weights: { T: 0.05, M: 0.05, D: 0.02 } },
});

/** Множитель вероятности редкоземельных металлов в Северной Америке (§6.1). */
export const RARE_IN_NORTH_AMERICA = 0.2;
