// Car entity (player truck or raider): vehicle physics body + crew + hit zones + damage state.
import * as THREE from 'three';
import { clamp } from '../core/util.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _c3 = [0, 0, 0];

/** Hit zones in the model frame (ground under COM at rest as origin; +Z forward, +X left). */
export function buildZones(spec) {
  const z = [];
  const s = spec.seats;
  if (s.driver) {
    const d = s.driver;
    z.push({ kind: 'driver_head', shape: 'sphere', c: [d[0], d[1] + 0.68, d[2]], r: 0.2 });
    z.push({ kind: 'driver', shape: 'box', c: [d[0], d[1] + 0.3, d[2]], h: [0.3, 0.32, 0.3] });
  }
  for (const key of ['gunner', 'gunner2']) {
    const g = s[key]; if (!g) continue;
    z.push({ kind: key + '_head', role: key, shape: 'sphere', c: [g[0], g[1] + 1.62, g[2]], r: 0.2, standing: true });
    z.push({ kind: key, role: key, shape: 'box', c: [g[0], g[1] + 1.0, g[2]], h: [0.33, 0.55, 0.26], standing: true });
    z.push({ kind: key + '_legs', role: key, shape: 'box', c: [g[0], g[1] + 0.35, g[2]], h: [0.3, 0.35, 0.22], lowerBody: true });
  }
  const L = spec.length, W = spec.width;
  z.push({ kind: 'engine', shape: 'box', c: [0, 0.95, L / 2 - 0.85], h: [W * 0.36, 0.28, 0.78] });
  z.push({ kind: 'fuel', shape: 'box', c: [0, 0.62, -L / 2 + 0.55], h: [W * 0.34, 0.24, 0.5] });
  spec.wheels.forEach((w, i) => z.push({ kind: 'tire', index: i, shape: 'sphere', c: [w.x, spec.wheelRadius, w.z], r: spec.wheelRadius * 0.95 }));
  for (const b of spec.colliders) z.push({ kind: 'body', shape: 'box', c: b.center, h: b.half });
  return z;
}

export class Car {
  constructor(sim, id, spec, veh, kind) {
    this.sim = sim; this.id = id; this.spec = spec; this.veh = veh; this.kind = kind; // 'player' | 'enemy'
    this.team = kind === 'player' ? 0 : 1;
    this.maxHp = spec.hp ?? 200; this.hp = this.maxHp;
    this.armor = spec.armor ?? 0;            // fraction of bullet damage absorbed by bodywork
    this.crew = {
      driver: { hp: spec.driverHp ?? 50, max: spec.driverHp ?? 50, alive: true, armor: spec.driverArmor ?? 0 },
    };
    const ng = spec.gunners ?? (spec.seats.gunner ? 1 : 0);
    if (ng >= 1) this.crew.gunner = { hp: spec.gunnerHp ?? 50, max: spec.gunnerHp ?? 50, alive: true, armor: spec.gunnerArmor ?? 0, aimYaw: 0, aimPitch: 0, fire: false, crouch: false, ragdolled: false };
    if (ng >= 2) this.crew.gunner2 = { hp: spec.gunnerHp ?? 50, max: spec.gunnerHp ?? 50, alive: true, armor: 0, aimYaw: 0, aimPitch: 0, fire: false, crouch: false };
    this.zones = buildZones(spec);
    this.tireHp = spec.wheels.map(() => 3); this.engineHp = 100; this.fuelHp = 60;
    this.dead = false; this.exploded = false; this.burning = 0; this.smoking = false; this.fuseT = -1;
    this.s = 0; this.d = 0; // road coordinates
    this.age = 0; this.lastHitBy = -1; this.lastHitT = -99; this.tag = null;
    this.driverless = false;
    this.hitFlash = 0;
    this.ai = null;
    this.resist = 1;
    this.crashCooldown = 0;
    this.visual = {}; // per-car view scratch
  }

  get pos() { return this.veh.pos; }
  get quat() { return this.veh.quat; }

  /** Ray (world) vs this car's zones. Returns {t, zone, point, car, throughBody} or null. */
  raycast(origin, dir, maxDist, ignoreRoles) { return raycastZones(this, origin, dir, maxDist, ignoreRoles); }

  /** Alive crew count (for AI/scoring). */
  crewAlive() { return Object.values(this.crew).filter((c) => c.alive).length; }
}

function raySphere(o, d, c, r) {
  const ox = o.x - c[0], oy = o.y - c[1], oz = o.z - c[2];
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (cc < 0 ? 0 : -1);
}
function rayBox(o, d, c, h) {
  let tmin = 0, tmax = 1e9;
  const oo = [o.x - c[0], o.y - c[1], o.z - c[2]], dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) { if (Math.abs(oo[i]) > h[i]) return -1; continue; }
    let t1 = (-h[i] - oo[i]) / dd[i], t2 = (h[i] - oo[i]) / dd[i];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Shared by Car (sim) and GhostCar (client view): carLike = {zones, crew, veh:{pos,quat,restComHeight}}. */
export function raycastZones(carLike, origin, dir, maxDist, ignoreRoles) {
  const v = carLike.veh;
  _q.copy(v.quat).invert();
  _p.copy(origin).sub(v.pos).applyQuaternion(_q); _p.y += v.restComHeight;
  _d.copy(dir).applyQuaternion(_q);
  let bestBody = null, bestPart = null;
  for (const zn of carLike.zones) {
    const cr = zn.role ? carLike.crew[zn.role] : null;
    if (cr && !cr.alive) continue;
    if (zn.role && ignoreRoles && ignoreRoles.has(zn.role)) continue;
    let c = zn.c;
    if (cr && (cr.crouch || cr.x || cr.z)) { // the gunner moves about / ducks: shift the zone
      _c3[0] = zn.c[0] + (cr.x || 0); _c3[1] = zn.c[1] - (cr.crouch && !zn.lowerBody ? (zn.shape === 'sphere' ? 0.55 : 0.42) : 0); _c3[2] = zn.c[2] + (cr.z || 0); c = _c3;
    }
    const t = zn.shape === 'sphere' ? raySphere(_p, _d, c, zn.r) : rayBox(_p, _d, c, zn.h);
    if (t < 0 || t > maxDist) continue;
    if (zn.kind === 'body') { if (!bestBody || t < bestBody.t) bestBody = { t, zone: zn }; }
    else if (!bestPart || t < bestPart.t) bestPart = { t, zone: zn };
  }
  // crew / engine / tyres inside the hull volume are reachable through the open windows and bed: prefer them when they lie
  // within a few metres behind the first bodywork entry; mark whether the shot crossed bodywork (armour applies)
  let best = null;
  if (bestPart && (!bestBody || bestPart.t <= bestBody.t + 3.2)) { best = bestPart; best.throughBody = !!bestBody && bestBody.t < bestPart.t - 0.05; }
  else if (bestBody) { best = bestBody; best.throughBody = false; }
  if (best) { best.point = new THREE.Vector3().copy(origin).addScaledVector(dir, best.t); best.car = carLike; }
  return best;
}

/** Client-side stand-in for a Car: built from a CarState so the gunner can raycast the cars it sees. */
export class GhostCar {
  constructor(st) {
    this.id = st.id; this.spec = st.spec; this.kind = st.kind; this.zones = buildZones(st.spec);
    this.crew = { driver: { alive: true } }; if (st.spec.seats.gunner) this.crew.gunner = { alive: true, crouch: false, x: 0, z: 0 }; if (st.spec.seats.gunner2) this.crew.gunner2 = { alive: true };
    this.veh = { pos: st.pos, quat: st.quat, restComHeight: st.ride.restComHeight, vel: st.vel };
    this.exploded = false; this.st = st;
  }
  sync(st) {
    this.st = st; this.veh.pos = st.pos; this.veh.quat = st.quat; this.veh.vel = st.vel; this.exploded = st.exploded;
    this.crew.driver.alive = st.driverAlive;
    if (this.crew.gunner) { this.crew.gunner.alive = st.gunnerAlive; this.crew.gunner.crouch = st.gunner.crouch; this.crew.gunner.x = st.gunner.x; this.crew.gunner.z = st.gunner.z; }
    if (this.crew.gunner2) this.crew.gunner2.alive = st.gunner2Alive;
  }
  raycast(o, d, max, ignore) { return raycastZones(this, o, d, max, ignore); }
}
