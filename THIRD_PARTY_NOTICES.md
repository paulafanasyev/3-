# Third-party notices

## Atomic Bombs — explosion audio samples

Source: https://github.com/Prokopiy8247/Opus5-5-Atomic-Bombs

The following original OGG audio samples were copied into this game with permission from the source repository's author:

- `assets/audio/samples/blast/16_rds37_front.ogg`
- `assets/audio/samples/blast/16_rds37_tail.ogg`
- `assets/audio/samples/blast/18_castle_bravo_front.ogg`
- `assets/audio/samples/blast/18_castle_bravo_tail.ogg`
- `assets/audio/samples/blast/20_tsar_front.ogg`
- `assets/audio/samples/blast/20_tsar_tail.ogg`

The source project describes its blast recordings as project-specific sound effects generated for Atomic Bombs. The Cesium client uses the recordings as an impact layer followed by a delayed rumble. Current strategic strike events do not expose warhead yield, so RDS-37 audio is the default until a yield value is added to the game event contract.

The source project's Godot GDScript and Godot shaders are not directly executable in this CesiumJS game. Their visual sequence and timing concepts are being ported to Cesium rather than embedding an incompatible Godot runtime.
