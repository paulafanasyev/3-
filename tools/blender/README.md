Blender unit catalog builder

The script imports GLB models from a directory, arranges them on labelled plinths, adds lighting and a camera, and saves an editable .blend scene.

Run with Blender 4.0 or newer (the EEVEE engine name is picked for the installed version, with Cycles as a fallback):
blender --background --python build_catalog.blend.py -- /path/to/glb-folder /path/to/Svetlana_Units_Catalog.blend

The original GLB files are not modified and retain their animation clips. This package currently contains 17 models exported from src/game/client/battle/forge.js, not every strategic type listed in src/game/data/units.js. The script has not yet been executed in a Blender installation, so verify the resulting scene and render there.
