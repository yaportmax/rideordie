// node tools/test/road_test.mjs [seed] — sanity stats for the generated road
import { Road, DS } from '../../src/world/road.js';
import { BIOME_PLAN } from '../../src/data/biomes.js';

const seed = +(process.argv[2] || 7);
const road = new Road(seed);
const L = 62000;
const t0 = performance.now();
road.extendTo(L);
console.log('generated', (road.sEnd / 1000).toFixed(1), 'km in', (performance.now() - t0).toFixed(0), 'ms;', road.features.length, 'features');
let minR = 1e9, thMin = 1e9, thMax = -1e9, maxSlope = 0, xMin = 1e9, xMax = -1e9, yMin = 1e9, yMax = -1e9, maxBank = 0;
for (let i = 1; i < road.n; i++) {
  const k = Math.abs(road.k[i]); if (k > 1e-6) minR = Math.min(minR, 1 / k);
  thMin = Math.min(thMin, road.th[i]); thMax = Math.max(thMax, road.th[i]);
  maxSlope = Math.max(maxSlope, Math.abs(road.y[i] - road.y[i - 1]) / DS);
  xMin = Math.min(xMin, road.x[i]); xMax = Math.max(xMax, road.x[i]);
  yMin = Math.min(yMin, road.y[i]); yMax = Math.max(yMax, road.y[i]); maxBank = Math.max(maxBank, Math.abs(road.bank[i]));
}
console.log(`min radius ${minR.toFixed(0)} m | heading ${(thMin * 57.3).toFixed(0)}..${(thMax * 57.3).toFixed(0)} deg | max slope ${(maxSlope * 100).toFixed(1)}% | x ${xMin.toFixed(0)}..${xMax.toFixed(0)} | y ${yMin.toFixed(0)}..${yMax.toFixed(0)} | max bank ${(maxBank * 57.3).toFixed(1)} deg`);
// self-proximity: samples > 400 m apart in s must stay > 140 m apart in space
let worst = 1e9, ws = 0;
const step = 4;
for (let i = 0; i < road.n; i += step) for (let j = i + Math.ceil(400 / DS); j < road.n; j += step) {
  const d = Math.hypot(road.x[i] - road.x[j], road.z[i] - road.z[j]);
  if (d < worst) { worst = d; ws = i * DS; }
}
console.log('closest approach between distant parts:', worst.toFixed(0), 'm near s=', ws.toFixed(0));
const counts = {};
for (const f of road.features) counts[f.type] = (counts[f.type] || 0) + 1;
console.log('features', counts);
let acc = 0; for (const b of BIOME_PLAN.slice(0, -1)) { acc += b.len; const sm = road.sample(acc); console.log(b.id, 'ends at', (acc / 1000).toFixed(0), 'km  elev', sm.y.toFixed(0), 'm'); }
