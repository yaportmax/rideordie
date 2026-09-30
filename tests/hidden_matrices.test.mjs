import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { skipHiddenMatrixTraversal } from '../src/view/hidden_matrices.js';
import { CarView } from '../src/view/car_view.js';
import { CrewView } from '../src/view/crew_view.js';

function countWalks(root) {
  let visits = 0;
  root.traverse(node => {
    const update = node.updateMatrixWorld;
    node.updateMatrixWorld = function(force) { visits++; return update.call(this, force); };
  });
  return { reset() { visits = 0; }, get visits() { return visits; } };
}

test('invisible owned roots actually skip bone descendants and refresh every bone when shown', () => {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  let parent = root;
  for (let i = 0; i < 52; i++) { const bone = new THREE.Bone(); bone.position.y = .02; parent.add(bone); parent = bone; }
  const counter = countWalks(root);
  root.visible = false; root.matrixWorldAutoUpdate = false;
  scene.updateMatrixWorld(true);
  assert.equal(counter.visits, 53, 'the previous flag alone still traversed every bone');
  root.matrixWorldAutoUpdate = true; skipHiddenMatrixTraversal(root); counter.reset();
  for (let frame = 0; frame < 10; frame++) scene.updateMatrixWorld(true);
  assert.equal(counter.visits, 0, 'the hidden branch must not call its former traversal');
  scene.position.x = 7; root.position.y = 3; root.visible = true;
  scene.updateMatrixWorld(true);
  assert.equal(counter.visits, 53);
  assert.ok(Math.abs(parent.matrixWorld.elements[13] - 4.04) < 1e-12);
  assert.equal(parent.matrixWorld.elements[12], 7);
});

test('explicit hidden world queries, forced pose updates and detach retain current transforms', () => {
  const scene = new THREE.Scene(), car = new THREE.Group(), root = skipHiddenMatrixTraversal(new THREE.Group());
  const body = new THREE.Group(), bone = new THREE.Bone(), leaf = new THREE.Bone();
  scene.add(car); car.add(root); root.add(body); body.add(bone); bone.add(leaf);
  root.visible = false; car.position.set(10, 2, 3); root.position.y = 1;
  bone.position.y = 2; leaf.position.x = 4;
  scene.updateMatrixWorld(true);
  assert.deepEqual(leaf.getWorldPosition(new THREE.Vector3()).toArray(), [14, 5, 3]);
  bone.position.y = 3; body.updateMatrixWorld(true);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(leaf.matrixWorld).toArray(), [14, 6, 3]);
  car.position.x = 20; scene.attach(root);
  assert.equal(root.parent, scene);
  assert.deepEqual(leaf.getWorldPosition(new THREE.Vector3()).toArray(), [24, 6, 3]);
  root.visible = true; root.position.x += 5; scene.updateMatrixWorld(true);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(leaf.matrixWorld).toArray(), [29, 6, 3]);
});

function carFixture(reference) {
  const car = Object.assign(Object.create(CarView.prototype), {
    root: new THREE.Group(), wheelNodes: new Map(), panels: new Map(), sockets: {}, taillights: [], headlights: [], lodOn: false,
  });
  const model = new THREE.Group(), wheel = new THREE.Group(), socket = new THREE.Group();
  wheel.name = 'wheel_FL'; socket.name = 'seat_driver'; socket.position.set(.4, 1.2, -.3);
  wheel.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())); model.add(wheel, socket);
  car._adoptModel(model, {});
  car.lod = skipHiddenMatrixTraversal(new THREE.Group()); car.lod.visible = false; car.root.add(car.lod);
  car.lod.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  if (reference) {
    model.updateMatrixWorld = THREE.Object3D.prototype.updateMatrixWorld;
    car.lod.updateMatrixWorld = THREE.Object3D.prototype.updateMatrixWorld;
  }
  return { car, model, wheel, socket };
}

test('CarView visible transforms and hidden socket queries match across repeated LOD transitions', () => {
  const before = carFixture(true), after = carFixture(false);
  const oldScene = new THREE.Scene(), scene = new THREE.Scene(); oldScene.add(before.car.root); scene.add(after.car.root);
  for (let frame = 0; frame < 80; frame++) {
    for (const f of [before, after]) {
      f.car.root.position.set(frame * .3, Math.sin(frame / 10), -frame * .2);
      f.car.root.rotation.y = frame * .01; f.wheel.position.set(.8, frame * .02, 1);
      f.wheel.rotation.x = frame * .13; f.car.setLod(frame % 8 < 4);
    }
    oldScene.updateMatrixWorld(true); scene.updateMatrixWorld(true);
    assert.equal(after.model.visible, before.model.visible); assert.equal(after.car.lod.visible, before.car.lod.visible);
    const a = after.car.lodOn ? after.car.lod : after.model, b = before.car.lodOn ? before.car.lod : before.model;
    const aa = [], bb = []; a.traverse(n => aa.push(n.matrixWorld.toArray())); b.traverse(n => bb.push(n.matrixWorld.toArray()));
    assert.deepEqual(aa, bb);
    assert.deepEqual(after.socket.getWorldPosition(new THREE.Vector3()).toArray(), before.socket.getWorldPosition(new THREE.Vector3()).toArray());
    assert.equal(after.model.matrixWorldAutoUpdate, true); assert.equal(after.car.lod.matrixWorldAutoUpdate, true);
  }
});

test('CrewView installs hidden traversal skipping while death detachment uses current world coordinates', () => {
  const scene = new THREE.Scene(), car = new THREE.Group(); scene.add(car);
  const crew = new CrewView('missing_test_character', { role: 'driver' }); car.add(crew.root);
  crew.root.position.set(1, 2, 3); crew.root.visible = false; car.position.set(10, 0, -5);
  crew.lastVel = new THREE.Vector3(5, 0, 6);
  const counter = countWalks(crew.body); scene.updateMatrixWorld(true);
  assert.equal(counter.visits, 0);
  crew._detach([.1, .8], false);
  assert.equal(crew.detached, true); assert.equal(crew.root.parent, scene);
  assert.deepEqual(crew.root.getWorldPosition(new THREE.Vector3()).toArray(), [11, 2, -2]);
  crew.root.visible = true; scene.updateMatrixWorld(true);
  assert.ok(counter.visits > 0); assert.equal(crew.root.matrixWorldAutoUpdate, true);
  crew.dispose();
});
