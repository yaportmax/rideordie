// A single RUN (one life). Roles: 'solo' (sim + gunner + driver on one machine), 'driver' (sim peer), 'gunner' (viewer peer).
// The frame loop is owned by Game; Run only advances its own systems and exposes what the renderer needs.
import * as THREE from 'three';
import { RAPIER, initPhysics, createWorld, RAY_SHOT } from '../sim/physics.js';
import { Sim, DT } from '../sim/sim.js';
import { SyncGround } from '../sim/sync_ground.js';
import { GhostCar } from '../sim/car.js';
import { TerrainStreamer } from '../world/terrain.js';
import { makeCarState, stateFromCar } from '../view/car_state.js';
import { WorldView } from './world_view.js';
import { GunnerController } from './gunner.js';
import { buildPlayerSpec, gunnerLoadout } from './run_setup.js';
import { ChaseCam, GunnerCam } from '../view/camera_rig.js';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../net/snapshot.js';
import { WEAPONS } from '../data/weapons.js';
import { Road } from '../world/road.js';
import { ECONOMY, KILL_CASH } from '../data/economy.js';
import { AudioBridge } from '../view/audio_bridge.js';
import { GhostBoss } from '../sim/boss.js';
import { Dressing } from '../world/dressing.js';
import { StructureColliders } from '../sim/structure_colliders.js';
import { BOSS_ID, BOSS_NAMES, MINIBOSSES } from '../data/boss.js';
import { BOSS_S, biomeAt, BIOMES } from '../data/biomes.js';
import { clamp, damp, wrapAngle } from '../core/util.js';

const V3 = THREE.Vector3;

export class Run {
  /**
   * @param g Game (renderer, scene, camera, input, hud, materials, fx?, audio?, post?)
   * @param cfg {role, seed, profile, net?, startS?}
   */
  constructor(g, cfg) {
    this.g = g; this.cfg = cfg; this.role = cfg.role; this.seed = cfg.seed; this.net = cfg.net || null;
    this.simPeer = this.role === 'solo' || this.role === 'driver';
    this.gunnerLocal = this.role === 'solo' || this.role === 'gunner';
    this.driverLocal = this.role === 'solo' || this.role === 'driver';
    this.sim = null; this.streamer = null; this.wv = null; this.gunner = null; this.gwv = null;
    this.states = new Map(); this.ghosts = new Map(); this.events = []; this.localEvents = [];
    this.acc = 0; this.tick = 0; this.snapAcc = 0; this.gunnerSendAcc = 0; this.time = 0;
    this.chase = new ChaseCam(g.camera); this.gcam = new GunnerCam(g.camera);
    this.camDir = new V3(0, 0, 1); this.camPos = new V3();
    this.pivot = new V3(); this.hud = {}; this.playerId = 1; this.buf = new SnapshotBuffer();
    this.pendingReports = []; this.proj = []; this.outEvents = [];
    this.over = false; this.finished = false; this.countdown = 3.2; this.started = false;
    this.medkits = 0; this.cash = 0; this.streakT = 0; this.streak = 0; this.multi = 0;
    this.gunnerRemote = { yaw: 0, pitch: 0, fire: false, crouch: false, ads: false, weapon: 0, reloading: false, x: 0, z: 0, seq: 0 };
    this.lastStats = null; this.shots = 0; this.hitsLanded = 0;
  }

  async init() {
    const g = this.g, cfg = this.cfg;
    await initPhysics();
    const { spec, effects } = buildPlayerSpec(cfg.profile);
    this.spec = spec; this.effects = effects; this.medkits = effects.medkits;
    if (this.simPeer) {
      this.sim = new Sim({ seed: this.seed });
      await this.sim.init();
      this.streamer = new TerrainStreamer({ scene: g.scene, world: this.sim.world, seed: this.seed, terrainMat: g.terrainMat, roadMat: g.roadMat, workers: 3 });
      this.sim.setGround(this.streamer);
      const startS = cfg.startS ?? 40;
      this.player = this.sim.spawnCar(spec.id, { spec, s: startS, d: 0, kind: 'player', hold: true });
      this.player.crew.gunner.weapon = 0;
      this.sim.playerDamageMul = 1;
    } else {
      // viewer peer: a static Rapier world purely for bullet raycasts against terrain
      this.qworld = createWorld();
      this.streamer = new TerrainStreamer({ scene: g.scene, world: this.qworld, seed: this.seed, terrainMat: g.terrainMat, roadMat: g.roadMat, workers: 3 });
    }
    // world dressing (props, structures, water) + their colliders
    const world = this.sim ? this.sim.world : this.qworld;
    this.structures = new StructureColliders(world);
    if (this.sim) this.sim.structures = this.structures;
    try {
      this.dressing = new Dressing(g.scene, this.sim ? this.sim.road : (this._road || (this._road = new Road(this.seed))), this.seed, { quality: g.quality, physicsHook: (r) => this.structures.hook(r) });
      await this.dressing.load(cfg.startS ?? 40);
      this.streamer.onChunk = (c, rec) => this.dressing.onChunk(c, rec);
      this.streamer.onChunkDrop = (c) => this.dressing.onChunkDrop(c);
    } catch (e) { console.warn('dressing disabled', e); this.dressing = null; }
    this.wv = new WorldView({ scene: g.scene, playerPaint: cfg.paint, fx: g.fx, audio: g.audio, groundY: (x, y, z) => this._groundY(x, y, z) });
    this.wv.armorTier = effects.armorTier; this.wv.playerWeapon = effects.weapons[0];
    if (this.gunnerLocal) this.gunner = new GunnerController(gunnerLoadout(effects), this._gunnerCtx());
    if (g.audio) { this.abridge = new AudioBridge(g.audio, { playerId: 1, localRole: this.role }); this.abridge.preload({ weapons: effects.weapons, truck: spec.id }); }
    if (g.fx) { g.fx.clear(); g.fx.setGround((x, z) => { const p = this.states.get(1); return this._groundY(x, (p ? p.pos.y : 0) + 30, z) ?? (p ? p.pos.y - 0.6 : 0); }); }
    return this;
  }

  // ---------------------------------------------------------------------------------------------- gunner plumbing
  _gunnerCtx() {
    const run = this;
    return {
      ownCar: () => run.sim ? run.player : run.ghosts.get(run.playerId),
      targets: function* () {
        if (run.sim) { for (const c of run.sim.cars.values()) if (c.kind === 'enemy') yield c; if (run.sim.boss && !run.sim.boss.exploded) yield run.sim.boss; }
        else { for (const gh of run.ghosts.values()) if (gh.kind === 'enemy') yield gh; if (run.ghostBoss && !run.ghostBoss.exploded) yield run.ghostBoss; }
      },
      raycastWorld: (o, d, max) => run._worldRay(o, d, max),
      emit: (e) => run._localEvent(e),
      report: (h) => { run.hitsLanded++; if (run.sim) run.sim.applyHit(h); else run.net.sendJSON({ t: 'hit', h }); },
      fireRocket: (o, d, w) => { const cfg = { ...w.rocket, direct: w.dmg }; if (run.sim) run.sim.projectiles.addRocket(o, d, cfg, 1); else run.net.sendJSON({ t: 'rocket', o: o.toArray(), d: d.toArray(), cfg }); },
      throwGrenade: (o, v, cfg) => { if (run.sim) run.sim.projectiles.addGrenade(run.sim, o, v, cfg, 1); else run.net.sendJSON({ t: 'grenade', o: o.toArray(), v: v.toArray(), cfg }); },
      kick: (pitch, yaw, kick) => { run.gcam.addRecoil(pitch, yaw); run.gcam.shake.add(kick * 1.2); },
      hitMarker: (head) => { run.g.hud.hitMarker(false); },
    };
  }
  _worldRay(o, d, max) {
    const world = this.sim ? this.sim.world : this.qworld; if (!world) return null;
    if (!this._ray) this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const r = this._ray; r.origin.x = o.x; r.origin.y = o.y; r.origin.z = o.z; r.dir.x = d.x; r.dir.y = d.y; r.dir.z = d.z;
    const h = world.castRayAndGetNormal(r, max, true, undefined, RAY_SHOT);
    if (!h) return null;
    const px = o.x + d.x * h.timeOfImpact, pz = o.z + d.z * h.timeOfImpact;
    return { t: h.timeOfImpact, normal: new V3(h.normal.x, h.normal.y, h.normal.z), kind: this._surfaceKind(px, pz) };
  }
  _groundY(x, y, z) {
    const world = this.sim ? this.sim.world : this.qworld; if (!world) return null;
    if (!this._gray) this._gray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const r = this._gray; r.origin.x = x; r.origin.y = y + 4; r.origin.z = z;
    const h = world.castRay(r, 60, true, undefined, RAY_SHOT);
    return h ? y + 4 - h.timeOfImpact : null;
  }
  _surfaceKind(x, z) {
    const road = this.sim ? this.sim.road : (this._road || (this._road = new Road(this.seed)));
    const n = road.nearest(x, z, this.playerS || 0, 80, this._nn || (this._nn = {}));
    if (Math.abs(n.d) < 7.2) return 'asphalt';
    const b = biomeAt(n.s); const id = b.w > 0.5 ? b.b : b.a;
    return { desert: 'sand', canyon: 'rock', coast: 'grass', mountain: 'dirt', city: 'concrete', dam: 'concrete' }[id] || 'dirt';
  }
  _localEvent(e) {
    e.time = this.time; if (e.t === 'shot') this.shots++;
    if (this.sim) this.sim.emit({ ...e, remote: false, fromGunner: true });   // solo/driver: same event list as everything else
    else { this.localEvents.push(e); this.outEvents.push(e); }                // gunner peer: show locally + forward to the driver
  }

  // ---------------------------------------------------------------------------------------------- per-frame
  /** Advance sim/net and produce this frame's render data. */
  update(dt, cmds, now) {
    const g = this.g; this.time += dt; this.streakT = Math.max(0, (this.streakT || 0) - dt);
    const P = this.sim ? this.player : null;
    if (this.sim) {
      // countdown -> start once the ground under the truck exists
      if (this.sim.state === 'countdown') {
        this.streamer.update(P.s);
        if (P.held && this.streamer.groundReady(P.s) && !this.groundOk) { this.groundOk = true; g.fade(0, 0.8); }
        if (this.groundOk) {
          this.countdown -= dt;
          if (this.countdown <= 0) { this.sim.releaseCar(P); this.sim.start(); this.started = true; g.hud.message('GO!', 900, '#ffc21a'); this.abridge?.runStart(); if (this.net) this.net.sendJSON({ t: 'go' }); }
          else g.hud.message(String(Math.ceil(this.countdown - 0.2)) || 'GO', 500, '#fff');
        }
      }
      if (window.__autodrive && this.driverLocal) {
        const v = P.veh, B = this.sim.boss, road = this.sim.road;
        const lat = B ? (Math.sin(this.time * 0.15) > 0 ? 4.5 : -4.5) : (window.__autodrive.lat || 0);
        const tp = road.pointAt(P.s + 18 + v.speed * 0.45, lat, this._adp || (this._adp = {}));
        const err = wrapAngle(Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z));
        const want = B ? B.v + clamp((B.s - P.s - 30) * 0.4, -10, 10) : (window.__autodrive.speed || 40);
        Object.assign(cmds.driver, { throttle: v.vf < want ? 1 : 0, brake: v.vf > want + 4 ? 0.5 : 0, steer: clamp(err * 2.5, -1, 1), handbrake: false, nitro: false });
      }
      if (this.driverLocal) { P.veh.setInput(cmds.driver); this._driverActions(dt, cmds.driver); }
      if (cmds.gunner.medkit) this._medkit();
      else if (this.remoteDriverInput) P.veh.setInput(this.remoteDriverInput);
      // gunner state onto the sim car (from the local controller or from the remote gunner)
      const gs = P.crew.gunner;
      if (this.gunner) {
        gs.aimYaw = this.gunner.yaw; gs.aimPitch = this.gunner.pitch; gs.fire = this.gunner.trigger && this.gunner.magNow > 0; gs.crouch = this.gunner.crouch > 0.5; gs.ads = this.gunner.ads > 0.5;
        gs.weapon = this.gunner.cur; gs.reloading = this.gunner.reloading; gs.x = this.gunner.pos.x; gs.z = this.gunner.pos.z;
      } else { const r = this.gunnerRemote; gs.aimYaw = r.yaw; gs.aimPitch = r.pitch; gs.fire = r.fire; gs.crouch = r.crouch; gs.ads = r.ads; gs.weapon = r.weapon; gs.reloading = r.reloading; gs.x = r.x; gs.z = r.z; }
      const B = this.sim.boss;
      this.slowmo = B && B.dead && B.deathT < 5.5 ? (B.deathT < 0.4 ? 0.2 : Math.min(1, 0.25 + (B.deathT - 0.4) * 0.12)) : (this.slowmo ? Math.min(1, this.slowmo + dt * 0.6) : 1);
      if (this.slowmo >= 1) this.slowmo = 0;
      this.acc += dt * (this.slowmo || 1);
      let steps = 0;
      while (this.acc >= DT && steps < 8) { this.sim.step(DT); this.acc -= DT; steps++; }
      if (steps === 8) this.acc = 0;
      this.alpha = this.acc / DT;
      // states from sim
      for (const c of this.sim.cars.values()) {
        let st = this.states.get(c.id);
        if (!st || st.specId !== c.spec.id) { st = makeCarState(c.id, c.spec.id, c.kind); this.states.set(c.id, st); }
        stateFromCar(c, this.alpha, st);
      }
      for (const id of [...this.states.keys()]) if (!this.sim.cars.has(id)) this.states.delete(id);
      this.events = this.sim.drainEvents();
      if (this.role === 'driver' && this.net) this._sendNet(dt);
      this.playerS = P.s;
      this._simEventsToRun();
      const Bs = this.sim.boss;
      if (Bs) { const B = Bs; const bs = this.bossState || (this.bossState = { pos: B.pos, quat: B.quat, vel: B.vel, v: 0, alive: B.alive, phase: 1, dead: false, exploded: false }); bs.v = B.v; bs.phase = B.phase; bs.dead = B.dead; bs.exploded = B.exploded; } else this.bossState = null;
      this.proj = [...this.sim.projectiles.rockets.map((r) => ({ k: 1, x: r.x, y: r.y, z: r.z })), ...this.sim.projectiles.grenades.map((q) => { const t = q.body.translation(); return { k: 2, x: t.x, y: t.y, z: t.z }; })];
    } else {
      // viewer peer: interpolate snapshots
      const info = this.buf.sample(now);
      if (info) {
        if (!this.fadedIn) { this.fadedIn = true; g.fade(0, 0.8); }
        this.states = this.buf.states; this.hud = info.hud; this.playerS = info.hud.dist; this.proj = info.hud.proj;
        this.simState = info.hud.state;
        this.bossState = this.buf.boss;
        if (this.bossState) { const gb = this.ghostBoss || (this.ghostBoss = new GhostBoss()); gb.pos.copy(this.bossState.pos); gb.quat.copy(this.bossState.quat); gb.alive = this.bossState.alive; gb.exploded = this.bossState.exploded; } else this.ghostBoss = null;
      }
      this.events = this.netEvents || []; this.netEvents = [];
      for (const [id, st] of this.states) { let gh = this.ghosts.get(id); if (!gh) { gh = new GhostCar(st); this.ghosts.set(id, gh); } gh.sync(st); }
      for (const id of [...this.ghosts.keys()]) if (!this.states.has(id)) this.ghosts.delete(id);
      if (this.simState === 'over' && !this.over) { this.over = true; }
    }
    const pst = this.states.get(this.playerId);
    if (this.streamer) this.streamer.update(this.playerS || 0);
    // debug aimbot (tests only): point the gunner at the nearest enemy
    if (window.__aimbot && this.gunner && pst) {
      let best = null, bd = 140;
      for (const [id, st] of this.states) { if (st.kind !== 'enemy' || st.exploded) continue; const d = st.pos.distanceTo(pst.pos); if (d < bd) { bd = d; best = st; } }
      let aimP = best ? _t2.copy(best.pos).add(_f.set(0, 1.2, 0)) : null;
      const B = this.sim?.boss;
      if (B && !B.dead && B.pos.distanceTo(pst.pos) < 160) {
        const order = ['part_turret_1', 'part_turret_2', 'part_pod_L', 'part_pod_R', 'part_turret_main', 'part_tank_L', 'part_tank_R', 'panel_armor_rear_1', 'panel_armor_rear_2', 'panel_armor_rear_3', 'part_engine'];
        const n = order.find((k) => B.alive[k]); const z = B.zones.find((q) => q.kind === n);
        if (z) { aimP = B.local(z.c, _t2); best = true; }
      }
      if (best) {
        this.wv.gunnerPivot(pst, this.pivot);
        _v.copy(aimP).sub(this.pivot);
        this.gunner.yaw = Math.atan2(_v.x, _v.z); this.gunner.pitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
        cmds.gunner.fire = true; cmds.gunner.firePressed = true;
      } else cmds.gunner.fire = false;
    }
    // gunner update needs the previous frame's camera (aim ray) and the truck heading
    if (this.gunner && pst) {
      const carYaw = Math.atan2(_f.set(0, 0, 1).applyQuaternion(pst.quat).x, _f.z);
      this.gunner.crewAlive = pst.gunnerAlive;
      if (!pst.gunnerAlive || (this.sim && this.sim.state !== 'run')) { cmds.gunner.fire = false; cmds.gunner.firePressed = false; cmds.gunner.reload = false; cmds.gunner.grenade = false; }
      this.wv.muzzlePos(pst, this.gunner.muzzle);
      if (g.input.lastDevice === 'pad' && (g.aimAssist ?? true)) {
        const pts = this._assistPts || (this._assistPts = []); pts.length = 0;
        for (const st of this.states.values()) {
          if (st.kind !== 'enemy' || st.exploded) continue;
          const up = st.ride.restComHeight;
          if (st.gunnerAlive && st.spec.seats.gunner) { const sg = st.spec.seats.gunner; pts.push({ p: new THREE.Vector3(sg[0], sg[1] + 1.2 - up, sg[2]).applyQuaternion(st.quat).add(st.pos), v: st.vel }); }
          if (st.driverAlive) { const sd = st.spec.seats.driver; pts.push({ p: new THREE.Vector3(sd[0], sd[1] + 0.5 - up, sd[2]).applyQuaternion(st.quat).add(st.pos), v: st.vel }); }
          pts.push({ p: st.pos, v: st.vel });
        }
        const bs = this.bossState; if (bs && !bs.dead) pts.push({ p: new THREE.Vector3(0, 5, -8).applyQuaternion(bs.quat).add(bs.pos), v: bs.vel });
        this.gunner.assist(cmds.gunner, dt, { position: g.camera.position, dir: this.camDir }, pts, pst.vel);
      }
      this.gunner.update(dt, cmds.gunner, { position: g.camera.position, dir: this.camDir }, carYaw, { carVel: pst.vel });
    }
    // world view
    const localGunner = this.gunner ? { crouch: this.gunner.crouch, reload: this.gunner.reloading, swap: this.gunner.swapT, recoil: this.gunner.recoilAnim, throwing: this.gunner.throwing, weapon: this.gunner.weaponId, reloadT: this.gunner.reloadT, reloadLen: this.gunner.weapon.reload } : null;
    const evs = this.events.concat(this.localEvents.filter(() => !this.sim)); // in solo the local events already went through sim.emit
    this.localEvents.length = 0;
    this.dressing?.update(dt, g.camera.position, this.playerS || 0, g.camera);
    this.wv.updateBoss(this.bossState, dt);
    if (!this._frustum) { this._frustum = new THREE.Frustum(); this._pv = new THREE.Matrix4(); }
    g.camera.updateMatrixWorld(); this._pv.multiplyMatrices(g.camera.projectionMatrix, g.camera.matrixWorldInverse); this._frustum.setFromProjectionMatrix(this._pv);
    this.wv.update(dt, this.states, evs, { cameraPos: g.camera.position, frustum: this._frustum, night: g.look?.night ?? 0, playerId: this.playerId, playerWeaponId: this.gunner ? this.gunner.weaponId : this.effects.weapons[0], localGunner, proj: this.proj });
    this.allEvents = evs;
    for (const e of evs) {
      if (e.t === 'minibossSpawn') { g.hud.message(e.name, 2600, '#ff5a2a'); }
      else if (e.t === 'minibossDown') { g.hud.message(`${e.name} WRECKED  +$${ECONOMY.minibossBounty[e.index] || ''}`, 2800, '#ffc21a'); }
      else if (e.t === 'bossSpawn') { g.hud.message('THE LEVIATHAN', 3500, '#ff3a1a'); this.abridge?.bossIntro(); }
      else if (e.t === 'bossPhase' && e.phase === 3) g.hud.message('REACTOR EXPOSED!', 2200, '#ffc21a');
      else if (e.t === 'bossPart' && e.label) g.hud.feed(`${e.label} DESTROYED`, '#ffc21a');
      else if (e.t === 'bossDown') { g.hud.message('THE LEVIATHAN IS DOWN!', 5000, '#ffc21a'); this.abridge?.victory(); }
      else if (e.t === 'bossDying') { g.hud.message('REACTOR CRITICAL', 2000, '#ff5a2a'); }
    }
    const fx = g.fx;
    if (fx) {
      const ctx = this._fxCtx || (this._fxCtx = { carViews: this.wv.viewMap, states: null, playerId: 1, cameraPos: g.camera.position, shake: (a) => { const k = a * (g.shakeMul ?? 1); this.chase.shake.add(k); this.gcam.shake.add(k); } });
      ctx.states = this.states;
      for (const e of evs) fx.handleEvent(e, ctx);
      const sc = this._surfCache || (this._surfCache = new Map());
      const road = this.sim ? this.sim.road : (this._road || (this._road = new Road(this.seed)));
      for (const st of this.states.values()) {
        const v = this.wv.viewMap.get(st.id); if (!v) continue;
        let c = sc.get(st.id);
        if (!c || (this.fxTick + st.id) % 8 === 0) { const n = road.nearest(st.pos.x, st.pos.z, c ? c.s : (this.playerS || 0), c ? 60 : 400, this._fxn || (this._fxn = {})); c = { s: n.s, kind: Math.abs(n.d) < 7.2 ? 'asphalt' : Math.abs(n.d) < 9.7 ? 'gravel' : this._surfaceKind(st.pos.x, st.pos.z) }; sc.set(st.id, c); }
        fx.updateCar(st, v, dt, c.kind);
      }
      for (const id of sc.keys()) if (!this.states.has(id)) sc.delete(id);
      fx.updateProjectiles?.(this.proj, dt);
      this.fxTick = (this.fxTick || 0) + 1;
    }
    const ab = this.abridge;
    if (ab && pst) {
      const A = g.audio, ctx = this._fxCtx || { carViews: this.wv.viewMap, states: this.states, playerId: 1, cameraPos: g.camera.position };
      A.listener.update(g.camera, pst.vel);
      const sc = this._surfCache;
      for (const st of this.states.values()) ab.updateCar(st, dt, { surface: sc?.get(st.id)?.kind || 'asphalt', throttle: st.id === 1 && this.sim ? this.player.veh.throttleApplied : undefined });
      for (const e of evs) ab.handleEvent(e, ctx);
      ab.update(dt, ctx);
      const b = biomeAt(this.playerS || 0); A.ambience.setBiome(b.w > 0.5 ? b.b : b.a);
      let threat = 0; for (const st of this.states.values()) if (st.kind === 'enemy' && !st.exploded) { const d = st.pos.distanceTo(pst.pos); if (d < 120) threat += 1 - d / 120; }
      this.threat = (this.threat || 0) * 0.97 + Math.min(1, 0.22 + threat / 4 + (this.sim ? this.sim.director.level * 0.4 : 0)) * 0.03;
      A.music.setIntensity(this.threat);
      A.setDanger(pst.hp01 < 0.3 ? 1 - pst.hp01 / 0.3 : 0);
    }
    // cameras
    this._camera(dt, cmds, pst);
    // HUD data
    this.hud2 = this._hudData(pst);
    if (this.role === 'gunner' && this.net) this._sendGunner(dt);
    this._outcome(dt);
  }

  _driverActions(dt, d) {
    const e = this.effects, sim = this.sim, P = this.player;
    this.oilCd = Math.max(0, (this.oilCd || 0) - dt); this.mineCd = Math.max(0, (this.mineCd || 0) - dt);
    if (sim.state !== 'run' || P.exploded) return;
    if (d.special1 && e.oil > 0 && this.oilCd <= 0) { sim.hazards.dropOil(sim, P); this.oilCd = e.oil >= 2 ? 6 : 10; }
    if (d.special2 && e.mines > 0 && this.mineCd <= 0) { sim.hazards.dropMine(sim, P, e.mines >= 2 ? 11 : 8, e.mines >= 2 ? 190 : 140); this.mineCd = 4; }
    if (d.medkit) this._medkit();
    // hold reset to flip the truck upright
    if (d.reset && P.veh.up.y < 0.55) { this.flipT = (this.flipT || 0) + dt; if (this.flipT > 1.0) { this.flipT = 0; this._unflip(); } } else this.flipT = 0;
    if (d.horn) sim.emit({ t: 'horn', id: P.id });
  }
  _unflip() {
    const P = this.player, b = P.veh.body, q = P.veh.quat;
    const yaw = Math.atan2(P.veh.fwd.x, P.veh.fwd.z);
    b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    b.setTranslation({ x: P.veh.pos.x, y: P.veh.pos.y + 1.8, z: P.veh.pos.z }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.sim.damageCar(P, P.maxHp * 0.04, { cause: 'flip' });
    this.sim.emit({ t: 'unflip', id: P.id });
  }
  _medkit() {
    if (this.medkits <= 0) return;
    if (this.role === 'gunner') { this.net.sendJSON({ t: 'medkit' }); return; }
    if (this.sim.useMedkit()) { this.medkits--; this.g.hud.message('MEDKIT', 900, '#7fdc7f'); }
  }

  _simEventsToRun() {
    for (const e of this.events) {
      if (e.t === 'minibossDown') {
        const b = Math.round((ECONOMY.minibossBounty[e.index] || 5000) * this.effects.cashMul);
        this.minibossCash = (this.minibossCash || 0) + b; (this.minibossesKilled || (this.minibossesKilled = [])).push(e.index);
        this.cash += 0; this.sim.stats.cash = this.cash;
      }
      if (e.t === 'kill') { g_kill(this, e); }
      if (e.t === 'runOver' && !this.over) { this.over = true; this.overWhy = e.why; }
      if (e.t === 'playerDown') this.g.hud.message(e.why === 'car' ? 'TRUCK DESTROYED' : e.why === 'driver' ? 'DRIVER DOWN' : 'GUNNER DOWN', 2400, '#ff4433');
      if (e.t === 'crash' && e.id === 1) { this.chase.shake.add(clamp(e.dv * 0.05, 0, 0.7)); this.gcam.shake.add(clamp(e.dv * 0.05, 0, 0.7)); if (e.dv > 2.5) { this.g.hud.damageFlash(clamp(e.dv * 0.08, 0.2, 0.6)); this.g.input.rumble(0.8, 0.6, 200); } }
      if (e.t === 'crewHit' && e.id === 1) { this.g.hud.damageFlash(0.45); this.chase.shake.add(0.12); this.gcam.shake.add(0.15); this.g.input.rumble(0.3, 0.7, 90); }
      if (e.t === 'explode') { const p = this.states.get(1); const d = p ? p.pos.distanceTo(_v.fromArray(e.pos)) : 999; const k = clamp(1 - d / 90, 0, 1) * e.size; this.chase.shake.add(k * 0.8); this.gcam.shake.add(k * 0.8); if (k > 0.3) this.g.input.rumble(0.6, 0.4, 250); }
    }
  }

  _camera(dt, cmds, pst) {
    const g = this.g;
    if (!pst) return;
    const B = this.bossState;
    if (B && (B.dead || B.exploded) && !this.finaleDone) {
      this.finaleT = (this.finaleT || 0) + dt;
      if (this.finaleT < 9) {
        const a = this.finaleT * 0.25 + 0.6, r = 42 - this.finaleT * 1.5;
        g.camera.position.set(B.pos.x + Math.sin(a) * r, B.pos.y + 9 + this.finaleT * 0.6, B.pos.z + Math.cos(a) * r);
        g.camera.lookAt(B.pos.x, B.pos.y + 4, B.pos.z);
        return;
      }
      this.finaleDone = true;
    }
    const co = window.__camOverride; // dev: {offset:[x,y,z] in truck frame, look:[x,y,z] in truck frame}
    if (co) { const q = pst.quat; g.camera.position.set(...co.offset).applyQuaternion(q).add(pst.pos); _v.set(...co.look).applyQuaternion(q).add(pst.pos); g.camera.lookAt(_v); if (co.fov) { g.camera.fov = co.fov; g.camera.updateProjectionMatrix(); } return; }
    const dying = this.sim ? this.sim.state === 'dying' || this.sim.state === 'over' : this.simState === 'dying' || this.simState === 'over';
    if (dying && !this.sim?.won) {
      this.deathCamT = (this.deathCamT || 0) + dt;
      const a = (this.deathYaw ??= Math.atan2(g.camera.position.x - pst.pos.x, g.camera.position.z - pst.pos.z)) + this.deathCamT * 0.35;
      const r = 9 + this.deathCamT * 1.2;
      g.camera.position.set(pst.pos.x + Math.sin(a) * r, pst.pos.y + 3.5 + this.deathCamT * 0.5, pst.pos.z + Math.cos(a) * r);
      g.camera.lookAt(pst.pos.x, pst.pos.y + 0.8, pst.pos.z);
      return;
    }
    if (this.role === 'driver') {
      this.chase.update(dt, pst.pos, pst.quat, pst.vel, { boosting: pst.boosting, yawRate: this.sim ? this.player.veh.yawRate : 0, lookX: cmds.driver.lookX, lookY: cmds.driver.lookY, airborne: pst.airborne });
      if (cmds.driver.cameraToggle) this.chase.toggle();
      this.camDir.set(0, 0, -1).applyQuaternion(g.camera.quaternion);
    } else if (this.gunner) {
      this.wv.gunnerPivot(pst, this.pivot);
      const w = this.gunner.weapon;
      const dir = this.gcam.update(dt, this.pivot, this.gunner.yaw, this.gunner.pitch, this.gunner.ads > 0.5 && !this.gunner.reloading, { scoped: !!w.scope, scopeFov: w.scopeFov, speed01: clamp(pst.speed / 60, 0, 1), boosting: pst.boosting });
      this.camDir.copy(dir);
    }
  }

  _hudData(pst) {
    const P = this.player;
    const s = this.playerS || 0;
    let boss = null;
    if (this.sim) {
      const B = this.sim.boss, E = this.sim.director.activeElite;
      if (B && !B.exploded) boss = { name: 'THE LEVIATHAN', hp01: B.coreHp01() };
      else if (E) boss = { name: E.name, hp01: E.hp01 };
    } else if (this.hud && this.hud.bossId) boss = { name: BOSS_NAMES[this.hud.bossId] || '', hp01: this.hud.bossHp01 };
    const b = biomeAt(s);
    const d = {
      speed: pst ? pst.speed : 0, rpm01: pst ? pst.rpm01 : 0, nitro01: 0, nitroMax: this.spec.nitro?.capacity || 0,
      hp01: pst ? pst.hp01 : 1, dhp01: 1, ghp01: 1, dist: s, time: this.sim ? this.sim.time : (this.hud?.time || 0), biome: BIOMES[b.w > 0.5 ? b.b : b.a].name, prog01: s / BOSS_S, boss,
      spreadPx: this.gunner ? (this.gunner.spreadNow() * Math.PI / 180) / (this.g.camera.fov * Math.PI / 180) * innerHeight : undefined,
      scoped: this.gunner ? !!this.gunner.weapon.scope && this.gunner.ads > 0.85 : false,
      weapon: this.gunner ? this.gunner.weapon.name : undefined, mag: this.gunner ? this.gunner.magNow : 0, reloading: this.gunner ? this.gunner.reloading : false,
      showDriver: this.role !== 'gunner',
    };
    if (P) { d.nitro01 = P.veh.nitro / Math.max(0.001, P.veh.nitroMax); d.dhp01 = P.crew.driver.hp / P.crew.driver.max; d.ghp01 = P.crew.gunner ? P.crew.gunner.hp / P.crew.gunner.max : 1; }
    else if (this.hud && this.hud.dhp01 !== undefined) { d.dhp01 = this.hud.dhp01; d.ghp01 = this.hud.ghp01; d.nitro01 = this.hud.nitro01; d.hp01 = this.hud.hp01; }
    d.arrows = this._threatArrows(pst);
    return d;
  }

  _threatArrows(pst) {
    if (!pst) return [];
    const cam = this.g.camera, out = [];
    const w = innerWidth, h = innerHeight;
    for (const [id, st] of this.states) {
      if (st.kind !== 'enemy' || st.exploded) continue;
      const dist = st.pos.distanceTo(pst.pos); if (dist > 140) continue;
      _v.copy(st.pos).project(cam);
      const behind = _v.z > 1;
      if (!behind && Math.abs(_v.x) < 0.92 && Math.abs(_v.y) < 0.9) continue;
      let x = _v.x, y = _v.y; if (behind) { x = -x; y = -y; }
      const m = Math.max(Math.abs(x), Math.abs(y), 1e-4); x /= m; y /= m;
      const px = (x * 0.5 + 0.5) * (w - 90) + 45, py = (1 - (y * 0.5 + 0.5)) * (h - 90) + 45;
      out.push({ x: px, y: py, a: Math.atan2(x, y), o: clamp(1.2 - dist / 140, 0.35, 1), c: st.gunnerAlive || st.spec.gunners ? '#ff5a3a' : '#ffb03a' });
      if (out.length > 8) break;
    }
    return out;
  }

  _outcome(dt) {
    if (this.over && !this.finished) {
      this.overT = (this.overT || 0) + dt;
      if (this.sim && !this.summary && this.overT > 0.3) { this.summary = this.buildSummary(this.sim.won); if (this.net) this.net.sendJSON({ t: 'summary', s: this.summary }); }
      if (this.overT > 2.2 && (this.summary || this.remoteSummary)) this.finished = true;
    }
  }

  /** Sim peer: final results + cash breakdown (the profile owner credits it). */
  buildSummary(won = false) {
    const sim = this.sim, st = sim.stats, E = ECONOMY;
    const L = sim.director.level;
    const dist = st.distance - (this.cfg.startS ?? 40);
    const lines = [];
    lines.push({ label: 'RAIDERS WRECKED', amount: this.cash });
    const distCash = Math.round(Math.max(0, dist) * E.perMeter * (1 + E.perMeterLevel * L) * this.effects.cashMul);
    lines.push({ label: `DISTANCE ${(dist / 1000).toFixed(1)} KM`, amount: distCash });
    const timeCash = Math.round(sim.time * E.perSecond * this.effects.cashMul);
    lines.push({ label: 'TIME SURVIVED', amount: timeCash });
    if (this.minibossCash) lines.push({ label: 'WARLORD BOUNTIES', amount: this.minibossCash });
    if (won) lines.push({ label: 'THE LEVIATHAN', amount: E.bossBounty });
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const why = sim.result?.why;
    return {
      won, cash: total, breakdown: lines, distance: Math.max(0, dist), time: sim.time, kills: st.kills, crashKills: st.crashKills || 0,
      bestStreak: this.bestMulti || 0, shots: this.shots, hits: st.hits, cause: won ? 'VICTORY' : why === 'car' ? 'TRUCK DESTROYED' : why === 'driver' ? 'DRIVER KILLED' : why === 'gunner' ? 'GUNNER KILLED' : 'WRECKED',
      biome: BIOMES[biomeAt(st.distance).a].name, minibosses: this.minibossesKilled || [],
    };
  }

  // ---------------------------------------------------------------------------------------------- networking
  _sendNet(dt) {
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / 30) {
      this.snapAcc = 0;
      const P = this.player;
      const bossHud = this._bossHud(); const hud = { bossId: bossHud.id, bossHp01: bossHud.hp01, hp01: P.hp / P.maxHp, dhp01: P.crew.driver.hp / P.crew.driver.max, ghp01: P.crew.gunner ? P.crew.gunner.hp / P.crew.gunner.max : 1, nitro01: P.veh.nitro / Math.max(0.001, P.veh.nitroMax), cash: this.cash, kills: this.sim.stats.kills, streak: this.sim.stats.streak, level: this.sim.director.level, dist: P.s, medkits: this.medkits };
      this.net.sendFast(encodeSnapshot(this.sim, this.sim.tick, hud));
    }
    const out = this.events.filter((e) => !e.remote);
    if (out.length) this.net.sendJSON({ t: 'events', e: out });
  }
  _sendGunner(dt) {
    this.gunnerSendAcc += dt;
    if (this.gunnerSendAcc >= 1 / 30 && this.gunner) {
      this.gunnerSendAcc = 0;
      const gn = this.gunner;
      this.net.sendJSON({ t: 'g', y: +gn.yaw.toFixed(4), p: +gn.pitch.toFixed(4), f: gn.trigger && gn.magNow > 0 ? 1 : 0, c: gn.crouch > 0.5 ? 1 : 0, a: gn.ads > 0.5 ? 1 : 0, w: gn.cur, r: gn.reloading ? 1 : 0, x: +gn.pos.x.toFixed(2), z: +gn.pos.z.toFixed(2) }, true);
    }
    if (this.outEvents.length) { this.net.sendJSON({ t: 'shotfx', e: this.outEvents }); this.outEvents = []; }
  }
  /** Called by Game when a network message arrives during a run. */
  onNet(m) {
    if (m.t === 'events') { (this.netEvents || (this.netEvents = [])).push(...m.e); return; }
    if (m.t === 'feed') { this.g.hud.feed(m.text, m.crash ? '#ffc21a' : '#fff'); if (this.gunner) this.g.hud.hitMarker(true); return; }
    if (m.t === 'summary') { this.remoteSummary = m.s; this.over = true; return; }
    if (m.t === 'go') { this.g.hud.message('GO!', 900, '#ffc21a'); this.abridge?.runStart(); return; }
    if (this.sim) {
      if (m.t === 'g') { const r = this.gunnerRemote; r.yaw = m.y; r.pitch = m.p; r.fire = !!m.f; r.crouch = !!m.c; r.ads = !!m.a; r.weapon = m.w; r.reloading = !!m.r; r.x = m.x; r.z = m.z; }
      else if (m.t === 'hit') this.sim.applyHit(m.h);
      else if (m.t === 'rocket') this.sim.projectiles.addRocket(new V3(...m.o), new V3(...m.d), m.cfg, 1);
      else if (m.t === 'grenade') this.sim.projectiles.addGrenade(this.sim, new V3(...m.o), new V3(...m.v), m.cfg, 1);
      else if (m.t === 'shotfx') for (const e of m.e) { if (e.t === 'shot') this.shots++; this.sim.emit({ ...e, remote: true }); }
      else if (m.t === 'input') this.remoteDriverInput = m.i;
      else if (m.t === 'medkit') { if (this.medkits > 0 && this.sim.useMedkit()) this.medkits--; }
    }
  }
  _bossHud() {
    const B = this.sim.boss, E = this.sim.director.activeElite;
    if (B && !B.exploded) return { id: BOSS_NAMES.length - 1, hp01: B.coreHp01() };
    if (E) return { id: E.index + 1, hp01: E.hp01 };
    return { id: 0, hp01: 0 };
  }
  onFast(buf) {
    if (this.role !== 'gunner') return;
    const s = decodeSnapshot(buf); if (!s) return;
    s.proj = s.proj || [];
    this.buf.push(s, performance.now() / 1000);
  }

  dispose() {
    this.g.fx?.clear();
    try { this.dressing?.dispose(); } catch (e) { console.warn(e); }
    this.structures?.dispose();
    this.abridge?.reset();
    this.wv?.dispose();
    this.streamer?.dispose();
  }
}

const _f = new V3(), _v = new V3(), _t2 = new V3();
function g_kill(run, e) {
  // cash + style: crash kills and multi-kills pay more
  const base = KILL_CASH[e.spec] || 60;
  const L = run.sim.director.level;
  let mult = 1 + L * ECONOMY.killLevel;
  if (e.crash) { mult *= ECONOMY.crashMul; run.sim.stats.crashKills = (run.sim.stats.crashKills || 0) + 1; }
  if (run.streakT <= 0) run.multi = 0;
  run.streakT = 3.5; run.multi++; run.bestMulti = Math.max(run.bestMulti || 0, run.multi);
  if (run.multi >= 2) mult *= 1 + Math.min(run.multi - 1, 5) * 0.15;
  const cash = Math.round(base * mult * run.effects.cashMul);
  run.cash += cash;
  run.sim.stats.cash = run.cash;
  const label = `+$${cash}  ${e.crash ? 'CRASH KILL ' : ''}${run.multi >= 2 ? 'x' + run.multi : ''}`;
  run.g.hud.feed(label, e.crash ? '#ffc21a' : '#fff');
  run.g.hud.hitMarker(true);
  if (run.net) run.net.sendJSON({ t: 'feed', text: label, crash: !!e.crash });
}
