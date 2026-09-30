import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCrewAssets, realCrewPair, seeded, countModelVisits, matrixSnapshot, THREE } from './helpers/crew-assets.mjs';

await loadCrewAssets();

function driverPair(kind = 'raider_driver') {
  return realCrewPair({ kind, role: 'driver' });
}

function moveCar(pair, frame) {
  for (const { car } of pair) {
    car.root.position.set(frame * .3, Math.sin(frame * .07) * .2, 5 - frame * .11);
    car.root.quaternion.setFromEuler(new THREE.Euler(Math.sin(frame * .03) * .04, frame * .015, Math.cos(frame * .04) * .03));
  }
}

function initialize(pair) {
  for (const { crew, scene } of pair) { crew._wheelIK(1, 1, -.2); scene.updateMatrixWorld(true); }
  assert.notEqual(pair[0].crew.driverShift, undefined);
  assert.notEqual(pair[0].crew.wheelMesh, undefined);
}

function assertEquivalent(pair, label) {
  const [before, after] = pair;
  assert.equal(after.crew.driverShift, before.crew.driverShift, label + ': seat fitting');
  assert.equal(after.crew.wheelMesh?.rotation.z, before.crew.wheelMesh?.rotation.z, label + ': wheel rotation');
  // The shortcut deliberately leaves world matrices to the ordinary render
  // traversal. Local authored transforms must already match before that walk.
  const local = (root) => matrixSnapshot(root).map(({ m: _m, ...state }) => state);
  assert.deepEqual(local(after.car.root), local(before.car.root), label + ': local transforms');
  for (const { scene } of pair) scene.updateMatrixWorld(true);
  assert.deepEqual(matrixSnapshot(after.car.root), matrixSnapshot(before.car.root), label + ': authored world matrices');
}

test('cached released hands keep exact authored transforms and wheel motion without a model walk', () => {
  const pair = driverPair(); initialize(pair);
  const counters = pair.map(({ crew }) => countModelVisits(crew));
  for (const [frame, weights] of [[0, [0, 0]], [1, [.001, .001]], [2, [-.2, 0]], [3, [0, .0005]]]) {
    moveCar(pair, frame + 10);
    counters.forEach((counter) => { counter.passes = counter.nodes = 0; });
    const angle = -.4 + frame * .13;
    for (const { crew } of pair) { crew.mixer.update(1 / 60); crew._wheelIK(...weights, angle); }
    assert.equal(counters[0].passes, 1, 'reference still refreshes the complete rig');
    assert.equal(counters[1].passes, 0, 'released hands leave the rig to the render traversal');
    assert.equal(counters[1].nodes, 0);
    assertEquivalent(pair, 'cached weights ' + weights);
  }
  // A successfully cached absence of the authored wheel mesh is also safe.
  for (const { crew } of pair) crew.wheelMesh = null;
  counters.forEach((counter) => { counter.passes = counter.nodes = 0; });
  moveCar(pair, 20);
  for (const { crew } of pair) crew._wheelIK(0, 0, .7);
  assert.equal(counters[0].passes, 1); assert.equal(counters[1].passes, 0);
  assertEquivalent(pair, 'cached missing wheel mesh');
});

test('zero-weight first calls still fit the seat and initialize an unset wheel cache', () => {
  for (const setup of ['fresh', 'unset-shift', 'unset-wheel', 'missing-wheel']) {
    const pair = driverPair();
    if (setup !== 'fresh' && setup !== 'missing-wheel') initialize(pair);
    for (const { crew, car } of pair) {
      if (setup === 'unset-shift') delete crew.driverShift;
      if (setup === 'unset-wheel') delete crew.wheelMesh;
      if (setup === 'missing-wheel') car.sockets.steering_wheel.getObjectByName('steering_wheel_mesh')?.removeFromParent();
    }
    const counters = pair.map(({ crew }) => countModelVisits(crew));
    moveCar(pair, 9);
    for (const { crew } of pair) crew._wheelIK(0, 0, .33);
    assert.ok(counters[0].passes > 0); assert.equal(counters[1].passes, counters[0].passes, setup + ': preserve required setup');
    assert.notEqual(pair[1].crew.driverShift, undefined);
    assert.notEqual(pair[1].crew.wheelMesh, undefined);
    if (setup === 'missing-wheel') assert.equal(pair[1].crew.wheelMesh, null);
    assertEquivalent(pair, setup);
  }
});

test('a hand above the release threshold retains the original real-rig IK path', () => {
  const pair = driverPair(); initialize(pair);
  const counters = pair.map(({ crew }) => countModelVisits(crew));
  for (const [frame, weights] of [[0, [0, 1]], [1, [.6, 0]], [2, [.00101, .001]], [3, [.35, .8]]]) {
    moveCar(pair, frame + 30);
    counters.forEach((counter) => { counter.passes = counter.nodes = 0; });
    for (const { crew } of pair) { crew.mixer.update(1 / 60); crew._wheelIK(...weights, .2 - frame * .17); }
    assert.equal(counters[1].passes, counters[0].passes); assert.ok(counters[1].passes > 0);
    assert.equal(counters[1].nodes, counters[0].nodes);
    assertEquivalent(pair, 'active weights ' + weights);
  }
});

test('real driver deaths keep mixer timing and all authored poses through hand release', () => {
  for (const kind of ['raider_driver', 'hero_driver']) {
    const pair = driverPair(kind); initialize(pair);
    for (const { crew } of pair) { crew.steer = .2; seeded(41, () => crew.die({ cause: 'bullet' })); }
    assert.equal(pair[1].crew.deathName, pair[0].crew.deathName);
    assert.match(pair[1].crew.deathName, /^death_sit_/);
    const counters = pair.map(({ crew }) => countModelVisits(crew));
    let heldFrames = 0, releasedFrames = 0;
    for (let frame = 0; frame < 180; frame++) {
      moveCar(pair, frame);
      counters.forEach((counter) => { counter.passes = counter.nodes = 0; });
      const state = { alive: false, steer: Math.sin(frame * .12) * .3, speed: 12, far: frame % 9 < 4 };
      for (const { crew } of pair) crew.update(1 / 60, state);
      const [before, after] = pair.map(({ crew }) => crew);
      assert.equal(after.deadT, before.deadT); assert.equal(after.steer, before.steer);
      assert.equal(after.sawT, before.sawT); assert.equal(after.mixer.time, before.mixer.time);
      assert.equal(after.deathName, before.deathName);
      const actions = (crew) => [...crew.acts].map(([name, action]) => ({ name, time: action?.time, paused: action?.paused,
        weight: action?.getEffectiveWeight(), running: action?.isRunning() }));
      assert.deepEqual(actions(after), actions(before));
      assert.equal(counters[0].passes, 1);
      const progress = Math.min(1, Math.max(0, (after.deadT - after.sitIK[0]) / (after.sitIK[1] - after.sitIK[0])));
      const handWeight = 1 - progress * progress * (3 - 2 * progress);
      // At frame 29, deadT can be .49999999999999994 while the smooth weight
      // already rounds to zero. Compare the actual hand threshold, not end time.
      assert.equal(counters[1].passes, handWeight <= .001 ? 0 : 1,
        kind + ' frame ' + frame + ', deadT=' + after.deadT + ', handWeight=' + handWeight);
      if (counters[1].passes === 0) releasedFrames++; else heldFrames++;
      assertEquivalent(pair, kind + ' death frame ' + frame);
    }
    assert.ok(heldFrames > 0 && releasedFrames > 120, 'the differential must cross hand release and settled death');
  }
});
