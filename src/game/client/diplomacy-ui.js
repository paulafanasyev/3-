// Модель дипломатических кнопок. Это подсказка интерфейсу, а не замена
// серверной проверке: каждая команда всё равно отправляется на сервер.
import { TREATY_NAMES } from '../i18n/ru.js';
import { DOCTRINES } from '../data/nations.js';

export const TREATY_TYPES = ['trade', 'nap', 'research', 'alliance'];
export const SPY_OPS = Object.freeze({
  stealTech: { label: 'Украсть технологию', influence: 25, gold: 40 },
  sabotage: { label: 'Саботаж', influence: 20, gold: 30 },
  incite: { label: 'Подстрекательство', influence: 15, gold: 40 },
  falseFlag: { label: 'Чужой флаг', influence: 35, gold: 50 },
  smear: { label: 'Очернение', influence: 15, gold: 20 },
});

const treatyPair = (t, me, target) => t && t.a !== t.b &&
  ((t.a === me && t.b === target) || (t.a === target && t.b === me));
const atWar = (snapshot, me, target) => (snapshot.wars ?? []).some((key) => key.split('|').includes(me) && key.split('|').includes(target));
const reason = (enabled, why = '') => ({ enabled, reason: enabled ? '' : why });

/**
 * Возвращает все действия, которые имеет смысл показать для цели.
 * Поля payload уже имеют форму net.command({ ... });.
 */
export function diplomacyActions(snapshot, targetId) {
  const me = snapshot?.nations?.find((n) => n.id === snapshot.nationId);
  const target = snapshot?.nations?.find((n) => n.id === targetId)
    ?? snapshot?.neutrals?.find((n) => n.id === targetId);
  if (!me || !target || target.id === me.id) return [];
  const major = Boolean(snapshot.nations?.some((n) => n.id === targetId));
  const met = target.met !== false && (major ? me.met?.includes(targetId) !== false : true);
  const war = atWar(snapshot, me.id, targetId);
  const treaties = (snapshot.treaties ?? []).filter((t) => treatyPair(t, me.id, targetId));
  const influence = Number(me.influence ?? 0);
  const gold = Number(me.gold ?? 0);
  const out = [];
  const add = (label, payload, extra = {}) => out.push({ label, payload, ...extra });

  for (const treaty of treaties) {
    add(`Расторгнуть: ${TREATY_NAMES[treaty.type] ?? treaty.type}`,
      { kind: 'cancelTreaty', target: targetId, treaty: treaty.type }, {
        action: 'cancelTreaty', treaty: treaty.type, title: 'Расторжение ухудшит отношения и репутацию.', ...reason(true),
      });
  }
  if (!met) {
    add('Подарок', { kind: 'gift', target: targetId, gold: 10 }, { action: 'gift', ...reason(false, 'Сначала нужно встретиться с нацией.') });
    return out;
  }

  const giftEnabled = gold >= 1;
  add('Подарить золото', { kind: 'gift', target: targetId, gold: 10 }, {
    action: 'gift', input: 'gold', title: 'Улучшает отношения; золото уйдёт цели.', ...reason(giftEnabled, 'Недостаточно золота.'),
  });

  if (major) {
    for (const type of TREATY_TYPES) {
      const existing = treaties.some((t) => t.type === type);
      if (!existing && !war) {
        const baseCosts = { trade: 5, nap: 5, research: 10, alliance: 15 };
        const discount = DOCTRINES[me.doctrine]?.treatyDiscount ?? 0;
        const costs = Math.round(baseCosts[type] * (1 - discount));
        const enough = influence >= costs;
        const name = TREATY_NAMES[type] ?? type;
        add(name.charAt(0).toUpperCase() + name.slice(1), { kind: 'propose', target: targetId, treaty: type }, {
          action: 'propose', treaty: type, title: `Цена: ${costs} влияния.`, ...reason(enough, 'Недостаточно влияния.'),
        });
      }
    }
    const negotiationEnabled = !war ? gold >= 1 : true;
    add('Предложить сделку', { kind: 'negotiate', target: targetId, deal: { give: { gold: 10 }, take: {} } }, {
      action: 'negotiate', input: 'gold', title: 'Предложите золото в обмен на условия; сервер оценит сделку.', ...reason(negotiationEnabled, 'Для сделки нужно золото.'),
    });
    const demandBlocked = treaties.some((t) => t.type === 'nap' || t.type === 'alliance') ? 'Нельзя требовать во время пакта или союза.'
      : war ? 'Ультиматум невозможен во время войны.' : '';
    const demandEnabled = !demandBlocked;
    add('Ультиматум', { kind: 'demand', target: targetId, take: { gold: 10 } }, {
      action: 'demand', input: 'gold', title: 'Требует золото; отказ испортит отношения и создаст угрозу войны.', ...reason(demandEnabled, demandBlocked),
    });
    const lastOp = Number(me.lastOpTurn ?? -99);
    const busy = lastOp + 3 > Number(snapshot.turn ?? 0);
    for (const [op, def] of Object.entries(SPY_OPS)) {
      let third = null; let blocked = '';
      if (op === 'falseFlag') third = snapshot.nations.find((n) => n.id !== me.id && n.id !== targetId && n.met !== false)?.id ?? null;
      if (op === 'incite') third = snapshot.neutrals?.find((n) => n.alive)?.id ?? null;
      if (op === 'falseFlag' && !third) blocked = 'Нужна третья знакомая нация.';
      if (op === 'incite' && !third) blocked = 'Нет доступного нейтрального народа.';
      if (busy) blocked = 'Агенты ещё заняты.';
      if (influence < def.influence) blocked = 'Недостаточно влияния.';
      else if (gold < def.gold) blocked = 'Недостаточно золота.';
      const chances = target.intrigue?.[op];
      const chance = chances ? `Успех ${chances.success}%, раскрытие ${chances.exposure}%.` : `Цена: ${def.influence} влияния и ${def.gold} золота.`;
      add(def.label, { kind: 'spy', op, target: targetId, ...(third ? { third } : {}) }, {
        action: 'spy', op, title: `${chance} Рискованная тайная операция.`, ...reason(!blocked, blocked),
      });
    }
  } else if (target.alive) {
    const knownCities = (snapshot.cities ?? []).filter((c) => c.owner === targetId);
    const cost = Math.round((50 + 40 * knownCities.length) * (1 + (snapshot.cities ?? []).filter((c) => c.owner === me.id).length / 12));
    const enabled = Number(target.relation ?? 0) >= 60 && influence >= cost;
    add('Присоединить народ', { kind: 'annex', target: targetId }, {
      action: 'annex', title: `Нужно отношение 60 и около ${cost} влияния.`, ...reason(enabled, Number(target.relation ?? 0) < 60 ? 'Отношение ниже 60.' : 'Недостаточно влияния.'),
    });
  }
  return out;
}
