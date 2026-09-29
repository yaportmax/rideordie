// Headless-Chrome screenshot / probe tool.
//   node tools/test/shot.mjs "<path?query>" out.png [--wait=1500] [--w=1600] [--h=900] [--eval="js"] [--base=http://localhost:5173]
// Prints console output + page errors. `--eval` runs JS in the page after waiting and prints the JSON result.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const url = (opt.base || 'http://localhost:5173') + '/' + (pos[0] || '');
const out = pos[1] || 'shots/shot.png';
const W = +(opt.w || 1600), H = +(opt.h || 900), wait = +(opt.wait || 1500);
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', m => { if (!opt.quiet) console.log('[console]', m.type(), m.text()); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: +(opt.timeout || 60000) }).catch(() => console.log('[warn] __ready not set'));
await page.waitForTimeout(wait);
if (opt.eval) { const r = await page.evaluate(opt.eval); console.log('[eval]', JSON.stringify(r)); }
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
