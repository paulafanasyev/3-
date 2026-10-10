// Юниты (DESIGN.md §8). domain: land | sea | air | space.
// model: файл из public/models или null (фишка с гербом / процедурная графика).
export const UNITS = Object.freeze({
  settler: { name: 'Поселенец', era: 0, cost: 30, str: 0, moves: 2, domain: 'land', civilian: true, model: null },
  warrior: { name: 'Воин', era: 0, cost: 15, str: 6, moves: 2, domain: 'land', model: null },
  archer: { name: 'Лучник', era: 0, cost: 20, str: 8, moves: 2, domain: 'land', tech: 'bronze', model: null },
  swordsman: { name: 'Мечник', era: 0, cost: 25, str: 10, moves: 2, domain: 'land', tech: 'iron', resource: 'iron', model: null },
  galley: { name: 'Галера', era: 0, cost: 25, str: 6, moves: 3, domain: 'sea', tech: 'seafaring', model: 'ship.glb' },
  infantry: { name: 'Пехота', era: 1, cost: 45, str: 20, moves: 2, domain: 'land', tech: 'steam', model: null },
  artillery: { name: 'Артиллерия', era: 1, cost: 55, str: 24, moves: 2, domain: 'land', tech: 'steel', model: null },
  tank: { name: 'Танк', era: 1, cost: 80, str: 36, moves: 3, domain: 'land', tech: 'massProduction', resource: 'oil', model: null },
  ironclad: { name: 'Броненосец', era: 1, cost: 70, str: 30, moves: 5, domain: 'sea', tech: 'steel', model: 'ship.glb' },
  biplane: { name: 'Биплан-разведчик', era: 1, cost: 50, str: 12, moves: 6, domain: 'air', tech: 'flight', model: 'c172.glb' },
  fighter: { name: 'Истребитель', era: 2, cost: 110, str: 50, moves: 10, domain: 'air', tech: 'jet', resource: 'oil', model: 'jet.glb' },
  drone: { name: 'Ударный беспилотник', era: 2, cost: 100, str: 40, moves: 12, domain: 'air', tech: 'drones', resource: 'silicon', model: 'mq9.glb' },
  helicopter: { name: 'Вертолёт', era: 2, cost: 90, str: 35, moves: 6, domain: 'air', tech: 'radio', model: 'bell206.glb' },
  recon: { name: 'Самолёт-разведчик', era: 2, cost: 70, str: 0, moves: 14, domain: 'air', tech: 'computers', civilian: true, sight: 4, model: 'citation2.glb' },
  satellite: { name: 'Спутник', era: 3, cost: 150, str: 0, moves: 0, domain: 'space', tech: 'satellites', resource: 'silicon', civilian: true, needs: 'spaceport', model: null },
  interceptor: { name: 'Перехватчик', era: 3, cost: 220, str: 0, moves: 0, domain: 'space', tech: 'kinetic', resource: 'rare', civilian: true, needs: 'spaceport', model: null },
});

/** Опыт: каждая победа даёт +10% силы, максимум +30%. */
export const VETERAN_STEP = 0.1;
export const VETERAN_MAX = 3;
