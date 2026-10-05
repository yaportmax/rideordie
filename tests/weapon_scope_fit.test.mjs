// WORK-authored checks, not executed here. Compose with actual production source
// and run through root's sequential CPU/native validation lease.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeaponAssets, THREE } from './helpers/weapon-assets.mjs';
import { WeaponView } from '../src/view/weapon_view.js';
import { MountedGun } from '../src/view/mounted_gun.js';
import { COMBAT_SCOPE_WINDOW, combatScopeHousingGeometry } from '../src/view/combat_scope.js';

await loadWeaponAssets();

function proxies(root) {
  root.updateWorldMatrix(true, true);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), meshes = [];
  root.traverse(mesh => {
    if (!mesh.isMesh || mesh.material.isShaderMaterial || /glass|lens/.test(mesh.material.name || '')) return;
    for (let node = mesh; node; node = node.parent) if (!node.visible) return;
    const proxy = new THREE.Mesh(mesh.geometry, material); proxy.matrixWorld.copy(mesh.matrixWorld); meshes.push(proxy);
  });
  return { material, hits(origin, direction, far = 2) { return new THREE.Raycaster(origin, direction, 0, far).intersectObjects(meshes, false); } };
}

test('compact flared scope has distinct real lens diameters and preserves the prior rear aim point', () => {
  assert.equal(COMBAT_SCOPE_WINDOW.frontZ - COMBAT_SCOPE_WINDOW.rearZ, .08);
  assert.equal(COMBAT_SCOPE_WINDOW.innerRadius, .018); assert.equal(COMBAT_SCOPE_WINDOW.frontInnerRadius, .028);
  for (const [id, y] of [['rifle', .1603], ['sniper', .1367]]) {
    const gun = new WeaponView(id, { opticId: 'combat_3x' });
    try {
      const optic = gun.optic, aim = optic.aim.getWorldPosition(new THREE.Vector3());
      assert.ok(aim.distanceTo(new THREE.Vector3(0, y, -.09)) < 1e-8, 'ADS eye/weapon/muzzle relationship stays authored');
      assert.equal(optic.glass.geometry.parameters.radius, .018);
      assert.equal(optic.frontGlass.geometry.parameters.radius, .028);
      assert.notEqual(optic.glass.geometry, optic.frontGlass.geometry);
      for (const lens of [optic.glass, optic.frontGlass]) { assert.equal(lens.material.transparent, true); assert.equal(lens.material.depthWrite, false); }
    } finally { gun.dispose(); }
  }
});

test('actual physical scope walls expose at least a 400 pixel pupil at 720p and retain an opaque outer ring', () => {
  const gun = new WeaponView('rifle', { opticId: 'combat_3x' }), optic = gun.optic, rays = proxies(optic.root);
  try {
    const eye = optic.aim.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, -optic.mount.relief));
    const focal = 2 * Math.tan(optic.mount.adsFov * Math.PI / 360) / 720;
    for (const radius of [0, 100, 200]) for (let i = 0; i < 16; i++) {
      const angle = i / 16 * Math.PI * 2;
      const direction = new THREE.Vector3(Math.cos(angle) * radius * focal, Math.sin(angle) * radius * focal, 1).normalize();
      assert.equal(rays.hits(eye, direction).length, 0, `400 pixel pupil: radius ${radius}, angle ${i} has no tube/cap obstruction`);
    }
    const outerDirection = new THREE.Vector3(270 * focal, 0, 1).normalize();
    assert.ok(rays.hits(eye, outerDirection).length, 'a physical opaque rim still bounds the objective aperture');
    const normal = combatScopeHousingGeometry().attributes.normal;
    for (let i = 0; i < normal.count; i++) assert.ok(Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) < 1e-5);
    assert.notDeepEqual([normal.getX(0), normal.getY(0), normal.getZ(0)], [normal.getX(1), normal.getY(1), normal.getZ(1)],
      'adjacent outer-wall vertices have analytical smooth radial normals');
  } finally { rays.material.dispose(); gun.dispose(); }
});

for (const id of ['rifle', 'sniper']) test(`${id}: full visible gun does not introduce a hidden-cap aperture regression`, () => {
  const gun = new WeaponView(id, { opticId: 'combat_3x' }), rays = proxies(gun.root);
  try {
    const eye = gun.optic.aim.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, -gun.optic.mount.relief));
    // These broad full-model parallel rays retain the existing actual-source
    // aperture oracle; the 400px angular and native scopes are separate checks.
    for (const x of [-.012, -.006, 0, .006, .012]) for (const y of [-.011, 0, .011]) {
      assert.equal(rays.hits(eye.clone().add(new THREE.Vector3(x, y, 0)), new THREE.Vector3(0, 0, 1)).length, 0);
    }
  } finally { rays.material.dispose(); gun.dispose(); }
});

test('every legacy magazine tier changes actual moving geometry even with paid extended capacity equipped', () => {
  for (const id of ['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'minigun']) {
    let previous = null;
    for (let mag = 0; mag <= 3; mag++) {
      const gun = id === 'minigun' ? new MountedGun(id, { levels: { mag }, attachments: ['extended_mag'] }) :
        new WeaponView(id, { levels: { mag }, attachments: ['extended_mag'] });
      try {
        const vertices = gun.modifications.objects.flatMap(mesh => [...mesh.geometry.attributes.position.array]);
        if (previous) assert.notDeepEqual(vertices, previous, `${id}: legacy mag ${mag} has a physical tier detail independent of max capacity length`);
        if (mag) {
          const mark = gun.modifications.plan.find(row => row.id === 'legacy_capacity_index');
          assert.ok(mark); assert.equal(mark.level, mag); assert.equal(mark.pieces.length, mag);
          for (const mesh of gun.modifications.objects.filter(mesh => mesh.userData.weaponAttachments.includes('legacy_capacity_index'))) {
            assert.equal(mesh.parent, id === 'shotgun' ? gun.nodes.body : gun.nodes.mag);
          }
        }
        previous = vertices;
      } finally { gun.dispose(); }
    }
  }
});

test('foregrip rail bridges close the underside gap without changing support contact or shotgun pump ownership', () => {
  for (const [id, p] of [['smg', [.004, .040, .188]], ['rifle', [0, .058, .325]], ['lmg', [0, .051, .312]], ['shotgun', [0, .027, .350]]]) {
    const gun = new WeaponView(id, { attachments: ['foregrip'] });
    try {
      const row = gun.modifications.plan.find(row => row.id === 'foregrip'), bridge = row.pieces[0], rail = row.pieces[1];
      assert.equal(row.parent, id === 'shotgun' ? 'pump' : 'body');
      assert.ok(bridge.p[1] + bridge.size[1] / 2 > p[1], 'real bridge enters the authored underside');
      assert.ok(bridge.p[1] - bridge.size[1] / 2 < rail.p[1] + rail.size[1] / 2, 'bridge physically overlaps its mounting rail');
      const contact = gun.sockets.grip_L.getWorldPosition(new THREE.Vector3());
      assert.ok(contact.distanceTo(new THREE.Vector3(p[0], p[1] - .018, p[2] - .010)) < 1e-8);
      if (id === 'shotgun') assert.equal(gun.sockets.grip_L.parent, gun.nodes.pump);
    } finally { gun.dispose(); }
  }
});
