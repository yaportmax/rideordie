// N screenshots in a row while autodriving (for spotting transient artefacts).
//   node tools/test/seq_shots.mjs "<query>" <outPrefix> [n=8] [gapMs=1200] [speed=30]
import { chromium } from 'playwright-core';
const [q, prefix, n = 8, gap = 1200, speed = 30] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5180/index.html?' + q, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.evaluate((sp) => { document.getElementById('boot')?.remove(); window.__autodrive = { speed: +sp }; }, speed);
await page.waitForTimeout(5000);
for (let i = 0; i < +n; i++) { await page.screenshot({ path: `${prefix}_${i}.png` }); await page.waitForTimeout(+gap); }
await browser.close();
