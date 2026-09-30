// Dressing pool draw report (per asset: instances, shadow instances, draws) at a spot.
//   node tools/test/pool_report.mjs "<query>" [waitMs]
import { chromium } from 'playwright-core';
const q = process.argv[2] || 'solo&as=driver&s=23000&seed=7', wait = +(process.argv[3] || 9000);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5180/index.html?' + q, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.evaluate(() => { window.__autodrive = { speed: 30 }; });
await page.waitForTimeout(wait);
console.log(await page.evaluate(() => { const r = window.__run.dressing.pool.report(); let d = 0; for (const x of r) d += x.draws; return 'draws ' + d + '\n' + r.sort((a, b) => b.draws - a.draws).slice(0, 30).map((x) => `${x.name} n=${x.n} sh=${x.nShadow} parts=${x.parts} draws=${x.draws}`).join('\n'); }));
await browser.close();
