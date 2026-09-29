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

const ENEMY_PAINTS = [0x6d4a30, 0x7a3b2a, 0x4a5a3a, 0x59595a, 0x8a7a4a, 0x3d4a5f, 0x6a2f2f, 0x91856a];
const _q = new THREE.Quaternion();
const _sph = new THREE.Sphere();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const DEAD = { alive: false };

export class WorldView {
  /** opts: {scene, playerPaint, fx?, audio?} */
  constructor(opts) {
    this.scene = opts.scene; this.playerPaint = opts.playerPaint ?? 0x8f6a3d;
    this.fx = opts.fx || null; this.audio = opts.audio || null;
    this.cars = new Map(); // id -> {view, crew:{gunner?,driver?}, state}
    this.viewMap = new Map(); // id -> CarView (for Fx)
    this.group = new THREE.Group(); this.group.name = 'cars'; this.scene.add(this.group);
    this.night = 0;
    this.groundY = opts.groundY || (() => null);
    this.debris = new DebrisSystem(this.scene, (x, y, z) => this.groundY(x, y, z));
    this.armorTier = 0; this.playerWeapon = 'pistol';
    this.projMeshes = new Map();
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
    const view = new CarView(st.spec, { paint: this.paintFor(st), paint2: 0x30302e });
    view.root.userData.carId = st.id;
    this.group.add(view.root);
    rec = { view, specId: st.specId, crew: {}, state: st, wreck: false, id: st.id };
    // crew figures
    const s = st.spec;
    const mk = (role, kind, seat) => { const c = new CrewView(kind, { role, enemyGun: st.gunName, weapon: role === 'driver' ? null : (st.kind === 'player' ? this.playerWeapon : 'enemy'), armorTier: st.kind === 'player' && role === 'gunner' ? this.armorTier : 0, seed: st.id }); view.root.add(c.root); c.attach(view, seat); c.groundY = this.groundY; return c; };
    if (s.seats.driver) rec.crew.driver = mk('driver', st.kind === 'player' ? 'hero_driver' : 'raider_driver', s.seats.driver);
    if (s.seats.gunner && (st.kind === 'player' || (s.gunners ?? 0) >= 1)) rec.crew.gunner = mk('gunner', st.kind === 'player' ? 'hero_gunner' : ['raider_a', 'raider_b', 'raider_c', 'raider_d'][st.id % 4], s.seats.gunner);
    if (s.seats.gunner2 && (s.gunners ?? 0) >= 2) rec.crew.gunner2 = mk('gunner2', 'raider_b', s.seats.gunner2);
    this.cars.set(st.id, rec); this.viewMap.set(st.id, view);
    return rec;
  }

  remove(id, all = false) {
    const rec = this.cars.get(id); if (!rec) return;
    // bodies already thrown onto the road outlive their (despawned) car until they fade out
    for (const c of Object.values(rec.crew)) { if (!all && c.detached && c.deadT >= 0 && c.deadT < 9) this.loose.push(c); else c.dispose(); }
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
      const q = st.quat;
      const camPos = ctx.cameraPos, frustum = ctx.frustum;
      const far = camPos ? st.pos.distanceTo(camPos) > (st.kind === 'player' ? 1e9 : 130) : false;
      const off = frustum && st.kind !== 'player' ? !frustum.intersectsSphere(_sph.set(st.pos, 5)) && !(ctx.frustum2 && ctx.frustum2.intersectsSphere(_sph)) : false;
      const hideCrew = far || off;
      let farCrew = false;
      if (camPos && st.kind !== 'player') { const dd = st.pos.distanceTo(camPos); rec.view.setLod(rec.view.lodOn ? dd > 52 : dd > 62); farCrew = dd > 40; }
      for (const crew of Object.values(rec.crew)) if (crew.deadT < 0) crew.root.visible = !hideCrew;
      if (hideCrew) {
        // bodies thrown off the vehicle live in world space: keep them falling even when their car is off-screen
        for (const role in rec.crew) { const c = rec.crew[role]; if (c.detached && c.deadT >= 0 && c.deadT < 9.5) c.update(dt, DEAD); }
        if (st.exploded && !rec.wreck) { rec.wreck = true; if (!this.fx) this._charCar(rec); } this._damageVisuals(rec, st); continue;
      }
      for (const [role, crew] of Object.entries(rec.crew)) {
        const gs = role === 'gunner' ? st.gunner : role === 'gunner2' ? st.gunner2 : null;
        const alive = role === 'driver' ? st.driverAlive : role === 'gunner' ? st.gunnerAlive : st.gunner2Alive;
        crew.lastVel = st.vel;
        crew.update(dt, {
          alive, aimYaw: gs ? gs.yaw : 0, aimPitch: gs ? gs.pitch : 0, fire: gs ? gs.fire : false, crouch: gs ? gs.crouch : false, ads: gs ? gs.ads : false,
          reloading: gs ? gs.reloading : false, weaponId: st.kind === 'player' ? (ctx.playerWeaponId || this.playerWeapon) : null, steer: st.steer, speed: st.speed, quat: st.quat, vel: st.vel,
          local: st.kind === 'player' && role === 'gunner' && ctx.localGunner ? ctx.localGunner : st.kind === 'player' && role === 'driver' && ctx.localDriver ? ctx.localDriver : null, exploded: st.exploded,
          bedX: gs ? gs.x || 0 : 0, bedZ: gs ? gs.z || 0 : 0, airborne: !!st.airborne, far: farCrew, player: st.kind === 'player' ? null : pPos, intent: st.intent,
        });
      }
      this._damageVisuals(rec, st);
      if (st.exploded && !rec.wreck) { rec.wreck = true; if (!this.fx) this._charCar(rec); this._blowParts(rec, st, 1.0); }
    }
    // remove views for cars that vanished
    for (const id of [...this.cars.keys()]) if (!states.has(id)) this.remove(id);
    // events -> crew reactions and cross-module fan-out
    for (const e of events) this.handleEvent(e, states);
    this._projectiles(ctx.proj || []);
    for (let i = this.loose.length - 1; i >= 0; i--) { const c = this.loose[i]; c.update(dt, DEAD); if (c.deadT > 9.5) { c.dispose(); this.loose.splice(i, 1); } }
    this.debris.update(dt);
  }

  handleEvent(e, states) {
    const rec = e.id !== undefined ? this.cars.get(e.id) : null;
    if (e.t === 'crewDead' && rec && rec.crew[e.role]) rec.crew[e.role].die(e);
    // an enemy crew that just killed one of ours taunts / celebrates
    if (e.t === 'crewDead' && e.id === 1 && e.src > 1) this.cars.get(e.src)?.crew.gunner?.cheer();
    if (e.t === 'grenadeThrow') { const r = this.cars.get(1); r?.crew.gunner?.throwGrenade(); }
    if (e.t === 'crewHit' && rec && rec.crew[e.role]) rec.crew[e.role].flinch(e);
    if (e.t === 'shot') {
      const r = e.src === 'player' ? this.cars.get(1) : this.cars.get(e.src);
      const crew = r && (r.crew[e.role || 'gunner'] || r.crew.gunner);
      if (crew) { const w = WEAPONS[e.weapon]; crew.fire(w ? w.rpm / 60 : 8, w ? w.mode : 'auto', w ? (w.pumpTime || w.boltTime) : 0); }
    }
    if (e.t === 'remove') this.remove(e.id);
    if (e.t === 'crash' && rec && e.dv > 2.2) { this._shedPart(rec, e.dv * 0.6, e.other >= 0); for (const role in rec.crew) rec.crew[role].impact(e.dv); }
    if (e.t === 'tirePop' && rec) { const w = rec.view.spec.wheels[e.index]; const n = w && rec.view.wheelNodes.get(w.name); if (n) n.userData.flat = true; }
    if (e.t === 'explode' && rec && !rec.wreck) { rec.wreck = true; if (!this.fx) this._charCar(rec); this._blowParts(rec, rec.state, 1.4, e.vel); }
  }

  _damageVisuals(rec, st) {
    // detach panels as hp falls through thresholds
    const hp = st.hp01; rec.hpPrev ??= 1;
    const T = [[0.72, ['bumper_F', 'fender_L']], [0.55, ['door_L', 'door_R2', 'fender_R']], [0.4, ['hood']], [0.28, ['trunk', 'tailgate', 'bumper_R', 'door_R']], [0.14, ['roof', 'door_L2', 'armor_1']]];
    for (const [th, names] of T) if (rec.hpPrev >= th && hp < th) for (const nm of names) this._throwPanel(rec, nm, 1.0);
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
      for (const m of [].concat(o.material)) { if (m.name && /^paint/.test(m.name)) m.color.multiplyScalar(0.12); else if (m.color && !/glass|light/.test(m.name || '')) m.color.multiplyScalar(0.35); if (/light/.test(m.name || '')) m.emissiveIntensity = 0; }
    });
  }

  _projectiles(list) {
    const seen = new Set();
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
    out.set(seat[0], seat[1] + 1.6, seat[2]).sub(_q.set(0, 0, 0, 1) && new THREE.Vector3(0, st.ride.restComHeight, 0)).applyQuaternion(st.quat).add(st.pos);
    return out;
  }
  muzzlePos(st, out) {
    const rec = this.cars.get(st.id);
    if (rec && rec.crew.gunner && rec.crew.gunner.muzzleWorld(out)) return true;
    return false;
  }
  dispose() { if (this.boss) { this.boss.dispose(); this.boss = null; } for (const id of [...this.cars.keys()]) this.remove(id, true); for (const c of this.loose) c.dispose(); this.loose.length = 0; this.debris.clear(); this.scene.remove(this.group); }
}
