// Close-up inspection shots of the road / verge / terrain from fixed truck-frame cameras (no cockpit glass in the way).
//   node tools/test/ground_views.mjs <outPrefix> [--only=desert,canyon] [--views=eye,verge,road,side,left,far] [--drive=5000] [--speed=0] [--s=3000] [--night]
// One page per biome; each view = one screenshot. Eye height is measured from the road surface (not the truck origin).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const prefix = pos[0] || 'shots/ground/v';
const base = opt.base || 'http://localhost:5180';
const SPOTS = { desert: 3500, canyon: 13000, coast: 23600, mountain: 34000, city: 44600, dam: 53000 };
const only = opt.only ? opt.only.split(',') : Object.keys(SPOTS);
let views = (opt.views || 'eye,verge,road,side').split(',');
// [offset (x left, y above road, z fwd), look, fov]
const PRESET_ORB = {};
const PRESET = {
  eye: [[0.45, 1.3, 1.6], [0.45, 0.9, 40], 72],
  gun: [[0, 2.2, -1.2], [0, 1.2, 30], 72],
  verge: [[-2.5, 1.3, 0], [-8.5, 0, 7], 62],
  vergeL: [[2.5, 1.3, 0], [8.5, 0, 7], 62],
  road: [[0.2, 1.3, 3.4], [0.2, 0, 9], 62],
  side: [[-1, 1.6, 0], [-40, 3, 25], 70],
  left: [[1, 1.6, 0], [40, 3, 25], 70],
  far: [[0, 2.2, 0], [0, 1.5, 100], 55],
  sky: [[0, 30, 0], [0, 60, 1000], 60],
  skyL: [[0, 30, 0], [1000, 60, 200], 60],
  back: [[0, 1.6, 0], [0, 1.2, -40], 72],
  signR: [[-3, 1.4, 0], [-11, 0.9, 22], 40],
  zoomR: [[-3, 1.4, 0], [-11.2, 0.95, 26], 7],
  zoomR2: [[-3, 1.8, 0], [-11.4, 1.9, 30], 12],
  farR: [[0, 2.2, 0], [-60, 40, 100], 40],
  zoomL2: [[3, 1.8, 0], [11.4, 1.9, 30], 12],
  signL: [[3, 1.4, 0], [11, 0.9, 22], 40],
};
// --orbit=r,h[,n]: n views orbiting the truck at radius r / height h (death-cam style), looking at the truck
if (opt.orbit) { const [r, h, n = 6] = opt.orbit.split(',').map(Number); views = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const k = 'orb' + i; views.push(k); PRESET_ORB[k] = [[Math.sin(a) * r, h, Math.cos(a) * r], [0, 0.8, 0], 60]; } }
fs.mkdirSync(path.dirname(prefix), { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'],
});
for (const b of only) {
  const s = opt.s ? +opt.s : SPOTS[b];
  const page = await browser.newPage({ viewport: { width: +(opt.w || 1600), height: +(opt.h || 900) } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  try {
    await page.goto(`${base}/index.html?solo&as=${opt.as || (opt.hold ? "driver" : "gunner")}&s=${s}&seed=${opt.seed || 7}${opt.q ? '&' + opt.q : ''}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', null, { timeout: 120000 }).then(() => page.evaluate(() => document.getElementById('boot')?.remove())).catch(() => errs.push('__ready not set'));
    await page.evaluate(({ speed, lat, hold }) => { if (hold) window.__forceInput = { throttle: 0, brake: 1, steer: 0, handbrake: true }; else window.__autodrive = { speed, lat }; }, { speed: +(opt.speed ?? 25), lat: +(opt.lat || 0), hold: !!opt.hold });
    await page.waitForTimeout(+(opt.drive || 6000));
    for (const v of views) {
      const [o, l, fov] = PRESET[v] || PRESET_ORB[v];
      await page.evaluate(({ o, l, fov }) => {
        const run = window.__run, p = run.states.get(1), road = run.sim.road;
        const n = road.nearest(p.pos.x, p.pos.z, run.playerS || 0, 60, {});
        const dy = p.pos.y - road.pointAt(n.s, n.d, {}).y;
        window.__camOverride = { offset: [o[0], o[1] - dy, o[2]], look: [l[0], l[1] - dy, l[2]], fov };
      }, { o, l, fov });
      await page.waitForTimeout(+(opt.settle || 400));
      const out = `${prefix}_${b}_${v}.png`;
      await page.screenshot({ path: out });
      const r = await page.evaluate(() => { const p = window.__perf || {}; return { calls: p.calls, tris: p.tris, fps: +(p.fps || 0).toFixed(0), s: Math.round(window.__run?.playerS || 0) }; });
      console.log(out, JSON.stringify(r));
    }
    if (errs.length) console.log('ERR', errs.slice(0, 4).join(' | '));
  } catch (e) { console.log('FAIL', b, e.message); }
  await page.close();
}
await browser.close();
