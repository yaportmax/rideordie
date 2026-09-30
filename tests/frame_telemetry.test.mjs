import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../src/game/game.js';

test('a long refresh remains visible in frame telemetry while simulation delta stays bounded', t => {
  const hadWindow = Object.hasOwn(globalThis, 'window'), previousWindow = globalThis.window;
  globalThis.window = { performance: globalThis.performance };
  t.after(() => { if (hadWindow) globalThis.window = previousWindow; else delete globalThis.window; });
  const deltas = [], game = Object.create(Game.prototype);
  Object.assign(game, {
    mode: 'run', paused: false, frames: 0, last: 1000, camera: new THREE.PerspectiveCamera(),
    input: { poll() {}, endFrame() {}, hit: () => false, edge: () => false, solo: () => ({ driver: {}, gunner: {} }) },
    run: { role: 'solo', humanGunner: false, started: true, over: false, states: new Map(), hud2: {}, wv: {}, update(dt) { deltas.push(dt); } },
    sky: { setLook() {}, update() {} }, lampLights: { update() {} },
    post: { adaptResolution() {}, setLook() {}, render() {}, stats: { calls: 42, triangles: 1234 } },
    hud: { update() {} }, _lockEl: { style: {} },
    perf: { sim: 0, render: 0, frame: 16.7, fps: 60, worst: 0 },
  });
  game.frame(1500);
  assert.equal(deltas[0], 0.05, 'a refresh stall must not create a huge physics delta');
  assert.equal(game.perf.worst, 500, 'the same stall must not be reported as a 50ms frame');
  assert.ok(game.perf.fps < 30, 'frame smoothing must include the real missed time');
  assert.equal(game.perf.calls, 42); assert.equal(game.perf.tris, 1234);
  game.frame(1500 + 1000 / 60);
  assert.ok(Math.abs(deltas[1] - 1 / 60) < 1e-12);
  assert.ok(game.perf.worst > 490, 'worst-frame decay must still show the preceding stall');
});
