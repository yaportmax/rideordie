import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import * as THREE from 'three';
import { AudioBridge, EXPECTED_NAMES } from '../src/view/audio_bridge.js';
import { WEAPONS, WEAPON_ORDER } from '../src/data/weapons.js';
import { GunnerController } from '../src/game/gunner.js';
import { audioVoiceFixture } from './helpers/audio-voice-fixture.mjs';

const live = a => Object.fromEntries(Object.keys(a._cnt).map(k => [k, a._cnt[k] - a._relc[k]]));
const soundKey = id => 'guns/fire_' + WEAPONS[id].sound;

test('every purchasable weapon fire family resolves to actual shipped audio variations', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/audio/manifest.json', import.meta.url), 'utf8'));
  for (const id of WEAPON_ORDER) {
    const key = soundKey(id), asset = manifest.sounds[key];
    assert.ok(asset, `${id} must use a shipped fire sound family: ${key}`);
    assert.equal(asset.category, 'gun_fire'); assert.equal(asset.loop, false);
    assert.ok(EXPECTED_NAMES.includes(key), `${id} sound family must be checked during audio initialization`);
    for (const path of asset.files || [asset.file]) await access(new URL('../public/audio/' + path, import.meta.url));
  }
  assert.equal(manifest.sounds['guns/fire_minigun'], undefined, 'the mounted gun deliberately shares existing LMG audio');
  assert.ok(!EXPECTED_NAMES.includes('guns/fire_minigun'), 'a nonexistent ID-derived sound must not become an expected asset');
});

test('a genuine mounted-minigun firing event starts the existing decoded LMG source at its authored pitch', () => {
  const f = audioVoiceFixture({ cap: 6 }), def = f.add('guns/fire_lmg', 'gun_fire'), events = [];
  const bridge = new AudioBridge(f.audio), gunner = new GunnerController({ weapons: ['minigun'] }, {
    emit: e => events.push(e), ownCar: () => null, targets: function* () {}, raycastWorld: () => null,
  });
  gunner.muzzle.set(.4, 1, .8);
  gunner.fire({ position: new THREE.Vector3(0, 1.5, 0), dir: new THREE.Vector3(0, 0, 1) });
  const shot = events.find(e => e.t === 'shot');
  assert.ok(shot); assert.equal(shot.weapon, 'minigun'); assert.deepEqual(shot.origin, [.4, 1, .8]);
  bridge.handleEvent(shot);
  assert.equal(def.plays, 1); assert.equal(def.voices.length, 1);
  const voice = def.voices[0];
  assert.ok(voice.playing && voice.src && !voice.isNull, 'an emitted shot must start a real resident AudioSys source');
  assert.equal(voice.src.buffer, def.bufs[0]); assert.equal(voice.src.playbackRate.value, .82);
  assert.equal(voice.pos, null, 'the nearby local gun keeps its existing unpanned sound');
  assert.equal(f.audio.stats.notLoaded, 0); assert.equal(f.audio.missing.has('guns/fire_minigun'), false);
  f.finish(); assert.deepEqual(live(f.audio), { gain: 0, src: 0, filter: 0, panner: 0 });
});

test('equipped minigun and LMG preload their shared real fire family once at first priority', async () => {
  const f = audioVoiceFixture(), requests = [], engines = [];
  f.add('guns/fire_lmg', 'gun_fire');
  f.audio.preload = (keys, priority) => { requests.push({ keys, priority }); return Promise.resolve([]); };
  f.audio.preloadEngine = (id, priority) => { engines.push({ id, priority }); return Promise.resolve([]); };
  const bridge = new AudioBridge(f.audio);
  await bridge.preload({ weapons: ['minigun', 'lmg'], enemies: [] });
  const fire = requests.filter(r => r.keys.some(k => typeof k === 'string' && k.startsWith('guns/fire_') && !k.startsWith('guns/fire_enemy')));
  assert.deepEqual(fire, [{ keys: ['guns/fire_lmg'], priority: 0 }]);
  assert.ok(f.audio.resolve(fire[0].keys[0]), 'first-priority equipped key resolves through actual AudioSys');
  assert.equal(engines.length, 1); assert.equal(engines[0].priority, 0);
});

test('positional minigun fire keeps the actual world muzzle and the same sound family and pitch', () => {
  const f = audioVoiceFixture({ cap: 6 }), def = f.add('guns/fire_lmg', 'gun_fire');
  const bridge = new AudioBridge(f.audio), origin = [20, 2, -4];
  bridge.handleEvent({ t: 'shot', src: 'player', weapon: 'minigun', origin, rays: [] });
  assert.equal(def.voices.length, 1); const voice = def.voices[0];
  assert.deepEqual(voice.pos, { x: 20, y: 2, z: -4 });
  assert.equal(voice.src.playbackRate.value, .82); assert.ok(voice.pan && voice.lp);
  assert.equal(voice.def.key, 'guns/fire_lmg');
  f.finish(); assert.deepEqual(live(f.audio), { gain: 0, src: 0, filter: 0, panner: 0 });
});

test('1200 RPM minigun fire stays voiced with bounded shared-family sources and releases every retired source', () => {
  const f = audioVoiceFixture({ cap: 6 }), def = f.add('guns/fire_lmg', 'gun_fire'), voices = [];
  const bridge = new AudioBridge(f.audio);
  for (let i = 0; i < 200; i++) {
    f.audio.ctx.currentTime += 60 / WEAPONS.minigun.rpm;
    bridge.handleEvent({ t: 'shot', src: 'player', weapon: 'minigun', origin: [.4, 1, .8], rays: [] });
    const current = def.voices.at(-1); voices.push(current);
    assert.ok(current?.src && current.playing, `shot ${i + 1} must start its shared fire source`);
    assert.ok(def.voices.length <= 6 && f.audio.voices.size <= 6, 'the gun-fire cap bounds admitted sources during held fire');
  }
  assert.equal(def.plays, 200); assert.equal(bridge.counts.sounds, 200); assert.equal(f.audio.stats.notLoaded, 0);
  assert.equal(f.audio.stats.stolen, 194, 'the existing one-shot cap must apply to the shared LMG sound family');
  for (const voice of voices) voice.src?.finish();
  assert.equal(f.audio.voices.size, 0); assert.equal(def.voices.length, 0);
  assert.deepEqual(live(f.audio), { gain: 0, src: 0, filter: 0, panner: 0 });
});

test('legacy LMG fire retains its existing sound key and default playback pitch', () => {
  const f = audioVoiceFixture({ cap: 6 }), def = f.add('guns/fire_lmg', 'gun_fire');
  new AudioBridge(f.audio).handleEvent({ t: 'shot', src: 'player', weapon: 'lmg', origin: [.4, 1, .8], rays: [] });
  assert.equal(def.voices.length, 1); assert.equal(def.voices[0].src.playbackRate.value, 1);
  f.finish(); assert.deepEqual(live(f.audio), { gain: 0, src: 0, filter: 0, panner: 0 });
});
