// Visible draw-call breakdown by category in a running solo game. node tools/test/drawcalls.mjs "<query>" [waitMs]
import { chromium } from 'playwright-core';
const q = process.argv[2] || 'solo&s=26000&maxed=1&seed=3', wait = +(process.argv[3] || 16000);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5180/index.html?' + q);
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
await page.evaluate('window.__autodrive = { speed: 30 }; window.__aimbot = true;');
await page.waitForTimeout(wait);
const r = await page.evaluate(() => {
  const g = window.__game, cam = g.camera;
  cam.updateMatrixWorld();
  const fr = new cam.constructor().constructor; // unused
  const cats = {}; let tot = 0, shadowCasters = 0;
  g.scene.traverseVisible((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine)) return;
    let p = o, cat = 'other:' + (o.parent?.name || '?');
    while (p) {
      if (/^car_/.test(p.name)) { cat = 'car'; break; }
      if (/^crew_/.test(p.name)) { cat = 'crew'; break; }
      if (p.name === 'terrain') { cat = 'terrain'; break; }
      if (p.name === 'boss') { cat = 'boss'; break; }
      if (/weapon/.test(p.name)) { cat = 'weapon'; break; }
      p = p.parent;
    }
    if (cat.startsWith('other')) cat = 'other';
    const n = Array.isArray(o.material) ? o.material.length : (o.geometry?.groups?.length || 1);
    cats[cat] = (cats[cat] || 0) + n; tot += n; if (o.castShadow) shadowCasters += n;
  });
  return { tot, shadowCasters, cats, perf: { fps: window.__perf.fps.toFixed(0), calls: window.__perf.calls, tris: window.__perf.tris, render: window.__perf.render.toFixed(1) }, cars: window.__run.states.size };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
