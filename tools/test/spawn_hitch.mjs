// Long frames vs raider spawns: which hitches come from new car views (CarView + crew) being built?
//   node tools/test/spawn_hitch.mjs [startS=1500] [secs=30] [seed=7] [--base=http://localhost:5180] [--as=driver]
// Prints every frame > 40 ms with: the view-build time inside WorldView.ensure that frame, how many car views were built, and the
// sim events (enemySpawn / encounter / minibossSpawn) emitted in that frame. Summary: frames > 50 ms with / without a view build.
import { chromium } from 'playwright-core';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const [startS = 1500, secs = 30, seed = 7] = args.map(Number);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${opt.base || 'http://localhost:5180'}/index.html?solo&as=${opt.as || 'driver'}&s=${startS}&seed=${seed}`);
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
const res = await page.evaluate((secs) => new Promise((resolve) => {
  document.getElementById('boot')?.remove();
  window.__autodrive = { speed: 33 };
  const run = window.__run, wv = run.wv, sim = run.sim;
  let buildMs = 0, built = 0, evs = [];
  const ensure = wv.ensure.bind(wv);
  wv.ensure = (st) => { if (wv.cars.has(st.id)) return ensure(st); const t = performance.now(); const r = ensure(st); buildMs += performance.now() - t; built++; return r; };
  const emit = sim.emit.bind(sim);
  sim.emit = (e) => { if (/enemySpawn|encounter|minibossSpawn|setPiece|explode/.test(e.t)) evs.push(e.t + (e.spec ? ':' + e.spec : e.key ? ':' + e.key : '')); return emit(e); };
  let last = performance.now(); const t0 = last, log = [], frames = [];
  const f = () => {
    // (the game's rAF callback runs before ours each frame: the ensure() work recorded so far belongs to the frame just measured)
    const n = performance.now(), dt = n - last; last = n; frames.push({ dt, b: built });
    if (dt > 40 || built) log.push({ t: +((n - t0) / 1000).toFixed(2), dt: Math.round(dt), buildMs: Math.round(buildMs), built, evs: evs.join(' ') });
    buildMs = 0; built = 0; evs = [];
    if (n - t0 < secs * 1000) requestAnimationFrame(f);
    else {
      const long = frames.filter((x) => x.dt > 50), withB = frames.filter((x) => x.b > 0);
      window.__sh = { withBuild: withB.length, withBuildLong: withB.filter((x) => x.dt > 50).length, rate: (long.length / frames.length).toFixed(3) };
      const ds = frames.map((x) => x.dt).sort((a, b) => a - b);
      resolve({ log, n: frames.length, long: long.length, longWithBuild: long.filter((x) => x.b > 0).length, p99: ds[Math.floor(ds.length * 0.99)].toFixed(1), max: ds[ds.length - 1].toFixed(0), cars: sim.director.spawned, sh: window.__sh, simT: +sim.time.toFixed(1), s: Math.round(run.player.s), views: wv.cars.size, st: sim.state });
    }
  };
  requestAnimationFrame(f);
}), secs);
for (const l of res.log) console.log(`t=${l.t} dt=${l.dt} build=${l.buildMs}ms views=${l.built} ${l.evs}`);
console.log(JSON.stringify({ sh: res.sh, simT: res.simT, s: res.s, views: res.views, st: res.st }));
console.log(`frames ${res.n}  >50ms: ${res.long} (with a view build: ${res.longWithBuild})  p99 ${res.p99}  max ${res.max}  raiders spawned ${res.cars}`);
await browser.close();
