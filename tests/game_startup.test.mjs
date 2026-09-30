import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../src/game/game.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, makeRun) {
  const hadWindow = Object.hasOwn(globalThis, 'window'), previousWindow = globalThis.window;
  globalThis.window ??= { performance: globalThis.performance };
  t.after(() => { if (hadWindow) globalThis.window = previousWindow; else delete globalThis.window; });
  const game = Object.create(Game.prototype), events = [];
  Object.assign(game, {
    run: null, mode: 'garage', paused: false,
    input: { lastDevice: 'kbm', releaseLock() {}, reset() {} },
    hud: { setVisible(v) { events.push(['hud', v]); }, show() {}, hints() {} },
    post: { enabled: false, cut() {} },
    fade(to) { events.push(['fade', to]); },
    async _prewarmAssets() { events.push(['warm']); },
    _createRun(cfg) { return makeRun(cfg, events); },
  });
  return { game, events };
}
function life(id, events, init = async () => {}) {
  return { id, role: 'solo', humanDriver: true, humanGunner: true,
    async init() { events.push(['init', id]); await init(); },
    dispose() { events.push(['dispose', id]); },
  };
}

test('all starts await the same unfinished asset warm-up', async t => {
  const gate = deferred(), { game, events } = fixture(t, (cfg, log) => life(cfg.id, log));
  let warms = 0; game._prewarmAssets = async () => { warms++; await gate.promise; };
  const a = game.startRun({ id: 'a' }); await flush();
  const b = game.startRun({ id: 'b' }); await flush();
  assert.equal(warms, 1); assert.equal(events.some(e => e[0] === 'init'), false);
  gate.resolve();
  assert.equal(await a, null); assert.equal((await b).id, 'b');
  assert.equal(game.run.id, 'b'); assert.equal(game.mode, 'run');
  assert.deepEqual(events.filter(e => e[0] === 'init'), [['init', 'b']]);
});

test('a failed warm-up is shared and a later attempt can retry it', async t => {
  const gate = deferred(), { game } = fixture(t, () => {}); let calls = 0;
  game._prewarmAssets = async () => { calls++; if (calls === 1) await gate.promise; };
  const a = game.prewarm(), b = game.prewarm();
  assert.equal(a, b); const settled = Promise.allSettled([a, b]);
  gate.reject(new Error('asset failure'));
  assert.deepEqual((await settled).map(r => r.status), ['rejected', 'rejected']);
  await game.prewarm(); await game.prewarm(); assert.equal(calls, 2);
});

test('a cancelled initializer cleans up before the next life touches shared effects', async t => {
  const gate = deferred(); let owner = null;
  const { game, events } = fixture(t, (cfg, log) => {
    const run = life(cfg.id, log, async () => { if (cfg.id === 'a') await gate.promise; owner = cfg.id; });
    run.dispose = () => { log.push(['dispose', cfg.id]); assert.equal(owner, cfg.id); owner = null; };
    return run;
  });
  const a = game.startRun({ id: 'a' }); await flush();
  const b = game.startRun({ id: 'b' }); await flush();
  assert.deepEqual(events.filter(e => e[0] === 'init'), [['init', 'a']]);
  gate.resolve(); assert.equal(await a, null); await b;
  assert.deepEqual(events.filter(e => e[0] === 'init' || e[0] === 'dispose'), [['init', 'a'], ['dispose', 'a'], ['init', 'b']]);
  assert.equal(owner, 'b'); assert.equal(game.run.id, 'b');
});

test('an obsolete startup failure cannot fade or abort the replacement life', async t => {
  const gate = deferred(), { game, events } = fixture(t, (cfg, log) => life(cfg.id, log, async () => { if (cfg.id === 'a') await gate.promise; }));
  const a = game.startRun({ id: 'a' }); await flush();
  const b = game.startRun({ id: 'b' }); await flush();
  gate.reject(new Error('obsolete world failure'));
  assert.equal(await a, null); assert.equal((await b).id, 'b');
  assert.equal(events.some(e => e[0] === 'fade' && e[1] === 0), false);
});

test('leaving during initialization cannot publish a run or change the new screen', async t => {
  const gate = deferred(), { game, events } = fixture(t, (cfg, log) => life(cfg.id, log, () => gate.promise));
  const pending = game.startRun({ id: 'a' }); await flush();
  game.endRun(); game.mode = 'menu'; gate.resolve();
  assert.equal(await pending, null); assert.equal(game.run, null); assert.equal(game.mode, 'menu');
  assert.equal(events.some(e => e[0] === 'hud' && e[1] === true), false);
  assert.deepEqual(events.filter(e => e[0] === 'dispose'), [['dispose', 'a']]);
});

test('a current initialization failure cleans up, fades back, and permits retry', async t => {
  const { game, events } = fixture(t, (cfg, log) => life(cfg.id, log, async () => { if (cfg.id === 'a') throw new Error('world failure'); }));
  await assert.rejects(game.startRun({ id: 'a' }), /world failure/);
  assert.equal(game._pendingStart, null); assert.equal(game.run, null);
  assert.deepEqual(events.filter(e => e[0] === 'dispose'), [['dispose', 'a']]);
  assert.ok(events.some(e => e[0] === 'fade' && e[1] === 0));
  assert.equal((await game.startRun({ id: 'b' })).id, 'b');
});

function warmFixture() {
  const game = Object.create(Game.prototype), previous = { name: 'garage target' };
  let target = previous, face = 3, mip = 2;
  Object.assign(game, {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    sky: { setLook() {} },
    renderer: {
      getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
      setRenderTarget(next, nextFace = 0, nextMip = 0) { target = next; face = nextFace; mip = nextMip; },
      compileAsync: async () => {}, render() {},
    },
  });
  const group = new THREE.Group(), visible = new THREE.Mesh(), uncullable = new THREE.Mesh();
  uncullable.frustumCulled = false; group.add(visible, uncullable);
  const assertRestored = () => { assert.equal(target, previous); assert.equal(face, 3); assert.equal(mip, 2); };
  return { game, group, visible, uncullable, assertRestored };
}

test('shader warm-up restores the garage target before waiting on parallel compilation', async () => {
  const gate = deferred(), { game, group, assertRestored } = warmFixture(); let calls = 0, finishedFx = 0;
  game.renderer.compileAsync = async () => { if (++calls === 1) await gate.promise; };
  game.post = { async warm() { assertRestored(); } };
  game.fx = { prewarm() { return () => finishedFx++; } };
  const pending = game._warmScene(group); await flush();
  assert.equal(calls, 1); assertRestored();
  gate.resolve(); await pending;
  assert.equal(calls, 2); assert.equal(finishedFx, 1); assertRestored();
  assert.equal(group.parent, null);
});

test('a failed upload render restores culling, target and warm-up effects before starting play', async t => {
  t.mock.method(console, 'warn', () => {});
  const { game, group, visible, uncullable, assertRestored } = warmFixture();
  let targetDisposed = 0, finishedFx = 0, postWarmed = false;
  game.renderer.render = () => {
    assert.equal(visible.frustumCulled, false);
    game.renderer.getRenderTarget().addEventListener('dispose', () => targetDisposed++);
    throw new Error('upload failed');
  };
  game.fx = { prewarm() { return () => finishedFx++; } };
  game.post = { async warm() { postWarmed = true; } };
  await game._warmScene(group);
  assert.equal(visible.frustumCulled, true); assert.equal(uncullable.frustumCulled, false);
  assert.equal(targetDisposed, 1); assert.equal(finishedFx, 1); assert.equal(postWarmed, true);
  assertRestored(); assert.equal(group.parent, null);
});

test('an environment setup failure removes the warm-up group for a later retry', async () => {
  const { game, group, assertRestored } = warmFixture();
  game.sky.setLook = () => { throw new Error('environment unavailable'); };
  await assert.rejects(game._warmScene(group), /environment unavailable/);
  assert.equal(group.parent, null); assertRestored();
});
