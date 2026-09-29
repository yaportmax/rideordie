#!/bin/bash
# usage: views.sh <id> <tint|-> "az,el,dist[,fov]" ...   -> shots/enemy_b/<id>_v<i>.png
cd C:/Dev/rideordie
id=$1; tint=$2; shift; shift
i=0
for v in "$@"; do
  IFS=',' read az el dist fov w h <<< "$v"
  q="model=/models/vehicles/$id.glb&az=$az&el=$el&dist=$dist"
  [ -n "$fov" ] && q="$q&fov=$fov"
  [ "$tint" != "-" ] && q="$q&tint=$tint"
  node tools/test/shot.mjs "viewer.html?$q" shots/enemy_b/${id}_v$i.png --quiet --w=${w:-1400} --h=${h:-800} | grep -E "rror" 
  i=$((i+1))
done
