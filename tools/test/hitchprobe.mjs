// Drive through a stretch and log every long frame with the road position and the shader programs compiled around it.
//   node tools/test/hitchprobe.mjs <startS> <secs> [speed=40] [seed=7] [--base=http://localhost:5180]
import { chromium } from 'playwright-core';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://localhost:5180').slice(7);
const [startS = 40500, secs = 40, speed = 40, seed = 7] = args.map(Number);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/index.html?solo&as=driver&s=${startS}&seed=${seed}`);
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.waitForTimeout(2500);
const res = await page.evaluate(({ secs, speed }) => new Promise((resolve) => {
  window.__autodrive = { speed }; window.__spikes = [];
  const g = window.__game, run = window.__run, R = g.renderer;
  const names = () => new Set((R.info.programs || []).map((p) => p.name + '|' + (p.cacheKey || '').slice(0, 40)));
  let known = names(), last = performance.now(); const t0 = last, log = [], frames = [];
  const f = () => {
    const n = performance.now(), dt = n - last; last = n;
    frames.push(dt);
    const now = names(); const added = [...now].filter((k) => !known.has(k)); known = now;
    if (dt > 50 || added.length) log.push({ t: +((n - t0) / 1000).toFixed(1), s: Math.round(run.player.s), dt: Math.round(dt), progs: R.info.programs.length, added: added.map((a) => a.split('|')[0]).join(',') });
    if (n - t0 < secs * 1000) requestAnimationFrame(f);
    else {
      frames.sort((a, b) => a - b);
      resolve({ log, p50: frames[frames.length >> 1].toFixed(1), p95: frames[Math.floor(frames.length * 0.95)].toFixed(1), p99: frames[Math.floor(frames.length * 0.99)].toFixed(1), max: frames[frames.length - 1].toFixed(0), s: Math.round(run.player.s), spikes: window.__spikes.slice(0, 20), dstats: run.dressing && { stepMax: run.dressing.stats.stepMax.map((x) => +x.toFixed(1)), rebuildMax: +run.dressing.stats.rebuildMax.toFixed(1), setsMs: run.dressing.sets && +run.dressing.sets.stats.max?.toFixed?.(1) } });
    }
  };
  requestAnimationFrame(f);
}), { secs, speed });
for (const l of res.log) console.log(`t=${l.t} s=${l.s} dt=${l.dt} progs=${l.progs}${l.added ? ' +[' + l.added + ']' : ''}`);
console.log(`frames p50=${res.p50} p95=${res.p95} p99=${res.p99} max=${res.max}  end s=${res.s}`);
console.log('spikes', JSON.stringify(res.spikes));
console.log('dressing', JSON.stringify(res.dstats));
await browser.close();
