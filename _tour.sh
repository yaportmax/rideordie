#!/bin/bash
# usage: _tour.sh name "query"
n=$1; q=$2
node tools/test/shot.mjs "dressing.html?$q" shots/dress/t_$n.png --wait=3200 --quiet --eval="(()=>{const i=__dress.renderer.info;const p=__dress.dressing.pool;return {calls:i.render.calls,tris:i.render.triangles,inst:p.stats.instances,shInst:p.stats.shadowInstances,poolDraws:p.stats.drawn,tex:i.memory.textures,geo:i.memory.geometries}})()" 2>&1 | grep -v "X4122\|Program\|vite\|PCF\|404" | tr '\n' ' '
echo
