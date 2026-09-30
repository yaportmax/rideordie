// Frame-cost breakdown: median frame time with individual features toggled, in one live run.
//   node tools/test/costprobe.mjs <s> [as=driver] [seed=7]
import { chromium } from 'playwright-core';
const [s = 44000, as = 'driver', seed = 7] = process.argv.slice(2);
const base = process.env.RB_BASE || 'http://localhost:5180';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/index.html?solo&as=${as}&s=${s}&seed=${seed}`);
await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
await page.evaluate(() => new Promise((r) => { const c = () => (window.__run?.sim?.state === 'run' ? r() : setTimeout(c, 200)); c(); }));
const res = await page.evaluate(async () => {
  window.__autodrive = { speed: 30 };
  const g = window.__game, run = window.__run, post = g.post;
  const med = (secs) => new Promise((res) => { const f = []; let last = performance.now(); const t0 = last; const k = () => { const n = performance.now(); f.push(n - last); last = n; if (n - t0 < secs * 1000) requestAnimationFrame(k); else { f.sort((a, b) => a - b); res(+f[f.length >> 1].toFixed(1)); } }; requestAnimationFrame(k); });
  const out = {};
  await med(6);
  run.sim.step = () => {};   // freeze the world: every config renders the same frame
  await med(1);
  out.base = await med(4);
  out.calls = window.__perf.calls; out.tris = window.__perf.tris;
  const ck = run.cockpit; if (ck) { const o = ck.renderMirrors; ck.renderMirrors = () => {}; out.noMirrors = await med(4); ck.renderMirrors = o; }
  if (post) {
    const q0 = post.quality ?? g.quality;
    for (const q of [2, 1, 0]) { post.setQuality(q); await med(1); out['q' + q] = await med(4); }
    post.setQuality(q0); await med(1);
    const rs = post.resolutionScale ?? 1; post.setResolutionScale?.(0.75); await med(1); out.res75 = await med(4); post.setResolutionScale?.(rs); await med(1);
    const en = post.enabled; post.enabled = false; await med(1); out.noPost = await med(4); post.enabled = en; await med(1);
  }
  const sh = g.renderer.shadowMap.enabled; g.renderer.shadowMap.autoUpdate = false; await med(1); out.noShadowUpdate = await med(4); g.renderer.shadowMap.autoUpdate = true;
  const dr = run.dressing?.group || run.dressing?.root; if (dr) { dr.visible = false; await med(1); out.noDressing = await med(4); dr.visible = true; }
  out.quality = g.quality; out.sim = +window.__perf.sim.toFixed(1); out.render = +window.__perf.render.toFixed(1);
  return out;
});
console.log(JSON.stringify(res));
await browser.close();
