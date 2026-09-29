import { chromium } from 'playwright-core';
const [startS = 1500, secs = 35, seed = 5] = process.argv.slice(2).map(Number);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:5180/index.html?solo&as=driver&s=${startS}&seed=${seed}`);
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.waitForTimeout(2500);
const res = await page.evaluate((secs) => new Promise((resolve) => {
  window.__autodrive = { speed: 33 };
  const R = window.__game.renderer, run = window.__run, sim = run.sim;
  let evs = []; const emit = sim.emit.bind(sim); sim.emit = (e) => { if (/enemySpawn|remove|explode|shot/.test(e.t)) evs.push(e.t); return emit(e); };
  let last = performance.now(), t0 = last, g0 = R.info.memory.geometries, x0 = R.info.memory.textures, p0 = R.info.programs.length; const log = [];
  const f = () => {
    const n = performance.now(), dt = n - last; last = n;
    const g = R.info.memory.geometries, x = R.info.memory.textures, p = R.info.programs.length;
    if (dt > 60) log.push(`t=${((n - t0) / 1000).toFixed(1)} dt=${dt | 0} geo+${g - g0} tex+${x - x0} prog+${p - p0} ev=${[...new Set(evs)].join(',')} cars=${sim.cars.size}`);
    g0 = g; x0 = x; p0 = p; evs = [];
    if (n - t0 < secs * 1000) requestAnimationFrame(f); else resolve(log);
  };
  requestAnimationFrame(f);
}), secs);
console.log(res.join('\n'));
await browser.close();
