// Multi-view QA renderer for a vehicle GLB using the in-engine viewer (one browser session).
//   node tools/blender/vehicles/enemy_a/qa.mjs e_sedan [views=sheet,close,side,mid,far,tint,under,rear,wire] [--tint=cc3311]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const id = args[0];
const views = (args[1] && !args[1].startsWith('--') ? args[1] : 'sheet,close,side,mid,far').split(',');
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const base = 'http://localhost:5173';
const outDir = `shots/enemy_a`;
fs.mkdirSync(outDir, { recursive: true });
const tint = opt.tint || 'cc3311';
const model = opt.model || `/models/vehicles/${id}.glb`;
const V = {
  sheet: { q: 'sheet=1', w: 1800, h: 1000 },
  close: { q: 'az=35&el=12&dist=7.5', w: 1400, h: 800 },
  close2: { q: 'az=-40&el=12&dist=7.5', w: 1400, h: 800 },
  side: { q: 'az=90&el=4&dist=9', w: 1400, h: 700 },
  front: { q: 'az=8&el=8&dist=7', w: 1200, h: 800 },
  rear: { q: 'az=170&el=14&dist=8', w: 1400, h: 800 },
  rear34: { q: 'az=145&el=18&dist=8', w: 1400, h: 800 },
  mid: { q: 'az=30&el=10&dist=15', w: 1400, h: 800 },
  far: { q: 'az=35&el=8&dist=60', w: 1400, h: 800 },
  tint: { q: `sheet=1&tint=${tint}`, w: 1800, h: 1000 },
  tintclose: { q: `az=35&el=12&dist=7.5&tint=${tint}`, w: 1400, h: 800 },
  under: { q: 'az=40&el=-22&dist=8', w: 1400, h: 800 },
  top: { q: 'az=20&el=60&dist=8', w: 1400, h: 800 },
  wire: { q: 'az=35&el=12&dist=7.5&wire=1', w: 1400, h: 800 },
  low: { q: 'az=60&el=6&dist=7.5&sun=12', w: 1400, h: 800 },
  cab: { q: 'az=60&el=35&dist=5&fov=40', w: 1400, h: 800 },
};
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl'],
});
let info = null;
for (const v of views) {
  const spec = V[v] || { q: v, w: 1400, h: 800 };
  const page = await browser.newPage({ viewport: { width: spec.w, height: spec.h } });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  const extra = opt.extra ? '&' + opt.extra : '';
  await page.goto(`${base}/viewer.html?model=${model}&${spec.q}${extra}&cb=${Date.now()}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 60000 }).catch(() => console.log('[warn] not ready'));
  await page.waitForTimeout(900);
  const out = path.join(outDir, `${id}_${v}.png`);
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
