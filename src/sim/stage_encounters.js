// Shared, bounded encounter actors. Only the driver authority creates physics
// or deals damage; peers receive the same targets and visible event phases.
import * as THREE from 'three';
import { RAPIER, GROUPS, RAY_SHOT, setColliderLabel, removeBody } from './physics.js';
import { rayBox, raySphere } from './car.js';
import { resolveHitPoint, validHitReport } from './hit_contact.js';
import { plannedStageEncounters } from '../data/stage_encounters.js';
import { BIOMES, HALF_ROAD } from '../data/biomes.js';
import { terrainPoint, seaLevel } from '../world/terrain_gen.js';
import { clamp } from '../core/util.js';
import { celebrationActive } from './victory_presentation.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const _local = new V3(), _dir = new V3(), _inverse = new Q(), _point = new V3(), _target = new V3(), _origin = new V3();
const KINDS = new Set(['gate', 'rock', 'tower', 'rifleman', 'arch', 'drone', 'boat', 'barrel', 'vent']);
const STATES = new Set(['armed', 'falling', 'rubble', 'broken', 'dead']);
export const STAGE_ACTOR_LIMIT = 48;
export const STAGE_BARREL_LIMIT = 24;
const AHEAD = 420, BEHIND = 240;
const halfArray = half => [half.x, half.y, half.z];
const finiteArray = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);

function actorRaycast(actor, origin, direction, maxDistance) {
  if (actor.dead || !actor.shootable || !Number.isFinite(maxDistance) || maxDistance < 0) return null;
  _inverse.copy(actor.quat).invert();
  _local.copy(origin).sub(actor.pos).applyQuaternion(_inverse);
  _dir.copy(direction).applyQuaternion(_inverse);
  let distance = Infinity, zone = null;
  for (const candidate of actor.zones) {
    const t = candidate.shape === 'sphere' ? raySphere(_local, _dir, candidate.c, candidate.r) : rayBox(_local, _dir, candidate.c, candidate.h);
    if (t >= 0 && t <= maxDistance && t < distance) { distance = t; zone = candidate; }
  }
  if (!zone) return null;
  // A visible fuse/support sits at the outside face; it never grants a weak hit
  // through another panel or through the empty opening beneath the arch.
  const weak = actor.zones.find(z => z.kind === 'weakpoint');
  if (weak) {
    const t = raySphere(_local, _dir, weak.c, weak.r);
    if (t >= 0 && t <= maxDistance && t <= distance + .4) { distance = t; zone = weak; }
  }
  return { t: distance, zone, car: actor, actor, throughBody: false, point: origin.clone().addScaledVector(direction, distance) };
}

function actorRecord(id, kind, site, pos, half, hp, extra = {}) {
  const yaw = extra.yaw ?? 0;
  const actor = {
    id, kind, biome: site.biome, siteId: site.id, s: site.s0, yaw,
    pos: new V3(pos.x, pos.y, pos.z), quat: new Q().setFromAxisAngle(new V3(0, 1, 0), yaw), half: { ...half },
    hp, maxHp: hp, age: 0, status: 'armed', phase: 'armed', dead: false, exploded: false,
    shootable: kind !== 'vent', isStageEncounter: true, team: 1,
    groundY: extra.groundY ?? pos.y - half.y, owner: extra.owner ?? id,
    gapD: site.gapD || 0, gap: site.gap || 6, body: null, bodies: [], colliders: [],
    fireT: 1.7, firePhase: 0, contactT: new Map(), ...extra,
  };
  actor.veh = { pos: actor.pos, quat: actor.quat, poseRevision: 0, restComHeight: 0, vel: new V3() };
  actor.spec = { id: `stage_${kind}`, hp, width: half.x * 2, height: half.y * 2, length: half.z * 2, mass: kind === 'barrel' ? 45 : 600, seats: {}, wheels: [], colliders: [] };
  if (kind === 'arch') actor.spec.weakpoint = { zone: 'weakpoint' };
  actor.zones = [{ kind: 'body', shape: 'box', c: [0, 0, 0], h: halfArray(half) }];
  if (kind === 'tower') {
    actor.zones.unshift({ kind: 'gunner_head', shape: 'sphere', c: [0, half.y + .62, 0], r: .27 },
      { kind: 'gunner', shape: 'box', c: [0, half.y + .16, 0], h: [.35, .42, .3] });
  }
  actor.muzzle = new V3(); actor.aimDirection = new V3(Math.sin(yaw), 0, Math.cos(yaw)); actor.aimDir = actor.aimDirection;
  actor.zoneMul = { weakpoint: 3, gunner_head: 2.6, gunner: 1.5 };
  actor.raycast = (o, d, max) => actorRaycast(actor, o, d, max);
  actor.raycastRadius = () => Math.max(Math.hypot(half.x, half.y, half.z), ...actor.zones.map(z => Math.hypot(...z.c) + (z.r || Math.hypot(...z.h))));
  return actor;
}

export class StageEncounters {
  constructor({ authoritative = true } = {}) {
    this.authoritative = authoritative; this.entities = new Map(); this.actors = this.entities; this.sites = new Map();
    this.warned = new Set(); this.finished = new Set(); this.colliderActors = new Map(); this.pendingConvoys = new Map();
    this.nextId = 50000; this.lastSnapshotTick = -1; this.sim = null; this.plan = null;
    this.shotRay = null; this._shotActor = null;
    this._shotFilter = collider => this.colliderActors.get(collider.handle) !== this._shotActor;
  }

  *targets() { for (const actor of this.entities.values()) if (!actor.dead && actor.shootable) yield actor; }
  aimPoint(actor, eye, out) {
    if (!actor || this.entities.get(actor.id) !== actor || actor.dead || !actor.shootable) return null;
    out.copy(actor.weakpoint?.pos || actor.pos);
    if (eye) {
      _target.copy(out).sub(eye); const distance = _target.length();
      if (distance < .01) return null;
      const hit = actor.raycast(eye, _target.multiplyScalar(1 / distance), distance + .5);
      if (!hit || actor.kind === 'arch' && hit.zone.kind !== 'weakpoint') return null;
      if (this.authoritative && this.sim?.world && !this._shooterLineOfSight(actor, eye, hit.point, this.sim)) return null;
    }
    return out;
  }
  colliderOwner(handle) { return this.colliderActors.get(handle) || null; }
  ownsCollider(handle) { return this.colliderActors.has(handle); }
  raycast(origin, direction, maxDistance) {
    let best = null;
    for (const actor of this.targets()) {
      if (origin.distanceToSquared(actor.pos) > (maxDistance + actor.raycastRadius()) ** 2) continue;
      const hit = actor.raycast(origin, direction, best ? best.t : maxDistance);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    return best;
  }

  update(dt, sim = this.sim) {
    if (!sim || !Number.isFinite(dt) || dt < 0 || dt > .2) return;
    this.sim = sim;
    if (!this.authoritative || (sim.state !== 'run' && !celebrationActive(sim)) || !sim.player || sim.player.exploded) return;
    if (!this.plan) this.plan = plannedStageEncounters(sim.road);
    const p = sim.player;
    if (sim.tick % 15 === 0) this._sync(sim, p.s);
    for (const actor of this.entities.values()) {
      actor.age = Math.min(1e7, actor.age + dt);
      if ((actor.body && actor.status !== 'armed') || actor.kind === 'barrel') this._readBody(actor);
      if (actor.dead) continue;
      if (actor.kind === 'gate') this._gateContacts(actor, dt, sim);
      else if (actor.kind === 'arch') this._arch(actor, dt, sim);
      else if (actor.kind === 'rock') this._rock(actor, dt, sim);
      else if (actor.kind === 'barrel') this._barrel(actor, dt, sim);
      else if (actor.kind === 'vent') this._vent(actor, dt, sim);
      else this._shooter(actor, dt, sim);
    }
  }

  _sync(sim, s) {
    for (const site of this.plan) {
      if (!this.warned.has(site.id) && s >= site.warningS && s < site.s0 + 20) {
        this.warned.add(site.id);
        sim.emit({ t: 'stageWarn', kind: site.kind, siteId: site.id, title: site.title, hint: site.hint, s0: site.s0, dist: site.s0 - s, gapD: site.gapD, gap: site.gap });
      }
      if (site.s0 >= s - 30 && site.s0 < s + AHEAD && !this.sites.has(site.id) && !this.finished.has(site.id)) this._spawnSite(sim, site);
    }
    for (const [id, actor] of this.entities) {
      if (actor.s < s - BEHIND || (actor.dead && actor.deadT < sim.time - 5) || (actor.kind === 'barrel' && actor.age > 14)) this._remove(id, sim);
    }
    for (const [id, site] of this.sites) if (site.s1 < s - BEHIND) { this.finished.add(id); this.sites.delete(id); }
    this._tryConvoys(sim);
  }

  _create(sim, kind, site, pos, half, hp, extra = {}) {
    if (this.entities.size >= STAGE_ACTOR_LIMIT || this.nextId >= 60000) return null;
    const actor = actorRecord(this.nextId++, kind, site, pos, half, hp, extra);
    this._refreshMuzzle(actor);
    this.entities.set(actor.id, actor); return actor;
  }
  _point(sim, s, d, height = 0, terrain = false) {
    const out = terrain ? terrainPoint(sim.road, sim.seed, s, d, {}) : sim.road.pointAt(s, d, {});
    return { x: out.x, y: out.y + height, z: out.z, yaw: sim.road.sample(s).th, groundY: out.y };
  }
  _body(sim, actor, half, local = [0, 0, 0], dynamic = false) {
    _point.fromArray(local).applyQuaternion(actor.quat).add(actor.pos);
    let desc = dynamic ? RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setAngularDamping(.7) : RAPIER.RigidBodyDesc.fixed();
    desc = desc.setTranslation(_point.x, _point.y, _point.z).setRotation(actor.quat);
    const body = sim.world.createRigidBody(desc);
    const shape = actor.kind === 'barrel' ? RAPIER.ColliderDesc.cylinder(half.y, half.x) : RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z);
    const col = sim.world.createCollider(shape.setCollisionGroups(GROUPS.prop).setDensity(dynamic ? 35 : 1).setRestitution(actor.kind === 'barrel' ? .32 : .04).setFriction(.8), body);
    actor.bodies.push(body); actor.colliders.push(col); this.colliderActors.set(col.handle, actor);
    setColliderLabel(sim.world, col, `stage_${actor.kind}`);
    if (!actor.body) actor.body = body;
    return body;
  }
  _weak(actor, local, radius) {
    actor.zones.unshift({ kind: 'weakpoint', shape: 'sphere', c: [...local], r: radius });
    actor.weakpoint = { pos: new V3().fromArray(local).applyQuaternion(actor.quat).add(actor.pos), radius };
  }
  _spawnSite(sim, site) {
    this.sites.set(site.id, site);
    const side = site.side < 0 ? -1 : 1;
    if (site.kind === 'shoot_gate') {
      const width = 2 * HALF_ROAD - clamp(site.gap || 6.2, 6.2, 10);
      const halfWidth = width / 2;
      // gapD is the actual empty lane, shared with driver AI and the sign.
      // Shooting this opposite-side panel opens the entire roadway.
      const p = this._point(sim, site.s0, side * (HALF_ROAD - halfWidth), 1.25);
      const actor = this._create(sim, 'gate', site, p, { x: halfWidth, y: 1.25, z: .22 }, 60, p);
      if (actor) { this._weak(actor, [0, .15, -.32], .4); this._body(sim, actor, actor.half); }
    } else if (site.kind === 'collapse_arch') {
      const p = this._point(sim, site.s0, 0, 7.2), half = { x: 9, y: .9, z: 1.15 };
      for (const sd of [-1, 1]) {
        const leg = this._point(sim, site.s0, sd * 8);
        if (sim.road.corridorBlocked?.(leg.x, leg.z, 1.2, site.s0)) return;
      }
      const actor = this._create(sim, 'arch', site, p, half, 70, p);
      if (actor) {
        actor.zones.push(...[-1, 1].map(sd => ({ kind: 'body', shape: 'box', c: [sd * 8, -3.6, 0], h: [.65, 3.6, 1.15] })));
        // The glowing support is exposed to the rear-facing gunner AFTER the
        // driver has passed; the near face deliberately remains armored.
        this._weak(actor, [side * 8, -5.6, 1.3], .6);
        this._body(sim, actor, half);
        for (const sd of [-1, 1]) this._body(sim, actor, { x: .65, y: 3.6, z: 1.15 }, [sd * 8, -3.6, 0]);
      }
    } else if (site.kind === 'rockfall' || site.kind === 'lava_fall') {
      for (let i = 0; i < 3; i++) {
        const d = side * ((site.gap || 8.2) - HALF_ROAD + 1.5 + i * 1.35), p = this._point(sim, site.s0 + i * 19, d, 18 + i * 2.4);
        const actor = this._create(sim, 'rock', site, p, { x: 1.15, y: 1.4, z: 1.25 }, 100, { ...p, s: site.s0 + i * 19, arm: 1.1 + i * .2, warningS: site.warningS });
        if (actor) actor.lava = site.kind === 'lava_fall';
      }
    } else if (site.kind === 'steam_vent') {
      for (let i = 0; i < 3; i++) {
        const p = this._point(sim, site.s0 + i * 22, side * ((site.gap || 8.2) - HALF_ROAD + 1.2 + i * 1.2), .15);
        this._create(sim, 'vent', site, p, { x: 1.0, y: .2, z: 1.0 }, 1, { ...p, s: site.s0 + i * 22, fireT: 3.5 + i * .7 });
      }
    } else if (site.kind === 'flying_drone') {
      for (let i = 0; i < 2; i++) {
        const p = this._point(sim, site.s0 + i * 25, side * (5 + i * 3), 14 + i * 4);
        const actor = this._create(sim, 'drone', site, p, { x: 1.5, y: .5, z: .9 }, 100, { ...p, baseY: p.y, baseS: site.s0 + i * 25, d: side * (5 + i * 3), weapon: 'mg' });
        if (actor) this._weak(actor, [0, -.35, -.4], .35);
      }
    } else if (site.kind === 'patrol_boat') {
      for (let i = 0; i < 2; i++) {
        const waterSide = BIOMES[site.biome]?.terrain?.seaSide;
        if (!waterSide) continue;
        const water = seaLevel(sim.road, site.biome), s = site.s0 + i * 36;
        // A boat must be far enough beyond the unchanged asphalt deck that a
        // real standing gunner can see it over the edge. The shared terrain
        // water cut lowers the shore outside that deck in both meshes.
        let p = null, d = waterSide * ((site.biome === 'dam' ? 195 : 180) + i * 15);
        for (let attempt = 0; attempt < 5 && Math.abs(d) <= 225; attempt++, d += waterSide * 14) {
          const candidate = this._point(sim, s, d, 0, true);
          if (candidate.y < water - 1.5) { p = candidate; break; }
        }
        if (!p) continue;
        p.y = water + .45;
        const actor = this._create(sim, 'boat', site, p, { x: 1.7, y: .8, z: 4.3 }, 180, { ...p, s, groundY: water, waterY: water, baseS: s, d, weapon: 'mg' });
        if (actor) this._weak(actor, [0, .9, -2.0], .48);
      }
    } else if (site.kind === 'barrel_convoy') {
      this.pendingConvoys.set(site.id, { site, nextAttempt: 0 });
    } else {
      const tower = site.kind === 'gun_tower' || site.kind === 'grenade_nest';
      for (let i = 0; i < (tower ? 2 : 3); i++) {
        const s = site.s0 + i * 38;
        let p = null;
        for (let d = tower ? 17 : 31 + i * 5; d <= 85; d += 6) {
          const candidate = this._point(sim, s, side * d, tower ? 5 : 1.0, true);
          if (site.kind === 'cliff_riflemen' && candidate.groundY < sim.road.sample(s).y + 8) continue;
          if (!sim.road.corridorBlocked?.(candidate.x, candidate.z, tower ? 2.6 : 1.0, s)) { p = candidate; break; }
        }
        if (!p) continue;
        const actor = this._create(sim, tower ? 'tower' : 'rifleman', site, p, tower ? { x: 1.8, y: 5, z: 1.8 } : { x: .4, y: 1.0, z: .4 }, tower ? 220 : 45,
          { ...p, s: site.s0 + i * 38, weapon: site.kind === 'grenade_nest' ? 'grenade' : site.kind === 'cliff_riflemen' ? 'rifle' : 'mg' });
        if (actor) { this._weak(actor, [0, tower ? -3.3 : .62, tower ? -2.0 : -.5], tower ? .5 : .25); if (tower) this._body(sim, actor, actor.half); }
      }
    }
  }

  _tryConvoys(sim) {
    const director = sim.director, player = sim.player;
    if (!director?.enabled || !player || sim.boss && !sim.boss.dead || director.activeElite) return;
    for (const [id, pending] of this.pendingConvoys) {
      const { site } = pending;
      if (player.s > site.s1 + 80) { this.pendingConvoys.delete(id); this.finished.add(id); continue; }
      if (player.s < site.warningS || sim.time < pending.nextAttempt) continue;
      pending.nextAttempt = sim.time + .5;
      const existing = [...sim.cars.values()].find(c => !c.exploded && c.spec.id === 'e_barrel_carrier' && Math.abs(c.s - player.s) < 220);
      if (existing) { this.pendingConvoys.delete(id); sim.emit({ t: 'stageConvoy', id: existing.id, siteId: id, s0: site.s0, biome: site.biome }); continue; }
      const level = clamp(director.level || .08, .03, 1), cap = Math.round(3 + 6.8 * Math.pow(level, .8)) + (director.opts?.capBonus || 0);
      let alive = 0; for (const car of sim.cars.values()) if (car.kind === 'enemy' && !car.exploded) alive++;
      if (alive >= cap || director.budget < 2.2) continue;
      const s = Math.max(player.s + 85, Math.min(site.s0 + 35, player.s + 220));
      if (sim.ground?.groundReady && !sim.ground.groundReady(s, null)) continue;
      const car = director.spawn(sim, 'e_barrel_carrier', level, { behavior: 'dropper', gap: -55, at: { s, d: 0, speed: Math.max(16, player.veh.vf || 0) * .9 } });
      if (!car) continue;
      director.budget = Math.max(0, director.budget - 2.2);
      this.pendingConvoys.delete(id); sim.emit({ t: 'stageConvoy', id: car.id, siteId: id, s0: site.s0, biome: site.biome });
    }
  }

  _readBody(actor) {
    if (!actor.body?.isValid()) return;
    const p = actor.body.translation(), q = actor.body.rotation(), v = actor.body.linvel();
    actor.pos.set(p.x, p.y, p.z); actor.quat.set(q.x, q.y, q.z, q.w); actor.veh.vel.set(v.x, v.y, v.z);
    this._refreshWeak(actor); this._refreshMuzzle(actor);
  }
  _refreshWeak(actor) {
    const zone = actor.zones.find(z => z.kind === 'weakpoint');
    if (zone && actor.weakpoint) actor.weakpoint.pos.fromArray(zone.c).applyQuaternion(actor.quat).add(actor.pos);
  }
  _refreshMuzzle(actor) {
    const y = actor.kind === 'tower' ? actor.half.y + .7 : actor.kind === 'boat' ? 1.6 : actor.kind === 'drone' ? -.4 : .55;
    actor.muzzle.set(0, y, 0).applyQuaternion(actor.quat).add(actor.pos);
    const forward = actor.kind === 'rifleman' ? .65 : actor.kind === 'drone' ? .6 : actor.kind === 'tower' || actor.kind === 'boat' ? .9 : 0;
    actor.muzzle.addScaledVector(actor.aimDirection, forward);
  }
  _gateContacts(actor, dt, sim) {
    for (const car of sim.cars.values()) {
      if (car.exploded || car.held || car.veh.pos.distanceToSquared(actor.pos) > 18 ** 2) continue;
      _local.copy(car.veh.pos).sub(actor.pos).applyQuaternion(_inverse.copy(actor.quat).invert());
      const reach = car.spec.length / 2 + Math.max(0, car.veh.speed || 0) * dt;
      if (Math.abs(_local.x) > actor.half.x + car.spec.width / 2 || Math.abs(_local.y) > 4 || Math.abs(_local.z) > reach + .3) continue;
      const speed = car.veh.speed || car.veh.vel.length();
      if (speed < 5) continue;
      // A missed gunner shot costs speed and some hull, never an unavoidable wall.
      this.damageActor(actor, actor.hp, { src: car.id, cause: 'ram' }, sim);
      const v = car.veh.body.linvel(); car.veh.body.setLinvel({ x: v.x * .8, y: v.y, z: v.z * .8 }, true);
      sim.damageCar(car, car.maxHp * .035, { cause: 'crash', src: actor.id, point: actor.pos });
      break;
    }
  }
  _arch(actor, dt, sim) {
    if (actor.collapsePending && actor.status === 'armed' && sim.player.s > actor.s + 18) {
      this._removeBodies(actor, sim); actor.status = actor.phase = 'falling'; actor.fallT = 0;
      this._body(sim, actor, actor.half, [0, 0, 0], true);
      sim.emit({ t: 'stageWarn', kind: 'collapse', siteId: actor.siteId, title: 'ARCH COMING DOWN', hint: 'The road behind is blocked. Keep moving!', s0: actor.s, dist: 0 });
    }
    if (actor.status !== 'falling' && actor.status !== 'rubble') return;
    actor.fallT += dt;
    if (actor.status === 'falling' && actor.pos.y < actor.groundY + actor.half.y + .8) actor.status = actor.phase = 'rubble';
    if (actor.fallT > .45) this._dangerContacts(actor, sim, 240, 'crash', true);
  }
  _rock(actor, dt, sim) {
    if (actor.status === 'armed') {
      // Dropping a rock is driven by proximity plus a minimum readable tell.
      if (sim.player.s < actor.warningS || Math.abs(sim.player.s - actor.s) > 300) return;
      actor.arm -= dt;
      if (actor.arm <= 0 && (!sim.ground?.groundReady || sim.ground.groundReady(actor.s, null))) { actor.status = actor.phase = 'falling'; this._body(sim, actor, actor.half, [0, 0, 0], true); actor.fallT = 0; }
    } else if (actor.status === 'falling') {
      actor.fallT += dt;
      if (actor.pos.y < actor.groundY + actor.half.y + .4) actor.status = actor.phase = 'rubble';
    }
    if (actor.status !== 'armed') this._dangerContacts(actor, sim, actor.lava ? 34 : 24, 'crash');
  }
  _barrel(actor, dt, sim) {
    actor.arm -= dt;
    if (actor.arm > 0) return;
    const p = sim.player;
    if (p && !p.exploded && p.veh.pos.distanceToSquared(actor.pos) < (p.spec.width / 2 + 1.0) ** 2) this.damageActor(actor, actor.hp, { src: actor.owner, cause: 'contact' }, sim);
    if (actor.age >= 13.8) this._kill(actor, { src: -1, cause: 'expired', quiet: true }, sim);
  }
  _dangerContacts(actor, sim, damage, cause, enemiesOnly = false) {
    for (const car of sim.cars.values()) {
      if (car.exploded || car.held || enemiesOnly && car.kind === 'player') continue;
      if (actor.contactT.has(car.id)) continue;
      _local.copy(car.veh.pos).sub(actor.pos).applyQuaternion(_inverse.copy(actor.quat).invert());
      if (Math.abs(_local.x) > actor.half.x + car.spec.width / 2 || Math.abs(_local.z) > actor.half.z + car.spec.length / 2 || Math.abs(_local.y) > actor.half.y + 1.2) continue;
      actor.contactT.set(car.id, sim.time);
      if (actor.contactT.size > 64) actor.contactT.delete(actor.contactT.keys().next().value);
      const credit = enemiesOnly && actor.lastHitBy === 1 ? 1 : actor.id;
      sim.damageCar(car, car.kind === 'player' ? Math.min(damage, car.maxHp * .15) : damage, { cause, src: credit, point: actor.pos });
      sim.emit({ t: 'crash', id: car.id, other: actor.id, dv: 3, speed: car.veh.speed || 0, pos: actor.pos.toArray() });
    }
  }
  _vent(actor, dt, sim) {
    if (actor.firePhase > 0) {
      actor.firePhase = Math.max(0, actor.firePhase - dt);
      this._dangerContacts(actor, sim, 14, 'steam');
    }
    actor.fireT -= dt;
    if (actor.fireT > 0) return;
    actor.fireT = 4.3; actor.firePhase = .85; actor.contactT.clear();
    sim.emit({ t: 'stagePulse', id: actor.id, kind: 'steam', pos: actor.pos.toArray(), duration: .85 });
  }
  _shooterLineOfSight(actor, origin, target, sim) {
    const distance = origin.distanceTo(target);
    if (!sim.world || !Number.isFinite(distance) || distance < .01) return false;
    if (!this.shotRay) this.shotRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const ray = this.shotRay, inverseDistance = 1 / distance;
    ray.origin.x = origin.x; ray.origin.y = origin.y; ray.origin.z = origin.z;
    ray.dir.x = (target.x - origin.x) * inverseDistance;
    ray.dir.y = (target.y - origin.y) * inverseDistance;
    ray.dir.z = (target.z - origin.z) * inverseDistance;
    // Only the firing actor's own collision is excluded. Shores, roads, other
    // props and authored rocks remain real obstructions, just as for bullets.
    this._shotActor = actor;
    const max = distance - .01;
    const hit = sim.world.castRay(ray, max, true, undefined, RAY_SHOT, undefined, undefined, this._shotFilter);
    this._shotActor = null;
    if (hit) return false;
    return !sim.structures?.raycastRocks(ray.origin, ray.dir, max);
  }

  _shooter(actor, dt, sim) {
    const p = sim.player;
    if (actor.kind === 'drone') {
      actor.pos.y = actor.baseY + Math.sin(actor.age * 1.8) * .8;
      this._refreshWeak(actor);
    }
    this._refreshMuzzle(actor);
    const distance = actor.pos.distanceTo(p.veh.pos);
    if (distance > 260 || p.s > actor.s + 170) return;
    const velocity = p.veh.vel, travel = distance / (actor.weapon === 'rifle' ? 140 : 105);
    const gunner = actor.kind === 'boat' && p.crew.gunner?.alive && p.zones.find(zone => zone.kind === 'gunner_head');
    if (gunner) {
      // A low ship firing uphill at the truck's COM aims through the deck.
      // Use the actual exposed head hit zone, including the vehicle pose and
      // crew offset, so an unobstructed boat shot can reach a real target.
      const crew = p.crew.gunner;
      _target.set(gunner.c[0] + (crew.x || 0), gunner.c[1] - p.veh.restComHeight - (crew.crouch ? .55 : 0), gunner.c[2] + (crew.z || 0))
        .applyQuaternion(p.veh.quat).add(p.veh.pos);
    } else {
      // Vehicle.pos is its low center of mass, often below exposed bodywork.
      _target.copy(p.veh.pos); _target.y += .65;
    }
    _target.addScaledVector(velocity, Math.min(travel, 1.1));
    _origin.copy(actor.pos); _origin.y += actor.kind === 'tower' ? actor.half.y + .7 : actor.kind === 'boat' ? 1.6 : actor.kind === 'drone' ? -.4 : .55;
    actor.aimDirection.copy(_target).sub(_origin).normalize(); this._refreshMuzzle(actor);
    actor.fireT -= dt;
    if (actor.fireT > 0) return;
    if (!this._shooterLineOfSight(actor, actor.muzzle, _target, sim)) {
      actor.firePhase = 0; actor.fireT = .3;
      return;
    }
    if (!actor.firePhase) { actor.firePhase = 1; actor.fireT = 1.0; sim.emit({ t: 'stageAim', id: actor.id, pos: actor.pos.toArray(), weapon: actor.weapon, duration: 1.0 }); return; }
    actor.firePhase = 0; actor.fireT = actor.weapon === 'grenade' ? 5.2 : actor.weapon === 'rifle' ? 2.6 : 2.1;
    _origin.copy(actor.muzzle);
    _dir.copy(_target).sub(_origin).normalize();
    if (actor.weapon === 'grenade') {
      if (sim.projectiles.grenades.length >= 12 || distance > 68) return;
      const duration = clamp(distance / 27, .8, 2.4), vel = _target.sub(_origin).multiplyScalar(1 / duration); vel.y += 8.75 * duration;
      sim.projectiles.addGrenade(sim, _origin, vel, { fuse: duration + .8, blast: 5.5, dmg: 32 }, actor.id);
      sim.emit({ t: 'grenadeThrow', src: actor.id, role: 'gunner', origin: _origin.toArray(), vel: vel.toArray(), enemy: true });
    } else {
      if (sim.projectiles.bullets.length >= 320) return;
      const speed = actor.weapon === 'rifle' ? 140 : 105, damage = actor.weapon === 'rifle' ? 6 : 3;
      const rays = [];
      for (let i = 0; i < (actor.weapon === 'rifle' ? 1 : 3); i++) {
        // Every burst walks across the aim point. A fixed per-ID vertical bias
        // can make all rounds from one tower forever miss a stationary truck.
        _target.copy(_dir); _target.x += Math.sin(actor.id + actor.age * 7 + i) * .018; _target.y += Math.cos(actor.id * 3 + actor.age * 5 + i) * .014; _target.normalize();
        sim.projectiles.addBullet(_origin, _target, speed, damage, actor.id, actor.weapon, Math.min(3.0, distance / speed + .6));
        rays.push({ dir: _target.toArray() });
      }
      sim.emit({ t: 'shot', src: actor.id, weapon: 'enemy', origin: _origin.toArray(), rays, speed });
    }
  }

  dropBarrel(sim, car) {
    if (!this.authoritative || !sim?.world || !car || car.exploded || [...this.entities.values()].filter(a => a.kind === 'barrel' && !a.dead).length >= STAGE_BARREL_LIMIT) return null;
    const fwd = car.veh.fwd, pos = car.veh.pos.clone().addScaledVector(fwd, -car.spec.length / 2 - 1.3); pos.y += .25;
    const b = sim.road.biomeAt(car.s), site = { id: `barrel-${car.id}-${sim.tick}`, s0: car.s, biome: b.w > .5 ? b.b : b.a };
    const actor = this._create(sim, 'barrel', site, pos, { x: .46, y: .65, z: .46 }, 12, { owner: car.id, s: car.s, arm: .65, groundY: car.veh.pos.y - car.veh.restComHeight, yaw: Math.atan2(fwd.x, fwd.z) });
    if (!actor) return null;
    // Native cylinders have a +Y axle. Rotate that axle onto road-left, then
    // spin about the same horizontal axle so this rolls instead of cartwheeling.
    actor.quat.setFromAxisAngle(fwd, -Math.PI / 2);
    const body = this._body(sim, actor, actor.half, [0, 0, 0], true);
    // SpawnCar assigns launch velocity after the Vehicle constructor reads its
    // pose. Read the actual body here, also covering a same-step ram impulse.
    const inherited = car.veh.body.linvel();
    const vx = inherited.x * .25 - fwd.x * 12, vz = inherited.z * .25 - fwd.z * 12;
    body.setLinvel({ x: vx, y: .4, z: vz }, true);
    const roll = clamp((vx * fwd.x + vz * fwd.z) / actor.half.x, -28, 28);
    body.setAngvel({ x: fwd.z * roll, y: 0, z: -fwd.x * roll }, true);
    sim.emit({ t: 'stageBarrel', id: actor.id, owner: car.id, pos: actor.pos.toArray() });
    return actor;
  }

  applyHit(report, sim = this.sim) {
    if (!this.authoritative || !sim || !validHitReport(report) || !Number.isSafeInteger(report.shotId) || report.shotId <= 0) return false;
    const actor = this.entities.get(report.carId);
    if (!actor || actor.dead || !actor.shootable || sim.player && actor.pos.distanceTo(sim.player.veh.pos) > 900) return false;
    const point = resolveHitPoint(actor, report, _point);
    if (!point) return false;
    const zone = actor.zones.find(z => z.kind === report.zone);
    if (!zone) return false;
    _local.copy(point).sub(actor.pos).applyQuaternion(_inverse.copy(actor.quat).invert());
    const close = zone.shape === 'sphere' ? _local.distanceToSquared(new V3().fromArray(zone.c)) <= (zone.r + .65) ** 2
      : actor.zones.some(z => z.shape === 'box' && Math.abs(_local.x - z.c[0]) <= z.h[0] + .65 && Math.abs(_local.y - z.c[1]) <= z.h[1] + .65 && Math.abs(_local.z - z.c[2]) <= z.h[2] + .65);
    if (!close) return false;
    const key = `${report.shotId}|${zone.kind}|${report.dir.map(v => v.toFixed(6)).join(',')}|${_local.toArray().map(v => v.toFixed(4)).join(',')}`;
    const contacts = actor.hitContacts || (actor.hitContacts = new Map());
    if (contacts.has(key)) return false;
    const dealt = this.damageActor(actor, report.dmg * (sim.playerDamageMul ?? 1), { src: 1, cause: 'bullet', zone: zone.kind, point }, sim);
    if (dealt <= 0) return false;
    contacts.set(key, report.shotId);
    if (contacts.size > 128) contacts.delete(contacts.keys().next().value);
    return true;
  }
  damageActor(actor, damage, info = {}, sim = this.sim) {
    if (!this.authoritative || !sim || !actor || actor.dead || !Number.isFinite(damage) || damage <= 0 || damage > 10000) return 0;
    if (actor.kind === 'arch' && info.zone !== 'weakpoint' && info.cause !== 'blast') return 0;
    const multiplier = info.zone === 'weakpoint' ? (actor.kind === 'arch' ? 1 : 3) : info.zone === 'gunner_head' ? 2.6 : info.zone === 'gunner' ? 1.5 : actor.kind === 'tower' ? .35 : 1;
    const dealt = Math.min(actor.hp, damage * multiplier); actor.hp -= dealt; actor.lastHitBy = info.src;
    if (actor.hp <= 0) {
      if (actor.kind === 'arch') { actor.collapsePending = true; actor.shootable = false; }
      else this._kill(actor, info, sim);
    }
    return dealt;
  }
  blast(pos, radius, damage, owner = -1, sim = this.sim, sourceCar = null) {
    if (!this.authoritative || !sim || !Number.isFinite(radius) || radius <= 0 || radius > 100 || !Number.isFinite(damage) || damage <= 0 || damage > 10000) return;
    for (const actor of this.entities.values()) {
      if (actor.dead || !actor.shootable) continue;
      const distance = actor.pos.distanceTo(pos);
      if (distance >= radius + actor.raycastRadius()) continue;
      this.damageActor(actor, damage * clamp(1 - Math.max(0, distance - actor.raycastRadius()) / radius, 0, 1), { src: owner, cause: 'blast', sourceCar }, sim);
    }
  }
  _kill(actor, info, sim) {
    if (actor.dead) return;
    actor.hp = 0; actor.dead = actor.exploded = true; actor.status = actor.phase = actor.kind === 'gate' ? 'broken' : 'dead'; actor.deadT = sim.time;
    this._removeBodies(actor, sim);
    if (!info.quiet) sim.emit({ t: 'stageBreak', id: actor.id, kind: actor.kind, siteId: actor.siteId, pos: actor.pos.toArray(), owner: info.src });
    if (info.src === 1 && ['tower', 'rifleman', 'drone', 'boat'].includes(actor.kind)) {
      if (!celebrationActive(sim)) sim.stats.kills++;
      sim.emit({ t: 'kill', id: actor.id, spec: `stage_${actor.kind}`, cause: info.cause || 'bullet', pos: actor.pos.toArray(), crash: false, nonScoring: celebrationActive(sim) });
    }
    if (actor.kind === 'barrel' && !info.quiet) {
      sim.emit({ t: 'boom', pos: actor.pos.toArray(), radius: 5.5, kind: 'mine' });
      // This is a dodgeable enemy weapon, rather than an enemy vehicle cook-off.
      sim.blast(actor.pos, 5.5, 42, .45, info.sourceCar?.kind === 'enemy' ? info.sourceCar : null, info.src === 1 ? 1 : actor.owner);
    }
  }
  _removeBodies(actor, sim) {
    for (const collider of actor.colliders) this.colliderActors.delete(collider.handle);
    for (const body of actor.bodies) if (body.isValid()) removeBody(sim.world, body);
    actor.bodies.length = actor.colliders.length = 0; actor.body = null;
  }
  _remove(id, sim) {
    const actor = this.entities.get(id); if (!actor) return;
    if (this.authoritative && sim?.world) this._removeBodies(actor, sim);
    actor.contactT.clear(); actor.hitContacts?.clear(); this.entities.delete(id);
  }

  snapshot() {
    return { tick: this.sim?.tick ?? 0, time: this.sim?.time ?? 0, actors: [...this.entities.values()].map(a => ({
      id: a.id, kind: a.kind, biome: a.biome, siteId: a.siteId, s: a.s, pos: a.pos.toArray(), quat: a.quat.toArray(), half: halfArray(a.half),
      hp: a.hp, maxHp: a.maxHp, status: a.status, age: a.age, groundY: a.groundY, yaw: a.yaw, owner: a.owner, gapD: a.gapD, gap: a.gap,
      poseRevision: a.veh.poseRevision, collapsePending: !!a.collapsePending, firePhase: a.firePhase, weapon: a.weapon || 'mg',
      muzzle: a.muzzle.toArray(), aimDir: a.aimDirection.toArray(),
      weakpoint: a.weakpoint ? { local: [...a.zones.find(z => z.kind === 'weakpoint').c], radius: a.weakpoint.radius } : null,
    })) };
  }
  updateGuest(dt) {
    if (this.authoritative || !Number.isFinite(dt) || dt <= 0 || dt > .2) return;
    const alpha = 1 - Math.exp(-20 * dt);
    for (const actor of this.entities.values()) {
      if (!actor.targetPos) continue;
      actor.pos.lerp(actor.targetPos, alpha); actor.quat.slerp(actor.targetQuat, alpha);
      if (actor.aimDirection.dot(actor.targetAim) < -.9) actor.aimDirection.copy(actor.targetAim);
      else actor.aimDirection.lerp(actor.targetAim, alpha).normalize();
      this._refreshWeak(actor); this._refreshMuzzle(actor);
    }
  }
  applySnapshot(state) {
    if (this.authoritative || !state || !Number.isSafeInteger(state.tick) || state.tick <= this.lastSnapshotTick || !Number.isFinite(state.time) || state.time < 0 || !Array.isArray(state.actors) || state.actors.length > STAGE_ACTOR_LIMIT) return false;
    const ids = new Set();
    for (const a of state.actors) {
      if (!a || !Number.isInteger(a.id) || a.id < 50000 || a.id >= 60000 || ids.has(a.id) || !KINDS.has(a.kind) || !BIOMES[a.biome] || !STATES.has(a.status) || !finiteArray(a.pos, 3) || a.pos.some(v => Math.abs(v) > 1e7) || !finiteArray(a.quat, 4) || Math.abs(Math.hypot(...a.quat) - 1) > .002 || !finiteArray(a.half, 3) || a.half.some(v => v <= 0 || v > 20) || !Number.isFinite(a.hp) || !Number.isFinite(a.maxHp) || a.hp < 0 || a.maxHp <= 0 || a.maxHp > 10000 || a.hp > a.maxHp || !Number.isFinite(a.s) || a.s < 0 || a.s > 1e7 || !Number.isFinite(a.age) || a.age < 0 || a.age > 1e7 || !Number.isFinite(a.groundY) || Math.abs(a.groundY) > 1e7 || !Number.isFinite(a.yaw) || Math.abs(a.yaw) > 1e6 || !Number.isInteger(a.poseRevision) || a.poseRevision < 0 || a.poseRevision > 65535 || !Number.isInteger(a.owner) || a.owner < -1 || a.owner >= 60000 || typeof a.siteId !== 'string' || a.siteId.length > 96 || !Number.isFinite(a.gapD) || Math.abs(a.gapD) > 7 || !Number.isFinite(a.gap) || a.gap < 0 || a.gap > 14 || typeof a.collapsePending !== 'boolean' || !Number.isFinite(a.firePhase) || a.firePhase < 0 || a.firePhase > 1 || !['mg', 'rifle', 'grenade'].includes(a.weapon) || !finiteArray(a.muzzle, 3) || a.muzzle.some(v => Math.abs(v) > 1e7) || !finiteArray(a.aimDir, 3) || Math.abs(Math.hypot(...a.aimDir) - 1) > .002 || a.weakpoint && (!finiteArray(a.weakpoint.local, 3) || a.weakpoint.local.some(v => Math.abs(v) > 20) || !Number.isFinite(a.weakpoint.radius) || a.weakpoint.radius <= 0 || a.weakpoint.radius > 2)) return false;
      const previous = this.entities.get(a.id);
      if (previous && ((a.poseRevision - previous.veh.poseRevision) & 0xffff) > 32767) return false;
      ids.add(a.id);
    }
    for (const [id] of this.entities) if (!ids.has(id)) this._remove(id, null);
    for (const data of state.actors) {
      let a = this.entities.get(data.id);
      if (!a || a.kind !== data.kind) {
        a = actorRecord(data.id, data.kind, { id: data.siteId, biome: data.biome, s0: data.s, gapD: data.gapD, gap: data.gap }, { x: data.pos[0], y: data.pos[1], z: data.pos[2] }, { x: data.half[0], y: data.half[1], z: data.half[2] }, data.maxHp);
        if (data.kind === 'arch') a.zones.push(...[-1, 1].map(sd => ({ kind: 'body', shape: 'box', c: [sd * 8, -3.6, 0], h: [.65, 3.6, 1.15] })));
        if (data.weakpoint) this._weak(a, data.weakpoint.local, data.weakpoint.radius);
        this.entities.set(a.id, a);
      }
      const snap = !a.targetPos || data.poseRevision !== a.veh.poseRevision || a.pos.distanceToSquared(_point.fromArray(data.pos)) > 25 ** 2;
      if (!a.targetPos) { a.targetPos = new V3(); a.targetQuat = new Q(); a.targetAim = new V3(); }
      a.targetPos.fromArray(data.pos); a.targetQuat.fromArray(data.quat); a.targetAim.fromArray(data.aimDir);
      if (snap) { a.pos.copy(a.targetPos); a.quat.copy(a.targetQuat); a.aimDirection.copy(a.targetAim); }
      a.hp = data.hp; a.maxHp = data.maxHp; a.status = a.phase = data.status;
      a.dead = a.exploded = data.status === 'dead' || data.status === 'broken'; a.shootable = !a.dead && a.kind !== 'vent' && !data.collapsePending;
      a.age = data.age; a.groundY = data.groundY; a.yaw = data.yaw; a.owner = data.owner; a.gapD = data.gapD; a.gap = data.gap;
      a.collapsePending = data.collapsePending; a.firePhase = data.firePhase; a.weapon = data.weapon; a.veh.poseRevision = data.poseRevision;
      this._refreshWeak(a); this._refreshMuzzle(a);
    }
    this.lastSnapshotTick = state.tick; return true;
  }
  dispose(sim = this.sim) {
    for (const id of this.entities.keys()) this._remove(id, sim);
    this.sites.clear(); this.finished.clear(); this.warned.clear(); this.colliderActors.clear(); this.pendingConvoys.clear(); this.plan = this.sim = null;
    this.lastSnapshotTick = -1;
  }
}
