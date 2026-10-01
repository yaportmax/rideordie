import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BINDINGS } from '../src/core/input.js';
import { ACTION_LABEL, BIND_GROUPS, conflictSet, defaultBindings, loadBindings, saveBindings } from '../src/ui/settings_store.js';
import { ControlsScreen } from '../src/ui/screens/controls.js';

const BINDINGS_KEY = 'rideordie.bindings.v1';
const RETIRED_ACTIONS = ['crouch', 'moveL', 'moveR', 'moveF', 'moveB'];

function withStorage(saved, check) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map(saved === undefined ? [] : [[BINDINGS_KEY, JSON.stringify(saved)]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  } });
  try { check(data); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

test('legacy crouch and walking bindings are ignored while custom and empty active bindings survive loading', () => {
  const legacy = { crouch: ['ControlLeft', 'KeyC'], moveL: ['KeyJ'], moveR: ['KeyL'], moveF: ['KeyI'], moveB: ['KeyK'], reload: ['KeyF', 'KeyJ'], grenade: [], throttle: ['KeyI'], camera: [], obsoleteAction: ['KeyO'] };
  withStorage(legacy, () => {
    assert.deepEqual(loadBindings(), { reload: ['KeyF', 'KeyJ'], grenade: [], throttle: ['KeyI'], camera: [] });
    const active = Object.assign(defaultBindings(), loadBindings());
    for (const action of RETIRED_ACTIONS) assert.equal(Object.hasOwn(active, action), false, action);
    assert.deepEqual(active.reload, ['KeyF', 'KeyJ']);
    assert.deepEqual(active.grenade, [], 'unbound actions must stay unbound');
    assert.deepEqual(active.camera, []);
    assert.deepEqual(active.brake, DEFAULT_BINDINGS.brake, 'unsaved known actions keep their default');
  });
});

test('saving bindings prunes retired actions without changing valid custom or empty arrays', () => {
  const saved = { crouch: ['KeyZ'], moveL: ['KeyJ'], moveR: ['KeyL'], moveF: ['KeyI'], moveB: [], throttle: ['KeyI'], reload: ['KeyF', 'KeyJ'], grenade: [], camera: [], obsoleteAction: ['KeyO'] };
  withStorage(undefined, data => {
    saveBindings(saved);
    const expected = { throttle: ['KeyI'], reload: ['KeyF', 'KeyJ'], grenade: [], camera: [] };
    assert.deepEqual(JSON.parse(data.get(BINDINGS_KEY)), expected);
    assert.deepEqual(loadBindings(), expected);
    assert.deepEqual(saved.crouch, ['KeyZ'], 'persistence must not mutate the caller binding object');
    assert.deepEqual(saved.moveL, ['KeyJ']);
    assert.deepEqual(saved.moveB, []);
    assert.deepEqual(saved.grenade, []);
  });
});

test('retired crouch and walking are absent from defaults, action labels and every conflict set', () => {
  const actions = BIND_GROUPS.flatMap(group => group.actions.map(([action]) => action));
  for (const retired of RETIRED_ACTIONS) {
    assert.equal(Object.hasOwn(DEFAULT_BINDINGS, retired), false, retired);
    assert.equal(Object.hasOwn(defaultBindings(), retired), false, retired);
    assert.equal(Object.hasOwn(ACTION_LABEL, retired), false, retired);
    assert.equal(actions.includes(retired), false, retired);
    assert.deepEqual(conflictSet(retired), []);
    for (const action of new Set([...Object.keys(DEFAULT_BINDINGS), ...actions])) {
      assert.equal(conflictSet(action).includes(retired), false, `${action}: ${retired}`);
    }
  }
  assert.ok(conflictSet('grenade').includes('reload'), 'active gunner conflicts remain checked');
  assert.ok(conflictSet('medkit').includes('throttle'), 'global conflicts still span both seats');
});

function renderControls(role, bindings = defaultBindings()) {
  const screen = Object.create(ControlsScreen.prototype);
  screen.role = role;
  screen.ui = { input: { bindings } };
  screen.q = Object.fromEntries(['tabs', 'blurb', 'kb', 'pad', 'foot'].map(name => [name, { innerHTML: '', textContent: '' }]));
  screen.render();
  return screen.q;
}
const legendRow = (html, button) => [...html.matchAll(/<div class="lg">[\s\S]*?<\/div>/g)].map(match => match[0]).find(row => row.includes(`pb-${button.toLowerCase()}"`)) ?? '';
const keyboardRow = (html, label) => [...html.matchAll(/<div class="kr">[\s\S]*?<\/div>/g)].map(match => match[0]).find(row => row.includes(`>${label}</span>`)) ?? '';

test('gunner help omits crouch and walking even with old in-memory bindings', () => {
  const q = renderControls('gunner', { ...defaultBindings(), crouch: ['ControlLeft', 'KeyC'], moveL: ['KeyJ'], moveR: ['KeyL'], moveF: ['KeyI'], moveB: ['KeyK'], reload: ['KeyF'], grenade: [] });
  assert.doesNotMatch(q.kb.innerHTML, /crouch/i);
  assert.doesNotMatch(q.pad.innerHTML, /crouch/i);
  assert.equal(legendRow(q.pad.innerHTML, 'B'), '', 'dedicated gunner B has no retired action legend');
  assert.equal(keyboardRow(q.kb.innerHTML, 'MOVE'), '', 'gunner walking must not appear in keyboard help');
  assert.equal(legendRow(q.pad.innerHTML, 'LS'), '', 'dedicated gunner left stick has no walking legend');
  assert.match(keyboardRow(q.kb.innerHTML, 'RELOAD'), /<kbd[^>]*>F<\/kbd>/);
  assert.match(keyboardRow(q.kb.innerHTML, 'THROW GRENADE'), /<kbd class="none">/);
  assert.match(legendRow(q.pad.innerHTML, 'RB'), /GRENADE/);
  assert.match(legendRow(q.pad.innerHTML, 'X'), /RELOAD/);
});

test('driver mine and solo grenade B help remain documented', () => {
  const driver = renderControls('driver'), solo = renderControls('solo');
  assert.match(legendRow(driver.pad.innerHTML, 'B'), /DROP MINE/);
  assert.match(keyboardRow(driver.kb.innerHTML, 'DROP MINE'), /<kbd[^>]*>E<\/kbd>/);
  assert.match(legendRow(solo.pad.innerHTML, 'B'), /GRENADE/);
  assert.match(keyboardRow(solo.kb.innerHTML, 'THROW GRENADE'), /<kbd[^>]*>G<\/kbd>/);
  assert.doesNotMatch(driver.pad.innerHTML + solo.pad.innerHTML, /crouch/i);
});

test('driver steering and solo driving help remain present after gunner walking is removed', () => {
  const bindings = { ...defaultBindings(), throttle: ['KeyI'], brake: [], left: ['KeyJ'], right: ['KeyL'] };
  const driver = renderControls('driver', bindings), solo = renderControls('solo', bindings);
  assert.match(legendRow(driver.pad.innerHTML, 'LS'), /STEER/);
  assert.match(legendRow(solo.pad.innerHTML, 'LS'), /STEER/);
  assert.match(keyboardRow(driver.kb.innerHTML, 'ACCELERATE'), /<kbd[^>]*>I<\/kbd>/);
  assert.match(keyboardRow(driver.kb.innerHTML, 'BRAKE / REVERSE'), /<kbd class="none">/);
  const drive = keyboardRow(solo.kb.innerHTML, 'DRIVE');
  assert.match(drive, /<kbd[^>]*>I<\/kbd>/);
  assert.match(drive, /<kbd[^>]*>J<\/kbd>/);
  assert.match(drive, /<kbd[^>]*>L<\/kbd>/);
  assert.match(drive, /<kbd class="none">/);
});
