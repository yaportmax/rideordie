import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.js';
import { SyncGround } from '../src/sim/sync_ground.js';
import { RAPIER, COLLIDER_LABELS, setColliderLabel, getColliderLabel, removeBody } from '../src/sim/physics.js';

test('campaign streaming and repeated lives keep collider labels bounded and free them on teardown', async () => {
  for (let run = 0; run < 2; run++) {
    const sim = await new Sim({ seed: 11 + run }).init(), ground = new SyncGround(sim); sim.setGround(ground);
    try {
      for (const s of [40, 2000, 41000, 60000, 61000]) {
        ground.update(s); let count = 0;
        sim.world.forEachCollider((collider) => { count++; assert.ok(getColliderLabel(sim.world, collider.handle)); });
        assert.equal(COLLIDER_LABELS.size, count, 'departed road chunks must not retain labels at ' + s);
        assert.ok(count <= 22);
      }
    } finally { sim.dispose(); }
    assert.equal(ground.chunks.size, 0); assert.equal(COLLIDER_LABELS.size, 0);
    assert.doesNotThrow(() => { ground.dispose(); sim.dispose(); });
  }
});

test('collider labels are scoped to the Rapier world and another world survives body/run removal', async () => {
  const a = await new Sim().init(), b = await new Sim().init();
  try {
    const ba = a.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), bb = b.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const ca = a.world.createCollider(RAPIER.ColliderDesc.ball(1), ba), cb = b.world.createCollider(RAPIER.ColliderDesc.ball(1), bb);
    assert.equal(ca.handle, cb.handle, 'the regression requires the real cross-world handle collision');
    setColliderLabel(a.world, ca, 'ramp'); setColliderLabel(b.world, cb, 'terrain');
    assert.equal(getColliderLabel(a.world, ca.handle), 'ramp'); assert.equal(getColliderLabel(b.world, cb.handle), 'terrain');
    removeBody(a.world, ba);
    assert.equal(getColliderLabel(a.world, ca.handle), undefined);
    assert.equal(getColliderLabel(b.world, cb.handle), 'terrain'); assert.equal(COLLIDER_LABELS.get(cb.handle), 'terrain');
    a.dispose();
    assert.equal(getColliderLabel(b.world, cb.handle), 'terrain'); assert.equal(COLLIDER_LABELS.get(cb.handle), 'terrain');
    const unlabelled = b.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    b.world.createCollider(RAPIER.ColliderDesc.ball(.5), unlabelled);
    removeBody(b.world, unlabelled); assert.equal(getColliderLabel(b.world, cb.handle), 'terrain');
  } finally { a.dispose(); b.dispose(); }
  assert.equal(COLLIDER_LABELS.size, 0);
});

test('removing streamed hazard bodies clears all their own collider labels', async () => {
  const sim = await new Sim().init();
  try {
    const feature = { type: 'ramp', s0: 500, s1: 514, big: false };
    sim.road.featuresIn = () => [feature]; sim.hazards._sync(sim, 500);
    const record = sim.hazards.active.get(feature), collider = record.bodies[0].collider(0), handle = collider.handle;
    assert.equal(getColliderLabel(sim.world, handle), 'ramp');
    sim.road.featuresIn = () => []; sim.hazards._sync(sim, 2000);
    assert.equal(sim.hazards.active.size, 0); assert.equal(getColliderLabel(sim.world, handle), undefined);
    assert.equal(COLLIDER_LABELS.has(handle), false);
  } finally { sim.dispose(); }
});
