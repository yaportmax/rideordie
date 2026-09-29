#!/bin/bash
# usage: qa.sh <n> <tint> [model-path]   -> shots/vehicles/qa_t<n>_{sheet,close,mid,far}.png
n=$1; tint=$2; m=${3:-/models/vehicles/truck_t$n.glb}
cd C:/Dev/rideordie
node tools/test/shot.mjs "viewer.html?model=$m&sheet=1&tint=$tint" shots/vehicles/qa_t${n}_sheet.png --quiet --w=1800 --h=1000
node tools/test/shot.mjs "viewer.html?model=$m&az=35&el=12&dist=4&tint=$tint" shots/vehicles/qa_t${n}_close.png --quiet
node tools/test/shot.mjs "viewer.html?model=$m&az=150&el=14&dist=15&tint=$tint" shots/vehicles/qa_t${n}_mid.png --quiet
node tools/test/shot.mjs "viewer.html?model=$m&az=40&el=10&dist=60&tint=$tint" shots/vehicles/qa_t${n}_far.png --quiet
