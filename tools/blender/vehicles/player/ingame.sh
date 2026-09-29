#!/bin/bash
# In-game QA shot of a player truck (needs the :5180 test server).
#   ingame.sh <tier 1-4> <driver|gunner> <out.png> [extra url params]
# The dev ?solo path keeps the #boot overlay; ingame_wait.js waits for the run + cockpit and removes it.
cd C:/Dev/rideordie
node tools/test/shot.mjs "index.html?solo&as=$2&s=${S:-1200}&truck=truck_t$1$4" "$3" --base=http://localhost:5180 --wait=100 --quiet --eval="$(cat tools/blender/vehicles/player/ingame_wait.js)" --timeout=200000
