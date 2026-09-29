// CPU-profile a drive and attribute the long frames (> threshold) to functions (self time of the samples inside each long frame).
//   node tools/test/hitchprof.mjs <startS> <secs> [speed=45] [seed=7] [--thr=150] [--base=http://localhost:5180]
import { chromium } from 'playwright-core';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const base = opt.base || 'http://localhost:5180', thr = +(opt.thr || 150);
const [startS = 44000, secs = 30, speed = 45, seed = 7] = args.map(Number);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${base}/index.html?solo&as=driver&s=${startS}&seed=${seed}`);
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.waitForTimeout(2500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
const res = await page.evaluate(({ secs, speed }) => new Promise((resolve) => {
  window.__autodrive = { speed };
  const long = []; let last = performance.now(); const t0 = last;
  const f = () => { const n = performance.now(); if (n - last > 0) { if (n - last > 50) long.push([last, n]); } last = n; if (n - t0 < secs * 1000) requestAnimationFrame(f); else resolve({ long, origin: performance.timeOrigin, s: Math.round(window.__run.player.s) }); };
  requestAnimationFrame(f);
}), { secs, speed });
const { profile } = await cdp.send('Profiler.stop');
await browser.close();
// sample times: profile.startTime (us, monotonic) + cumulative timeDeltas. Map to page time via timeOrigin: monotonic ~ timeOrigin*1000 - (Date.now()-perf) ... use relative alignment: the last sample ~ end of the run.
const nodes = new Map(); for (const n of profile.nodes) nodes.set(n.id, n);
let t = profile.startTime; const times = profile.timeDeltas.map((d) => (t += d));
const endPage = res.long.length ? Math.max(...res.long.map((l) => l[1])) : 0;
// align: profile.endTime corresponds to (roughly) the end of the evaluate promise; use the relation between the profiler clock and performance.now via the known window: assume endTime ~ last rAF time + small slack
const lastRaf = endPage;
const off = profile.endTime / 1000 - (lastRaf + 30);
for (const [a, b] of res.long) {
  const dur = b - a; if (dur < thr) continue;
  const agg = new Map();
  for (let i = 0; i < times.length; i++) {
    const ms = times[i] / 1000 - off; if (ms < a || ms > b) continue;
    const n = nodes.get(profile.samples[i]); const cf = n.callFrame;
    const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
    agg.set(key, (agg.get(key) || 0) + 0.5);
  }
  const top = [...agg.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${v.toFixed(0)}ms ${k}`);
  console.log(`\nLONG FRAME ${dur.toFixed(0)} ms at t=${(a / 1000).toFixed(1)}s`); for (const l of top) console.log('   ', l);
}
console.log('end s', res.s);
