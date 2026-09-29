// Toggle groups of objects and screenshot each state (find which system draws an artefact).
//   node tools/test/isolate.mjs "<query>" <outPrefix> [waitMs]
import { chromium } from 'playwright-core';
const [q, prefix, wait = 7000] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5180/index.html?' + q, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.evaluate(() => { document.getElementById('boot')?.remove(); window.__autodrive = { speed: 30 }; });
await page.waitForTimeout(+wait);
await page.evaluate(() => { window.__autodrive = null; window.__forceInput = { throttle: 0, brake: 1, steer: 0, handbrake: true }; });
await page.waitForTimeout(2500);
const states = ['all', 'noCover', 'noDevil', 'noPool', 'noExtras'];
for (const st of states) {
  await page.evaluate((st) => {
    const run = window.__run, cov = run.streamer.cover.meshes, pool = run.dressing.pool.group, ex = run.dressing.extraGroup;
    const set = (o, v) => { o.visible = v; };
    window.__saveUpd = window.__saveUpd || run.streamer.update.bind(run.streamer);
    run.streamer.update = st === 'all' ? window.__saveUpd : () => {};
    for (const [k, m] of Object.entries(cov)) set(m, st === 'noCover' ? false : st === 'noDevil' && k === 'devil' ? false : m.geometry.instanceCount > 0);
    set(pool, st !== 'noPool'); set(ex, st !== 'noExtras');
  }, st);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${prefix}_${st}.png` });
}
await browser.close();
