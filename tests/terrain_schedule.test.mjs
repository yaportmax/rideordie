import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainStreamer } from '../src/world/terrain.js';
import { CHUNK_LEN } from '../src/world/terrain_gen.js';

function mock() {
  const posts = [], worker = { busy: 0, postMessage: m => posts.push(m) };
  const t = Object.assign(Object.create(TerrainStreamer.prototype), {
    chunks: new Map(), pending: new Set(), workers: [worker], _want: [], _wantPool: [],
    _scheduleS: NaN, _scheduleLo: Infinity, _scheduleHi: -Infinity, _scheduleDirty: true,
    roadMat: { userData: { uniforms: { uNight: { value: -1 }, uRoadWet: { value: -1 } } } },
    cover: { calls: 0, update() { this.calls++; } },
    road: { calls: 0, sample(s, out) { this.calls++; return Object.assign(out, { x: s, y: 5, z: 0 }); } },
    floor: { position: { set() {} }, calls: 0, updateMatrix() { this.calls++; } }, world: null,
  });
  return { t, posts, worker };
}
const expected = s => {
  const rows = [];
  for (let c = Math.floor((s - 420) / CHUNK_LEN); c <= Math.floor((s + 2100) / CHUNK_LEN); c++) {
    const centre = (c + .5) * CHUNK_LEN, dist = Math.abs(centre - s), effective = centre < s ? dist * 1.6 : dist;
    rows.push({ c, lod: effective < 320 ? 0 : effective < 850 ? 1 : 2, dist });
  }
  return rows.sort((a, b) => a.dist - b.dist).map(({ c, lod }) => ({ c, lod }));
};
const actual = t => t._want.map(({ c, lod }) => ({ c, lod }));

test('stationary terrain skips sorting, reuses records and retries when a worker frees its queue', () => {
  const { t, posts, worker } = mock();
  t.update(500);
  const pool = [...t._wantPool], first = posts[0]; let sorts = 0;
  t._want.sort = (...args) => { sorts++; return Array.prototype.sort.apply(t._want, args); };
  for (let i = 0; i < 30; i++) t.update(500);
  assert.equal(sorts, 0); assert.equal(posts.length, 2); assert.equal(t.cover.calls, 31); assert.equal(t.floor.calls, 31);
  // Even a discarded stale response must free the queue and wake the scheduler.
  t._onMsg2(worker, { type: 'chunk', key: first.key, chunk: -100 });
  t.update(500);
  assert.equal(posts.length, 3); assert.equal(sorts, 0); assert.deepEqual(t._wantPool, pool);
});

test('cached terrain requests match exhaustive scheduling at exact front, rear, window and priority boundaries', () => {
  const { t } = mock();
  const probes = new Set([-100000, -6000, -420, -96, -1, 0, 500]);
  for (let c = -50; c < 50; c++) {
    const centre = (c + .5) * CHUNK_LEN;
    for (const p of [centre - 320, centre - 850, centre + 320 / 1.6, centre + 850 / 1.6, c * CHUNK_LEN + 420, c * CHUNK_LEN - 2100, c * CHUNK_LEN / 2]) {
      for (const delta of [-1e-6, 0, 1e-6]) probes.add(p + delta);
    }
  }
  const values = [...probes].sort((a, b) => a - b);
  for (const s of [...values, ...values.reverse()]) { t.update(s); assert.deepEqual(actual(t), expected(s), 's=' + s); }
});

test('signed scheduling windows stay bounded at exact negative window and LOD crossings', () => {
  const { t, worker } = mock();
  for (const c of [-1042, -63, -2, -1, 0]) {
    const centre = (c + .5) * CHUNK_LEN;
    for (const boundary of [c * CHUNK_LEN + 420, c * CHUNK_LEN - 2100,
      centre - 320, centre - 850, centre + 320 / 1.6, centre + 850 / 1.6]) {
      for (const delta of [-1e-6, 0, 1e-6]) {
        const s = boundary + delta;
        worker.busy = 0; t.pending.clear(); t._scheduleDirty = true;
        t.update(s);
        assert.deepEqual(actual(t), expected(s), `signed exact boundary ${s}`);
        const lo = Math.floor((s - 420) / CHUNK_LEN), hi = Math.floor((s + 2100) / CHUNK_LEN);
        assert.equal(t._want.length, hi - lo + 1);
        assert.ok(t._want.length <= 29, 'reverse distance cannot grow the streaming window');
        assert.deepEqual(t._want.map(row => row.c).sort((a, b) => a - b),
          Array.from({ length: hi - lo + 1 }, (_, index) => lo + index));
      }
    }
  }
});

test('collision boundaries and floor, cover and night still update every frame inside a cached scheduling interval', () => {
  const { t } = mock(); let made = 0, removed = 0;
  t.world = { removeRigidBody() { removed++; } };
  t._trimesh = () => ({ rb: ++made });
  const rec = { lod: 1, colT: null, colR: null, tCol: {}, rCol: {} };
  t.chunks.set(10, rec); // Centre 1008; collider enters strictly after s=608.
  t.update(607.99); assert.equal(made, 0);
  const scheduleS = t._scheduleS;
  t.update(608); assert.equal(made, 0);
  t.roadMat.userData.uniforms.uNight.value = -999;
  t.update(608.01); assert.equal(made, 2); assert.equal(t._scheduleS, scheduleS);
  assert.notEqual(t.roadMat.userData.uniforms.uNight.value, -999);
  assert.equal(t.cover.calls, 3); assert.equal(t.floor.calls, 3); assert.equal(t.road.calls, 9);
  t.update(1337.99); assert.equal(removed, 0);
  t.update(1338); assert.equal(removed, 2);
});

test('terrain teardown is idempotent and queued responses cannot recreate meshes or colliders', () => {
  const { t, worker } = mock(); let terminated = 0, freed = 0;
  worker.terminate = () => { terminated++; }; worker.onmessage = () => {}; worker.onerror = () => {};
  t.cover.dispose = () => { freed++; }; t.floor.geometry = { dispose() { freed++; } };
  t.scene = { remove() { freed++; } };
  t.update(500); t.dispose();
  assert.equal(worker.onmessage, null); assert.equal(worker.onerror, null);
  assert.equal(t.workers.length, 0); assert.equal(t.pending.size, 0); assert.equal(t._want.length, 0); assert.equal(t._wantPool.length, 0);
  // Without the disposed guard, even a stale response can enter chunk creation.
  assert.doesNotThrow(() => t._onMsg2(worker, { type: 'chunk', key: '5:0', chunk: 5, lod: 0 }));
  assert.equal(t.chunks.size, 0); const floorCalls = t.floor.calls;
  t.update(501); assert.equal(t.floor.calls, floorCalls); t.dispose();
  assert.equal(terminated, 1); assert.equal(freed, 3);
});
