// Batch screenshots of world "sets" in the real game (one fresh page per shot, sequential).
//   node tools/test/setshots.mjs <spec.json> [--base=http://localhost:5180] [--out=shots/sets] [--prefix=before_] [--only=name1,name2]
// spec.json: [{ "name": "city44", "s": 44000, "as": "driver"|"gunner", "drive": 6, "speed": 30, "lat": 0,
//               "cam": {"offset":[x,y,z], "look":[x,y,z], "fov":60} (truck frame, +Z fwd, +X left), "yaw": 0.4, "pitch": 0.05 (gunner), "q": "extra=query" }]
// Prints __perf (calls/tris/fps) and long frames per shot.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const base = opt.base || 'http://localhost:5180', outDir = opt.out || 'shots/sets', prefix = opt.prefix || '';
let spec = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
if (opt.only) { const only = new Set(String(opt.only).split(',')); spec = spec.filter((x) => only.has(x.name)); }
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'],
});
for (const sh of spec) {
  const page = await browser.newPage({ viewport: { width: +(opt.w || 1600), height: +(opt.h || 900) } });
  page.on('pageerror', (e) => console.log(`[${sh.name}] pageerror`, e.message));
  if (opt.console) page.on('console', (m) => console.log(`[${sh.name}]`, m.type(), m.text()));
  const q = `index.html?solo&as=${sh.as || 'driver'}&s=${sh.s}&seed=${sh.seed ?? 7}${sh.q ? '&' + sh.q : ''}`;
  try {
    await page.goto(`${base}/${q}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
    const res = await page.evaluate((sh) => new Promise((resolve) => {
      window.__hitches = []; window.__spikes = []; document.getElementById('boot')?.remove();
      window.__autodrive = { speed: sh.speed ?? 30, lat: sh.lat || 0 };
      if (sh.cam) window.__camOverride = sh.cam;
      const long = []; let last = performance.now(); const t0 = last;
      const f = () => {
        const n = performance.now(); if (n - last > 50) long.push(Math.round(n - last)); last = n;
        const r = window.__run;
        if (r && r.gunner && sh.yaw !== undefined) { r.gunner.yaw = sh.yaw; r.gunner.pitch = sh.pitch || 0; }
        if (n - t0 < (sh.drive ?? 6) * 1000) requestAnimationFrame(f);
        else resolve({ perf: window.__perf, long, s: r && r.player ? Math.round(r.player.s) : null, hitches: window.__hitches.length, progs: window.__game.renderer.info.programs?.length });
      };
      requestAnimationFrame(f);
    }), sh);
    if (sh.hud === false) await page.evaluate(() => { for (const e of document.querySelectorAll('body > div')) e.style.visibility = 'hidden'; });
    const file = path.join(outDir, `${prefix}${sh.name}.png`);
    await page.screenshot({ path: file });
    const p = res.perf || {};
    console.log(`${file}  s=${res.s} calls=${p.calls} tris=${(p.tris / 1e6).toFixed(2)}M fps=${(p.fps || 0).toFixed(0)} progs=${res.progs} long=${res.long.length ? res.long.join(',') : '-'} hitches=${res.hitches}`);
  } catch (e) { console.log(`[${sh.name}] FAILED`, e.message); }
  await page.close();
}
await browser.close();
