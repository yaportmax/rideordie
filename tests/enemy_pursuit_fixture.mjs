import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sim, DT } from '../src/sim/sim.js';
import { EnemyBrain } from '../src/sim/ai.js';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { buildPlayerSpec } from '../src/game/run_setup.js';
import { TerrainStreamer } from '../src/world/terrain.js';
import { CHUNK_LEN, genTerrainChunk, genRoadChunk, genDrivingBranchChunk } from '../src/world/terrain_gen.js';
import { clamp, wrapAngle } from '../src/core/util.js';
import { Road } from '../src/world/road.js';

const SEARCH_SEEDS = [7, 11, 31, 12345, 381442461, 561889576];
const OBSTACLES = new Set(['roadblock', 'stage_challenge', 'ramp', 'bridge', 'tunnel', 'overpass']);
// Source shortcut signs start 120m before s0; this also covers the 90m
// default route query and the physical ribbon/carving extensions of 4-6m.
// Pad actual descriptors only; retain V2's per-case travel and 220m lookahead.
const BRANCH_CLEARANCE = 120;
function findNaturalScene({ gap = 150, seconds = 8, travelSpeed = 85, curve = false, journey } = {}) {
  // The original 1600m exclusion cannot fit between the authored 1700m
  // challenge groups plus their rows. Match this case's finite travel budget,
  // include the actual 220m approach lookahead, and scan dense bounded sites.
  const lo = curve ? 11000 : 450, hi = curve ? 18300 : 8200;
  for (const seed of SEARCH_SEEDS) {
    const road = new Road(seed, journey);
    const branchRanges = road.ensureDrivingBranches().map(branch => ({
      id: branch.id, biome: branch.biome, s0: branch.s0, s1: branch.s1,
      width: branch.width, from: branch.s0 - BRANCH_CLEARANCE, to: branch.s1 + BRANCH_CLEARANCE,
    }));
    for (let s = lo; s <= hi; s += 24) {
      const from = s - Math.max(0, gap) - 35, to = s + Math.ceil(seconds * travelSpeed) + 220;
      // Positive main-road pursuit must not enter a join or service corridor.
      // Use the full already-qualified window, including the initial chase gap.
      if (branchRanges.some(branch => from <= branch.to && to >= branch.from)) continue;
      const features = road.featuresIn(from, to);
      if (features.some(f => OBSTACLES.has(f.type))) continue;
      const actorS = s - gap, k = Math.abs(road.sample(actorS).k);
      // Canyon source kmax is 1/190, so v1's .006 oracle was impossible.
      // .0045 is a genuine bend near the authored maximum, not a fake curve.
      if (curve && k < .0045) continue;
      if (!curve && k > 1 / 240) continue;
      return { seed, s, gap, seconds, travelSpeed, from, to, k, journey: road.journey,
        mainRoadOnly: true, branchClearance: BRANCH_CLEARANCE, branchRanges };
    }
  }
  return null;
}

// Production EnemyBrain trajectory and contact fixtures.
// Real source-generated triangles, Director spawning,
// Vehicle suspension/traction/tank law and Sim contact pipeline. Isolated traffic
// and this fixed input driver are fixtures, not earned progress or native proof.
// No assignment to attack/contact, grounding, sim time, pursuit timers or tank.
function supportedGround(sim) {
  const st = Object.create(TerrainStreamer.prototype);
  Object.assign(st, { world: sim.world, road: sim.road, seed: sim.seed, chunks: new Map(),
    group: new THREE.Group(), terrainMat: new THREE.MeshBasicMaterial(), roadMat: new THREE.MeshBasicMaterial(),
    pending: new Set(), stats: { built: 0 }, _sLast: 0 });
  st.update = function(s) {
    this._sLast = s;
    for (let c = Math.max(0, Math.floor((s - 330) / CHUNK_LEN)); c <= Math.floor((s + 400) / CHUNK_LEN); c++) {
      if (!this.chunks.has(c)) this._onMsg2({ busy: 1 }, { type: 'chunk', key: `${c}:0`, chunk: c, lod: 0,
        t: genTerrainChunk(sim.road, sim.seed, c, 0), r: genRoadChunk(sim.road, sim.seed, c),
        b: genDrivingBranchChunk(sim.road, sim.seed, c) });
    }
    for (const [c, rec] of this.chunks) {
      if ((c + .5) * CHUNK_LEN < s - 600 || (c + .5) * CHUNK_LEN > s + 700) { this._dispose(c, rec); this.chunks.delete(c); }
      else this._collision(c, rec, s);
    }
  };
  st.dispose = function() { for (const [c, rec] of this.chunks) this._dispose(c, rec); this.terrainMat.dispose(); this.roadMat.dispose(); };
  return st;
}

function fixtureProfile() {
  const p = DEFAULT_PROFILE(); p.truck = 'truck_t3'; p.trucks.push('truck_t3');
  p.vehicleUpgrades.rustbucket = { engine: 3, armor: 5, tires: 3 };
  return p;
}

const vector = v => [v.x, v.y, v.z];
const attackState = ai => ai.atk ? { ...ai.atk } : null;
function projectionRange(vehicle, axis) {
  let min = Infinity, max = -Infinity;
  for (const collider of vehicle.colliders) {
    const half = collider.halfExtents(), radius = collider.roundRadius() || 0;
    assert.ok(half, 'real vehicle hull must expose its rounded-cuboid half extents');
    const q = collider.rotation(), quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const extent = Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(quat).dot(axis)) * half.x
      + Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(quat).dot(axis)) * half.y
      + Math.abs(new THREE.Vector3(0, 0, 1).applyQuaternion(quat).dot(axis)) * half.z + radius;
    const centre = new THREE.Vector3().copy(collider.translation()).dot(axis);
    min = Math.min(min, centre - extent); max = Math.max(max, centre + extent);
  }
  return { min, max };
}
function contactGeometry(sim, car, player) {
  const v = car.veh, p = player.veh, delta = v.pos.clone().sub(p.pos);
  const prediction = sim.world.integrationParameters.normalizedPredictionDistance * sim.world.lengthUnit;
  const axes = [['playerLateral', p.left], ['playerLongitudinal', p.fwd], ['enemyLateral', v.left], ['enemyLongitudinal', v.fwd]];
  const projections = axes.map(([name, axis]) => {
    const enemy = projectionRange(v, axis), target = projectionRange(p, axis);
    return { name, axis: vector(axis), enemy, player: target,
      separation: Math.max(enemy.min - target.max, target.min - enemy.max) };
  });
  const pairs = [];
  for (const own of v.colliders) for (const other of p.colliders) sim.world.contactPair(own, other, manifold => {
    const solverContacts = [];
    for (let i = 0; i < manifold.numSolverContacts(); i++) {
      const point = manifold.solverContactPoint(i);
      solverContacts.push({ point: point ? vector(point) : null, distance: manifold.solverContactDist(i) });
    }
    const contacts = [];
    for (let i = 0; i < manifold.numContacts(); i++) contacts.push({ distance: manifold.contactDist(i), impulse: manifold.contactImpulse(i) });
    pairs.push({ enemyHandle: own.handle, playerHandle: other.handle, normal: vector(manifold.normal()),
      count: manifold.numContacts(), solverCount: manifold.numSolverContacts(), contacts, solverContacts });
  });
  return { prediction, playerFrame: { lateral: delta.dot(p.left), longitudinal: delta.dot(p.fwd), vertical: delta.dot(p.up) },
    enemy: { pos: v.pos.toArray(), quat: v.quat.toArray(), width: car.spec.width, length: car.spec.length },
    player: { pos: p.pos.toArray(), quat: p.quat.toArray(), width: player.spec.width, length: player.spec.length },
    projections, pairs };
}
function physicalContact(receipt) {
  const geometry = receipt?.geometry;
  return !!geometry && Number.isFinite(geometry.prediction) && geometry.prediction >= 0
    && Object.values(geometry.playerFrame).every(Number.isFinite)
    && geometry.projections.length === 4
    && geometry.projections.every(p => Number.isFinite(p.separation) && p.separation <= geometry.prediction + .01)
    && geometry.pairs.some(p => p.solverCount > 0 && p.solverContacts.some(c => c.point?.length === 3
      && c.point.every(Number.isFinite) && Number.isFinite(c.distance)));
}
function pairedCrash(f) {
  return f.sim.events.find(e => e.t === 'crash'
    && ((e.id === f.player.id && e.other === f.car.id) || (e.id === f.car.id && e.other === f.player.id)));
}
function rawState(f) {
  const { sim, player: p, car: c } = f, v = c.veh;
  const body = car => ({ id: car.id, s: car.s, d: car.d, route: car.route, hp: car.hp, dead: car.dead,
    driverAlive: car.crew.driver.alive, pos: vector(car.veh.body.translation()), quat: { ...car.veh.body.rotation() },
    velocity: vector(car.veh.body.linvel()), angularVelocity: vector(car.veh.body.angvel()),
    grounded: car.veh.grounded, up: car.veh.up.y, poseRevision: car.veh.poseRevision, input: { ...car.veh.input },
    loaded: f.st.groundReady(car.s, car.route) });
  return { time: sim.time, hitStop: sim.hitStop, tick: sim.tick, state: sim.state, player: body(p), enemy: body(c), gap: p.s - c.s,
    attack: attackState(c.ai), attackCooldown: c.ai.atkCd, targetD: c.ai._lastDT, desiredSpeed: c.ai._lastVDes,
    curveLimit: c.ai._curveLimit, boost: v.boosting, pursuitBoost: c.ai.pursuitBoost,
    legacyCurveLimit: c.ai._curveLegacyLimit, tireCurveBound: c.ai._curveTireBound,
    tank: v.nitro, tankMax: v.nitroMax, rechargeLocked: v.nitroRechargeLocked, needsRelease: v.nitroNeedsRelease,
    slip: v.slipAngle, lateralSpeed: v.vl,
    wheels: v.wheels.map(w => ({ grounded: w.grounded, surfaceGrip: w.surface?.grip, grip: w.grip, flat: w.flat })),
    damageBy: { ...sim.stats.damageBy } };
}

async function fixture({ enemy = 'e_muscle', behavior = 'rammer',
  seed = 7, s = null, gap = 150, d = 0, speed = 45, level = .6,
  seconds = 8, travelSpeed = 85, curve = false, journey, elite, pattern, recordSteps = false } = {}) {
  let scene = null;
  if (s == null) {
    scene = findNaturalScene({ gap, seconds, travelSpeed, curve, journey });
    assert.ok(scene, 'bounded real scene matching this case travel/window must exist');
    ({ seed, s } = scene);
  }
  const sim = await new Sim({ seed, journey }).init();
  try {
  const st = supportedGround(sim); st.update(s); sim.setGround(st);
  const { spec } = buildPlayerSpec(fixtureProfile());
  const player = sim.spawnCar('truck_t3', { kind: 'player', spec, s, speed });
  sim.director.playerVmax = spec.engine.vmax; sim.director.level = level;
  const car = sim.director.spawn(sim, enemy, level, { behavior, side: d >= 0 ? 1 : -1,
    at: { s: s - gap, d, speed }, elite, pattern });
  assert.ok(car, `actual Director must accept the declared ${enemy} site`);
  const brain = car.ai;
  assert.ok(brain instanceof EnemyBrain, 'Director must construct the production EnemyBrain');
  const contacts = [], onContact = car.ai.onContact;
  car.ai.onContact = function(...args) {
    const attack = attackState(this), geometry = contactGeometry(sim, car, player);
    const result = onContact.apply(this, args);
    contacts.push({ time: sim.time, tick: sim.tick, attack, contact: this.atk?.contact === true, geometry });
    return result;
  };
  const driveIntents = [], drive = car.ai._drive;
  car.ai._drive = function(dt, targetD, targetSpeed, ...args) {
    const before = { time: sim.time, tick: sim.tick, dt, attack: attackState(this), gap: player.s - car.s,
      playerD: player.d, carD: car.d, contacts: contacts.length, targetD, targetSpeed, brake: args[0], nitro: args[1] };
    const result = drive.call(this, dt, targetD, targetSpeed, ...args);
    driveIntents.push({ ...before, input: { ...car.veh.input }, actualTargetD: this._lastDT, curveLimit: this._curveLimit,
      legacyCurveLimit: this._curveLegacyLimit, tireCurveBound: this._curveTireBound,
      slip: car.veh.slipAngle, grounded: car.veh.grounded,
      surfaceTraction: typeof this._traction === 'function' ? this._traction(false) : null,
      tireTraction: typeof this._traction === 'function' ? this._traction(true) : null });
    return result;
  };
  const aiUpdates = [], update = car.ai.update;
  car.ai.update = function(dt) {
    const before = attackState(this), beforeContacts = contacts.length, result = update.call(this, dt);
    aiUpdates.push({ time: sim.time, tick: sim.tick, dt, before, after: attackState(this), beforeContacts,
      contacts: contacts.length, carD: car.d, playerD: player.d, gap: player.s - car.s });
    return result;
  };
  const ramDamage = [], damageCar = sim.damageCar;
  sim.damageCar = function(target, amount, info, ...args) {
    const tracked = target === player && info?.cause === 'ram' && info.src === car.id, beforeHP = target.hp;
    const result = damageCar.call(this, target, amount, info, ...args);
    if (tracked) ramDamage.push({ time: sim.time, tick: sim.tick, amount, beforeHP, afterHP: target.hp,
      actual: beforeHP - target.hp, cause: info.cause, src: info.src });
    return result;
  };
  // Keep actual projectile and contact/damage systems; isolate uncontrolled
  // spawning/hazards/stage actors. Authored road features still constrain AI.
  sim.systems = [sim.projectiles]; sim.start(); sim.drainEvents();
  return { sim, st, player, car, brain, contacts, scene, driveIntents, aiUpdates, ramDamage, recordSteps, raw: [] };
  } catch (error) { sim.dispose(); throw error; }
}

function driveTarget(f, throttle = .65, nitro = false) {
  const { sim, player: p } = f, v = p.veh;
  const point = sim.road.drivingPointAt(p.s + clamp(v.speed * .5 + 12, 20, 45), 0, p.route, {});
  const desired = Math.atan2(point.x - v.pos.x, point.z - v.pos.z);
  v.setInput({ throttle, steer: clamp(wrapAngle(desired - Math.atan2(v.fwd.x, v.fwd.z)) * 4, -.75, .75), nitro });
}
function state(f) {
  const { sim, player: p, car: c } = f, v = c.veh;
  return { time: sim.time, gap: p.s - c.s, s: c.s, d: c.d, route: c.route, pos: v.pos.toArray(), vel: v.vel.toArray(),
    bodyVelocity: v.body.linvel(), bodyAngularVelocity: v.body.angvel(),
    grounded: v.grounded, up: v.up.y, hp: c.hp, driverAlive: c.crew.driver.alive,
    input: { ...v.input }, boost: v.boosting, pursuitBoost: c.ai.pursuitBoost,
    tank: v.nitro, tankMax: v.nitroMax, rechargeLocked: v.nitroRechargeLocked,
    poseRevision: v.poseRevision, playerPoseRevision: p.veh.poseRevision,
    needsRelease: v.nitroNeedsRelease, attack: c.ai.atk ? { ...c.ai.atk } : null,
    desiredSpeed: c.ai._lastVDes, curveLimit: c.ai._curveLimit,
    playerS: p.s, playerD: p.d, playerRoute: p.route, playerSpeed: p.veh.vf,
    playerPos: p.veh.pos.toArray(), playerVelocity: p.veh.vel.toArray(), playerBodyVelocity: p.veh.body.linvel(),
    playerGrounded: p.veh.grounded, playerUp: p.veh.up.y,
    loadedEnemy: f.st.groundReady(c.s, c.route), loadedPlayer: f.st.groundReady(p.s, p.route),
    projectedEnemy: f.sim.roadQuery.projectDriving(v.pos.x, v.pos.z, c.s, 60, {}),
    projectedPlayer: f.sim.roadQuery.projectDriving(p.veh.pos.x, p.veh.pos.z, p.s, 60, {}),
    attackCooldown: c.ai.atkCd,
    damageBy: { ...sim.stats.damageBy } };
}
function run(f, seconds, { throttle = .65, nitro = false, until } = {}) {
  assert.equal(f.car.ai, f.brain, 'retain the Director-created brain');
  const rows = [];
  for (let i = 0; i < Math.ceil(seconds / DT); i++) {
    driveTarget(f, throttle, nitro);
    const before = f.recordSteps ? rawState(f) : null, eventFrom = f.sim.events.length, intentFrom = f.driveIntents.length;
    f.sim.step(DT);
    if (f.recordSteps) {
      const after = rawState(f);
      f.raw.push({ sequence: f.raw.length, requestedDt: DT, effectiveDt: after.time - before.time, before, after,
        eventFrom, eventTo: f.sim.events.length, intentFrom, intentTo: f.driveIntents.length });
    }
    if (i % 12 === 0) rows.push(state(f));
    if (until?.(f)) { rows.push(state(f)); break; }
    if (f.player.exploded || f.car.exploded) break;
  }
  if (f.scene) assert.ok(rows.every(r => r.s >= f.scene.from && r.playerS >= f.scene.from
    && r.s <= f.scene.to - 220 && r.playerS <= f.scene.to - 220),
    `actual travel exceeded the selected feature-free scene budget: ${diagnostic(f, rows)}`);
  if (f.scene) assert.ok(rows.every(r => r.route === null && r.playerRoute === null)
    && f.car.route === null && f.player.route === null,
    `positive main-road fixture entered an actual branch: ${diagnostic(f, rows)}`);
  return rows;
}
function diagnostic(f, rows) { return JSON.stringify({ scene: f.scene, last: state(f), contacts: f.contacts,
  ramDamage: f.ramDamage, aiUpdates: f.aiUpdates.slice(-12), driveIntents: f.driveIntents.slice(-12),
  events: f.sim.events.slice(-24), rows: rows.slice(-30) }); }
function finiteSupported(rows) {
  return rows.every(r => r.pos.every(Number.isFinite) && r.vel.every(Number.isFinite)
    && Math.abs(r.input.steer) <= 1 && r.input.throttle >= 0 && r.input.throttle <= 1
    && r.input.brake >= 0 && r.input.brake <= 1 && r.tank >= 0 && r.tank <= r.tankMax + 1e-8);
}


export { fixture, run, state, diagnostic, finiteSupported, supportedGround, findNaturalScene,
  contactGeometry, physicalContact, pairedCrash, rawState };
