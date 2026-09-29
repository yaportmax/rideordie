#!/bin/bash
# Verify test builds public/models/_test/t<N>.glb (contract nodes, bbox) and copy them over public/models/vehicles/truck_t<N>.glb.
#   install.sh 1 2 3 4
cd C:/Dev/rideordie
for t in "$@"; do
  out=$(node tools/blender/vehicles/player/verify.mjs --model=/models/_test/t$t.glb 2>&1)
  if echo "$out" | grep -q "missing: none"; then cp public/models/_test/t$t.glb public/models/vehicles/truck_t$t.glb; echo "T$t installed: $(echo "$out" | grep -o 'tris [0-9]*')"; else echo "T$t NOT installed"; echo "$out"; fi
done
