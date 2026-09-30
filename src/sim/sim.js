// Authoritative simulation (runs on the DRIVER's machine, or locally in solo). DOM-free.
import * as THREE from 'three';
import { RAPIER, initPhysics, createWorld, getColliderLabel, clearColliderLabels } from './physics.js';
import { Vehicle } from './vehicle.js';
import { Car } from './car.js';
import { VEHICLES } from '../data/vehicles.js';
import { Road } from '../world/road.js';
import { RoadQuery } from './road_query.js';
import { HALF_ROAD, biomeAt, BIOMES } from '../data/biomes.js';
import { clamp, lerp, smoothstep, rng } from '../core/util.js';
import { Projectiles } from './projectiles.js';
import { Director } from './director.js';
import { Hazards } from './hazards.js';

export const DT = 1 / 120;
const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3();

const SURFACE = {
  road: { grip: 1.0, drag: 0.0, kind: 'asphalt' },
  oil: { grip: 0.22, drag: 0.01, kind: 'oil' },
  shoulder: { grip: 0.9, drag: 0.02, kind: 'gravel' },
  sand: { grip: 0.78, drag: 0.09, kind: 'sand' },
  dirt_red: { grip: 0.85, drag: 0.05, kind: 'dirt' },
  gravel: { grip: 0.82, drag: 0.05, kind: 'gravel' },
  dry_grass: { grip: 0.86, drag: 0.05, kind: 'grass' },
  grass_green: { grip: 0.84, drag: 0.06, kind: 'grass' },
  rock_red: { grip: 0.9, drag: 0.04, kind: 'rock' },
  rock_grey: { grip: 0.9, drag: 0.04, kind: 'rock' },
  snow: { grip: 0.6, drag: 0.07, kind: 'snow' },
  forest_floor: { grip: 0.8, drag: 0.07, kind: 'dirt' },
  concrete: { grip: 0.95, drag: 0.02, kind: 'concrete' },
};
const OFFROAD_BY_BIOME = { desert: SURFACE.sand, canyon: SURFACE.dirt_red, coast: SURFACE.grass_green, mountain: SURFACE.forest_floor, city: SURFACE.concrete, dam: SURFACE.concrete };

export class Sim {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 1;
    this.world = null; this.road = null;
    this.cars = new Map(); this.nextId = 2; // id 1 = player
    this.colMap = new Map();
    this.player = null;
    this.time = 0; this.tick = 0;
    this.events = [];
    this.ground = null;
    this.state = 'countdown'; // countdown | run | dying | over
    this.stateT = 0;
    this.result = null;
    this.rand = rng(this.seed * 977 + 13);
    this.stats = { kills: 0, crashKills: 0, distance: 0, maxSpeed: 0, damageTaken: 0, shots: 0, hits: 0, cash: 0, streak: 0 };
    this.systems = []; // objects with update(dt, sim)
    this.profile = opts.profile || null;
    this.timeScale = 1;
    this.hitStop = 0;
    this.enemyDamageMul = 1; this.playerDamageMul = 1;
    this.boss = null; this.won = false;
    this.projectiles = this.use(new Projectiles());
    this.director = this.use(new Director(opts.director || {}));
    this.hazards = this.use(new Hazards());
  }

  async init() {
    await initPhysics();
    this.world = createWorld(DT);
    this.eventQueue = new RAPIER.EventQueue(true);
    this.road = new Road(this.seed);
    this.roadQuery = new RoadQuery(this.road);
    return this;
  }

  setGround(g) { this.ground = g; }
  /** The WASM world and event queue are owned by one life, not by the renderer. */
  dispose() {
    this.ground?.dispose?.();
    if (this.world) clearColliderLabels(this.world);
    this.eventQueue?.free(); this.eventQueue = null;
    this.world?.free(); this.world = null;
    this.cars.clear(); this.colMap.clear(); this.events.length = 0;
    this.ground = null; this.player = null; this.boss = null;
  }
  use(sys) { this.systems.push(sys); return sys; }
  emit(e) { e.time = this.time; this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ------------------------------------------------------------------------------------------ spawning
  /** Place a car on the road at path distance s, lateral offset d (left +), heading along the road. */
  spawnCar(specId, { s = 0, d = 0, speed = 0, kind = 'enemy', hold = false, yawOff = 0, id = null, spec = null } = {}) {
    const sp = spec || VEHICLES[specId];
    const sm = this.road.sample(s);
    const x = sm.x + sm.nx * d, z = sm.z + sm.nz * d, y = this.road.surfaceY(sm, d);
    const veh = new Vehicle(this.world, sp, { x, y, z, yaw: sm.th + yawOff });
    const cid = id ?? (kind === 'player' ? 1 : this.nextId++);
    const car = new Car(this, cid, sp, veh, kind);
    car.s = s; car.d = d;
    veh.body.setLinvel({ x: Math.sin(sm.th) * speed, y: 0, z: Math.cos(sm.th) * speed }, true);
    for (const c of veh.colliders) this.colMap.set(c.handle, car);
    this.cars.set(cid, car);
    if (kind === 'player') this.player = car;
    if (hold) veh.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    car.held = hold;
    this.emit({ t: 'spawn', id: cid, spec: sp.id, kind });
    return car;
  }

  releaseCar(car) { if (car.held) { car.veh.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true); car.held = false; } }

  removeCar(car, why = 'gone') {
    for (const c of car.veh.colliders) this.colMap.delete(c.handle);
    car.veh.destroy(); this.cars.delete(car.id);
    this.emit({ t: 'remove', id: car.id, why });
  }

  // ------------------------------------------------------------------------------------------ surface
  surfaceFor(car) {
    const road = this.roadQuery;
    return (x, z) => {
      if (this.hazards.oil.length && this.hazards.oilAt(x, z)) return SURFACE.oil;
      const n = road.nearest(x, z, car.s, 35, this._near || (this._near = {}));
      const ad = Math.abs(n.d);
      if (ad <= HALF_ROAD) return SURFACE.road;
      if (ad <= HALF_ROAD + 2.5) return SURFACE.shoulder;
      const b = biomeAt(n.s);
      return OFFROAD_BY_BIOME[b.w > 0.5 ? b.b : b.a] || SURFACE.dirt_red;
    };
  }

  // ------------------------------------------------------------------------------------------ main step
  step(dt = DT) {
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.1; }
    if (this.state !== 'countdown') this.time += dt;
    this.tick++; this.stateT += dt;
    const P = this.player;
    // ground colliders near the action
    if (this.ground) {
      if (this.tick % 12 === 0) this.ground.update(P ? P.s : 0);
      if (this.state === 'run' && P && P.held && this.ground.groundReady && this.ground.groundReady(P.s)) { this.releaseCar(P); }
    }
    for (const sys of this.systems) sys.update(dt, this);
    if ((this.tick & 1) === 0 && this.state === 'run') for (const car of this.cars.values()) if (car.ai) car.ai.update(dt * 2);

    if (this.boss) this.boss.update(dt);
    for (const car of this.cars.values()) {
      if (car.held) continue;
      car.age += dt;
      if (!car._env) car._env = { surfaceAt: this.surfaceFor(car) };
      car.veh.applyForces(dt, car._env);
    }
    this.world.step(this.eventQueue);
    for (const car of this.cars.values()) if (!car.held) car.veh.afterStep();
    this._contacts(dt);

    // road coordinates + progress
    for (const car of this.cars.values()) {
      const n = this.roadQuery.nearest(car.veh.pos.x, car.veh.pos.z, car.s, 60, this._near || (this._near = {}));
      car.s = n.s; car.d = n.d;
      if (car.crashCooldown > 0) car.crashCooldown -= dt;
      if (car.hitFlash > 0) car.hitFlash -= dt;
    }
    if (P && !P.exploded) this._rampKick(P);
    if (P && !P.exploded && P.veh.grounded === 0 && P.veh.airTime > 0.12) this._airSteer(P, dt);
    if (P) {
      this.stats.distance = Math.max(this.stats.distance, P.s);
      this.stats.maxSpeed = Math.max(this.stats.maxSpeed, P.veh.speed);
    }
    this._burning(dt);
    this._runState(dt);
  }

  // ------------------------------------------------------------------------------------------ damage
  _contacts(dt) {
    this.eventQueue.drainContactForceEvents((ev) => {
      const A = this.colMap.get(ev.collider1()), B = this.colMap.get(ev.collider2());
      this._lastOther = getColliderLabel(this.world, A ? ev.collider2() : ev.collider1()) || (this.boss && (A ? ev.collider2() : ev.collider1()) ? 'boss?' : 'unknown');
      const mag = ev.totalForceMagnitude();
      if (!A && !B) return;
      const dir = ev.maxForceDirection();
      if (A && B) {
        this._crash(A, B, mag, dir, dt);
        this._crash(B, A, mag, dir, dt);
      } else this._crash(A || B, null, mag, dir, dt);
    });
  }

  _crash(car, other, force, dir, dt) {
    if (globalThis.__crashLog && car.kind === 'player') globalThis.__crashLog.push({ what: this._lastOther, t: this.time, other: other ? other.id : -1, force: force | 0, dir: [dir.x, dir.y, dir.z].map((v) => +v.toFixed(2)), v: (car.veh.speed * 3.6) | 0, air: +car.veh.airTime.toFixed(2), s: car.s | 0 });
    if (car.dead && car.exploded) return;
    const dv = force * dt / car.veh.mass; // velocity change contributed this step
    if (dv < 0.35) return;
    car.crashAccum = (car.crashAccum || 0) + dv;
    car.crashT = this.time;
    const speedRel = other ? car.veh.vel.distanceTo(other.veh.vel) : car.veh.vel.length();
    let dmg = (dv - 0.25) * 9 * (car.spec.crashMul ?? 1);
    if (other) dmg *= clamp(other.veh.mass / car.veh.mass, 0.5, 2.0) ** 0.5;
    if (car.kind === 'player') dmg *= (this.playerCrashMul ?? 1);
    if (car.kind === 'player' && other && other.kind === 'enemy') dmg *= (this.enemyRamMul ?? 1); // set by the director (grows with level)
    if (car.kind === 'enemy' && other && other.kind === 'player') {
      dmg *= other.spec.ramHurt ?? 1;                                         // RAM PLATE: hitting us hurts them more
      const sp = other.spec.spikes || 0;                                       // SPIKED SKIRTS: side-swipes shred them
      if (sp > 0 && Math.abs(dir.x * other.veh.left.x + dir.y * other.veh.left.y + dir.z * other.veh.left.z) > 0.5 && this.time - (car.spikeT ?? -9) > 0.35) {
        car.spikeT = this.time; dmg += 14 * sp;
        for (let i = 0; i < car.tireHp.length; i++) car.tireHp[i] -= 0.7 * sp;
        this.emit({ t: 'spikeHit', id: car.id, pos: [car.veh.pos.x, car.veh.pos.y, car.veh.pos.z] });
      }
    }
    if (!other) {
      if (this._lastOther === 'ramp') return;          // ramps launch you, they never hurt
      if (Math.abs(dir.y) > 0.6 && car.kind === 'player' && (this.time - (car.rampJumpT ?? -9) < 4 || this.time - (car.rampLandT ?? -9) < 0.6)) return; // ramp jumps land for free
      if (Math.abs(dir.y) > 0.8) dmg = Math.max(0, dv - 3) * 0.9; // landings: free unless it is a real slam
      else if (Math.abs(dir.y) > 0.6) dmg *= 0.3;
      else if (this.hazards.roadblockNear(car.veh.pos)) dmg *= 0.5; // wreck lines are meant to be survivable
    }
    if (dmg <= 0) return;
    // one impact (0.5 s window) can take at most 30% of the truck: a big crash is brutal, but survivable once
    const win = car.crashWin || (car.crashWin = { t0: -9, dmg: 0 });
    if (this.time - win.t0 > 0.5) { win.t0 = this.time; win.dmg = 0; }
    dmg = Math.min(dmg, Math.max(0, car.maxHp * (car.kind === 'player' ? 0.3 : 0.6) - win.dmg)); win.dmg += dmg;
    if (dmg <= 0) return;
    // blame: a car the player crippled (dead driver, recent hits) that plows into others earns the player a crash kill
    const blame = (c) => c && c.kind === 'enemy' && (c.driverless || (c.lastHitBy === 1 && this.time - c.lastHitT < 8));
    const src = other ? (car.kind === 'enemy' && blame(other) ? 1 : other.id) : (car.kind === 'enemy' && blame(car) ? 1 : -1);
    this.damageCar(car, dmg, { cause: other ? 'ram' : 'crash', src, point: car.veh.pos });
    if (car.crashCooldown <= 0 && dv > 1.2) {
      car.crashCooldown = 0.25;
      _a.set(dir.x, dir.y, dir.z);
      this.emit({ t: 'crash', id: car.id, other: other ? other.id : -1, dv, speed: speedRel, pos: [car.veh.pos.x, car.veh.pos.y, car.veh.pos.z] });
      this.director.onCrash?.(this, car, other, dv); // chain reactions (runaway cars) live in the director
      // rams shake the driver's crew a bit
      const c = car.crew.driver; if (dv > 4 && car.kind === 'enemy' && c.alive) this.damageCrew(car, 'driver', dv * 3, { cause: 'crash' });
      if (car.crew.gunner && car.crew.gunner.alive && dv > 5 && car.kind === 'enemy') this.damageCrew(car, 'gunner', dv * 2.5, { cause: 'crash' });
    }
  }

  /** Arcade ramp launch: leaving a ramp lip at speed adds lift, so a jump is a real jump (big ramp ~4 m peak, ~1.3 s of air). */
  _rampKick(car) {
    const v = car.veh, g = v.grounded;
    if (car._prevGrounded > 0 && g === 0 && v.vf > 14) {
      const f = this.road.featuresIn(car.s - 8, car.s + 1, 'ramp').find((q) => car.s > q.s0 + 6);
      if (f && this.time - (car.rampJumpT ?? -9) > 2) {
        car.rampJumpT = this.time;
        const lin = v.body.linvel(), k = clamp(v.vf / 34, 0.55, 1.15), add = (f.big ? 3.6 : 2.2) * k;
        v.body.setLinvel({ x: lin.x, y: Math.max(lin.y, 0) + add, z: lin.z }, true);
        this.emit({ t: 'rampJump', id: car.id, big: !!f.big });
      }
    }
    if (g > 0 && car._prevGrounded === 0 && car.rampJumpT !== undefined && this.time - car.rampJumpT < 4) { this.emit({ t: 'rampLand', id: car.id, v: Math.abs(v.vel.y) }); car.rampJumpT = -9; car.rampLandT = this.time; }
    car._prevGrounded = g;
  }

  /** Arcade air steer: a flying truck's path bends gently back along the road (and away from the verge), so a ramp taken
   *  flat out lands on the road instead of in a building. Small enough to feel like your own correction. */
  _airSteer(car, dt) {
    const b = car.veh.body, v = b.linvel(), sm = this.road.sample(car.s);
    const tx = Math.sin(sm.th), tz = Math.cos(sm.th);
    const hs = Math.hypot(v.x, v.z); if (hs < 8) return;
    const along = (v.x * tx + v.z * tz) / hs; if (along < 0.7) return;           // only when roughly following the road
    const dirSign = 1, cur = Math.atan2(v.x, v.z), want = Math.atan2(tx * dirSign, tz * dirSign);
    let da = want - cur; da = Math.atan2(Math.sin(da), Math.cos(da));
    const turn = clamp(da, -0.4 * dt, 0.4 * dt), a = cur + turn;
    let vx = Math.sin(a) * hs, vz = Math.cos(a) * hs;
    // drifting off the edge: nudge back toward the tarmac
    const edge = Math.abs(car.d) - (HALF_ROAD - 1.5);
    if (edge > 0) { const out = Math.sign(car.d), nx = Math.cos(sm.th) * out, nz = -Math.sin(sm.th) * out, k = Math.min(edge, 3) * 2.5 * dt; vx -= nx * k; vz -= nz * k; }
    b.setLinvel({ x: vx, y: v.y, z: vz }, true);
  }

  damageCar(car, dmg, info = {}) {
    if (car.dead && car.exploded) return;
    car.hp -= dmg; car.hitFlash = 0.12;
    if (car.kind === 'player') { this.stats.damageTaken += dmg; const k = info.cause || '?'; (this.stats.damageBy || (this.stats.damageBy = {}))[k] = ((this.stats.damageBy[k]) || 0) + dmg; }
    if (info.src !== undefined && info.src >= 0) { car.lastHitBy = info.src; car.lastHitT = this.time; }
    if (car.hp <= 0 && !car.exploded) this.explodeCar(car, info.cause || 'damage', info.src ?? -1);
  }

  damageCrew(car, role, dmg, info = {}) {
    const c = car.crew[role];
    if (!c || !c.alive) return 0;
    dmg *= (1 - (c.armor || 0));
    c.hp -= dmg;
    this.emit({ t: 'crewHit', id: car.id, role, hp: c.hp, dmg, head: !!info.head, point: info.point ? [info.point.x, info.point.y, info.point.z] : null });
    if (c.hp <= 0) {
      c.alive = false; c.hp = 0;
      this.emit({ t: 'crewDead', id: car.id, role, cause: info.cause || 'shot', head: !!info.head, src: info.src ?? -1 });
      if (role === 'driver') {
        car.driverless = true; car.veh.driverAlive = false;
        // dead driver's foot stays on the pedal for a moment: the car keeps going, then coasts (chaos!)
        car.veh.input.steer = (Math.random() - 0.5) * 0.4;
      }
      if (car.kind === 'enemy' && info.src === 1) this._creditKill(car, role);
    }
    return dmg;
  }

  _creditKill(car, role) {
    // enemy crew kill (gunner/driver): small cash; full car kills are credited on explosion
    this.stats.crewKills = (this.stats.crewKills || 0) + 1;
  }

  /** Shot damage to a car at a given zone. returns {killedCrew, dmg} */
  damageZone(car, zone, dmg, info = {}) {
    const z = zone.zone || zone;
    if (car.zoneMul) dmg *= car.zoneMul[z.kind] ?? 1; // warlords: armoured hull, glowing weak point
    const through = zone.throughBody;
    const armorMul = through ? 1 - car.armor : 1;
    const head = /_head$/.test(z.kind);
    switch (z.kind) {
      case 'driver_head': case 'driver':
        this.damageCrew(car, 'driver', dmg * (head ? 2.6 : 1) * (through ? 1 - car.armor * 0.6 : 1), { ...info, head }); return;
      case 'gunner_head': case 'gunner': case 'gunner_legs': case 'gunner2_head': case 'gunner2': case 'gunner2_legs': {
        const role = z.role; const m = z.lowerBody ? 0.45 : 1;
        this.damageCrew(car, role, dmg * (head ? 2.6 : 1) * m, { ...info, head }); return;
      }
      case 'engine':
        car.engineHp -= dmg * armorMul * 0.6; car.veh.engineDamage = clamp(1 - car.engineHp / 100, 0, 1);
        this.damageCar(car, dmg * armorMul * 0.5, info);
        if (car.engineHp <= 0 && !car.smoking) { car.smoking = true; this.emit({ t: 'engineDead', id: car.id }); }
        return;
      case 'fuel': {
        const seal = car.spec.fuelSeal || 0;                                   // SELF-SEALING TANK
        car.fuelHp -= dmg * armorMul / (1 + seal);
        this.damageCar(car, dmg * armorMul * 0.5, info);
        if (car.fuelHp <= 0 && !car.exploded && car.fuseT < 0) {
          if (seal > 0) { car.fuelHp = 60 + car.maxHp * 0.3 * seal; if (car.burning <= 0) { car.burning = 0.001; car.sealBurn = 2.5 + seal; } this.emit({ t: 'fire', id: car.id }); }
          else { car.fuseT = 0.4 + Math.random() * 0.6; this.emit({ t: 'fuelLeak', id: car.id }); }
        }
        return;
      }
      case 'tire': {
        const i = z.index; car.tireHp[i] -= dmg * (car.spec.tireMul ?? 1) / 12;
        if (car.tireHp[i] <= 0 && !car.veh.wheels[i].flat) { const w = car.veh.wheels[i]; w.flat = true; w.grip = 0.55; this.emit({ t: 'tirePop', id: car.id, index: i }); }
        this.damageCar(car, dmg * armorMul * 0.15, info);
        return;
      }
      default:
        this.damageCar(car, dmg * armorMul, info);
    }
  }

  explodeCar(car, cause, src) {
    if (car.exploded) return;
    car.exploded = true; car.dead = true; car.hp = 0;
    car.veh.driverAlive = false; car.driverless = true; car.veh.input.throttle = 0; car.veh.input.brake = 0;
    for (const r of Object.keys(car.crew)) { const c = car.crew[r]; if (c.alive) { c.alive = false; c.hp = 0; this.emit({ t: 'crewDead', id: car.id, role: r, cause: 'explosion', src }); } }
    const p = car.veh.pos, big = car.spec.explosive ? 2.4 : 1;
    this.emit({ t: 'explode', id: car.id, pos: [p.x, p.y, p.z], size: (car.spec.mass > 4000 ? 1.8 : 1) * big, cause, src, spec: car.spec.id, vel: [car.veh.vel.x, car.veh.vel.y, car.veh.vel.z] });
    // launch the wreck a little
    car.veh.body.applyImpulse({ x: (Math.random() - 0.5) * car.veh.mass * 2, y: car.veh.mass * (3 + Math.random() * 3) * big, z: (Math.random() - 0.5) * car.veh.mass * 2 }, true);
    car.veh.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * car.veh.mass * 3, y: 0, z: (Math.random() - 0.5) * car.veh.mass * 3 }, true);
    this.blast(p, (car.spec.explosive ? 26 : 11), (car.spec.explosive ? 260 : 110), (car.spec.explosive ? 1.0 : 0.6), car);
    this.director.onExplode?.(this, car); // neighbours cook off, wrecks tumble
    if (car.kind === 'enemy') {
      this.stats.kills++;
      if (src === 1 || (car.lastHitBy === 1 && this.time - car.lastHitT < 6)) {
        this.stats.streak++;
        this.emit({ t: 'kill', id: car.id, spec: car.spec.id, cause, pos: [p.x, p.y, p.z], crash: cause === 'ram' || cause === 'crash' || (src > 1) });
        // salvage: every wreck you make patches your truck a little (a warlord a lot) -- aggression keeps you rolling
        const P = this.player;
        if (P && !P.exploded && this.state === 'run') {
          const k = car.elite ? 0.14 : (car.spec.mass > 4000 ? 0.012 : 0.006);
          const before = P.hp; P.hp = Math.min(P.maxHp, P.hp + P.maxHp * k);
          if (P.hp > before) this.emit({ t: 'repair', id: P.id, amount: P.hp - before, big: !!car.elite });
        }
      }
    }
  }

  /** Area damage + impulse. sourceCar is excluded; ownerId attributes kills (1 = the player's weapons). */
  blast(pos, radius, damage, impulseScale, sourceCar, ownerId) {
    const src = ownerId ?? (sourceCar ? sourceCar.id : -1);
    if (this.boss && src === 1) this.boss.blastParts(pos, radius, damage);
    for (const car of this.cars.values()) {
      if (car === sourceCar) continue;
      if (src === 1 && car.kind === 'player') continue; // no friendly fire from the player's own weapons
      // chain explosions of a car the player wrecked are credited to the player (for enemies only)
      const credit = car.kind === 'enemy' && sourceCar && sourceCar.kind === 'enemy' && sourceCar.lastHitBy === 1 && this.time - sourceCar.lastHitT < 12 ? 1 : src;
      const d = car.veh.pos.distanceTo(pos);
      if (d > radius + 3) continue;
      const f = 1 - clamp((d - 2) / radius, 0, 1);
      if (f <= 0) continue;
      const dir = _a.copy(car.veh.pos).sub(pos); dir.y = Math.max(dir.y, 0.4 * d) + 1; dir.normalize();
      const k = damage * f * car.veh.mass * 0.09 * impulseScale;
      car.veh.body.applyImpulse({ x: dir.x * k, y: dir.y * k, z: dir.z * k }, true);
      const tq = damage * f * car.veh.mass * 0.05;
      car.veh.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * tq, y: (Math.random() - 0.5) * tq, z: (Math.random() - 0.5) * tq }, true);
      if (!car.exploded) {
        const pm = car.kind === 'player' ? (this.playerBlastMul ?? 0.6) * (sourceCar ? (this.playerCarBlastMul ?? 1) : 1) : 1; // (car cook-offs next to you: director)
        this.damageCar(car, damage * f * pm, { cause: credit !== src ? 'crash' : 'blast', src: credit });
        for (const r of Object.keys(car.crew)) if (car.crew[r].alive) this.damageCrew(car, r, damage * f * 0.5 * pm, { cause: 'blast', src: credit });
      }
    }
  }

  /** The gunner's client reports a hit it detected against the cars it sees. */
  applyHit(rep) {
    if (this.boss && rep.carId === this.boss.id) {
      const d = this.boss.damage(rep.zone, rep.dmg * this.playerDamageMul, { point: rep.point });
      if (d > 0) this.stats.hits++;
      return d > 0;
    }
    const car = this.cars.get(rep.carId);
    if (!car || (car.exploded && !rep.wreck)) return false;
    const P = this.player;
    if (P && car.veh.pos.distanceTo(P.veh.pos) > 900) return false;
    const zone = car.zones.find((z) => z.kind === rep.zone && (z.index === undefined || z.index === rep.zoneIndex)) || car.zones.find((z) => z.kind === 'body');
    const dmg = rep.dmg * this.playerDamageMul * (rep.tireMul && zone.kind === 'tire' ? rep.tireMul : 1);
    this.stats.hits++;
    this.damageZone(car, { zone, throughBody: !!rep.through }, dmg, { cause: 'bullet', src: 1, point: new THREE.Vector3(...rep.point), head: !!rep.head, weapon: rep.weapon });
    // hit reaction impulse (tiny shove so shots feel physical)
    const dir = rep.dir; car.veh.body.applyImpulseAtPoint({ x: dir[0] * dmg * 3, y: dir[1] * dmg * 3, z: dir[2] * dmg * 3 }, { x: rep.point[0], y: rep.point[1], z: rep.point[2] }, true);
    return true;
  }

  _burning(dt) {
    for (const car of this.cars.values()) {
      if (car.exploded) {
        car.wreckT = (car.wreckT || 0) + dt;
        continue;
      }
      // low hp -> smoke -> fire -> explosion timer
      const f = car.hp / car.maxHp;
      if (f < 0.34 && !car.smoking) { car.smoking = true; this.emit({ t: 'smoke', id: car.id }); }
      if (f < 0.16 && car.burning <= 0) { car.burning = 0.001; this.emit({ t: 'fire', id: car.id }); }
      // a self-sealing tank fire burns out on its own (unless the truck is already cooked)
      if (car.sealBurn && car.burning > car.sealBurn && f >= 0.16) { car.burning = 0; car.sealBurn = 0; }
      if (car.burning > 0) { car.burning += dt; this.damageCar(car, dt * (car.maxHp * 0.03), { cause: 'fire' }); if (car.burning > 9 && !car.exploded) this.explodeCar(car, 'fire', car.lastHitBy); }
      if (car.fuseT >= 0) { car.fuseT -= dt; if (car.fuseT < 0) this.explodeCar(car, car.chainFrom ? 'crash' : 'fuel', car.lastHitBy); }
    }
  }

  _runState(dt) {
    const P = this.player;
    if (!P) return;
    if (this.state === 'countdown') return;
    if (this.state === 'run' && this.boss && this.boss.exploded) {
      this.wonT = (this.wonT || 0) + dt;
      if (this.wonT > 3) { this.won = true; this.state = 'over'; this.result = { why: 'victory' }; this.emit({ t: 'runOver', why: 'victory' }); }
      return;
    }
    if (this.state === 'run') {
      const why = P.exploded ? 'car' : !P.crew.driver.alive ? 'driver' : (P.crew.gunner && !P.crew.gunner.alive) ? 'gunner' : null;
      if (why) { this.state = 'dying'; this.stateT = 0; this.result = { why }; this.emit({ t: 'playerDown', why }); }
    } else if (this.state === 'dying') {
      if (!P.exploded && (this.stateT > 1.4)) this.explodeCar(P, 'crew', -1);
      if (this.stateT > 3.2) { this.state = 'over'; this.stateT = 0; this.emit({ t: 'runOver', why: this.result.why }); }
    }
  }

  start() { this.state = 'run'; this.stateT = 0; this.time = 0; }

  /** Nearest enemy cars sorted by distance to a point (for aim assist / AI / radar). */
  enemiesNear(p, radius) {
    const out = [];
    for (const c of this.cars.values()) if (c.kind === 'enemy' && !c.exploded && c.veh.pos.distanceTo(p) < radius) out.push(c);
    return out;
  }
}

Sim.prototype.useMedkit = function () {
  const P = this.player; if (!P || P.exploded || this.state !== 'run') return false;
  let used = false;
  for (const role of ['driver', 'gunner']) { const c = P.crew[role]; if (c && c.alive && c.hp < c.max) { c.hp = Math.min(c.max, c.hp + c.max * 0.6); used = true; } }
  if (P.hp < P.maxHp) { P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.12); used = true; }
  if (used) this.emit({ t: 'medkit', id: P.id });
  return used;
};
