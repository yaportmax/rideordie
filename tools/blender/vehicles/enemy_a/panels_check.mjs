// Loads the enemy_a GLBs through the GAME's asset pipeline (Assets.preload -> mergeRigid) and builds a CarView for each,
// then prints the detachable panels CarView found vs. the panel_* nodes in the GLB (a single-primitive panel would be merged away).
//   node tools/blender/vehicles/enemy_a/panels_check.mjs [--base=http://localhost:5180]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const base = opt.base || 'http://localhost:5180';
const ids = ['e_sedan', 'e_muscle', 'e_buggy', 'e_technical'];
const expect = {};
for (const id of ids) {
  const b = fs.readFileSync(`public/models/vehicles/${id}.glb`);
  const j = JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString());
  expect[id] = j.nodes.filter(n => /^panel_/.test(n.name)).map(n => n.name.slice(6)).sort();
}
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-webgl'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`${base}/viewer.html`, { waitUntil: 'load' });
const res = await page.evaluate(async (ids) => {
  const A = await import('/src/core/assets.js');
  const { CarView } = await import('/src/view/car_view.js');
  const { VEHICLES } = await import('/src/data/vehicles.js');
  const urls = ids.map(id => `/models/vehicles/${id}.glb?cb=${Date.now()}`);
  await A.preload(ids.map(id => `/models/vehicles/${id}.glb`));
  const out = {};
  for (const id of ids) {
    const cv = new CarView(VEHICLES[id], { paint: 0x888888, paint2: 0x30302e, lod: false });
    const meshes = {};
    for (const [k, node] of cv.panels) { let n = 0; node.traverse(o => { if (o.isMesh) n++; }); meshes[k] = n; }
    out[id] = { panels: [...cv.panels.keys()].sort(), meshes, usesModel: cv.usesModel };
  }
  return out;
}, ids);
let bad = 0;
for (const id of ids) {
  const r = res[id];
  const miss = expect[id].filter(p => !r.panels.includes(p));
  const empty = expect[id].filter(k => !r.meshes[k]);
  if (miss.length || empty.length || !r.usesModel) bad++;
  // note: CarView's /^panel_/ also registers three.js' per-primitive child meshes (panel_hood_1 ...), so cv.panels.size > panel nodes
  console.log(`${id}: panel nodes found by CarView ${expect[id].length - miss.length}/${expect[id].length}  ${miss.length ? 'MISSING ' + miss.join(',') : 'all found'}` +
    `${empty.length ? '  EMPTY ' + empty.join(',') : ''}  meshes: ${expect[id].map(k => k + '=' + (r.meshes[k] || 0)).join(' ')}  (cv.panels.size ${r.panels.length})`);
}
await browser.close();
process.exit(bad ? 1 : 0);
