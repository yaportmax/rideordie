// Whole production modules and shipped geometry. These are CPU ownership/
// ordering controls; deferred warm completion is not a native GPU measurement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, countdownRun, selectedJob, flush } from './helpers/world_tunnel_fixture.mjs';
import { CHUNK_LEN } from '../src/world/terrain_gen.js';
import { START_TUNNEL_TIMEOUT_MS } from '../src/game/run.js';
import { Game } from '../src/game/game.js';

test('long tunnel/bridge structural owners win by span; finished or blocked owners retain normal priority', async t => {
  for (const type of ['tunnel', 'bridge']) {
    const fx = await fixture(t, [{ type, s0: 80, s1: 576, rock: false }]);
    const near = fx.arrive(1, 2), owner = fx.arrive(6, 2); fx.dress.s = 100;
    assert.equal(selectedJob(fx.dress), owner);
    owner.step = 3; assert.equal(selectedJob(fx.dress), near);
    owner.step = 2; owner._blockedUntil = Infinity; assert.equal(selectedJob(fx.dress), near);
  }
});

test('countdown requires the real shipped tunnel body, warm completion and rebuild, even after scatter bypass', async t => {
  const fx = await fixture(t), log = [], run = countdownRun(fx, log);
  fx.arrive(0, 8); run.startWaitT = 6.5;
  run._updateCountdown(.5, run.player);
  assert.equal(run.player.held, true); assert.equal(run.started, false); assert.equal(run.countdown, .2);
  const owner = Math.floor(fx.road.features[0].s1 / CHUNK_LEN), ch = fx.arrive(owner);
  fx.dress._runStep(ch);
  assert.ok(fx.structure.bodies.has('tunnel:800')); assert.ok(ch.lists.get('tunnel_mid_10m').n > 10);
  assert.equal(fx.readiness().reason, 'tunnel-warm'); fx.rebuild();
  run._updateCountdown(.5, run.player); assert.equal(run.player.held, true);
  for (const warm of fx.warms) warm.resolve(); await flush();
  assert.equal(fx.readiness().state, 'pending', 'completion callback alone cannot claim rebuilt instances');
  fx.rebuild(); assert.equal(fx.readiness().state, 'ready');
  assert.equal(fx.dress.idle, false, 'unrelated scatter still awaits work');
  // Destroy the actual Rapier tunnel body after visual readiness. A stale
  // cached groundOk must never authorize this missing physical structure.
  fx.structure.hook({ type: 'remove', id: 'tunnel:800' }); run.groundOk = true;
  run._updateCountdown(.5, run.player);
  assert.equal(run.player.held, true); assert.equal(run.started, false);
  assert.equal(run.startupError.detail.reason, 'tunnel-collider');
  assert.equal(run.summary, undefined); assert.equal(run.over, false);
  assert.deepEqual(log.filter(event => event[0] === 'net'), [['net', 'abort']]);
  assert.equal(log.some(event => event[0] === 'release' || event[0] === 'start'), false);
});

test('actual startup preparation consumes asynchronous arrivals and warming before releasing held countdown', { timeout: 8000 }, async t => {
  const fx = await fixture(t), run = countdownRun(fx);
  t.after(() => { run.disposed = true; });
  let resolveWarmBegan;
  const warmBegan = new Promise(resolve => { resolveWarmBegan = resolve; });
  const originalWarm = fx.dress.pool.warmer; let allowWarm = false;
  fx.dress.pool.warmer = meshes => {
    const pending = originalWarm(meshes);
    if (allowWarm) fx.warms.at(-1).resolve();
    resolveWarmBegan(); return pending;
  };
  let replies = 0, prepared = false;
  run.streamer.update = () => { if (++replies === 2) fx.arrive(Math.floor(fx.road.features[0].s1 / CHUNK_LEN)); };
  const preparation = run._prepareStartTunnels(40).then(() => { prepared = true; });
  await warmBegan;
  assert.ok(replies >= 2); assert.equal(prepared, false); assert.equal(run.player.held, true);
  assert.ok(fx.structure.bodies.has('tunnel:800'));
  allowWarm = true; for (const warm of fx.warms) warm.resolve(); await preparation;
  assert.equal(fx.readiness().state, 'ready'); assert.equal(run.started, false); assert.equal(run.player.held, true);
  run.startWaitT = 7; run._updateCountdown(.5, run.player);
  assert.equal(run.started, true); assert.equal(run.player.held, false);
});

test('missing tunnel geometry rejects actual Game startup through cleanup without creating a life', async t => {
  const fx = await fixture(t); fx.kit.assets.set('tunnel_mid_10m', null);
  const ch = fx.arrive(Math.floor(fx.road.features[0].s1 / CHUNK_LEN)); fx.dress._runStep(ch);
  assert.ok(ch.done.has('feat:tunnel:800'), 'optional scenery skipping is not physical readiness');
  assert.equal(fx.readiness().reason, 'missing-tunnel-asset');
  const run = countdownRun(fx), log = [], game = Object.create(Game.prototype);
  Object.assign(game, { _runGeneration: 1, prewarm: async () => {},
    fade: value => log.push(['fade', value]), _createRun: () => run, mode: 'garage' });
  run.g = game; run.init = () => run._prepareStartTunnels(40);
  run.dispose = () => { run.disposed = true; log.push(['dispose']); };
  await assert.rejects(game._startRun({}, 1, null), error => error.code === 'tunnel-startup');
  assert.equal(game.run, undefined); assert.equal(game.mode, 'garage');
  assert.equal(run.player.held, true); assert.equal(run.started, false); assert.equal(run.summary, undefined);
  assert.deepEqual(log, [['dispose'], ['fade', 0]]);
});

test('a stalled tunnel countdown is bounded, aborts once and never creates defeat or summary', async t => {
  const fx = await fixture(t), log = [], run = countdownRun(fx, log);
  run.startWaitT = 7; run.startTunnelWaitT = START_TUNNEL_TIMEOUT_MS / 1000 - .1;
  run._updateCountdown(.2, run.player); run._updateCountdown(.2, run.player);
  assert.equal(run.player.held, true); assert.equal(run.started, false); assert.equal(run.finished, true);
  assert.equal(run.over, false); assert.equal(run.summary, undefined);
  assert.equal(run.startupError.detail.reason, 'tunnel-timeout');
  assert.deepEqual(log.filter(event => event[0] === 'net'), [['net', 'abort']]);
});

test('changing the initializer generation stops actual worker/dressing pumping before a new life', async t => {
  const fx = await fixture(t), run = countdownRun(fx); let pumps = 0;
  run.streamer.update = () => { pumps++; run.g._runGeneration = 2; };
  await run._prepareStartTunnels(40);
  assert.equal(pumps, 1); assert.equal(run.player.held, true); assert.equal(run.started, false);
  assert.equal(run.finished, false); assert.equal(run.summary, undefined);
});
