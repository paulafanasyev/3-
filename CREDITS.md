# CREDITS

Сторонние данные, ассеты и заимствованный код игры «Купол». Код самого форка — MIT (см. `LICENSE`).
Каждый новый ассет или набор данных добавляется сюда: файл, автор, источник, лицензия, изменения.

## Данные о настоящей Земле

| Что | Где в репо | Автор / источник | Лицензия | Изменения |
|---|---|---|---|---|
| Контуры суши 1:50m | вход `scripts/build-game-map.mjs` (сам файл не коммитится) | [Natural Earth](https://www.naturalearthdata.com/) 1:50m. Локальная сборка: контуры admin-0 1:50m, слитые в одну сушу (границы стёрты). Эталон для пересборки — `ne_50m_land` | Public domain | Растеризуются в маску суши/океана 4096×2048, затем сводятся к ячейкам сетки |
| Снимок Земли «Blue Marble» | вход `scripts/build-game-map.mjs` (не коммитится) | Файл `earth-blue-marble.jpg` из примеров npm-пакета [three-globe](https://github.com/vasturiano/three-globe) (MIT, автор Vasco Asturiano); изображение по описанию основано на NASA Blue Marble (public domain). **Первоисточник не подтверждён**: перед релизом пересобрать карту на оригинальном файле NASA с [visibleearth.nasa.gov](https://visibleearth.nasa.gov/collection/1484/blue-marble) | NASA: public domain; копия: MIT | По цвету снимка определяется тип местности ячейки |
| Карта местности | `data/game/map.json` | Производные от двух источников выше | Public domain (производные) | Тип местности на 10 242 ячейки |
| Стоп-лист реальных названий | `data/game/real-names-stoplist.json` | Русские названия стран из Natural Earth, крупные города, регионы, реки и горы, распространённые личные имена (составлено вручную) | Public domain / факты | Используется только чтобы игровые имена НЕ совпадали с реальными |

Реальные государственные границы и списки городов в игре не используются: вся политическая карта
(провинции, народы, города, названия) выдумана детерминированно в `src/game/worldgen.js`.

## 3D-модели

Модели юнитов — уже имеющиеся в репо файлы `public/models/*.glb` под **CC BY 4.0**. Авторы,
ссылки и изменения перечислены в [`public/models/README.md`](public/models/README.md); в игре
они используются так (`src/game/data/units.js`):

| Модель | Юнит |
|---|---|
| `ship.glb` | Галера, Броненосец |
| `c172.glb` | Биплан-разведчик |
| `jet.glb` | Истребитель |
| `mq9.glb` | Ударный беспилотник |
| `bell206.glb` | Вертолёт |
| `citation2.glb` | Самолёт-разведчик |
| `atr72.glb`, `b789.glb` | Транспортники (этап клиента) |
| `airplane.glb` | Торговые рейсы (этап клиента) |

## Портреты лидеров

| Файл | Автор | Лицензия | Как сделано |
|---|---|---|---|
| `src/game/faces/avatar-svg.js` | Pavel Afanasev, единственный автор и владелец (репо [paulafanasyev/ai-english-teacher](https://github.com/paulafanasyev/ai-english-teacher), `apps/web/src/avatar/svg.js`, blob `ba68462d70476ca48b665b61ec9fa97209113172`) | © 2026 Pavel Afanasev, включён в этот репо самим автором. Не входит в MIT-лицензию форка без отдельного решения автора | Скопирован без изменений |
| `src/game/faces/leaderFaces.js` | этот проект | MIT | Токены внешности лидеров, борода, седина, значок, рамка, мимика по настроению |
| `public/game/leaders/<нация>[-<настроение>].svg/.png` (генерируются, в `.gitignore`) | этот проект (на основе отрисовщика выше) | как у `avatar-svg.js` | `node scripts/game-portraits.mjs` |
| `public/game/leaders/custom.png` | этот проект | MIT | Силуэт-заглушка для своей нации, тот же скрипт |

## Шрифты (этап клиента, ещё не добавлены)

| Шрифт | Автор | Лицензия |
|---|---|---|
| IBM Plex Mono | IBM | SIL Open Font License 1.1 |
| Black Ops One | James Grieshaber, Eben Sorkin | SIL Open Font License 1.1 |

## Заимствованный код

| Файл | Откуда | Изменения |
|---|---|---|
| `src/game/geo.js` | `src/nuclear/geo.js` из PR #2 (этот же репо) | `toVector`/`fromVector` экспортируются |
| `src/game/rng.js` | `src/nuclear/rng.js` из PR #2 | Добавлены `randomInt`, `pick`, `shuffle`, `seedToInt` |
| `src/game/session.js` | `src/nuclear/session.js` из PR #2 | Таймер тиков заменён на пошаговый `game:endTurn` |
