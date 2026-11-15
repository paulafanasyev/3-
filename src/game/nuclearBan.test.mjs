// Аудит запрета ядерных ударов по России и её городам. Данные собирает
// scripts/build-russia-mask.mjs, здесь проверяется то, что правило не врёт:
// ни один российский город каталога не должен пропускаться, ни один чужой —
// под запрет не попадать.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import territory from './data/russia-territory.json' with { type: 'json' };
import russianCities from './data/russia-cities.json' with { type: 'json' };
import populatedPlaces from './data/populated_places.json' with { type: 'json' };
import { inRussia, isRussianCity, nuclearBanFor, BANNED_NATION, NUKE_BAN_ERROR } from './nuclearBan.js';
import { loadMap } from './map.js';
import { createGame, addUnit, addCity } from './state.js';
import { applyCommand } from './commands.js';
import { isWater } from './data/terrain.js';
import { errorText } from './i18n/ru.js';
import { readSourceText } from '../../scripts/readSourceText.mjs';

const DEGREE_KM = 111.32;
const kmBetween = (latA, lonA, latB, lonB) => Math.hypot(
  (lonB - lonA) * Math.cos(((latA + latB) / 2) * (Math.PI / 180)) * DEGREE_KM,
  (latB - latA) * 110.57,
);

test('маска территории согласована со своим источником', () => {
  assert.equal(territory.polygons.length, territory.meta.polygons);
  assert.equal(territory.bounds.length, territory.polygons.length);
  assert.equal(territory.polygons.reduce((s, r) => s + r.length, 0), territory.meta.points);
  for (const [ring, bounds] of territory.polygons.map((ring, i) => [ring, territory.bounds[i]])) {
    // Контур замкнут неявно: сборщик снимает повторенную первую точку.
    assert.ok(ring.length >= 3, 'контур должен быть не из двух точек');
    assert.ok(ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1], 'последняя точка не должна повторять первую');
    for (const [lon, lat] of ring) {
      assert.ok(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180, `выбывшая координата ${lat},${lon}`);
      assert.ok(lon >= bounds[0] - 1e-9 && lon <= bounds[2] + 1e-9 && lat >= bounds[1] - 1e-9 && lat <= bounds[3] + 1e-9, 'точка вне своего оградывающего ящика');
    }
  }
});

test('ни один город каталога РФ не под запретом, ни один чужой — не чист', () => {
  const ruKeys = new Set(russianCities.cities.map(([name, lat, lon]) => `${name}|${lat}|${lon}`));
  assert.equal(russianCities.cities.length, russianCities.meta.cities);
  let russian = 0;
  const missed = [];
  const invaded = [];
  for (const row of populatedPlaces.places) {
    const mine = ruKeys.has(`${row[0]}|${row[1]}|${row[2]}`);
    const banned = Boolean(nuclearBanFor({ lat: row[1], lon: row[2] }, row));
    if (mine) {
      russian += 1;
      if (!banned) missed.push(`${row[0]} ${row[1]},${row[2]}`);
    } else if (banned) invaded.push(`${row[0]} ${row[1]},${row[2]}`);
    assert.equal(isRussianCity(row), mine, `признак города: ${row[0]}`);
  }
  assert.equal(russian, russianCities.cities.length, 'список городов должен покрываться каталогом');
  assert.deepEqual(missed, [], 'эти российские города маска пропустила');
  assert.deepEqual(invaded, [], 'эти чужие города маска затронула');
});

test('трудные места: города по строкам каталога, а не по памяти о координатах', () => {
  const rowOf = (name) => {
    const row = populatedPlaces.places.find((place) => place[0] === name);
    assert.ok(row, `нет строки каталога: ${name}`);
    return row;
  };
  // Эксклавы, острова, оба берега проливов и оба берега Амура — то, где
  // упрощённая маска обязана не подвести.
  const INSIDE = ['Moscow', 'Kaliningrad', 'Sevastopol', 'Sochi', 'Norilsk', 'Dudinka', 'Pevek',
    'Provideniya', 'Anadyr', 'Uelen', 'Bilibino', 'Magadan', 'Sovetskaya Gavan', 'Yuzhno Sakhalinsk',
    'Vladivostok', 'Murmansk', 'Bugrino', 'Kyzyl', 'Blagoveshchensk', 'Pskov'];
  const OUTSIDE = ['Narva', 'Heihe', 'Kyiv', 'Kharkiv', 'Minsk', 'Vilnius', 'Tallinn', 'Helsinki',
    'Warsaw', 'Oral', 'Tbilisi', 'Baku', 'Ulaanbaatar', 'Beijing', 'Tokyo', 'New York'];
  for (const name of INSIDE) {
    const row = rowOf(name);
    assert.equal(nuclearBanFor({ lat: row[1], lon: row[2] }, row), BANNED_NATION, `${name} должен быть под запретом`);
  }
  for (const name of OUTSIDE) {
    const row = rowOf(name);
    assert.equal(nuclearBanFor({ lat: row[1], lon: row[2] }, row), null, `${name} чист`);
  }
});

test('пары городов через границу не путаются по имени', () => {
  const russian = populatedPlaces.places.filter((row) => isRussianCity(row));
  const foreign = populatedPlaces.places.filter((row) => !isRussianCity(row));
  const twins = [];
  for (const mine of russian) {
    for (const other of foreign) {
      if (Math.abs(other[1] - mine[1]) > 0.15 || Math.abs(other[2] - mine[2]) > 0.15) continue;
      if (kmBetween(mine[1], mine[2], other[1], other[2]) <= 10) twins.push([mine, other]);
    }
  }
  assert.ok(twins.length >= 1, 'на границе должны лежать города-двойники');
  for (const [mine, other] of twins) {
    assert.equal(nuclearBanFor({ lat: other[1], lon: other[2] }, other), null, `двойник ${other[0]} рядом с ${mine[0]} не под запретом`);
    assert.equal(nuclearBanFor({ lat: mine[1], lon: mine[2] }, mine), BANNED_NATION, `${mine[0]} должен быть под запретом`);
  }
  // Замеренная пара: Амур разделяет Благовещенск и Хейхэ на сотни метров.
  const amur = twins.find(([, other]) => other[0] === 'Heihe');
  assert.ok(amur, 'Хейхэ и Благовещенск должны остаться в выборке двойников');
});

test('защитные круги городов не дотягиваются до чужой земли', () => {
  const discs = russianCities.cities.filter(([, , , radiusKm]) => radiusKm > 0);
  assert.equal(discs.length, russianCities.meta.discs);
  for (const [name, lat, lon, radiusKm] of discs) {
    for (const row of populatedPlaces.places) {
      if (isRussianCity(row)) continue;
      assert.ok(kmBetween(lat, lon, row[1], row[2]) > radiusKm, `круг ${name} накрыл ${row[0]}`);
    }
  }
});

test('в партии удар по российской клетке отбивается до проверок разведки и войны', () => {
  const map = loadMap();
  const russian = [...Array(map.size).keys()].find((cell) => !isWater(map.terrain[cell]) && inRussia(map.cells[cell]));
  assert.ok(russian !== undefined, 'на карте игры есть российская территория');
  const s = createGame({ seed: 5, setup: { player: 'borea' }, map });
  const free = (c) => !Object.values(s.cities).some((x) => x.cell === c) && !(s.unitsByCell[c] ?? []).length;
  const home = [...map.naCells].find((c) => !isWater(map.terrain[c]) && !inRussia(map.cells[c]) && free(c));
  const victim = addCity(s, map, 'auris', russian, 'Мишень', { pop: 9 });
  const launcher = addCity(s, map, 'borea', home, 'Северск', { capital: true, pop: 4 });
  launcher.buildings.push('silo');
  s.nations.borea.techs.push('fission');
  const icbm = addUnit(s, 'borea', 'icbm', home);
  assert.equal(applyCommand(s, 'borea', { kind: 'nuke', unitId: icbm.id, to: victim.cell }, map).error, NUKE_BAN_ERROR);
  s.explored.borea[victim.cell] = 1;
  assert.equal(applyCommand(s, 'borea', { kind: 'nuke', unitId: icbm.id, to: victim.cell }, map).error, NUKE_BAN_ERROR);
  assert.ok(s.units[icbm.id], 'боеголовка осталась в шахте');
  assert.deepEqual(s.nuclear?.strikes ?? [], [], 'ни следа пуска');
  assert.ok(!s.events.some((e) => String(e.key).startsWith('nuclear')), 'и событий о пуске');
});

test('отказ произносится вслух и остаётся правилом, а не намёком', () => {
  const text = errorText(NUKE_BAN_ERROR);
  assert.match(text, /Росси/);
  assert.ok(text.length > 10 && text.length < 160, `подпись слишком длинная: ${text.length}`);
  for (const slur of ['хохл', 'ibaniy', 'пидор', 'жид']) assert.ok(!text.toLocaleLowerCase().includes(slur), 'в отказе нет оскорблений по национальности');
  const source = readSourceText(fileURLToPath(new URL('./client/nuclear-range.js', import.meta.url)));
  for (const needle of ['nuclearBanFor', 'NUKE_BAN_ERROR']) assert.ok(source.includes(needle), `полигон не читает ${needle}`);
});
