// Actual WORK Sim/Run source regressions. Authored only; root owns execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sim, DT } from '../src/sim/sim.js';
import { Run } from '../src/game/run.js';
import { GunnerController } from '../src/game/gunner.js';
import { Leviathan } from '../src/sim/boss.js';
import { BOSS_PARTS } from '../src/data/boss.js';
import { weaponStats } from '../src/data/weapons.js';
import { COMBO_NAMES, applyBossChip } from '../src/sim/combat.js';
import { NET_PROTOCOL, RUN_JSON_TYPES } from '../src/net/run_packet.js';
import { KILL_CASH, ECONOMY } from '../src/data/economy.js';

async function withSim(fn) {
  const sim = await new Sim({ seed: 7 }).init();
  try {
    sim.world.gravity = { x: 0, y: 0, z: 0 }; sim.director.enabled = false; sim.director.r = () => .2;
    sim.encounters.plan = []; sim.encounters.sim = sim; sim.hazards.update = () => {};
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 40 });
    sim.world.step(sim.eventQueue); for (const car of sim.cars.values()) car.veh.afterStep();
    sim.start(); sim.configureCombat('combat-life-A', { weapons: ['pistol','shotgun','sniper','minigun'], levels: {} }); sim.drainEvents();
    await fn(sim, player);
  } finally { sim.dispose(); }
}
function report(car, weapon = 'pistol', extra = {}) {
  const w = weaponStats(weapon), zone = car.zones.find(z => z.kind === (extra.zone || 'body')) || car.zones[0];
  const local = new THREE.Vector3().fromArray(zone.c);
  return { carId: car.id, weapon, shotId: 1, pelletIndex: 0, penetrationIndex: 0, dmg: w.dmg, tireMul: w.tireMul || 1,
    point: local.clone().applyQuaternion(car.veh.quat).add(car.veh.pos).toArray(), localPoint: local.toArray(), poseRevision: car.veh.poseRevision || 0,
    dir: [0,0,1], zone: zone.kind, zoneIndex: zone.index ?? -1, through: false, ...extra };
}
function earn(sim, n = 20) {
  const targets = [];
  for (let i = 0; i < n; i++) {
    sim.combat.advance(.1); const target = sim.spawnCar('e_sedan', { s: 400 + (sim.nextId + i) * 30, d: 30 }); targets.push(target);
    sim.damageCar(target, target.hp + 1, { cause: 'bullet', src: 1 });
  }
  return targets;
}
function runFixture(sim, role = 'driver', isHost = true) {
  const seen = { feeds: [], states: [], receipts: [], sent: [], markers: 0 };
  const g = { camera: new THREE.PerspectiveCamera(), input: { bindings: { nuke: ['KeyN'] }, lastDevice: 'kbm', rumble() {} },
    hud: { feed: text => seen.feeds.push(text), setCombat: state => seen.states.push(state), gh: { damageReceipt: e => seen.receipts.push(e) },
      hitMarker() { seen.markers++; }, message() {}, damageFlash() {} } };
  const roles = isHost ? { host: role, guest: role === 'driver' ? 'gunner' : 'driver' } : { guest: role, host: role === 'driver' ? 'gunner' : 'driver' };
  const net = { isHost, activeRunRoles: roles, sendJSON: m => { seen.sent.push(m); return true; } };
  const run = new Run(g, { role, seed: 7, runId: 'combat-life-A', net });
  run.sim = sim; run.player = sim?.player; run.effects = { cashMul: 1, weapons: ['pistol','shotgun','sniper','minigun'] };
  run.states = new Map(); run.started = true; run.simState = 'run';
  return { run, seen, net };
}
const request = (seq, runId = 'combat-life-A') => ({ t: 'nuke', runId, seq });

// Only view consumers are declared here. Run.update, its local nuke ingress,
// peer routing and the actual Sim entitlement/terminal methods stay unchanged.
function updateConsumers(run, spec) {
  const noop = () => {};
  Object.assign(run, { spec, introDone: true,
    wv: { viewMap: new Map(), cars: new Map(), updateBoss: noop, update: noop, handleEvent: noop },
    hazMarks: { update: noop, handleEvent: noop },
    banner: { update: noop, miniboss: noop, hazard: noop, event: noop, bossBeat: noop },
    threatHud: { setVisible: noop, update: noop } });
  run.g.scene = new THREE.Scene();
}
function quietCommands() {
  return { driver: { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false,
    special1: false, special2: false, medkit: false, reset: false, lookX: 0, lookY: 0,
    mouseYaw: 0, mousePitch: 0, lookBack: false, cameraToggle: false, horn: false },
  gunner: { dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false, reload: false,
    grenade: false, medkit: false, viewToggle: false, slot: -1, swap: 0 } };
}

test('actual combo names cover every second through twentieth terminal kill and expire at represented 3.5 seconds', async () => {
  assert.equal(COMBO_NAMES.length, 21);
  assert.ok(COMBO_NAMES.slice(2).every(name => typeof name === 'string' && name.length > 0));
  assert.equal(new Set(COMBO_NAMES.slice(2)).size, 19);
  assert.equal(COMBO_NAMES[4], 'QUADRUPLE KILL'); assert.equal(COMBO_NAMES[5], 'PENTAKILL');
  assert.equal(COMBO_NAMES[20], 'SUPER ULTRA MEGA KILL');
  await withSim(sim => {
    const target = sim.spawnCar('e_sedan', { s: 180, d: 30 });
    sim.damageCar(target, target.hp + 1, { cause: 'bullet', src: 1 });
    assert.equal(sim.combat.lastKillAt, 0); assert.equal(sim.combat.combo, 1);
    sim.combat.advance(3.5);
    assert.equal(sim.combat.clock - sim.combat.lastKillAt, 3.5);
    assert.equal(sim.combat.combo, 0, 'exact represented deadline retains the unchanged >=3.5 policy');
  });
});

test('actual Sim rejects changed same-ray damage replays while all genuine shotgun pellets and sniper passes remain valid', async () => {
  await withSim(sim => {
    const target = sim.spawnCar('e_heavy', { s: 80 }); const before = target.hp;
    for (let pelletIndex = 0; pelletIndex < 9; pelletIndex++) assert.equal(sim.applyHit(report(target, 'shotgun', { pelletIndex })), true);
    assert.equal(before - target.hp, 90); const hp = target.hp;
    assert.equal(sim.applyHit(report(target, 'shotgun', { pelletIndex: 0, localPoint: [0,.1,0], point: [0,.1,0] })), false);
    assert.equal(target.hp, hp); assert.equal(sim.stats.hits, 1);
    const heavy = sim.spawnCar('e_heavy', { s: 130 }); heavy.hp = 1000;
    for (let penetrationIndex = 0; penetrationIndex <= 2; penetrationIndex++) assert.equal(sim.applyHit(report(heavy, 'sniper', { shotId: 2, penetrationIndex, dmg: penetrationIndex ? 90 : 150 })), true);
    assert.equal(heavy.hp, 670); assert.equal(sim.stats.hits, 2);
    assert.equal(sim.applyHit(report(heavy, 'sniper', { shotId: 3, dmg: 10000 })), false);
    assert.equal(sim.applyHit(report(heavy, 'sniper', { shotId: 3, tireMul: 16 })), false);
    assert.equal(sim.applyHit(report(heavy, 'sniper', { shotId: 3, poseRevision: 99 })), false);
    assert.equal(heavy.hp, 670);
  });
});

test('actual Gunner outer pellet and penetration loops produce legal stable slots without merging same-shot contacts', () => {
  const records = [], car = { id: 2, veh: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), poseRevision: 0 } };
  const gunner = new GunnerController({ weapons: ['shotgun','sniper'], levels: {} }, {
    ownCar: () => car, targets: () => [], emit() {}, report: r => records.push(r), raycastWorld: () => null,
  });
  gunner.muzzle.set(0,1,0); gunner.aimPoint.set(0,1,30); gunner.aimAt = () => gunner.aimPoint;
  gunner._raycastAll = o => ({ car, point: o.clone().add(new THREE.Vector3(0,0,4)), zone: { kind: 'body' }, world: false });
  gunner.fire({ position: new THREE.Vector3(0,1,-1), dir: new THREE.Vector3(0,0,1) });
  assert.equal(records.length, 9); assert.deepEqual(records.map(r => r.pelletIndex), [0,1,2,3,4,5,6,7,8]); assert.ok(records.every(r => r.penetrationIndex === 0 && r.shotId === 1));
  records.length = 0; gunner.cur = 1;
  gunner.fire({ position: new THREE.Vector3(0,1,-1), dir: new THREE.Vector3(0,0,1) });
  assert.deepEqual(records.map(r => [r.pelletIndex,r.penetrationIndex,r.shotId]), [[0,0,2],[0,1,2],[0,2,2]]);
});

test('actual positive receipts use subsystem/crew deltas and zero-damage deflect/dead-crew contacts produce no words', async () => {
  await withSim(sim => {
    const fuel = sim.spawnCar('e_sedan', { s: 80 });
    assert.equal(sim.applyHit(report(fuel, 'pistol', { zone: 'fuel' })), true);
    const first = sim.events.find(e => e.t === 'damageReceipt'); assert.equal(first.zone, 'fuel'); assert.ok(first.damage > 0);
    const driver = sim.spawnCar('e_sedan', { s: 150 }); driver.crew.driver.hp = 1;
    assert.equal(sim.applyHit(report(driver, 'pistol', { shotId: 2, zone: 'driver' })), true);
    const down = sim.events.find(e => e.t === 'damageReceipt' && e.shotId === 2); assert.equal(down.damage, 1); assert.equal(down.killed, true);
    assert.equal(sim.applyHit(report(driver, 'pistol', { shotId: 3, zone: 'driver' })), true);
    assert.equal(sim.events.some(e => e.t === 'damageReceipt' && e.shotId === 3), false);
    const armor = sim.spawnCar('e_sedan', { s: 220 }); armor.spec = { ...armor.spec, weakpoint: { zone: 'fuel' } };
    assert.equal(sim.applyHit(report(armor, 'pistol', { shotId: 4 })), true);
    assert.equal(sim.events.some(e => e.t === 'damageReceipt' && e.shotId === 4), false);
    assert.equal(sim.combat.combo, 0, 'crew-only deaths do not count as vehicle deaths');
  });
});

test('actual configured Sim rejects countdown/dead/terminal hit packets before any slot or damage mutation', async () => {
  await withSim((sim, player) => {
    const target = sim.spawnCar('e_sedan', { s: 80 }), hit = report(target), hp = target.hp;
    for (const state of ['countdown','dying','over']) { sim.state = state; assert.equal(sim.applyHit(hit), false); assert.equal(target.hp, hp); assert.equal(sim.hitGuard.shots.size, 0); }
    sim.state = 'run'; const playerHp = player.hp; player.hp = 0; assert.equal(sim.applyHit(hit), false); assert.equal(sim.hitGuard.shots.size, 0);
    player.hp = playerHp; assert.equal(sim.applyHit(hit), true); assert.ok(target.hp < hp);
  });
});

test('actual Stage hit validation precedes replay reservation and terminal shooter receipts earn exactly once', async () => {
  await withSim(sim => {
    const p = sim.road.pointAt(90, 18, {}), site = { id:'receipt-fixture',s0:90,biome:'desert' };
    const actor = sim.encounters._create(sim,'tower',site,new THREE.Vector3(p.x,p.y+3,p.z),{x:.5,y:1,z:.5},8);
    const valid = report(actor,'pistol',{zone:'gunner'}), hp = actor.hp;
    assert.equal(sim.applyHit({...valid,zone:'unknown-stage-zone'}),false);
    assert.equal(actor.hp,hp); assert.equal(sim.hitGuard.shots.size,0);
    assert.equal(sim.applyHit(valid),true); assert.equal(actor.dead,true); assert.equal(sim.combat.combo,1);
    const receipt = sim.events.find(e=>e.t==='damageReceipt'); assert.equal(receipt.zone,'gunner'); assert.equal(receipt.damage,8); assert.equal(receipt.killed,true);
    assert.equal(sim.applyHit(valid),false); sim.encounters._kill(actor,{src:1,cause:'bullet'},sim);
    assert.equal(sim.combat.combo,1); assert.equal(sim.events.filter(e=>e.t==='kill'&&e.id===actor.id).length,1);
    const far = sim.spawnCar('e_sedan',{s:3000});
    far.veh.body.setTranslation({x:sim.player.veh.pos.x+1200,y:sim.player.veh.pos.y,z:sim.player.veh.pos.z},true); far.veh.afterStep();
    assert.ok(far.veh.pos.distanceTo(sim.player.veh.pos)>900); const farHit=report(far,'pistol',{shotId:2});
    assert.equal(sim.applyHit(farHit),false); assert.equal(sim.hitGuard.shots.has(2),false);
    const nearby = sim.spawnCar('e_sedan',{s:120}); assert.equal(sim.applyHit(report(nearby,'pistol',{shotId:2})),true);
  });
});

test('actual twenty unique terminal Sim deaths earn one charge and duplicate terminal callbacks cannot refresh it', async () => {
  await withSim(sim => {
    const targets = earn(sim); assert.equal(sim.combat.combo, 20); assert.equal(sim.combat.state().label, COMBO_NAMES[20]); assert.equal(sim.combat.award, 1); assert.equal(sim.combat.ready, true);
    sim.explodeCar(targets[19], 'bullet', 1); assert.equal(sim.combat.combo, 20); assert.equal(sim.stats.kills, 20);
    // Cross the represented deadline by one legal 120Hz tick.
    // The earlier summed timestamp can remain fractionally before 3.5s.
    sim.combat.advance(3.5); sim.combat.advance(DT);
    assert.ok(sim.combat.clock - sim.combat.lastKillAt > 3.5);
    assert.equal(sim.combat.combo, 0); assert.equal(sim.combat.ready, true);
    assert.ok(sim.events.some(e => e.t === 'combatState' && e.state.combo === 2 && e.state.label === 'DOUBLE KILL'));
  });
});

test('actual Sim nuke clears only living ordinary cars/shooters/barrels without explosion chains, own HP damage or recharge', async () => {
  await withSim((sim, player) => {
    earn(sim); sim.drainEvents();
    const target = sim.spawnCar('e_sedan', { s: 90 }); target.fuseT = .3; target.burning = 1;
    const elite = sim.spawnCar('e_sedan', { s: 120 }); elite.elite = { index: 0 }; const bossHp = elite.hp;
    const site = { id: 'fixture', s0: 90, biome: 'desert' };
    const actor = kind => sim.encounters._create(sim, kind, site, new THREE.Vector3(20,3,70), { x: .5,y:1,z:.5 }, 100);
    const tower = actor('tower'), barrel = actor('barrel'), rock = actor('rock'), arch = actor('arch');
    sim.encounters._body(sim, barrel, barrel.half, [0,0,0], true); const body = barrel.body;
    const hp = player.hp, beforeBodies = sim.world.bodies.len();
    const result = sim.activateNuke(request(1)); assert.equal(result.ok, true);
    assert.equal(target.exploded, true); assert.equal(target.fuseT, -1); assert.equal(target.burning, 0);
    assert.equal(tower.dead, true); assert.equal(barrel.dead, true); assert.equal(body.isValid(), false); assert.ok(sim.world.bodies.len() < beforeBodies);
    assert.equal(rock.dead, false); assert.equal(arch.dead, false); assert.equal(elite.exploded, false); assert.ok(elite.hp >= bossHp*.9 - 1e-6);
    assert.equal(player.hp, hp); assert.equal(sim.combat.combo, 0); assert.equal(sim.combat.ready, false); assert.equal(sim.combat.award, 1);
    assert.equal(sim.events.some(e => ['explode','boom','stageBreak','fuelLeak'].includes(e.t)), false);
    assert.equal(sim.events.filter(e => e.t === 'combatNuke').length, 1);
    assert.equal(sim.activateNuke(request(1)).ok, false); assert.equal(sim.activateNuke(request(2)).ok, false);
  });
});

test('real crash -> Director fuse -> source removal -> _burning death retains nuke provenance and cannot earn another step', async () => {
  await withSim(sim => {
    earn(sim); const wreck = sim.spawnCar('e_sedan', { s: 90 }); assert.equal(sim.activateNuke(request(1)).ok, true); sim.drainEvents();
    const victim = sim.spawnCar('e_sedan', { s: 95 }); sim.world.step(sim.eventQueue); victim.veh.afterStep(); wreck.veh.afterStep();
    sim._crash(victim, wreck, victim.veh.mass * 2 / DT, { x:0,y:0,z:1 }, DT);
    assert.equal(sim.combat.nukeEpoch(victim), sim.combat.nukeEpoch(wreck));
    sim.director.onCrash(sim, victim, wreck, 6); assert.ok(victim.fuseT >= 0);
    sim.removeCar(wreck, 'fixture source retirement'); sim._burning(1);
    assert.equal(victim.exploded, true); assert.equal(sim.combat.combo, 0); assert.equal(sim.combat.ready, false);
    assert.equal(sim.events.some(e => e.t === 'explode' || e.t === 'boom'), false);
    const kill = sim.events.find(e => e.t === 'kill' && e.id === victim.id); assert.equal(kill?.nukeDerived, true);
  });
});

test('real _crash cannot use nuke wreck collateral to bypass boss chip or hurt the player', async () => {
  await withSim((sim, player) => {
    earn(sim); const wreck = sim.spawnCar('e_sedan', { s: 90 }); assert.equal(sim.activateNuke(request(1)).ok, true);
    const elite = sim.spawnCar('e_heavy', { s: 130 }); elite.elite = { index: 0 };
    for (const target of [player, elite]) {
      const hp = target.hp; sim._crash(target, wreck, target.veh.mass * 20 / DT, { x:0,y:0,z:1 }, DT);
      assert.equal(target.hp, hp); assert.equal(sim.combat.nukeEpoch(target), null);
    }
  });
});

test('actual Stage blast descendants inherit nuke provenance before lethal barrel and shooter mutation', async () => {
  await withSim(sim => {
    earn(sim); const wreck=sim.spawnCar('e_sedan',{s:90}); assert.equal(sim.activateNuke(request(1)).ok,true); sim.drainEvents();
    const p=sim.road.pointAt(180,30,{}), position=new THREE.Vector3(p.x,p.y+2,p.z), site={id:'late-descendants',s0:180,biome:'desert'};
    const tower=sim.encounters._create(sim,'tower',site,position,{x:.5,y:1,z:.5},5);
    const barrel=sim.encounters._create(sim,'barrel',site,position.clone().add(new THREE.Vector3(1,0,0)),{x:.46,y:.69,z:.46},5);
    sim.encounters._body(sim,barrel,barrel.half,[0,0,0],true); const body=barrel.body;
    sim.encounters.blast(position,5,100,1,sim,wreck);
    assert.equal(tower.dead,true); assert.equal(barrel.dead,true); assert.equal(body.isValid(),false);
    assert.equal(sim.combat.nukeEpoch(tower),sim.combat.nukeEpoch(wreck)); assert.equal(sim.combat.nukeEpoch(barrel),sim.combat.nukeEpoch(wreck));
    assert.equal(sim.combat.combo,0); assert.equal(sim.combat.ready,false);
    assert.equal(sim.events.some(e=>e.t==='boom'||e.t==='stageBreak'||e.t==='explode'),false);
    assert.equal(sim.events.find(e=>e.t==='kill'&&e.id===tower.id)?.nukeDerived,true);
  });
});

test('actual oversized nuke membership fails before consuming readiness or clearing any live car', async () => {
  await withSim(sim => {
    earn(sim); const targets=Array.from({length:65},(_,i)=>sim.spawnCar('e_sedan',{s:2000+i*15,d:30})); sim.drainEvents();
    const result=sim.activateNuke(request(1)); assert.equal(result.ok,false); assert.equal(result.reason,'unsafe-effect');
    assert.equal(sim.combat.ready,true); assert.equal(sim.combat.combo,20); assert.equal(sim.events.length,0);
    assert.ok(targets.every(c=>c.hp===c.maxHp&&!c.dead&&!c.exploded&&!sim.combat.nukeEpoch(c)));
  });
});

test('actual elite chip cannot cross Sim auto-ignition and actual Leviathan weak/phase chip cannot destroy a part', async () => {
  await withSim(sim => {
    const elite = sim.spawnCar('e_sedan', { s: 90 }); elite.elite = { index: 0 }; elite.hp = elite.maxHp*.20; elite.burning = 0;
    const before = elite.hp, dealt = applyBossChip(sim, 300, .1); assert.ok(dealt > 0 && dealt <= elite.maxHp*.1);
    assert.ok(elite.hp >= elite.maxHp*.16); sim._burning(1); assert.equal(elite.burning, 0); assert.equal(elite.hp, before-dealt);
    const boss = Object.create(Leviathan.prototype); Object.assign(boss, { sim, id:60000, hp:{}, alive:{}, phase:3, dead:false, exploded:false });
    for (const [name, def] of Object.entries(BOSS_PARTS)) { boss.hp[name]=def.hp; boss.alive[name]=name==='part_engine'; }
    boss.hp.part_engine=4; boss._destroyPart=()=>assert.fail('nuke must remain nonlethal'); sim.boss=boss;
    elite.hp=elite.maxHp*.16; assert.equal(applyBossChip(sim, 300, .1),3); assert.equal(boss.hp.part_engine,1); assert.equal(boss.dead,false);
    boss.phase=1; boss.hp.part_engine=400; assert.equal(applyBossChip(sim,300,.1),0); assert.equal(boss.hp.part_engine,400);
  });
});

test('actual malformed/old/early-rejected nuke requests do not consume or mutate a future genuine charge', async () => {
  await withSim(sim => {
    assert.equal(sim.activateNuke(request(1),'peer').ok,false); earn(sim); const target=sim.spawnCar('e_sedan',{s:90}); const hp=target.hp;
    for (const bad of [{...request(2), ready:true},{...request(2), targets:[1]},request(2,'old-life'),{...request(2),seq:Infinity}]) assert.equal(sim.activateNuke(bad,'peer').ok,false);
    assert.equal(sim.activateNuke(request(1),'peer').ok,false); assert.equal(target.hp,hp); assert.equal(sim.combat.ready,true);
    assert.equal(sim.activateNuke(request(2),'peer').ok,true); assert.equal(target.exploded,true); assert.equal(sim.activateNuke(request(2),'peer').ok,false);
    sim.configureCombat('combat-life-B',{weapons:['pistol'],levels:{}}); assert.equal(sim.combat.ready,false);
    assert.equal(sim.activateNuke(request(3),'peer').ok,false); assert.equal(sim.hitGuard.shots.size,0);
  });
});

test('actual Run honours isolated remote activation in both room-host ownership arrangements', async () => {
  for (const isHost of [true,false]) await withSim(sim => {
    earn(sim); const target=sim.spawnCar('e_sedan',{s:90}); const {run,net}=runFixture(sim,'driver',isHost);
    run.onNet(request(1,'previous-life')); assert.equal(target.exploded,false);
    net.activeRunRoles[isHost?'guest':'host']='driver'; run.onNet(request(1)); assert.equal(target.exploded,false);
    net.activeRunRoles[isHost?'guest':'host']='gunner'; run.onNet(request(1)); assert.equal(target.exploded,true);
    run.onNet(request(1)); assert.equal(sim.events.filter(e=>e.t==='combatNuke').length,1);
  });
});

test('actual local and viewer Run activation methods route one shared entitlement in both host-role arrangements', async () => {
  for(const isHost of [true,false]) await withSim(sim => {
    earn(sim); const first=sim.spawnCar('e_sedan',{s:90}), {run:authority}=runFixture(sim,'driver',isHost);
    assert.equal(authority._requestNuke(),true); assert.equal(first.exploded,true); assert.equal(authority.nukeRequestSeq,1);
    assert.equal(authority._requestNuke(),false); assert.equal(sim.events.filter(e=>e.t==='combatNuke').length,1);
    earn(sim); const second=sim.spawnCar('e_sedan',{s:100}), {run:viewer,seen}=runFixture(null,'gunner',!isHost);
    assert.equal(viewer._requestNuke(),true); assert.deepEqual(seen.sent.at(-1),request(1));
    authority.onNet(seen.sent.at(-1)); assert.equal(second.exploded,true); assert.equal(sim.combat.ready,false);
    authority.onNet(seen.sent.at(-1)); assert.equal(sim.events.filter(e=>e.t==='combatNuke').length,2);
    viewer.simState='dying'; const seq=viewer.nukeRequestSeq;
    assert.equal(viewer._requestNuke(),false); assert.equal(viewer.nukeRequestSeq,seq);
  });
});

test('actual networked driver Run.update never reads local nuke input while paused and activates after unpause', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
  try {
    for (const isHost of [true, false]) await withSim((sim, player) => {
      earn(sim); sim.drainEvents(); const target = sim.spawnCar('e_sedan', { s: 90 }); sim.drainEvents();
      const { run } = runFixture(sim, 'driver', isHost); updateConsumers(run, player.spec);
      let reads = 0; run.g.input.nukePressed = () => { reads++; return true; };
      run.g.paused = true;
      run.update(DT, quietCommands(), 0);
      assert.equal(reads, 0); assert.equal(run.nukeRequestSeq, 0);
      assert.equal(target.exploded, false); assert.equal(sim.combat.ready, true);
      assert.equal(run.allEvents.some(e => e.t === 'combatNuke'), false);
      run.g.paused = false;
      run.update(DT, quietCommands(), DT);
      assert.equal(reads, 1); assert.equal(run.nukeRequestSeq, 1);
      assert.equal(target.exploded, true); assert.equal(sim.combat.ready, false);
      assert.equal(run.allEvents.filter(e => e.t === 'combatNuke').length, 1);
    });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
  }
});

test('actual networked gunner Run.update suppresses paused local ingress before its edge read and active peer routing clears the charge', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
  try {
    for (const isHost of [true, false]) await withSim((sim, player) => {
      earn(sim); sim.drainEvents(); const target = sim.spawnCar('e_sedan', { s: 90 }); sim.drainEvents();
      const { run: authority } = runFixture(sim, 'driver', isHost);
      const { run: viewer, seen } = runFixture(null, 'gunner', !isHost); updateConsumers(viewer, player.spec);
      let reads = 0; viewer.g.input.nukePressed = () => { reads++; return true; };
      viewer.g.paused = true;
      viewer.update(DT, quietCommands(), 0);
      assert.equal(reads, 0); assert.equal(viewer.nukeRequestSeq, 0); assert.equal(seen.sent.length, 0);
      assert.equal(target.exploded, false); assert.equal(sim.combat.ready, true);
      viewer.g.paused = false;
      viewer.update(DT, quietCommands(), DT);
      assert.equal(reads, 1); assert.equal(viewer.nukeRequestSeq, 1); assert.deepEqual(seen.sent, [request(1)]);
      authority.onNet(seen.sent[0]);
      assert.equal(target.exploded, true); assert.equal(sim.combat.ready, false);
      assert.equal(sim.events.filter(e => e.t === 'combatNuke').length, 1);
    });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
  }
});

test('actual paused local nuke requests preserve sequence and charge while an active peer can still activate under authority UI pause', async () => {
  for (const isHost of [true, false]) await withSim(sim => {
    earn(sim); sim.drainEvents(); const target = sim.spawnCar('e_sedan', { s: 90 }); sim.drainEvents();
    const { run: authority } = runFixture(sim, 'driver', isHost);
    const { run: viewer, seen } = runFixture(null, 'gunner', !isHost);
    authority.g.paused = viewer.g.paused = true;
    assert.equal(authority._requestNuke(), false); assert.equal(viewer._requestNuke(), false);
    assert.equal(authority.nukeRequestSeq, 0); assert.equal(viewer.nukeRequestSeq, 0); assert.equal(seen.sent.length, 0);
    assert.equal(sim.combat.requestSeq.local, 0); assert.equal(sim.combat.requestSeq.peer, 0);
    assert.equal(sim.combat.ready, true); assert.equal(target.exploded, false); assert.equal(sim.events.length, 0);
    viewer.g.paused = false;
    assert.equal(viewer._requestNuke(), true); assert.deepEqual(seen.sent, [request(1)]);
    assert.equal(authority.g.paused, true); authority.onNet(seen.sent[0]);
    assert.equal(authority.nukeRequestSeq, 0); assert.equal(sim.combat.ready, false); assert.equal(target.exploded, true);
    assert.equal(sim.events.filter(e => e.t === 'combatNuke').length, 1);
  });
});

test('actual Run viewer cannot author state and shotfx cannot forge cash, entitlement or combat UI', async () => {
  for (const isHost of [true,false]) await withSim(sim => {
    const {run,seen}=runFixture(sim,'driver',isHost); const sourceCash=run.cash;
    run.onNet({t:'shotfx',runId:run.id,e:[{t:'kill',id:2,spec:'e_sedan'},{t:'minibossDown',index:0},{t:'combatState',state:{ready:true}},{t:'damageReceipt',damage:999},{t:'combatNuke',award:999}]});
    assert.equal(sim.events.length,0); run._simEventsToRun(); assert.equal(run.cash,sourceCash); assert.equal(sim.combat.combo,0); assert.equal(seen.states.length,0);
    run.onNet({t:'shotfx',runId:run.id,e:[{t:'shot',src:'player',weapon:'pistol',origin:[0,2,0],rays:[{end:[0,2,40]}]}]});
    assert.equal(sim.events.length,1); assert.equal(sim.events[0].t,'shot'); assert.equal(sim.events[0].remote,true);
    run._simEventsToRun([{t:'kill',id:2,spec:'e_sedan',remote:true}]); assert.equal(run.cash,sourceCash);
  });
});

test('actual viewer Run accepts only driver-origin monotonic current-life state/receipts and disposal clears presentation', () => {
  for(const isHost of [true,false]) {
    const {run,seen,net}=runFixture(null,'gunner',isHost), state={runId:run.id,revision:1,combo:2,best:2,label:'DOUBLE KILL',ready:false,award:0,expiresIn:3.5};
    const receipt={t:'damageReceipt',runId:run.id,revision:1,shotId:1,pelletIndex:0,penetrationIndex:0,targetId:2,zone:'fuel',damage:1,killed:false};
    const events={t:'events',runId:run.id,e:[{t:'combatState',state},receipt]};
    net.activeRunRoles[isHost?'guest':'host']='gunner'; run.onNet(events); assert.equal(seen.states.length,0);
    net.activeRunRoles[isHost?'guest':'host']='driver'; run.onNet({...events,runId:'old-life'}); assert.equal(seen.states.length,0);
    run.onNet(events); assert.equal(seen.states.length,1); assert.equal(seen.receipts.length,1); run.onNet(events); assert.equal(seen.states.length,1); assert.equal(seen.receipts.length,1);
    run.dispose(); assert.equal(run.combatHud,null); assert.equal(seen.states.at(-1),null);
  }
});

test('actual Run preserves ordinary kill cash once, pays nuke base once and resets displayed combo without self-charge', async () => {
  await withSim(sim => {
    const {run,seen}=runFixture(sim); earn(sim); const earned=sim.drainEvents(); run._simEventsToRun(earned);
    assert.ok(run.cash>0); assert.equal(run.multi,20); const before=run.cash;
    const target=sim.spawnCar('e_sedan',{s:90}); assert.equal(sim.activateNuke(request(1)).ok,true); run._simEventsToRun(sim.drainEvents());
    const expected=Math.round((KILL_CASH[target.spec.id]||60)*(1+sim.director.level*ECONOMY.killLevel));
    assert.equal(run.cash-before,expected); assert.equal(run.multi,0); assert.equal(run.streakT,0); assert.equal(sim.combat.combo,0);
    sim.explodeCar(target,'nuke',1); run._simEventsToRun(sim.drainEvents()); assert.equal(run.cash-before,expected);
    assert.ok(seen.feeds.at(-1).includes('NUKE')); assert.equal(NET_PROTOCOL,8); assert.equal(RUN_JSON_TYPES.has('nuke'),true);
  });
});
