#!/bin/bash
# usage: _crop.sh <model> <az> <el> <dist> <out.png> <cropW> <cropH> <cropX> <cropY> [extra viewer params]
cd C:/Dev/rideordie
node tools/test/shot.mjs "viewer.html?model=/models/weapons/$1.glb&az=$2&el=$3&dist=$4&fov=25${10}" shots/weapons/_full_$$.png --quiet --w=3200 --h=1500 > /dev/null 2>&1
ffmpeg -y -loglevel error -i shots/weapons/_full_$$.png -vf "crop=$6:$7:$8:$9" "$5"
rm -f shots/weapons/_full_$$.png
