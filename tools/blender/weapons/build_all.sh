#!/bin/bash
# Rebuild every weapon GLB (two parallel lanes).  Usage: bash tools/blender/weapons/build_all.sh   (from the project root)
B="C:/Dev/tools/Blender-4.5.11-portable/blender.exe"
run() { local n=$1; shift; echo "== $n $*"; "$B" -b --factory-startup -P tools/blender/weapons/$n.py -- "$@" 2>&1 | grep -E "TRIS|hidden|atlas|EXPORTED|Error|Trace|DONE|WARN removed|zero-area"; }
laneA() { run pistol --size 2048 --out 1024; run revolver --size 2048 --out 1024; run smg; run shotgun; run rifle; }
laneB() { run lmg; run sniper; run rpg; run rocket; run grenade; run shells --which 9mm; run shells --which shotgun; run shells --which rifle; }
laneA > /tmp/laneA.log 2>&1 &
laneB > /tmp/laneB.log 2>&1 &
wait
cat /tmp/laneA.log /tmp/laneB.log
