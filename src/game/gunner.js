// GunnerController: runs on the gunner's machine (or in solo). Aim, recoil, spread, reload, hitscan against cars + world,
// grenades/rockets requests. Produces `shot` events (tracers/flash/sound) and hit reports for the sim to apply.
import * as THREE from 'three';
import { WEAPONS, weaponStats, GRENADE } from '../data/weapons.js';
import { clamp, damp, lerp, wrapAngle, D2R } from '../core/util.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _m = new THREE.Vector3();

export class GunnerController {
  /**
   * @param loadout {weapons:[id..], levels:{id:{dmg,mag,rel,hnd}}, grenades:number, grenadeLv:number, armorTier:number}
   * @param ctx {ownCar():carLike, targets():Iterable<carLike>, raycastWorld(o,d,max)->{t,normal,kind}|null, emit(evt), report(hit), throwGrenade(o,d), fireRocket(o,d,stats)}
   */
  constructor(loadout, ctx) {
    this.ctx = ctx;
    this.slots = loadout.weapons.slice(0, 3);
    this.levels = loadout.levels || {};
    this.stats = this.slots.map((id) => weaponStats(id, this.levels[id]));
    this.mag = this.stats.map((s) => s.mag);
    this.cur = 0; this.yaw = 0; this.pitch = 0; this.crouch = 0; this.ads = 0;
    this.fireT = 0; this.reloadT = 0; this.reloading = false; this.pumpT = 0; this.boltT = 0;
    this.bloom = 0; this.recoilAnim = 0; this.swapT = 0; this.shots = 0; this.spinup = 0;
    this.grenades = loadout.grenades ?? GRENADE.count; this.grenadeCd = 0; this.grenadeLv = loadout.grenadeLv || 0;
    this.pos = new THREE.Vector3(); // offset inside the bed (x,z), y unused
    this.muzzle = new THREE.Vector3(); this.aimPoint = new THREE.Vector3(); this.aimHit = false;
    this.lastCarYaw = null; this.trigger = false; this.hitMarker = 0;
    this.shellQueue = [];
    this.dryClickT = 0;
    this.throwing = 0;
  }

  get weapon() { return this.stats[this.cur]; }
  get weaponId() { return this.slots[this.cur]; }
  get magNow() { return this.mag[this.cur]; }

  swapTo(i) {
    if (i < 0 || i >= this.slots.length || i === this.cur) return;
    this.cur = i; this.reloading = false; this.reloadT = 0; this.swapT = 0.42; this.fireT = Math.max(this.fireT, 0.2); this.pumpT = 0; this.boltT = 0;
    this.ctx.emit({ t: 'weaponSwap', weapon: this.slots[i] });
  }

  startReload() {
    const w = this.weapon;
    if (this.reloading || this.mag[this.cur] >= w.mag || this.swapT > 0 || this.throwing > 0) return;
    this.reloading = true; this.reloadT = 0; this.reloadBegan = w.reloadPerShell ? 0.35 : w.reload;
    this.ctx.emit({ t: 'reloadStart', weapon: w.id, time: w.reloadPerShell ? (w.mag - this.mag[this.cur]) * w.reload + 0.4 : w.reload });
  }

  /**
   * @param cmd from Input.gunner()
   * @param cam {position:Vector3, dir:Vector3} the camera used for aiming (previous frame is fine)
   * @param carYaw current heading of the truck (for stabilised aim)
   */
  update(dt, cmd, cam, carYaw, extra = {}) {
    const w = this.weapon;
    // ---- aim (world-space stabilised, inherits a fraction of the truck's turn)
    if (this.lastCarYaw !== null) this.yaw += wrapAngle(carYaw - this.lastCarYaw) * 0.55;
    this.lastCarYaw = carYaw;
    const adsMul = this.ads > 0.5 ? (w.scope ? 0.28 : 0.6) : 1;
    this.yaw += cmd.dYaw * adsMul; this.pitch = clamp(this.pitch + cmd.dPitch * adsMul, -1.15, 1.2);
    this.yaw = wrapAngle(this.yaw);
    this.crouch = damp(this.crouch, cmd.crouch ? 1 : 0, 12, dt);
    this.ads = damp(this.ads, cmd.ads && !this.reloading && this.swapT <= 0 ? 1 : 0, 14, dt);
    // bed movement (small range)
    const bx = this.pos.x + cmd.moveX * dt * 2.2, bz = this.pos.z + cmd.moveZ * dt * 2.0;
    this.pos.x = clamp(bx, -0.55, 0.55); this.pos.z = clamp(bz, -0.45, 0.45);
    // ---- timers
    this.fireT = Math.max(0, this.fireT - dt); this.swapT = Math.max(0, this.swapT - dt); this.grenadeCd = Math.max(0, this.grenadeCd - dt);
    this.bloom = Math.max(0, this.bloom - w.spread.recover * dt * 0.6); this.recoilAnim = damp(this.recoilAnim, 0, 14, dt);
    this.hitMarker = Math.max(0, this.hitMarker - dt); this.dryClickT = Math.max(0, this.dryClickT - dt); this.throwing = Math.max(0, this.throwing - dt);
    if (this.pumpT > 0) this.pumpT -= dt; if (this.boltT > 0) this.boltT -= dt;
    // ---- weapon swap
    if (cmd.slot >= 0) this.swapTo(cmd.slot);
    if (cmd.swap !== 0) { const n = this.slots.length; this.swapTo(((this.cur + (cmd.swap > 0 ? 1 : -1)) % n + n) % n); }
    // ---- reload
    if (cmd.reload) this.startReload();
    if (this.reloading) {
      this.reloadT += dt;
      if (w.reloadPerShell) {
        if (this.reloadT >= w.reload) { this.reloadT = 0; this.mag[this.cur]++; this.ctx.emit({ t: 'shellIn', weapon: w.id }); if (this.mag[this.cur] >= w.mag) { this.reloading = false; this.ctx.emit({ t: 'reloadEnd', weapon: w.id }); } }
        if (cmd.fire && this.mag[this.cur] > 0) { this.reloading = false; }
      } else if (this.reloadT >= w.reload) { this.mag[this.cur] = w.mag; this.reloading = false; this.ctx.emit({ t: 'reloadEnd', weapon: w.id }); }
    }
    // ---- grenade
    if (cmd.grenade && this.grenades > 0 && this.grenadeCd <= 0 && this.throwing <= 0 && !this.reloading) {
      this.throwGrenade(cam, extra.carVel);
    }
    // ---- fire
    const canFire = !this.reloading && this.swapT <= 0 && this.fireT <= 0 && this.pumpT <= 0 && this.boltT <= 0 && this.throwing <= 0;
    let want = false;
    if (w.mode === 'auto') want = cmd.fire; else want = cmd.firePressed || (cmd.fire && !this.trigger && false);
    if (w.mode === 'semi' && cmd.fire && !this.trigger) want = true;
    if (w.mode === 'pump' || w.mode === 'bolt' || w.mode === 'launcher') want = cmd.fire && !this.trigger;
    this.trigger = cmd.fire;
    if (want && canFire) {
      if (this.mag[this.cur] > 0) this.fire(cam, extra);
      else { if (this.dryClickT <= 0) { this.ctx.emit({ t: 'dryClick', weapon: w.id }); this.dryClickT = 0.3; } this.startReload(); }
    }
    return this;
  }

  /**
   * Gamepad aim assist (console-style): slowdown over targets, gentle tracking of moving targets, snap toward the nearest target on ADS press.
   * points: [{p: Vector3 (world), v: Vector3 (world velocity)}], cam: {position, dir}
   */
  assist(cmd, dt, cam, points, ownVel) {
    if (!points.length) return;
    let best = null, bestA = 0.12; // ~7 degrees cone
    for (const t of points) {
      _o.copy(t.p).sub(cam.position); const dist = _o.length(); if (dist < 3 || dist > 220) continue;
      _o.multiplyScalar(1 / dist);
      const a = Math.acos(Math.min(1, _o.dot(cam.dir)));
      const cone = Math.max(0.035, Math.min(0.12, 2.2 / dist)); // bigger near, smaller far (angular size of a car)
      if (a < cone && a < bestA) { bestA = a; best = { t, dist, a, cone }; }
    }
    if (!best) { this._assistT = null; return; }
    // 1) slowdown near the target
    const slow = 0.45 + 0.55 * (best.a / best.cone);
    cmd.dYaw *= slow; cmd.dPitch *= slow;
    // 2) tracking: follow the target's angular motion relative to us (70%)
    const tYaw = Math.atan2(_o.copy(best.t.p).sub(cam.position).x, _o.z), tPitch = Math.asin(Math.max(-1, Math.min(1, _o.normalize().y)));
    const futP = _e.copy(best.t.p).addScaledVector(best.t.v, 0.1).addScaledVector(ownVel || _r.set(0, 0, 0), -0.1).sub(cam.position);
    const fYaw = Math.atan2(futP.x, futP.z), fPitch = Math.asin(Math.max(-1, Math.min(1, futP.normalize().y)));
    const rate = 0.7 / 0.1;
    cmd.dYaw += wrapAngle(fYaw - tYaw) * rate * dt * 0.7; cmd.dPitch += (fPitch - tPitch) * rate * dt * 0.7;
    // 3) ADS snap: when sights come up, pull most of the way onto the target over ~0.15 s
    if (cmd.ads && !this._adsPrev) this._snapT = 0.15;
    this._adsPrev = !!cmd.ads;
    if (this._snapT > 0) { this._snapT -= dt; const k = Math.min(1, dt / 0.15) * 0.8; cmd.dYaw += wrapAngle(tYaw - this.yaw) * k; cmd.dPitch += (tPitch - this.pitch) * k; }
  }

  spreadNow() {
    const w = this.weapon, s = w.spread;
    const base = lerp(s.hip, s.ads, this.ads);
    const crouchMul = lerp(1, 0.75, this.crouch);
    return (base * crouchMul + this.bloom) * (w.spreadMul ?? 1);
  }

  /** Computes the crosshair target point using the camera ray against cars + world. */
  aimAt(cam) {
    const t = this._raycastAll(cam.position, cam.dir, 400, null);
    if (t) { this.aimPoint.copy(t.point); this.aimHit = true; this.aimCar = t.car || null; } else { this.aimPoint.copy(cam.position).addScaledVector(cam.dir, 300); this.aimHit = false; this.aimCar = null; }
    return this.aimPoint;
  }

  _raycastAll(o, d, maxDist, ignore) {
    let best = null;
    const wh = this.ctx.raycastWorld ? this.ctx.raycastWorld(o, d, maxDist) : null;
    if (wh) best = { t: wh.t, point: new THREE.Vector3().copy(o).addScaledVector(d, wh.t), normal: wh.normal, kind: wh.kind || 'dirt', world: true };
    for (const car of this.ctx.targets()) {
      if (car.exploded && car.wreckOnly) continue;
      const h = car.raycast(o, d, best ? best.t : maxDist, ignore);
      if (h && (!best || h.t < best.t)) best = { t: h.t, point: h.point, zone: h.zone, car, through: h.throughBody, world: false };
    }
    return best;
  }

  fire(cam, extra = {}) {
    const w = this.weapon, ctx = this.ctx;
    const own = ctx.ownCar();
    this.aimAt(cam);
    const M = this.muzzle; // set by the character view each frame (world position of the gun muzzle)
    if (!M.lengthSq()) M.copy(cam.position).addScaledVector(cam.dir, 1.0);
    this.mag[this.cur]--; this.shots++;
    const D = this.dbg || (this.dbg = { shots: 0, aimOnCar: 0, rayHit: 0, rayWorld: 0, rayMiss: 0, muzzleDist: 0 }); D.shots++; if (this.aimCar) D.aimOnCar++; D.muzzleDist += M.distanceTo(cam.position);
    this.fireT = 60 / (w.rpm * (w.rate ? 1 : 1));
    if (w.mode === 'pump') this.pumpT = w.pumpTime; if (w.mode === 'bolt') this.boltT = w.boltTime;
    this.recoilAnim = 1;
    const spread = this.spreadNow() * D2R;
    const dirs = [];
    if (w.mode === 'launcher') {
      _d.copy(this.aimPoint).sub(M).normalize();
      ctx.fireRocket && ctx.fireRocket(M.clone(), _d.clone(), w);
      ctx.emit({ t: 'shot', src: 'player', weapon: w.id, origin: M.toArray(), dir: _d.toArray(), rocket: true });
    } else {
      const shotEvents = [];
      const ignore = null; // (our own truck is never in the target list)
      for (let p = 0; p < w.pellets; p++) {
        // direction from the muzzle toward the crosshair point, perturbed within the cone
        _d.copy(this.aimPoint).sub(M);
        if (_d.lengthSq() < 4) _d.copy(cam.dir); _d.normalize();
        const ang = Math.sqrt(Math.random()) * spread, rot = Math.random() * Math.PI * 2;
        _u.set(0, 1, 0); if (Math.abs(_d.y) > 0.95) _u.set(1, 0, 0);
        _r.crossVectors(_d, _u).normalize(); _u.crossVectors(_r, _d).normalize();
        _e.copy(_d).addScaledVector(_r, Math.tan(ang) * Math.cos(rot)).addScaledVector(_u, Math.tan(ang) * Math.sin(rot)).normalize();
        this._shootRay(M, _e, w, shotEvents, ignore, own);
      }
      ctx.emit({ t: 'shot', src: 'player', weapon: w.id, origin: M.toArray(), rays: shotEvents, mode: w.mode });
    }
    // recoil: camera kick + crosshair bloom
    const rm = w.recoilMul ?? 1;
    const kick = w.recoil.pitch * D2R * rm * lerp(1, 0.7, this.ads) * lerp(1, 0.8, this.crouch);
    this.pitch += kick * 0.45;                   // sticks in the aim (must be pulled down)
    this.yaw += (Math.random() - 0.5) * 2 * w.recoil.yaw * D2R * rm;
    ctx.kick && ctx.kick(kick * 0.9, (Math.random() - 0.5) * w.recoil.yaw * D2R * rm, w.recoil.kick * rm);
    this.bloom = Math.min(w.spread.bloomMax, this.bloom + w.spread.bloom);
    if (this.mag[this.cur] <= 0 && w.mode !== 'pump') this.startReload();
    if (w.mode === 'pump' && this.mag[this.cur] <= 0) this.startReload();
  }

  _shootRay(o, dir, w, out, ignore, own) {
    const ctx = this.ctx;
    let remaining = w.range, origin = _o.copy(o), pierce = w.pierce || 0, last = null;
    const ro = origin.clone(); const dr = dir.clone();
    const rays = [];
    for (let pass = 0; pass <= pierce; pass++) {
      // exclude our own truck's bodywork (we stand inside it): ghost/own car raycast skips own id
      const hit = this._raycastAll(ro, dr, remaining, ignore);
      if (!hit) { if (pass === 0 && this.dbg) this.dbg.rayMiss++; rays.push({ end: ro.clone().addScaledVector(dr, remaining).toArray() }); break; }
      if (pass === 0 && this.dbg) { if (hit.world) this.dbg.rayWorld++; else this.dbg.rayHit++; }
      const end = hit.point;
      const dist = ro.distanceTo(end) + (o.distanceTo(ro));
      const [f0, f1, fm] = w.falloff;
      const fall = dist <= f0 ? 1 : dist >= f1 ? fm : lerp(1, fm, (dist - f0) / (f1 - f0));
      if (hit.world) {
        rays.push({ end: end.toArray(), surface: hit.kind, normal: hit.normal ? [hit.normal.x, hit.normal.y, hit.normal.z] : [0, 1, 0] });
        break;
      }
      const zone = hit.zone;
      const dmg = w.dmg * fall * (pass > 0 ? 0.6 : 1);
      rays.push({ end: end.toArray(), carId: hit.car.id, zone: zone.kind, zoneIndex: zone.index ?? -1, through: !!hit.through, surface: zone.kind === 'tire' ? 'tire' : /driver|gunner/.test(zone.kind) ? 'flesh' : 'metal', dmg });
      ctx.report({ carId: hit.car.id, zone: zone.kind, zoneIndex: zone.index ?? -1, dmg, through: !!hit.through, point: end.toArray(), dir: dr.toArray(), weapon: w.id, tireMul: w.tireMul || 1, head: /_head$/.test(zone.kind) });
      this.hitMarker = 0.14; ctx.hitMarker && ctx.hitMarker(/_head$/.test(zone.kind));
      if (pass < pierce) { ro.copy(end).addScaledVector(dr, 0.25); remaining -= ro.distanceTo(o); if (remaining < 2) break; } else break;
    }
    for (const r of rays) out.push(r);
  }

  throwGrenade(cam, carVel) {
    this.grenades--; this.grenadeCd = GRENADE.cooldown * (1 - 0.06 * this.grenadeLv); this.throwing = 0.62;
    const aim = this.aimAt(cam);
    const M = this.muzzle.lengthSq() ? this.muzzle : cam.position;
    const to = _d.copy(aim).sub(M); const dist = to.length(); to.normalize();
    const speed = clamp(GRENADE.speed * (0.6 + dist / 120), 14, 34);
    // lob slightly upward so it arcs toward the aim point
    const v = to.clone().multiplyScalar(speed); v.y += Math.min(9, dist * 0.09);
    if (carVel) v.add(carVel);
    this.ctx.emit({ t: 'grenadeThrow', origin: M.toArray(), vel: v.toArray() });
    this.ctx.throwGrenade && this.ctx.throwGrenade(M.clone(), v, { dmg: GRENADE.dmg * (1 + 0.15 * this.grenadeLv), blast: GRENADE.blast * (1 + 0.06 * this.grenadeLv), fuse: GRENADE.fuse });
  }
}
