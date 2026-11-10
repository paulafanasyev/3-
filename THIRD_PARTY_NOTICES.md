# Third-party notices

## Atomic Bombs — explosion audio and visual profiles

Source: https://github.com/Prokopiy8247/Opus5-5-Atomic-Bombs

The project owner reports that the source repository's author granted permission to reuse its blast effects and audio. The game uses all 20 front/tail OGG sample pairs from `assets/audio/samples/blast/`. Three commonly used pairs (RDS-37, Castle Bravo and Tsar Bomb) are mirrored under `public/audio/nuclear/`; the remaining pairs are loaded from the source repository's raw public asset paths.

The source `data/bombs.json` profile catalog is included as `src/game/data/source-bomb-profiles.json`. Its per-device art parameters drive the Cesium port's cloud height, cap size, fireball and color profile. The source project's Godot GDScript and Godot shaders cannot execute in CesiumJS; the timing/profile data and visual sequence are adapted to native Cesium entities rather than embedding a second engine.

The source sequence represented in the game includes thermal flash/fireball, expanding shock fronts, Wilson condensation ring, dust sheet, ejecta particles, rising stem and multi-lobed cloud cap. These are stylized in-game effects, not a physical damage predictor.

## God's Eye View — populated places

Source: https://github.com/bilawalsidhu/gods-eye-view
Dataset: `src/data/local_data/natural_earth/populated_places.json`
Upstream source: Natural Earth 10m populated places, pinned commit `ca96624a56bd078437bca8184e78163e5039ad19`.

The 7,342-place catalogue is included at `src/game/data/populated_places.json` for offline city search. Natural Earth data is public domain; provenance, source URL and SHA-256 are preserved in the JSON `meta` header. The search uses city names and coordinates from this dataset and does not call a geocoding service.

## Existing local audio mirrors

- `public/audio/nuclear/16-rds37-front.ogg`
- `public/audio/nuclear/16-rds37-tail.ogg`
- `public/audio/nuclear/18-castle-bravo-front.ogg`
- `public/audio/nuclear/18-castle-bravo-tail.ogg`
- `public/audio/nuclear/20-tsar-front.ogg`
- `public/audio/nuclear/20-tsar-tail.ogg`
