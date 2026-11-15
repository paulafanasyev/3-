// Проверка офлайн-каталога городов: пять целей из God's Eye View должны быть в
// данных игры с теми же координатами, что берёт съёмочный скрипт.
import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(new URL('../src/game/data/populated_places.json', import.meta.url), 'utf8'));
const raw = Array.isArray(d) ? d : (d.places || d.default || []);
// Файл — массив кортежей [имя, широта, долгота, ?, класс], а не объектов.
const arr = raw.map((r) => (Array.isArray(r)
  ? { name: r[0], lat: r[1], lon: r[2], pop: r[3], cls: r[4] } : r));
console.log('всего записей', arr.length, '| пример:', JSON.stringify(arr[0]));
const HARNESS = {
  London: [51.502, -0.119], Paris: [48.857, 2.352], Berlin: [52.52, 13.405],
  Washington: [38.907, -77.037], 'New York': [40.713, -74.005],
};
for (const [nm, [lat, lon]] of Object.entries(HARNESS)) {
  const hits = arr.filter((p) => String(p.name).toLowerCase() === nm.toLowerCase());
  const w = hits.map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}/${p.pop ?? '?'}/кл${p.cls ?? '?'}`);
  const near = hits.some((p) => Math.abs(p.lat - lat) < 0.2 && Math.abs(p.lon - lon) < 0.2);
  console.log(`${nm}: каталог ${w.length ? w.join(' | ') : 'НЕТ'} — съёмочная точка ${lat},${lon} ${near ? 'СОВПАДАЕТ' : 'НЕ в каталоге'}`);
}
// «Washington» точным именем не находится: ищем, как город записан в источнике.
for (const hint of ['washington', 'baltimore', '.dc']) {
  const hits = arr.filter((p) => String(p.name).toLowerCase().includes(hint)).slice(0, 6);
  console.log(`подсказка «${hint}»: ${hits.map((p) => `${p.name} ${p.lat},${p.lon}`).join(' | ') || 'нет'}`);
}

