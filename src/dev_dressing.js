// Dressing fly-through page: /dressing.html?s=2000&seed=7&h=6&back=14&yaw=0&pitch=-5&fly=0&q=2&fov=65
//  = world.html + Dressing (props, furniture, structures, water, backdrop). Used for visual QA and perf numbers.
import * as THREE from 'three';
import { createRenderer } from './core/renderer.js';
import { Road } from './world/road.js';
import { TerrainStreamer } from './world/terrain.js';
import { loadGroundArrays, makeTerrainMaterial, makeRoadMaterial } from './world/terrain_material.js';
import { SkyRig } from './world/sky.js';
import { lookAt } from './world/look.js';
import { initPhysics } from './sim/physics.js';
import { Dressing } from './world/dressing.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);
const seed = num('seed', 7);
const renderer = createRenderer({ antialias: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', 65), innerWidth / innerHeight, 0.3, 9000);
const sky = new SkyRig(renderer, scene);
const road = new Road(seed);
const hud = document.getElementById('hud');

await initPhysics();
const arrays = await loadGroundArrays();
const loader = new THREE.TextureLoader();
const tex = (n, srgb) => { const t = loader.load(`/textures/asphalt/${n}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; };
const terrainMat = makeTerrainMaterial(arrays);
const roadMat = makeRoadMaterial({ albedo: tex('albedo', true), normal: tex('normal', false), arm: tex('arm', false) });
const streamer = new TerrainStreamer({ scene, world: null, seed, terrainMat, roadMat, workers: 3 });

const hooks = {};
const dressing = new Dressing(scene, road, seed, { quality: num('q', 2), physicsHook: (req) => { hooks[req.type] = (hooks[req.type] || 0) + 1; } });
let s = num('s', 1500);
await dressing.load(s);
if (!q.has('nodress')) { streamer.onChunk = (c, rec) => dressing.onChunk(c, rec); streamer.onChunkDrop = (c) => dressing.onChunkDrop(c); }

const speed = num('fly', 0);
const hh = num('h', 5), back = num('back', 16), yawOff = num('yaw', 0) * Math.PI / 180, pitchOff = num('pitch', -5) * Math.PI / 180, lat = num('lat', 0);
const tmp = {};
let frames = 0, t0 = performance.now(), idleFrames = 0;
const fpsRing = [];
function frame() {
  const now = performance.now(), dtRaw = (now - t0) / 1000; t0 = now;
  const dt = Math.min(0.05, dtRaw);
  fpsRing.push(dtRaw); if (fpsRing.length > 60) fpsRing.shift();
  s += speed * dt;
  const look = lookAt(q.has('ls') ? num('ls', s) : s);
  sky.setLook(look, frames === 0);
  streamer.update(s);
  const sm = road.sample(s - back, tmp);
  camera.position.set(sm.x + sm.nx * lat, road.surfaceY(sm, lat) + hh, sm.z + sm.nz * lat);
  const th = sm.th + yawOff;
  camera.lookAt(camera.position.x + Math.sin(th) * 50, camera.position.y + Math.tan(pitchOff) * 50, camera.position.z + Math.cos(th) * 50);
  camera.updateMatrixWorld();
  dressing.update(dt, camera.position, s, camera);
  sky.update(dt, camera, camera.position);
  renderer.render(scene, camera);
  frames++;
  const ready = streamer.ready >= 3 && streamer.pending.size === 0 && streamer.chunks.size > 8;
  const info = renderer.info;
  const avg = fpsRing.reduce((a, b) => a + b, 0) / fpsRing.length;
  hud.textContent = `s=${s.toFixed(0)} chunks=${streamer.chunks.size} pend=${streamer.pending.size} tris=${info.render.triangles} calls=${info.render.calls} fps=${(1 / avg).toFixed(0)}\n` +
    `pool inst=${dressing.pool.stats.instances} meshes=${dressing.pool.stats.drawn} rebuild=${dressing.stats.rebuildMs.toFixed(1)}ms job=${dressing.stats.jobMs.toFixed(1)}ms idle=${dressing.idle} tex=${info.memory.textures} geo=${info.memory.geometries}\n` +
    `hooks ${JSON.stringify(hooks)}`;
  if (ready && dressing.idle) idleFrames++; else idleFrames = 0;
  if (idleFrames > 12 && frames > 30) window.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
window.__dress = { road, streamer, sky, scene, camera, renderer, dressing, hooks, setS: (v) => { s = v; } };
