// Дерево технологий: 4 эпохи, в каждой 6–7 технологий (DESIGN.md §7; «Ядерное деление» — седьмая в эпохе 2).
export const ERAS = Object.freeze([
  { id: 0, name: 'Древность', cost: 130 },
  { id: 1, name: 'Индустрия', cost: 740 },
  { id: 2, name: 'Информационная эпоха', cost: 2650 },
  { id: 3, name: 'Космическая эпоха', cost: 5000 },
]);

/** Сколько технологий эпохи нужно знать, чтобы открылась следующая. */
export const TECHS_TO_ADVANCE = 4;

export const TECHS = Object.freeze({
  agriculture: { era: 0, name: 'Земледелие', req: [] },
  bronze: { era: 0, name: 'Обработка бронзы', req: [] },
  iron: { era: 0, name: 'Железо', req: ['bronze'] },
  writing: { era: 0, name: 'Письменность', req: [] },
  seafaring: { era: 0, name: 'Мореходство', req: [] },
  wheel: { era: 0, name: 'Колесо', req: ['agriculture'] },
  steam: { era: 1, name: 'Паровой двигатель', req: [] },
  steel: { era: 1, name: 'Сталь', req: ['iron'] },
  electricity: { era: 1, name: 'Электричество', req: [] },
  oilDrilling: { era: 1, name: 'Нефтедобыча', req: ['steam'] },
  flight: { era: 1, name: 'Воздухоплавание', req: ['steam'] },
  massProduction: { era: 1, name: 'Массовое производство', req: ['electricity'] },
  radio: { era: 2, name: 'Радиоэлектроника', req: [] },
  jet: { era: 2, name: 'Реактивный двигатель', req: ['flight'] },
  computers: { era: 2, name: 'ЭВМ', req: ['radio'] },
  drones: { era: 2, name: 'Беспилотники', req: ['computers'] },
  networks: { era: 2, name: 'Глобальные сети', req: ['computers'] },
  rocketry: { era: 2, name: 'Ракетостроение', req: ['jet'] },
  fission: { era: 2, name: 'Ядерное деление', req: ['rocketry'] },
  satellites: { era: 3, name: 'Орбитальные спутники', req: ['rocketry'] },
  heavyLift: { era: 3, name: 'Тяжёлые носители', req: ['rocketry'] },
  deepRadar: { era: 3, name: 'Радар дальнего космоса', req: ['satellites', 'heavyLift'] },
  kinetic: { era: 3, name: 'Кинетический перехват', req: ['heavyLift'] },
  fusion: { era: 3, name: 'Термоядерные двигатели', req: ['heavyLift'] },
  shield: { era: 3, name: 'Планетарный щит', req: ['kinetic', 'deepRadar'] },
});

/** Скидка за каждую нацию, уже знающую технологию (§7). */
export const CATCH_UP_DISCOUNT = 0.1;
