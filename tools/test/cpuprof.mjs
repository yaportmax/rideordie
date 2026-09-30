// CPU profile of live play: self time aggregated by function and by source file.   node tools/test/cpuprof.mjs <s> [secs=8] [as=driver]
import { chromium } from 'playwright-core';
const [s = 44000, secs = 8, as = 'driver'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`http://localhost:5180/index.html?solo&as=${as}&s=${s}&seed=7`);
await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
await page.evaluate(() => new Promise((r) => { const c = () => (window.__run?.sim?.state === 'run' ? r() : setTimeout(c, 200)); c(); }));
await page.evaluate(() => { window.__autodrive = { speed: 30 }; });
await page.waitForTimeout(6000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
await page.waitForTimeout(+secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; const counts = new Map();
for (let i = 0; i < profile.samples.length; i++) counts.set(profile.samples[i], (counts.get(profile.samples[i]) || 0) + (dt[i] || 0));
const fn = new Map(), file = new Map(); let total = 0;
for (const [id, us] of counts) { const n = byId.get(id); const cf = n.callFrame; const f = (cf.url || '').replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '') || '(native)'; const k = `${cf.functionName || '(anon)'} @ ${f}:${cf.lineNumber + 1}`; fn.set(k, (fn.get(k) || 0) + us); file.set(f, (file.get(f) || 0) + us); total += us; }
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000 / secs).toFixed(2)} ms/s  ${(v / total * 100).toFixed(1)}%  ${k}`).join('\n');
console.log('== by file (ms of CPU per second of play)\n' + top(file, 22));
console.log('== by function\n' + top(fn, 30));
await browser.close();
