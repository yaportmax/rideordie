// Car entity (player truck or raider): vehicle physics body + crew + hit zones + damage state.
import * as THREE from 'three';

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _c3 = [0, 0, 0];
export const GUNNER_ROLES = Object.freeze(['gunner', 'gunner2', 'gunner3', 'gunner4']);

/** Hit zones in the model frame (ground under COM at rest as origin; +Z forward, +X left). */
export function buildZones(spec) {
  const z = [];
  const s = spec.seats;
  if (s.driver) {
    const d = s.driver;
    z.push({ kind: 'driver_head', shape: 'sphere', c: [d[0], d[1] + 0.68, d[2]], r: 0.2 });
    z.push({ kind: 'driver', shape: 'box', c: [d[0], d[1] + 0.3, d[2]], h: [0.3, 0.32, 0.3] });
  }
  for (const key of GUNNER_ROLES) {
    const g = s[key]; if (!g) continue;
    z.push({ kind: key + '_head', role: key, shape: 'sphere', c: [g[0], g[1] + 1.62, g[2]], r: 0.2, standing: true });
    z.push({ kind: key, role: key, shape: 'box', c: [g[0], g[1] + 1.0, g[2]], h: [0.33, 0.55, 0.26], standing: true });
    z.push({ kind: key + '_legs', role: key, shape: 'box', c: [g[0], g[1] + 0.35, g[2]], h: [0.3, 0.35, 0.22], lowerBody: true });
  }
  const L = spec.length, W = spec.width;
  // New chassis can place their engine behind the seats. Use authored model-
  // frame bounds in both simulation and client ghosts rather than treating
  // every vehicle as a front-engine pickup. Keep zone arrays instance-owned.
  const engineZone = spec.hitZones?.engine;
  z.push({ kind: 'engine', shape: 'box',
    c: engineZone ? [...engineZone.c] : [0, 0.95, L / 2 - 0.85],
    h: engineZone ? [...engineZone.h] : [W * 0.36, 0.28, 0.78] });
  // The heavy GLB is asymmetric around its origin. Rear-mounted weak-point
  // art uses its actual rear face, not -length/2. Both Car and GhostCar build
  // these zones from the same static metadata, so co-op aim/hits agree.
  const fuel = spec.id === 'e_heavy' && spec.model?.bbox
    ? [0, 1.0, spec.model.bbox.min[2] + 0.3]
    : [0, 0.62, -L / 2 + 0.55];
  const fuelZone = spec.hitZones?.fuel;
  z.push({ kind: 'fuel', shape: 'box', c: fuelZone ? [...fuelZone.c] : fuel,
    h: fuelZone ? [...fuelZone.h] : [W * 0.34, 0.24, 0.5] });
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
    const ng = Math.min(4, spec.gunners ?? (spec.seats.gunner ? 1 : 0));
    for (let i = 0; i < ng; i++) {
      const role = GUNNER_ROLES[i]; if (!spec.seats[role]) continue;
      this.crew[role] = { hp: spec.gunnerHp ?? 50, max: spec.gunnerHp ?? 50, alive: true, armor: spec.gunnerArmors?.[role] ?? (i === 0 ? spec.gunnerArmor ?? 0 : 0),
        aimYaw: 0, aimPitch: 0, fire: false, crouch: false, ads: false, reloading: false, ragdolled: false };
    }
    this.zones = buildZones(spec);
    // Static zone bounds are built once. Dynamic crew movement is included below.
    this._zoneRadius = 0;
    for (const zn of this.zones) {
      const extent = zn.shape === 'sphere' ? zn.r : Math.hypot(...zn.h);
      this._zoneRadius = Math.max(this._zoneRadius, Math.hypot(...zn.c) + extent);
    }
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

  /** Conservative world-space radius for rejecting projectile segments, including mobile crew. */
  raycastRadius() {
    let crewOffset = 0;
    for (const role in this.crew) {
      const c = this.crew[role];
      crewOffset = Math.max(crewOffset, Math.hypot(c.x || 0, c.z || 0) + (c.crouch ? 0.55 : 0));
    }
    return this._zoneRadius + Math.abs(this.veh.restComHeight) + crewOffset + 1e-6;
  }

  /** Alive crew count (for AI/scoring). */
  crewAlive() { let n = 0; for (const role in this.crew) if (this.crew[role].alive) n++; return n; }
}

export function raySphere(o, d, c, r) {
  const ox = o.x - c[0], oy = o.y - c[1], oz = o.z - c[2];
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (cc < 0 ? 0 : -1);
}
export function rayBox(o, d, c, h) {
  let tmin = 0, tmax = 1e9;
  // Scalars avoid creating two temporary arrays for every box of every shot.
  const ox = o.x - c[0], oy = o.y - c[1], oz = o.z - c[2];
  if (Math.abs(d.x) < 1e-9) { if (Math.abs(ox) > h[0]) return -1; }
  else {
    let t1 = (-h[0] - ox) / d.x, t2 = (h[0] - ox) / d.x;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(d.y) < 1e-9) { if (Math.abs(oy) > h[1]) return -1; }
  else {
    let t1 = (-h[1] - oy) / d.y, t2 = (h[1] - oy) / d.y;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(d.z) < 1e-9) { if (Math.abs(oz) > h[2]) return -1; }
  else {
    let t1 = (-h[2] - oz) / d.z, t2 = (h[2] - oz) / d.z;
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
  let bodyZone = null, partZone = null, bodyT = Infinity, partT = Infinity;
  for (const zn of carLike.zones) {
    const cr = zn.role ? carLike.crew[zn.role] : null;
    if (zn.role && (!cr || !cr.alive)) continue;
    if (zn.role && ignoreRoles && ignoreRoles.has(zn.role)) continue;
    let c = zn.c;
    if (cr && (cr.crouch || cr.x || cr.z)) { // the gunner moves about / ducks: shift the zone
      _c3[0] = zn.c[0] + (cr.x || 0); _c3[1] = zn.c[1] - (cr.crouch && !zn.lowerBody ? (zn.shape === 'sphere' ? 0.55 : 0.42) : 0); _c3[2] = zn.c[2] + (cr.z || 0); c = _c3;
    }
    const t = zn.shape === 'sphere' ? raySphere(_p, _d, c, zn.r) : rayBox(_p, _d, c, zn.h);
    if (t < 0 || t > maxDist) continue;
    if (zn.kind === 'body') { if (!bodyZone || t < bodyT) { bodyT = t; bodyZone = zn; } }
    else if (!partZone || t < partT) { partT = t; partZone = zn; }
  }
  // crew / engine / tyres inside the hull volume are reachable through the open windows and bed: prefer them when they lie
  // within a few metres behind the first bodywork entry; mark whether the shot crossed bodywork (armour applies)
  let zone, t, throughBody;
  if (partZone && (!bodyZone || partT <= bodyT + 3.2)) { zone = partZone; t = partT; throughBody = !!bodyZone && bodyT < partT - 0.05; }
  else if (bodyZone) { zone = bodyZone; t = bodyT; throughBody = false; }
  else return null;
  // Only the returned hit owns objects; superseded candidates stay as scalar scratch.
  return { t, zone, throughBody, point: new THREE.Vector3().copy(origin).addScaledVector(dir, t), car: carLike };
}

/** Client-side stand-in for a Car: built from a CarState so the gunner can raycast the cars it sees. */
export class GhostCar {
  constructor(st) {
    this.id = st.id; this.spec = st.spec; this.kind = st.kind; this.zones = buildZones(st.spec);
    this.crew = { driver: { alive: true } };
    const count = Math.min(4, st.spec.gunners ?? (st.spec.seats.gunner ? 1 : 0));
    for (let i = 0; i < count; i++) {
      const role = GUNNER_ROLES[i];
      if (st.spec.seats[role]) this.crew[role] = { alive: true, crouch: false, x: 0, z: 0 };
    }
    this.veh = { pos: st.pos, quat: st.quat, restComHeight: st.ride.restComHeight, vel: st.vel, poseRevision: st.poseRevision || 0 };
    this.exploded = false; this.st = st;
  }
  sync(st) {
    this.st = st; this.veh.pos = st.pos; this.veh.quat = st.quat; this.veh.vel = st.vel; this.veh.poseRevision = st.poseRevision || 0; this.exploded = st.exploded;
    this.crew.driver.alive = st.driverAlive;
    for (const role of GUNNER_ROLES) if (this.crew[role]) {
      const source = st[role], target = this.crew[role];
      target.alive = !!st[role + 'Alive']; target.crouch = !!source?.crouch;
      target.x = source?.x || 0; target.z = source?.z || 0;
    }
  }
  raycast(o, d, max, ignore) { return raycastZones(this, o, d, max, ignore); }
}
