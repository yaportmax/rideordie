// In-game stills of the Leviathan from the chase positions (behind / behind-sides, 10-60 m), optionally with a test GLB swapped in.
//   node tools/blender/vehicles/enemy_b/boss_shots.mjs <outPrefix> [--glb=shots/enemy_b/test/boss_warrig.glb] [--s=59320] [--seed=7]
//        [--views=rear12,rear30,rear60,rqL,rqR,sideL,gunner,top] [--base=http://localhost:5180] [--hud]
// Camera points are given in the BOSS frame (+Z forward, +X left, origin on the ground at mid-train) and converted every frame into the
// player-truck frame used by window.__camOverride.  The live fight keeps running; HUD / part markers are hidden unless --hud.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const prefix = pos[0] || 'shots/enemy_b/boss/ingame/b';
const VIEWS = {
  rear12: { cam: [0.9, 2.5, -29.5], look: [0, 5.2, -17], fov: 55 },
  rear30: { cam: [-1.8, 2.8, -47], look: [0, 5.4, -16], fov: 38 },
  rear60: { cam: [-3.0, 3.0, -77], look: [0, 5.2, -14], fov: 26 },
  rqL: { cam: [9.5, 3.0, -31], look: [0.5, 5.0, -15], fov: 48 },
  rqR: { cam: [-10, 2.7, -27], look: [-0.5, 4.6, -13], fov: 52 },
  sideL: { cam: [15, 3.6, -15], look: [0, 4.6, -11], fov: 50 },
  gunner: { cam: [1.2, 3.8, -25], look: [0, 6.2, -16], fov: 62 },
  top: { cam: [6, 14, -30], look: [0, 6, -14], fov: 45 },
};
const views = (opt.views || 'rear12,rear30,rear60,rqL,rqR,sideL,gunner').split(',');
fs.mkdirSync(path.dirname(prefix), { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: +(opt.w || 1600), height: +(opt.h || 900) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
if (opt.glb) {
  const buf = fs.readFileSync(opt.glb);
  await page.route('**/models/vehicles/boss_warrig.glb*', (route) => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: buf }));
  console.log('boss GLB ->', opt.glb, (buf.length / 1048576).toFixed(2), 'MB');
}
await page.goto(`${opt.base || 'http://localhost:5180'}/index.html?solo&as=driver&s=${opt.s || 59320}&seed=${opt.seed || 7}&maxed=1`);
await page.waitForFunction('window.__ready === true', null, { timeout: 150000 });
await page.evaluate((hud) => {
  document.getElementById('boot')?.remove();
  window.__autodrive = { speed: 30 };
  if (!hud) {
    const st = document.createElement('style'); st.textContent = 'body > *:not(canvas) { visibility: hidden !important; } body > canvas { visibility: visible !important; }'; document.head.appendChild(st);
  }
}, !!opt.hud);
// wait for the boss to be spawned and within ~70 m
const t0 = Date.now();
for (;;) {
  const r = await page.evaluate(() => { const R = window.__run, B = R.sim.boss, P = R.player; if (!B) return null; return { d: B.s - P.s, ph: B.phase, t: B.t }; });
  if (r && r.d < 75 && r.t > 6) { console.log('boss in range', JSON.stringify(r)); break; }
  if (Date.now() - t0 > 150000) { console.log('boss never came in range', JSON.stringify(r)); break; }
  await page.waitForTimeout(1000);
}
for (const v of views) {
  const V = VIEWS[v]; if (!V) continue;
  await page.evaluate((V) => {
    const R = window.__run; if (!R.bossMarks?.__off && !window.__bossHud) { if (R.bossMarks) { R.bossMarks.update = () => {}; R.bossMarks.group.visible = false; R.bossMarks.__off = true; } }
    const T = R.player.veh;  // truck (sim) frame
    const B = R.sim.boss;
    const Q = (q) => [q.x, q.y, q.z, q.w];
    const rot = (q, p) => { const [x, y, z, w] = q, [px, py, pz] = p; const ix = w * px + y * pz - z * py, iy = w * py + z * px - x * pz, iz = w * pz + x * py - y * px, iw = -x * px - y * py - z * pz; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
    const inv = (q) => [-q[0], -q[1], -q[2], q[3]];
    const toTruck = (pb) => { const w = rot(Q(B.quat), pb); const d = [B.pos.x + w[0] - T.pos.x, B.pos.y + w[1] - T.pos.y, B.pos.z + w[2] - T.pos.z]; return rot(inv(Q(T.quat)), d); };
    clearInterval(window.__bossCamT);
    const upd = () => { window.__camOverride = { offset: toTruck(V.cam), look: toTruck(V.look), fov: V.fov }; };
    upd(); window.__bossCamT = setInterval(upd, 8);
  }, V);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${prefix}_${v}.png` });
  console.log('saved', `${prefix}_${v}.png`);
}
await browser.close();
