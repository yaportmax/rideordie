// Arcade raycast vehicle on top of a Rapier rigid body.
//  - 4+ suspension rays against the WORLD group, spring/damper + anti-roll
//  - friction-circle tyre model (lateral "grip gain" saturating at mu*N, longitudinal drive/brake)
//  - yaw-rate steering (predictable at any speed), speed-sensitive lock, drift on handbrake
//  - nitro, downforce, drag, air-control levelling, damage-degraded tyres/engine
// The sim never touches the DOM or WebGL, so it can be tuned headlessly (tools/test/vehicle_sim.mjs).
import * as THREE from 'three';
import { RAPIER, GROUPS, RAY_WORLD, GRAVITY } from './physics.js';
import { clamp, clamp01, lerp, smoothstep, damp, wrapAngle } from '../core/util.js';

const V = THREE.Vector3, Q = THREE.Quaternion;
const _v1 = new V(), _v2 = new V(), _v3 = new V(), _v4 = new V(), _v5 = new V(), _f = new V(), _l = new V(), _n = new V();
const _q = new Q(), _up = new V(0, 1, 0);
const _imp = new V(), _pt = new V();

export const DEFAULT_SURFACE = { grip: 1, drag: 0, kind: 'asphalt' };

export class Vehicle {
  /**
   * @param world Rapier world
   * @param spec  see data/vehicles.js
   * @param opts  {x,y,z,yaw,id,userData}
   */
  constructor(world, spec, opts = {}) {
    this.world = world;
    this.spec = spec;
    this.id = opts.id ?? 0;
    const s = spec;
    this.mass = s.mass;

    // ---- geometry: rest ride height so that the visual (ground-origin) model sits on the ground
    const sp = s.susp;
    this.wheelR = s.wheelRadius;
    const perWheelMass = s.mass / s.wheels.length;
    sp.k = sp.k ?? perWheelMass * Math.pow(2 * Math.PI * (sp.freq ?? 2.1), 2);
    sp.c = sp.c ?? 2 * (sp.zeta ?? 0.5) * Math.sqrt(sp.k * perWheelMass);
    const staticComp = (perWheelMass * GRAVITY) / sp.k;
    this.maxLen = sp.maxLen ?? 0.55;
    this.minLen = sp.minLen ?? 0.16;
    this.restLen = this.maxLen - staticComp;
    const mountY = s.mountY ?? 0.22; // suspension top relative to COM
    this.restComHeight = this.restLen + this.wheelR - mountY; // COM height above ground at rest
    this.comY = this.restComHeight;

    // ---- body
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(opts.x ?? 0, (opts.y ?? 0) + this.restComHeight + 0.05, opts.z ?? 0)
      .setLinearDamping(0).setAngularDamping(s.angDamp ?? 0.6).setCcdEnabled(true);
    const yaw = opts.yaw ?? 0;
    desc.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    const inertia = s.inertia ?? [s.mass * 1.1, s.mass * 2.6, s.mass * 0.9];
    desc.setAdditionalMassProperties(s.mass, { x: 0, y: 0, z: 0 }, { x: inertia[0], y: inertia[1], z: inertia[2] }, { x: 0, y: 0, z: 0, w: 1 });
    this.body = world.createRigidBody(desc);
    this.body.userData = { vehicle: this, id: this.id };
    this.colliders = [];
    const clearance = s.clearance ?? 0.52; // hull boxes stay this high above the ground at rest: wheels (raycasts) carry the ground,
    for (const b0 of s.colliders) {         // so the hull never snags on ramp faces / triangle edges when the suspension bottoms out
      const bottom = Math.max(b0.center[1] - b0.half[1], clearance), top = b0.center[1] + b0.half[1];
      if (top - bottom < 0.15) continue;
      const b = { center: [b0.center[0], (bottom + top) / 2, b0.center[2]], half: [b0.half[0], (top - bottom) / 2, b0.half[2]] };
      const r = Math.min(0.12, b.half[0] * 0.3, b.half[1] * 0.45, b.half[2] * 0.3);
      // boxes are described relative to ground at rest: centre [x,yFromGround,z], half [hx,hy,hz]
      const cd = RAPIER.ColliderDesc.roundCuboid(b.half[0] - r, b.half[1] - r, b.half[2] - r, r)
        .setTranslation(b.center[0], b.center[1] - this.restComHeight, b.center[2])
        .setDensity(0).setFriction(s.hullFriction ?? 0.12).setRestitution(s.hullRestitution ?? 0.18)
        .setCollisionGroups(GROUPS.car)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(s.mass * 6);
      const col = world.createCollider(cd, this.body);
      this.colliders.push(col);
    }

    // ---- wheels
    this.wheels = s.wheels.map((w) => ({
      name: w.name, front: !!w.front, drive: w.drive ?? 0, brake: w.brake ?? 0.25, hb: !!w.hb,
      mount: new V(w.x, mountY, w.z),
      L: this.maxLen, Lprev: this.maxLen, grounded: false, steer: 0, spin: 0, spinRate: 0, slip: 0, slipLat: 0, load: 0,
      contact: new V(), normal: new V(0, 1, 0), surface: DEFAULT_SURFACE, grip: 1, flat: false, hp: 1,
      compress: 0, vf: 0, vl: 0,
    }));
    this.axles = []; // pairs for anti-roll: [left,right] with same z
    const byZ = new Map();
    this.wheels.forEach((w, i) => { const k = w.mount.z.toFixed(2); if (!byZ.has(k)) byZ.set(k, []); byZ.get(k).push(i); });
    for (const idx of byZ.values()) if (idx.length === 2) this.axles.push(idx);
    const zs = this.wheels.map((w) => w.mount.z);
    this.wheelbase = Math.max(...zs) - Math.min(...zs) || 2.8;

    // ---- control state
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.steerSmooth = 0;
    this.steerAngle = 0;
    this.nitro = s.nitro?.capacity ?? 0; // meter in seconds of boost
    this.nitroMax = s.nitro?.capacity ?? 0;
    this.boosting = false;
    this.engineDamage = 0; // 0..1, reduces power
    this.stunned = 0; // seconds: no control (driver dead etc.)
    this.driverAlive = true;

    // ---- telemetry
    this.speed = 0; this.vf = 0; this.vl = 0; this.yawRate = 0; this.slipAngle = 0;
    this.grounded = 0; this.airTime = 0; this.rpm01 = 0.2; this.gear = 1; this.drifting = false; this.driftTime = 0;
    this.throttleApplied = 0; this.brakeApplied = 0; this.reversing = false; this.lastLandImpact = 0;
    this.pos = new V(); this.quat = new Q(); this.vel = new V(); this.angvel = new V();
    this.fwd = new V(0, 0, 1); this.up = new V(0, 1, 0); this.left = new V(1, 0, 0);
    // previous pose for render interpolation
    this.prevPos = new V(); this.prevQuat = new Q();
    this.prevL = this.wheels.map(() => this.maxLen);
    this.readState();
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.wasGrounded = 0;
  }

  readState() {
    const b = this.body;
    const t = b.translation(), r = b.rotation(), lv = b.linvel(), av = b.angvel();
    this.pos.set(t.x, t.y, t.z); this.quat.set(r.x, r.y, r.z, r.w);
    this.vel.set(lv.x, lv.y, lv.z); this.angvel.set(av.x, av.y, av.z);
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.left.set(1, 0, 0).applyQuaternion(this.quat);
  }

  /** Call once per fixed step BEFORE world.step(). env: {surfaceAt(x,z)->surface} */
  applyForces(dt, env) {
    const s = this.spec, b = this.body, inp = this.input;
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    for (let i = 0; i < this.wheels.length; i++) this.prevL[i] = this.wheels[i].L;
    this.readState();
    const p = this.pos, q = this.quat, v = this.vel, up = this.up, fwd = this.fwd, left = this.left;

    const speed = v.length();
    const vfBody = v.dot(fwd);
    this.speed = speed; this.vf = vfBody; this.vl = v.dot(left);
    this.yawRate = this.angvel.dot(up);
    this.slipAngle = speed > 3 ? Math.atan2(this.vl, Math.abs(vfBody)) : 0;

    // ---------------- driver input processing
    let throttle = this.stunned > 0 || !this.driverAlive ? 0 : clamp01(inp.throttle);
    let brake = this.stunned > 0 || !this.driverAlive ? 0 : clamp01(inp.brake);
    let steerIn = this.stunned > 0 || !this.driverAlive ? 0 : clamp(inp.steer, -1, 1);
    const handbrake = !!inp.handbrake && this.driverAlive && this.stunned <= 0;
    // "brake" doubles as reverse when nearly stopped
    this.reversing = false;
    if (brake > 0.05 && throttle < 0.05 && vfBody < 1.5) { this.reversing = true; }
    // steering smoothing (keyboard ramps, analogue passes straight through)
    // steering builds a little slower at speed (keyboard taps shouldn't flick a 2-tonne truck at 130 km/h); release stays quick
    const hiSpd = smoothstep(18, 42, Math.abs(this.vf || 0));
    const rate = Math.abs(steerIn) > Math.abs(this.steerSmooth) ? (s.steerRise ?? 10) * lerp(1, 0.55, hiSpd) : (s.steerFall ?? 12) * lerp(1, 1.8, hiSpd);
    this.steerSmooth = damp(this.steerSmooth, steerIn, rate, dt);
    if (Math.abs(this.steerSmooth - steerIn) < 0.002) this.steerSmooth = steerIn;

    // ---------------- surface + grounded state
    let groundedCount = 0;
    const ray = this.ray;
    const R = this.wheelR;
    const downDir = _v1.copy(up).multiplyScalar(-1);
    ray.dir.x = downDir.x; ray.dir.y = downDir.y; ray.dir.z = downDir.z;
    const maxDist = this.maxLen + R;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      _v2.copy(w.mount).applyQuaternion(q).add(p); // mount world
      ray.origin.x = _v2.x; ray.origin.y = _v2.y; ray.origin.z = _v2.z;
      const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, RAY_WORLD);
      w.Lprev = w.L;
      if (hit) {
        const dist = hit.timeOfImpact;
        w.L = clamp(dist - R, this.minLen, this.maxLen);
        w.contact.set(_v2.x + downDir.x * dist, _v2.y + downDir.y * dist, _v2.z + downDir.z * dist);
        w.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        if (w.normal.dot(up) < 0.2) { // hitting a wall/underside: treat as airborne
          w.grounded = false; w.L = this.maxLen; w.load = 0;
        } else {
          w.grounded = true; groundedCount++;
          w.surface = env?.surfaceAt ? env.surfaceAt(w.contact.x, w.contact.z) : DEFAULT_SURFACE;
        }
      } else { w.grounded = false; w.L = this.maxLen; w.load = 0; }
    }
    this.grounded = groundedCount;
    if (groundedCount === 0) this.airTime += dt; else {
      if (this.airTime > 0.25) this.lastLandImpact = Math.max(0, -this.vel.dot(up));
      this.airTime = 0;
    }

    // ---------------- suspension (spring + damper + anti-roll)
    const sp = s.susp;
    const comp = this.wheels.map((w) => this.maxLen - w.L);
    const arbF = new Array(this.wheels.length).fill(0);
    for (const [a, c] of this.axles) {
      if (!this.wheels[a].grounded && !this.wheels[c].grounded) continue;
      const diff = comp[a] - comp[c];
      const f = (sp.arb ?? this.mass * 14) * diff;
      arbF[a] += f; arbF[c] -= f; // resist roll: push the more-compressed side back up
    }
    let totalLoad = 0;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      if (!w.grounded) { w.compress = 0; continue; }
      const compVel = (w.Lprev - w.L) / dt;
      let f = sp.k * comp[i] + sp.c * compVel + arbF[i];
      if (w.L <= this.minLen + 1e-4) f += sp.k * 6 * (this.minLen + 0.02 - (w.L)) ; // bump stop
      f = clamp(f, 0, sp.k * this.maxLen * 2.2);
      w.load = f; totalLoad += f; w.compress = comp[i];
      _v2.copy(w.mount).applyQuaternion(q).add(p);
      _imp.copy(up).multiplyScalar(f * dt);
      b.applyImpulseAtPoint(_imp, _v2, true);
    }

    // ---------------- aero
    const vFlat = vfBody;
    const dragC = s.dragC ?? 0.42;
    _imp.copy(v).multiplyScalar(-dragC * speed * dt);
    b.applyImpulse(_imp, true);
    const dfMul = (s.downforce ?? 0.35) * vFlat * vFlat; // N per kg
    const downforceN = groundedCount > 0 ? dfMul * this.mass * 0.01 : 0;
    if (downforceN > 0) { _imp.copy(up).multiplyScalar(-downforceN * dt); b.applyImpulse(_imp, true); }

    // ---------------- steering angle (yaw-rate command law, blends to direct counter-steer while drifting)
    const grav = GRAVITY;
    const frontMu = s.grip.front, rearMu = s.grip.rear;
    const avgSurfaceGrip = groundedCount ? this.wheels.reduce((a, w) => a + (w.grounded ? w.surface.grip : 0), 0) / groundedCount : 1;
    const aLatMax = 0.9 * Math.min(frontMu, rearMu) * avgSurfaceGrip * (grav + downforceN / this.mass) * (s.steerAssistK ?? 0.9);
    const rMaxLow = s.yawRateMax ?? 2.3;
    const vAbs = Math.max(Math.abs(vfBody), 1.0);
    // high speed: a bit calmer than the tyre limit (less twitchy on a keyboard, the truck feels its weight); the tightest bend
    // on the route (r 126 m) still only needs ~65% of what is left at top speed
    const rMax = Math.min(rMaxLow, aLatMax / vAbs) * lerp(1, s.hiSpeedYaw ?? 0.76, smoothstep(18, 45, vAbs));
    const lockRad = (s.steerLockDeg ?? 32) * Math.PI / 180;
    let rCmd = this.steerSmooth * rMax * (vfBody < -1 ? -1 : 1);
    let delta = Math.atan(rCmd * this.wheelbase / Math.max(Math.abs(vfBody), 3.0));
    delta = clamp(delta, -lockRad, lockRad);
    // drift mode: front wheels point along the velocity (auto counter-steer); a governor holds a slip angle set by the steering input
    const driftMode = groundedCount >= 2 && speed > 8 && vfBody > 0 && (handbrake || Math.abs(this.slipAngle) > 0.2);
    this.driftMode = driftMode;
    if (driftMode) {
      const counter = clamp(this.slipAngle, -lockRad, lockRad);
      delta = clamp(counter + this.steerSmooth * 0.14, -lockRad, lockRad);
    }
    this.steerAngle = damp(this.steerAngle, delta, 24, dt);

    // ---------------- engine
    const nitroOn = !!inp.nitro && this.nitro > 0 && throttle > 0.1 && this.driverAlive;
    this.boosting = nitroOn;
    if (nitroOn) this.nitro = Math.max(0, this.nitro - dt);
    else if (this.nitroMax > 0) this.nitro = Math.min(this.nitroMax, this.nitro + dt * (s.nitro?.regen ?? 0.12) * (Math.abs(this.slipAngle) > 0.25 && speed > 15 ? 3.0 : 1));
    const eng = s.engine;
    const powerMul = (1 - this.engineDamage * 0.6) * (nitroOn ? (s.nitro?.mul ?? 1.7) : 1);
    const vmax = eng.vmax * (nitroOn ? (s.nitro?.vmaxMul ?? 1.18) : 1);
    let driveForce = 0;
    if (this.reversing) {
      const vr = -vfBody;
      driveForce = -this.mass * (eng.accel0 * 0.6) * clamp(brake, 0, 1) * clamp01(1 - vr / (eng.reverseMax ?? 13));
    } else if (throttle > 0) {
      const x = clamp01(vfBody / vmax);
      const curve = 1 - Math.pow(x, 2.4);
      driveForce = this.mass * eng.accel0 * curve * throttle * powerMul;
      if (vfBody < 0) driveForce = this.mass * eng.accel0 * throttle; // fighting reverse
    }
    this.throttleApplied = throttle; this.brakeApplied = this.reversing ? 0 : brake;
    const brakeTotal = this.reversing ? 0 : (s.brakeDecel ?? 20) * this.mass * brake;

    // ---------------- tyre forces
    let driveShareGrounded = 0;
    for (const w of this.wheels) if (w.grounded) driveShareGrounded += w.drive;
    let anySlide = false, maxSlip = 0;
    const tyreLoadBoost = 1 + downforceN / (this.mass * grav) * 0.7;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      // visual steer
      w.steer = w.front ? this.steerAngle : 0;
      if (!w.grounded || w.load <= 0) { w.slip = damp(w.slip, 0, 10, dt); w.spinRate = damp(w.spinRate, w.spinRate * 0.98, 2, dt); w.spin += w.spinRate * dt; continue; }
      const N = w.load * tyreLoadBoost;
      const n = _n.copy(w.normal);
      // wheel frame
      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      _f.copy(fwd).multiplyScalar(cs).addScaledVector(left, sn);
      _f.addScaledVector(n, -_f.dot(n)).normalize();
      _l.crossVectors(n, _f).normalize();
      // contact velocity
      _v3.copy(w.contact).sub(p);
      _v4.crossVectors(this.angvel, _v3).add(v);
      const vf = _v4.dot(_f), vl = _v4.dot(_l);
      w.vf = vf; w.vl = vl;
      const surf = w.surface;
      let muLat = (w.front ? frontMu : rearMu) * surf.grip * w.grip;
      let muLong = (s.grip.long ?? 1.25) * surf.grip * w.grip;
      let rearHb = false;
      if (handbrake && (w.hb || !w.front)) { muLat *= lerp(s.grip.hbLat ?? 0.32, 0.48, smoothstep(18, 36, speed)); rearHb = true; } // less snap at motorway speed
      const hbBrake = rearHb ? this.mass * (s.hbDecel ?? 3.5) / 2 : 0;
      // longitudinal request
      let Fx = 0;
      if (w.drive > 0 && !rearHb && driveShareGrounded > 0) Fx += driveForce * w.drive / driveShareGrounded;
      const mEff = this.mass / this.wheels.length;
      if (brakeTotal > 0) {
        const fb = brakeTotal * w.brake * (w.flat ? 0.5 : 1);
        Fx += -Math.sign(vf) * Math.min(fb, Math.abs(vf) * mEff / dt);
      }
      if (hbBrake > 0) Fx += -Math.sign(vf) * Math.min(hbBrake, Math.abs(vf) * mEff / dt);
      // rolling resistance + off-road drag
      const rr = (0.012 + surf.drag) * N;
      Fx += -Math.sign(vf) * Math.min(rr, Math.abs(vf) * mEff / dt);
      // lateral: kill sideways velocity with a stiff "grip gain", saturating on the friction circle
      const gain = s.grip.gain ?? 14;
      let Fl = -mEff * vl * gain;
      const Fmax = muLat * N;
      const FxMax = muLong * N;
      // friction circle
      const demand = Math.hypot(Fl / Math.max(Fmax, 1), Fx / Math.max(FxMax, 1));
      let slideK = 1;
      if (demand > 1) { slideK = 1 / demand; anySlide = true; }
      Fl *= slideK; Fx *= slideK;
      // once saturated, kinetic friction is a little lower than static: slide feel
      if (demand > 1.05) { const k = s.grip.slideMul ?? 0.86; Fl *= k; }
      Fl = clamp(Fl, -Fmax, Fmax);
      _imp.copy(_f).multiplyScalar(Fx * dt).addScaledVector(_l, Fl * dt);
      // apply at contact point raised to the COM plane: less pitch/roll fighting, more arcade-stable
      _pt.copy(w.contact).addScaledVector(up, (s.forceHeight ?? 0.55));
      b.applyImpulseAtPoint(_imp, _pt, true);
      // slip for FX
      const slipMag = Math.abs(vl) + Math.max(0, Math.abs(Fx) / Math.max(FxMax, 1) - 0.98) * 12;
      w.slip = clamp01(Math.max(slipMag / 7, demand > 1 ? 0.5 : 0)) * (rearHb && Math.abs(vf) > 3 ? 1 : 1);
      if (demand > 1.0 || (rearHb && speed > 6)) w.slip = Math.max(w.slip, clamp01(0.4 + Math.abs(vl) / 8));
      w.slipLat = vl;
      maxSlip = Math.max(maxSlip, w.slip);
      // spin
      const target = (rearHb ? 0.15 : 1) * vf / R;
      const wheelspin = w.drive > 0 && !rearHb && throttle > 0.9 && vf < 12 && surf.grip < 0.85 ? 10 : 0;
      w.spinRate = target + wheelspin;
      w.spin += w.spinRate * dt;
    }

    // ---------------- stability assist torque (yaw damping toward commanded yaw rate)
    if (groundedCount >= 2) {
      const Iy = (s.inertia ? s.inertia[1] : this.mass * 2.6);
      let tq;
      if (driftMode) {
        // governor: heading relative to velocity follows the steer input like a damped spring
        const dr = s.drift ?? {};
        const betaT = -this.steerSmooth * (dr.maxSlip ?? 0.7) * lerp(1, 0.62, smoothstep(18, 36, speed)); // shallower slides at motorway speed
        const velHeading = Math.atan2(v.x, v.z);
        const velRate = this.prevVelHeading === undefined ? 0 : wrapAngle(velHeading - this.prevVelHeading) / dt;
        this.velRate = damp(this.velRate ?? 0, velRate, 20, dt);
        const rel = -this.slipAngle, relT = -betaT, relRate = this.yawRate - this.velRate;
        const wn = (dr.wn ?? 5.5) * lerp(1, 0.62, smoothstep(18, 36, speed)), zeta = dr.zeta ?? 0.85; // slower, smoother slide entry at speed
        const tqMax = Iy * 9 * lerp(1, 0.5, smoothstep(18, 36, speed)); // gentler slide entry at motorway speed
        tq = clamp(Iy * (wn * wn * (relT - rel) - 2 * zeta * wn * relRate), -tqMax, tqMax);
      } else {
        const err = rCmd - this.yawRate;
        // settle harder when the wheel is centred at speed: no lingering rotation after a keyboard tap
        const settle = Math.abs(this.steerSmooth) < 0.2 ? lerp(1, 3.2, smoothstep(15, 35, vAbs)) : 1;
        tq = clamp(err * (s.yawAssist ?? 5.5) * settle * Iy, -Iy * 14, Iy * 14);
      }
      _imp.copy(up).multiplyScalar(tq * dt);
      b.applyTorqueImpulse(_imp, true);
    }
    this.prevVelHeading = Math.atan2(v.x, v.z);
    // arcade drift: tyres scrubbing sideways would bleed a lot of speed -- push along the velocity so a held drift keeps
    // its momentum (and throttle through the slide is rewarded), capped below top speed
    if (driftMode && throttle > 0.1 && groundedCount >= 2 && speed < vmax * 0.98) {
      const th = (s.drift?.thrust ?? 0) * throttle * clamp01(Math.abs(this.slipAngle) / 0.35);
      if (th > 0) { _imp.copy(v).multiplyScalar(this.mass * th * dt / Math.max(speed, 1)); b.applyImpulse(_imp, true); }
    }
    // drifting bookkeeping
    this.drifting = groundedCount >= 2 && speed > 12 && Math.abs(this.slipAngle) > 0.28;
    this.driftTime = this.drifting ? this.driftTime + dt : Math.max(0, this.driftTime - dt * 2);

    // ---------------- air control: self-level, keep nose along the flight path
    if (groundedCount === 0) {
      const flightDir = _v5.copy(v).normalize();
      // level roll, ease pitch toward velocity direction
      _v3.crossVectors(up, _up); // torque axis to bring up -> world up
      const lvl = (s.airLevel ?? 5.0);
      const pitchErr = speed > 6 ? _v4.crossVectors(fwd, flightDir).multiplyScalar(0.5) : _v4.set(0, 0, 0);
      const tqv = _v3.multiplyScalar(lvl).add(pitchErr.multiplyScalar(lvl * 0.5));
      // damp angular velocity (keep yaw mostly free)
      const av = this.angvel;
      tqv.x -= av.x * 1.6; tqv.z -= av.z * 1.6; tqv.y -= av.y * 0.3;
      _imp.copy(tqv).multiplyScalar(this.mass * 2.0 * dt);
      b.applyTorqueImpulse(_imp, true);
    }
    // flat-tyre / damage pull handled via per-wheel grip in w.grip (set by damage)

    // ---------------- RPM / gear (cosmetic, drives audio + HUD)
    const gearCaps = [0.16, 0.32, 0.5, 0.7, 1.0];
    const vr = Math.abs(vfBody) / (eng.vmax * 1.05);
    let g = 0; while (g < gearCaps.length - 1 && vr > gearCaps[g]) g++;
    const lo = g === 0 ? 0 : gearCaps[g - 1];
    const gearRpm = 0.26 + 0.74 * clamp01((vr - lo) / (gearCaps[g] - lo));
    const target = Math.max(gearRpm, 0.22 + throttle * 0.15);
    if (g + 1 !== this.gear) { this.shiftTimer = 0.14; this.gear = g + 1; }
    this.shiftTimer = Math.max(0, (this.shiftTimer ?? 0) - dt);
    const rpmTarget = this.shiftTimer > 0 ? target - 0.18 : target;
    this.rpm01 = damp(this.rpm01, rpmTarget + (throttle < 0.05 ? -0.05 : 0), 14, dt);
    if (this.stunned > 0) this.stunned = Math.max(0, this.stunned - dt);
  }

  /** After world.step(): refresh cached pose. */
  afterStep() { this.readState(); }

  /** Sets steering/throttle etc. */
  setInput(i) { const t = this.input; t.throttle = i.throttle ?? 0; t.brake = i.brake ?? 0; t.steer = i.steer ?? 0; t.handbrake = !!i.handbrake; t.nitro = !!i.nitro; }

  /** Render-interpolated pose (alpha 0..1 between prev and current physics step). */
  lerpPose(alpha, outPos, outQuat) {
    outPos.lerpVectors(this.prevPos, this.pos, alpha);
    outQuat.slerpQuaternions(this.prevQuat, this.quat, alpha);
  }

  /** Impulse helper (world space impulse at a world point). */
  hit(impulse, point) { this.body.applyImpulseAtPoint(impulse, point, true); }

  destroy() { this.world.removeRigidBody(this.body); }
}
