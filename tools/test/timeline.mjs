// Screenshots of one solo run at several moments (ms after the run starts), with optional setup JS and a per-shot probe.
//   node tools/test/timeline.mjs "<query>" <outPrefix> --at=2000,5000,9000 [--setup="js"] [--probe="js returning json"] [--base=http://localhost:5180]
// e.g. node tools/test/timeline.mjs "solo&as=driver&s=3990&seed=7" shots/threat/rb --at=4000,9000,12000 --setup="window.__autodrive={speed:22}"
import { chromium } from 'playwright-core';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const [q, out = 'shots/timeline'] = args;
const at = (opt.at || '3000').split(',').map(Number);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +(opt.w || 1600), height: +(opt.h || 900) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
await page.goto(`${opt.base || 'http://localhost:5180'}/index.html?${q}`);
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
await page.waitForFunction(() => window.__run.sim ? window.__run.sim.state === 'run' : true, null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('boot')?.remove());
if (opt.setup) await page.evaluate(opt.setup);
const t0 = Date.now();
for (let i = 0; i < at.length; i++) {
  const wait = at[i] - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  if (opt.probe) console.log(`[${at[i]}]`, JSON.stringify(await page.evaluate(opt.probe)));
  await page.screenshot({ path: `${out}_${i}.png` });
}
console.log('saved', at.length, 'shots');
await browser.close();
