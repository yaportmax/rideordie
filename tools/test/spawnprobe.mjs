// Long-frame attribution: logs every frame > 45 ms with its sim/render split, events, and GPU-resource deltas (programs,
// geometries, textures) so spawn / encounter hitches can be traced.   node tools/test/spawnprobe.mjs <startS> <secs> [seed] [as]
import { chromium } from 'playwright-core';
const [startS = 14000, secs = 45, seed = 7, as = 'driver'] = process.argv.slice(2);
const base = process.env.RB_BASE || 'http://localhost:5180';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/index.html?solo&as=${as}&s=${startS}&seed=${seed}`);
await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
await page.evaluate(() => new Promise((r) => { const c = () => (window.__run?.sim?.state === 'run' ? r() : setTimeout(c, 200)); c(); }));
const res = await page.evaluate((secs) => new Promise((resolve) => {
  window.__autodrive = { speed: 32 };
  const g = window.__game, run = window.__run, R = g.renderer, M = R.info.memory;
  // wrap the frame to time sim vs render ourselves
  const origUpd = run.update.bind(run); let simMs = 0; run.update = (...a) => { const t = performance.now(); const r = origUpd(...a); simMs = performance.now() - t; return r; };
  const post = g.post; let rMs = 0; if (post) { const o = post.render.bind(post); post.render = (...a) => { const t = performance.now(); const r = o(...a); rMs = performance.now() - t; return r; }; }
  let last = performance.now(), prev = { p: R.info.programs.length, g: M.geometries, t: M.textures, cars: run.states.size };
  const t0 = last, log = [], frames = [];
  const f = () => {
    const n = performance.now(), dt = n - last; last = n; frames.push(dt);
    const cur = { p: R.info.programs.length, g: M.geometries, t: M.textures, cars: run.states.size };
    if (dt > 45) log.push({ t: +((n - t0) / 1000).toFixed(1), dt: Math.round(dt), sim: Math.round(simMs), render: Math.round(rMs), dProg: cur.p - prev.p, dGeo: cur.g - prev.g, dTex: cur.t - prev.t, cars: cur.cars, dCars: cur.cars - prev.cars, ev: [...new Set((run.allEvents || []).map((e) => e.t))].join(',').slice(0, 90) });
    prev = cur;
    if (n - t0 < secs * 1000) requestAnimationFrame(f);
    else { frames.sort((a, b) => a - b); resolve({ log, p50: frames[frames.length >> 1].toFixed(1), p95: frames[Math.floor(frames.length * 0.95)].toFixed(1), p99: frames[Math.floor(frames.length * 0.99)].toFixed(1), max: frames[frames.length - 1].toFixed(0) }); }
  };
  requestAnimationFrame(f);
}), +secs);
for (const l of res.log) console.log(JSON.stringify(l));
console.log(`frames p50=${res.p50} p95=${res.p95} p99=${res.p99} max=${res.max}`);
await browser.close();
