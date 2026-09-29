// Checks that near-road cover instances (debris, pebbles, tumbleweed paths) and pooled props sit on the ground (physics ray down).
//   node tools/test/float_check.mjs <s> [seed]
import { chromium } from 'playwright-core';
const s = process.argv[2] || 3000, seed = process.argv[3] || 7;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5180/index.html?solo&as=driver&s=${s}&seed=${seed}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.evaluate(() => { window.__forceInput = { throttle: 0, brake: 1, steer: 0, handbrake: true }; });
await page.waitForTimeout(6000);
console.log(await page.evaluate(() => {
  const run = window.__run, cov = run.streamer.cover.meshes, out = {};
  const p = run.states.get(1).pos;
  for (const k of ['debris', 'pebble', 'grass', 'tumble']) {
    const m = cov[k], a = m.geometry.attributes.aInst.data.array, n = m.geometry.instanceCount;
    let bad = 0, worst = 0, checked = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i * 8] + m.position.x, y = a[i * 8 + 1] + m.position.y, z = a[i * 8 + 2] + m.position.z;
      if (Math.hypot(x - p.x, z - p.z) > 90) continue;
      const gy = run._groundY(x, y + 20, z); if (gy == null) continue;
      checked++; const dy = y - gy; if (Math.abs(dy) > Math.abs(worst)) worst = dy; if (Math.abs(dy) > 0.5) bad++;
    }
    out[k] = { n, checked, bad, worst: +worst.toFixed(2) };
  }
  // pooled props
  for (const name of ['tire_stack', 'barrel', 'delineator', 'wreck_sedan', 'wreck_pickup', 'skeleton_car_frame', 'wreck_flipped']) {
    let bad = 0, worst = 0, checked = 0;
    for (const ch of run.dressing.chunks.values()) { const l = ch.lists.get(name); if (!l) continue;
      for (let i = 0; i < l.n; i++) { const x = l.m[i * 16 + 12], y = l.m[i * 16 + 13], z = l.m[i * 16 + 14]; if (Math.hypot(x - p.x, z - p.z) > 150) continue;
        const gy = run._groundY(x, y + 20, z); if (gy == null) continue; checked++; const dy = y - gy; if (Math.abs(dy) > Math.abs(worst)) worst = dy; if (Math.abs(dy) > 0.6) bad++; } }
    out[name] = { checked, bad, worst: +worst.toFixed(2) };
  }
  return JSON.stringify(out);
}));
await browser.close();
