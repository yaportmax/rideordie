// Verify player-truck GLBs load in the in-engine viewer and expose the contract nodes.
//   node tools/blender/vehicles/player/verify.mjs [truck_t1 truck_t2 ...]   (default: all four; path = /models/vehicles/<id>.glb)
//   node tools/blender/vehicles/player/verify.mjs --model=/models/_test/dev_t3.glb
import { chromium } from 'playwright-core';
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const ids = args.filter(a => !a.startsWith('--'));
const models = opt.model ? [opt.model.replace(/^C:\/Program Files\/Git/, '').replace(/^\/?/, '/')] : (ids.length ? ids : ['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4']).map(i => `/models/vehicles/${i}.glb`);
const REQ = ['body', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR', 'panel_hood', 'panel_door_L', 'panel_door_R', 'panel_bumper_F', 'panel_bumper_R', 'panel_tailgate',
  'seat_driver', 'steering_wheel', 'seat_gunner', 'light_head_L', 'light_head_R', 'light_tail_L', 'light_tail_R', 'exhaust_L', 'exhaust_R', 'smoke_engine', 'fuel_cap', 'nitro_L', 'nitro_R', 'camera_hood', 'roof_top'];
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl'],
});
let bad = 0;
for (const m of models) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:5173/viewer.html?model=' + m, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 60000 }).catch(() => console.log('[warn] not ready'));
  const v = await page.evaluate(() => JSON.parse(JSON.stringify(window.__viewer)));
  const names = v.nodes.map(n => n.path.split('/').pop());
  const missing = REQ.filter(r => !names.includes(r));
  const meshes = v.nodes.filter(n => n.type === 'Mesh').length;
  const top = v.nodes.filter(n => n.path && !n.path.includes('/') && n.type !== 'Mesh').length;
  const pos = n => (v.nodes.find(x => x.path.split('/').pop() === n) || {}).pos;
  console.log(m, '\n  tris', v.tris, ' meshes', meshes, ' size', v.bbox && v.bbox.size, ' bbox min/max', JSON.stringify(v.bbox && [v.bbox.min, v.bbox.max]));
  console.log('  missing:', missing.length ? missing.join(',') : 'none', ' materials:', v.materials.join(','));
  console.log('  wheels', ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map(pos).map(p => p && p.join('/')).join('  '),
    ' seat_driver', pos('seat_driver'), ' seat_gunner', pos('seat_gunner'));
  if (missing.length || v.tris <= 0) bad++;
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
