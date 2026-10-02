import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DT } from '../src/sim/sim.js';
import { GROUPS, RAPIER, removeBody } from '../src/sim/physics.js';
import { genRoadChunk, genDrivingBranchChunk } from '../src/world/terrain_gen.js';
import { branchPointAt } from '../src/world/driving_plan.js';

// Controlled collision-fixture scope: actual generated fine main/branch strips,
// actual vehicle/wheel forces and actual Hazards.update. Encounter systems and
// hazard sync are omitted during settling, then the exact authority hazard
// boundary runs once against an explicitly placed main-road feature. No native
// renderer/worker/campaign/performance claim follows from these CPU cases.
async function fixture({ branch = false, u = .5, d = 0, s = 120 } = {}) {
  const sim = await new Sim({ seed: 1 }).init(), floors = [];
  try {
    sim.director.enabled = false;
    sim.systems = sim.systems.filter(system => system !== sim.hazards);
    const route = branch ? sim.road.ensureDrivingBranches().find(b => b.biome === 'desert') : null;
    if (branch) assert.ok(route, 'Actual seed1 qualified desert branch');
    if (route) s = route.s0 + (route.s1 - route.s0) * u;
    for (let c = Math.floor((s - 45) / 96); c <= Math.floor((s + 45) / 96); c++) {
      const add = data => {
        const rb = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...data.anchor));
        sim.world.createCollider(RAPIER.ColliderDesc.trimesh(data.positions, Uint32Array.from(data.indices)).setCollisionGroups(GROUPS.world).setFriction(.9), rb);
        floors.push(rb);
      };
      add(genRoadChunk(sim.road, sim.seed, c));
      if (route) for (const data of genDrivingBranchChunk(sim.road, sim.seed, c)) add(data);
    }
    const car = sim.spawnCar('truck_t2', { kind: 'player', s, d });
    if (route) {
      const p = branchPointAt(sim.road, route, s, d, {}), v = car.veh;
      v.body.setTranslation({ x: p.x, y: p.y + v.restComHeight + .05, z: p.z }, true);
      v.body.setRotation({ x: 0, y: Math.sin(p.th / 2), z: 0, w: Math.cos(p.th / 2) }, true);
      v.readState();
    }
    // S/brake held at rest engages the game's reverse drive. A handbrake holds
    // the ordinary wheels for settling without driving out of the test lane.
    car.veh.setInput({ throttle: 0, brake: 0, steer: 0, nitro: false, handbrake: true });
    sim.start();
    for (let i = 0; i < 180; i++) sim.step(DT);
    assert.ok(car.veh.grounded >= 2, 'Actual wheel rays have settled on physical asphalt');
    assert.equal(car.veh.reversing, false, 'Physical setup did not secretly drive backwards');
    assert.equal(car.hp, car.maxHp, 'Controlled physical setup has intact hull');
    const main = sim.roadQuery.nearest(car.veh.pos.x, car.veh.pos.z, car.s, 90, {});
    sim.tick = Math.floor(sim.tick / 30) * 30 + 2; // even hazard step, no resync replacing the explicit feature
    sim.drainEvents();
    return { sim, car, route, main, close() { for (const rb of floors) removeBody(sim.world, rb); sim.dispose(); } };
  } catch (e) { for (const rb of floors) removeBody(sim.world, rb); sim.dispose(); throw e; }
}

function padAt(sim, s, lane) {
  const feature = { type: 'boost', s0: s - 6, s1: s + 6, lane };
  sim.hazards.active.set(feature, sim.hazards._build(sim, feature));
  return feature;
}
function pulse(sim, car) {
  const before = { velocity: { ...car.veh.body.linvel() }, nitro: car.veh.nitro, time: car.boostPadT };
  sim.hazards.update(DT, sim);
  const after = { velocity: { ...car.veh.body.linvel() }, nitro: car.veh.nitro, time: car.boostPadT };
  return { before, after, events: sim.drainEvents().filter(e => e.t === 'boostPad') };
}
function assertBoost(result, car) {
  assert.equal(result.events.length, 1, 'One actual boost event');
  assert.equal(result.events[0].id, car.id);
  const delta = ['x', 'y', 'z'].map(axis => result.after.velocity[axis] - result.before.velocity[axis]);
  const expected = [car.veh.fwd.x * 9, 0, car.veh.fwd.z * 9];
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(delta[i] - expected[i]) < .005, 'Actual Rapier forward9m/s pad impulse');
  assert.ok(Math.abs(result.after.nitro - Math.min(car.veh.nitroMax, result.before.nitro + .6)) < .0001, 'Authored nitro top-up remains bounded');
}

test('actual main-road pad boosts on all three drawn lanes with the ordinary impulse and cooldown', async () => {
  for (const lane of [-1, 0, 1]) {
    const f = await fixture({ d: lane * 3.5 });
    try {
      assert.equal(f.car.route, null);
      assert.ok(Math.abs(f.main.d - lane * 3.5) < .1, 'Physical car stands on the actual drawn lane');
      padAt(f.sim, f.main.s, lane); f.car.veh.nitro = .2;
      const first = pulse(f.sim, f.car); assertBoost(first, f.car);
      assert.equal(first.after.time, f.sim.time);
      const second = pulse(f.sim, f.car);
      assert.deepEqual(second.after, second.before, 'Remaining on a pad does not grant another impulse before cooldown');
      assert.equal(second.events.length, 0);
    } finally { f.close(); }
  }
});

test('a physically separated branch cannot activate a main-road pad with matching original progress and local lane', async () => {
  const f = await fixture({ branch: true });
  try {
    assert.equal(f.car.route, f.route.id);
    assert.ok(Math.abs(f.car.d) < .15, 'Real branch-local centre lane');
    assert.ok(Math.abs(f.main.d) > 20, 'Actual world position is well outside the main pad');
    padAt(f.sim, f.car.s, 0); f.car.veh.nitro = .2;
    const result = pulse(f.sim, f.car);
    assert.deepEqual(result.after, result.before, 'No remote impulse, nitro grant or cooldown mutation');
    assert.equal(result.events.length, 0);
  } finally { f.close(); }
});

test('a branch near its physical join still gets boost when it really overlaps the main-road pad', async () => {
  const f = await fixture({ branch: true, u: .1 });
  try {
    assert.equal(f.car.route, f.route.id, 'The eligible physical overlap is still identified as a branch');
    // A qualified inside bend can fork to either side. The actual branch's
    // main-road side determines which drawn outer lane overlaps its join.
    // V1 incorrectly assumed every near-join branch was on the left.
    const lane = f.route.side;
    assert.ok(lane === -1 || lane === 1, 'Actual qualified branch has a signed main-road side');
    assert.ok(Math.abs(f.main.d - lane * 3.5) < 1.62,
      `Actual world centre is inside its visible outer pad: ${JSON.stringify({ side: lane, mainD: f.main.d, branchD: f.car.d, mainS: f.main.s, branchS: f.car.s, pos: f.car.veh.pos.toArray() })}`);
    assert.ok(Math.abs(f.car.d) < .2, 'Branch-local lane differs from the main pad lane');
    padAt(f.sim, f.main.s, lane); f.car.veh.nitro = .2;
    assertBoost(pulse(f.sim, f.car), f.car);
  } finally { f.close(); }
});

test('the old main-road phantom lane and positions outside the drawn pad do not grant boost', async () => {
  const f = await fixture({ d: .5 });
  try {
    assert.ok(f.main.d > .3 && f.main.d < .7);
    padAt(f.sim, f.main.s, 1);
    const result = pulse(f.sim, f.car);
    assert.deepEqual(result.after, result.before);
    assert.equal(result.events.length, 0, 'Visible left pad starts at main d1.88, not the former invisible d0..4 trigger');
  } finally { f.close(); }
});

test('matching horizontal pad coordinates cannot boost a body above its actual road surface', async () => {
  const f = await fixture();
  try {
    padAt(f.sim, f.main.s, 0);
    // Explicit stale-grounded-sample stress after a controlled upward placement.
    // The regular positive cases above obtain grounded state from real wheel rays.
    const p = f.car.veh.body.translation();
    f.car.veh.body.setTranslation({ x: p.x, y: p.y + 4, z: p.z }, true); f.car.veh.readState();
    assert.ok(f.car.veh.grounded >= 2, 'Previous actual wheel contact sample is intentionally stale');
    const result = pulse(f.sim, f.car);
    assert.deepEqual(result.after, result.before); assert.equal(result.events.length, 0);
  } finally { f.close(); }
});

test('main-road breakable barricade contact remains physical and does not damage a distant matching branch lane', async () => {
  for (const branch of [false, true]) {
    const f = await fixture({ branch });
    try {
      const feature = { type: 'roadblock', s0: f.car.s - 3.5, s1: f.car.s + 10, gap: 0, seed: 1 };
      const barricade = { i: 0, s: f.car.s, d: 0, hw: .7, broken: false };
      f.sim.hazards.active.set(feature, { bodies: [], barricades: [barricade] });
      const hp = f.car.hp;
      f.sim.hazards.update(DT, f.sim);
      const breaks = f.sim.drainEvents().filter(e => e.t === 'barrierBreak');
      assert.equal(barricade.broken, !branch);
      assert.equal(breaks.length, branch ? 0 : 1);
      if (branch) assert.equal(f.car.hp, hp, 'Remote main-road barricade cannot inflict3% hull damage');
      else assert.ok(Math.abs(f.car.hp - (hp - f.car.maxHp * .03)) < .001, 'Ordinary physical main-road barricade behavior retained');
    } finally { f.close(); }
  }
});
