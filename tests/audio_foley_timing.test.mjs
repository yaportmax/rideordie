import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioBridge } from '../src/view/audio_bridge.js';
import { WEAPONS } from '../src/data/weapons.js';
import { WEAPON_ORDER } from '../src/data/weapons.js';

function fixture() {
  const sounds = [];
  const audio = { now: 1, expect() {}, setDanger() {}, ambience: { stopWind() {} },
    listener: { distTo: p => Math.hypot(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]) },
    play(name, options) {
      const voice = { playing: true, isNull: false, stops: [], moves: [],
        stop(fade) { this.stops.push(fade); this.playing = false; },
        setPos(p, vel) { this.moves.push({ p: [...p], vel }); },
      };
      sounds.push({ name, options, voice, at: audio.now });
      return voice;
    },
  };
  const bridge = new AudioBridge(audio, { playerId: 1 });
  const state = { pos: { x: 0, y: 0, z: 20 }, vel: { x: 0, y: 0, z: 40 } };
  const ctx = { states: new Map([[1, state]]) };
  return { audio, bridge, sounds, state, ctx,
    tick(dt) { audio.now += dt; bridge.update(dt, ctx); },
  };
}

test('rifle reload cues follow game time across a long solo pause, rather than native audio time', () => {
  const f = fixture();
  f.bridge.handleEvent({ t: 'reloadStart', weapon: 'rifle', time: 2 }, f.ctx);
  assert.equal(f.sounds.length, 0, 'native sources must not be scheduled before the animation cue');
  for (let frame = 0; frame < 10; frame++) f.tick(.02);
  assert.equal(f.sounds.length, 0);
  const remaining = f.bridge.foleyPending.map(cue => cue.remaining);
  // Game._runFrame skips Run.update/AudioBridge.update while solo-paused,
  // but AudioContext.currentTime continues so UI and music stay audible.
  f.audio.now += 30;
  assert.deepEqual(f.bridge.foleyPending.map(cue => cue.remaining), remaining);
  f.tick(.06);
  assert.deepEqual(f.sounds.map(s => s.name), ['guns/rifle_mag_out']);
  f.tick(.84);
  assert.deepEqual(f.sounds.map(s => s.name), ['guns/rifle_mag_out', 'guns/rifle_mag_in']);
  f.tick(.54);
  assert.deepEqual(f.sounds.map(s => s.name), ['guns/rifle_mag_out', 'guns/rifle_mag_in', 'guns/rifle_bolt']);
  assert.ok(f.sounds.every(s => s.options.delay === undefined), 'each due cue starts now exactly once');
  assert.equal(f.bridge.foleyPending.length, 0);
});

test('delayed and active external-view reload foley stays on the moving truck', () => {
  const f = fixture();
  f.bridge.handleEvent({ t: 'reloadStart', weapon: 'rifle', time: 2 }, f.ctx);
  f.state.pos.z = 30.4; f.tick(.26);
  const cue = f.sounds[0];
  assert.deepEqual(cue.options.pos, [0, 1.1, 30.4], 'origin must be evaluated at playback, not reload start');
  assert.equal(cue.options.dynamic, true); assert.equal(cue.options.vel, f.state.vel);
  f.state.pos.z = 35; f.tick(.1);
  assert.deepEqual(cue.voice.moves.at(-1), { p: [0, 1.1, 35], vel: f.state.vel });
});

test('first-person foley remains non-positional and keeps weapon tuning', () => {
  const f = fixture(); f.state.pos.z = 0;
  f.bridge.handleEvent({ t: 'reloadStart', weapon: 'revolver', time: 2.5 }, f.ctx);
  f.tick(.3);
  const cue = f.sounds[0];
  assert.equal(cue.name, 'guns/pistol_mag_out'); assert.equal(cue.options.pos, undefined);
  assert.equal(cue.options.vel, undefined); assert.equal(cue.options.pitch, .8);
  assert.equal(cue.options.gain, .9); assert.equal(cue.options.pitchVar, .03);
});

test('swap, explicit reload cancellation and reset discard pending and active foley', () => {
  for (const action of ['swap', 'cancel', 'reset']) {
    const f = fixture();
    f.bridge.handleEvent({ t: 'reloadStart', weapon: 'smg', time: 1.7 }, f.ctx); f.tick(.25);
    const first = f.sounds[0]; assert.equal(first.name, 'guns/smg_mag_out');
    if (action === 'reset') f.bridge.reset();
    else f.bridge.handleEvent({ t: action === 'swap' ? 'weaponSwap' : 'reloadCancel' }, f.ctx);
    assert.deepEqual(first.voice.stops, [.02], action);
    assert.equal(f.bridge.foleyPending.length, 0, action);
    f.tick(4);
    assert.equal(f.sounds.filter(s => s.name.startsWith('guns/smg_')).length, 1, 'obsolete cues cannot resume after ' + action);
  }
});

test('fresh reload replaces its old sequence and active handles stay bounded', () => {
  const f = fixture();
  f.bridge.handleEvent({ t: 'reloadStart', weapon: 'rifle', time: 2 }, f.ctx); f.tick(.26);
  f.bridge.handleEvent({ t: 'reloadStart', weapon: 'pistol', time: 1.35 }, f.ctx); f.tick(2);
  assert.deepEqual(f.sounds.map(s => s.name), ['guns/rifle_mag_out', 'guns/pistol_mag_out', 'guns/pistol_mag_in', 'guns/pistol_slide']);
  for (let i = 0; i < 200; i++) f.bridge.handleEvent({ t: 'dryClick' }, f.ctx);
  assert.equal(f.bridge.reloadH.length, 24); assert.ok(f.sounds.slice(0, -24).every(s => !s.voice.playing));
  for (const h of f.bridge.reloadH) h.playing = false;
  f.tick(.01); assert.equal(f.bridge.reloadH.length, 0);
});

test('empty-mag click and immediate weapon-swap feedback survive same-frame reloadStart', () => {
  const f = fixture();
  f.bridge.handleEvent({ t: 'dryClick' }, f.ctx);
  f.bridge.handleEvent({ t: 'reloadStart', weapon: 'rifle', time: 2 }, f.ctx);
  assert.equal(f.sounds[0].voice.playing, true);
  f.bridge.handleEvent({ t: 'weaponSwap' }, f.ctx);
  f.bridge.handleEvent({ t: 'reloadStart', weapon: 'pistol', time: 1.35 }, f.ctx);
  assert.ok(f.sounds.every(s => s.voice.playing), 'cancelling queued hand actions must not cancel just-played input feedback');
  f.bridge.reset(); assert.ok(f.sounds.every(s => !s.voice.playing), 'reset releases immediate cues too');
});

test('all nine reload families preserve their cue order and scaling without native future starts', () => {
  const expected = {
    pistol: ['pistol_mag_out', 'pistol_mag_in', 'pistol_slide'],
    revolver: ['pistol_mag_out', 'shell_drop_brass', 'shotgun_shell_in', 'shotgun_shell_in', 'pistol_slide'],
    smg: ['smg_mag_out', 'smg_mag_in', 'smg_bolt'], shotgun: [],
    rifle: ['rifle_mag_out', 'rifle_mag_in', 'rifle_bolt'],
    lmg: ['lmg_cover_open', 'lmg_belt_in', 'lmg_belt_in', 'lmg_cover_close', 'lmg_rack'],
    minigun: ['lmg_cover_open', 'lmg_belt_in', 'lmg_belt_in', 'lmg_cover_close', 'lmg_rack'],
    sniper: ['sniper_bolt_open', 'sniper_mag', 'sniper_bolt_close'], rpg: ['rpg_reload'],
  };
  for (const weapon of WEAPON_ORDER) {
    const f = fixture(), duration = WEAPONS[weapon].reload * .55;
    f.bridge.handleEvent({ t: 'reloadStart', weapon, time: duration }, f.ctx);
    const pending = f.bridge.foleyPending.map(cue => ({ name: cue.name, time: cue.remaining }));
    let elapsed = 0;
    for (const cue of pending) {
      f.tick(cue.time - elapsed); elapsed = cue.time;
      assert.equal(f.sounds.at(-1).name, cue.name, weapon);
    }
    assert.deepEqual(f.sounds.map(s => s.name.replace('guns/', '')), expected[weapon], weapon);
    assert.equal(f.bridge.foleyPending.length, 0, weapon);
  }
});

test('shotgun pump, sniper bolt and grenade throw cues also freeze with hand animation', () => {
  for (const weapon of ['shotgun', 'sniper']) {
    const f = fixture();
    f.bridge.handleEvent({ t: 'shot', src: 'player', weapon, origin: [0, 1, 0], rays: [] }, f.ctx);
    const before = f.sounds.length; f.audio.now += 10;
    assert.equal(f.sounds.length, before);
    f.tick(.7);
    assert.equal(f.sounds.filter(s => /pump|bolt/.test(s.name)).length, weapon === 'shotgun' ? 1 : 2);
  }
  const f = fixture(); f.bridge.handleEvent({ t: 'grenadeThrow' }, f.ctx);
  assert.deepEqual(f.sounds.map(s => s.name), ['guns/grenade_pin']);
  f.audio.now += 10; f.tick(.22);
  assert.deepEqual(f.sounds.map(s => s.name), ['guns/grenade_pin', 'guns/grenade_throw']);
});


test('mounted minigun reload uses its full 5.2 second feed-drum sequence and pauses with game time',()=>{
  const f=fixture();assert.equal(WEAPONS.minigun.reload,5.2);
  f.bridge.handleEvent({t:'reloadStart',weapon:'minigun'},f.ctx);
  const expected=[['guns/lmg_cover_open',.312],['guns/lmg_belt_in',1.872],['guns/lmg_belt_in',2.912],['guns/lmg_cover_close',4.16],['guns/lmg_rack',4.888]];
  assert.equal(f.bridge.foleyPending.length,5);
  f.bridge.foleyPending.forEach((cue,i)=>{assert.equal(cue.name,expected[i][0]);assert.ok(Math.abs(cue.remaining-expected[i][1])<1e-12);});
  f.audio.now+=50;f.tick(0);assert.equal(f.sounds.length,0);
  f.tick(.313);assert.equal(f.sounds.at(-1).name,expected[0][0]);assert.equal(f.sounds.at(-1).options.pitch,.85);
  f.bridge.handleEvent({t:'reloadCancel'},f.ctx);f.tick(5.2);
  assert.equal(f.sounds.length,1);assert.equal(f.bridge.foleyPending.length,0);assert.equal(f.sounds[0].voice.playing,false);
});
