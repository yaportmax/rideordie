// Approximate draw-call breakdown in the main camera: visible meshes that intersect the frustum, grouped by owner / asset.
//   node tools/test/draw_breakdown.mjs "<query>" [waitMs=9000]
import { chromium } from 'playwright-core';
const q = process.argv[2] || 'solo&as=driver&s=34000&seed=7', wait = +(process.argv[3] || 9000);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5180/index.html?' + q, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.evaluate(() => { window.__autodrive = { speed: 30 }; document.getElementById('boot')?.remove(); });
await page.waitForTimeout(wait);
console.log(await page.evaluate(async () => {
  const g = window.__game, run = window.__run, cam = g.camera, scene = g.scene;
  const THREE = await import('/node_modules/.vite/deps/three.js');
  cam.updateMatrixWorld(); const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const groups = {}, byAsset = {}; let total = 0, shadow = 0;
  const owner = (o) => { let p = o; while (p) { if (p.name && ['terrain', 'dressing-pool', 'dressing-extras', 'backdrop'].includes(p.name)) return p.name; p = p.parent; } return 'other'; };
  const visible = (o) => { let p = o; while (p) { if (!p.visible) return false; p = p.parent; } return true; };
  scene.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !visible(o)) return;
    if (o.isInstancedMesh && o.count === 0) return;
    if (o.frustumCulled !== false) { const gs = o.boundingSphere || o.geometry?.boundingSphere; if (!gs) o.geometry?.computeBoundingSphere?.(); const sph = (o.boundingSphere || o.geometry.boundingSphere).clone().applyMatrix4(o.matrixWorld); if (!fr.intersectsSphere(sph)) return; }
    const n = Array.isArray(o.material) ? o.material.length : 1;
    const ow = owner(o); groups[ow] = (groups[ow] || 0) + n; total += n; if (o.castShadow) shadow++;
    if (ow === 'dressing-pool' || ow === 'dressing-extras') { const k = (o.userData.partName ? '' : '') + (o.geometry?.name || o.name || o.material?.name || '?'); byAsset[k] = (byAsset[k] || 0) + n; }
  });
  const top = Object.entries(byAsset).sort((a, b) => b[1] - a[1]).slice(0, 25);
  return JSON.stringify({ calls: window.__perf.calls, frustumTotal: total, castShadow: shadow, groups, top });
}));
await browser.close();
