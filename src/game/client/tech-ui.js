// Чистая модель дерева технологий для HUD.
import { ERAS, TECHS, TECHS_TO_ADVANCE } from '../data/techs.js';

export function technologyTree(snapshot) {
  const me = snapshot?.nations?.find((n) => n.id === snapshot.nationId) ?? {};
  const researched = new Set(me.techs ?? []);
  const available = new Set(snapshot?.choices?.techs ?? []);
  return {
    currentEra: Number(me.era ?? 0),
    currentResearch: me.research ?? null,
    advance: null, // Эпоха повышается сервером после четырёх изученных технологий.
    eras: ERAS.map((era) => {
      const items = Object.entries(TECHS).filter(([, tech]) => tech.era === era.id).map(([id, tech]) => ({
        id, name: tech.name, era: tech.era, req: [...tech.req],
        researched: researched.has(id), available: available.has(id),
        current: me.research === id,
        command: available.has(id) ? { kind: 'research', tech: id } : null,
      }));
      return {
        id: era.id, name: era.name, cost: era.cost,
        current: era.id === Number(me.era ?? 0),
        researched: items.filter((x) => x.researched).length,
        required: TECHS_TO_ADVANCE,
        techs: items,
      };
    }),
  };
}
