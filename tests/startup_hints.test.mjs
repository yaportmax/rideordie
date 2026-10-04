// WORK-only actual-source test drafts. The author has not parsed or run them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { Input } from '../src/core/input.js';
import { Hud } from '../src/ui/hud.js';
import { startupHintLines } from '../src/ui/startup_hints.js';
import { canCaptureRun, isVictory } from '../src/game/run_status.js';

function install(t, values) {
  const previous = Object.keys(values).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
}

function fixture(t) {
  const win = new EventTarget(), doc = new EventTarget(), canvas = new EventTarget();
  let pads = [], nextTimer = 0, now = 0, pendingInit = null; const timers = new Map(), scheduled = [];
  const node = () => {
    const el = { style: {}, writes: 0, textContent: '', appendChild() {} }; let html = '';
    Object.defineProperty(el, 'innerHTML', { get: () => html, set(value) { html = value; el.writes++; } });
    return el;
  };
  doc.createElement = node; doc.pointerLockElement = null;
  install(t, {
    addEventListener: win.addEventListener.bind(win), document: doc,
    navigator: { getGamepads: () => pads }, window: {},
    setTimeout(fn, ms) { const id = ++nextTimer; const task = { id, fn, ms, at: now + ms }; timers.set(id, task); scheduled.push(task); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const input = new Input(canvas), hud = Object.assign(Object.create(Hud.prototype), {
    el: node(), q: Object.fromEntries(['msg', 'spd', 'rpm', 'nitro', 'nitroBox', 'nitroStatus', 'hp', 'area', 'boss', 'vig'].map(name => [name, node()])), msgT: 0,
    seenAreas: new Set(), areaT: 0, vigT: 0, gunnerOn: false, arrowPool: [],
    show() {}, setDefeat() {},
  });
  const game = Object.assign(Object.create(Game.prototype), {
    input, hud, post: null, audio: null, frames: 0, last: 0, run: null,
    mode: 'garage', paused: false, _runGeneration: 0,
    fade() {}, prewarm: async () => {}, _pumpTextures() {}, _runFrame() {}, garage: { update() {}, render() {} },
    _createRun(cfg) { const init = pendingInit; pendingInit = null; return { role: cfg.role, playerId: 1, humanDriver: cfg.role !== 'gunner', humanGunner: cfg.role !== 'driver',
      started: false, over: false, simState: 'countdown', cinematic: true, introOutside: true, states: new Map([[1, { driverAlive: true, gunnerAlive: true }]]),
      init: async () => { if (init) await init; }, dispose() { this.disposed = true; } }; },
  });
  const pad = { index: 0, id: 'standard test pad', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 20 }, () => ({ pressed: false, value: 0 })) };
  const key = code => win.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }));
  const release = code => win.dispatchEvent(Object.assign(new Event('keyup'), { code }));
  const mouse = (movementX, movementY) => win.dispatchEvent(Object.assign(new Event('mousemove'), { movementX, movementY }));
  const pressPad = index => {
    for (const button of pad.buttons) { button.pressed = false; button.value = 0; }
    input.endFrame(); input.poll();
    pad.buttons[index].pressed = true; pad.buttons[index].value = 1; input.poll();
  };
  return { input, hud, game, pad, key, release, mouse, pressPad, scheduled, timers,
    setPads(value) { pads = value; },
    advance(ms) { now += ms; for (const task of [...timers.values()]) if (task.at <= now) { timers.delete(task.id); task.fn(); } },
    deferInit() { let release; pendingInit = new Promise(resolve => { release = resolve; }); return release; },
    updateHud(dt) { hud.update(dt, { speed: 0, rpm01: 0, nitro01: 1, nitroMax: 1, hp01: 1, showDriver: true, arrows: [] }); },
    playable() { const r = game.run; r.started = true; r.simState = 'run'; r.cinematic = false; r.introOutside = false; assert.equal(canCaptureRun(r), true, 'fixture declares the actual shared run_status contract'); },
    async start(role, healthy = true) { const r = await game._startRun({ role }, game._runGeneration, null); if (healthy) { this.playable(); game.frame(game.last + 16); } return r; },
  };
}

const text = (role, input) => startupHintLines(role, input).join('\n');

test('startup controller hints agree with actual driver button commands', t => {
  const f = fixture(t); f.setPads([f.pad]);
  const cases = [
    [5, '<b>RB</b> NITRO', c => c.nitro],
    [4, '<b>LB</b> LOOK BACK (HOLD)', c => c.lookBack],
    [3, '<b>Y</b> RESET (HOLD)', c => c.reset],
    [11, '<b>R3</b> VIEW', c => c.cameraToggle],
    [13, '<b>D-PAD DOWN</b> MEDKIT', c => c.medkit],
  ];
  for (const [button, label, command] of cases) {
    f.pressPad(button); assert.equal(command(f.input.driver(1 / 60)), true, label);
    assert.ok(text('driver', f.input).includes(label), label);
  }
  f.pressPad(2); assert.equal(f.input.driver(1 / 60).special1, true);
  f.pressPad(1); assert.equal(f.input.driver(1 / 60).special2, true);
  assert.ok(text('driver', f.input).includes('<b>X / B</b> OIL / MINE'));
});

test('startup controller hints agree with actual gunner commands and four D-pad slots', t => {
  const f = fixture(t); f.setPads([f.pad]);
  for (const [button, label, command] of [
    [7, '<b>RT</b> FIRE', c => c.fire], [6, '<b>LT</b> SIGHTS', c => c.ads],
    [2, '<b>X</b> RELOAD', c => c.reload], [3, '<b>Y</b> NEXT WEAPON', c => c.swap === 1],
    [11, '<b>R3</b> MEDKIT', c => c.medkit], [8, '<b>BACK</b> VIEW', c => c.viewToggle],
  ]) {
    f.pressPad(button); assert.equal(command(f.input.gunner(1 / 60)), true, label);
    assert.ok(text('gunner', f.input).includes(label), label);
  }
  for (const button of [4, 5]) { f.pressPad(button); assert.equal(f.input.gunner(1 / 60).grenade, true); }
  assert.ok(text('gunner', f.input).includes('<b>RB / LB</b> GRENADE'));
  for (const [button, slot] of [[12, 0], [15, 1], [13, 2], [14, 3]]) { f.pressPad(button); assert.equal(f.input.gunner(1 / 60).slot, slot); }
  assert.ok(text('gunner', f.input).includes('WEAPONS 1-4'));
});

test('solo startup uses its distinct fire/boost/gadget mappings and does not promise trigger ADS', t => {
  const f = fixture(t); f.setPads([f.pad]);
  for (const [button, label, command] of [
    [5, '<b>RB</b> FIRE', c => c.gunner.fire], [4, '<b>LB</b> NITRO', c => c.driver.nitro],
    [2, '<b>X</b> RELOAD', c => c.gunner.reload], [1, '<b>B</b> GRENADE', c => c.gunner.grenade],
    [11, '<b>R3</b> NEXT WEAPON', c => c.gunner.swap === 1], [8, '<b>BACK</b> VIEW', c => c.gunner.viewToggle],
    [13, '<b>D-PAD DOWN</b> MEDKIT', c => c.gunner.medkit],
  ]) {
    f.pressPad(button); assert.equal(command(f.input.solo(1 / 60)), true, label);
    assert.ok(text('solo', f.input).includes(label), label);
  }
  f.pressPad(6); const brake = f.input.solo(1 / 60);
  assert.equal(brake.driver.brake, 1); assert.equal(brake.gunner.ads, false);
  assert.ok(!text('solo', f.input).includes('SIGHTS'));
  f.pressPad(14); assert.equal(f.input.solo(1 / 60).driver.special1, true);
  f.pressPad(15); assert.equal(f.input.solo(1 / 60).driver.special2, true);
});

test('keyboard hints read live primary/secondary bindings, unbound actions and all six weapon slots safely', t => {
  const f = fixture(t), input = f.input;
  input.bindings.reload = ['KeyF', 'KeyP']; input.bindings.grenade = [];
  input.bindings.slot6 = ['KeyM']; input.bindings.view = ['Key<svg/onload=bad>'];
  f.key('KeyR'); assert.equal(input.gunner(1 / 60).reload, false); f.release('KeyR'); input.endFrame();
  f.key('KeyF'); assert.equal(input.gunner(1 / 60).reload, true);
  const html = text('gunner', input);
  assert.ok(html.includes('<b>F/P</b> RELOAD'));
  assert.ok(html.includes('<b>UNBOUND</b> GRENADE'));
  assert.ok(html.includes('1 · 2 · 3 · 4 · 5 · M'));
  assert.ok(html.includes('KEY&lt;SVG/ONLOAD=BAD&gt;'));
  assert.ok(!html.includes('<svg')); assert.ok(!html.includes('1-3'));
  input.bindings.reload = ['KeyJ']; assert.ok(text('gunner', input).includes('<b>J</b> RELOAD'));
});

test('solo reset hint follows the actual fixed T exception while driver reset honors its rebind', t => {
  const f = fixture(t); f.input.bindings.reset = ['KeyP'];
  f.key('KeyP'); assert.equal(f.input.driver(1 / 60).reset, true); assert.ok(!f.input.solo(1 / 60).driver.reset);
  assert.ok(text('driver', f.input).includes('<b>P</b> RESET (HOLD)'));
  assert.ok(text('solo', f.input).includes('<b>T</b> RESET (HOLD)'));
  f.key('KeyT'); assert.equal(f.input.solo(1 / 60).driver.reset, true);
});

test('actual Game frame switches startup hints after analog Input polling without extending expiry', async t => {
  const f = fixture(t); f.setPads([f.pad]); await f.start('gunner');
  assert.equal(f.scheduled.length, 1); assert.equal(f.scheduled[0].ms, 9000);
  const owner = f.game._startupHints.owner, originalTimer = f.hud._hintT;
  const initialWrites = f.hud.hintEl.writes;
  f.game.frame(16); assert.equal(f.hud.hintEl.writes, initialWrites, 'connected idle pad is not active input');
  f.pad.buttons[7].value = .4; f.game.frame(32);
  assert.equal(f.input.lastDevice, 'pad'); assert.ok(f.hud.hintEl.innerHTML.includes('<b>RT</b> FIRE'));
  assert.equal(f.hud._hintT, originalTimer); assert.equal(f.game._startupHints.owner, owner); assert.equal(f.scheduled.length, 1);
  const padWrites = f.hud.hintEl.writes; f.game.frame(48); assert.equal(f.hud.hintEl.writes, padWrites, 'stable device does not rewrite the DOM');
  f.input.locked = true; f.mouse(18, -2); f.game.frame(64);
  assert.equal(f.input.lastDevice, 'kbm'); assert.ok(f.hud.hintEl.innerHTML.includes('<b>LMB</b> FIRE'));
  f.game.frame(80); assert.equal(f.input.lastDevice, 'pad'); assert.ok(f.hud.hintEl.innerHTML.includes('<b>RT</b> FIRE'));
  f.setPads([]); f.game.frame(96);
  assert.equal(f.input.lastDevice, 'pad', 'disconnect preserves Input ownership history');
  assert.ok(f.hud.hintEl.innerHTML.includes('<b>LMB</b> FIRE'), 'unavailable controller hints fall back to live keyboard/mouse');
  f.input.bindings.reload = ['KeyF']; f.game.frame(112); assert.ok(f.hud.hintEl.innerHTML.includes('<b>F</b> RELOAD'));
  assert.equal(f.scheduled.length, 1, 'neither device changes nor rebinds restart the hint timeout');
  f.advance(9000); const expired = f.hud.hintEl.innerHTML, writes = f.hud.hintEl.writes;
  f.setPads([f.pad]); f.game.frame(128);
  assert.equal(f.hud.hintEl.style.opacity, 0); assert.equal(f.hud.hintEl.innerHTML, expired); assert.equal(f.hud.hintEl.writes, writes);
  assert.equal(f.game._startupHints, null, 'expired startup help cannot be revived by device input');
});

test('startup refresh cannot replace another HUD hint or alter a gameplay message', async t => {
  const f = fixture(t); await f.start('driver'); const startupOwner = f.game._startupHints.owner;
  f.hud.message('BOSS INCOMING', 2100, '#f00');
  const replacementOwner = f.hud.hints(['OTHER HELP'], 3000), replacementTimer = f.hud._hintT;
  f.setPads([f.pad]); f.pressPad(5); f.game.frame(16);
  assert.equal(f.hud.hintEl.innerHTML, '<div>OTHER HELP</div>'); assert.equal(f.game._startupHints, null);
  assert.equal(f.hud._hintT, replacementTimer); assert.equal(f.hud.hintsActive(replacementOwner), true);
  assert.equal(f.hud.updateHints(['STALE STARTUP'], startupOwner), false);
  assert.equal(f.hud.q.msg.textContent, 'BOSS INCOMING'); assert.equal(f.hud.msgT, 2.1); assert.equal(f.hud.q.msg.style.color, '#f00');
  f.advance(3000); assert.equal(f.hud.hintEl.style.opacity, 0);
});

test('ending and restarting a life retires startup ownership and stale callbacks cannot hide fresh help', async t => {
  const f = fixture(t); await f.start('gunner'); const oldCallback = f.scheduled[0].fn, oldOwner = f.game._startupHints.owner, oldTimer = f.hud._hintT;
  f.game.endRun(); assert.equal(f.game._startupHints, null); assert.equal(f.game.run, null);
  assert.equal(f.timers.has(oldTimer), false); assert.equal(f.hud._hintT, null); assert.equal(f.hud._hintOwner, null); assert.equal(f.hud.hintEl.style.opacity, 0);
  f.game.mode = 'garage'; await f.start('solo');
  const owner = f.game._startupHints.owner;
  assert.notEqual(owner, oldOwner); assert.equal(f.scheduled.at(-1).ms, 9000);
  oldCallback(); assert.equal(f.hud.hintsActive(owner), true); assert.equal(f.hud.hintEl.style.opacity, 1);
  f.advance(9000); assert.equal(f.hud.hintsActive(owner), false); assert.equal(f.hud.hintEl.style.opacity, 0);
});

test('slow initialization and countdown spend no startup timer; healthy gameplay gets the full nine seconds', async t => {
  const f = fixture(t), release = f.deferInit(), start = f.start('gunner', false);
  // Let original _startRun reach its awaited initializer; no synthetic Game state.
  await Promise.resolve(); await Promise.resolve();
  f.advance(12000); f.game.frame(16);
  assert.equal(f.game.run, null); assert.equal(f.hud.hintEl, undefined); assert.equal(f.scheduled.length, 0);
  release(); const run = await start;
  assert.equal(run.started, false); assert.equal(canCaptureRun(run), false); assert.equal(f.game._startupHints.owner, null);
  f.advance(12000); f.game.frame(32);
  assert.equal(f.hud.hintEl, undefined); assert.equal(f.scheduled.length, 0, 'countdown and exterior intro cannot consume visible help');
  f.playable(); f.game.frame(48);
  assert.equal(f.scheduled.length, 1); assert.equal(f.scheduled[0].ms, 9000); assert.equal(f.scheduled[0].at, 33000);
  assert.equal(f.hud.hintsActive(f.game._startupHints.owner), true);
  f.advance(8999); assert.equal(f.hud.hintEl.style.opacity, 1);
  f.advance(1); assert.equal(f.hud.hintEl.style.opacity, 0);
});

test('pending startup waits through pause and actual run_status blockers, then uses the active device', async t => {
  const f = fixture(t), r = await f.start('gunner', false);
  f.playable(); f.game.paused = true; f.advance(10000); f.game.frame(16); assert.equal(f.scheduled.length, 0);
  f.game.paused = false;
  for (const key of ['introOutside', 'cinematic']) {
    r[key] = true; f.game.frame(f.game.last + 16); assert.equal(f.scheduled.length, 0); r[key] = false;
  }
  r.states.clear(); f.game.frame(f.game.last + 16); assert.equal(f.scheduled.length, 0);
  r.states.set(1, { driverAlive: true, gunnerAlive: true });
  f.setPads([f.pad]); f.pad.axes[2] = .35; f.game.frame(f.game.last + 16);
  assert.equal(canCaptureRun(r), true); assert.equal(f.input.lastDevice, 'pad'); assert.equal(f.scheduled.length, 1); assert.equal(f.scheduled[0].ms, 9000);
  assert.ok(f.hud.hintEl.innerHTML.includes('<b>RT</b> FIRE'));
  f.input.locked = true; f.mouse(12, 1); f.game.frame(f.game.last + 16);
  assert.ok(f.hud.hintEl.innerHTML.includes('<b>LMB</b> FIRE')); assert.equal(f.scheduled.length, 1);
});

test('startup policy reads the completed actual frame pause/terminal transition before creating help', async t => {
  const f = fixture(t); await f.start('gunner', false); f.playable();
  f.game._runFrame = () => { f.game.paused = true; };
  f.game.frame(16); assert.equal(f.scheduled.length, 0); assert.equal(f.game._startupHints.owner, null);
  f.game.paused = false;
  f.game._runFrame = () => { f.game.run.simState = 'dying'; f.game.run.states.get(1).gunnerAlive = false; };
  f.game.frame(32); assert.equal(f.scheduled.length, 0); assert.equal(f.game._startupHints, null);
});

test('death cancels pending startup, and terminal visible startup retires only its own notice', async t => {
  const f = fixture(t), pending = await f.start('gunner', false);
  pending.simState = 'dying'; pending.states.get(1).gunnerAlive = false; f.game.frame(16);
  assert.equal(f.game._startupHints, null); assert.equal(f.scheduled.length, 0); assert.equal(f.hud.hintEl, undefined);
  f.game.endRun(); f.game.mode = 'garage'; const live = await f.start('gunner'); const timer = f.hud._hintT;
  live.simState = 'dying'; live.states.get(1).gunnerAlive = false; f.game.frame(f.game.last + 16);
  assert.equal(f.game._startupHints, null); assert.equal(f.timers.has(timer), false); assert.equal(f.hud._hintOwner, null); assert.equal(f.hud.hintEl.style.opacity, 0);
});

test('actual victory with over still false retires visible help before the delayed results transition', async t => {
  const f = fixture(t); const r = await f.start('gunner'), timer = f.hud._hintT;
  assert.equal(f.hud.hintsActive(f.game._startupHints.owner), true);
  f.game._runFrame = () => { r.sim = { state: 'run', won: false, result: { why: 'victory' } }; };
  f.game.frame(f.game.last + 16);
  assert.equal(r.over, false); assert.equal(r.sim.won, false); assert.equal(isVictory(r), true); assert.equal(canCaptureRun(r), false);
  assert.equal(f.game._startupHints, null); assert.equal(f.timers.has(timer), false); assert.equal(f.hud._hintT, null); assert.equal(f.hud._hintOwner, null); assert.equal(f.hud.hintEl.style.opacity, 0);
  const other = f.hud.hints(['VICTORY HELP'], 3000), replacementTimer = f.hud._hintT;
  f.game.frame(f.game.last + 16); assert.equal(f.hud.hintsActive(other), true); assert.equal(f.hud._hintT, replacementTimer);
  f.hud.retireHints(other); f.game.endRun(); f.game.mode = 'garage'; f.game._runFrame = () => {};
  const viewer = await f.start('gunner'), viewerTimer = f.hud._hintT;
  assert.equal(viewer.sim, undefined); assert.equal(f.hud.hintsActive(f.game._startupHints.owner), true);
  f.game._runFrame = () => { viewer._victorySeen = true; };
  f.game.frame(f.game.last + 16);
  assert.equal(viewer.over, false); assert.equal(viewer.simState, 'run'); assert.equal(isVictory(viewer), true); assert.equal(canCaptureRun(viewer), false);
  assert.equal(f.game._startupHints, null); assert.equal(f.timers.has(viewerTimer), false); assert.equal(f.hud._hintOwner, null); assert.equal(f.hud.hintEl.style.opacity, 0);
});

test('intervening replacement cancels pending help even after it expires; endRun preserves replacement ownership', async t => {
  const f = fixture(t); await f.start('driver', false);
  const owner = f.hud.hints(['OTHER HELP'], 3000), timer = f.hud._hintT; f.hud.message('BOSS INCOMING', 2100, '#f00');
  f.advance(3000); f.playable(); f.game.frame(16);
  assert.equal(f.game._startupHints, null); assert.equal(f.hud.hintEl.innerHTML, '<div>OTHER HELP</div>'); assert.equal(f.scheduled.length, 1);
  assert.equal(f.hud.updateHints(['STALE'], owner), false); assert.equal(f.hud._hintT, timer); assert.equal(f.hud.q.msg.textContent, 'BOSS INCOMING');
  f.game.endRun(); f.game.mode = 'garage'; await f.start('gunner');
  const replacement = f.hud.hints(['CURRENT OTHER HELP'], 6000), replacementTimer = f.hud._hintT;
  f.game.endRun();
  assert.equal(f.hud._hintT, replacementTimer); assert.equal(f.timers.has(replacementTimer), true); assert.equal(f.hud.hintsActive(replacement), true); assert.equal(f.hud.hintEl.innerHTML, '<div>CURRENT OTHER HELP</div>');
  assert.equal(f.hud.q.msg.textContent, 'BOSS INCOMING');
});

test('ending a pending life cannot arm stale startup help in the next countdown', async t => {
  const f = fixture(t); await f.start('gunner', false); const oldPending = f.game._startupHints;
  f.game.endRun(); assert.equal(f.game._startupHints, null); assert.equal(f.scheduled.length, 0);
  f.game.mode = 'garage'; await f.start('solo', false); const pending = f.game._startupHints;
  assert.notEqual(pending, oldPending); assert.notEqual(pending.run, oldPending.run);
  f.game.frame(16); assert.equal(f.scheduled.length, 0); f.playable(); f.game.frame(32); assert.equal(f.scheduled.length, 1);
  assert.equal(f.scheduled[0].ms, 9000); assert.ok(f.hud.hintEl.innerHTML.includes('<b>T</b> RESET (HOLD)'));
});

test('pending GO uses actual Hud message/update clock before granting the full startup nine seconds', async t => {
  const f = fixture(t); await f.start('solo', false); f.playable(); f.hud.message('GO!', 900, '#ffc21a');
  f.game._runFrame = dt => f.updateHud(dt);
  for (let i = 0; i < 17; i++) { f.advance(50); f.game.frame(f.game.last + 50); }
  assert.ok(f.hud.msgT > 0); assert.equal(f.hud.hintEl, undefined); assert.equal(f.scheduled.length, 0);
  assert.equal(f.hud.q.msg.textContent, 'GO!');
  for (let i = 0; i < 3 && f.hud.msgT > 0; i++) { f.advance(50); f.game.frame(f.game.last + 50); }
  assert.ok(f.hud.msgT <= 0); assert.equal(f.hud.q.msg.style.opacity, 0);
  assert.equal(f.scheduled.length, 1); assert.equal(f.scheduled[0].ms, 9000); assert.ok(f.scheduled[0].at >= 9900);
  assert.equal(f.hud.hintsActive(f.game._startupHints.owner), true);
  const owner = f.game._startupHints.owner; f.advance(8999); assert.equal(f.hud.hintsActive(owner), true);
  f.advance(1); assert.equal(f.hud.hintsActive(owner), false); assert.equal(f.hud.hintEl.style.opacity, 0);
});

test('an actual enemy warning in the completed Game frame retires only startup without later rearming', async t => {
  const f = fixture(t); await f.start('gunner'); const owner = f.game._startupHints.owner, timer = f.hud._hintT;
  let warned = false;
  f.game._runFrame = dt => { if (!warned) { warned = true; f.hud.message('BARRELS INCOMING', 1400, '#ffbc67'); } f.updateHud(dt); };
  f.game.frame(f.game.last + 16);
  assert.equal(f.game._startupHints, null); assert.equal(f.hud.hintsActive(owner), false); assert.equal(f.timers.has(timer), false); assert.equal(f.hud._hintOwner, null); assert.equal(f.hud.hintEl.style.opacity, 0);
  assert.equal(f.hud.q.msg.textContent, 'BARRELS INCOMING'); assert.equal(f.hud.q.msg.style.opacity, 1); assert.equal(f.hud.q.msg.style.color, '#ffbc67'); assert.ok(f.hud.msgT > 1.3);
  for (let i = 0; i < 30; i++) { f.advance(50); f.game.frame(f.game.last + 50); }
  assert.ok(f.hud.msgT <= 0); assert.equal(f.game._startupHints, null); assert.equal(f.scheduled.length, 1, 'priority retirement never rearms startup help after the warning');
});

test('priority message retirement preserves a replacement hint owner, timer and visible content', async t => {
  const f = fixture(t); await f.start('driver'); const startup = f.game._startupHints.owner;
  const replacement = f.hud.hints(['CURRENT OTHER HELP'], 6000), timer = f.hud._hintT;
  f.game._runFrame = dt => { f.hud.message('ENEMY GRENADE', 1400, '#ffbc67'); f.updateHud(dt); };
  f.game.frame(f.game.last + 16);
  assert.equal(f.game._startupHints, null); assert.equal(f.hud.updateHints(['STALE STARTUP'], startup), false);
  assert.equal(f.hud.hintsActive(replacement), true); assert.equal(f.hud._hintT, timer); assert.equal(f.timers.has(timer), true); assert.equal(f.hud.hintEl.innerHTML, '<div>CURRENT OTHER HELP</div>');
  assert.equal(f.hud.q.msg.textContent, 'ENEMY GRENADE'); assert.equal(f.hud.q.msg.style.opacity, 1);
});
