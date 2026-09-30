// Dressing job step costs (ms, max per stage) + dressing spikes while autodriving.
//   node tools/test/dress_stats.mjs "<query>" [secs=30] [speed=55]
import { chromium } from 'playwright-core';
const q = process.argv[2] || 'solo&s=22000&seed=7', secs = +(process.argv[3] || 30), speed = +(process.argv[4] || 55);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5180/index.html?' + q);
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.waitForTimeout(2000);
await page.evaluate((sp) => { window.__spikes = []; window.__autodrive = { speed: sp }; const d = window.__run.dressing; d.stats.stepMax.fill(0); d.stats.rebuildMax = 0; if (window.__coverStats) window.__coverStats.maxMs = 0; }, speed);
await page.waitForTimeout(secs * 1000);
console.log(await page.evaluate(() => { const d = window.__run.dressing; const sp = window.__spikes.filter((x) => x.what === 'dressing'); return JSON.stringify({ cover: window.__coverStats, stepMax: d.stats.stepMax.map((v) => +v.toFixed(1)), rebuildMax: +d.stats.rebuildMax.toFixed(1), dressSpikes: sp.length, dressMax: Math.max(0, ...sp.map((x) => x.ms)), terrainMsg: window.__spikes.filter((x) => x.what === 'terrainMsg').length, s: Math.round(window.__run.playerS) }); }));
await browser.close();
