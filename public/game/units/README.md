# Модели юнитов для тактического боя

Сюда кладутся glTF/GLB-модели солдат и техники (только CC0, CC-BY или свои; каждую — в CREDITS.md).
Сцена боя (`src/game/client/battle/view.js`) читает `manifest.json` и для перечисленных типов
берёт модель вместо процедурной фигуры. Пример `manifest.json`:

```json
{
  "swordsman": { "file": "samurai.glb", "scale": 1, "clips": { "idle": "Idle", "walk": "Walk", "run": "Run", "attack": "Sword_Attack", "die": "Death" } },
  "infantry": { "file": "soldier.glb", "scale": 1, "clips": { "idle": "Idle", "walk": "Walk", "run": "Run", "attack": "Shoot" } },
  "tank": { "file": "tank.glb", "scale": 1 }
}
```

Модель должна смотреть в +Z и стоять на y = 0, единица — метр. На каждого солдата создаётся
клон со своим микшером, поэтому держите модели лёгкими (до ~5 тыс. треугольников).
