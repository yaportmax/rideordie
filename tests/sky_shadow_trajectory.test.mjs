import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SkyRig } from '../src/world/sky.js';
import { lookAt } from '../src/world/look.js';
import { ATMO, KEY } from '../src/world/atmosphere.js';

function setup(t, opts = {}) {
  let nativePasses = 0;
  const renderer = { getContext: () => ({ blitFramebuffer() {} }), shadowMap: { render() { nativePasses++; } } };
  const scene = new THREE.Scene(), sky = new SkyRig(renderer, scene, { shadowSize: 2048, ...opts });
  sky.rebuildEnv = () => {}; // The trajectory uses real light/sky state without a GPU environment pass.
  t.after(() => { sky.shadowCache?.dispose(); sky.sky.geometry.dispose(); sky.sky.material.dispose(); sky.envMesh.material.dispose(); sky.cubeRT.dispose(); sky.pmrem.dispose(); });
  return { sky, scene, renderer, nativePasses: () => nativePasses };
}
function sharedUniformCleanup(t) {
  const saved = [...Object.values(ATMO), ...Object.values(KEY)].map(({ value }) => [value, value.toArray()]);
  t.after(() => { for (const [value, array] of saved) value.fromArray(array); });
}
function snapshot(sky) {
  sky.sun.shadow.updateMatrices(sky.sun);
  return {
    anchor: sky._shadowAnchor.toArray(), dir: sky._shadowDir.toArray(), focus: sky.shadowFocus.toArray(),
    light: sky.sun.position.toArray(), target: sky.sun.target.position.toArray(),
    projection: sky.sun.shadow.camera.projectionMatrix.toArray(), world: sky.sun.shadow.camera.matrixWorld.toArray(),
    shadowMatrix: sky.sun.shadow.matrix.toArray(), mapSize: sky.sun.shadow.mapSize.toArray(),
  };
}

test('ordinary, cached and cache-free shadows retain identical anchored projections through a moving day/night trajectory', t => {
  sharedUniformCleanup(t);
  const ordinary = setup(t), cached = setup(t, { cacheStaticShadows: true }), noCache = setup(t, { staticShadows: false });
  const fixtures = [ordinary, cached, noCache];
  assert.equal(ordinary.sky.shadowCache.enabled, false); assert.equal(cached.sky.shadowCache.enabled, true);
  assert.equal(noCache.sky.shadowCache, null);
  const camera = new THREE.PerspectiveCamera(), focus = new THREE.Vector3();
  let priorAnchor, priorDirection, held = 0, recenters = 0, directionChanges = 0;
  for (let frame = 0; frame < 160; frame++) {
    focus.set(frame * .28, Math.sin(frame / 20) * .1, frame * -.09);
    camera.position.copy(focus).add(new THREE.Vector3(0, 2, 0)); camera.rotation.y = Math.sin(frame / 18) * .8;
    const base = lookAt(frame < 95 ? 5000 : 45500);
    const look = { ...base, az: base.az + frame * .008, moonAz: base.moonAz + frame * .008 };
    // Diagnostic changes must never alter the projection. A failed cache can
    // also turn itself off during a run, so exercise that transition in motion.
    if (frame === 30 || frame === 100) cached.sky.shadowCache.enabled = false;
    if (frame === 55 || frame === 125) cached.sky.shadowCache.enabled = true;
    if (frame === 80 || frame === 140) for (const f of fixtures) f.sky.setShadowSize(frame === 80 ? 1024 : 4096);
    for (const f of fixtures) { f.sky.setLook(look); f.sky.update(1 / 60, camera, focus); }
    const expected = snapshot(cached.sky);
    assert.deepEqual(snapshot(ordinary.sky), expected, 'ordinary trajectory frame ' + frame);
    assert.deepEqual(snapshot(noCache.sky), expected, 'null-cache trajectory frame ' + frame);
    if (priorAnchor) { if (expected.anchor.every((n, i) => n === priorAnchor[i])) held++; else recenters++; }
    if (priorDirection && expected.dir.some((n, i) => n !== priorDirection[i])) directionChanges++;
    priorAnchor = expected.anchor; priorDirection = expected.dir;
  }
  assert.ok(held > 80 && recenters > 5, 'exercise both stable holds and movement/camera-driven recentering');
  assert.ok(directionChanges > 5, 'exercise moving sun and the moon transition');
  // Disabled caching still delegates the normal renderer; it cannot scan or
  // copy depth merely because a diagnostic cache object remains accessible.
  ordinary.sky.shadowCache._scan = () => { throw new Error('disabled cache scanned the scene'); };
  ordinary.renderer.shadowMap.render([ordinary.sky.sun], ordinary.scene, camera);
  assert.equal(ordinary.nativePasses(), 1);
});

test('shadow anchoring holds below movement/light thresholds and resizing releases both live depth targets', t => {
  sharedUniformCleanup(t);
  const { sky } = setup(t), camera = new THREE.PerspectiveCamera(), focus = new THREE.Vector3(), desert = { ...lookAt(5000) };
  sky.setLook(desert); sky.update(1 / 60, camera, focus);
  const original = snapshot(sky);
  focus.x = .5; camera.rotation.y = .001;
  sky.setLook({ ...desert, az: desert.az + .0005 }); sky.update(1 / 60, camera, focus);
  assert.deepEqual(snapshot(sky), original, 'small movement and sun drift retain the exact projection');
  focus.x = 12; sky.update(1 / 60, camera, focus);
  assert.notDeepEqual(sky._shadowAnchor.toArray(), original.anchor);
  sky.setLook({ ...desert, az: desert.az + .3 }); sky.update(1 / 60, camera, focus);
  assert.notDeepEqual(sky._shadowDir.toArray(), original.dir);
  let colorDisposals = 0, depthDisposals = 0, passDisposals = 0;
  sky.sun.shadow.map = { dispose() { colorDisposals++; }, depthTexture: { dispose() { depthDisposals++; } } };
  sky.sun.shadow.mapPass = { dispose() { passDisposals++; } };
  sky.setShadowSize(1024);
  assert.deepEqual([colorDisposals, depthDisposals, passDisposals], [1, 1, 1]);
  assert.equal(sky.sun.shadow.map, null); assert.equal(sky.sun.shadow.mapPass, null);
  assert.equal(sky._haveShadowAnchor, false); assert.equal(sky.sun.shadow.needsUpdate, true);
  sky.update(1 / 60, camera, focus); assert.equal(sky._haveShadowAnchor, true);
  assert.deepEqual(sky.sun.shadow.mapSize.toArray(), [1024, 1024]);
});
