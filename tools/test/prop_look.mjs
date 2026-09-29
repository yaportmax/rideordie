// Point the camera at the nearest instance of a dressing asset ahead of the truck (checks orientation / look of props).
//   node tools/test/prop_look.mjs <asset> <out.png> [--s=3000] [--dist=12] [--h=1.4] [--side=0] [--speed=0]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const [asset, out] = pos;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${opt.base || 'http://localhost:5180'}/index.html?solo&as=gunner&s=${opt.s || 3000}&seed=7${opt.q ? '&' + opt.q : ''}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 }).catch(() => console.log('no ready'));
await page.evaluate((sp) => { window.__autodrive = { speed: sp }; }, +(opt.speed || 0));
await page.waitForTimeout(+(opt.wait || 7000));
const r = await page.evaluate(({ asset, dist, h }) => {
  const run = window.__run, p = run.states.get(1), THREE = null; void THREE;
  let best = null, bd = 1e9;
  for (const ch of run.dressing.chunks.values()) {
    const l = ch.lists.get(asset); if (!l) continue;
    for (let i = 0; i < l.n; i++) {
      const x = l.m[i * 16 + 12], y = l.m[i * 16 + 13], z = l.m[i * 16 + 14];
      const dx = x - p.pos.x, dz = z - p.pos.z, d = Math.hypot(dx, dz);
      if (d < bd && d > 15 && d < 220) { bd = d; best = [x, y, z, l.m[i * 16 + 8], l.m[i * 16 + 10]]; }
    }
  }
  if (!best) return { err: 'none found' };
  // camera: `dist` m in front of the asset's +Z face (world), looking at it; convert to the truck frame
  const q = p.quat, inv = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const rot = (v, qq) => { const tx = 2 * (qq.y * v.z - qq.z * v.y), ty = 2 * (qq.z * v.x - qq.x * v.z), tz = 2 * (qq.x * v.y - qq.y * v.x);
    return { x: v.x + qq.w * tx + qq.y * tz - qq.z * ty, y: v.y + qq.w * ty + qq.z * tx - qq.x * tz, z: v.z + qq.w * tz + qq.x * ty - qq.y * tx }; };
  const fl = Math.hypot(best[3], best[4]) || 1, fx = best[3] / fl, fz = best[4] / fl;
  const cam = { x: best[0] + fx * dist - p.pos.x, y: best[1] + h - p.pos.y, z: best[2] + fz * dist - p.pos.z };
  const tgt = { x: best[0] - p.pos.x, y: best[1] + h * 0.8 - p.pos.y, z: best[2] - p.pos.z };
  const co = rot(cam, inv), lo = rot(tgt, inv);
  window.__camOverride = { offset: [co.x, co.y, co.z], look: [lo.x, lo.y, lo.z], fov: 50 };
  return { at: best.slice(0, 3).map((v) => +v.toFixed(1)), dist: +bd.toFixed(1) };
}, { asset, dist: +(opt.dist || 12), h: +(opt.h || 1.4) });
console.log(JSON.stringify(r));
await page.waitForTimeout(600);
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
