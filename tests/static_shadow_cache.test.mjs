import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StaticShadowCache } from '../src/view/post/static_shadows.js';

function fixture() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const terrain = new THREE.Group(); terrain.name = 'terrain'; scene.add(terrain);
  const fixed = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); fixed.castShadow = true; terrain.add(fixed);
  const moving = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); moving.castShadow = true; scene.add(moving);
  const cover = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); cover.castShadow = true;
  cover.customDepthMaterial = new THREE.MeshDepthMaterial(); terrain.add(cover);
  const light = new THREE.DirectionalLight(); light.castShadow = true; scene.add(light, light.target);
  light.shadow.mapSize.set(32, 32);
  light.shadow.map = new THREE.WebGLRenderTarget(32, 32);
  light.shadow.map.depthTexture = new THREE.DepthTexture(32, 32);
  scene.updateMatrixWorld();
  const draws = [], clears = [], copies = [], bindings = [];
  let rt = null, face = 0, mip = 0;
  const gl = { READ_FRAMEBUFFER: 1, DRAW_FRAMEBUFFER: 2, FRAMEBUFFER: 3, DEPTH_BUFFER_BIT: 4, NEAREST: 5, NO_ERROR: 0,
    getError: () => 0,
    bindFramebuffer: (...args) => bindings.push(args), blitFramebuffer: (...args) => copies.push(args) };
  const fb = new WeakMap();
  const renderer = {
    getContext: () => gl, getRenderTarget: () => rt, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget: (v, cubeFace = 0, mipmapLevel = 0) => { rt = v; face = cubeFace; mip = mipmapLevel; },
    properties: { get: (v) => { if (!fb.has(v)) fb.set(v, { __webglFramebuffer: { target: v } }); return fb.get(v); } },
    clear: (color = true, depth = true, stencil = true) => clears.push({ target: rt, color, depth, stencil }),
    shadowMap: { type: THREE.PCFShadowMap, enabled: true, autoUpdate: true, needsUpdate: false },
  };
  renderer.shadowMap.render = (lights, renderScene) => {
    if (!renderer.shadowMap.enabled || (!renderer.shadowMap.autoUpdate && !renderer.shadowMap.needsUpdate)) return;
    const previous = renderer.getRenderTarget(), previousFace = face, previousMip = mip;
    for (const l of lights) {
      if (!l.shadow.autoUpdate && !l.shadow.needsUpdate) continue;
      renderer.setRenderTarget(l.shadow.map); renderer.clear();
      const casters = [];
      renderScene.traverseVisible((o) => { if (o.castShadow && o.isMesh) casters.push(o); });
      draws.push({ target: l.shadow.map, casters }); l.shadow.needsUpdate = false;
    }
    renderer.shadowMap.needsUpdate = false; renderer.setRenderTarget(previous, previousFace, previousMip);
  };
  const clear = renderer.clear, original = renderer.shadowMap.render;
  const cache = new StaticShadowCache(renderer, scene, light);
  return { scene, camera, light, fixed, moving, cover, renderer, cache, clear, original, gl, draws, clears, copies, bindings,
    render: () => { scene.updateMatrixWorld(); renderer.shadowMap.render([light], scene, camera); } };
}

test('static shadow depth is reused while moving and animated casters redraw every frame', () => {
  const f = fixture(), live = f.light.shadow.map;
  f.render();
  assert.equal(f.draws.length, 2);
  assert.deepEqual(f.draws[0].casters, [f.fixed]);
  assert.deepEqual(f.draws[1].casters, [f.cover, f.moving]);
  assert.equal(f.draws[1].target, live);
  assert.equal(f.copies.length, 1);
  assert.equal(f.clears[1].depth, false);
  f.moving.position.x = 2; f.render();
  assert.equal(f.draws.length, 3);
  assert.deepEqual(f.draws[2].casters, [f.cover, f.moving]);
  assert.equal(f.cache.stats.refreshes, 1); assert.equal(f.cache.stats.reuses, 1);
  assert.equal(f.renderer.clear, f.clear); assert.equal(f.light.shadow.map, live);
  assert.equal(f.renderer.getRenderTarget(), null);
  assert.equal(f.fixed.castShadow, true); assert.equal(f.moving.castShadow, true); assert.equal(f.cover.castShadow, true);
  assert.equal(f.bindings.at(-1)[0], f.gl.FRAMEBUFFER);
});

test('streamed geometry, fixed transforms, visibility, alpha tests, projection and shadow size invalidate cached depth', () => {
  const f = fixture(); f.render();
  const refresh = (mutate) => { const n = f.cache.stats.refreshes; mutate(); f.render(); assert.equal(f.cache.stats.refreshes, n + 1); };
  refresh(() => { f.fixed.geometry.attributes.position.needsUpdate = true; });
  refresh(() => { f.fixed.position.x = 3; });
  refresh(() => { f.fixed.material.alphaTest = 0.5; });
  refresh(() => { f.light.position.y = 10; });
  refresh(() => { f.light.shadow.camera.left = -9; });
  refresh(() => { f.light.shadow.map.setSize(64, 64); f.light.shadow.mapSize.set(64, 64); });
  assert.equal(f.cache.target.width, 64);
  const second = f.fixed.clone(); second.castShadow = true; f.fixed.parent.add(second); refresh(() => {});
  refresh(() => { second.visible = false; });
  refresh(() => { second.visible = true; });
  refresh(() => { second.parent.remove(second); });
});

test('instance-buffer updates invalidate even when the mesh transform is unchanged', () => {
  const f = fixture();
  const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2);
  instanced.castShadow = true; f.fixed.parent.add(instanced); f.render();
  const n = f.cache.stats.refreshes;
  instanced.setMatrixAt(0, new THREE.Matrix4().makeTranslation(3, 0, 0)); instanced.instanceMatrix.needsUpdate = true;
  f.render(); assert.equal(f.cache.stats.refreshes, n + 1);
});

test('mirrors with shadow updates disabled use the ordinary skip path without copying depth', () => {
  const f = fixture(); f.render();
  f.renderer.shadowMap.autoUpdate = false;
  const copies = f.copies.length, draws = f.draws.length;
  f.render(); assert.equal(f.copies.length, copies); assert.equal(f.draws.length, draws); assert.equal(f.renderer.clear, f.clear);
});

test('failed depth copying restores caster flags and falls back to complete ordinary shadows', () => {
  const f = fixture(); f.gl.blitFramebuffer = () => { throw new Error('unsupported depth copy'); };
  const sceneTarget = new THREE.WebGLCubeRenderTarget(32);
  f.renderer.setRenderTarget(sceneTarget, 4, 1);
  const warn = console.warn; console.warn = () => {};
  try { f.render(); } finally { console.warn = warn; }
  assert.equal(f.cache.enabled, false);
  assert.deepEqual(f.draws.at(-1).casters, [f.fixed, f.cover, f.moving]);
  assert.equal(f.renderer.clear, f.clear);
  assert.equal(f.renderer.getRenderTarget(), sceneTarget);
  assert.equal(f.renderer.getActiveCubeFace(), 4); assert.equal(f.renderer.getActiveMipmapLevel(), 1);
  assert.equal(f.fixed.castShadow, true); assert.equal(f.moving.castShadow, true); assert.equal(f.cover.castShadow, true);
  f.cache.dispose(); assert.equal(f.renderer.shadowMap.render, f.original);
});

test('WebGL errors reported without exceptions also fall back to ordinary shadows', () => {
  const f = fixture(); f.gl.getError = () => 1282;
  const sceneTarget = new THREE.WebGLCubeRenderTarget(32);
  f.renderer.setRenderTarget(sceneTarget, 2, 1);
  f.renderer.shadowMap.autoUpdate = false; f.renderer.shadowMap.needsUpdate = true;
  f.light.shadow.autoUpdate = false; f.light.shadow.needsUpdate = true;
  const warn = console.warn; console.warn = () => {};
  try { f.render(); } finally { console.warn = warn; }
  assert.equal(f.cache.enabled, false);
  assert.deepEqual(f.draws.at(-1).casters, [f.fixed, f.cover, f.moving]);
  assert.equal(f.renderer.clear, f.clear);
  assert.equal(f.renderer.getRenderTarget(), sceneTarget);
  assert.equal(f.renderer.getActiveCubeFace(), 2); assert.equal(f.renderer.getActiveMipmapLevel(), 1);
  assert.equal(f.renderer.shadowMap.autoUpdate, false); assert.equal(f.light.shadow.autoUpdate, false);
});
