// Real shipped rigs/meshes/clips, with only browser image decoding replaced for
// CPU tests. The reference module retains the two original update paths.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as Assets from '../../src/core/assets.js';
import { CrewView } from '../../src/view/crew_view.js';
import { CarView } from '../../src/view/car_view.js';
import { VEHICLES } from '../../src/data/vehicles.js';
import { WEAPONS } from '../../src/data/weapons.js';
import { patchCrewMaterials } from '../../src/view/crew_material.js';

const sourceUrl = new URL('../../src/view/crew_view.js', import.meta.url);
const current = readFileSync(sourceUrl, 'utf8');
let reference = current.replace('if (clipMode && this.mountAt === \'gun\') this.body.updateMatrixWorld(true);\n      else this.body.updateWorldMatrix(false, false, true);', 'this.body.updateMatrixWorld(true);');
if (reference === current) throw new Error('Gunner reference replacement no longer matches the source');
const withOriginalWheel = reference.replace(/      if \(wL <= 0\.001 && wR <= 0\.001 && this\.driverShift !== undefined && this\.wheelMesh !== undefined\) \{\n        if \(this\.wheelMesh\) this\.wheelMesh\.rotation\.z = rot;\n        return;\n      \}\n/, '');
if (withOriginalWheel === reference) throw new Error('Wheel reference replacement no longer matches the source');
reference = withOriginalWheel;
reference = reference.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, before, path, after) => before + new URL(path, sourceUrl).href + after);
reference = reference.replace("from 'three'", `from '${import.meta.resolve('three')}'`);
export const BaselineCrewView = (await import('data:text/javascript;base64,' + Buffer.from(reference).toString('base64'))).CrewView;
export { THREE, CrewView, WEAPONS };

let loading;
export function loadCrewAssets() {
  return loading ||= (async () => {
    const old = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self, createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
    globalThis.self = globalThis;
    globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
    globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
    globalThis.Request = class extends old.Request { constructor(url, opts) { super(typeof url === 'string' && url.startsWith('/') ? 'http://crew-test.local' + url : url, opts); } };
    globalThis.fetch = async (request) => {
      const url = new URL(typeof request === 'string' ? request : request.url);
      if (url.origin !== 'http://crew-test.local') return old.fetch(request);
      const path = url.pathname;
      return new Response(readFileSync(new URL('../../public' + path, import.meta.url)), { headers: { 'Content-Type': 'application/octet-stream' } });
    };
    try {
      await Assets.preload([
        ...['hero_gunner', 'hero_driver', 'raider_a', 'raider_driver', 'fp_arms'].map((id) => `/models/characters/${id}.glb`),
        ...['pistol', 'smg', 'shotgun', 'rifle'].map((id) => `/models/weapons/${id}.glb`),
        '/models/vehicles/truck_t1.glb',
      ]);
      // Three UUID creation also uses Math.random. Prime shared one-time
      // material resources before paired constructors choose clip phases.
      for (const id of ['hero_gunner', 'hero_driver', 'raider_a', 'raider_driver']) patchCrewMaterials(Assets.clone(`/models/characters/${id}.glb`));
    } finally {
      for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
  })();
}

export function seeded(seed, fn) {
  const original = Math.random; let state = seed >>> 0;
  Math.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  try { return fn(); } finally { Math.random = original; }
}

export function realCrewPair({ kind = 'raider_a', role = 'gunner', weapon = 'rifle' } = {}) {
  return [BaselineCrewView, CrewView].map((Type) => seeded(17, () => {
    const scene = new THREE.Scene(), car = new CarView(VEHICLES.truck_t1, { lod: false, paint: 0x786342 });
    const crew = new Type(kind, { role, weapon }); scene.add(car.root); car.root.add(crew.root); crew.attach(car, VEHICLES.truck_t1.seats[role]);
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, .01, 200); scene.add(camera); camera.position.set(.2, 2.5, -.7);
    const gunner = { weaponId: weapon, weapon: WEAPONS[weapon], slots: [weapon], shots: 0, pos: new THREE.Vector3(), magNow: 12, trigger: false, swapT: 0, crouch: 0, throwing: 0, reloading: false, reloadT: 0 };
    scene.updateMatrixWorld(true); crew._cutPrepared = true;
    return { scene, car, crew, camera, gunner };
  }));
}

export function countModelVisits(crew) {
  const counters = { passes: 0, nodes: 0 };
  crew.model.traverse((o) => {
    const update = o.updateMatrixWorld;
    o.updateMatrixWorld = function (...args) { counters.nodes++; if (o === crew.model) counters.passes++; return update.apply(this, args); };
  });
  return counters;
}

export function matrixSnapshot(root) {
  const out = [];
  root.traverse((o) => out.push({ name: o.name, p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(), m: o.matrixWorld.toArray(), visible: o.visible }));
  return out;
}
