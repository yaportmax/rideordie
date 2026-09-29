// Batch prop screenshots with ONE browser: node tools/env/shots.mjs [--sheet] [--w=900 --h=600] [--az=35 --el=14] [--sun=28] name [name ...]
//   name = prop file stem (public/models/props/<name>.glb) or a path starting with / (e.g. /models/props/x.glb)
//   writes shots/env/<stem>.png  (single view, or 6-view contact sheet with --sheet). Prints tris / bbox per model.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const names = args.filter(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const W = +(opt.w || (opt.sheet ? 1500 : 900)), H = +(opt.h || (opt.sheet ? 800 : 600));
const base = opt.base || 'http://localhost:5173';
fs.mkdirSync('shots/env', { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
for (const n of names) {
  const model = n.startsWith('/') ? n : `/models/props/${n}.glb`;
  const stem = path.basename(model, '.glb');
  const q = [`model=${model}`];
  if (opt.sheet) q.push('sheet=1');
  for (const k of ['az', 'el', 'dist', 'sun', 'sunaz', 'wire', 'grid', 'fov', 'exp', 'bg']) if (opt[k] !== undefined) q.push(`${k}=${opt[k]}`);
  await page.goto(`${base}/viewer.html?${q.join('&')}`, { waitUntil: 'load' });
  await page.evaluate(() => { window.__ready = false; });
  await page.waitForFunction('window.__ready === true', null, { timeout: 30000 }).catch(() => console.log('[warn] not ready', n));
  await page.waitForTimeout(500);
  const info = await page.evaluate('JSON.stringify(window.__viewer)');
  const v = JSON.parse(info);
  await page.screenshot({ path: `shots/env/${stem}.png` });
  console.log(`${stem}: tris ${v.tris} size ${v.bbox ? v.bbox.size.join('x') : '?'} mats ${v.materials.join(',')}`);
}
await browser.close();
