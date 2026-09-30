import test from 'node:test';
import assert from 'node:assert/strict';

let Sim, DT, SyncGround, COLLIDER_LABELS;
let missing = false;
try {
  ({ Sim, DT } = await import('../src/sim/sim.js'));
  ({ SyncGround } = await import('../src/sim/sync_ground.js'));
  ({ COLLIDER_LABELS } = await import('../src/sim/physics.js'));
} catch (e) {
  if (e.code !== 'ERR_MODULE_NOT_FOUND' || !e.message.includes('@dimforge/rapier3d-compat') || process.env.CI) throw e;
  missing = true;
}

test('real physics holds countdown, drives on streamed terrain, heals, and frees a finished life', { skip: missing && 'Rapier is not installed in this workspace' }, async () => {
  const sim = await new Sim({ seed: 7 }).init();
  try {
    const ground = new SyncGround(sim); sim.setGround(ground); ground.update(40);
    const car = sim.spawnCar('truck_t1', { kind: 'player', s: 40, hold: true });
    sim.director.enabled = false;
    assert.equal(ground.groundReady(40), true);
    const before = { ...car.veh.body.translation() };
    car.veh.input.throttle = 1;
    for (let i = 0; i < 240; i++) sim.step(DT);
    assert.equal(car.held, true);
    assert.equal(sim.time, 0);
    assert.deepEqual({ ...car.veh.body.translation() }, before);
    assert.equal(sim.useMedkit(), false);

    sim.releaseCar(car); sim.start();
    for (let i = 0; i < 600; i++) sim.step(DT);
    assert.ok(sim.time > 4.99);
    assert.ok(car.s > 50, `truck made no progress: ${car.s}`);
    assert.ok(car.veh.speed > 2);
    for (const n of Object.values(car.veh.body.translation())) assert.ok(Number.isFinite(n));
    assert.equal(car.exploded, false);
    car.crew.driver.hp = car.crew.driver.max * 0.2;
    car.crew.gunner.hp = car.crew.gunner.max * 0.4;
    car.hp = car.maxHp * 0.8;
    assert.equal(sim.useMedkit(), true);
    assert.ok(car.crew.driver.hp > car.crew.driver.max * 0.79);
    assert.equal(car.crew.gunner.hp, car.crew.gunner.max);
    assert.ok(car.hp <= car.maxHp);

    sim.explodeCar(car, 'test', -1);
    assert.equal(sim.useMedkit(), false);
    for (let i = 0; i < 430; i++) sim.step(DT);
    assert.equal(sim.state, 'over');
  } finally { sim.dispose(); }
  assert.equal(sim.world, null);
  assert.equal(sim.eventQueue, null);
  assert.equal(sim.cars.size, 0);
  assert.equal(COLLIDER_LABELS.size, 0);
  assert.doesNotThrow(() => sim.dispose());
});
