// Raycast from a dev camera preset through screen points; report what is hit (object, chunk, vertex kind).
//   node tools/test/pick.mjs <s> "<offset x,y,z>" "<look x,y,z>" fov "nx,ny;nx,ny;..." [seed]
import { chromium } from 'playwright-core';
const [s, off, look, fov, pts, seed = 7] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5180/index.html?solo&as=driver&s=${s}&seed=${seed}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.evaluate(() => { window.__forceInput = { throttle: 0, brake: 1, steer: 0, handbrake: true }; });
await page.waitForTimeout(8000);
const r = await page.evaluate(async ({ off, look, fov, pts }) => {
  const run = window.__run, g = window.__game, p = run.states.get(1);
  window.__camOverride = { offset: off.split(',').map(Number), look: look.split(',').map(Number), fov: +fov };
  await new Promise((res) => setTimeout(res, 500));
  const THREE = await import('/node_modules/.vite/deps/three.js').catch(() => null);
  const cam = g.camera, out = [];
  const Ray = THREE ? new THREE.Raycaster() : null;
  if (!Ray) return 'no three';
  for (const q of pts.split(';')) {
    const [x, y] = q.split(',').map(Number);
    Ray.setFromCamera(new THREE.Vector2(x, y), cam);
    const hits = Ray.intersectObjects(run.streamer.group.children, false);
    const h = hits[0];
    if (!h) { out.push({ q, hit: null }); continue; }
    let chunk = null;
    for (const [c, rec] of run.streamer.chunks) if (rec.mesh === h.object || rec.roadMesh === h.object) chunk = c;
    const nv = h.object.geometry.attributes.position.count;
    out.push({ q, name: h.object.name, chunk, lod: chunk != null ? run.streamer.chunks.get(chunk).lod : null, dist: +h.distance.toFixed(0), face: [h.face.a, h.face.b, h.face.c], nv, nrm: h.face.normal.toArray().map((v) => +v.toFixed(2)), pt: h.point.toArray().map((v) => +v.toFixed(0)), truck: p.pos.toArray().map((v) => +v.toFixed(0)), ps: +(run.playerS).toFixed(0) });
  }
  return out;
}, { off, look, fov, pts });
console.log(JSON.stringify(r, null, 0));
await page.screenshot({ path: 'shots/ground/pick.png' });
await browser.close();
