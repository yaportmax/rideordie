// Which detachable nodes survive the game's load-time mergeRigid()?  Loads the real client, then clones each vehicle through
// src/core/assets.js (the same merged template CarView / BossView use) and lists the top-level panel_/part_/ramp_ nodes that remain.
//   node tools/blender/vehicles/enemy_b/panel_probe.mjs e_van e_heavy e_tanker [--dir=shots/enemy_b/test] [--base=http://localhost:5180]
// --dir swaps /models/vehicles/<id>.glb for <dir>/<id>.glb via request routing (test builds before they go live).
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
if (opt.dir) for (const id of ids) {
  const f = `${opt.dir}/${id}.glb`; if (!fs.existsSync(f)) continue; const buf = fs.readFileSync(f);
  await page.route(`**/models/vehicles/${id}.glb*`, (route) => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: buf }));
}
await page.goto(`${opt.base || 'http://localhost:5180'}/index.html?solo&as=driver&s=9000`);
await page.waitForFunction('window.__ready === true', null, { timeout: 150000 });
const r = await page.evaluate(async (ids) => {
  const A = await import('/src/core/assets.js');
  const out = {};
  for (const id of ids) {
    const root = A.clone(`/models/vehicles/${id}.glb`);
    if (!root) { out[id] = 'not loaded'; continue; }
    const keep = [], merged = [];
    root.traverse((o) => { if (/^(panel_|part_|ramp_)/.test(o.name)) (/_merged_/.test(o.name) ? merged : keep).push(o.name + (o.isMesh ? '[M]' : '[G]')); });
    out[id] = { nodes: keep.length, keep: keep.join(' ') };
  }
  return out;
}, ids);
for (const [id, v] of Object.entries(r)) console.log(id, typeof v === 'string' ? v : `${v.nodes} detachable nodes: ${v.keep}`);
await browser.close();
