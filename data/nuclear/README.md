# Nuclear God's Eye — simulation data boundary

Game-only data belongs here. Do not store real-world operational targeting data, sensitive military deployment information, or secrets.

The historical test-range profile catalogue is maintained in `src/game/data/source-bomb-profiles.json` and is attributed in `THIRD_PARTY_NOTICES.md`. It supplies visual-art parameters only; the Cesium renderer adapts them into stylized in-game effects.

The city selector uses the 7,342-place Natural Earth dataset copied from God's Eye View. It contains public-domain place names and coordinates, with provenance and checksum preserved in the dataset's `meta` header and attribution in `THIRD_PARTY_NOTICES.md`.

City destruction is a procedural visual overlay. It does not modify Google's streamed 3D Tiles, the underlying map, real-world assets, or the main game's server-side city state.
