// CrewView: a person riding in a car (driver / gunner). PLACEHOLDER figure until the rigged characters + IK system land;
// the API below is the contract the real implementation keeps: constructor(kind, opts), attach, update, die, flinch, headWorld, muzzleWorld, dispose.
import * as THREE from 'three';
import { WeaponView } from './weapon_view.js';

const ENEMY_GUN_MODEL = { pistol: 'pistol', smg: 'smg', rifle: 'rifle', shotgun: 'shotgun', mg: 'lmg', hmg: 'lmg', rpg: 'rpg' };

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const skin = new THREE.MeshStandardMaterial({ color: 0xc89a78, roughness: 0.8 });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.7 });

export class CrewView {
  constructor(kind, opts = {}) {
    this.kind = kind; this.role = opts.role; this.alive = true; this.opts = opts;
    this.root = new THREE.Group(); this.root.name = 'crew_' + kind;
    const hero = /^hero/.test(kind);
    const cloth = new THREE.MeshStandardMaterial({ color: hero ? (this.role === 'driver' ? 0x3d5c8f : 0xd9a441) : 0x5a4a3a, roughness: 0.9 });
    this.body = new THREE.Group(); this.root.add(this.body);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.28), cloth); torso.position.y = 1.08; this.body.add(torso);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.26), new THREE.MeshStandardMaterial({ color: 0x3a3a3a })); legs.position.y = 0.45; this.body.add(legs);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin); this.head.position.y = 1.55; this.body.add(this.head);
    this.gun = null; this.muzzle = new THREE.Object3D();
    if (this.role !== 'driver') {
      this.gunPivot = new THREE.Group(); this.gunPivot.position.y = 1.3; this.body.add(this.gunPivot);
      this.gun = new THREE.Group(); this.gun.position.set(-0.2, -0.05, 0.3); this.gunPivot.add(this.gun);
      this.setWeapon(opts.weapon === 'enemy' ? ENEMY_GUN_MODEL[opts.enemyGun] || 'rifle' : opts.weapon || 'pistol');
      this.muzzle.position.set(-0.2, 0.02, 0.9); this.gunPivot.add(this.muzzle);
    }
    this.seat = null; this.car = null; this.deadT = 0; this.flinchT = 0;
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  }
  setWeapon(id) {
    if (!id || id === this.weaponId) return;
    this.weaponId = id;
    if (this.weapon) this.weapon.dispose();
    this.weapon = new WeaponView(id); this.gun.add(this.weapon.root);
    // launchers sit on the shoulder
    this.gun.position.set(-0.2, id === 'rpg' ? 0.12 : -0.05, id === 'rpg' ? 0.05 : 0.3);
  }
  fire(rate, mode, actionLen) { if (!this.weapon) return; this.weapon.fire(rate); if (mode === 'pump' || mode === 'bolt') this.weapon.action(actionLen || 0.6); this.kick = 1; }
  attach(carView, seat) { this.car = carView; this.seat = seat; this.root.position.set(seat[0], seat[1], seat[2]); this.root.rotation.order = 'YXZ'; }
  update(dt, s) {
    if (!s.alive) { this.body.visible = false; return; }
    this.body.visible = true;
    if (this.role === 'driver') { this.body.position.y = 0.0; return; }
    // aim is in world space: convert to the car's local yaw
    _e.setFromQuaternion(s.quat, 'YXZ');
    this.body.rotation.y = s.aimYaw - _e.y;
    this.body.position.y = s.crouch ? -0.35 : 0;
    this.gunPivot.rotation.x = -s.aimPitch;
    if (s.weaponId) this.setWeapon(s.weaponId);
    this.kick = Math.max(0, (this.kick || 0) - dt * 12); this.gun.position.z = (this.weaponId === 'rpg' ? 0.05 : 0.3) - this.kick * 0.045;
    if (this.weapon) {
      if (s.reloading && !this.reloadStart) this.reloadStart = performance.now(); else if (!s.reloading) this.reloadStart = 0;
      const r01 = s.local ? (s.local.reloadLen ? s.local.reloadT / s.local.reloadLen : 0) : this.reloadStart ? Math.min(1, (performance.now() - this.reloadStart) / 2000) : 0;
      this.weapon.update(dt, { trigger: s.fire, reloading: s.reloading, reload01: r01 });
    }
    if (this.flinchT > 0) { this.flinchT -= dt; this.body.rotation.x = -this.flinchT * 0.8; } else this.body.rotation.x = 0;
    this.root.updateMatrixWorld(true);
  }
  die() { this.alive = false; this.body.visible = false; }
  flinch() { this.flinchT = 0.25; }
  headWorld(out) { if (!this.head) return false; this.head.getWorldPosition(out); return true; }
  muzzleWorld(out) { if (!this.gun) return false; if (this.weapon && this.weapon.muzzleWorld(out)) return true; this.muzzle.getWorldPosition(out); return true; }
  dispose() { this.root.removeFromParent(); }
}
