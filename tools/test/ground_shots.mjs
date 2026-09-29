// Batch screenshots for the ground/road/verge pass: one headless Chrome, several (biome, view) spots.
//   node tools/test/ground_shots.mjs <outPrefix> [--base=http://localhost:5180] [--only=desert,canyon] [--views=driver,gunner] [--drive=6000] [--cam=x,y,z:lx,ly,lz:fov] [--seed=7]
// Writes <outPrefix>_<biome>_<view>.png and prints window.__perf (calls/tris) per shot.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const prefix = pos[0] || 'shots/ground/x';
const base = opt.base || 'http://localhost:5180';
const SPOTS = { desert: 3000, canyon: 13000, coast: 23000, mountain: 34000, city: 44000, dam: 53000 };
const only = opt.only ? opt.only.split(',') : Object.keys(SPOTS);
const views = (opt.views || 'driver,gunner').split(',');
const drive = +(opt.drive || 6000), seed = opt.seed || 7, speed = +(opt.speed || 30);
const cam = opt.cam ? (() => { const [o, l, f] = opt.cam.split(':'); return { offset: o.split(',').map(Number), look: l.split(',').map(Number), fov: +(f || 60) }; })() : null;
fs.mkdirSync(path.dirname(prefix), { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'],
});
for (const b of only) {
  for (const v of views) {
    const s = opt.s ? +opt.s : SPOTS[b];
    const page = await browser.newPage({ viewport: { width: +(opt.w || 1600), height: +(opt.h || 900) } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' || (opt.log && m.type() === 'warning')) errs.push(m.text().slice(0, 200)); });
    const url = `${base}/index.html?solo&as=${v}&s=${s}&seed=${seed}${opt.q ? '&' + opt.q : ''}`;
    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction('window.__ready === true', null, { timeout: 120000 }).catch(() => errs.push('__ready not set'));
      await page.waitForTimeout(+(opt.wait || 800));
      const r = await page.evaluate(({ drive, speed, cam, lat }) => new Promise((res) => {
        window.__autodrive = { speed, lat };
        if (cam) window.__camOverride = cam;
        setTimeout(() => {
          const p = window.__perf || {};
          const pool = window.__run?.dressing?.pool?.stats;
          res({ calls: p.calls, tris: p.tris, fps: +(p.fps || 0).toFixed(0), inst: pool?.instances, hitches: (window.__hitches || []).length, s: Math.round(window.__run?.playerS || 0) });
        }, drive);
      }), { drive, speed, cam, lat: +(opt.lat || 0) });
      const out = `${prefix}_${b}_${v}.png`;
      await page.screenshot({ path: out });
      console.log(out, JSON.stringify(r), errs.length ? 'ERR ' + errs.slice(0, 3).join(' | ') : '');
    } catch (e) { console.log('FAIL', b, v, e.message); }
    await page.close();
  }
}
await browser.close();
