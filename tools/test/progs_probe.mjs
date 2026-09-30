// Lists shader programs compiled after the run started (name, time, road distance, frame time) - mid-run compiles cause hitches.
//   node tools/test/progs_probe.mjs "<query>" [secs=30] [speed=50]
import { chromium } from 'playwright-core';
const q = process.argv[2] || 'solo&s=9000&seed=7', secs = +(process.argv[3] || 30), speed = +(process.argv[4] || 50);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5180/index.html?' + q);
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(({ secs, speed }) => new Promise((res) => {
  const R = window.__game.renderer, seen = new Set(R.info.programs.map((p) => p.cacheKey)), out = [];
  window.__autodrive = { speed };
  const t0 = performance.now(); let last = t0;
  const f = () => {
    const n = performance.now(), dt = n - last; last = n;
    for (const p of R.info.programs) if (!seen.has(p.cacheKey)) { seen.add(p.cacheKey); out.push({ t: +((n - t0) / 1000).toFixed(1), s: Math.round(window.__run.playerS || 0), name: p.name, frame: Math.round(dt) }); }
    if (n - t0 < secs * 1000) requestAnimationFrame(f); else res(out);
  };
  requestAnimationFrame(f);
}), { secs, speed });
for (const x of r) console.log(JSON.stringify(x));
console.log('new programs:', r.length);
await browser.close();
