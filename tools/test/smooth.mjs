// Smoothness probe: frame-time distribution + camera/car motion jitter while driving.
//   node tools/test/smooth.mjs "<query>" [secs=20] [speed=40]
import { chromium } from 'playwright-core';
const q = process.argv[2] || 'solo&s=2000&truck=truck_t2', secs = +(process.argv[3] || 20), speed = +(process.argv[4] || 40);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5180/index.html?' + q);
if (process.env.CHASE) await page.addInitScript('window.__chase = true');
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
await page.evaluate((sp) => { window.__autodrive = { speed: sp }; window.__game.run.sim.director.enabled = !!window.__enemies; if (window.__chase) window.__game.run.role = 'driver'; }, speed);
await page.waitForTimeout(6000);
const r = await page.evaluate((secs) => new Promise((res) => {
  const g = window.__game, cam = g.camera, run = g.run;
  const frames = []; const t0 = performance.now();
  let prevOff = null, prevLast = g.last, prevCar = null;
  const V = cam.position.constructor, Q = cam.quaternion.constructor;
  const step = () => {
    const car = run.states.get(1);
    const dtg = g.last - prevLast; prevLast = g.last;
    // camera offset expressed in the truck frame: what the player sees as the truck "moving" on screen
    const inv = new Q().copy(car.quat).invert();
    const off = cam.position.clone().sub(car.pos).applyQuaternion(inv);
    const dOff = prevOff ? off.distanceTo(prevOff) * 1000 : 0;   // mm per frame
    // car position error vs its own velocity (render interpolation quality)
    const perr = prevCar && dtg > 0 ? car.pos.clone().sub(prevCar).sub(car.vel.clone().multiplyScalar(dtg / 1000)).length() * 1000 : 0;
    frames.push({ dt: dtg, dOff, perr, speed: car.speed });
    prevOff = off; prevCar = car.pos.clone();
    if (performance.now() - t0 < secs * 1000) requestAnimationFrame(step); else res(frames.slice(2));
  };
  requestAnimationFrame(step);
}), secs);
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const dts = r.map((f) => f.dt), dOff = r.map((f) => f.dOff), perr = r.map((f) => f.perr);
console.log(`frames ${r.length} | game dt ms p50 ${pct(dts, 0.5).toFixed(1)} p95 ${pct(dts, 0.95).toFixed(1)} max ${Math.max(...dts).toFixed(1)}`);
console.log(`camera-vs-truck offset change mm/frame: p50 ${pct(dOff, 0.5).toFixed(1)} p95 ${pct(dOff, 0.95).toFixed(1)} max ${Math.max(...dOff).toFixed(0)}`);
console.log(`truck position error vs velocity mm/frame: p50 ${pct(perr, 0.5).toFixed(1)} p95 ${pct(perr, 0.95).toFixed(1)} max ${Math.max(...perr).toFixed(0)} | speed ${(r[r.length - 1].speed * 3.6).toFixed(0)} km/h`);
console.log('seq dOff', r.slice(100, 130).map((f) => f.dOff.toFixed(0)).join(' '));
console.log('seq perr', r.slice(100, 130).map((f) => f.perr.toFixed(0)).join(' '));
console.log('seq dt  ', r.slice(100, 130).map((f) => f.dt.toFixed(1)).join(' '));
const hitches = (await page.evaluate('window.__hitches || []')).slice(-8);
console.log('hitches', JSON.stringify(hitches.map((h) => ({ at: h.at, sim: h.sim, render: h.render, chunks: h.chunks }))));
await browser.close();
