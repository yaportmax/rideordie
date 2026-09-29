// World inspection page: /world.html?s=1500&seed=7&h=6&back=14&yaw=0&pitch=-6&look=1
//  flies a camera along the road; used for visual QA of terrain / road / sky / biomes.
import * as THREE from 'three';
import { createRenderer } from './core/renderer.js';
import { Road } from './world/road.js';
import { TerrainStreamer } from './world/terrain.js';
import { loadGroundArrays, makeTerrainMaterial, makeRoadMaterial } from './world/terrain_material.js';
import { SkyRig } from './world/sky.js';
import { lookAt } from './world/look.js';
import { initPhysics, createWorld } from './sim/physics.js';

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

let s = num('s', 1500);
const speed = num('fly', 0); // m/s of automatic flight
const hh = num('h', 5), back = num('back', 16), yawOff = num('yaw', 0) * Math.PI / 180, pitchOff = num('pitch', -5) * Math.PI / 180, lat = num('lat', 0);
const tmp = {};
let frames = 0, t0 = performance.now();
function frame() {
  const dt = Math.min(0.05, (performance.now() - t0) / 1000); t0 = performance.now();
  s += speed * dt;
  const look = lookAt(s);
  sky.setLook(look, frames === 0);
  streamer.update(s);
  const sm = road.sample(s - back, tmp);
  camera.position.set(sm.x + sm.nx * lat, road.surfaceY(sm, lat) + hh, sm.z + sm.nz * lat);
  const th = sm.th + yawOff;
  camera.rotation.order = 'YXZ'; camera.rotation.y = Math.PI + (-th) * 1; // look along +heading
  camera.rotation.set(pitchOff, 0, 0); camera.lookAt(camera.position.x + Math.sin(th) * 50, camera.position.y + Math.tan(pitchOff) * 50, camera.position.z + Math.cos(th) * 50);
  sky.update(dt, camera, camera.position);
  renderer.render(scene, camera);
  frames++;
  const ready = streamer.ready >= 3 && streamer.pending.size === 0 && streamer.chunks.size > 8;
  hud.textContent = `s=${s.toFixed(0)} biome=${JSON.stringify(look.sun.toFixed(0))} chunks=${streamer.chunks.size} pending=${streamer.pending.size} tris=${renderer.info.render.triangles} calls=${renderer.info.render.calls}`;
  if (ready && frames > 20) window.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
window.__world = { road, streamer, sky, scene, camera, renderer };
