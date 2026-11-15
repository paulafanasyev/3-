// Позорный экран: герб + гимн + бан ядерных сил до перезапуска страницы.
// Проверяем то, что нельзя замерить без браузера: формат и провенанс ассетов,
// честность текстов и что замок висит именно на перезагрузке, а не на кнопке.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { SHAME, errorText } from '../i18n/ru.js';
import { ANTHEM_SRC, EMBLEM_SRC, SHAME_EVENT } from './shame.js';
import stateAssets from '../data/state-assets.json' with { type: 'json' };

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const shameSource = read('./shame.js');
const rangeSource = read('./nuclear-range.js');
const bootSource = read('./boot.js');
const byPath = new Map(stateAssets.assets.map((asset) => [asset.path, asset]));

test('emblem and anthem are public domain and byte-for-byte what the provenance file measured', async () => {
  for (const [src, relative] of [
    [EMBLEM_SRC, 'public/game/state/emblem-russia.svg'],
    [ANTHEM_SRC, 'public/audio/state/anthem-russia-instrumental.ogg'],
  ]) {
    const asset = byPath.get(relative);
    assert.ok(asset, `${relative} отсутствует в src/game/data/state-assets.json`);
    assert.equal(asset.license, 'Public domain', `${relative}: лицензия не общественная`);
    const file = await stat(new URL(`../../../${relative}`, import.meta.url));
    assert.equal(file.size, asset.bytes, `${relative}: размер на диске разошёлся с провенансом (${file.size} ≠ ${asset.bytes})`);
    assert.equal(src, `/${relative.replace(/^public\//, '')}`, `${relative}: путь в shame.js не совпадает с провенансом`);
  }
  const svg = readFileSync(new URL(`../../../public${EMBLEM_SRC}`, import.meta.url), 'utf8');
  // Вектор, а не HTML-страница ошибки: герб обязан пережить офлайн-запуск.
  assert.match(svg, /<svg[\s>]/);
  assert.ok(!/<html/i.test(svg), 'emblem file is an HTML page, not a vector');
  const bytes = readFileSync(new URL(`../../../public${ANTHEM_SRC}`, import.meta.url));
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'OggS', 'anthem is not an Ogg container');
  assert.equal(bytes.subarray(28, 36).toString('latin1'), 'OpusHead', 'anthem is not Opus');
  // Длительность — замер ffprobe, а не обещание из описания: гимн обязан доиграть,
  // а не оборваться (Vorbis-мастер без нормального заголовка браузер читал как 51 с).
  const duration = byPath.get('public/audio/state/anthem-russia-instrumental.ogg').duration_s;
  assert.ok(duration > 60 && duration < 120, `гимн: ${duration} с — это не полный проигрыш`);
});


test('the shame copy is complete and actually shames the player, not a people', () => {
  for (const key of ['title', 'body', 'lock', 'targetLabel', 'targetUnknown', 'reload', 'mute', 'unmute', 'fine']) {
    assert.ok(typeof SHAME[key] === 'string' && SHAME[key].length > 4, `SHAME.${key} is missing`);
  }
  // Слова «предатель», «поганый» идут игроку: в тексте нет ни одной национальности.
  assert.match(SHAME.title, /предател/i);
  assert.match(SHAME.title, /поган/i);
  const everything = Object.values(SHAME).join(' ');
  for (const word of ['хохол', 'русские', 'украин', 'америк', 'еврей', 'чурк']) {
    assert.ok(!everything.toLocaleLowerCase('ru').includes(word), `shame text mentions "${word}"`);
  }
});

// Прямая просьба была «твой IP и MAC переданы в правоохранительные органы».
// Такое утверждение — ложь о работе с чужими данными в собранном продукте: сервер
// партии не ведёт журнал адресов, а браузер не читает MAC. Экран об этом молчит,
// и тест следит, чтобы молчание не кончилось.
test('no shame text claims that player data went anywhere', () => {
  const everything = Object.values(SHAME).join(' ') + ' ' + errorText('NUKE_SHAMED');
  for (const claim of [/переданы/i, /отправл/i, /переда[её]м/i, /переда[и]ли/i, /правоохран/i, /полици/i, /участков/i, /IP-адрес/i]) {
    assert.ok(!claim.test(everything), `shame text asserts a data transfer (${claim})`);
  }
  assert.ok(!/\bIP\b/.test(everything), 'shame text mentions IP');
  // Честная оговорка обязана остаться: она объясняет, почему наказание только на экране.
  assert.match(SHAME.fine, /не может прочитать MAC/i);
  assert.match(SHAME.fine, /ничего не передано/i);
});

test('the ban lifts only on a page restart', () => {
  const beforeDestroy = shameSource.split('export function destroyShame')[0];
  // В теле модуля флаг гасится ровно один раз — при объявлении. Всё, что
  // снимает позор без перезагрузки, сюда попасть не должно.
  assert.equal(beforeDestroy.match(/shamed\s*=\s*false/g).length, 1, 'something resets the shame flag');
  assert.match(beforeDestroy, /shamed\s*=\s*true/);
  assert.match(shameSource, /window\.location\.reload\(\)/);
  assert.match(shameSource, /role', 'alertdialog/);
  assert.match(shameSource, /aria-modal/, 'the placard must behave as a modal');
  // Кнопка одна по делу — перезапуск. «Закрыть позор» быть не должно.
  const buttons = [...shameSource.matchAll(/<button[^>]*data-(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(buttons)].sort(), ['reload', 'sound']);
  assert.match(SHAME.reload, /переза/i);
  assert.match(SHAME.lock, /перезапуск/i);
});

test('the test range raises shame on every refusal and locks itself', () => {
  assert.match(rangeSource, /import \{ SHAME_EVENT, isShamed, triggerShame \} from '\.\/shame\.js'/);
  // Четыре независимых пути отказа (список городов, точка на глобусе, кнопка
  // пуска, слои) — каждый обязан дойти до позора, а не ограничиться строкой.
  assert.equal([...rangeSource.matchAll(/refuse\(/g)].length, 3, 'every refusal site must raise shame');
  assert.match(rangeSource, /triggerShame\(\{ target: targetName \|\| 'точка на карте' \}\)/, 'layers refusal must shame');
  assert.match(rangeSource, /window\.addEventListener\(SHAME_EVENT, onShame\)/);
  assert.match(rangeSource, /window\.removeEventListener\(SHAME_EVENT, onShame\)/);
  assert.match(rangeSource, /testButton\.disabled = isShamed\(\)/, 'a finished run must not re-arm the button');
  assert.match(rangeSource, /if \(isShamed\(\)\)/, 'the run button needs its own guard');
});

test('the party blocks nukes after shame and shames on the server refusal', () => {
  assert.match(bootSource, /import \{ isShamed, triggerShame \} from '\.\/shame\.js'/);
  assert.match(bootSource, /isShamed\(\) && command\.kind === 'nuke'/, 'send() must not ship a banned launch');
  assert.match(bootSource, /if \(isShamed\(\)\) \{ hud\.toast\(errorText\('NUKE_SHAMED'\)\); return; \}/);
  assert.match(bootSource, /if \(r\.error === NUKE_BAN_ERROR\) triggerShame/);
  assert.equal(SHAME_EVENT, 'kupol:shame');
});
