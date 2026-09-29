// Prints the instance counts of the near-road cover field kinds + a few pool entries at a spot.
//   node tools/test/cover_count.mjs <s> [seed]
import { chromium } from 'playwright-core';
const s = process.argv[2] || 3500, seed = process.argv[3] || 7;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5180/index.html?solo&as=driver&s=${s}&seed=${seed}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.evaluate(() => { window.__forceInput = { throttle: 0, brake: 1, steer: 0, handbrake: true }; });
await page.waitForTimeout(7000);
console.log(await page.evaluate(() => {
  const run = window.__run, cov = run.streamer.cover, out = {};
  for (const [k, m] of Object.entries(cov.meshes)) out[k] = m.geometry.instanceCount + (m.visible ? '' : ' (hidden)');
  const pool = {}; for (const ch of run.dressing.chunks.values()) for (const [k, l] of ch.lists) if (/wreck|skeleton|barrel|tire_stack|delineator|chevron|warn_curve|fence/.test(k)) pool[k] = (pool[k] || 0) + l.n;
  return JSON.stringify({ cover: out, pool, calls: window.__perf.calls });
}));
await browser.close();
