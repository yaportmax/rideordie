#!/bin/bash
# usage: shot.sh <id> [query extras e.g. "sheet=1&views=drive,far"] [w] [h] [tag]  -> shots/structures/<id>[_tag].png
cd /c/Dev/rideordie
id="$1"; extra="${2:-sheet=1}"; W="${3:-1800}"; H="${4:-1000}"
tag=""; [ -n "$5" ] && tag="_$5"
node tools/test/shot.mjs "tools/blender/structures/qa.html?model=/models/structures/$id.glb&$extra" "shots/structures/$id$tag.png" --quiet --w=$W --h=$H --wait=1200 --eval="JSON.stringify({t:window.__viewer.tris,c:window.__viewer.colTris,b:window.__viewer.bbox&&window.__viewer.bbox.size,m:window.__viewer.materials})" 2>&1 | grep -v "^saved"
