// Cockpit sequence: drive with the bot, capture the cockpit view, then hold look-back (B) and capture again.
//   node tools/test/cockpit_seq.mjs "<query>" outPrefix [waitMs=20000]
import { chromium } from 'playwright-core';
const [q = 'solo&as=driver&s=6000', out = 'shots/cockpit/seq', wait = '20000'] = process.argv.slice(2);
const base = process.env.RB_BASE || 'http://localhost:5180';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base + '/index.html?' + q);
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
await page.evaluate(() => { window.__autodrive = { speed: 30 }; });
await page.waitForTimeout(+wait);
const info = await page.evaluate(() => { const r = window.__run; let n = 0, behind = 0; for (const st of r.states.values()) if (st.kind === 'enemy' && !st.exploded) { n++; if (st.pos.distanceTo(r.states.get(1).pos) < 120) behind++; } return { n, near: behind, fps: window.__perf.fps.toFixed(0), calls: window.__perf.calls }; });
console.log(JSON.stringify(info));
await page.screenshot({ path: `${out}_front.png` });
await page.keyboard.down('KeyB'); await page.waitForTimeout(400);
await page.screenshot({ path: `${out}_back.png` });
await page.keyboard.up('KeyB'); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}_front2.png` });
await browser.close();
