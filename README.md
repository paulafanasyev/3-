# 🛰️ Nuclear God's Eye

**Стратегическая игровая симуляция на 3D-глобусе, построенная на базе God's Eye View**

Этот репозиторий — форк open-source проекта **[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view)** (автор оригинала: **Bilawal Sidhu**, лицензия MIT). Исходный 3D-глобус, слои данных, HUD и голосовое управление взяты из оригинала; русская локализация, серверный runtime и игровой модуль Nuclear God's Eye добавлены в этом форке.

**Автор форка:** Павел Афанасьев  
**Контакты:** Email xongphavietnam@gmail.com | Telegram @PaulPavel_it_dev

## ✨ Возможности (унаследованы от God's Eye View)

- Реалистичная 3D-Земля (CesiumJS, Google Photorealistic 3D Tiles), атмосфера и динамическое освещение.
- Объекты в реальном времени: воздушные суда, корабли, спутники, землетрясения, пожары и другие события.
- Визуальные режимы: обычный, CRT, ночное зрение, тепловизор (FLIR).
- Камеры: вид от первого лица, тактический HUD, кинематографичный автопилот.
- Голосовое управление (OpenAI Realtime), русская локализация интерфейса.

## 🎮 Что добавляет форк

- Полная русская локализация UI.
- Production-сервер `server.js` (node:http + WebSocket `/ws`, без новых зависимостей) — основа для игрового слоя Nuclear God's Eye.
- Изолированный модуль игры в `src/nuclear/` (Stage 1: подготовка, см. `NUCLEAR_GODS_EYE_STAGE1.md`).

## ⚙️ Установка и запуск

### Требования

- Node.js **24.14.x или 26.x** (задаётся `engines` в `package.json`)
- Браузер с поддержкой WebGL

### Разработка

```bash
git clone https://github.com/paulafanasyev/3-
cd 3-
npm ci
cp .env.example .env   # заполните ключи (минимум GOOGLE_MAPS_API_KEY)
npm run dev -- --host localhost --port 4173
```

Откройте `http://localhost:4173`.

### Production

```bash
npm ci             # именно полный npm ci, без --omit=dev: vite и ws нужны серверу
npm run build      # ключи из .env (GOOGLE_MAPS_API_KEY, CESIUM_ION_TOKEN) вшиваются в сборку здесь
npm start          # http://127.0.0.1:4173, health: /api/health, websocket: /ws
npm run smoke      # проверка runtime: health, SPA fallback, /ws
```

`npm start` поднимает те же серверные API-прокси, что и dev-сервер (они описаны в `vite.config.js`), поэтому ключи вроде `OPENAI_API_KEY`, `AISSTREAM_API_KEY`, `FIRMS_MAP_KEY` остаются на сервере. Отключить прокси: `GEV_API_PROXIES=0`.

По умолчанию сервер слушает только `127.0.0.1`. Публичный доступ включается явно: `HOST=0.0.0.0`. В этом случае включите лимиты `GEV_RATELIMIT_*` из `.env.example`. Для WebSocket с других доменов перечислите их в `GEV_ALLOWED_ORIGINS` через запятую.

## 🔒 Безопасность

Секреты хранятся только в `.env` / переменных окружения. `GOOGLE_MAPS_API_KEY` и `CESIUM_ION_TOKEN` по дизайну попадают в браузер: ограничьте их по referrer. Подробнее в `SECURITY.md`.

## 📜 Лицензия и авторство

Код распространяется по лицензии MIT (см. `LICENSE`).

- Оригинальный God's Eye View © 2026 Bilawal Sidhu.
- Изменения и дополнения форка © 2026 Павел Афанасьев.

Сторонние данные и 3D-модели под MIT не подпадают: см. `LICENSE` и `DATA_SOURCES.md`. Данные TeleGeography (CC BY-NC-SA) запрещают коммерческое использование без отдельной лицензии.

## 📬 Связь

- Email: xongphavietnam@gmail.com
- Telegram: @PaulPavel_it_dev
