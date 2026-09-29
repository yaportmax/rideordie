// Camera on the nearest tumbleweed path ahead (from the truck frame), 3 shots 0.8 s apart.
import { chromium } from 'playwright-core';
const s = process.argv[2] || 3500, out = process.argv[3] || 'shots/ground/tumble';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5180/index.html?solo&as=driver&s=${s}&seed=7`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.evaluate(() => { document.getElementById('boot')?.remove(); window.__forceInput = { throttle: 0, brake: 1, steer: 0, handbrake: true }; });
await page.waitForTimeout(6000);
console.log(await page.evaluate(() => {
  const run = window.__run, p = run.states.get(1), m = run.streamer.cover.meshes.tumble, a = m.geometry.attributes.aInst.data.array, n = m.geometry.instanceCount;
  let best = null, bd = 1e9;
  for (let i = 0; i < n; i++) { const x = a[i * 8] + m.position.x, y = a[i * 8 + 1] + m.position.y, z = a[i * 8 + 2] + m.position.z; const d = Math.hypot(x - p.pos.x, z - p.pos.z); if (d > 8 && d < bd) { bd = d; best = [x, y, z]; } }
  if (!best) return 'none';
  const q = p.quat, inv = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const rot = (v, qq) => { const tx = 2 * (qq.y * v.z - qq.z * v.y), ty = 2 * (qq.z * v.x - qq.x * v.z), tz = 2 * (qq.x * v.y - qq.y * v.x); return { x: v.x + qq.w * tx + qq.y * tz - qq.z * ty, y: v.y + qq.w * ty + qq.z * tx - qq.x * tz, z: v.z + qq.w * tz + qq.x * ty - qq.y * tx }; };
  const tgt = rot({ x: best[0] - p.pos.x, y: best[1] + 0.5 - p.pos.y, z: best[2] - p.pos.z }, inv);
  window.__camOverride = { offset: [0, 7, 0], look: [tgt.x, tgt.y, tgt.z], fov: 75 };
  return 'dist ' + bd.toFixed(0);
}));
for (let i = 0; i < 3; i++) { await page.waitForTimeout(800); await page.screenshot({ path: `${out}_${i}.png` }); }
await browser.close();
