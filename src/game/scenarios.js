// Готовые ситуации для проверок в браузере (только dev-сервер, KUPOL_SCENARIO=...).
// Меняют свежую партию до первого снимка; в обычной игре и в server.js не используются.
import { addUnit } from './state.js';
import { pairKey } from './rules.js';

/**
 * «battle»: у игрока танк с ходами, рядом на равнине — воин нации, с которой объявлена война.
 * Нужен, чтобы дымовая проверка могла открыть тактический бой без поиска врага по карте.
 * Возвращает { unitId, to } или null, если подходящей пары клеток не нашлось.
 */
export function battleScenario(game, map) {
  const me = game.player;
  const enemy = Object.keys(game.nations).find((id) => id !== me);
  if (!enemy) return null;
  const free = (c) => !game.cityAt[c] && !game.owner[c] && !game.unitsByCell[c]?.length && map.terrain[c] === 'P';
  for (let c = 0; c < game.owner.length; c += 1) {
    if (!free(c)) continue;
    const d = map.neighbors[c].find(free);
    if (d === undefined) continue;
    const key = pairKey(me, enemy);
    if (!game.wars.includes(key)) game.wars.push(key);
    const tank = addUnit(game, me, 'tank', c); tank.moves = 3;
    addUnit(game, enemy, 'warrior', d);
    return { unitId: tank.id, to: d };
  }
  return null;
}

export const SCENARIOS = Object.freeze({ battle: battleScenario });
