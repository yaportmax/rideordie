// WorldView: everything the player SEES in a run. Fed CarStates + events; identical on the sim peer and the viewer peer.
import * as THREE from 'three';
import { CarView } from '../view/car_view.js';
import { CrewView } from '../view/crew_view.js';
import { VEHICLES } from '../data/vehicles.js';
import { ENEMIES } from '../data/enemies.js';
import * as Assets from '../core/assets.js';
import { DebrisSystem } from '../view/debris.js';
import { BossView } from '../view/boss_view.js';
import { BOSS_ID } from '../data/boss.js';
import { WEAPONS } from '../data/weapons.js';
import { sanitizeVisualLevels } from '../view/car_upgrade_plan.js';
import { sanitizeOpticId } from '../data/weapon_optics.js';
import { GUNNER_ROLES } from '../sim/car.js';

const ENEMY_PAINTS = [0x6d4a30, 0x7a3b2a, 0x4a5a3a, 0x59595a, 0x8a7a4a, 0x3d4a5f, 0x6a2f2f, 0x91856a];
const _sph = new THREE.Sphere();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const DEAD = { alive: false };
const DAMAGE_PANELS = [[0.72, ['bumper_F', 'fender_L']], [0.55, ['door_L', 'door_R2', 'fender_R']], [0.4, ['hood']], [0.28, ['trunk', 'tailgate', 'bumper_R', 'door_R']], [0.14, ['roof', 'door_L2', 'armor_1']]];
const NO_PROJECTILES = [];

/** A tall/long enemy's upper crew can remain on screen after its COM has left
 * the frustum. Bound the real spec and standing crew in its model frame; sphere
 * radius is invariant under vehicle roll/pitch. Player culling keeps its policy. */
export function crewFrustumRadius(spec, restComHeight = 0, kind = 'enemy') {
  if (kind === 'player') return 5;
  const safe = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  let x = safe(spec?.width) / 2 + .2, z = safe(spec?.length) / 2 + .2, top = safe(spec?.height);
  for (const [role, seat] of Object.entries(spec?.seats || {})) {
    if (!Array.isArray(seat)) continue;
    x = Math.max(x, Math.abs(Number(seat[0]) || 0) + 1.2);
    z = Math.max(z, Math.abs(Number(seat[2]) || 0) + 1.2);
    top = Math.max(top, (Number(seat[1]) || 0) + (role === 'driver' ? 1.25 : 1.85));
  }
  const com = Number.isFinite(restComHeight) ? restComHeight : 0;
  return Math.max(5, Math.hypot(x, z, Math.max(Math.abs(com), Math.abs(top - com))));
}

export class WorldView {
  /** opts: {scene, playerPaint, playerUpgradeLevels?, fx?, audio?} */
  constructor(opts) {
    this.scene = opts.scene; this.playerPaint = opts.playerPaint ?? 0x8f6a3d;
    this.playerUpgradeLevels = Object.freeze(sanitizeVisualLevels(opts.playerUpgradeLevels));
    this.playerWeaponOptics = Object.freeze(Object.fromEntries(Object.entries(opts.playerWeaponOptics || {}).map(([id, optic]) => [id, sanitizeOpticId(id, optic)])));
    this.fx = opts.fx || null; this.audio = opts.audio || null;
    this.cars = new Map(); // id -> {view, crew:{gunner?,driver?}, state}
    this.viewMap = new Map(); // id -> CarView (for Fx)
    this.group = new THREE.Group(); this.group.name = 'cars'; this.scene.add(this.group);
    this.night = 0;
    this.groundY = opts.groundY || (() => null);
    this.debris = new DebrisSystem(this.scene, (x, y, z) => this.groundY(x, y, z));
    this.playerWeapon = 'pistol';
    this.projMeshes = new Map();
    this._projectileSeen = new Set();
    this.loose = [];                       // dead crew bodies whose car was removed
    this.rocketGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8).rotateX(Math.PI / 2);
    this.rocketMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, emissive: 0xff6a20, emissiveIntensity: 1.5 });
    this.grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8); this.grenadeMat = new THREE.MeshStandardMaterial({ color: 0x33402a, roughness: 0.6 });
  }

  paintFor(st) {
    if (st.kind === 'player') return this.playerPaint;
    return ENEMY_PAINTS[(st.id * 2654435761 >>> 0) % ENEMY_PAINTS.length];
  }

  ensure(st) {
    let rec = this.cars.get(st.id);
    if (rec && rec.specId !== st.specId) { this.remove(st.id); rec = null; }
    if (rec) return rec;
    const view = new CarView(st.spec, { paint: this.paintFor(st), paint2: 0x30302e, shadowProxy: true, upgradeLevels: st.kind === 'player' ? this.playerUpgradeLevels : undefined });
    view.root.userData.carId = st.id;
    this.group.add(view.root);
    rec = { view, specId: st.specId, crew: {}, state: st, wreck: false, id: st.id,
      crewRadius: crewFrustumRadius(st.spec, st.ride?.restComHeight, st.kind) };
    // crew figures
    const s = st.spec;
    const mk = (role, kind, seat) => { const c = new CrewView(kind, { role, enemyGun: st.gunNames?.[role] || st.gunName, nativeEnemyGun: st.kind === 'enemy' && !!s.gunMuzzles?.[role], weapon: role === 'driver' ? null : (st.kind === 'player' ? this.playerWeapon : 'enemy'), weaponOptics: st.kind === 'player' ? this.playerWeaponOptics : undefined, seed: st.id }); view.root.add(c.root); c.attach(view, seat); c.groundY = this.groundY; return c; };
    // raider faces: 4 gunner types x 2 variants (+ 2 driver variants), picked deterministically from the car id
    const v2 = (n) => (((st.id * 2654435761) >>> (n + 3)) & 1 ? '2' : '');
    if (s.seats.driver) rec.crew.driver = mk('driver', st.kind === 'player' ? 'hero_driver' : 'raider_driver' + v2(0), s.seats.driver);
    for (let index = 0; index < GUNNER_ROLES.length; index++) {
      const role = GUNNER_ROLES[index], seat = s.seats[role];
      if (!seat || (st.kind !== 'player' && (s.gunners ?? 0) <= index)) continue;
      const enemyKind = index === 1 && (s.gunners ?? 0) <= 2 ? 'raider_b' : ['raider_a', 'raider_b', 'raider_c', 'raider_d'][(st.id + index) % 4];
      const kind = st.kind === 'player' ? 'hero_gunner' : enemyKind + v2(index + 1);
      rec.crew[role] = mk(role, kind, seat);
    }
    // Crew membership is fixed for this vehicle spec. Each entry owns a pose
    // scratch object, so updating one character never overwrites another's pose.
    rec.crewEntries = Object.entries(rec.crew).map(([role, crew]) => ({ role, crew, pose: {} }));
    this.cars.set(st.id, rec); this.viewMap.set(st.id, view);
    return rec;
  }

  remove(id, all = false) {
    const rec = this.cars.get(id); if (!rec) return;
    // bodies already thrown onto the road outlive their (despawned) car until they fade out
    for (const { crew: c } of rec.crewEntries) { if (!all && c.detached && c.deadT >= 0 && c.deadT < 9) this.loose.push(c); else c.dispose(); }
    rec.view.dispose(); this.cars.delete(id); this.viewMap.delete(id);
  }

  updateBoss(bs, dt) {
    if (!bs) { if (this.boss) { this.boss.dispose(); this.boss = null; this.viewMap.delete(BOSS_ID); } return; }
    if (!this.boss) { this.boss = new BossView(this.debris); this.scene.add(this.boss.root); this.viewMap.set(BOSS_ID, this.boss); }
    this.boss.update(bs, dt);
  }

  /** states: Map(id -> CarState). ctx: {dt, night, playerId, gunnerState} */
  update(dt, states, events, ctx = {}) {
    this.night = ctx.night ?? this.night;
    const pPos = states.get(ctx.playerId ?? 1)?.pos || null;           // raiders look at / gesture toward the player's truck
    for (const st of states.values()) {
      const rec = this.ensure(st);
      rec.state = st;
      rec.view.update(st, dt);
      rec.view.setLights(st.braking, this.night > 0.35);
      // crew poses (skip + hide crews that are far away or off-screen: skinned characters are the priciest thing we draw)
      const camPos = ctx.cameraPos, frustum = ctx.frustum;
      const distanceSq = camPos ? st.pos.distanceToSquared(camPos) : 0;
      const far = camPos ? distanceSq > (st.kind === 'player' ? 1e18 : 130 * 130) : false;
      const off = frustum && st.kind !== 'player' ? !frustum.intersectsSphere(_sph.set(st.pos, rec.crewRadius || 5)) && !(ctx.frustum2 && ctx.frustum2.intersectsSphere(_sph)) : false;
      const hideCrew = far || off;
      let farCrew = false;
      if (camPos && st.kind !== 'player') { rec.view.setLod(rec.view.lodOn ? distanceSq > 40 * 40 : distanceSq > 46 * 46); farCrew = distanceSq > 40 * 40; } // (LOD: 5 draws instead of 35-60 past ~45 m)
      for (const { crew } of rec.crewEntries) if (crew.deadT < 0) crew.root.visible = !hideCrew; // CrewView skips the hidden render traversal, retaining explicit bone queries.
      if (hideCrew) {
        // bodies thrown off the vehicle live in world space: keep them falling even when their car is off-screen
        for (const { crew: c } of rec.crewEntries) if (c.detached && c.deadT >= 0 && c.deadT < 9.5) c.update(dt, DEAD);
        if (st.exploded && !rec.wreck) { rec.wreck = true; if (!this.fx) this._charCar(rec); } this._damageVisuals(rec, st); continue;
      }
      for (const { role, crew, pose } of rec.crewEntries) {
        const gs = role === 'driver' ? null : st[role];
        const alive = role === 'driver' ? st.driverAlive : st[role + 'Alive'];
        crew.lastVel = st.vel;
        pose.alive = alive; pose.aimYaw = gs ? gs.yaw : 0; pose.aimPitch = gs ? gs.pitch : 0; pose.fire = gs ? gs.fire : false;
        pose.crouch = st.kind === 'player' ? false : gs ? gs.crouch : false; pose.ads = gs ? gs.ads : false; pose.reloading = gs ? gs.reloading : false;
        pose.weaponId = st.kind === 'player' ? (ctx.playerWeaponId || this.playerWeapon) : null;
        pose.enemyGun = st.kind === 'enemy' && role !== 'driver' ? st.gunNames?.[role] || st.gunName : null;
        pose.opticId = st.kind === 'player' ? sanitizeOpticId(pose.weaponId, this.playerWeaponOptics?.[pose.weaponId]) : 'standard';
        pose.steer = st.steer; pose.speed = st.speed; pose.quat = st.quat; pose.vel = st.vel;
        pose.local = st.kind === 'player' && role === 'gunner' && ctx.localGunner ? ctx.localGunner : st.kind === 'player' && role === 'driver' && ctx.localDriver ? ctx.localDriver : null;
        if (st.kind === 'player' && role === 'gunner' && ctx.localGunner) {
          const gn = ctx.localGunner.gunner;
          if (gn) { pose.aimYaw = gn.yaw; pose.aimPitch = gn.pitch; pose.fire = gn.trigger && gn.magNow > 0; pose.ads = gn.ads > 0.5; pose.reloading = gn.reloading; }
        }
        pose.exploded = st.exploded; pose.bedX = st.kind === 'player' ? 0 : gs ? gs.x || 0 : 0; pose.bedZ = st.kind === 'player' ? 0 : gs ? gs.z || 0 : 0;
        pose.airborne = !!st.airborne; pose.far = farCrew; pose.player = st.kind === 'player' ? null : pPos; pose.intent = st.intent;
        crew.update(dt, pose);
      }
      this._damageVisuals(rec, st);
      if (st.exploded && !rec.wreck) { rec.wreck = true; if (!this.fx) this._charCar(rec); this._blowParts(rec, st, 1.0); }
    }
    // remove views for cars that vanished
    for (const id of this.cars.keys()) if (!states.has(id)) this.remove(id);
    // events -> crew reactions and cross-module fan-out
    for (const e of events) this.handleEvent(e, states);
    this._projectiles(ctx.proj || NO_PROJECTILES);
    for (let i = this.loose.length - 1; i >= 0; i--) { const c = this.loose[i]; c.update(dt, DEAD); if (c.deadT > 9.5) { c.dispose(); this.loose.splice(i, 1); } }
    this.debris.update(dt);
  }

  handleEvent(e, states) {
    const rec = e.id !== undefined ? this.cars.get(e.id) : null;
    if (e.t === 'crewDead' && rec && rec.crew[e.role]) rec.crew[e.role].die(e);
    // an enemy crew that just killed one of ours taunts / celebrates
    if (e.t === 'crewDead' && e.id === 1 && e.src > 1) this.cars.get(e.src)?.crew.gunner?.cheer();
    if (e.t === 'grenadeThrow') { const r = this.cars.get(e.src === 'player' || e.src == null ? 1 : e.src); r?.crew[e.role || 'gunner']?.throwGrenade(); }
    if (e.t === 'crewHit' && rec && rec.crew[e.role]) rec.crew[e.role].flinch(e);
    if (e.t === 'shot') {
      const r = e.src === 'player' ? this.cars.get(1) : this.cars.get(e.src);
      const crew = r && (r.crew[e.role || 'gunner'] || r.crew.gunner);
      if (crew) { const w = WEAPONS[e.weapon]; crew.fire(w ? w.rpm / 60 : 8, w ? w.mode : 'auto', w ? (w.pumpTime || w.boltTime) : 0); }
      if (e.src === 'player' && e.rays && this.boss) for (const r of e.rays) if (r.carId === BOSS_ID && r.zone && r.zone !== 'body') this.boss.flash(r.zone, 1 / e.rays.length);   // part hit flash
    }
    if (e.t === 'remove') this.remove(e.id);
    if (e.t === 'crash' && rec && e.dv > 2.2) { this._shedPart(rec, e.dv * 0.6, e.other >= 0); for (const role in rec.crew) rec.crew[role].impact(e.dv); }
    if (e.t === 'tirePop' && rec) { const w = rec.view.spec.wheels[e.index]; const n = w && rec.view.wheelNodes.get(w.name); if (n) n.userData.flat = true; }
    if (e.t === 'explode' && rec && !rec.wreck) { rec.wreck = true; if (!this.fx) this._charCar(rec); this._blowParts(rec, rec.state, 1.4, e.vel); }
  }

  _damageVisuals(rec, st) {
    // detach panels as hp falls through thresholds
    const hp = st.hp01; rec.hpPrev ??= 1;
    if (hp < rec.hpPrev) for (const [th, names] of DAMAGE_PANELS) if (rec.hpPrev >= th && hp < th) for (const nm of names) this._throwPanel(rec, nm, 1.0);
    rec.hpPrev = hp;
    // flat tyres sit lower
    for (const [name, node] of rec.view.wheelNodes) { const target = node.userData.flat ? 0.82 : 1; node.scale.y += (target - node.scale.y) * 0.2; }
  }
  _shedPart(rec, force, ram) {
    const names = [...rec.view.panels.keys()].filter((n) => rec.view.panels.get(n).parent === rec.view.model || rec.view.panels.get(n).parent);
    if (!names.length || Math.random() > 0.55) return;
    this._throwPanel(rec, names[(Math.random() * names.length) | 0], clamp01(force / 6));
  }
  _blowParts(rec, st, k, vel) {
    const v = vel ? new THREE.Vector3(...vel) : st.vel;
    for (const name of [...rec.view.panels.keys()]) if (Math.random() < 0.85) this._throwPanel(rec, name, k, v);
    // wheels fly off too
    let n = 0; for (const [name, node] of rec.view.wheelNodes) { if (n++ % 2 === 0 || Math.random() < 0.3) this._throwWheel(rec, node, k, v); }
  }
  _throwPanel(rec, name, k, baseVel) {
    const node = rec.view.panels.get(name); if (!node || node.userData.gone) return; node.userData.gone = true;
    const v = (baseVel || rec.state.vel).clone();
    v.x += (Math.random() - 0.5) * 9 * k; v.z += (Math.random() - 0.5) * 9 * k; v.y += (4 + Math.random() * 7) * k;
    this.debris.detach(node, v, new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12), 10);
  }
  _throwWheel(rec, node, k, baseVel) {
    if (node.userData.gone) return; node.userData.gone = true;
    const v = (baseVel || rec.state.vel).clone(); v.x += (Math.random() - 0.5) * 12 * k; v.z += (Math.random() - 0.5) * 12 * k; v.y += (5 + Math.random() * 6) * k;
    this.debris.detach(node, v, new THREE.Vector3(v.length() / 0.4, (Math.random() - 0.5) * 3, 0), 9);
  }

  _charCar(rec) {
    rec.view.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.ownedVehicleUpgradeGeometry) {
        const colors = o.geometry.attributes.color;
        if (colors) { for (let i = 0; i < colors.array.length; i++) colors.array[i] *= .35; colors.needsUpdate = true; }
      }
      for (const m of [].concat(o.material)) {
        if (m.userData.sharedVehicleUpgrade) continue;
        if (m.name && /^paint/.test(m.name)) m.color.multiplyScalar(0.12); else if (m.color && !/glass|light/.test(m.name || '')) m.color.multiplyScalar(0.35); if (/light/.test(m.name || '')) m.emissiveIntensity = 0;
      }
    });
  }

  _projectiles(list) {
    const seen = this._projectileSeen; seen.clear();
    let i = 0;
    for (const p of list) {
      const key = p.k + ':' + i++;
      let m = this.projMeshes.get(key);
      if (!m) { m = new THREE.Mesh(p.k === 1 ? this.rocketGeo : this.grenadeGeo, p.k === 1 ? this.rocketMat : this.grenadeMat); this.scene.add(m); this.projMeshes.set(key, m); }
      m.position.set(p.x, p.y, p.z); seen.add(key);
    }
    for (const [k, m] of this.projMeshes) if (!seen.has(k)) { this.scene.remove(m); this.projMeshes.delete(k); }
  }

  /** Position of the local player's truck gunner head (camera pivot) in world space, from the crew view (falls back to seat). */
  gunnerPivot(st, out) {
    const rec = this.cars.get(st.id);
    const seat = st.spec.seats.gunner;
    if (rec && rec.crew.gunner && rec.crew.gunner.headWorld(out)) return out;
    out.set(seat[0], seat[1] + 1.6 - st.ride.restComHeight, seat[2]).applyQuaternion(st.quat).add(st.pos);
    return out;
  }
  muzzlePos(st, out, role = 'gunner') {
    const rec = this.cars.get(st.id);
    if (rec?.crew[role]?.muzzleWorld(out)) return true;
    return false;
  }
  /** Resolve the physical deck rig before camera/shot sampling on a weapon swap.
   * Its sockets remain world-space and also serve the remote driver's view. */
  mountedWeapon(st, weaponId = null) {
    const record = this.cars.get(st?.id) || (st && weaponId === 'minigun' ? this.ensure(st) : null);
    const crew = record?.crew.gunner;
    if (!crew) return null;
    if (weaponId && crew.weaponId !== weaponId) crew.setWeapon(weaponId, this.playerWeaponOptics?.[weaponId]);
    return crew.weapon?.mounted ? crew.weapon : null;
  }
  aimMountedWeapon(st, direction, weaponId = null) {
    return this.mountedWeapon(st, weaponId)?.aimWorld(direction) || false;
  }
  syncMountedHands(st, reloading = undefined) {
    return this.cars.get(st?.id)?.crew.gunner?.syncMountedHands(reloading) || false;
  }
  /** Notify the local viewmodel after the current pose was used to fire. */
  notifyLocalShot(st, gunner) {
    const crew = this.cars.get(st.id)?.crew.gunner;
    if (crew?.useVm) crew.vm?.notifyShot?.(gunner);
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    if (this.boss) { this.boss.dispose(); this.boss = null; }
    for (const id of this.cars.keys()) this.remove(id, true);
    for (const c of this.loose) c.dispose(); this.loose.length = 0;
    for (const mesh of this.projMeshes.values()) this.scene.remove(mesh);
    this.projMeshes.clear(); this._projectileSeen.clear(); this.viewMap.clear();
    this.rocketGeo.dispose(); this.rocketMat.dispose(); this.grenadeGeo.dispose(); this.grenadeMat.dispose();
    this.debris.clear(); this.scene.remove(this.group);
  }
}
