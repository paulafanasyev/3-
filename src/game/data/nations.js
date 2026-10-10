// Стартовые нации и доктрины (DESIGN.md §5).
export const DOCTRINES = Object.freeze({
  resilience: { name: 'Стойкость', tundraFood: 1, cityDefense: 0.25, domeBonus: 0.5 },
  trade: { name: 'Торговля', goldPct: 0.2, tradeRoutes: 1, domeBonus: 0.1 },
  diplomacy: { name: 'Дипломатия', treatyDiscount: 0.5, influence: 2, domeBonus: 0.2 },
  science: { name: 'Наука', sciencePct: 0.15, spaceDiscount: 0.1, domeBonus: 0.35 },
  expansion: { name: 'Экспансия', settlerDiscount: 0.25 },
});

export const NATIONS = Object.freeze([
  {
    id: 'borea', name: 'Борея', color: '#7FB2D9', zone: 'north', doctrine: 'resilience',
    emblem: { shield: 'heater', figure: 'star-over-mountain', field: '#24364a' },
    ai: { aggression: 0.35, loyalty: 0.9, coop: 0.7, focus: 'defense' },
  },
  {
    id: 'cartel', name: 'Новый Картель', color: '#D9A441', zone: 'atlantic', doctrine: 'trade',
    emblem: { shield: 'round', figure: 'scales-gear', field: '#3a2c12' },
    ai: { aggression: 0.5, loyalty: 0.4, coop: 0.45, focus: 'economy' },
  },
  {
    id: 'meridian', name: 'Лига Меридиана', color: '#4CB39A', zone: 'pacific', doctrine: 'diplomacy',
    emblem: { shield: 'kite', figure: 'compass-meridian', field: '#123a32' },
    ai: { aggression: 0.2, loyalty: 0.8, coop: 0.9, focus: 'diplomacy' },
  },
  {
    id: 'auris', name: 'Республика Аурис', color: '#C8574D', zone: 'south', doctrine: 'science',
    emblem: { shield: 'swiss', figure: 'sun-orbit', field: '#3d1714' },
    ai: { aggression: 0.4, loyalty: 0.6, coop: 0.6, focus: 'science' },
  },
]);

/** Ограничения конструктора своей нации (§5.2). */
export const CUSTOM_NATION_RULES = Object.freeze({
  nameMin: 2,
  nameMax: 24,
  shields: ['heater', 'round', 'kite', 'swiss', 'french', 'lozenge'],
  figures: ['star-over-mountain', 'scales-gear', 'compass-meridian', 'sun-orbit', 'wolf', 'anchor', 'tower', 'wave', 'eagle', 'tree', 'crown', 'rocket'],
  palette: ['#7FB2D9', '#D9A441', '#4CB39A', '#C8574D', '#9B7FD9', '#D97FB0', '#7FD98C', '#D9D27F', '#5A8FD9', '#D98A5A', '#A0A8B8', '#E0E0E0'],
});
