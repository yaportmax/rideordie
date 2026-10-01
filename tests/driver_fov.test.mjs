import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_SETTINGS, normalizeSettings, loadSettings, saveSettings } from '../src/ui/settings_store.js';
import { SettingsScreen } from '../src/ui/screens/settings.js';
import { ChaseCam, GunnerCam } from '../src/view/camera_rig.js';
import { Run } from '../src/game/run.js';

const SETTINGS_KEY = 'rideordie.settings.v1';

function withStorage(saved, check) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map(saved === undefined ? [] : [[SETTINGS_KEY, typeof saved === 'string' ? saved : JSON.stringify(saved)]]);
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

test('new settings use a driver cockpit FOV of 85 without widening the gunner camera', () => {
  assert.equal(DEFAULT_SETTINGS.driverFov, 85);
  assert.equal(DEFAULT_SETTINGS.fov, 80);
  for (const value of [undefined, null, false, [], 'bad', {}]) {
    const settings = normalizeSettings(value);
    assert.equal(settings.driverFov, 85);
    assert.equal(settings.fov, 80);
  }
  withStorage(undefined, () => {
    const a = loadSettings(), b = loadSettings();
    assert.equal(a.driverFov, 85);
    assert.equal(a.fov, 80);
    a.driverFov = 96;
    assert.equal(b.driverFov, 85, 'loads return independent settings objects');
    assert.equal(DEFAULT_SETTINGS.driverFov, 85, 'changing a load must not alter the defaults');
  });
});

test('old default cockpit settings migrate to 85 while a custom first-person FOV is preserved for both seats', () => {
  const oldDefault = normalizeSettings({ fov: 80, quality: 1 });
  assert.equal(oldDefault.driverFov, 85);
  assert.equal(oldDefault.fov, 80);
  assert.equal(oldDefault.quality, 1);
  for (const fov of [60, 72, 85, 92, 100]) {
    const custom = normalizeSettings({ fov });
    assert.equal(custom.driverFov, fov);
    assert.equal(custom.fov, fov);
  }
  assert.equal(normalizeSettings({ fov: 140 }).driverFov, 100);
  assert.equal(normalizeSettings({ fov: 10 }).driverFov, 60);
  for (const fov of [NaN, Infinity, -Infinity, '92', null]) {
    const damaged = normalizeSettings({ fov });
    assert.equal(damaged.driverFov, 85);
    assert.equal(damaged.fov, 80);
  }
});

test('explicit cockpit preferences are independent and damaged driver settings stay within safe camera limits', () => {
  for (const [driverFov, expected] of [[60, 60], [85, 85], [92, 92], [101, 100], [15, 60], [82.5, 82.5]]) {
    const settings = normalizeSettings({ driverFov, fov: 94 });
    assert.equal(settings.driverFov, expected);
    assert.equal(settings.fov, 94);
  }
  for (const driverFov of [undefined, null, NaN, Infinity, -Infinity, '95', false]) {
    const settings = normalizeSettings({ driverFov, fov: 94 });
    assert.equal(settings.driverFov, 85);
    assert.equal(settings.fov, 94);
  }
  const independent = normalizeSettings({ driverFov: 85, fov: 63 });
  assert.equal(independent.driverFov, 85);
  assert.equal(independent.fov, 63);
});

test('legacy migration persists once and later loads preserve independent cockpit and gunner preferences', () => {
  withStorage({ fov: 80, music: 0.25 }, data => {
    const migrated = loadSettings();
    assert.equal(migrated.driverFov, 85);
    assert.equal(migrated.fov, 80);
    assert.equal(migrated.music, 0.25);
    saveSettings(migrated);
    assert.equal(JSON.parse(data.get(SETTINGS_KEY)).driverFov, 85);
    assert.deepEqual(loadSettings(), migrated);
    migrated.driverFov = 90;
    migrated.fov = 72;
    saveSettings(migrated);
    const restored = loadSettings();
    assert.equal(restored.driverFov, 90);
    assert.equal(restored.fov, 72);
    assert.equal(restored.music, 0.25);
  });
  withStorage({ fov: 92 }, () => {
    assert.equal(loadSettings().driverFov, 92);
    assert.equal(loadSettings().fov, 92);
  });
  withStorage('{broken', () => {
    assert.equal(loadSettings().driverFov, 85);
    assert.equal(loadSettings().fov, 80);
  });
});

function settingsScreen(settings) {
  const screen = Object.create(SettingsScreen.prototype), changed = [];
  screen.tabId = 'video';
  screen.cb = {};
  screen.ui = {
    settings,
    changeSetting(key, value) { changed.push([key, value]); settings[key] = value; },
    snd() {}, toast() {}, nav: { focus() {} },
  };
  screen.q = { rows: { querySelector: () => null } };
  screen.renderRows = () => {};
  return { screen, changed };
}

test('video settings describe and reset separate cockpit and gunner FOV controls', () => {
  const { screen, changed } = settingsScreen(normalizeSettings({ driverFov: 91, fov: 96, master: 0.35 }));
  const driver = screen.rowDef('driverFov'), gunner = screen.rowDef('fov');
  assert.ok(driver && gunner, 'both role controls must be present');
  assert.equal(driver.min, 60); assert.equal(driver.max, 100);
  assert.equal(gunner.min, 60); assert.equal(gunner.max, 100);
  assert.match(driver.label + ' ' + driver.desc, /driver|cockpit/i);
  assert.match(gunner.label + ' ' + gunner.desc, /gunner|truck bed/i);
  assert.match(screen.rowHtml(driver), /91°/);
  assert.match(screen.rowHtml(gunner), /96°/);
  screen.reset();
  assert.ok(changed.some(([key, value]) => key === 'driverFov' && value === 85));
  assert.ok(changed.some(([key, value]) => key === 'fov' && value === 80));
  assert.equal(screen.S.driverFov, 85);
  assert.equal(screen.S.fov, 80);
  assert.equal(screen.S.master, 0.35, 'resetting video must preserve the audio tab settings');
  assert.match(screen.rowHtml(driver), /85°/);
  assert.match(screen.rowHtml(gunner), /80°/);
});

const settle = update => { for (let i = 0; i < 360; i++) update(1 / 60); };
const approxFov = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.051, `${actual}° should settle to ${expected}°`);

test('cockpit camera settles to the selected 85 degree base while look-back and chase views retain their own FOVs', () => {
  const settings = normalizeSettings({}), camera = new THREE.PerspectiveCamera();
  const rig = new ChaseCam(camera), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), velocity = new THREE.Vector3();
  const opts = { cockpitEye: new THREE.Vector3(0, 1.6, 0), lookBackEye: new THREE.Vector3(0, 2, -3), fovBase: settings.driverFov };
  settle(dt => rig.update(dt, position, rotation, velocity, opts));
  approxFov(camera.fov, 85);
  assert.equal(camera.near, 0.05);
  opts.fovBase = 93;
  settle(dt => rig.update(dt, position, rotation, velocity, opts));
  approxFov(camera.fov, 93);
  opts.lookBack = true;
  settle(dt => rig.update(dt, position, rotation, velocity, opts));
  approxFov(camera.fov, 78);
  rig.mode = 1;
  settle(dt => rig.update(dt, position, rotation, velocity, opts));
  approxFov(camera.fov, 66);
  assert.equal(camera.near, 0.15);
});

test('gunner hip fire, iron-sight ADS and scoped ADS retain their existing camera targets', () => {
  const settings = normalizeSettings({}), camera = new THREE.PerspectiveCamera();
  const rig = new GunnerCam(camera), eye = new THREE.Vector3(0, 2.4, 0);
  const opts = { fovBase: settings.fov, truckQuat: new THREE.Quaternion() };
  settle(dt => rig.update(dt, eye, 0, 0, false, opts));
  approxFov(camera.fov, 76);
  assert.equal(camera.near, 0.05);
  settle(dt => rig.update(dt, eye, 0, 0, true, opts));
  approxFov(camera.fov, 52);
  opts.scoped = true; opts.scopeFov = 18;
  settle(dt => rig.update(dt, eye, 0, 0, true, opts));
  approxFov(camera.fov, 18);
  opts.scoped = false; opts.fovBase = 90;
  settle(dt => rig.update(dt, eye, 0, 0, false, opts));
  approxFov(camera.fov, 86);
});

test('live settings reach the matching seat camera without transferring the driver FOV to gunner ADS', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: {} });
  try {
    const camera = new THREE.PerspectiveCamera(), settings = normalizeSettings({ driverFov: 93, fov: 77 });
    const game = { camera, driverFovBase: settings.driverFov, fovBase: settings.fov };
    assert.equal(game.driverFovBase, 93); assert.equal(game.fovBase, 77);
    const run = Object.assign(Object.create(Run.prototype), {
      g: game, role: 'driver', simState: 'run', introDone: true,
      chase: new ChaseCam(camera), gcam: new GunnerCam(camera),
      camDir: new THREE.Vector3(), eye: new THREE.Vector3(0, 2.4, 0),
      _cockpitEye(_dt, _state, out) { return out.set(0, 1.6, 0); },
      gunner: { weapon: {}, yaw: 0, pitch: 0, ads: 0, reloading: false },
    });
    const state = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), speed: 0, boosting: false, airborne: false };
    const commands = { driver: {} };
    settle(dt => run._camera(dt, commands, state));
    approxFov(camera.fov, 93);
    run.role = 'gunner';
    settle(dt => run._camera(dt, commands, state));
    approxFov(camera.fov, 73);
    run.gunner.ads = 1;
    settle(dt => run._camera(dt, commands, state));
    approxFov(camera.fov, 52);
    game.driverFovBase = DEFAULT_SETTINGS.driverFov; game.fovBase = DEFAULT_SETTINGS.fov;
    run.role = 'driver';
    settle(dt => run._camera(dt, commands, state));
    approxFov(camera.fov, 85);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  }
});
