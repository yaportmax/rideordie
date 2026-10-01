// Binary snapshot protocol (sim peer -> viewer peer, unreliable channel, ~30 Hz) + client-side interpolation buffer.
import * as THREE from 'three';
import { SPEC_IDS, makeCarState } from '../view/car_state.js';
import { PART_NAMES, BOSS_PARTS } from '../data/boss.js';

const QN = 32767;
const GUNS = ['pistol', 'smg', 'rifle', 'shotgun', 'mg', 'hmg', 'rpg'];
const INTENTS = [null, 'shoot', 'ram', 'block'];
const F = { dead: 1, exploded: 2, burning: 4, smoking: 8, driverAlive: 16, gunnerAlive: 32, gunner2Alive: 64, braking: 128, boosting: 256, drifting: 512, airborne: 1024, flatAny: 2048 };
const clamp16 = (v) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0);

/** Encode the current sim state. hud: {hp01,dhp01,ghp01,nitro01,cash,kills,streak,level,bossHp01,bossId,medkits,state,time,dist} */
export function encodeSnapshot(sim, tick, hud, buf) {
  const cars = [...sim.cars.values()];
  let size = 64;
  for (const c of cars) size += 62 + c.veh.wheels.length * 2;
  const p = sim.projectiles;
  const nProj = p.rockets.length + p.grenades.length;
  size += 2 + nProj * 14 + 40 + PART_NAMES.length;
  const ab = buf && buf.byteLength >= size ? buf : new ArrayBuffer(size + 256);
  const dv = new DataView(ab);
  let o = 0;
  dv.setUint8(o, 1); o += 1;
  dv.setUint32(o, tick, true); o += 4;
  dv.setFloat32(o, sim.time, true); o += 4;
  dv.setFloat32(o, hud.dist || 0, true); o += 4;
  dv.setUint8(o, ({ countdown: 0, run: 1, dying: 2, over: 3 })[sim.state] ?? 1); o += 1;
  dv.setUint8(o, Math.round(clamp01(hud.hp01) * 255)); o += 1;
  dv.setUint8(o, Math.round(clamp01(hud.dhp01) * 255)); o += 1;
  dv.setUint8(o, Math.round(clamp01(hud.ghp01) * 255)); o += 1;
  dv.setUint8(o, Math.round(clamp01(hud.nitro01) * 255)); o += 1;
  dv.setUint32(o, Math.max(0, hud.cash | 0), true); o += 4;
  dv.setUint16(o, hud.kills | 0, true); o += 2;
  dv.setUint8(o, Math.min(255, hud.streak | 0)); o += 1;
  dv.setFloat32(o, hud.level || 0, true); o += 4;
  dv.setUint8(o, Math.round(clamp01(hud.bossHp01 ?? 0) * 255)); o += 1;
  dv.setUint16(o, hud.bossId | 0, true); o += 2;
  dv.setUint8(o, hud.medkits | 0); o += 1;
  dv.setUint8(o, cars.length); o += 1;
  for (const c of cars) {
    const v = c.veh, q = v.quat;
    dv.setUint16(o, c.id, true); o += 2;
    dv.setUint8(o, SPEC_IDS.indexOf(c.spec.id)); o += 1;
    dv.setUint8(o, c.kind === 'player' ? 0 : 1); o += 1;
    let fl = 0;
    if (c.dead) fl |= F.dead; if (c.exploded) fl |= F.exploded; if (c.burning > 0) fl |= F.burning; if (c.smoking) fl |= F.smoking;
    if (c.crew.driver.alive) fl |= F.driverAlive; if (c.crew.gunner?.alive) fl |= F.gunnerAlive; if (c.crew.gunner2?.alive) fl |= F.gunner2Alive;
    if (v.brakeApplied > 0.1) fl |= F.braking; if (v.boosting) fl |= F.boosting; if (v.drifting) fl |= F.drifting; if (v.grounded === 0 && v.airTime > 0.12) fl |= F.airborne;
    if (v.wheels.some((w) => w.flat)) fl |= F.flatAny;
    dv.setUint16(o, fl, true); o += 2;
    dv.setFloat32(o, v.pos.x, true); dv.setFloat32(o + 4, v.pos.y, true); dv.setFloat32(o + 8, v.pos.z, true); o += 12;
    dv.setInt16(o, clamp16(q.x * QN), true); dv.setInt16(o + 2, clamp16(q.y * QN), true); dv.setInt16(o + 4, clamp16(q.z * QN), true); dv.setInt16(o + 6, clamp16(q.w * QN), true); o += 8;
    dv.setInt16(o, clamp16(v.vel.x * 64), true); dv.setInt16(o + 2, clamp16(v.vel.y * 64), true); dv.setInt16(o + 4, clamp16(v.vel.z * 64), true); o += 6;
    dv.setInt16(o, clamp16(v.angvel.x * 400), true); dv.setInt16(o + 2, clamp16(v.angvel.y * 400), true); dv.setInt16(o + 4, clamp16(v.angvel.z * 400), true); o += 6;
    dv.setInt8(o, Math.round(v.steerAngle * 100)); o += 1;
    dv.setUint8(o, Math.round(clamp01(c.hp / c.maxHp) * 255)); o += 1;
    dv.setUint8(o, Math.round(clamp01(v.rpm01) * 255)); o += 1;
    dv.setUint8(o, Math.round(clamp01(c.engineHp / 100) * 255)); o += 1;
    const g = c.crew.gunner, g2 = c.crew.gunner2;
    dv.setInt16(o, clamp16((g ? g.aimYaw : 0) * 5000), true); dv.setInt16(o + 2, clamp16((g ? g.aimPitch : 0) * 10000), true); o += 4;
    dv.setUint8(o, g ? ((g.fire ? 1 : 0) | (g.crouch ? 2 : 0) | (g.ads ? 4 : 0) | (g.reloading ? 8 : 0) | ((g.weapon || 0) << 4)) : 0); o += 1;
    dv.setInt8(o, Math.round((g?.x || 0) * 100)); dv.setInt8(o + 1, Math.round((g?.z || 0) * 100)); o += 2;
    dv.setInt16(o, clamp16((g2 ? g2.aimYaw : 0) * 5000), true); dv.setInt16(o + 2, clamp16((g2 ? g2.aimPitch : 0) * 10000), true); o += 4;
    dv.setUint8(o, g2 ? (g2.fire ? 1 : 0) : 0); o += 1;
    // tag byte: bits 0-2 enemy gun, bits 3-5 miniboss index + 1, bits 6-7 raider intent (none/shoot/ram/block)
    dv.setUint8(o, (GUNS.indexOf(c.gunName || '') + 1) | ((c.elite ? c.elite.index + 1 : 0) << 3) | ((INTENTS.indexOf(c.ai?.intent ?? null) & 3) << 6)); o += 1;
    dv.setUint8(o, v.wheels.length); o += 1;
    for (const w of v.wheels) { dv.setUint8(o, Math.round(clamp01((w.L - 0.1) / 0.6) * 255)); dv.setUint8(o + 1, Math.round(clamp01(w.slip) * 127) | (w.grounded ? 128 : 0) | 0); o += 2; }
  }
  dv.setUint16(o, nProj, true); o += 2;
  for (const r of p.rockets) { dv.setUint8(o, 1); dv.setFloat32(o + 1, r.x, true); dv.setFloat32(o + 5, r.y, true); dv.setFloat32(o + 9, r.z, true); dv.setUint8(o + 13, 0); o += 14; }
  for (const g of p.grenades) { const t = g.body.translation(); dv.setUint8(o, 2); dv.setFloat32(o + 1, t.x, true); dv.setFloat32(o + 5, t.y, true); dv.setFloat32(o + 9, t.z, true); dv.setUint8(o + 13, 0); o += 14; }
  const B = sim.boss;
  dv.setUint8(o, B ? 1 : 0); o += 1;
  if (B) {
    dv.setFloat32(o, B.pos.x, true); dv.setFloat32(o + 4, B.pos.y, true); dv.setFloat32(o + 8, B.pos.z, true); o += 12;
    const q = B.quat; dv.setInt16(o, clamp16(q.x * QN), true); dv.setInt16(o + 2, clamp16(q.y * QN), true); dv.setInt16(o + 4, clamp16(q.z * QN), true); dv.setInt16(o + 6, clamp16(q.w * QN), true); o += 8;
    dv.setFloat32(o, B.v, true); o += 4;
    let mask = 0; PART_NAMES.forEach((n, i) => { if (B.alive[n]) mask |= (1 << i); }); dv.setUint32(o, mask >>> 0, true); o += 4;
    dv.setUint8(o, B.phase | (B.dead ? 8 : 0) | (B.exploded ? 16 : 0)); o += 1;
    for (const n of PART_NAMES) { dv.setUint8(o, Math.round(clamp01(B.hp[n] / BOSS_PARTS[n].hp) * 255)); o += 1; }   // per-part health (HUD bars)
  }
  return ab.slice(0, o);
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function decodeSnapshot(ab) {
  const dv = ab instanceof ArrayBuffer ? new DataView(ab) : ArrayBuffer.isView(ab) ? new DataView(ab.buffer, ab.byteOffset, ab.byteLength) : null;
  if (!dv || dv.byteLength < 37) return null;
  try { return readSnapshot(dv); } catch (e) { if (e instanceof RangeError) return null; throw e; }
}

function readSnapshot(dv) {
  let o = 0;
  if (dv.getUint8(o) !== 1) return null; o += 1;
  const s = { cars: [], proj: [] };
  s.tick = dv.getUint32(o, true); o += 4; s.time = dv.getFloat32(o, true); o += 4; s.dist = dv.getFloat32(o, true); o += 4;
  s.state = ['countdown', 'run', 'dying', 'over'][dv.getUint8(o)]; o += 1;
  if (!s.state || !Number.isFinite(s.time) || !Number.isFinite(s.dist)) return null;
  s.hp01 = dv.getUint8(o) / 255; s.dhp01 = dv.getUint8(o + 1) / 255; s.ghp01 = dv.getUint8(o + 2) / 255; s.nitro01 = dv.getUint8(o + 3) / 255; o += 4;
  s.cash = dv.getUint32(o, true); o += 4; s.kills = dv.getUint16(o, true); o += 2; s.streak = dv.getUint8(o); o += 1;
  s.level = dv.getFloat32(o, true); o += 4; s.bossHp01 = dv.getUint8(o) / 255; o += 1; s.bossId = dv.getUint16(o, true); o += 2; s.medkits = dv.getUint8(o); o += 1;
  const n = dv.getUint8(o); o += 1;
  for (let i = 0; i < n; i++) {
    const c = {};
    c.id = dv.getUint16(o, true); o += 2; c.spec = SPEC_IDS[dv.getUint8(o)]; c.kind = dv.getUint8(o + 1) === 0 ? 'player' : 'enemy'; o += 2;
    if (!c.spec) return null;
    c.fl = dv.getUint16(o, true); o += 2;
    c.x = dv.getFloat32(o, true); c.y = dv.getFloat32(o + 4, true); c.z = dv.getFloat32(o + 8, true); o += 12;
    if (![c.x, c.y, c.z].every(Number.isFinite)) return null;
    c.qx = dv.getInt16(o, true) / QN; c.qy = dv.getInt16(o + 2, true) / QN; c.qz = dv.getInt16(o + 4, true) / QN; c.qw = dv.getInt16(o + 6, true) / QN; o += 8;
    c.vx = dv.getInt16(o, true) / 64; c.vy = dv.getInt16(o + 2, true) / 64; c.vz = dv.getInt16(o + 4, true) / 64; o += 6;
    c.wx = dv.getInt16(o, true) / 400; c.wy = dv.getInt16(o + 2, true) / 400; c.wz = dv.getInt16(o + 4, true) / 400; o += 6;
    c.steer = dv.getInt8(o) / 100; o += 1; c.hp01 = dv.getUint8(o) / 255; c.rpm01 = dv.getUint8(o + 1) / 255; c.eng01 = dv.getUint8(o + 2) / 255; o += 3;
    c.gyaw = dv.getInt16(o, true) / 5000; c.gpitch = dv.getInt16(o + 2, true) / 10000; o += 4;
    const gf = dv.getUint8(o); o += 1; c.gfire = !!(gf & 1); c.gcrouch = !!(gf & 2); c.gads = !!(gf & 4); c.greload = !!(gf & 8); c.gweapon = gf >> 4;
    c.gx = dv.getInt8(o) / 100; c.gz = dv.getInt8(o + 1) / 100; o += 2;
    c.g2yaw = dv.getInt16(o, true) / 5000; c.g2pitch = dv.getInt16(o + 2, true) / 10000; o += 4; c.g2fire = !!dv.getUint8(o); o += 1;
    { const tb = dv.getUint8(o); c.tagIdx = tb & 7; c.elite = (tb >> 3) & 7; c.intent = INTENTS[tb >> 6]; } o += 1;
    const nw = dv.getUint8(o); o += 1;
    if (nw < 1 || nw > 12) return null;
    c.L = new Float32Array(nw); c.slip = new Float32Array(nw); c.gr = new Uint8Array(nw);
    for (let w = 0; w < nw; w++) { c.L[w] = 0.1 + dv.getUint8(o) / 255 * 0.6; const sg = dv.getUint8(o + 1); c.slip[w] = (sg & 127) / 127; c.gr[w] = sg >> 7; o += 2; }
    s.cars.push(c);
  }
  const np = dv.getUint16(o, true); o += 2;
  for (let i = 0; i < np; i++) {
    const p = { k: dv.getUint8(o), x: dv.getFloat32(o + 1, true), y: dv.getFloat32(o + 5, true), z: dv.getFloat32(o + 9, true) }; o += 14;
    if ((p.k !== 1 && p.k !== 2) || ![p.x, p.y, p.z].every(Number.isFinite)) return null;
    s.proj.push(p);
  }
  const hasBoss = dv.getUint8(o++);
  if (hasBoss > 1) return null;
  if (hasBoss) {
    const b = { x: dv.getFloat32(o, true), y: dv.getFloat32(o + 4, true), z: dv.getFloat32(o + 8, true) }; o += 12;
    b.qx = dv.getInt16(o, true) / QN; b.qy = dv.getInt16(o + 2, true) / QN; b.qz = dv.getInt16(o + 4, true) / QN; b.qw = dv.getInt16(o + 6, true) / QN; o += 8;
    b.v = dv.getFloat32(o, true); o += 4; b.mask = dv.getUint32(o, true); o += 4;
    const f = dv.getUint8(o); o += 1; b.phase = f & 7; b.dead = !!(f & 8); b.exploded = !!(f & 16);
    b.hp = new Float32Array(PART_NAMES.length); for (let i = 0; i < PART_NAMES.length && o < dv.byteLength; i++) { b.hp[i] = dv.getUint8(o) / 255; o += 1; }
    if (![b.x, b.y, b.z, b.v].every(Number.isFinite)) return null;
    s.boss = b;
  }
  return o === dv.byteLength ? s : null;
}

/** Client-side buffer: interpolates CarStates ~100 ms behind the newest snapshot. */
export class SnapshotBuffer {
  constructor() { this.snaps = []; this.states = new Map(); this.delay = 0.1; this.clockOffset = null; this.renderTime = null; this.latest = null; this._q1 = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._qE = new THREE.Quaternion(); this.jitter = 0; this.lastArrival = 0; }
  push(snap, now) {
    // The unordered channel can deliver an older frame after a newer one. Never rewind its clock or state.
    if (!snap || !Number.isFinite(now) || !Number.isFinite(snap.time)) return false;
    if (this.latest) { const delta = (snap.tick - this.latest.tick) >>> 0; if (delta === 0 || delta > 0x7fffffff || snap.time < this.latest.time) return false; }
    snap.arrival = now;
    if (this.latest) { const dt = now - this.lastArrival, expect = snap.time - this.latest.time; this.jitter = this.jitter * 0.95 + Math.abs(dt - expect) * 0.05; }
    this.lastArrival = now; this.latest = snap;
    if (this.clockOffset === null) this.clockOffset = now - snap.time; // simTime -> local clock
    else this.clockOffset = (now - snap.time) * 0.1 + this.clockOffset * 0.9; // track slow-motion as well as network clock drift
    this.snaps.push(snap); if (this.snaps.length > 12) this.snaps.shift();
    this.delay = 0.075 + Math.min(0.12, this.jitter * 2.5);
    return true;
  }
  /** Fill states (Map id -> CarState) for local time `now`. Returns the snapshot bracket info. */
  sample(now) {
    const snaps = this.snaps; if (!snaps.length || !Number.isFinite(now)) return null;
    const target = now - this.clockOffset - this.delay;
    // Offset/jitter changes may hold the pose, but never replay an earlier sim
    // time or predict beyond the same 100ms horizon used for vehicle motion.
    // Authoritative packet-return corrections/teleports remain separate.
    const rt = this.renderTime = Math.min(snaps[snaps.length - 1].time + 0.1, Math.max(this.renderTime ?? target, target));
    let a = snaps[0], b = a;
    for (let i = 1; i < snaps.length; i++) { if (snaps[i].time > rt) { b = snaps[i]; break; } a = b = snaps[i]; }
    let t = b.time > a.time ? (rt - a.time) / (b.time - a.time) : 1;
    const dtE = Math.min(0.1, Math.max(0, rt - b.time));
    t = Math.max(0, Math.min(1, t));
    const seen = new Set();
    const bm = new Map(b.cars.map((c) => [c.id, c]));
    for (const ca of (t >= 1 ? b.cars : a.cars)) {
      const cb = bm.get(ca.id) || ca;
      let st = this.states.get(ca.id);
      if (!st || st.specId !== ca.spec) { st = makeCarState(ca.id, ca.spec, ca.kind); this.states.set(ca.id, st); }
      seen.add(ca.id);
      st.pos.set(ca.x + (cb.x - ca.x) * t + cb.vx * dtE, ca.y + (cb.y - ca.y) * t + cb.vy * dtE, ca.z + (cb.z - ca.z) * t + cb.vz * dtE);
      this._q1.set(ca.qx, ca.qy, ca.qz, ca.qw).normalize(); this._q2.set(cb.qx, cb.qy, cb.qz, cb.qw).normalize();
      st.quat.slerpQuaternions(this._q1, this._q2, t);
      if (dtE > 0) {
        const omega = Math.hypot(cb.wx, cb.wy, cb.wz);
        if (omega > 0) {
          const halfAngle = omega * dtE * 0.5, k = Math.sin(halfAngle) / omega;
          this._qE.set(cb.wx * k, cb.wy * k, cb.wz * k, Math.cos(halfAngle));
          st.quat.premultiply(this._qE).normalize(); // Rapier angular velocity is world-space.
        }
      }
      st.vel.set(ca.vx + (cb.vx - ca.vx) * t, ca.vy + (cb.vy - ca.vy) * t, ca.vz + (cb.vz - ca.vz) * t);
      st.steer = ca.steer + (cb.steer - ca.steer) * t;
      for (let w = 0; w < st.nWheels && w < ca.L.length && w < cb.L.length; w++) { st.L[w] = ca.L[w] + (cb.L[w] - ca.L[w]) * t; st.slip[w] = ca.slip[w]; st.grounded[w] = ca.gr[w]; }
      const fl = t > 0.5 ? cb.fl : ca.fl;
      st.dead = !!(fl & F.dead); st.exploded = !!(fl & F.exploded); st.burning = !!(fl & F.burning); st.smoking = !!(fl & F.smoking);
      st.driverAlive = !!(fl & F.driverAlive); st.gunnerAlive = !!(fl & F.gunnerAlive); st.gunner2Alive = !!(fl & F.gunner2Alive);
      st.braking = !!(fl & F.braking); st.boosting = !!(fl & F.boosting); st.drifting = !!(fl & F.drifting); st.airborne = !!(fl & F.airborne);
      st.hp01 = cb.hp01; st.rpm01 = ca.rpm01 + (cb.rpm01 - ca.rpm01) * t; st.engineHp01 = cb.eng01; st.speed = st.vel.length();
      st.gunner.yaw = cb.gyaw; st.gunner.pitch = cb.gpitch; st.gunner.fire = cb.gfire; st.gunner.crouch = cb.gcrouch; st.gunner.ads = cb.gads; st.gunner.reloading = cb.greload; st.gunner.weapon = cb.gweapon; st.gunner.x = cb.gx; st.gunner.z = cb.gz;
      st.gunner2.yaw = cb.g2yaw; st.gunner2.pitch = cb.g2pitch; st.gunner2.fire = cb.g2fire;
      st.gunName = GUNS[cb.tagIdx - 1] || null; st.elite = cb.elite; st.intent = cb.intent;
    }
    for (const id of [...this.states.keys()]) if (!seen.has(id)) this.states.delete(id);
    if (b.boss) {
      const ba = a.boss || b.boss, bb = b.boss;
      const st = this.boss || (this.boss = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), v: 0, alive: {}, phase: 1, dead: false, exploded: false });
      st.pos.set(ba.x + (bb.x - ba.x) * t, ba.y + (bb.y - ba.y) * t, ba.z + (bb.z - ba.z) * t);
      this._q1.set(ba.qx, ba.qy, ba.qz, ba.qw).normalize(); this._q2.set(bb.qx, bb.qy, bb.qz, bb.qw).normalize(); st.quat.slerpQuaternions(this._q1, this._q2, t);
      st.v = bb.v; st.vel.set(0, 0, bb.v).applyQuaternion(st.quat); st.phase = bb.phase; st.dead = bb.dead; st.exploded = bb.exploded;
      st.pos.addScaledVector(st.vel, dtE);
      if (!st.hp) st.hp = {};
      PART_NAMES.forEach((n, i) => { st.alive[n] = !!(bb.mask & (1 << i)); st.hp[n] = bb.hp ? bb.hp[i] : 1; });   // st.hp: 0..1 per part
    } else this.boss = null;
    return { a, b, t, hud: b };
  }
}
