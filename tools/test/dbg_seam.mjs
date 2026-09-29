import { Road } from '../../src/world/road.js';
import { genTerrainChunk, genRoadChunk, COLS, EDGE, terrainPoint } from '../../src/world/terrain_gen.js';
const seed = 7, road = new Road(seed);
const chunk = 15;
const t = genTerrainChunk(road, seed, chunk, 0);
const r = genRoadChunk(road, seed, chunk);
const nCol = COLS.length, rows = 33;
console.log('anchor terrain', t.anchor.map(v=>v.toFixed(2)), 'road', r.anchor.map(v=>v.toFixed(2)));
for (const row of [0, 5, 16, 32]) {
  const lc = (row * nCol) * 3; // left side first vertex c=0
  const rc = (rows * nCol + row * nCol) * 3;
  const roadCols = 11;
  const roadLeft = (row * roadCols + 10) * 3, roadRight = (row * roadCols) * 3;
  console.log(`row ${row}: terrain L y=${t.positions[lc+1].toFixed(2)} x=${t.positions[lc].toFixed(2)} | road L(+9.5) y=${r.positions[roadLeft+1].toFixed(2)} x=${r.positions[roadLeft].toFixed(2)} | terrain R y=${t.positions[rc+1].toFixed(2)} | road R y=${r.positions[roadRight+1].toFixed(2)}`);
}
// max height over first 12 columns
let mx=-1e9; for (let row=0;row<33;row++) for(let c=0;c<nCol;c++){ const y=t.positions[(row*nCol+c)*3+1]; if(c<8) mx=Math.max(mx,y);} console.log('max y in cols<8 (rel anchor):', mx.toFixed(2));
const P={}; terrainPoint(road, seed, 1500, EDGE+30, P); console.log('terrainPoint a=30 off=',P.off.toFixed(2),'y=',P.y.toFixed(2),'road y', road.sample(1500).y.toFixed(2));
