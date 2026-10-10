# Модели юнитов для тактического боя

Сюда кладутся glTF/GLB-модели солдат и техники (только CC0, CC-BY или свои; каждую — в CREDITS.md).
Сцена боя (`src/game/client/battle/view.js`) читает `manifest.json` и для перечисленных типов
берёт модель вместо кованой (`src/game/client/battle/forge.js`). Ключ — тип полка или `тип@эпоха`
(0 — Древность, 1 — Индустрия, 2 — Информационная, 3 — Космическая). Пример `manifest.json`:

```json
{
  "swordsman": { "file": "samurai.glb", "scale": 1, "clips": { "idle": "Idle", "walk": "Walk", "run": "Run", "attack": "Sword_Attack", "die": "Death" } },
  "infantry": { "file": "soldier.glb", "scale": 1, "clips": { "idle": "Idle", "walk": "Walk", "run": "Run", "attack": "Shoot" } },
  "tank": { "file": "tank.glb", "scale": 1 }
}
```

Модель должна смотреть в +Z и стоять на y = 0, единица — метр. На каждого солдата создаётся
клон со своим микшером, поэтому держите модели лёгкими (до ~5 тыс. треугольников).

## Кованые модели и Blender

`npm run game:units` выгружает все кованые модели в `forge/<ключ>.glb` и пишет `forge/index.json`
(список по эпохам). Файлы открываются в Blender (File → Import → glTF 2.0) со скелетом и клипами
idle / walk / run / attack / die. Чтобы игра взяла правленую модель, пропишите её в манифесте:

```json
{ "infantry@2": { "file": "forge/infantry2.glb" } }
```

Атрибуты `_TEAM` (доля цвета нации) и `_METAL` (0 — ткань, 1 — металл, 2 — свечение) сохраняйте:
по ним полк красится в цвет нации. Папка `forge/` генерируется, в git её класть не нужно.
