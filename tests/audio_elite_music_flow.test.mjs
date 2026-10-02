import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioBridge } from '../src/view/audio_bridge.js';
import { Director } from '../src/sim/director.js';
import { CAMPAIGN_BOSSES } from '../src/data/boss.js';
import { TEN_LEVELS } from '../src/data/campaign.js';

function fixture(localRole = 'solo') {
  const states = [], intensities = [], stingers = [];
  const audio = {
    now: 0, expect() {}, rand: () => .5, engines: new Map(),
    listener: { distTo: () => 200 }, ambience: { stopWind() {} },
    play: () => ({ isNull: true }), setDanger() {}, concussion() {}, duck() {},
    stinger: name => stingers.push(name),
    music: { setState: state => states.push(state), setIntensity: value => intensities.push(value) },
  };
  const bridge = new AudioBridge(audio, { playerId: 1, localRole });
  return { bridge, audio, states, intensities, stingers };
}

function chapterFixture(level, f) {
  const journey = { version: 1, mode: 'campaign', level };
  const player = { s: TEN_LEVELS[level - 1].bossDistance, veh: { vf: 20 } };
  const events = [];
  const sim = { journey, player, cars: new Map(), time: 0,
    emit(e) { events.push(e); f.bridge.handleEvent(e); } };
  const director = new Director({ journey });
  let nextId = 2;
  // Exercise the real director's authored cohort and completion emitter. Body
  // placement/damage is outside this soundtrack event-flow test's scope.
  director.spawn = (_sim, _spec, _L, options) => {
    const c = { id: nextId++, s: options.at.s, hp: 100, maxHp: 100,
      exploded: false, driverless: false, fuseT: -1, ai: { pattern: {} } };
    sim.cars.set(c.id, c); return c;
  };
  return { director, sim, player, events, tick: () => director._bosses(sim, player, .5) };
}

test('all nine actual chapter encounter emissions route run to boss then back exactly once', () => {
  for (let level = 1; level <= 9; level++) {
    const f = fixture(); f.bridge.runStart();
    const c = chapterFixture(level, f); c.tick();
    assert.deepEqual(f.states, ['run', 'boss'], `chapter ${level}`);
    assert.equal(c.events[0].t, 'minibossSpawn');
    assert.equal(c.events[0].index, CAMPAIGN_BOSSES[level - 1].eliteIndex);
    for (const car of c.director.activeElite.cars) car.exploded = true;
    c.tick(); c.tick();
    assert.equal(c.director.campaignComplete, true);
    assert.deepEqual(c.events.slice(-2).map(e => e.t), ['minibossDown', 'campaignBossDown']);
    assert.deepEqual(f.states, ['run', 'boss', 'run'], `completion alias must not restart chapter ${level} music`);
    assert.deepEqual(f.intensities, [.1, .7, .3]);
    assert.deepEqual(f.stingers, ['run_start'], 'existing Run danger_riser owns the elite spawn stinger');
  }
});

test('actual Twin cohort stays in boss music through the first explosion and registry removal', () => {
  const f = fixture(); f.bridge.runStart();
  const c = chapterFixture(2, f); c.tick();
  const [a, b] = c.director.activeElite.cars;
  assert.equal(c.events[0].ids.length, 2);
  a.exploded = true;
  f.bridge.handleEvent({ t: 'explode', id: a.id, pos: [0, 0, 20], size: 1 });
  f.bridge.handleEvent({ t: 'remove', id: a.id });
  c.tick();
  assert.deepEqual(f.states, ['run', 'boss']);
  assert.equal(c.director.campaignComplete, false);
  assert.equal(f.bridge.musicElites.size, 1);
  b.exploded = true; c.tick();
  assert.deepEqual(f.states, ['run', 'boss', 'run']);
  assert.equal(f.bridge.musicElites.size, 0);
});

test('overlapping elite cohorts, duplicate spawns and unrelated completion cannot prematurely leave boss music', () => {
  const f = fixture(); f.bridge.runStart();
  f.bridge.handleEvent({ t: 'minibossSpawn', index: 0, name: 'SCRAPJAW', ids: [2] });
  f.bridge.handleEvent({ t: 'minibossSpawn', index: 0, name: 'SCRAPJAW', ids: [2] });
  f.bridge.handleEvent({ t: 'minibossSpawn', index: 1, name: 'THE BONECRUSHER TWINS', ids: [3, 4] });
  f.bridge.handleEvent({ t: 'minibossDown', index: 8, name: 'unrelated' });
  f.bridge.handleEvent({ t: 'minibossDown', index: 0, name: 'SCRAPJAW' });
  f.bridge.handleEvent({ t: 'campaignBossDown', level: 1, index: 0, name: 'SCRAPJAW' });
  assert.deepEqual(f.states, ['run', 'boss']);
  assert.equal(f.bridge.musicElites.size, 1);
  f.bridge.handleEvent({ t: 'minibossLost', index: 1, name: 'THE BONECRUSHER TWINS' });
  assert.deepEqual(f.states, ['run', 'boss', 'run']);
});

test('Marathon sequence can alternate nine complete elite fights without retaining an earlier owner', () => {
  const f = fixture(); f.bridge.runStart();
  for (const [chapter, M] of CAMPAIGN_BOSSES.entries()) {
    f.bridge.handleEvent({ t: 'minibossSpawn', index: M.eliteIndex, name: M.name, ids: [chapter + 2] });
    assert.equal(f.states.at(-1), 'boss');
    f.bridge.handleEvent({ t: 'minibossDown', index: M.eliteIndex, name: M.name });
    f.bridge.handleEvent({ t: 'campaignBossDown', level: chapter + 1, index: M.eliteIndex, name: M.name });
    assert.equal(f.states.at(-1), 'run'); assert.equal(f.bridge.musicElites.size, 0);
  }
  assert.equal(f.states.length, 19);
});

test('Leviathan retains boss ownership until actual victory even if an overlapping elite ends', () => {
  const f = fixture(); f.bridge.runStart();
  f.bridge.handleEvent({ t: 'minibossSpawn', index: 4, name: 'IRON PRIEST', ids: [2] });
  // Run invokes this once for bossSpawn before forwarding the event batch.
  f.bridge.bossIntro(); f.bridge.handleEvent({ t: 'bossSpawn', id: 99 });
  f.bridge.handleEvent({ t: 'minibossDown', index: 4, name: 'IRON PRIEST' });
  f.bridge.handleEvent({ t: 'bossDying' });
  assert.deepEqual(f.states, ['run', 'boss', 'boss']);
  assert.equal(f.bridge.musicFinalBoss, true);
  // Run's bossDown owner invokes victory once; the completion alias follows.
  f.bridge.victory(); f.bridge.handleEvent({ t: 'bossDown' });
  f.bridge.handleEvent({ t: 'campaignBossDown', level: 10, index: null, name: 'THE LEVIATHAN' });
  f.bridge.handleEvent({ t: 'minibossLost', index: 4, name: 'IRON PRIEST' });
  assert.equal(f.states.at(-1), 'victory');
  assert.deepEqual(f.stingers, ['run_start', 'boss_intro', 'victory']);
  assert.equal(f.bridge.musicElites.size, 0); assert.equal(f.bridge.musicFinalBoss, false);
});

test('defeat, run completion and reset discard stale elite events, while a new life can route normally', () => {
  for (const end of ['playerDown', 'runOver', 'reset']) {
    const f = fixture(); f.bridge.runStart();
    f.bridge.handleEvent({ t: 'minibossSpawn', index: 0, name: 'SCRAPJAW', ids: [2] });
    if (end === 'reset') f.bridge.reset(); else f.bridge.handleEvent({ t: end, why: 'gunner' });
    const terminalStates = [...f.states];
    f.bridge.handleEvent({ t: 'minibossDown', index: 0, name: 'SCRAPJAW' });
    f.bridge.handleEvent({ t: 'minibossSpawn', index: 1, name: 'TWINS', ids: [3, 4] });
    f.bridge.bossIntro();
    assert.deepEqual(f.states, terminalStates, end);
    assert.equal(f.bridge.musicElites.size, 0); assert.equal(f.bridge.musicFinalBoss, false);
    f.bridge.runStart();
    f.bridge.handleEvent({ t: 'minibossSpawn', index: 0, name: 'SCRAPJAW', ids: [5] });
    f.bridge.handleEvent({ t: 'minibossDown', index: 0, name: 'SCRAPJAW' });
    assert.deepEqual(f.states.slice(-3), ['run', 'boss', 'run'], end);
  }
});

test('host and guest event paths choose identical encounter music independent of local seat', () => {
  for (const localRole of ['solo', 'driver', 'gunner']) {
    const f = fixture(localRole); f.bridge.runStart();
    for (const e of [
      { t: 'minibossSpawn', index: 1, name: 'TWINS', ids: [2, 3] },
      { t: 'bossRejoined', index: 1, id: 4, previousId: 3 },
      { t: 'minibossDown', index: 1, name: 'TWINS' },
      { t: 'campaignBossDown', level: 2, index: 1, name: 'TWINS' },
    ]) f.bridge.handleEvent(e, { localRole });
    assert.deepEqual(f.states, ['run', 'boss', 'run'], localRole);
    assert.deepEqual(f.intensities, [.1, .7, .3], localRole);
  }
});

test('older named encounter events remain paired, but unidentified malformed events cannot take soundtrack ownership', () => {
  const f = fixture(); f.bridge.runStart();
  f.bridge.handleEvent({ t: 'minibossSpawn', ids: [2] });
  f.bridge.handleEvent({ t: 'minibossDown' });
  f.bridge.handleEvent({ t: 'minibossSpawn', name: 'named legacy encounter' });
  f.bridge.handleEvent({ t: 'minibossLost', name: 'named legacy encounter' });
  assert.deepEqual(f.states, ['run', 'boss', 'run']);
  assert.equal(f.bridge.musicElites.size, 0);
});
