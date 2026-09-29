// Capture frames around the first occurrence of a sim event in a solo run.
//   node tools/test/moment.mjs <eventType> "<query>" [frames=4] [gapMs=180] [outPrefix]
import { chromium } from 'playwright-core';
const [ev = 'explode', q = 'solo&s=20000&maxed=1', nf = '4', gap = '180', out = 'shots/moment'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5180/index.html?' + q);
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
await page.evaluate((ev) => {
  window.__autodrive = { speed: 30 }; window.__aimbot = true; window.__seen = 0;
  const run = window.__run, orig = run.sim.emit.bind(run.sim);
  run.sim.emit = (e) => { if (e.t === ev && !window.__seen) { window.__seen = performance.now(); window.__seenEv = e; } return orig(e); };
}, ev);
await page.waitForFunction('window.__seen > 0', null, { timeout: 120000 }).catch(() => console.log('event not seen'));
for (let i = 0; i < +nf; i++) { await page.waitForTimeout(i === 0 ? 60 : +gap); await page.screenshot({ path: `${out}_${i}.png` }); }
console.log('event', await page.evaluate('JSON.stringify(window.__seenEv)'));
await browser.close();
