// Run a list of [name, js] steps in ONE page session and screenshot after each (for tuning the front-end stages).
//   node tools/test/steps_shots.mjs steps.json <outPrefix> [--base=http://localhost:5180] [--w=1920] [--h=1080]
// steps.json: [["name", "async js body (can await)"], ...]; each body runs inside an async IIFE; `sleep(ms)` is available.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const steps = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
const prefix = pos[1] || 'shots/frontend/s_';
fs.mkdirSync(path.dirname(prefix), { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +(opt.w || 1920), height: +(opt.h || 1080) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
await page.goto((opt.base || 'http://localhost:5180') + '/' + (opt.page || 'index.html'), { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
for (const [name, js] of steps) {
  let r;
  try { r = await page.evaluate(`(async () => { const sleep = (ms) => new Promise((res) => setTimeout(res, ms)); ${js} })()`); } catch (e) { console.log('[step error]', name, e.message.slice(0, 300)); }
  if (name.startsWith('_')) { if (r !== undefined) console.log(name, JSON.stringify(r)); continue; }
  const out = `${prefix}${name}.png`;
  await page.screenshot({ path: out });
  console.log('saved', out, r !== undefined ? JSON.stringify(r) : '');
}
await browser.close();
