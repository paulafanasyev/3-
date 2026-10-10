// Генератор вымышленных имён. Детерминированный: одинаковый rng даёт одинаковые
// имена. Шесть «культурных кругов» со своими слогами, чтобы названия одного
// народа звучали похоже, а разных народов различались.
import { nextRandom, randomInt } from './rng.js';

export const CULTURES = Object.freeze({
  northern: {
    start: ['Вель', 'Тор', 'Ска', 'Хель', 'Ир', 'Сва', 'Ольм', 'Брен', 'Ур', 'Кьяр', 'Лод', 'Ферн'],
    middle: ['ге', 'ва', 'ри', 'мо', 'ла', 'де', 'на', 'се'],
    end: ['хейм', 'вик', 'гард', 'мар', 'дал', 'стад', 'ун', 'ольд'],
  },
  coastal: {
    start: ['Мар', 'Ла', 'Ори', 'Сал', 'Ве', 'Пел', 'Ами', 'Кор', 'Тара', 'Эло', 'Мен', 'Сира'],
    middle: ['ре', 'ли', 'ва', 'но', 'ти', 'са', 'ле', 'ми'],
    end: ['ента', 'рис', 'ола', 'ено', 'ия', 'ара', 'ель', 'ис'],
  },
  steppe: {
    start: ['Кар', 'Ту', 'Ас', 'Бай', 'Ер', 'Ок', 'Жан', 'Сар', 'Тем', 'Ул', 'Кеш', 'Аян'],
    middle: ['ба', 'ты', 'ке', 'ры', 'мы', 'са', 'ду', 'ла'],
    end: ['тау', 'кент', 'бек', 'гуз', 'ар', 'тым', 'ан', 'ул'],
  },
  desert: {
    start: ['Заф', 'Ке', 'Ам', 'Сах', 'Ну', 'Иш', 'Тал', 'Хар', 'Ме', 'Дже', 'Ра', 'Ус'],
    middle: ['ра', 'ши', 'да', 'фи', 'ну', 'ха', 'зи', 'ма'],
    end: ['ир', 'ах', 'ум', 'ет', 'ад', 'ина', 'ар', 'ус'],
  },
  island: {
    start: ['Ка', 'Мо', 'Ло', 'Ва', 'Ту', 'Хи', 'Пе', 'На', 'Ако', 'Уле', 'Ри', 'Оли'],
    middle: ['ла', 'ну', 'ке', 'по', 'ма', 'хи', 'ва', 'то'],
    end: ['ани', 'ура', 'ики', 'ода', 'ема', 'ау', 'ило', 'ене'],
  },
  highland: {
    start: ['Ан', 'Кеч', 'Ил', 'Том', 'Пак', 'Ури', 'Кан', 'Йан', 'Ма', 'Ти', 'Хуа', 'Кос'],
    middle: ['ри', 'ка', 'та', 'лу', 'пу', 'ки', 'ну', 'ча'],
    end: ['ко', 'ямо', 'пак', 'ука', 'ан', 'ина', 'аль', 'те'],
  },
});

const VOWELS = 'аеёиоуыэюя';

/**
 * Неудобочитаемые сочетания: три гласные подряд, повтор слога («арар»),
 * скопления согласных, «ль» перед согласной в середине, слишком длинные имена.
 */
export function awkwardName(name) {
  const s = name.toLowerCase();
  if (s.length > 11) return true;
  // смысловые стоп-корни: оскорбления и опасные ассоциации
  if (/сваст|лох|хуй|хуе|пизд|бля|жоп|срак|говн|сран|дерьм|нацис|квебек/.test(s)) return true;
  if (new RegExp(`[${VOWELS}]{3}`).test(s)) return true;
  if (new RegExp(`^[${VOWELS}]{2}`).test(s)) return true;
  if (/(..+)\1/.test(s)) return true; // повтор слога: «арар», «тиетие»
  if (/([аеоуыэи])\1/.test(s)) return true; // двойная гласная: «ее», «ии»
  if (new RegExp(`[^${VOWELS}ьй]{4}`).test(s)) return true;
  if (new RegExp(`ль[^${VOWELS}]`).test(s.slice(1, -1))) return true;
  return false;
}

/** Нормализация для сравнения: регистр, ё/й, дефисы и пробелы. */
export function normalizeName(s) {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/й/g, 'и').replace(/[\s\-']/g, '');
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Проверка «слишком похоже на реальное название». Стоп-список используется только
 * для того, чтобы ИЗБЕГАТЬ реальных имён; источником данных он не служит.
 */
export function createRealNameGuard(stopList = []) {
  const real = stopList.map(normalizeName).filter((r) => /[а-я]/.test(r) && r.length >= 4);
  const exact = new Set(real);
  return (name) => {
    const x = normalizeName(name);
    if (exact.has(x)) return true;
    if (x.length < 5) return false;
    return real.some((r) => Math.abs(r.length - x.length) <= 1 && levenshtein(x, r) <= 1);
  };
}

const PROVINCE_SUFFIX = ['ия', 'ь', 'ия', 'ея', 'ания', 'ар'];

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Одно имя заданного культурного круга. */
export function makeName(state, culture, { syllables } = {}) {
  const set = CULTURES[culture] ?? CULTURES.coastal;
  const count = syllables ?? (nextRandom(state) < 0.55 ? 0 : 1);
  let word = set.start[randomInt(state, set.start.length)];
  for (let i = 0; i < count; i += 1) word += set.middle[randomInt(state, set.middle.length)];
  word += set.end[randomInt(state, set.end.length)];
  return capitalize(word);
}

/** Имя народа/провинции: базовое имя + «земельный» суффикс иногда. */
export function makeRegionName(state, culture) {
  const base = makeName(state, culture);
  if (nextRandom(state) < 0.35) {
    const suffix = PROVINCE_SUFFIX[randomInt(state, PROVINCE_SUFFIX.length)];
    const stem = base.replace(/[аеёиоуыэюяь]+$/u, '');
    if (stem.length >= 3) return capitalize(stem + suffix);
  }
  return base;
}

/**
 * Фабрика уникальных имён. `forbidden` можно передать в тестах, чтобы
 * гарантировать отсутствие совпадений с реальными названиями.
 */
export function createNamer(state, { forbidden = new Set(), tooReal = () => false } = {}) {
  const used = new Set();
  const lower = (s) => s.toLowerCase();
  const take = (generate) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const name = generate();
      const key = lower(name);
      if (name.length < 3 || awkwardName(name) || used.has(key) || forbidden.has(key) || tooReal(name)) continue;
      used.add(key);
      return name;
    }
    throw new Error('Не удалось подобрать уникальное имя');
  };
  return {
    city: (culture) => take(() => makeName(state, culture)),
    region: (culture) => take(() => makeRegionName(state, culture)),
    used,
  };
}
