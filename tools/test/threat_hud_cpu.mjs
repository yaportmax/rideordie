// CPU-only draw-call comparison against an earlier ThreatHUD source revision.
// node tools/test/threat_hud_cpu.mjs [baseline-git-ref] (defaults to the pre-change revision)
// No browser, renderer, game, or GPU is started. A fake canvas records exact 2D API calls.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { ThreatHUD } from '../../src/ui/threat_hud.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ref = process.argv[2] || '4e611462cb186f7a9e777745a580d22ff317f8f1';
let source = execFileSync('git', ['show', `${ref}:src/ui/threat_hud.js`], { cwd: root, encoding: 'utf8' });
const allocations = { seenSets: 0, sectorRecords: 0 };
globalThis.__ThreatCountedSet = class extends Set { constructor() { super(); allocations.seenSets++; } };
globalThis.__threatRecord = (id, d) => { allocations.sectorRecords++; return { id, d }; };
source = source.replace("from 'three'", `from ${JSON.stringify(import.meta.resolve('three'))}`)
  .replace('const seen = new Set();', 'const seen = new globalThis.__ThreatCountedSet();')
  .replace('best.set(sector, { id: st.id, d: dist })', 'best.set(sector, globalThis.__threatRecord(st.id, dist))');
const { ThreatHUD: Baseline } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function fakeCanvas() {
  const c = { style: {}, trace: [], ink: false, clears: 0, remove() {} };
  const state = {}, stack = [];
  function reset() { Object.assign(state, { globalAlpha: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1 }); stack.length = 0; c.ink = false; }
  reset();
  let width = 300, height = 150;
  for (const name of ['width', 'height']) Object.defineProperty(c, name, {
    get: () => name === 'width' ? width : height,
    set: (value) => { if (name === 'width') width = value; else height = value; c.trace.push(['resize', name, value]); reset(); },
  });
  const methods = {};
  for (const name of ['clearRect', 'save', 'restore', 'translate', 'rotate', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fill', 'roundRect', 'rect', 'strokeText', 'fillText', 'measureText']) methods[name] = (...args) => {
    c.trace.push([name, ...args]);
    if (name === 'clearRect') { c.ink = false; c.clears++; }
    if (['stroke', 'fill', 'strokeText', 'fillText'].includes(name)) c.ink = true;
    if (name === 'save') stack.push({ ...state });
    if (name === 'restore') Object.assign(state, stack.pop());
    if (name === 'measureText') return { width: args[0].length * parseFloat(state.font.slice(4)) * 0.6 };
  };
  c.getContext = () => new Proxy(methods, {
    get: (target, name) => name in target ? target[name] : state[name],
    set: (_target, name, value) => { c.trace.push(['set', name, value]); state[name] = value; return true; },
  });
  return c;
}
globalThis.innerWidth = 2560; globalThis.innerHeight = 1440; globalThis.devicePixelRatio = 2;
globalThis.document = { createElement: fakeCanvas, body: { appendChild() {} } };
const before = new Baseline(), after = new ThreatHUD();
const records = after._sectorRecords?.slice();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 2, 0); camera.updateMatrixWorld(true);
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(0, 0, -12), exploded: false };
const enemy = (id, x, z, props = {}) => ({ id, kind: 'enemy', pos: new THREE.Vector3(x, 2, z), vel: new THREE.Vector3(), gunnerAlive: true, ...props });
let frames = 0, drawnFrames = 0, chevrons = 0, labels = 0, skippedClears = 0;
const phases = [];
function phase(name, count, setup) {
  const firstFrame = frames;
  for (let i = 0; i < count; i++) {
    const cfg = setup(i) || {}, states = cfg.states || new Map(), p = 'player' in cfg ? cfg.player : player;
    before.setVisible(cfg.visible !== false); after.setVisible(cfg.visible !== false);
    const priorInk = after.canvas.ink;
    before.canvas.trace = []; after.canvas.trace = [];
    before.update(cfg.dt || 1 / 60, camera, states, p, (st) => st.id === 9, cfg.layout);
    after.update(cfg.dt || 1 / 60, camera, states, p, (st) => st.id === 9, cfg.layout);
    const oldTrace = before.canvas.trace, newTrace = after.canvas.trace;
    const withoutClear = (trace) => trace.filter(([method]) => method !== 'clearRect');
    assert.deepEqual(withoutClear(newTrace), withoutClear(oldTrace), `${name} frame ${i}: changed drawing or context state`);
    const oldClears = oldTrace.filter(([method]) => method === 'clearRect').length;
    const newClears = newTrace.filter(([method]) => method === 'clearRect').length;
    assert.ok(newClears <= oldClears);
    if (oldClears > newClears) {
      assert.ok(!priorInk || newTrace.some(([method]) => method === 'resize'), `${name} frame ${i}: failed to erase previous drawing`);
      skippedClears += oldClears - newClears;
    }
    assert.equal(after.canvas.ink, before.canvas.ink, `${name} frame ${i}: canvas content differs`);
    assert.deepEqual([...after.blips], [...before.blips], `${name} frame ${i}: changed fading/selection`);
    assert.equal(after.t, before.t);
    const arrows = newTrace.filter(([method]) => method === 'save').length;
    if (arrows) drawnFrames++;
    chevrons += arrows; labels += newTrace.filter(([method]) => method === 'fillText').length;
    frames++;
  }
  phases.push({ name, frames: frames - firstFrame });
}
phase('idle', 120, () => ({}));
phase('all sectors and nearest replacements', 90, (i) => {
  camera.quaternion.identity(); camera.updateMatrixWorld(true);
  const states = new Map();
  for (let sector = -7; sector <= 7; sector++) {
    const a = sector * .42, d = 80 - Math.sin(i / 12) * 5;
    states.set(sector + 20, enemy(sector + 20, Math.sin(a) * d, -Math.cos(a) * d));
    states.set(sector + 40, enemy(sector + 40, Math.sin(a) * 40, -Math.cos(a) * 40, { intent: sector === 3 ? 'block' : null }));
    // Equal-distance later enemies must not replace the earlier sector winner.
    states.set(sector + 60, enemy(sector + 60, Math.sin(a) * 40, -Math.cos(a) * 40));
  }
  states.set(90, enemy(90, 0, 150)); states.set(91, enemy(91, 0, 20, { exploded: true }));
  return { states };
});
phase('moving rammer, boss and shooter with camera turn', 120, (i) => {
  camera.rotation.y = Math.sin(i / 19) * 1.4; camera.updateMatrixWorld(true);
  return { states: new Map([[1, enemy(1, Math.sin(i / 14) * 9, 18, { intent: 'ram' })], [9, enemy(9, -28, 12, { elite: true })], [3, enemy(3, 35, -12, { intent: 'shoot' })]]) };
});
phase('offscreen to onscreen fading', 150, (i) => {
  camera.quaternion.identity(); camera.updateMatrixWorld(true);
  return { states: new Map([[1, enemy(1, 0, i < 12 ? 20 : -40)]]) };
});
phase('despawn clears old content', 30, (i) => ({ states: i < 5 ? new Map([[3, enemy(3, 22, 10)]]) : new Map() }));
phase('hide show and missing player', 18, (i) => ({ states: new Map([[3, enemy(3, 22, 10)]]), visible: !(i >= 3 && i < 9), player: i >= 9 ? null : player }));
phase('exploded player', 12, (i) => ({ states: new Map([[3, enemy(3, 22, 10)]]), player: { ...player, exploded: i >= 4 } }));
phase('resize and cockpit ellipse', 25, (i) => {
  if (i === 8) { globalThis.innerWidth = 1600; globalThis.innerHeight = 900; globalThis.devicePixelRatio = 1; }
  if (i === 15) { globalThis.innerWidth = 2560; globalThis.innerHeight = 1440; globalThis.devicePixelRatio = 3; }
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  return { states: new Map([[3, enemy(3, 22, 10, { intent: 'block' })]]), layout: { cy: .37, rx: .36, ry: .18 } };
});
phase('final idle', 600, () => ({}));
if (records) assert.ok(records.every((record, i) => record === after._sectorRecords[i]), 'Sector records were replaced');
assert.ok(drawnFrames > 100 && labels > 100, 'Scenario did not exercise enough drawing');
assert.ok(skippedClears > 700, 'Expected idle/resize clear calls to be avoided');
console.log(JSON.stringify({ baselineRef: ref, frames, drawnFrames, chevrons, labels, baselineClearRectCalls: before.canvas.clears,
  optimizedClearRectCalls: after.canvas.clears, avoidedClearRectCalls: skippedClears, baselinePerFrameAllocations: allocations,
  reusedSectorRecords: records?.length || 0, drawAndContextCallsIdenticalExceptRedundantClears: true, phases }, null, 2));
before.dispose(); after.dispose();
delete globalThis.__ThreatCountedSet; delete globalThis.__threatRecord;
