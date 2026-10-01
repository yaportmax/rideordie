import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeaponAssets, WEAPON_IDS, THREE } from './helpers/weapon-assets.mjs';
import { ViewModel } from '../src/view/viewmodel.js';
import { WEAPONS } from '../src/data/weapons.js';

await loadWeaponAssets();

const browserFixtures = new WeakSet();
function fixture(t, id, ads = 0) {
  if (!browserFixtures.has(t)) {
    browserFixtures.add(t);
    const previousWindow = globalThis.window;
    if (!previousWindow) globalThis.window = {};
    t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
    t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture());
  }
  const vm = new ViewModel(), camera = new THREE.PerspectiveCamera(60, 16 / 9, .01, 200);
  camera.add(vm.root);
  const gunner = { weaponId: id, weapon: WEAPONS[id], slots: [id], shots: 0, pos: new THREE.Vector3(), magNow: 0, trigger: false, swapT: 0, throwing: 0, reloading: false, reloadT: 0 };
  const state = { local: { camera, gunner, adsK: ads }, vel: new THREE.Vector3() };
  vm.update(0, state, true);
  t.after(() => vm.dispose());
  return { vm, camera, gunner, state };
}

function handFrame(vm, side) {
  const socket = vm.B['socket_hand_' + side[0]];
  return { p: socket.getWorldPosition(new THREE.Vector3()), q: socket.getWorldQuaternion(new THREE.Quaternion()) };
}

for (const id of WEAPON_IDS) for (const ads of [0, 1]) {
  test(`${id} ${ads ? 'ADS' : 'hip'}: real arm sockets remain close to their reload contact targets`, t => {
    const { vm, gunner, state } = fixture(t, id, ads);
    gunner.reloading = true; vm.relAmt = 1;
    // Evaluate the authored choreography rather than accumulated stochastic
    // recoil. The 1/400 spacing samples magazine, rack, crane and rocket travel.
    let maxL = 0, maxR = 0, worstL = 0, worstR = 0;
    for (let i = 0; i <= 400; i++) {
      const r = i / 400; gunner.reloadT = r * gunner.weapon.reload;
      vm.update(0, state, true);
      const l = handFrame(vm, 'Left'), right = handFrame(vm, 'Right');
      const le = l.p.distanceTo(vm._aL.p), re = right.p.distanceTo(vm._aR.p);
      if (id === 'rpg') assert.ok(right.p.z < -.04, `reload ${r}: launcher grip remains in front of the camera`);
      if (le > maxL) { maxL = le; worstL = r; }
      if (re > maxR) { maxR = re; worstR = r; }
      for (const bone of vm.armBones) assert.ok([...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.matrixWorld.elements].every(Number.isFinite), `${id} ${r}: finite arm transform`);
    }
    assert.ok(maxL < .04, `${id} left contact missed by ${(maxL * 1000).toFixed(1)} mm at reload ${worstL}`);
    assert.ok(maxR < .04, `${id} right contact missed by ${(maxR * 1000).toFixed(1)} mm at reload ${worstR}`);
  });
}

test('shotgun final shell returns both hands continuously through the finishing pump', t => {
  const { vm, gunner, state } = fixture(t, 'shotgun');
  gunner.reloading = true; vm.relAmt = 1;
  for (let i = 0; i <= 100; i++) { gunner.reloadT = i / 100 * gunner.weapon.reload; vm.update(0, state, true); }
  let previous = ['Left', 'Right'].map(side => handFrame(vm, side));
  gunner.reloading = false; gunner.magNow = gunner.weapon.mag;
  // A single frame used to teleport the support hand about 0.55 m and rotate
  // it 76 degrees. Check the actual shell completion transition and settle.
  for (let i = 0; i < 90; i++) {
    vm.update(1 / 120, state, true);
    const current = ['Left', 'Right'].map(side => handFrame(vm, side));
    for (let hand = 0; hand < 2; hand++) {
      assert.ok(current[hand].p.distanceTo(previous[hand].p) < .10, `hand ${hand}, exit frame ${i}: no socket teleport`);
      assert.ok(current[hand].q.angleTo(previous[hand].q) < .35, `hand ${hand}, exit frame ${i}: no wrist snap`);
    }
    previous = current;
  }
  assert.ok(handFrame(vm, 'Left').p.distanceTo(vm._aL.p) < .015, 'support hand settles back on the fore-end');
});

test('shotgun first shell and interrupted shell preserve the current hand contact', t => {
  const { vm, gunner, state } = fixture(t, 'shotgun');
  const change = dt => {
    const previous = handFrame(vm, 'Left'); vm.update(dt, state, true);
    const next = handFrame(vm, 'Left');
    assert.ok(next.p.distanceTo(previous.p) < .10, `support hand reaches instead of teleporting at reloadT=${gunner.reloadT}, reloading=${gunner.reloading}: ${next.p.distanceTo(previous.p)}`);
    assert.ok(next.q.angleTo(previous.q) < .35, `support wrist blends instead of snapping at reloadT=${gunner.reloadT}, reloading=${gunner.reloading}`);
  };
  for (let reload = 0; reload < 2; reload++) {
    gunner.reloading = true; gunner.reloadT = 0; change(1 / 120);
    for (let i = 1; i <= 33; i++) { gunner.reloadT = i / 120; change(1 / 120); }
    // Cancel while a shell is being inserted, rather than assuming every
    // completion starts from the pocket endpoint of the authored cycle.
    gunner.reloading = false;
    for (let i = 0; i < 90; i++) change(1 / 120);
  }
});

test('sniper bolt contact tracks the real handle knob when it unlocks, translates and relocks', t => {
  const { vm } = fixture(t, 'sniper'), gun = vm.gun, node = gun.nodes.bolt_handle;
  const anchor = () => vm._anchor('bolt', gun, { p: new THREE.Vector3(), q: new THREE.Quaternion() });
  const rest = anchor();
  // Express the initial grasp in the handle frame. It must be on the authored
  // knob side of the hinge, and that same local frame must follow the mechanism.
  const restWorld = rest.p.clone().applyMatrix4(vm.root.matrixWorld);
  const local = node.worldToLocal(restWorld.clone());
  assert.ok(local.x < -.04 && local.x > -.09, `bolt grip is on knob side, local x=${local.x}`);
  node.updateWorldMatrix(true, false);
  const relativeQ = node.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rest.q);
  for (const b of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]) {
    gun.update(0, { parts: { bolt: b } }); gun.root.updateMatrixWorld(true);
    const actual = anchor(), expectedP = node.localToWorld(local.clone());
    const expectedQ = node.getWorldQuaternion(new THREE.Quaternion()).multiply(relativeQ);
    assert.ok(actual.p.distanceTo(expectedP) < 1e-5, `bolt ${b}: contact follows rotating knob`);
    assert.ok(actual.q.angleTo(expectedQ) < 1e-4, `bolt ${b}: wrist follows handle rotation`);
  }
});

test('LMG cover contact follows the rotating lid rather than its fixed hinge', t => {
  const { vm } = fixture(t, 'lmg'), gun = vm.gun, node = gun.nodes.feed_cover;
  const anchor = () => vm._anchor('cover', gun, { p: new THREE.Vector3(), q: new THREE.Quaternion() });
  const rest = anchor(), local = node.worldToLocal(rest.p.clone());
  const relativeQ = node.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rest.q);
  for (const cover of [.1, .25, .42, 0]) {
    gun.update(0, { parts: { cover } }); gun.root.updateMatrixWorld(true);
    const actual = anchor(), expectedP = node.localToWorld(local.clone());
    const expectedQ = node.getWorldQuaternion(new THREE.Quaternion()).multiply(relativeQ);
    assert.ok(actual.p.distanceTo(expectedP) < 1e-5, `cover ${cover}: contact follows lid`);
    assert.ok(actual.q.angleTo(expectedQ) < 1e-4, `cover ${cover}: wrist follows lid rotation`);
  }
});

test('revolver support contact keeps its frame on the cylinder as the crane opens', t => {
  const { vm } = fixture(t, 'revolver'), gun = vm.gun, socket = gun.sockets.mag_well;
  const anchor = () => vm._anchor('cyl', gun, { p: new THREE.Vector3(), q: new THREE.Quaternion() });
  const rest = anchor(), local = socket.worldToLocal(rest.p.clone());
  const relativeQ = socket.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rest.q);
  for (const crane of [.1, .5, 1, .25, 0]) {
    gun.update(0, { parts: { crane } }); gun.root.updateMatrixWorld(true);
    const actual = anchor(), expectedP = socket.localToWorld(local.clone());
    const expectedQ = socket.getWorldQuaternion(new THREE.Quaternion()).multiply(relativeQ);
    assert.ok(actual.p.distanceTo(expectedP) < 1e-5, `crane ${crane}: contact follows cylinder`);
    assert.ok(actual.q.angleTo(expectedQ) < 1e-4, `crane ${crane}: wrist follows cylinder rotation`);
  }
});

test('swapping away from a shotgun reload clears its finish pose for every other weapon', t => {
  const { vm, gunner, state } = fixture(t, 'shotgun');
  for (const id of WEAPON_IDS.filter(id => id !== 'shotgun')) {
    gunner.weaponId = 'shotgun'; gunner.weapon = WEAPONS.shotgun; gunner.slots = ['shotgun', id];
    gunner.reloading = true; gunner.reloadT = .24; vm.update(.02, state, true);
    gunner.weaponId = id; gunner.weapon = WEAPONS[id]; gunner.reloading = false; gunner.reloadT = 0;
    vm.update(.02, state, true);
    assert.equal(vm.gun.id, id); assert.equal(vm._shotExitT, undefined); assert.equal(vm.pumpAfter, 0);
    assert.deepEqual(vm._R.lh, { a: 'grip', b: 'grip', w: 0, arc: 0 });
    for (const side of ['Left', 'Right']) assert.ok(handFrame(vm, side).p.toArray().every(Number.isFinite));
  }
});

test('support fingers keep their pose as reload reach segments join', t => {
  const joins = { pistol: [.18, .28, .44, .54], revolver: [.1, .34, .4, .56, .68], smg: [.08, .6, .71], shotgun: [.25], rifle: [.08, .5, .58], lmg: [.05, .1, .14, .48, .53, .58, .63, .68, .73, .8, .87], sniper: [.08, .5, .6] };
  for (const [id, points] of Object.entries(joins)) {
    const { vm, gunner, state } = fixture(t, id);
    gunner.reloading = true; vm.relAmt = 1;
    const fingers = Object.entries(vm.B).filter(([name]) => /^LeftHand(Thumb|Index|Middle|Ring|Pinky)\d/.test(name)).map(([, bone]) => bone);
    assert.ok(fingers.length >= 15, 'real authored finger chains are present');
    for (const r of points) {
      gunner.reloadT = (r - 1e-6) * gunner.weapon.reload; vm.update(0, state, true);
      const before = fingers.map(bone => bone.quaternion.clone());
      gunner.reloadT = (r + 1e-6) * gunner.weapon.reload; vm.update(0, state, true);
      for (let i = 0; i < fingers.length; i++) assert.ok(fingers[i].quaternion.angleTo(before[i]) < .002, `${id} join ${r}: ${fingers[i].name} does not snap`);
    }
  }
});

test('rack-only handles return to rest while a zero rack leaves shot cycling intact', t => {
  const { vm: lmg } = fixture(t, 'lmg'), gun = lmg.gun, node = gun.nodes.charging_handle;
  gun.update(0, { parts: { rack: 1 } });
  assert.ok(node.position.distanceTo(gun.rest.charging_handle.p) > .05, 'real handle was pulled back');
  gun.update(0, { parts: { rack: 0 } });
  assert.ok(node.position.distanceTo(gun.rest.charging_handle.p) < 1e-7, 'handle returns when rack ends');
  const { vm: rifle } = fixture(t, 'rifle');
  rifle.gun.fire(10); rifle.gun.update(.01, { parts: { rack: 0 } });
  assert.ok(rifle.gun.nodes.charging_handle.position.distanceTo(rifle.gun.rest.charging_handle.p) > .01, 'rack reset preserves rifle shot cycle');
});
