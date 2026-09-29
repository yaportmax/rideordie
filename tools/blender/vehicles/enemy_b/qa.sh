#!/bin/bash
# usage: qa.sh <id> [extra query] ; renders sheet + 3 hero views into shots/enemy_b
cd C:/Dev/rideordie
id=$1; shift
q="$*"
node tools/test/shot.mjs "viewer.html?model=/models/vehicles/$id.glb&sheet=1$q" shots/enemy_b/${id}_sheet.png --quiet --eval="JSON.stringify({tris:window.__viewer.tris,bbox:window.__viewer.bbox.size})" | grep -E "eval|error|Error"
