// Fast-forward to the Leviathan's death and capture the finale. node tools/test/finale.mjs
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5180/index.html?solo&s=59300&maxed=1');
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
await page.evaluate('window.__autodrive = { speed: 40 }; window.__aimbot = true;');
await page.waitForFunction('window.__run.sim.boss', null, { timeout: 90000 });
await page.waitForTimeout(4000);
// weaken every part so the aimbot finishes it quickly
await page.evaluate(() => { const B = window.__run.sim.boss; for (const k of Object.keys(B.hp)) B.hp[k] = Math.min(B.hp[k], 60); });
await page.waitForFunction('window.__run.sim.boss && window.__run.sim.boss.dead', null, { timeout: 120000 });
const shots = [300, 1200, 2500, 4200, 6500, 9000];
let t0 = Date.now();
for (let i = 0; i < shots.length; i++) { const w = shots[i] - (Date.now() - t0); if (w > 0) await page.waitForTimeout(w); await page.screenshot({ path: `shots/finale_${i}.png` }); }
await page.waitForTimeout(8000);
console.log(await page.evaluate('JSON.stringify({state: window.__run.sim.state, won: window.__run.sim.won, summary: !!window.__run.summary, finished: window.__run.finished, over: window.__run.over, overT: window.__run.overT, slow: window.__run.slowmo, wonT: window.__run.sim.wonT, t: window.__run.sim.time})'));
await browser.close();
