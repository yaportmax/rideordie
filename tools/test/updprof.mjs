// Per-subsystem CPU time (ms/frame) during live play.   node tools/test/updprof.mjs <s> [as=driver] [secs=8]
import { chromium } from 'playwright-core';
const [s = 14000, as = 'driver', secs = 8] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`http://localhost:5180/index.html?solo&as=${as}&s=${s}&seed=7`);
await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
await page.evaluate(() => new Promise((r) => { const c = () => (window.__run?.sim?.state === 'run' ? r() : setTimeout(c, 200)); c(); }));
const res = await page.evaluate(async (secs) => {
  window.__autodrive = { speed: 30 };
  await new Promise((r) => setTimeout(r, 6000));
  const g = window.__game, run = window.__run, acc = {};
  const wrap = (obj, fn, key) => { if (!obj || typeof obj[fn] !== 'function') return; const o = obj[fn].bind(obj); obj[fn] = (...a) => { const t = performance.now(); const r = o(...a); acc[key] = (acc[key] || 0) + performance.now() - t; return r; }; };
  wrap(run, 'update', 'run.update(total)'); wrap(run.sim, 'step', 'sim.step'); wrap(run.wv, 'update', 'worldView'); wrap(run.dressing, 'update', 'dressing');
  wrap(g.fx, 'update', 'fx.update'); wrap(g.fx, 'handleEvent', 'fx.events'); wrap(g.fx, 'updateCar', 'fx.updateCar'); wrap(g.audio, 'update', 'audio'); wrap(run.abridge, 'updateCar', 'audio.cars'); wrap(run.abridge, 'update', 'audio.bridge');
  wrap(run.cockpit, 'update', 'cockpit'); wrap(run.cockpit, 'renderMirrors', 'mirrors'); wrap(run.threatHud, 'update', 'threatHud'); wrap(g.hud, 'update', 'hud');
  wrap(g.post, 'render', 'post.render'); wrap(g.sky, 'update', 'sky'); wrap(run.streamer, 'update', 'streamer'); wrap(run, '_camera', 'camera');
  if (run.aiGunner) wrap(run.aiGunner, 'update', 'aiGunner'); if (run.aiDriver) wrap(run.aiDriver, 'update', 'aiDriver'); if (run.gunner) wrap(run.gunner, 'update', 'gunner');
  let frames = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { frames++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
  const out = { frames, fps: +(frames / secs).toFixed(1), calls: window.__perf.calls };
  for (const [k, v] of Object.entries(acc).sort((a, b) => b[1] - a[1])) out[k] = +(v / frames).toFixed(2);
  return out;
}, +secs);
console.log(JSON.stringify(res, null, 0));
await browser.close();
