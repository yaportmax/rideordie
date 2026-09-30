import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCrewAssets, realCrewPair, seeded, countModelVisits, matrixSnapshot, THREE, WEAPONS } from './helpers/crew-assets.mjs';

await loadCrewAssets();

function updateAt(f, frame, s) {
  const original = globalThis.performance;
  globalThis.performance = { now: () => 1000 + frame * 1000 / 60 };
  try { seeded(100 + frame, () => f.crew.update(1 / 60, s)); } finally { globalThis.performance = original; }
}

function pose(f, frame, { far = false, local = false, reload = true } = {}) {
  const t = frame / 60, reloading = reload && frame >= 12 && frame < 48;
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(.06 * Math.sin(t), .3 + t * .4, .04 * Math.cos(t), 'YXZ'));
  f.car.root.position.set(t * 6, .15 * Math.sin(t * 3), -t * 8); f.car.root.quaternion.copy(quat);
  f.camera.position.set(.2 + t * 6, 2.5, -.7 - t * 8); f.camera.quaternion.copy(quat);
  const s = { alive: true, quat, vel: new THREE.Vector3(6, .1 * Math.cos(t), -8), speed: 18, steer: .2 * Math.sin(t), far,
    aimYaw: .5 + t * .7, aimPitch: .05 * Math.sin(t * 2), crouch: frame > 35, ads: frame > 20, fire: frame % 9 === 0,
    reloading, bedX: .08 * Math.sin(t), bedZ: .05 * Math.cos(t), player: new THREE.Vector3(5, 2, 8), weaponId: f.crew.weaponId };
  if (local) {
    Object.assign(f.gunner, { trigger: s.fire, reloading, reloadT: (frame - 12) / 60, shots: Math.floor(frame / 9), crouch: s.crouch ? 1 : 0 });
    s.local = { firstPerson: true, camera: f.camera, gunner: f.gunner, eye: f.camera.position.clone(), adsK: Math.min(1, frame / 30),
      bedX: s.bedX, bedZ: s.bedZ, reloadLen: WEAPONS[f.crew.weaponId].reload, reloadT: f.gunner.reloadT };
  }
  return s;
}

function assertPosePair(pair, label, refresh = true) {
  if (refresh) pair.forEach((f) => f.scene.updateMatrixWorld(true));
  // Authored model, bone/hand-mounted gun, procedural gun frame and dedicated VM
  // are compared separately. UUIDs/material identities are intentionally absent.
  const roots = (f) => [f.crew.model, f.crew.weapon.root, f.crew.vm?.root].filter(Boolean);
  assert.deepEqual(roots(pair[1]).map(matrixSnapshot), roots(pair[0]).map(matrixSnapshot), label);
  assert.deepEqual([pair[1].crew.bodyYaw, pair[1].crew.aimK, pair[1].crew.crouch, pair[1].crew.sway.toArray(), pair[1].crew.whip.toArray()],
    [pair[0].crew.bodyYaw, pair[0].crew.aimK, pair[0].crew.crouch, pair[0].crew.sway.toArray(), pair[0].crew.whip.toArray()], label + ' state');
}

test('real rig, weapon grips/reload and spine poses match with current and deliberately stale ancestors', () => {
  const previous = globalThis.window, previousDocument = globalThis.document; globalThis.window = {};
  globalThis.document = { createElementNS: () => {
    const listeners = new Map();
    return { width: 1, height: 1, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: (event) => listeners.delete(event),
      set src(value) { this.url = value; queueMicrotask(() => listeners.get('load')?.call(this)); } };
  } };
  try {
    for (const weapon of ['pistol', 'smg', 'shotgun']) for (const local of [false, true]) for (const far of [false, true]) {
      const pair = realCrewPair({ kind: local ? 'hero_gunner' : 'raider_a', weapon });
      assert.ok(pair.every((f) => f.crew.rigged && f.crew.bones.socket_hand_R && f.crew.weapon.model));
      for (let frame = 0; frame < 64; frame++) {
        pair.forEach((f) => {
          const s = pose(f, frame, { local, far });
          // Alternating calls reproduce both renderer-refreshed and stale parent
          // matrices. Local positions/rotations always move before CrewView.
          if (!(frame % 2)) f.scene.updateMatrixWorld(true);
          updateAt(f, frame, s);
        });
        const label = `${weapon} local=${local} far=${far} frame=${frame}`;
        assertPosePair(pair, label, false); assertPosePair(pair, label);
      }
      if (local) assert.ok(pair.every((f) => f.crew.vm?.dedicatedArms && f.crew.vm.gun.model));
      pair.forEach((f) => { f.crew.dispose(); f.car.dispose(); });
    }
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('fallback external gun-frame mount keeps its required descendant refresh', () => {
  const pair = realCrewPair({ weapon: 'smg' });
  pair.forEach((f) => { delete f.crew.bones.socket_hand_R; delete f.crew.bones.socket_hand_L; f.crew.gripDelta = null; f.crew.mountAt = null; });
  const counts = pair.map((f) => countModelVisits(f.crew));
  for (let frame = 0; frame < 20; frame++) {
    pair.forEach((f) => updateAt(f, frame, pose(f, frame, { far: true })));
    assert.ok(pair.every((f) => f.crew.mountAt === 'gun'));
    assertPosePair(pair, `fallback ${frame}`, false); assertPosePair(pair, `fallback ${frame}`);
  }
  assert.equal(counts[1].passes, counts[0].passes);
  pair.forEach((f) => f.crew.dispose());
});

test('real grenade hand reparenting and weapon swaps retain exact clip/socket poses', () => {
  for (const far of [false, true]) {
    const pair = realCrewPair({ weapon: 'rifle' });
    pair.forEach((f) => { updateAt(f, 0, pose(f, 0, { far, reload: false })); seeded(81, () => f.crew.throwGrenade()); });
    let sawLeftMount = false, sawRightAfterLeft = false;
    for (let frame = 1; frame < 90; frame++) {
      pair.forEach((f) => {
        const s = pose(f, frame, { far, reload: false }); s.fire = false;
        if (frame >= 24) s.weaponId = 'smg';
        updateAt(f, frame, s);
      });
      if (pair[0].crew.mountAt === 'L') sawLeftMount = true;
      if (sawLeftMount && pair[0].crew.mountAt === 'R') sawRightAfterLeft = true;
      assert.equal(pair[1].crew.mountAt, pair[0].crew.mountAt);
      assertPosePair(pair, `throw far=${far} frame=${frame}`, false); assertPosePair(pair, `throw far=${far} frame=${frame}`);
    }
    assert.ok(sawLeftMount && sawRightAfterLeft);
    pair.forEach((f) => { f.crew.dispose(); f.car.dispose(); });
  }
});

test('each rigged hand-mounted gunner update removes exactly one model subtree pass', () => {
  const pair = realCrewPair({ weapon: 'rifle' });
  pair.forEach((f) => updateAt(f, 0, pose(f, 0, { far: true, reload: false })));
  const counts = pair.map((f) => countModelVisits(f.crew));
  pair.forEach((f) => updateAt(f, 1, pose(f, 1, { far: true, reload: false })));
  const authoredAndHeldNodes = []; pair[0].crew.model.traverse((o) => authoredAndHeldNodes.push(o));
  assert.equal(counts[0].passes - counts[1].passes, 1);
  assert.equal(counts[0].nodes - counts[1].nodes, authoredAndHeldNodes.length);
  assert.ok(authoredAndHeldNodes.length >= 60); // 52 real bones, sockets and held rifle
  assertPosePair(pair, 'single pass');
  pair.forEach((f) => f.crew.dispose());
});
