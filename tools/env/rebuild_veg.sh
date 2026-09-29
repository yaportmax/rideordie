#!/bin/bash
# Rebuild ALL vegetation: textures -> cards -> pines (full) -> billboard bake -> lods -> billboards -> trees/palm -> shrubs -> cacti
cd "$(dirname "$0")/../.."
PY=C:/Dev/conduit/art_src/venv/Scripts/python.exe
B="C:/Dev/tools/Blender-4.5.11-portable/blender.exe"
$PY tools/env/veg_prep_textures.py > /dev/null
$PY tools/env/foliage_cards.py > /dev/null
"$B" -b --factory-startup -P tools/env/props/veg_pines.py -- a b c --only full 2>&1 | grep -E "PROP|Error|Traceback"
$PY tools/env/render_billboards.py pine_a pine_b pine_c
"$B" -b --factory-startup -P tools/env/props/veg_pines.py -- a b c --only lod 2>&1 | grep -E "PROP|Error|Traceback"
"$B" -b --factory-startup -P tools/env/props/veg_pines.py -- a b c --only bb 2>&1 | grep -E "PROP|Error|Traceback"
for s in veg_trees veg_shrubs veg_cactus; do "$B" -b --factory-startup -P tools/env/props/$s.py 2>&1 | grep -E "PROP|Error|Traceback"; done
