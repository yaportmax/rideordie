// Whole production modules with real shipped GLB geometry and Rapier bodies.
// Deferred warming models a CPU acceptance barrier, not measured GPU readiness.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Dressing } from '../../src/world/dressing.js';
import { Run } from '../../src/game/run.js';
import { Road } from '../../src/world/road.js';
import { AssetKit } from '../../src/world/dressing/assets.js';
import { InstancePool } from '../../src/world/dressing/pool.js';
import { CHUNK_LEN } from '../../src/world/terrain_gen.js';
import { initPhysics, createWorld } from '../../src/sim/physics.js';
import { StructureColliders } from '../../src/sim/structure_colliders.js';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const names = ['tunnel_portal_concrete', 'tunnel_exit_concrete', 'tunnel_mid_10m'];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), documents = new Map();
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

// Use the shipped GLBs' geometry and collision triangles, while representing
// the GPU compile/upload completion with an explicit asynchronous barrier.
async function shippedAsset(name) {
  if (!documents.has(name)) documents.set(name, io.read(path.join(repo, 'public/models/structures', name + '.glb')));
  const document = await documents.get(name), parts = [], positions = [], indices = [], box = new THREE.Box3();
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const transform = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of mesh.listPrimitives()) {
      const accessor = primitive.getAttribute('POSITION'), idx = primitive.getIndices();
      const coords = new Float32Array(accessor.getCount() * 3);
      for (let i = 0; i < accessor.getCount(); i++) new THREE.Vector3().fromArray(accessor.getElement(i, [])).applyMatrix4(transform).toArray(coords, i * 3);
      const triangles = Uint32Array.from({ length: idx ? idx.getCount() : accessor.getCount() }, (_, i) => idx ? idx.getScalar(i) : i);
      if (node.getName() === 'collision') {
        const offset = positions.length / 3;
        positions.push(...coords); for (const vertex of triangles) indices.push(vertex + offset);
      } else {
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(coords, 3)); geometry.setIndex(new THREE.BufferAttribute(triangles, 1)); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        box.union(geometry.boundingBox);
        parts.push({ name: node.getName(), role: 'main', geometry, material: new THREE.MeshStandardMaterial(), tris: triangles.length / 3 });
      }
    }
  }
  const size = box.getSize(new THREE.Vector3()), sphere = box.getBoundingSphere(new THREE.Sphere());
  return { name, kind: 'struct', parts, collision: { pos: Float32Array.from(positions), idx: Uint32Array.from(indices) }, box, size, sphere, height: size.y, radius: sphere.radius, sockets: {}, tris: parts.reduce((n, part) => n + part.tris, 0) };
}

async function fixture(t, features = [{ type: 'tunnel', s0: 80, s1: 500, rock: false }]) {
  await initPhysics();
  const world = createWorld(), scene = new THREE.Scene(), road = new Road(31);
  road.extendTo(5000); road.features = features; road.ensureDrivingBranches = () => [];
  const kit = new AssetKit(), requests = [];
  for (const name of names) kit.assets.set(name, await shippedAsset(name));
  kit.request = name => { requests.push(name); if (!kit.loading.has(name)) kit.loading.set(name, new Promise(() => {})); return kit.loading.get(name); };
  const structure = new StructureColliders(world), events = [], warms = [], dress = Object.create(Dressing.prototype);
  Object.assign(dress, {
    scene, road, seed: 31, opts: {}, quality: 2, kit, chunks: new Map(), s: 40,
    pool: new InstancePool(scene, kit), extraGroup: new THREE.Group(), cam: new THREE.Vector3(),
    hook(req) { events.push(req.type); structure.hook(req); },
    water: { dropChunk() {}, update() {}, dispose() {} }, backdrop: { update() {}, dispose() {} }, sets: { update() {}, dispose() {} },
    _loaded: true, _poolOk: true, _needRebuild: true, _clock: 0, _warm: true, _setsWarm: true,
    prefetch: () => Promise.resolve(),
    _lastRebuild: { x: 1e9, y: 0, z: 0, fx: 0, fz: 0, t: 0 },
    stats: { chunksBuilt: 0, jobMs: 0, rebuilds: 0, rebuildMs: 0, rebuildMax: 0, stepMax: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
  });
  scene.add(dress.extraGroup);
  dress.pool.warmer = () => { const gate = deferred(); warms.push(gate); return gate.promise; };
  dress.ctx = { road, seed: 31, kit, pool: dress.pool, quality: 2, dress, hook: req => dress._structureHook(req) };
  // The tests exercise the real structural step. Other scenery intentionally
  // stays pending so it cannot accidentally act as the readiness signal.
  const realStep = dress._runStep.bind(dress);
  dress._runStep = ch => { if (ch.step === 2) realStep(ch); else ch._blockedUntil = Infinity; };
  const material = new THREE.MeshStandardMaterial();
  const arrive = (c, step = 2) => { dress.onChunk(c, { chunk: c, lod: 2, mesh: { material }, alive: true }); const ch = dress.chunks.get(c); ch.step = step; return ch; };
  const readiness = (s = 40) => dress.tunnelReadiness(s, id => structure.bodies.has(id));
  const rebuild = () => {
    const at = road.pointAt(40, 0, {});
    // Advance real update frames past its normal rebuild interval. The test
    // never writes renderReady itself, so removing update's wiring fails it.
    for (let frame = 0; frame < 13; frame++) dress.update(0.05, at, 40);
  };
  t.after(() => { dress.dispose(); structure.dispose(); material.dispose(); world.free(); });
  return { dress, road, kit, structure, events, warms, arrive, readiness, rebuild };
}

function countdownRun(fixture, events = []) {
  const player = { s: 40, held: true };
  const g = { _runGeneration: 1, camera: new THREE.PerspectiveCamera(), fade: value => events.push(['fade', value]), hud: { message: text => events.push(['message', text]) } };
  const run = new Run(g, { role: 'solo', seed: 31, runId: 'tunnel-readiness-fixture', journey: { mode: 'legacy' } });
  Object.assign(run, {
    dressing: fixture.dress, _road: fixture.road, structures: fixture.structure, player, started: false, finished: false, over: false, partnerReady: true, countdown: 0.2,
    streamer: { update: () => events.push(['terrain-update']), groundReady: () => true },
    sim: { state: 'countdown', releaseCar(car) { car.held = false; events.push(['release']); }, start() { this.state = 'run'; events.push(['start']); } },
    net: { sendJSON: message => events.push(['net', message.t]) },
  });
  return run;
}

function selectedJob(dress) {
  const marker = new Error('one scheduling selection'), original = dress._runStep; let selected;
  dress._runStep = ch => { selected = ch; throw marker; };
  try { assert.throws(() => dress._jobs(100), error => error === marker); }
  finally { dress._runStep = original; }
  return selected;
}

export { fixture, countdownRun, selectedJob, flush };
