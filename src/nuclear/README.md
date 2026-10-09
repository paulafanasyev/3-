# Nuclear God's Eye — game modules

Game-only modules. Existing God's Eye View renderer and data modules remain unchanged.
All values are game abstractions and are not operational real-world targeting data:
unit positions are generated randomly inside abstract zones.

## Stage 2 — game core (hybrid mode)

| File | Purpose |
|---|---|
| `units.js` | Unit catalog mapped onto GEV models in `public/models/` |
| `game.js` | Deterministic simulation: DEFCON phases, commands, missiles, defense, scoring, fog of war |
| `ai.js` | Simple opponent |
| `session.js` | One game per WebSocket connection (player = `blue`, AI = `red`) |
| `geo.js`, `rng.js` | Great-circle math, seeded PRNG |

### Units

| Type | Model | Role |
|---|---|---|
| `icbm_silo` | marker `silo` | ballistic launcher |
| `naval_group` | `ship.glb` | mobile ballistic launcher |
| `bomber` | `airplane.glb` | cruise launcher |
| `interceptor` | `jet.glb` | defense vs cruise |
| `abm_site` | marker `abm` | defense vs ballistic |
| `recon_drone` | `mq9.glb` | recon 1500 km |
| `scout_plane` | `c172.glb` | recon 700 km |
| `awacs` | `citation2.glb` | recon 2000 km + defense bonus |
| `rescue_heli` / `evac_airliner` / `regional_transport` | `bell206.glb` / `b789.glb` / `atr72.glb` | reduce civilian losses |
| `warning_satellite` | marker `satellite` | defense bonus |

### Rules

- DEFCON 5 → 1 on a timer. Moves allowed from DEFCON 4, launches only at DEFCON 1.
- Enemy units are hidden until a recon/AWACS unit gets in range or the unit fires.
- Defense engages missiles past mid-flight within range, one shot per defender per missile.
- Score: +10 per enemy unit destroyed, −10 friendly fire, −1 per civilian object hit.
- **Hybrid layer:** the browser sends positions of live GEV traffic (aircraft, ships) via
  `game:civilians`; they are the civilians counted in a blast. Rescue units reduce losses.
- Game ends when DEFCON 1 time runs out or no launcher has ammo and nothing is in flight.

### WebSocket protocol (`/ws`)

Client → server:

```json
{ "type": "game:new", "seed": 42, "speed": 1 }
{ "type": "game:command", "requestId": "r1", "command": { "kind": "move", "unitId": "u3", "lat": 40, "lon": -90 } }
{ "type": "game:command", "requestId": "r2", "command": { "kind": "launch", "unitId": "u1", "lat": 45, "lon": 80 } }
{ "type": "game:civilians", "points": [[51.5, -0.1], [40.7, -74.0]] }
{ "type": "game:speed", "speed": 2 }
{ "type": "game:stop" }
```

Server → client: `game:state` (every 250 ms, fogged snapshot + new events),
`game:command:result`, `game:civilians:ok`, `game:speed:ok`, `game:stopped`.

Max 3000 civilian points per message (WebSocket payload limit is 64 KB).

## Next: Stage 3 — globe client

Render `game:state` on the Cesium globe (units with GEV models, missile arcs, blast
rings), stream live aircraft/ship positions into `game:civilians`, HUD for DEFCON,
score and commands.
