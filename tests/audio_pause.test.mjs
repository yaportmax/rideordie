import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSys } from '../src/core/audio.js';

function mockAudio() {
  const parameter = () => ({
    targets: [], cancelled: [],
    cancelScheduledValues(time) { this.cancelled.push(time); },
    setTargetAtTime(value, time, rate) { this.targets.push({ value, time, rate }); },
  });
  const audio = Object.create(AudioSys.prototype);
  audio.ctx = { currentTime: 2 };
  audio.volumes = { master: 0.9, sfx: 0.85, music: 0.45, ambience: 0.55, ui: 0.9 };
  audio.masterGain = { gain: parameter() };
  audio.buses = Object.fromEntries(['sfx', 'music', 'ambience', 'ui'].map((name) => [name, { gain: parameter() }]));
  return audio;
}

test('gameplay pause keeps world muted through volume changes and restores latest levels', () => {
  const audio = mockAudio();
  audio.setGameplayPaused(true);
  assert.equal(audio.buses.sfx.gain.targets.at(-1).value, 0);
  assert.equal(audio.buses.ambience.gain.targets.at(-1).value, 0);
  assert.equal(audio.buses.music.gain.targets.length, 0);
  assert.equal(audio.buses.ui.gain.targets.length, 0);
  audio.setVolumes({ sfx: 0.3, ambience: 0.2, music: 0.4, ui: 0.5 });
  assert.equal(audio.buses.sfx.gain.targets.at(-1).value, 0);
  assert.equal(audio.buses.ambience.gain.targets.at(-1).value, 0);
  assert.equal(audio.buses.music.gain.targets.at(-1).value, 0.4);
  assert.equal(audio.buses.ui.gain.targets.at(-1).value, 0.5);
  const calls = audio.buses.sfx.gain.targets.length;
  audio.setGameplayPaused(true);
  assert.equal(audio.buses.sfx.gain.targets.length, calls);
  audio.setGameplayPaused(false);
  assert.equal(audio.buses.sfx.gain.targets.at(-1).value, 0.3);
  assert.equal(audio.buses.ambience.gain.targets.at(-1).value, 0.2);
});

test('changing master volume while tab-paused preserves silence', () => {
  const audio = mockAudio();
  audio._paused = true;
  audio.setVolumes({ master: 0.4 });
  assert.equal(audio.masterGain.gain.targets.at(-1).value, 0);
  assert.equal(audio.volumes.master, 0.4);
});
