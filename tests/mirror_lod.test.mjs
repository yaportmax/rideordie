import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Cockpit } from '../src/view/cockpit.js';

for (const fail of [false, true]) test(`mirror traffic uses merged cars and restores every pose${fail ? ' after render failure' : ''}`, () => {
  const scene = new THREE.Scene(), cars = new THREE.Group(); cars.name = 'cars'; scene.add(cars);
  const player = new THREE.Group(), model = new THREE.Group(); player.name = 'car_player'; player.add(model); cars.add(player);
  const car = new THREE.Group(); car.name = 'car_enemy'; car.position.z = -20; cars.add(car);
  const full = new THREE.Group(), source = new THREE.Group(); source.name = 'wheel_FL';
  source.position.set(1, 2, 3); source.rotation.y = 0.4; source.scale.y = 0.3; full.add(source);
  const lod = new THREE.Group(); lod.name = 'lod'; lod.visible = false; lod.matrixWorldAutoUpdate = false;
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const wheel = body.clone(); wheel.position.set(4, 5, 6); lod.add(body, wheel);
  const crew = new THREE.Group(); crew.name = 'crew_raider';
  const hiddenCrew = new THREE.Group(); hiddenCrew.name = 'crew_driver'; hiddenCrew.visible = false;
  const proxy = new THREE.Group(); proxy.name = 'shadow_proxy'; car.add(full, lod, crew, hiddenCrew, proxy);
  scene.updateMatrixWorld(true);
  const saved = [lod, body, wheel, full, source].map(o => ({ o, pos: o.position.toArray(), quat: o.quaternion.toArray(), scale: o.scale.toArray(), matrix: o.matrix.toArray(), world: o.matrixWorld.toArray(), visible: o.visible, auto: o.matrixWorldAutoUpdate, dirty: o.matrixWorldNeedsUpdate }));
  const cockpit = Object.assign(Object.create(Cockpit.prototype), {
    active: true, frame: 0, model, rearCam: new THREE.PerspectiveCamera(), rearLocal: new THREE.Vector3(),
    frustum: new THREE.Frustum(), glassMat: { visible: true }, rt: {},
  });
  const previous = {}; let target = previous, rendered = 0;
  const renderer = { shadowMap: { autoUpdate: true }, getRenderTarget: () => target, setRenderTarget: value => { target = value; }, clear() {}, render() {
    rendered++; assert.equal(player.visible, false); assert.equal(full.visible, false); assert.equal(lod.visible, true);
    assert.equal(crew.visible, false); assert.equal(hiddenCrew.visible, false); assert.equal(proxy.visible, false);
    assert.deepEqual(wheel.position.toArray(), source.position.toArray()); assert.deepEqual(wheel.quaternion.toArray(), source.quaternion.toArray());
    assert.deepEqual(wheel.scale.toArray(), source.scale.toArray()); assert.equal(wheel.matrixWorld.elements[14], -17);
    if (fail) throw new Error('mirror failure');
  } };
  if (fail) assert.throws(() => cockpit.renderMirrors(renderer, scene, player), /mirror failure/);
  else cockpit.renderMirrors(renderer, scene, player);
  assert.equal(rendered, 1); assert.equal(target, previous); assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(scene.matrixWorldAutoUpdate, true); assert.equal(player.visible, true); assert.equal(cockpit.glassMat.visible, true);
  assert.equal(crew.visible, true); assert.equal(hiddenCrew.visible, false); assert.equal(proxy.visible, true);
  for (const s of saved) {
    assert.deepEqual(s.o.position.toArray(), s.pos); assert.deepEqual(s.o.quaternion.toArray(), s.quat); assert.deepEqual(s.o.scale.toArray(), s.scale);
    assert.deepEqual(s.o.matrix.toArray(), s.matrix); assert.deepEqual(s.o.matrixWorld.toArray(), s.world);
    assert.equal(s.o.visible, s.visible); assert.equal(s.o.matrixWorldAutoUpdate, s.auto); assert.equal(s.o.matrixWorldNeedsUpdate, s.dirty);
  }
});
