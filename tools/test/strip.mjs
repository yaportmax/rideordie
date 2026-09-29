// Frame strip right after a run loads: node tools/test/strip.mjs "<query>" outPrefix [n=8] [gapMs=450] [startDelayMs=0]
import { chromium } from 'playwright-core';
const [q = 'solo&as=driver&s=1200', out = 'shots/strip', n = '8', gap = '450', delay = '0'] = process.argv.slice(2);
const base = process.env.RB_BASE || 'http://localhost:5180';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base + '/index.html?' + q);
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
await page.waitForTimeout(+delay);
for (let i = 0; i < +n; i++) { await page.screenshot({ path: `${out}_${i}.png` }); console.log(i, await page.evaluate('JSON.stringify({cd: window.__run.countdown?.toFixed(2), st: window.__run.sim?.state, out: window.__run.introOutside})')); await page.waitForTimeout(+gap); }
await browser.close();
