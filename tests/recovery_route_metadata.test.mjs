import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sim } from '../src/sim/sim.js';
import { TerrainStreamer } from '../src/world/terrain.js';
import { genTerrainChunk, genRoadChunk, genDrivingBranchChunk } from '../src/world/terrain_gen.js';
import { HALF_ROAD } from '../src/data/biomes.js';

function supportedGround(sim, s) {
  const st = Object.create(TerrainStreamer.prototype);
  Object.assign(st, { world: sim.world, road: sim.road, seed: sim.road.seed, chunks: new Map(), group: new THREE.Group(), terrainMat: new THREE.MeshBasicMaterial(), roadMat: new THREE.MeshBasicMaterial(), pending: new Set(), stats: { built: 0 }, _sLast: s });
  for (let c = Math.floor((s - 110) / 96); c <= Math.floor((s + 110) / 96); c++) {
    st._onMsg2({ busy: 1 }, { type: 'chunk', key: `${c}:0`, chunk: c, lod: 0, t: genTerrainChunk(st.road, st.seed, c, 0), r: genRoadChunk(st.road, st.seed, c), b: genDrivingBranchChunk(st.road, st.seed, c) });
  }
  st.update = () => {};
  st.dispose = function() { for (const [c, rec] of this.chunks) this._dispose(c, rec); this.terrainMat.dispose(); this.roadMat.dispose(); };
  return st;
}

test('actual supported branch-to-main recovery clears route metadata before the next ground/AI consumers', async () => {
  const sim = await new Sim({ seed: 7 }).init(); sim.systems.length = 0; sim.state = 'run';
  const branch = sim.road.ensureDrivingBranches()[0], s = (branch.s0 + branch.s1) / 2;
  const st = supportedGround(sim, s); sim.setGround(st);
  try {
    const car = sim.spawnCar('truck_t1', { s, d: 0, kind: 'player' }), v = car.veh;
    const p = sim.road.drivingPointAt(s, 0, branch.id);
    v.body.setTranslation({ x: p.x, y: p.y + v.restComHeight + .15, z: p.z }, true); v.readState();
    const actual = sim.roadQuery.projectDriving(v.pos.x, v.pos.z, s, 60, {});
    car.s = actual.s; car.d = actual.d; car.route = actual.route; car.routeHalfWidth = actual.halfWidth;
    assert.equal(car.route, branch.id, 'initial cache comes from the actual occupied fork');
    assert.equal(car.routeHalfWidth, branch.width / 2);
    const hp = car.hp - 40; car.hp = hp;
    const revision = v.poseRevision || 0;
    sim.stats.cash = 234; sim.stats.distance = s + 77;
    // A controlled void placement exercises the production recovery boundary,
    // actual collider search, relocation, damage policy and cached metadata.
    v.body.setTranslation({ x: p.x, y: p.y - 500, z: p.z }, true); v.readState();
    sim._recoverOffroadFall(car);
    assert.equal(car.route, null); assert.equal(car.routeHalfWidth, HALF_ROAD);
    assert.ok(Math.abs(car.s - s) <= 60 && Math.abs(car.d) <= 2.7);
    assert.equal(v.poseRevision, (revision + 1) & 0xffff);
    assert.equal(car.hp, hp - car.maxHp * .04);
    for (const crew of Object.values(car.crew)) { assert.equal(crew.hp, car.hp); assert.equal(crew.max, car.maxHp); assert.equal(crew.alive, true); }
    assert.equal(sim.stats.cash, 234); assert.equal(sim.stats.distance, s + 77);
    assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 1);
    const gy = st.roadHeightAt(car.s, v.pos.x, v.pos.z, v.pos.y + 2);
    assert.ok(gy != null && Math.abs(v.pos.y - gy - v.restComHeight - .15) < .001);
    let routeArgument = 'unobserved'; const ready = st.groundReady;
    st.groundReady = function(progress, route) { routeArgument = route; return ready.call(this, progress, route); };
    sim._protectGround(car);
    assert.equal(routeArgument, null, 'next ground consumer immediately queries the relocated main strip');
    assert.equal(car.held, false); assert.equal(car._groundHold, undefined);
    assert.deepEqual(v.prevPos.toArray(), v.pos.toArray());
  } finally { sim.dispose(); }
});
