// Multi-view QA renderer for a vehicle GLB using the in-engine viewer (one browser session, views rendered sequentially).
//   node tools/blender/vehicles/enemy_a/qa.mjs e_sedan [views=sheet,close,side,...] [--tint=8a3a1e] [--p2=30302e] [--tag=before] [--base=http://localhost:5180]
// paint gets --tint, paint2 gets --p2 (default 30302e = the colour the game uses for every enemy's paint2).
// Append "_n" to a view name for a NIGHT render (sun + sky IBL dimmed to moonlight, black sky) to check the emissive lamps.
// Output: shots/enemy_a/<tag>_<id>_<view>.png   (tag defaults to "qa")
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const id = args[0];
const views = (args[1] && !args[1].startsWith('--') ? args[1] : 'sheet,close,side,mid,far').split(',');
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const base = opt.base || 'http://localhost:5180';
const outDir = `shots/enemy_a`;
fs.mkdirSync(outDir, { recursive: true });
const tint = opt.tint || '8a3a1e';
const p2 = opt.p2 || '30302e';
const tag = opt.tag || 'qa';
const model = opt.model || `/models/vehicles/${id}.glb`;
const V = {
  sheet: { q: 'sheet=1', w: 1800, h: 1000 },
  close: { q: 'az=35&el=12&dist=7.5', w: 1400, h: 800 },
  close2: { q: 'az=-40&el=12&dist=7.5', w: 1400, h: 800 },
  side: { q: 'az=90&el=4&dist=9', w: 1400, h: 700 },
  sideR: { q: 'az=-90&el=4&dist=9', w: 1400, h: 700 },
  front: { q: 'az=8&el=8&dist=7', w: 1200, h: 800 },
  rear: { q: 'az=172&el=12&dist=7.5', w: 1400, h: 800 },
  rear34: { q: 'az=145&el=18&dist=8', w: 1400, h: 800 },
  mid: { q: 'az=30&el=10&dist=15', w: 1400, h: 800 },
  far: { q: 'az=35&el=8&dist=40', w: 1400, h: 800 },
  under: { q: 'az=40&el=-22&dist=8', w: 1400, h: 800 },
  top: { q: 'az=20&el=60&dist=8', w: 1400, h: 800 },
  wire: { q: 'az=35&el=12&dist=7.5&wire=1', w: 1400, h: 800 },
  low: { q: 'az=60&el=6&dist=7.5&sun=12', w: 1400, h: 800 },
  cab: { q: 'az=60&el=35&dist=4.5&fov=40', w: 1400, h: 800 },
  cabR: { q: 'az=-60&el=35&dist=4.5&fov=40', w: 1400, h: 800 },
  wheel: { q: 'az=80&el=6&dist=3.2&fov=35', w: 1400, h: 800 },
  nose: { q: 'az=20&el=10&dist=4.2&fov=40', w: 1400, h: 800 },
  tail: { q: 'az=160&el=12&dist=4.2&fov=40', w: 1400, h: 800 },
  roof: { q: 'az=130&el=40&dist=5&fov=40', w: 1400, h: 800 },
};
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl'],
});
const NIGHT = `(() => { const s = window.__root.parent; s.traverse(o => { if (o.isDirectionalLight) { o.intensity = 0.22; o.color.setRGB(0.6,0.7,1.0); } });
  s.environmentIntensity = 0.05; s.background = null; return 1; })()`;
let info = null;
for (const v0 of views) {
  const night = v0.endsWith('_n');
  const v = night ? v0.slice(0, -2) : v0;
  const spec = V[v] || { q: v, w: 1400, h: 800 };
  const page = await browser.newPage({ viewport: { width: spec.w, height: spec.h } });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  const extra = (opt.extra ? '&' + opt.extra : '');
  await page.goto(`${base}/viewer.html?model=${model}&${spec.q}${extra}&cb=${Date.now()}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 60000 }).catch(() => console.log('[warn] not ready'));
  await page.evaluate(`(() => { window.__root.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) {
      if (m.name === 'paint') m.color.set('#${tint}'); if (m.name === 'paint2') m.color.set('#${p2}'); } }); return 1; })()`);
  if (night) await page.evaluate(NIGHT);
  await page.waitForTimeout(900);
  const safe = v0.replace(/[^a-zA-Z0-9_=.-]/g, '_').slice(0, 60);
  const out = path.join(outDir, `${tag}_${id}_${safe}.png`);
  await page.screenshot({ path: out });
  if (!info) info = await page.evaluate('JSON.stringify({tris: window.__viewer.tris, bbox: window.__viewer.bbox, mats: window.__viewer.materials})');
  await page.close();
  console.log('saved', out);
}
console.log(info);
if (opt.nodes) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.goto(`${base}/viewer.html?model=${model}&cb=${Date.now()}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 60000 });
  const n = await page.evaluate('JSON.stringify(window.__viewer.nodes.map(n => n.path + " [" + n.type + "] " + n.pos.join(",")))');
  console.log(JSON.parse(n).join('\n'));
}
await browser.close();
