// WorldView: everything the player SEES in a run. Fed CarStates + events; identical on the sim peer and the viewer peer.
import * as THREE from 'three';
import { CarView } from '../view/car_view.js';
import { CrewView } from '../view/crew_view.js';
import { VEHICLES } from '../data/vehicles.js';
import { ENEMIES } from '../data/enemies.js';
import * as Assets from '../core/assets.js';

const ENEMY_PAINTS = [0x6d4a30, 0x7a3b2a, 0x4a5a3a, 0x59595a, 0x8a7a4a, 0x3d4a5f, 0x6a2f2f, 0x91856a];
const _q = new THREE.Quaternion();

export class WorldView {
  /** opts: {scene, playerPaint, fx?, audio?} */
  constructor(opts) {
    this.scene = opts.scene; this.playerPaint = opts.playerPaint ?? 0x8f6a3d;
    this.fx = opts.fx || null; this.audio = opts.audio || null;
    this.cars = new Map(); // id -> {view, crew:{gunner?,driver?}, state}
    this.group = new THREE.Group(); this.group.name = 'cars'; this.scene.add(this.group);
    this.night = 0;
    this.armorTier = 0; this.playerWeapon = 'pistol';
    this.projMeshes = new Map();
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
    const mk = (role, kind, seat) => { const c = new CrewView(kind, { role, weapon: role === 'driver' ? null : (st.kind === 'player' ? this.playerWeapon : 'enemy'), armorTier: st.kind === 'player' && role === 'gunner' ? this.armorTier : 0, seed: st.id }); view.root.add(c.root); c.attach(view, seat); return c; };
    if (s.seats.driver) rec.crew.driver = mk('driver', st.kind === 'player' ? 'hero_driver' : 'raider_driver', s.seats.driver);
    if (s.seats.gunner && (st.kind === 'player' || (s.gunners ?? 0) >= 1)) rec.crew.gunner = mk('gunner', st.kind === 'player' ? 'hero_gunner' : ['raider_a', 'raider_b', 'raider_c', 'raider_d'][st.id % 4], s.seats.gunner);
    if (s.seats.gunner2 && (s.gunners ?? 0) >= 2) rec.crew.gunner2 = mk('gunner2', 'raider_b', s.seats.gunner2);
    this.cars.set(st.id, rec);
    return rec;
  }

  remove(id) {
    const rec = this.cars.get(id); if (!rec) return;
    for (const c of Object.values(rec.crew)) c.dispose();
    rec.view.dispose(); this.cars.delete(id);
  }

  /** states: Map(id -> CarState). ctx: {dt, night, playerId, gunnerState} */
  update(dt, states, events, ctx = {}) {
    this.night = ctx.night ?? this.night;
    for (const st of states.values()) {
      const rec = this.ensure(st);
      rec.state = st;
      rec.view.update(st, dt);
      rec.view.setLights(st.braking, this.night > 0.35);
      // crew poses
      const q = st.quat;
      for (const [role, crew] of Object.entries(rec.crew)) {
        const gs = role === 'gunner' ? st.gunner : role === 'gunner2' ? st.gunner2 : null;
        const alive = role === 'driver' ? st.driverAlive : role === 'gunner' ? st.gunnerAlive : st.gunner2Alive;
        crew.update(dt, {
          alive, aimYaw: gs ? gs.yaw : 0, aimPitch: gs ? gs.pitch : 0, fire: gs ? gs.fire : false, crouch: gs ? gs.crouch : false, ads: gs ? gs.ads : false,
          reloading: gs ? gs.reloading : false, weaponId: st.kind === 'player' ? (ctx.playerWeaponId || this.playerWeapon) : null, steer: st.steer, speed: st.speed, quat: st.quat, vel: st.vel,
          local: st.kind === 'player' && role === 'gunner' && ctx.localGunner ? ctx.localGunner : null, exploded: st.exploded,
        });
      }
      if (st.exploded && !rec.wreck) { rec.wreck = true; this._charCar(rec); }
    }
    // remove views for cars that vanished
    for (const id of [...this.cars.keys()]) if (!states.has(id)) this.remove(id);
    // events -> crew reactions and cross-module fan-out
    for (const e of events) this.handleEvent(e, states);
    this._projectiles(ctx.proj || []);
  }

  handleEvent(e, states) {
    const rec = e.id !== undefined ? this.cars.get(e.id) : null;
    if (e.t === 'crewDead' && rec && rec.crew[e.role]) rec.crew[e.role].die(e);
    if (e.t === 'crewHit' && rec && rec.crew[e.role]) rec.crew[e.role].flinch(e);
    if (e.t === 'remove') this.remove(e.id);
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
  dispose() { for (const id of [...this.cars.keys()]) this.remove(id); this.scene.remove(this.group); }
}
