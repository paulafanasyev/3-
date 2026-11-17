import fs from 'fs';
import { repairIdentifiers } from './scripts/repair-i18n-identifiers.mjs';

const replacements = {
  'src/data/rocketLaunches.js': [
    ['ROCKET_МИССИЯ_', 'ROCKET_MISSION_'],
    ['паузаAt', 'pausedAt'],
    ['Resume replay', 'Продолжить повтор'],
    ['Pause replay', 'Пауза повтора'],
    ['SELECTED SPACE MISSION', 'ВЫБРАННАЯ КОСМИЧЕСКАЯ МИССИЯ'],
    ['MISSION', 'МИССИЯ'],
    ['LAUNCH SITE', 'МЕСТО ЗАПУСКА'],
    ['LAUNCH TIME', 'ВРЕМЯ ЗАПУСКА'],
    ['ORBIT', 'ОРБИТА'],
    ['ASCENT PATH', 'ТРАЕКТОРИЯ ВЗЛЁТА'],
    ['CURRENT DISTANCE FROM EARTH', 'ТЕКУЩЕЕ РАССТОЯНИЕ ОТ ЗЕМЛИ'],
    ['SATELLITE SPEED', 'СКОРОСТЬ СПУТНИКА'],
    ['PAYLOAD', 'ПОЛЕЗНАЯ НАГРУЗКА'],
    ['NAME', 'НАЗВАНИЕ'],
    ['TYPE', 'ТИП'],
    ['DESTINATION', 'НАЗНАЧЕНИЕ'],
    ['STAGE / RE-ENTRY / RECOVERY', 'СТУПЕНЬ / ВХОД В АТМОСФЕРУ / ВОЗВРАТ'],
    ['STAGE', 'СТУПЕНЬ'],
    ['STATUS', 'СТАТУС'],
    ['FINAL POSITION', 'ФИНАЛЬНАЯ ПОЗИЦИЯ'],
    ['REPLAY SPEED', 'СКОРОСТЬ ПОВТОРА'],
    ['FOCUS', 'ФОКУС'],
    ['PREV', 'НАЗАД'],
    ['NEXT', 'ДАЛЕЕ'],
    ['SHOW ALL / DESELECT', 'ПОКАЗАТЬ ВСЕ / СНЯТЬ ВЫБОР'],
    ['POSITION UNAVAILABLE', 'ПОЗИЦИЯ НЕДОСТУПНА'],
    ['NO СТУПЕНЬ RE-ENTRY / RECOVERY DATA', 'НЕТ ДАННЫХ О СТУПЕНЯХ / ВХОДЕ В АТМОСФЕРУ / ВОЗВРАТЕ'],
    ['Selected Space Mission', 'Выбранная космическая миссия'],
    ['Deselect mission', 'Снять выбор миссии'],
    ['REPLAY ASCENT', 'ПОВТОР ВЗЛЁТА'],
    ['Previous mission', 'Предыдущая миссия'],
    ['Next mission', 'Следующая миссия'],
    ['DATE UNAVAILABLE', 'ДАТА НЕДОСТУПНА'],
    ['UNSPECIFIED OPERATOR', 'ОПЕРАТОР НЕ УКАЗАН'],
    ['Preparing launch site', 'Подготовка места запуска'],
    ['Liftoff', 'Взлёт'],
    ['Ascent replay', 'Повтор траектории взлёта'],
    ['Orbit replay', 'Повтор орбиты'],
    ["? ', paused' : ''", "? ', пауза' : ''"],
    ['FLIGHT ${stage.flightNumber}', 'РЕЙС ${stage.flightNumber}'],
    ['REUSED', 'ПОВТОРНО ИСПОЛЬЗОВАНА'],
  ],
  'src/main.js': [
    ['Loading Google 3D Tiles...', 'Загрузка Google 3D Tiles...'],
    ['Google 3D Tiles unavailable (${tileErrorDetail}). Continuing in fallback mode...', 'Google 3D Tiles недоступны (${tileErrorDetail}). Продолжение в резервном режиме...'],
    ['Initializing systems...', 'Инициализация систем...'],
    ['Flying to Austin, TX...', 'Перелёт в Остин, Техас...'],
    ['Restoring shared view...', 'Восстановление общего вида...'],
    ['Configuring viewer...', 'Настройка просмотрщика...'],
  ],
  'src/data/satellites.js': [
    ['Add the full Starlink broadband shell (thousands of extra points)', 'Добавить полную широкополосную оболочку Starlink (тысячи дополнительных точек)'],
    ['Loading the Starlink shell…', 'Загрузка оболочки Starlink…'],
    ['Showing the full Starlink shell — click for the core catalog only', 'Показана полная оболочка Starlink — нажмите, чтобы оставить только основной каталог'],
  ],
  'src/data/militaryAwareness.js': [
    ['Focus ${escapeHtml(accessibleLabel)}', 'Фокус на ${escapeHtml(accessibleLabel)}'],
    ['Global Context navigation', 'Навигация по глобальному контексту'],
    ['Previous — prior visited contact in the 250 km window', 'Предыдущий — ранее посещённый контакт в радиусе 250 км'],
    ['Next — nearest unvisited contact in the 250 km window', 'Следующий — ближайший непосещённый контакт в радиусе 250 км'],
    ['Open-source mapped/observed context. Missing broadcasts, unloaded map areas, or unmapped sites are not evidence of absence.', 'Контекст на основе открытых данных и наблюдений. Отсутствие передачи, незагруженная область карты или объект, отсутствующий на карте, не являются доказательством отсутствия.'],
  ],
  'src/data/dataCredits.js': [
    ['Weather data by Open-Meteo.com', 'Данные о погоде предоставлены Open-Meteo.com'],
    ['Powered by TfL Open Data', 'Данные предоставлены TfL Open Data'],
  ],
  'src/scenes/director.js': [
    ['Shot ${idx + 1}', 'Сцена ${idx + 1}'],
    ['Shot title', 'Название сцены'],
    ['LOAD', 'ЗАГРУЗИТЬ'],
    ['DEL', 'УДАЛИТЬ'],
    ['Editable Scene Run', 'Редактируемый запуск сцены'],
    ['No shots yet. Use CAPTURE SHOT to save current look.', 'Сцен пока нет. Используйте «СОХРАНИТЬ СНИМОК», чтобы сохранить текущий вид.'],
    ['CAPTURE SHOT', 'СОХРАНИТЬ СНИМОК'],
  ],
  'src/scenes/recipes.js': [
    ['Global Flights Radar', 'Глобальный радар полётов'],
    ['Orbital Watch', 'Орбитальное наблюдение'],
    ['Thermal Threat Board', 'Тепловая карта угроз'],
    ['City Overload', 'Перегрузка города'],
    ['Omniscience Pullback', 'Отдаление с обзором всего мира'],
  ],
  'src/firstRunExperience.js': [
    ['EARTH WATCH', 'НАБЛЮДЕНИЕ ЗА ЗЕМЛЁЙ'],
    ['ACTIVE EVENTS', 'АКТИВНЫЕ СОБЫТИЯ'],
    [
      "  ENVIRONMENTAL: Object.freeze({ title: 'ENVIRONMENTAL' }),\n  EARTH_WATCH: Object.freeze({ title: 'НАБЛЮДЕНИЕ ЗА ЗЕМЛЁЙ' }),\n  ACTIVE_EVENTS: Object.freeze({ title: 'АКТИВНЫЕ СОБЫТИЯ' }),",
      "  ENVIRONMENTAL: Object.freeze({ title: 'ENVIRONMENTAL' }),\n  EARTH_WATCH: Object.freeze({ title: 'EARTH WATCH' }),\n  ACTIVE_EVENTS: Object.freeze({ title: 'ACTIVE EVENTS' }),",
    ],
    [
      "  const environmentalTitle = root.querySelector('[data-first-run-environmental-title]');\n  if (environmentalTitle) environmentalTitle.textContent = environmentalLabel().title;",
      "  const environmentalTitle = root.querySelector('[data-first-run-environmental-title]');\n  const environmentalUiTitles = Object.freeze({\n    ENVIRONMENTAL: 'ОКРУЖАЮЩАЯ СРЕДА',\n    EARTH_WATCH: 'НАБЛЮДЕНИЕ ЗА ЗЕМЛЁЙ',\n    ACTIVE_EVENTS: 'АКТИВНЫЕ СОБЫТИЯ',\n  });\n  if (environmentalTitle) {\n    environmentalTitle.textContent = environmentalUiTitles[ENVIRONMENTAL_LABEL_CHOICE] || environmentalLabel().title;\n  }",
    ],
  ],
  'src/ui.js': [
    ['enable CCTV to activate', 'включите CCTV для активации'],
    ['Enable CCTV to start camera-linked intelligence summaries.', 'Включите CCTV, чтобы запустить сводки аналитики, связанные с камерами.'],
    ['cameras loaded', 'камер загружено'],
    ['CONTACT LOST · LAST KNOWN READOUT · NOT AN ALL-CLEAR', 'КОНТАКТ ПОТЕРЯН · ПОСЛЕДНИЕ ИЗВЕСТНЫЕ ДАННЫЕ · ЭТО НЕ ОЗНАЧАЕТ ОТСУТСТВИЕ УГРОЗЫ'],
    ['POSITION UNAVAILABLE', 'ПОЗИЦИЯ НЕДОСТУПНА'],
    ['RESOLVING REGION', 'ОПРЕДЕЛЕНИЕ РЕГИОНА'],
    ['REGION UNAVAILABLE', 'РЕГИОН НЕДОСТУПЕН'],
  ],
};

// Одно слово ЗАГЛАВНЫМИ (MISSION, ORBIT, NEXT…) переводим только целиком: внутри
// идентификатора вроде ROCKET_MISSION_ID или REPLAY_ORBIT_DURATION_SEC его не трогаем,
// иначе ломаются импорты. Страховка: repairIdentifiers возвращает латиницу, если что-то проскочило.
const applyPair = (text, from, to) => (/^[A-Z]+$/.test(from)
  ? text.replace(new RegExp(`(?<![A-Za-z0-9_$])${from}(?![A-Za-z0-9_$])`, 'g'), () => to)
  : text.split(from).join(to));

let changed = 0;
for (const [file, pairs] of Object.entries(replacements)) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const before = text;
    text = applyPair(text, from, to);
    if (text !== before) changed++;
  }
  fs.writeFileSync(file, repairIdentifiers(text).text);
}

console.log(`Direct Russian UI replacements: ${changed}`);
