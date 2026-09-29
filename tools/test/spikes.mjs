import { chromium } from 'playwright-core';
const q = process.argv[2] || 'solo&s=8500&truck=truck_t3', secs = +(process.argv[3] || 45);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5180/index.html?' + q);
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
await page.waitForTimeout(3000);
await page.evaluate('window.__spikes = []; window.__hitches = []; window.__autodrive = { speed: 45 };');
const t0 = Date.now();
const r = await page.evaluate((secs) => new Promise((res) => { let last = performance.now(), worst = []; const f = () => { const n = performance.now(); if (n - last > 40) worst.push(+(n - last).toFixed(0)); last = n; if (n - t0 < secs * 1000) requestAnimationFrame(f); else res(worst); }; const t0 = performance.now(); requestAnimationFrame(f); }), secs);
console.log('long frames (>40ms):', r.length, r.slice(0, 30).join(' '));
const sp = await page.evaluate('window.__spikes');
const agg = {}; for (const x of sp) { const k = x.what; agg[k] = agg[k] || { n: 0, max: 0, sum: 0 }; agg[k].n++; agg[k].max = Math.max(agg[k].max, x.ms); agg[k].sum += x.ms; }
console.log('spikes by source', JSON.stringify(agg));
console.log('hitches', JSON.stringify(await page.evaluate('window.__hitches')));
console.log('s', await page.evaluate('window.__run.player.s | 0'));
await browser.close();
