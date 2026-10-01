import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeaponAssets, WEAPON_IDS, THREE } from './helpers/weapon-assets.mjs';
import { ViewModel, VMU } from '../src/view/viewmodel.js';
import { WeaponView } from '../src/view/weapon_view.js';
import { WEAPONS } from '../src/data/weapons.js';

await loadWeaponAssets();
function fixture(t, id, ads = 0) {
  const oldWindow = globalThis.window; globalThis.window = {};
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture());
  const vm = new ViewModel(), camera = new THREE.PerspectiveCamera(60, 16 / 9, .01, 200);
  const gunner = { weaponId: id, weapon: WEAPONS[id], slots: [id], shots: 0, pos: new THREE.Vector3(), magNow: WEAPONS[id].mag, trigger: false, swapT: 0, throwing: 0, reloading: false, reloadT: 0 };
  const state = { local: { camera, gunner, adsK: ads, eye: new THREE.Vector3(900, 900, 900) }, vel: new THREE.Vector3() };
  vm.update(0, state, true); t.after(() => vm.dispose());
  return { vm, camera, gunner, state };
}

// Test every solid triangle from either side, without changing a shared material.
// World matrices include actual merged-mesh and animated-part transforms.
function solidHits(gun, origin, direction) {
  gun.root.updateMatrixWorld(true);
  const probes = [], material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  gun.model.traverse(mesh => {
    if (!mesh.isMesh || mesh.material.isShaderMaterial || gun.lenses?.includes(mesh) || /glass|lens/.test(mesh.material.name || '')) return;
    const proxy = new THREE.Mesh(mesh.geometry, material); proxy.matrixWorld.copy(mesh.matrixWorld); probes.push(proxy);
  });
  try { return new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize(), 0, 1).intersectObjects(probes, false); }
  finally { material.dispose(); }
}
function choose(gun, ads) { for (const cut of gun.adsCut) cut.mesh.geometry = ads ? cut.keep : cut.full; }
function unpose(gun) { gun.root.position.set(0, 0, 0); gun.root.quaternion.identity(); }

for (const [id, y, z, x] of [['rifle', .1585, -.09, 0], ['lmg', .146, -.03, 0], ['sniper', .124, -.20, 0], ['rpg', .106, -.20, .064]]) {
  test(`${id}: actual solid optic caps open a bounded viewing aperture`, t => {
    const { vm } = fixture(t, id), gun = vm.gun; unpose(gun);
    assert.ok(solidHits(gun, [x + .0008, y + .0008, z], [0, 0, 1]).length, 'the original authored cap reproduces the blocker');
    choose(gun, true);
    for (const dx of [-.0008, .0008]) for (const dy of [-.0008, .0008]) {
      assert.equal(solidHits(gun, [x + dx, y + dy, z], [0, 0, 1]).length, 0, 'neighboring sight rays see the world through the optical bore');
    }
    choose(gun, false);
    assert.ok(solidHits(gun, [x + .0008, y + .0008, z], [0, 0, 1]).length, 'hip geometry returns to the full original');
  });
}

test('SMG opens only the hood caps, retains its front post, and clears the aligned sight ray', t => {
  const { vm } = fixture(t, 'smg'), gun = vm.gun; unpose(gun);
  const oldLine = () => solidHits(gun, [0, .107, -.08], [0, 0, 1]);
  assert.ok(oldLine().some(h => Math.abs(h.point.z - .286) < 1e-5), 'opaque rear hood cap reproduces the screenshot');
  choose(gun, true);
  const hits = oldLine();
  assert.ok(hits.length, 'the front blade remains intact');
  assert.ok(hits.every(h => h.point.z > .290 && h.point.z < .296), 'only the front blade intersects the old low sight line');
  const slope = .0045 / .353;
  for (const dx of [-.0003, 0, .0003]) assert.equal(solidHits(gun, [dx, .107 + slope * (-.08 + .06) + .0004, -.08], [0, slope, 1]).length, 0, 'above the aligned front post is an open view');
  // A ray beyond the cut radius still sees the original protective front hood.
  assert.ok(solidHits(gun, [.009, .104, .26], [0, 0, 1]).length, 'front sight rim remains solid');
});

test('sniper reticle crosshair survives removal of its surrounding opaque caps', t => {
  const { vm } = fixture(t, 'sniper'), gun = vm.gun; unpose(gun); choose(gun, true);
  const hits = solidHits(gun, [0, .124, -.20], [0, 0, 1]);
  assert.ok(hits.length, 'intentional crosshair is retained');
  assert.ok(hits.every(h => h.point.z > .15975 && h.point.z < .16025), 'no solid scope cap remains in front of the crosshair');
});

test('SMG captured native pose clears a broad target window above its retained front post', t => {
  const { vm } = fixture(t, 'smg', 1), gun = vm.gun;
  // Exact native v12 pose that reproduced three rear-plate hits at 4x8 pixels.
  gun.root.position.fromArray([.0000586021490863149, -.10812739999225032, -.29754087250174793]);
  gun.root.quaternion.fromArray([.00009338234632933592, .999979470893066, -.006406499943836916, -.00007635856636125381]);
  const direction = (dx, dy) => [2 * dx / 1440 * Math.tan(52 * Math.PI / 360), -2 * dy / 1440 * Math.tan(52 * Math.PI / 360), -1];
  choose(gun, false);
  for (const dx of [-4, 0, 4]) assert.ok(solidHits(gun, [0, 0, 0], direction(dx, -8)).length, 'original rear plate reproduces the native blocked rays');
  choose(gun, true);
  for (const dx of [-12, -6, 0, 6, 12]) for (const dy of [-16, -12, -8, -4]) {
    assert.equal(solidHits(gun, [0, 0, 0], direction(dx, dy)).length, 0, `native target window ${dx},${dy} remains open`);
  }
});

test('all eight expose useful normalized target windows through idle breathing and road buzz', t => {
  const { vm, state, gunner } = fixture(t, 'pistol', 1); state.vel.set(40, 0, 0);
  for (const id of WEAPON_IDS) {
    gunner.weaponId = id; gunner.weapon = WEAPONS[id]; gunner.magNow = gunner.weapon.mag;
    for (const time of [0, 1.7, 3.4, 5.1]) {
      vm.t = time; vm.update(0, state, true);
      for (const height of [720, 1080, 1440]) for (const dx of [-12, -6, 0, 6, 12]) for (const dy of [-16, -12, -8]) {
        // Pixel offsets scale with output height, keeping the target window's
        // angular size fixed instead of weakening it on smaller viewports.
        const sx = dx * height / 1440, sy = dy * height / 1440;
        const dir = [2 * sx / height * Math.tan(vm.fov * Math.PI / 360), -2 * sy / height * Math.tan(vm.fov * Math.PI / 360), -1];
        const hits = solidHits(vm.gun, [0, 0, 0], dir);
        if (id === 'sniper') {
          assert.ok(hits.every(hit => {
            const point = vm.gun.root.worldToLocal(hit.point.clone());
            return point.z > .15975 && point.z < .16025;
          }), 'only the intentional thin crosshair may intersect a target window ray');
        } else assert.equal(hits.length, 0, `${id} time ${time}: open ${dx},${dy} at ${height}px height`);
      }
    }
  }
});

test('rear ghost-ring windows retain solid outer housings and original hip geometry', t => {
  const { vm } = fixture(t, 'smg');
  for (const [id, y, z, rim] of [['smg', .107, -.08, .006], ['lmg', .146, -.03, .0049], ['shotgun', .09, -.01, .0053]]) {
    const gun = vm._gunFor(id); unpose(gun);
    const full = solidHits(gun, [rim, y, z], [0, 0, 1]); assert.ok(full.length, `${id}: authored outer rim exists`);
    choose(gun, true); assert.ok(solidHits(gun, [rim, y, z], [0, 0, 1]).length, `${id}: outer housing still frames the opening`);
    choose(gun, false); for (const cut of gun.adsCut) assert.equal(cut.mesh.geometry, cut.full);
  }
});

test('optional sight preparation preserves unsupported meshes while still opening the actual rifle optic', t => {
  const { vm } = fixture(t, 'rifle'), gun = vm.gun; unpose(gun);
  const grouped = new THREE.BoxGeometry(.02, .02, .04), unindexed = new THREE.PlaneGeometry(.02, .02).toNonIndexed();
  const material = new THREE.MeshBasicMaterial(), added = [grouped, unindexed].map(geometry => new THREE.Mesh(geometry, material));
  for (const mesh of added) { mesh.position.set(0, .1585, -.04); gun.root.add(mesh); }
  t.after(() => { for (const mesh of added) mesh.removeFromParent(); grouped.dispose(); unindexed.dispose(); material.dispose(); });
  const cuts = gun.prepareSightBores();
  assert.ok(cuts.some(cut => cut.mesh.name === 'Scene_merged_gun_black'), 'the real indexed merged optic still receives its exact bore');
  for (const mesh of added) assert.ok(!cuts.some(cut => cut.mesh === mesh), 'unsupported groups or nonindexed data retain their original geometry');
  assert.equal(added[0].geometry, grouped); assert.equal(added[1].geometry, unindexed);
  for (const cut of cuts) cut.mesh.geometry = cut.keep;
  for (const mesh of added) mesh.removeFromParent();
  assert.equal(solidHits(gun, [.0008, .1593, -.09], [0, 0, 1]).length, 0, 'supported optical opening is not weakened by optional unsupported neighbors');
});

test('all eight retain full hip/reload/external models and cache only ADS variants', t => {
  const { vm, state, gunner } = fixture(t, 'pistol');
  const sibling = new ViewModel(); t.after(() => sibling.dispose());
  for (const id of WEAPON_IDS) {
    const gun = vm._gunFor(id), other = sibling._gunFor(id), external = new WeaponView(id);
    t.after(() => external.dispose());
    const templateGeometry = []; external.model.traverse(mesh => { if (mesh.isMesh) templateGeometry.push(mesh.geometry); });
    const sourceBytes = new Map(templateGeometry.map(geo => [geo, geo.attributes.position.array.slice()]));
    for (const cut of gun.adsCut) {
      assert.equal(cut.mesh.geometry, cut.full, `${id}: original hip geometry`);
      assert.ok(templateGeometry.includes(cut.full), `${id}: shared asset full geometry identity`);
      assert.equal(other.adsCut.find(c => c.mesh.name === cut.mesh.name)?.keep, cut.keep, `${id}: shared cached variant`);
    }
    gunner.weaponId = id; gunner.weapon = WEAPONS[id]; state.local.adsK = 1;
    vm.update(0, state, true);
    for (const cut of gun.adsCut) assert.equal(cut.mesh.geometry, cut.keep, `${id}: actual ADS selects the variant`);
    gunner.reloading = true; state.local.adsK = 0; vm.update(0, state, true);
    for (const cut of gun.adsCut) assert.equal(cut.mesh.geometry, cut.full, `${id}: lowered reload retains full geometry`);
    gunner.reloading = false;
    for (const [geometry, bytes] of sourceBytes) assert.deepEqual(geometry.attributes.position.array, bytes, `${id}: template geometry bytes unchanged`);
  }
});

test('all optical glass stays transparent and cannot write an opaque depth cap', t => {
  const { vm } = fixture(t, 'rifle', 1);
  for (const id of ['rifle', 'sniper', 'rpg']) {
    const gun = vm._gunFor(id); assert.ok(gun.lenses.length, `${id}: actual glass is recognized`);
    for (const lens of gun.lenses) {
      assert.equal(lens.material.transparent, true); assert.equal(lens.material.depthWrite, false);
      assert.ok(lens.material.opacity <= .14 && lens.material.opacity > 0);
    }
  }
  assert.ok(vm.gun.lenses.every(lens => Math.abs(lens.material.opacity - .035) < 1e-9), 'settled rifle ADS glass remains nearly clear');
});

test('authored rear and front sights align through the actual ADS transform', t => {
  const { vm } = fixture(t, 'smg', 1);
  const lines = {
    smg: [[0, .107, -.06], [0, .1115, .293]],
    shotgun: [[0, .09, .008], [0, .0785, .6565]],
    lmg: [[0, .146, -.0105], [0, .140, .602]],
    revolver: [[0, .0996, .0364], [0, .0984, .2435]],
  };
  for (const [id, points] of Object.entries(lines)) {
    const T = vm.T = id === 'smg' ? vm.T : (() => {
      const gunner = { weaponId: id, weapon: WEAPONS[id], slots: [id], shots: 0, pos: new THREE.Vector3(), magNow: WEAPONS[id].mag };
      vm.update(0, { local: { camera: vm.cam, gunner, adsK: 1 }, vel: new THREE.Vector3() }, true); return vm.T;
    })();
    const deg = Math.PI / 180, q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(T.adsRot || [0, 0, 0]).map(x => x * deg), 'YXZ')).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    const p = new THREE.Vector3(0, 0, -T.relief).sub(new THREE.Vector3(...T.adsSight).applyQuaternion(q));
    for (const point of points) {
      const view = new THREE.Vector3(...point).applyQuaternion(q).add(p);
      assert.ok(Math.abs(view.x) < 1e-6 && Math.abs(view.y) < 4e-6, `${id}: rear/front optical line crosses the view axis`);
      assert.ok(view.z < 0, `${id}: sight lies ahead of the eye`);
    }
  }
});

test('muzzle and eject FX project onto current rendered sockets after camera/FOV changes', t => {
  const { vm, camera } = fixture(t, 'smg', 1), parent = new THREE.Group(); parent.add(camera);
  parent.position.set(4, -3, 7); parent.rotation.set(.2, -.6, .1);
  camera.position.set(.8, 2, -1); camera.rotation.set(-.1, .4, 0);
  for (const fov of [32, 59, 83]) {
    camera.fov = fov; camera.updateProjectionMatrix(); parent.updateMatrixWorld(true);
    for (const [socket, query] of [[vm.muzzleCam, out => vm.muzzleWorld(out)], [vm.ejectCam, out => vm.ejectWorld(out)]]) {
      const actual = new THREE.Vector3(); assert.equal(query(actual), true);
      const projected = actual.project(camera), rendered = socket.clone().applyMatrix4(VMU.vmProj.value);
      assert.ok(Math.abs(projected.x - rendered.x) < 1e-9 && Math.abs(projected.y - rendered.y) < 1e-9, 'native camera projection equals the VM shader projection');
    }
    const dir = new THREE.Vector3(); vm.ejectWorld(new THREE.Vector3(), dir);
    assert.ok(dir.distanceTo(vm.ejectDirCam.clone().transformDirection(camera.matrixWorld)) < 1e-9, 'shell direction follows the camera world rotation');
  }
});

test('first cached loadout sockets stay weapon-local through six seconds of moving-camera swaps and reparenting', t => {
  const oldWindow = globalThis.window; globalThis.window = {};
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture());
  const vm = new ViewModel(), parent = new THREE.Group(), camera = new THREE.PerspectiveCamera(60, 16 / 9, .01, 200);
  t.after(() => vm.dispose()); parent.add(camera);
  parent.position.set(3, 2, -5); parent.rotation.set(.05, .3, -.02);
  camera.position.set(.4, 4.8, 35); camera.rotation.set(.01, Math.PI, 0);
  // Leave world matrices stale, as on the first Run-created camera attachment.
  const gunner = { weaponId: 'pistol', weapon: WEAPONS.pistol, slots: ['pistol', 'revolver', 'smg'], shots: 0, pos: new THREE.Vector3(), magNow: 12, trigger: false, swapT: 0, throwing: 0, reloading: false, reloadT: 0 };
  const state = { local: { camera, gunner, adsK: 1 }, vel: new THREE.Vector3(0, 0, 40) };
  const expected = new Map();
  for (const id of gunner.slots) {
    const reference = new WeaponView(id); reference.root.updateWorldMatrix(true, true);
    expected.set(id, Object.fromEntries(Object.entries(reference.sockets).map(([name, socket]) => [name, { p: socket.getWorldPosition(new THREE.Vector3()), q: socket.getWorldQuaternion(new THREE.Quaternion()) }])));
    reference.dispose();
  }
  const sequence = ['pistol', 'smg', 'revolver', 'pistol'];
  for (let frame = 0; frame < 360; frame++) {
    const index = Math.min(3, Math.floor(frame / 90)), id = sequence[index], localFrame = frame % 90;
    gunner.weaponId = id; gunner.weapon = WEAPONS[id]; gunner.magNow = gunner.weapon.mag;
    gunner.swapT = localFrame === 0 && frame > 0 ? .42 : Math.max(0, .42 - localFrame / 60);
    camera.position.z = 35 + frame * 40 / 60; camera.rotation.y = Math.PI + Math.sin(frame / 50) * .2;
    camera.fov = 50 + 8 * Math.sin(frame / 40); camera.updateProjectionMatrix();
    // A new camera parent reuses the cached loadout without changing its sockets.
    if (frame === 180) { const next = new THREE.Group(); next.position.set(-20, 3, 45); next.rotation.y = -.4; next.add(camera); }
    vm.update(1 / 60, state, true);
    for (const [weaponId, gun] of vm.guns) for (const [name, socket] of Object.entries(expected.get(weaponId))) {
      assert.ok(gun.loc[name].p.distanceTo(socket.p) < 1e-8, `${weaponId} ${name}: cached position is independent of initial world camera`);
      const angle = gun.loc[name].q.clone().normalize().angleTo(socket.q.clone().normalize());
      assert.ok(angle < 1e-6, `${weaponId} ${name}: cached orientation is independent of world camera (${angle} radians)`);
    }
    vm.root.updateWorldMatrix(true, true);
    const muzzle = new THREE.Vector3(); assert.equal(vm.muzzleWorld(muzzle), true);
    const viewMuzzle = vm.gun.sockets.muzzle.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse);
    assert.ok(viewMuzzle.z < 0 && viewMuzzle.length() < 1.5, 'authored barrel stays near and ahead of the camera');
    const projected = muzzle.project(camera), rendered = viewMuzzle.applyMatrix4(VMU.vmProj.value);
    assert.ok(Math.abs(projected.x - rendered.x) < 1e-8 && Math.abs(projected.y - rendered.y) < 1e-8, 'cached apparent muzzle matches the actual rendered socket through every swap frame');
  }
});

test('deferred shots show the flash immediately and kick only once without moving the posed muzzle', t => {
  const { vm, gunner, state } = fixture(t, 'smg', 1);
  const position = vm.gun.root.position.clone(), quat = vm.gun.root.quaternion.clone(), muzzle = vm.muzzleCam.clone();
  const kick = t.mock.method(vm, '_kick', vm._kick.bind(vm));
  assert.equal(vm.flashStar.visible, false); gunner.shots++; vm.notifyShot(gunner);
  assert.equal(kick.mock.callCount(), 1); assert.equal(vm.flashStar.visible, true);
  assert.deepEqual(vm.gun.root.position.toArray(), position.toArray()); assert.deepEqual(vm.gun.root.quaternion.toArray(), quat.toArray()); assert.deepEqual(vm.muzzleCam.toArray(), muzzle.toArray());
  vm.notifyShot(gunner); vm.update(1 / 60, state, true);
  assert.equal(kick.mock.callCount(), 1, 'next pose update does not consume the same shot again');
  assert.ok(vm.gun.root.position.distanceTo(position) > 0, 'subsequent frame advances recoil springs');
});
