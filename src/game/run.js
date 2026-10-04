// A single RUN (one life). Roles: 'solo' (sim + gunner + driver on one machine), 'driver' (sim peer), 'gunner' (viewer peer).
// The frame loop is owned by Game; Run only advances its own systems and exposes what the renderer needs.
import * as THREE from 'three';
import { RAPIER, initPhysics, createWorld, RAY_SHOT, getColliderLabel } from '../sim/physics.js';
import { Sim, DT } from '../sim/sim.js';
import { RoadQuery } from '../sim/road_query.js';
import { SyncGround } from '../sim/sync_ground.js';
import { GhostCar } from '../sim/car.js';
import { TerrainStreamer } from '../world/terrain.js';
import { makeCarState, stateFromCar } from '../view/car_state.js';
import { WorldView } from './world_view.js';
import { GunnerController } from './gunner.js';
import { buildPlayerSpec, gunnerLoadout } from './run_setup.js';
import { ChaseCam, GunnerCam } from '../view/camera_rig.js';
import { Cockpit } from '../view/cockpit.js';
import { ThreatHUD } from '../ui/threat_hud.js';
import { Banner } from '../ui/banner.js';
import { HazardMarks } from '../view/hazard_marks.js';
import { BossMarks } from '../view/boss_marks.js';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../net/snapshot.js';
import { advanceCadence, consumeCadence } from '../net/cadence.js';
import { WEAPONS } from '../data/weapons.js';
import { Road } from '../world/road.js';
import { ECONOMY, KILL_CASH } from '../data/economy.js';
import { AudioBridge } from '../view/audio_bridge.js';
import { GhostBoss, bossAimPoint } from '../sim/boss.js';
import { AIDriver } from './ai_driver.js';
import { AIGunner } from './ai_gunner.js';
import { Dressing } from '../world/dressing.js';
import { StructureColliders } from '../sim/structure_colliders.js';
import { StageEncounters } from '../sim/stage_encounters.js';
import { StageEncountersView } from '../view/stage_encounters.js';
import { BOSS_ID, BOSS_NAMES, MINIBOSSES, BOSS_PARTS } from '../data/boss.js';
import { BOSS_S, biomeAt, BIOMES } from '../data/biomes.js';
import { TEN_LEVELS, MARATHON_LEVEL_LENGTH, normalizeJourney } from '../data/campaign.js';
import { clamp, damp, lerp, wrapAngle } from '../core/util.js';
import { appendDiagnostic } from '../core/diagnostics.js';
import { runPhase, defeatReason, isDefeated, rememberDefeat, victoryPresenting } from './run_status.js';
import { validCombatState, validDamageReceipt, validRemoteGunnerFX } from '../sim/combat.js';
import { validNukeCue } from '../view/fx/nuke.js';
import { keyLabel } from '../ui/glyphs.js';

const V3 = THREE.Vector3;

export class Run {
  get road() { return this.sim?.road || this._road || (this._road = new Road(this.seed, this.journey)); }
  get phase() { return runPhase(this); }
  get defeated() { return isDefeated(this); }
  get defeatReason() { return defeatReason(this); }
  /**
   * @param g Game (renderer, scene, camera, input, hud, materials, fx?, audio?, post?)
   * @param cfg {role, seed, profile, net?, startS?}
   */
  constructor(g, cfg) {
    this.g = g; this.journey = normalizeJourney(cfg.journey); this.cfg = { ...cfg, journey: this.journey }; this.role = cfg.role; this.seed = cfg.seed; this.net = cfg.net || null;
    this.id = cfg.runId || globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    this.partnerReady = !this.net;
    // single player with an AI partner: cfg.ai = 'gunner' (you drive) | 'driver' (you shoot); the sim then runs locally
    this.ai = cfg.ai || null;
    this.simPeer = this.role === 'solo' || this.role === 'driver' || !this.net;
    this.humanGunner = this.role === 'solo' || this.role === 'gunner';
    this.humanDriver = this.role === 'solo' || this.role === 'driver';
    this.gunnerLocal = this.humanGunner || this.ai === 'gunner';   // a GunnerController runs here (human or AI)
    this.driverLocal = this.humanDriver || this.ai === 'driver';
    this.sim = null; this.streamer = null; this.wv = null; this.gunner = null; this.gwv = null;
    this.states = new Map(); this.ghosts = new Map(); this.events = []; this.localEvents = [];
    this.acc = 0; this.tick = 0; this.snapAcc = 0; this.gunnerSendAcc = 0; this.time = 0;
    this.chase = new ChaseCam(g.camera); this.gcam = new GunnerCam(g.camera);
    this.camDir = new V3(0, 0, 1); this.camPos = new V3();
    this.pivot = new V3(); this.hud = {}; this.playerId = 1; this.buf = new SnapshotBuffer();
    this.pendingReports = []; this.proj = []; this.outEvents = [];
    this.over = false; this.finished = false; this.countdown = 3.2; this.started = false;
    this.victoryPresentation = false; this.victorySummary = null; this._victoryControls = null;
    this.medkits = 0; this.cash = 0; this.streakT = 0; this.streak = 0; this.multi = 0;
    this.gunnerRemote = { yaw: 0, pitch: 0, fire: false, crouch: false, ads: false, weapon: 0, reloading: false, x: 0, z: 0, seq: 0 };
    this.lastStats = null; this.shots = 0; this.hitsLanded = 0;
    this.nukeRequestSeq = 0; this.combatRevision = -1; this.damageReceiptRevision = 0; this.combatHud = null;
    this.nukeShownAward = 0; this.nukePresentedAward = 0;
  }

  async init() {
    const g = this.g, cfg = this.cfg;
    await initPhysics();
    if (this.disposed) return this;
    const { spec, effects } = buildPlayerSpec(cfg.profile);
    this.spec = spec; this.effects = effects; this.medkits = effects.medkits;
    if (this.simPeer) {
      this.sim = new Sim({ seed: this.seed, journey: this.journey });
      await this.sim.init();
      if (this.disposed) { this.sim.dispose(); return this; }
      this.streamer = new TerrainStreamer({ scene: g.scene, world: this.sim.world, seed: this.seed, journey: this.journey, terrainMat: g.terrainMat, roadMat: g.roadMat, workers: 3 });
      this.sim.setGround(this.streamer);
      const startS = cfg.startS ?? 40;
      this.player = this.sim.spawnCar(spec.id, { spec, s: startS, d: 0, kind: 'player', hold: true });
      this.player.crew.gunner.weapon = 0;
      this.sim.playerDamageMul = 1;
      this.sim.configureCombat(this.id, gunnerLoadout(effects));
      this._receiveCombatState(this.sim.combat.state());
      this.encounters = this.sim.encounters;
    } else {
      // viewer peer: a static Rapier world purely for bullet raycasts against terrain
      this.qworld = createWorld();
      this.encounters = new StageEncounters({ authoritative: false });
      this.streamer = new TerrainStreamer({ scene: g.scene, world: this.qworld, seed: this.seed, journey: this.journey, terrainMat: g.terrainMat, roadMat: g.roadMat, workers: 3 });
    }
    // world dressing (props, structures, water) + their colliders
    const world = this.sim ? this.sim.world : this.qworld;
    this.structures = new StructureColliders(world);
    if (this.sim) this.sim.structures = this.structures;
    try {
      this.dressing = new Dressing(g.scene, this.road, this.seed, { quality: g.quality, physicsHook: (r) => this.structures.hook(r) });
      await this._loadDressing(cfg.startS ?? 40);
    } catch (e) { console.warn('dressing disabled', e); this.dressing = null; }
    if (this.disposed) return this;
    this.wv = new WorldView({ scene: g.scene, playerPaint: cfg.paint, playerUpgradeLevels: effects.vehicleUpgradeLevels, playerWeaponOptics: effects.weaponOptics, fx: g.fx, audio: g.audio, groundY: (x, y, z) => this._groundY(x, y, z) });
    this.encounterView = new StageEncountersView(g.scene, this.road);
    this.wv.playerWeapon = effects.weapons[0];
    if (this.gunnerLocal) this.gunner = new GunnerController(gunnerLoadout(effects), this._gunnerCtx());
    if (this.ai === 'driver') this.aiDriver = new AIDriver(this);
    if (this.ai === 'gunner') this.aiGunner = new AIGunner(this);
    if (g.audio) {
      const b = this.road.biomeAt(cfg.startS ?? 40);
      g.audio.music.setBiome(b.w > 0.5 ? b.b : b.a);
      this.abridge = new AudioBridge(g.audio, { playerId: 1, localRole: this.role }); this.abridge.preload({ weapons: effects.weapons, truck: spec.id });
    }
    if (g.fx) { g.fx.clear(); g.fx.setGround((x, z) => { const p = this.states.get(1); return this._groundY(x, (p ? p.pos.y : 0) + 30, z) ?? (p ? p.pos.y - 0.6 : 0); }); }
    return this;
  }

  async _loadDressing(startS) {
    const dressing = this.dressing;
    let ready = false;
    try {
      await dressing.load(startS);
      if (this.disposed) return;
      dressing.pool.warmer = (meshes) => this.g.warmMeshes(meshes);
      this.streamer.onChunk = (c, rec) => dressing.onChunk(c, rec);
      this.streamer.onChunkDrop = (c) => dressing.onChunkDrop(c);
      ready = true;
    } catch (e) { console.warn('dressing disabled', e); }
    finally {
      if (!ready) {
        if (this.dressing === dressing) this.dressing = null;
        dressing.dispose();
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- gunner plumbing
  _gunnerCtx() {
    const run = this;
    return {
      ownCar: () => run.sim ? run.player : run.ghosts.get(run.playerId),
      targets: function* () {
        if (run.sim) { for (const c of run.sim.cars.values()) if (c.kind === 'enemy') yield c; if (run.sim.boss && !run.sim.boss.exploded) yield run.sim.boss; }
        else { for (const gh of run.ghosts.values()) if (gh.kind === 'enemy') yield gh; if (run.ghostBoss && !run.ghostBoss.exploded) yield run.ghostBoss; }
        if (run.encounters) yield* run.encounters.targets();
      },
      raycastWorld: (o, d, max) => run._worldRay(o, d, max, true),
      emit: (e) => run._localEvent(e),
      report: (h) => { if (!run.victoryPresentation) run.hitsLanded++; if (run.sim) run.sim.applyHit(h); else if (!run.victoryPresentation) { run.net.sendJSON({ t: 'hit', h }); (run.localFlash || (run.localFlash = new Map())).set(h.carId, 0.12); } },
      fireRocket: (o, d, w) => { const cfg = { ...w.rocket, direct: w.dmg }; if (run.sim) run.sim.projectiles.addRocket(o, d, cfg, 1); else run.net.sendJSON({ t: 'rocket', o: o.toArray(), d: d.toArray(), cfg }); },
      throwGrenade: (o, v, cfg) => { if (run.sim) run.sim.projectiles.addGrenade(run.sim, o, v, cfg, 1); else run.net.sendJSON({ t: 'grenade', o: o.toArray(), v: v.toArray(), cfg }); },
      kick: (pitch, yaw, kick) => { if (!run.victoryPresentation) { run.gcam.addRecoil(pitch, yaw); run.gcam.shake.add(kick * 1.2); } },
      hitMarker: (head) => { if (run.humanGunner) run.g.hud.hitMarker(false, head); },
    };
  }
  _worldRay(o, d, max, shooting = false) {
    const world = this.sim ? this.sim.world : this.qworld; if (!world) return null;
    if (!this._ray) this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const r = this._ray; r.origin.x = o.x; r.origin.y = o.y; r.origin.z = o.z; r.dir.x = d.x; r.dir.y = d.y; r.dir.z = d.z;
    // Living encounter targets use their authored zones below. Camera and
    // ground queries keep their solid geometry, as do dead road obstructions.
    const predicate = shooting ? (col) => { const actor = this.encounters?.colliderOwner(col.handle); return !actor || actor.dead || !actor.shootable; } : undefined;
    let h = world.castRayAndGetNormal(r, max, true, undefined, RAY_SHOT, undefined, undefined, predicate);
    const rock = this.structures?.raycastRocks(o, d, h ? Math.min(max, h.timeOfImpact) : max);
    if (rock && (!h || rock.timeOfImpact < h.timeOfImpact)) h = rock;
    if (!h) return null;
    const px = o.x + d.x * h.timeOfImpact, pz = o.z + d.z * h.timeOfImpact;
    const kind = h.kind || (h.collider && getColliderLabel(world, h.collider.handle) === 'scatter-rocks' ? 'rock' : this._surfaceKind(px, pz));
    return { t: h.timeOfImpact, normal: new V3(h.normal.x, h.normal.y, h.normal.z), kind };
  }
  _groundY(x, y, z) {
    const world = this.sim ? this.sim.world : this.qworld; if (!world) return null;
    if (!this._gray) this._gray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const r = this._gray; r.origin.x = x; r.origin.y = y + 4; r.origin.z = z;
    let h = world.castRay(r, 60, true, undefined, RAY_SHOT);
    const rock = this.structures?.raycastRocks(r.origin, r.dir, h ? Math.min(60, h.timeOfImpact) : 60);
    if (rock && (!h || rock.timeOfImpact < h.timeOfImpact)) h = rock;
    return h ? y + 4 - h.timeOfImpact : null;
  }
  _surfaceKind(x, z) {
    return this._surfaceAt(x, z, this.playerS || 0, 80, this._nn || (this._nn = {})).kind;
  }
  _surfaceAt(x, z, hint, window, out, shoulder = false) {
    const road = this.sim ? this.sim.roadQuery : (this._roadQuery || (this._roadQuery = new RoadQuery(this.road)));
    const n = road.projectDriving(x, z, hint, window, out);
    const width = n.halfWidth ?? 7;
    if (Math.abs(n.d) < width + .2) { n.kind = 'asphalt'; return n; }
    if (shoulder && Math.abs(n.d) < width + 2.7) { n.kind = 'gravel'; return n; }
    const b = this.road.biomeAt(n.s); const id = b.w > 0.5 ? b.b : b.a;
    n.kind = { desert: 'sand', canyon: 'rock', coast: 'grass', mountain: 'dirt', city: 'concrete', dam: 'concrete' }[id] || 'dirt';
    return n;
  }
  _localEvent(e) {
    if (!this.sim && this.victoryPresentation) return;
    e.time = this.time; if (e.t === 'shot' && !this.victoryPresentation) this.shots++;
    if (this.sim) this.sim.emit({ ...e, remote: false, fromGunner: true });   // solo/driver: same event list as everything else
    else { this.localEvents.push(e); this.outEvents.push(e); }                // gunner peer: show locally + forward to the driver
  }

  // ---------------------------------------------------------------------------------------------- per-frame
  /** Own both seats only after the authoritative simulation verified a boss death. */
  _beginVictoryPresentation() {
    if (this.disposed || this.victoryPresentation || !victoryPresenting(this)) return false;
    // The clearing batch credits these two Run-owned earned fields after
    // Sim freezes its combat/time statistics. Preserve that exact clear
    // while including the actual final ram kill and its cash conversion.
    if (this.sim.victoryStats) {
      this.sim.victoryStats.cash = this.sim.stats.cash;
      this.sim.victoryStats.crashKills = this.sim.stats.crashKills;
    }
    this.victorySummary = structuredClone(this.buildSummary(true));
    this.victoryPresentation = true;
    // A co-op driver's authority normally has no local weapon controller.
    // Its verified run profile supplies the same partner loadout/slot/aim.
    // Remote magazine count is not part of protocol5: this new cosmetic
    // controller starts with its own magazine, never a persistent ammo grant.
    let ownedGunner = false;
    if (!this.gunner) {
      this.gunner = new GunnerController(gunnerLoadout(this.effects), this._gunnerCtx());
      const remote = this.gunnerRemote;
      this.gunner.cur = clamp(remote.weapon, 0, this.gunner.slots.length - 1);
      this.gunner.yaw = remote.yaw; this.gunner.pitch = remote.pitch; this.gunner.ads = remote.ads ? 1 : 0;
      ownedGunner = true;
    }
    const driver = new AIDriver(this), gunner = new AIGunner(this);
    this._victoryControls = { driver, gunner, ownedGunner };
    this.aiDriver = driver; this.aiGunner = gunner;
    this.remoteDriverInput = null; this.outEvents.length = 0;
    return true;
  }

  _victoryDriverCommand(command) {
    // Road avoidance/recovery remain active; paid gadgets, healing, boost
    // and human look input cannot spend or override anything after the clear.
    command.special1 = command.special2 = command.medkit = command.nitro = command.reset = false;
    command.lookX = command.lookY = command.mouseYaw = command.mousePitch = 0;
    command.lookBack = command.cameraToggle = command.horn = false;
    return command;
  }

  _syncVictoryGunnerPose(state) {
    if (!this.gunner || !state?.gunner) return;
    const pose = state.gunner, gunner = this.gunner;
    gunner.cur = clamp(pose.weapon, 0, gunner.slots.length - 1);
    gunner.yaw = pose.yaw; gunner.pitch = pose.pitch; gunner.ads = pose.ads ? 1 : 0;
    gunner.reloading = !!pose.reloading; gunner.trigger = false;
  }

  /** Advance sim/net and produce this frame's render data. */
  update(dt, cmds, now) {
    const g = this.g; this.time += dt; this.streakT = Math.max(0, (this.streakT || 0) - dt);
    // Read the global human action once before an AI partner replaces commands.
    if (!g.paused && (this.humanDriver || this.humanGunner) && g.input?.nukePressed?.()) this._requestNuke();
    if (this.sim?.combat) {
      const revision = this.sim.combat.revision; this.sim.combat.advance(dt);
      if (this.sim.combat.revision !== revision) this.sim._combatState();
    }
    if (!this.sim) this.encounters?.updateGuest?.(dt);
    if (this.gunner) { this.gunner.crouch = 0; this.gunner.pos.x = 0; this.gunner.pos.z = 0; }
    const P = this.sim ? this.player : null;
    if (this.sim) {
      this._beginVictoryPresentation();
      // countdown -> start once the ground under the truck exists
      if (this.sim.state === 'countdown') {
        this.streamer.update(P.s);
        // start once the ground exists AND the first dressing chunks are built and warm (no compile stutter during the fly-by)
        if (!this.groundOk && (this.groundSeen || (this.streamer.groundReady(P.s)))) {
          this.groundSeen = true; this.startWaitT = (this.startWaitT || 0) + dt;
          const dr = this.dressing, ready = !dr || (dr.idle && !dr.pool.warming);
          if (ready || this.startWaitT > 6) { this.groundOk = true; g.fade(0, 0.8); }
        }
        if (this.groundOk && !this.partnerReady) g.hud.message('WAITING FOR PARTNER', 500, '#ffc21a');
        if (this.groundOk && this.partnerReady) {
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
      if (this.aiDriver) cmds.driver = this.aiDriver.update(dt);
      if (this.victoryPresentation) cmds.driver = this._victoryDriverCommand(cmds.driver);
      if (this.sim.state === 'countdown') Object.assign(cmds.driver, { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false }); // no false starts
      if (this.driverLocal || this.victoryPresentation) { P.veh.setInput(cmds.driver); this._driverActions(dt, cmds.driver); }
      if (!this.victoryPresentation && this.humanGunner && cmds.gunner.medkit && !cmds.driver.medkit) this._medkit();
      else if (!this.victoryPresentation && this.remoteDriverInput) P.veh.setInput(this.remoteDriverInput);
      // gunner state onto the sim car (from the local controller or from the remote gunner)
      const gs = P.crew.gunner;
      if (this.gunner) {
        gs.aimYaw = this.gunner.yaw; gs.aimPitch = this.gunner.pitch; gs.fire = this.gunner.trigger && this.gunner.magNow > 0; gs.crouch = false; gs.ads = this.gunner.ads > 0.5;
        gs.weapon = this.gunner.cur; gs.reloading = this.gunner.reloading; gs.x = this.gunner.pos.x; gs.z = this.gunner.pos.z;
      } else { const r = this.gunnerRemote; gs.aimYaw = r.yaw; gs.aimPitch = r.pitch; gs.fire = r.fire; gs.crouch = false; gs.ads = r.ads; gs.weapon = r.weapon; gs.reloading = r.reloading; gs.x = 0; gs.z = 0; }
      const B = this.sim.boss;
      // adrenaline pulse: a heartbeat of slow motion on big close explosions / triple kills
      if (this.pulseT > 0) this.pulseT -= dt; else this.pulseK = 0;
      this.slowmo = this.pulseT > 0 && !(B && B.dead) ? (this.pulseK || 0.45) : B && B.dead && B.deathT < 5.5 ? (B.deathT < 0.4 ? 0.2 : Math.min(1, 0.25 + (B.deathT - 0.4) * 0.12)) : (this.slowmo ? Math.min(1, this.slowmo + dt * 0.6) : 1);
      if (this.slowmo >= 1) this.slowmo = 0;
      this.acc += dt * (this.slowmo || 1);
      let steps = 0;
      const _ts = performance.now();
      while (this.acc >= DT && steps < 8) { this.sim.step(DT); this.acc -= DT; steps++; }
      if (this.sim.combat) {
        const revision = this.sim.combat.revision; this.sim.combat.advance(0);
        if (this.sim.combat.revision !== revision) this.sim._combatState();
      }
      { const ms = performance.now() - _ts; if (ms > 15) appendDiagnostic(window, '__spikes', { what: 'simSteps', ms: +ms.toFixed(1), steps, cars: this.sim.cars.size, at: +(performance.now() / 1000).toFixed(1) }); }
      if (steps === 8) this.acc = 0;
      this.alpha = this.acc / DT;
      // states from sim
      for (const c of this.sim.cars.values()) {
        let st = this.states.get(c.id);
        if (!st || st.specId !== c.spec.id) { st = makeCarState(c.id, c.spec.id, c.kind); this.states.set(c.id, st); }
        stateFromCar(c, this.alpha, st);
      }
      for (const id of this.states.keys()) if (!this.sim.cars.has(id)) this.states.delete(id);
      this.events = this.sim.drainEvents();
      this.playerS = P.s;
      this._simEventsToRun();
      this._beginVictoryPresentation();
      const Bs = this.sim.boss;
      if (Bs) { const B = Bs; const bs = this.bossState || (this.bossState = { pos: B.pos, quat: B.quat, vel: B.vel, v: 0, alive: B.alive, phase: 1, dead: false, exploded: false }); bs.v = B.v; bs.phase = B.phase; bs.dead = B.dead; bs.exploded = B.exploded; } else this.bossState = null;
      this._projectileViews();
    } else {
      // viewer peer: interpolate snapshots
      const info = this.buf.sample(now);
      if (info) {
        if (!this.fadedIn) { this.fadedIn = true; g.fade(0, 0.8); }
        this.states = this.buf.states; this.hud = info.hud; this.playerS = info.hud.dist; this.proj = info.hud.proj;
        this.simState = info.hud.state;
        this.medkits = info.hud.medkits;
        if (this.simState !== 'countdown') { this.goSeen = true; this.started = true; }
        this.bossState = this.buf.boss;
        if (this.bossState) { const gb = this.ghostBoss || (this.ghostBoss = new GhostBoss()); gb.pos.copy(this.bossState.pos); gb.quat.copy(this.bossState.quat); gb.alive = this.bossState.alive; gb.exploded = this.bossState.exploded; } else this.ghostBoss = null;
      }
      this.events = this.netEvents || []; this.netEvents = [];
      for (const st of this.states.values()) st.hitFlash = 0;
      if (this.localFlash) for (const [id, t] of this.localFlash) { const st = this.states.get(id); if (st) st.hitFlash = t; const nt = t - dt; if (nt <= 0) this.localFlash.delete(id); else this.localFlash.set(id, nt); }
      for (const [id, st] of this.states) {
        if (st.kind === 'player') for (const gs of [st.gunner, st.gunner2]) if (gs) { gs.crouch = false; gs.x = 0; gs.z = 0; }
        let gh = this.ghosts.get(id); if (!gh) { gh = new GhostCar(st); this.ghosts.set(id, gh); } gh.sync(st);
      }
      for (const id of this.ghosts.keys()) if (!this.states.has(id)) this.ghosts.delete(id);
      if (this.simState === 'over' && !this.over) { this.over = true; }
    }
    rememberDefeat(this, this.events);
    const pst = this.states.get(this.playerId);
    if (!this.sim && this.victoryPresentation) this._syncVictoryGunnerPose(pst);
    if (!this.sim && !this.victoryPresentation && cmds.gunner.medkit) this._medkit();
    if (this.streamer) this.streamer.update(this.playerS || 0);
    if (pst) this._gunnerEye(pst, this.eye || (this.eye = new THREE.Vector3()));
    if (cmds.gunner.viewToggle && this.humanGunner && !this.victoryPresentation && !isDefeated(this)) this.gcam.toggle();
    if (this.aiGunner && this.gunner && this.sim) cmds.gunner = this.aiGunner.update(dt, this.gunner, this.eye);
    if (this.victoryPresentation && this.sim) { cmds.gunner.grenade = cmds.gunner.medkit = false; cmds.gunner.viewToggle = false; }
    // debug aimbot (tests only): point the gunner at the nearest enemy
    if (window.__aimbot && this.gunner && pst && !this.victoryPresentation) {
      let best = null, bd = 140;
      for (const [id, st] of this.states) { if (st.kind !== 'enemy' || st.exploded) continue; const d = st.pos.distanceTo(pst.pos); if (d < bd) { bd = d; best = st; } }
      let aimP = best ? _t2.copy(best.pos).add(_f.set(0, 1.2, 0)) : null;
      const B = this.sim?.boss;
      if (B && !B.dead && B.pos.distanceTo(pst.pos) < 160) {
        if (bossAimPoint(B, this.eye, _t2)) { aimP = _t2; best = true; }   // the best part it can actually SEE from the bed
      }
      if (best) {
        this.pivot.copy(this.eye);
        _v.copy(aimP).sub(this.pivot);
        this.gunner.yaw = Math.atan2(_v.x, _v.z); this.gunner.pitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
        cmds.gunner.fire = true; cmds.gunner.firePressed = true;
      } else cmds.gunner.fire = false;
    }
    // Advance controls first; firing waits for this frame's camera and posed gun.
    if (this.gunner && pst && (this.sim || !this.victoryPresentation)) {
      const carYaw = Math.atan2(_f.set(0, 0, 1).applyQuaternion(pst.quat).x, _f.z);
      this.gunner.crewAlive = pst.gunnerAlive;
      if (!pst.gunnerAlive || ((this.sim ? this.sim.state : this.simState) !== 'run' && !victoryPresenting(this)) || isDefeated(this)) { cmds.gunner.fire = false; cmds.gunner.firePressed = false; cmds.gunner.reload = false; cmds.gunner.grenade = false; }
      if (this.humanGunner && !this.victoryPresentation && g.input.lastDevice === 'pad' && (g.aimAssist ?? true)) {
        this.gunner.assist(cmds.gunner, dt, { position: g.camera.position, dir: this.camDir }, this._assistTargets(), pst.vel);
      }
      // the AI gunner aims from its own eye along its own aim; a human aims through the camera
      const aimCam = this.aiGunner ? { position: this.eye, dir: _aiDir.set(Math.sin(this.gunner.yaw) * Math.cos(this.gunner.pitch), Math.sin(this.gunner.pitch), Math.cos(this.gunner.yaw) * Math.cos(this.gunner.pitch)) } : { position: g.camera.position, dir: this.camDir };
      this.gunner.update(dt, cmds.gunner, aimCam, carYaw, { carVel: pst.vel, carQuat: pst.quat, poseRevision: pst.poseRevision, streamPoseGeneration: pst.streamPoseGeneration, deferFire: true });
    }
    // The gunner's projection must precede its viewmodel. The driver's cockpit
    // eye instead queries the current crew/head pose, so resolve it after views.
    let cameraBeforeViews = (this.role !== 'driver' && !this.gunner?.weapon.mounted) || isDefeated(this);
    if (!cameraBeforeViews && this.role === 'driver') {
      // Choose the driver's mode before crew visibility/cutaways, while keeping
      // the eye query after the current head pose. A late toggle flashes the
      // external body in the cockpit (or hides it in chase) for one frame.
      if (cmds.driver.cameraToggle) {
        this.chase.toggle();
        g.hud?.message?.('VIEW · ' + this.chase.modeName, 1400);
      }
      this.cockpit?.setActive?.(this.chase.firstPerson && !cmds.driver.lookBack && !this.introOutside);
      // These exterior views do not use the animated driver's eye. Resolve them
      // once before culling/posing so a front cut shows current enemy visibility.
      cameraBeforeViews = this.chase.mode >= 3;
    }
    const newDriverExterior = this.role === 'driver' && this.chase.mode >= 3 && !isDefeated(this);
    if (cameraBeforeViews && !newDriverExterior) this._camera(dt, cmds, pst);
    // world view
    const localGunner = this.gunner ? { firstPerson: this.humanGunner && this.role !== 'driver' && this.gcam.firstPerson && this.gcam.tpK < 0.5 && !this.introOutside, scoped: !!this.gunner.weapon.scope && this.gcam.adsK > 0.8, eye: this.eye, adsK: this.gcam.adsK, bedX: this.gunner.pos.x, bedZ: this.gunner.pos.z, crouch: this.gunner.crouch, reload: this.gunner.reloading, swap: this.gunner.swapT, recoil: this.gunner.recoilAnim, throwing: this.gunner.throwing, weapon: this.gunner.weaponId, reloadT: this.gunner.reloadT, reloadLen: this.gunner.weapon.reload, camera: g.camera, gunner: this.gunner } : null;
    const evs = this.sim || !this.localEvents.length ? this.events : this.events.concat(this.localEvents); // local sim events already went through sim.emit
    this.localEvents.length = 0;
    { const _t0 = performance.now(); this.dressing?.update(dt, g.camera.position, this.playerS || 0, g.camera); const ms = performance.now() - _t0; if (ms > 10) appendDiagnostic(window, '__spikes', { what: 'dressing', ms: +ms.toFixed(1), at: +(performance.now() / 1000).toFixed(1) }); }
    this.structures?.updateRocks(this.sim ? this.sim.cars.values() : this.states.values());
    // Dressing can create/remove colliders in this frame. Resolve new exterior
    // eyes after those mutations, then give markers/culling/WorldView that eye.
    // This still advances the rig exactly once and preserves the cockpit order.
    if (newDriverExterior) this._camera(dt, cmds, pst);
    this.encounterView?.update(dt, this.encounters, this.playerS || 0);
    this.wv.updateBoss(this.bossState, dt);
    // roadblock telegraphing (signs, flares, breakable barricades) + cinematic banners (warlord intro, roadblock countdown)
    (this.hazMarks || (this.hazMarks = new HazardMarks(g.scene, this.road))).update(dt, this.playerS || 0);
    (this.banner || (this.banner = new Banner(g.hud.el))).update(dt, this.playerS || 0, this.bossState);
    // Leviathan per-part health markers (sim peer reads the boss directly, the gunner peer the snapshot's per-part hp)
    if (this.bossState || this.bossMarks) { const Bs = this.sim?.boss; (this.bossMarks || (this.bossMarks = new BossMarks(g.scene))).update(dt, this.bossState, (n) => Bs ? Bs.hp[n] / BOSS_PARTS[n].hp : this.bossState?.hp?.[n] ?? 1, g.camera, { suppressLabel: !!g.hud.gh && (g.hud.gh.partLabelOn ?? g.hud.gh.bpT > 0) }); }   // one part name on screen: the gunner HUD's readout wins
    this._updateFrustum();
    const localDriver = this.humanDriver && this.role !== 'solo' && this.role !== 'gunner' ? { firstPerson: this.chase.firstPerson && !this.introOutside, cockpit: this.cockpit, gear: this.player ? this.player.veh.gear : 1 } : null;   // cockpit + gear: first-person driver arms
    this.wv.update(dt, this.states, evs, { localDriver, cameraPos: g.camera.position, frustum: this._frustum, frustum2: this.cockpit?.active ? this.cockpit.frustum : null, night: g.look?.night ?? 0, playerId: this.playerId, playerWeaponId: this.gunner ? this.gunner.weaponId : this.effects.weapons[this.gunnerRemote.weapon] || this.effects.weapons[0], localGunner, proj: this.proj });
    if (!cameraBeforeViews) this._camera(dt, cmds, pst);
    if (this.gunner && pst && (this.sim || !this.victoryPresentation)) {
      if (!this.wv.muzzlePos(pst, this.gunner.muzzle)) this.gunner.muzzle.set(0, 0, 0);
      const aimCam = this.aiGunner ? { position: this.eye, dir: _aiDir.set(Math.sin(this.gunner.yaw) * Math.cos(this.gunner.pitch), Math.sin(this.gunner.pitch), Math.cos(this.gunner.yaw) * Math.cos(this.gunner.pitch)) } : { position: g.camera.position, dir: this.camDir.set(0, 0, -1).applyQuaternion(g.camera.quaternion) };
      if (this.gunner.finishFire(aimCam, { carVel: pst.vel })) this.wv.notifyLocalShot(pst, this.gunner);
    }
    // The local shot (and damage it caused) must reach views/FX/net exactly once
    // in the frame that supplied its muzzle, rather than next frame's moved gun.
    const late = this.sim ? this.sim.drainEvents() : this.localEvents;
    if (late.length) {
      if (this.sim) this._simEventsToRun(late);
      for (const e of late) { this.wv.handleEvent(e, this.states); evs.push(e); }
      if (!this.sim) this.localEvents.length = 0;
    }
    this._filterNukePresentations(evs);
    this.allEvents = evs;
    // first-person cockpit (local human driver): mirrors, gauges, windshield damage
    if (this.role === 'driver' && !this.cockpit) { const v = this.wv.viewMap.get(1); if (v && v.model) { this.cockpit = new Cockpit(v); g.warmMeshes?.(this.cockpit.meshes); } }
    if (this.cockpit) {
      // Cockpit-only feedback (e.g. the local windshield breaking) fans out to
      // this peer's FX/audio once, without feeding back into cockpit or net.
      const count = evs.length;
      for (let i = 0; i < count; i++) { const e = this.cockpit.onEvent(evs[i]); if (e) evs.push({ ...e, time: this.time, localOnly: true }); }
    }
    for (const e of evs) {
      if (e.t === 'combatState') this._receiveCombatState(e.state);
      else if (e.t === 'damageReceipt') this._receiveDamageReceipt(e);
      else if (e.t === 'minibossSpawn') { this.banner.miniboss(e); g.audio?.stinger('danger_riser'); }
      else if (e.t === 'minibossLost') g.hud.message(`${e.name} FELL BEHIND`, 2200, '#bbbbbb');
      else if (e.t === 'hazardWarn') { this.banner.hazard(e); g.audio?.ui('countdown_beep'); }
      else if (e.t === 'stageWarn') { this.banner.event({ title: e.title, sub: e.hint }); g.audio?.ui('countdown_beep'); }
      else if (e.t === 'stageBreak') {
        if (['tower', 'drone', 'boat'].includes(e.kind)) evs.push({ t: 'boom', pos: e.pos, radius: e.kind === 'drone' ? 2 : 3.5, kind: 'mine', localOnly: true });
        else if (e.kind !== 'barrel') evs.push({ t: 'hit', pos: e.pos, normal: [0, 1, 0], surface: e.kind === 'rock' || e.kind === 'arch' ? 'rock' : e.kind === 'rifleman' ? 'flesh' : 'metal', carId: e.id, localOnly: true });
      }
      else if (e.t === 'enemyTell' && this.time - (this.lastEnemyTell ?? -20) > 5) {
        const message = { barrel: 'EXPLOSIVE BARRELS: SHOOT OR DODGE', grenade: 'GRENADE INCOMING: KEEP MOVING', cannon: 'CANNON LINING UP', sniper: 'SNIPER LINING UP' }[e.kind];
        if (message) { g.hud.message(message, 1400, '#ffbc67'); this.lastEnemyTell = this.time; }
      }
      else if (e.t === 'barrierBreak') this.hazMarks.handleEvent(e);
      else if (e.t === 'setPiece') { this.banner.event(e); g.audio?.stinger('danger_riser', { gain: 0.7 }); }
      else if (e.t === 'minibossDown') { g.hud.message(`${e.name} WRECKED  +$${ECONOMY.minibossBounty[e.index] || ''}`, 2800, '#ffc21a'); }
      else if (e.t === 'bossSpawn') { g.hud.message('THE LEVIATHAN', 3500, '#ff3a1a'); this.abridge?.bossIntro(); }
      else if (e.t === 'bossPhase' || e.t === 'bossBeat') { this.banner.bossBeat(e); if (e.phase === 3 && !(this.lastPulse > this.time - 2)) { this.pulseT = 1.1; this.lastPulse = this.time; } }   // reactor exposed: a beat of slow-mo
      else if (e.t === 'bossPart' && e.label) g.hud.feed(`${e.label} DESTROYED`, '#ffc21a');
      else if (e.t === 'repair' && e.supply) {
        g.hud.feed('SUPPLY CACHE: TRUCK REPAIRED, CREW HEALED, KIT RESTOCKED', '#7fdc7f');
        this.medkits = Math.max(this.medkits || 0, this.effects.medkits || 0);                 // (the gunner's own peer restocks too)
        if (this.gunner) this.gunner.grenades = Math.max(this.gunner.grenades, this.effects.grenades || 0);
      }
      else if (e.t === 'repair' && e.big) g.hud.feed(`SALVAGE  +${Math.round(e.amount)} HP`, '#7fdc7f');
      else if (e.t === 'bossDown') { g.hud.message('THE LEVIATHAN IS DOWN!', 5000, '#ffc21a'); this.abridge?.victory(); }
      else if (e.t === 'bossDying') { g.hud.message('REACTOR CRITICAL', 2000, '#ff5a2a'); }
    }
    const fx = g.fx;
    if (fx) {
      const ctx = this._fxCtx || (this._fxCtx = { carViews: this.wv.viewMap, states: null, playerId: 1, runId: this.id, cameraPos: g.camera.position,
        playerMuzzle: (out) => { const st = this.states.get(this.playerId); return !!st && this.wv.muzzlePos(st, out); },
        playerEject: (out, direction) => { const st = this.states.get(this.playerId); return !!st && !!this.wv.mountedWeapon(st)?.ejectWorld(out, direction); },
        shake: (a) => { const k = a * (g.shakeMul ?? 1); this.chase.shake.add(k); this.gcam.shake.add(k); } });
      ctx.states = this.states;
      for (const e of evs) fx.handleEvent(e, ctx);
      const sc = this._surfCache || (this._surfCache = new Map());
      for (const st of this.states.values()) {
        const v = this.wv.viewMap.get(st.id); if (!v) continue;
        let c = sc.get(st.id);
        if (!c || (this.fxTick + st.id) % 8 === 0) { const n = this._surfaceAt(st.pos.x, st.pos.z, c ? c.s : (this.playerS || 0), c ? 60 : 400, this._fxn || (this._fxn = {}), true); c = { s: n.s, kind: n.kind }; sc.set(st.id, c); }
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
      const b = this.road.biomeAt(this.playerS || 0); A.ambience.setBiome(b.w > 0.5 ? b.b : b.a);
      let threat = 0; for (const st of this.states.values()) if (st.kind === 'enemy' && !st.exploded) { const d = st.pos.distanceTo(pst.pos); if (d < 120) threat += 1 - d / 120; }
      this.threat = (this.threat || 0) * 0.97 + Math.min(1, 0.22 + threat / 4 + (this.sim ? this.sim.director.level * 0.4 : 0)) * 0.03;
      A.music.setIntensity(this.threat);
      A.setDanger(pst.hp01 < 0.3 ? 1 - pst.hp01 / 0.3 : 0);
    }
    // off-screen threat chevrons (first person can't see behind)
    if (!this.threatHud && (this.humanDriver || this.humanGunner)) this.threatHud = new ThreatHUD();
    if (this.threatHud) {
      const dying = this.sim ? this.sim.state !== 'run' : this.simState !== 'run';
      const aiming = this.humanGunner && this.gunner && this.role !== 'driver' && this.gcam.adsK > 0.35; // never over sights / scopes
      this.threatHud.setVisible(!dying && !g.paused && !window.__camOverride && !this.cinematic && !this.introOutside && !aiming);
      this.threatHud.update(dt, g.camera, this.states, pst, (st) => !!this.sim?.cars.get(st.id)?.elite, this.cockpit?.active ? { cy: 0.37, ry: 0.2, rx: 0.36 } : null);
    }
    // HUD data
    this.hud2 = this._hudData(pst);
    if (this.combatHud) g.hud.setCombat?.(this.combatHud, g.input.lastDevice, keyLabel(g.input.bindings?.nuke?.[0] || ''));
    if (this.role === 'driver' && this.net) this._sendNet(dt);
    if (this.role === 'gunner' && this.net) this._sendGunner(dt);
    this._outcome(dt);
  }

  /** View/FX consumers read these coordinates during this frame only. */
  _projectileViews() {
    const list = this.proj, pool = this._projectilePool || (this._projectilePool = []);
    let count = 0;
    for (const r of this.sim.projectiles.rockets) {
      const p = pool[count] || (pool[count] = {}); p.k = 1; p.x = r.x; p.y = r.y; p.z = r.z; list[count++] = p;
    }
    for (const q of this.sim.projectiles.grenades) {
      const t = q.body.translation(), p = pool[count] || (pool[count] = {});
      p.k = 2; p.x = t.x; p.y = t.y; p.z = t.z; list[count++] = p;
    }
    list.length = count;
    return list;
  }

  _assistPoint(st, x, y, z) {
    const pts = this._assistPts, pool = this._assistPool, i = pts.length;
    const point = pool[i] || (pool[i] = { p: new THREE.Vector3(), v: null });
    if (x === undefined) point.p.copy(st.pos);
    else point.p.set(x, y, z).applyQuaternion(st.quat).add(st.pos);
    point.v = st.vel; pts.push(point);
  }

  _assistTargets() {
    const pts = this._assistPts || (this._assistPts = []); pts.length = 0;
    this._assistPool ||= [];
    for (const st of this.states.values()) {
      if (st.kind !== 'enemy' || st.exploded) continue;
      const up = st.ride.restComHeight, seats = st.spec.seats;
      const weak = st.spec.weakpoint && st.spec.hitZones?.[st.spec.weakpoint.zone];
      if (weak) { const c = weak.c; if (c) this._assistPoint(st, c[0], c[1] - up, c[2]); continue; }
      if (st.gunnerAlive && seats.gunner) { const s = seats.gunner; this._assistPoint(st, s[0], s[1] + 1.2 - up, s[2]); }
      if (st.driverAlive) { const s = seats.driver; this._assistPoint(st, s[0], s[1] + 0.5 - up, s[2]); }
      this._assistPoint(st);
      const wc = this.sim?.cars.get(st.id);
      if (wc && wc.elite && wc.weakPoint) { const c = wc.weakPoint.c; this._assistPoint(st, c[0], c[1] - up, c[2]); }
    }
    const boss = this.bossState; if (boss && !boss.dead) this._assistPoint(boss, 0, 5, -8);
    if (this.encounters) for (const actor of this.encounters.targets()) {
      const point = this._assistPool[pts.length] || (this._assistPool[pts.length] = { p: new V3(), v: new V3() });
      if (this.encounters.aimPoint(actor, this.g.camera.position, point.p)) { point.v = actor.veh.vel; pts.push(point); }
    }
    return pts;
  }

  _updateFrustum() {
    if (!this._frustum) { this._frustum = new THREE.Frustum(); this._pv = new THREE.Matrix4(); }
    // Only the camera matrices are needed for culling; ScenePass updates its attached arms/weapon later.
    const camera = this.g.camera; camera.updateWorldMatrix(true, false);
    this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this._frustum.setFromProjectionMatrix(this._pv);
  }

  _driverActions(dt, d) {
    const e = this.effects, sim = this.sim, P = this.player;
    this.oilCd = Math.max(0, (this.oilCd || 0) - dt); this.mineCd = Math.max(0, (this.mineCd || 0) - dt);
    if (sim.state !== 'run' || P.exploded) return;
    if (d.special1 && e.oil > 0 && this.oilCd <= 0) { sim.hazards.dropOil(sim, P); this.oilCd = e.oil >= 2 ? 6 : 10; }
    if (d.special2 && e.mines > 0 && this.mineCd <= 0) { sim.hazards.dropMine(sim, P, e.mines >= 2 ? 11 : 8, e.mines >= 2 ? 190 : 140); this.mineCd = 4; }
    if (d.medkit) this._medkit();
    // Holding reset also requests a safe road rescue for an upright truck
    // beached in a deep mountain ditch. Ordinary upright road driving is free.
    if (d.reset) {
      this.flipT = (this.flipT || 0) + dt;
      if (this.flipT > 1.0) {
        this.flipT = 0;
        if (P.veh.up.y < 0.55) this._unflip();
        else sim.requestDitchRecovery(P);
      }
    } else this.flipT = 0;
    if (d.horn) sim.emit({ t: 'horn', id: P.id });
  }
  _unflip(free = false) {
    const P = this.player, v = P.veh, b = v.body;
    const routePoint = P.route ? this.sim.road.drivingPointAt(P.s, P.d, P.route) : null;
    const yaw = routePoint ? routePoint.th : Math.atan2(P.veh.fwd.x, P.veh.fwd.z);
    b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    b.setTranslation({ x: P.veh.pos.x, y: routePoint ? Math.max(P.veh.pos.y + 1.8, routePoint.y + v.restComHeight + .15) : P.veh.pos.y + 1.8, z: P.veh.pos.z }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    v.poseRevision = ((v.poseRevision || 0) + 1) & 0xffff;
    v.readState(); v.prevPos.copy(v.pos); v.prevQuat.copy(v.quat);
    if (P._groundHold) P._groundHold.angularVelocity = { x: 0, y: 0, z: 0 };
    if (!free) this.sim.damageCar(P, P.maxHp * 0.04, { cause: 'flip' });
    this.sim.emit({ t: 'unflip', id: P.id });
  }
  _medkit() {
    if (this.victoryPresentation || this.medkits <= 0 || (this.sim ? this.sim.state : this.simState) !== 'run' || isDefeated(this)) return;
    if (!this.sim) { this.net.sendJSON({ t: 'medkit' }); return; }
    if (this.sim.useMedkit()) { this.medkits--; this.g.hud.message('MEDKIT', 900, '#7fdc7f'); }
  }
  _requestNuke() {
    if (this.g.paused || this.disposed || this.phase !== 'run' || isDefeated(this) || this.over || this.finished) return false;
    const seq = ++this.nukeRequestSeq;
    const message = { t: 'nuke', runId: this.id, seq };
    if (this.sim) return this.sim.activateNuke(message, 'local').ok;
    return this.net?.sendJSON(message) === true;
  }
  _filterNukePresentations(events) {
    // Local authority and online viewer share this final presentation gate.
    // Retain chronology, strip replays before HUD/FX/net and leave scoring alone.
    for (let i = 0; i < events.length;) {
      const event = events[i];
      if (event?.t === 'combatNuke') {
        if (this.disposed || !validNukeCue(event, this.id) || event.award <= this.nukePresentedAward) {
          events.splice(i, 1); continue;
        }
        this.nukePresentedAward = event.award;
        if (this.g.hud.nukeCue) this.g.hud.nukeCue();
        else this.g.hud.message('NUKE DETONATED', 850, '#ffc93a'); // Declared legacy HUD fixtures.
      }
      i++;
    }
    return events;
  }
  _receiveCombatState(state) {
    if (!validCombatState(state, this.id) || state.revision <= this.combatRevision) return false;
    this.combatRevision = state.revision; this.combatHud = { ...state };
    const input = this.g.input;
    this.g.hud.setCombat?.(this.combatHud, input.lastDevice, keyLabel(input.bindings?.nuke?.[0] || '')); return true;
  }
  _receiveDamageReceipt(receipt) {
    if (!validDamageReceipt(receipt, this.id) || receipt.revision <= this.damageReceiptRevision) return false;
    this.damageReceiptRevision = receipt.revision;
    if (this.humanGunner) this.g.hud.gh?.damageReceipt?.(receipt); return true;
  }

  _simEventsToRun(events = this.events) {
    for (const e of events) {
      if (e.remote) continue; // gunner presentation cannot authorize cash/state
      if (e.t === 'combatNuke') { this.multi = 0; this.streakT = 0; }
      if (e.t === 'minibossDown' && !this.victoryPresentation) {
        const b = Math.round((ECONOMY.minibossBounty[e.index] || 5000) * this.effects.cashMul);
        this.minibossCash = (this.minibossCash || 0) + b; (this.minibossesKilled || (this.minibossesKilled = [])).push(e.index);
        this.cash += 0; this.sim.stats.cash = this.cash;
      }
      if (e.t === 'kill' && !e.nonScoring && !this.victoryPresentation) { g_kill(this, e); }
      if (e.t === 'runOver' && !this.over) { this.over = true; this.overWhy = e.why; }
      if (e.t === 'crash' && e.id === 1) { this.chase.shake.add(clamp(e.dv * 0.05, 0, 0.7)); this.gcam.shake.add(clamp(e.dv * 0.05, 0, 0.7)); if (e.dv > 2.5) { this.g.hud.damageFlash(clamp(e.dv * 0.08, 0.2, 0.6)); this.g.input.rumble(0.8, 0.6, 200); } }
      if (e.t === 'rampLand' && e.id === 1) { const k = clamp(e.v / 14, 0.3, 1); this.chase.shake.add(0.35 * k); this.gcam.shake.add(0.4 * k); this.g.input.rumble(0.7 * k, 0.5, 220); }
      if (e.t === 'crewHit' && e.id === 1) { this.g.hud.damageFlash(0.45); this.chase.shake.add(0.12); this.gcam.shake.add(0.15); this.g.input.rumble(0.3, 0.7, 90); }
      // near miss: a raider scraping past within ~1.5 m, or a car blowing up within 8 m -> a short 0.6x heartbeat (max one per 8 s)
      if ((e.t === 'nearMiss' || (e.t === 'explode' && e.id !== 1 && this.states.get(1) && this.states.get(1).pos.distanceTo(_v.fromArray(e.pos)) < 8)) && !(this.lastPulse > this.time - 8)) { this.pulseT = 0.25; this.pulseK = 0.6; this.lastPulse = this.time; if (e.t === 'nearMiss') this.g.audio?.ui('whoosh_transition'); }
      if (e.t === 'explode' && e.size >= 1.8 && this.states.get(1) && this.states.get(1).pos.distanceTo(_v.fromArray(e.pos)) < 70 && !(this.lastPulse > this.time - 6)) { this.pulseT = 0.35; this.lastPulse = this.time; }
      if (e.t === 'explode') { const p = this.states.get(1); const d = p ? p.pos.distanceTo(_v.fromArray(e.pos)) : 999; const k = clamp(1 - d / 90, 0, 1) * e.size; this.chase.shake.add(k * 0.8); this.gcam.shake.add(k * 0.8); if (k > 0.3) this.g.input.rumble(0.6, 0.4, 250); }
    }
  }

  _camera(dt, cmds, pst) {
    const g = this.g;
    if (!pst) return;
    const B = this.bossState;
    this.cinematic = false;
    const defeated = isDefeated(this);
    if (defeated && this._finaleHudHidden) {
      this._finaleHudHidden = false;
      // Results own their visibility; only undo the finale's earlier run hide.
      if (!window.__app || window.__app.game !== g || window.__app.screen === 'run') g.hud.setVisible(true);
    }
    if (B && (B.dead || B.exploded) && !this.finaleDone && !defeated) {
      this.finaleT = (this.finaleT || 0) + dt;
      if (this.finaleT < 9) {
        // cinematic: no first-person gun/arms, no cockpit, no HUD over the war-train's death
        this.cinematic = true; this.introOutside = true; this.cockpit?.setActive(false); g.hud.setVisible(false); this._finaleHudHidden = true;
        const a = this.finaleT * 0.25 + 0.6, r = 42 - this.finaleT * 1.5;
        g.camera.position.set(B.pos.x + Math.sin(a) * r, B.pos.y + 9 + this.finaleT * 0.6, B.pos.z + Math.cos(a) * r);
        // keep the camera out of bridges / cliffs: pull it in front of the first obstruction
        const from = _t2.set(B.pos.x, B.pos.y + 5, B.pos.z), dir = _v.copy(g.camera.position).sub(from); const len = dir.length(); dir.multiplyScalar(1 / len);
        const hit = this._worldRay(from, dir, len);
        if (hit && hit.t < len) g.camera.position.copy(from).addScaledVector(dir, Math.max(6, hit.t - 1.5));
        g.camera.lookAt(B.pos.x, B.pos.y + 4, B.pos.z);
        return;
      }
      this.finaleDone = true; this.introOutside = false; this._finaleHudHidden = false;
      const app = window.__app;
      // Results and a replacement Run own their HUD; headless callers retain the legacy show.
      if (!app || (app.game === g && g.run === this && app.screen === 'run')) g.hud.setVisible(true);
    }
    if (this.victoryPresentation) {
      this.cinematic = true; this.introOutside = true; this.cockpit?.setActive(false);
      this.chase.mode = 1;
      this.chase.update(dt, pst.pos, pst.quat, pst.vel, { fovBase: g.driverFovBase ?? 85, lookX: 0, lookY: 0, mouseYaw: 0, mousePitch: 0, boosting: false });
      this.camDir.set(0, 0, -1).applyQuaternion(g.camera.quaternion);
      return;
    }
    const co = window.__camOverride; // dev: {offset:[x,y,z] in truck frame, look:[x,y,z] in truck frame}
    if (co) { const q = pst.quat; g.camera.position.set(...co.offset).applyQuaternion(q).add(pst.pos); _v.set(...co.look).applyQuaternion(q).add(pst.pos); g.camera.lookAt(_v); if (co.fov) { g.camera.fov = co.fov; g.camera.updateProjectionMatrix(); } return; }
    if (defeated) {
      // Terminal cameras start outside the restored cabin, without altering healthy FP.
      if (!this.deathFrom) {
        _f.set(0, 0, 1).applyQuaternion(pst.quat); this.deathYaw = Math.atan2(-_f.x, -_f.z) + 0.6;
        const offset = g.camera.position.clone().sub(pst.pos);
        const minRadius = Math.min(8, Math.max(4, Math.hypot(pst.spec.width, pst.spec.length) * 0.5 + 1.2));
        const radius = Math.hypot(offset.x, offset.z);
        const externalCut = radius < minRadius || offset.y < 2.6 || offset.y > 4.6 || radius > 13;
        if (radius < minRadius || offset.y < 2.6) offset.set(Math.sin(this.deathYaw) * minRadius, clamp(offset.y, 2.6, 4.6), Math.cos(this.deathYaw) * minRadius);
        else { const r0 = Math.min(13, radius); offset.x *= r0 / radius; offset.z *= r0 / radius; offset.y = clamp(offset.y, 2.6, 4.6); }
        this.deathFrom = { offset, quat: g.camera.quaternion.clone(), fov: g.camera.fov, externalCut, minRadius, lastOffset: offset.clone(), lastClear: false };
      }
      this.deathCamT = (this.deathCamT || 0) + dt;
      this.cinematic = true;
      const a = this.deathYaw + this.deathCamT * 0.3;
      const k = smooth01(this.deathCamT / 1.4), aimK = smooth01(this.deathCamT / 0.25);
      // Retain the authored position/FOV duration; aim converges separately before 0.35s.
      const r = Math.min(13, 8 + this.deathCamT * 1.0), hgt = Math.min(4.6, 2.6 + this.deathCamT * 0.35);
      _v.set(Math.sin(a) * r, hgt, Math.cos(a) * r);
      g.camera.position.copy(this.deathFrom.offset).lerp(_v, k).add(pst.pos);
      // Preserve a clear hemisphere and revalidate the last translated safe point before a large side jump.
      _deathDesired.copy(g.camera.position);
      const preferred = this.deathSide ?? 0;
      const radial = Math.hypot(_deathDesired.x - pst.pos.x, _deathDesired.z - pst.pos.z);
      let bestRadius = -1, selected = false;
      this.deathCameraHeld = false;
      for (let i = 0; i < 4; i++) {
        const side = (preferred + i) % 4;
        g.camera.position.copy(_deathDesired);
        if (side === 1) { g.camera.position.x = 2 * pst.pos.x - g.camera.position.x; g.camera.position.z = 2 * pst.pos.z - g.camera.position.z; }
        else if (side >= 2) {
          const a0 = this.deathYaw - 0.6 + (side === 3 ? Math.PI : 0), r0 = Math.max(this.deathFrom.minRadius, radial);
          g.camera.position.x = pst.pos.x + Math.sin(a0) * r0; g.camera.position.z = pst.pos.z + Math.cos(a0) * r0;
        }
        const floorClear = limitDeathCameraPosition(this, pst, g.camera.position);
        const exteriorRadius = Math.hypot(g.camera.position.x - pst.pos.x, g.camera.position.z - pst.pos.z);
        if (exteriorRadius > bestRadius) { bestRadius = exteriorRadius; _deathBest.copy(g.camera.position); }
        if (floorClear && deathCameraExterior(this, pst, g.camera.position) && boundDeathCameraMotion(this, pst, g.camera.position, dt)) { this.deathSide = side; selected = true; break; }
        if (i === 0 && this.deathFrom.lastClear) {
          g.camera.position.copy(this.deathFrom.lastOffset).add(pst.pos);
          if (limitDeathCameraPosition(this, pst, g.camera.position) && deathCameraExterior(this, pst, g.camera.position) && boundDeathCameraMotion(this, pst, g.camera.position, dt)) { this.deathCameraHeld = true; selected = true; break; }
        }
      }
      this.deathCameraClear = selected;
      if (selected) { this.deathFrom.lastOffset.copy(g.camera.position).sub(pst.pos); this.deathFrom.lastClear = true; }
      else g.camera.position.copy(_deathBest); // No reachable clear exterior point found; explicit unresolved geometry.
      g.camera.lookAt(pst.pos.x, pst.pos.y + 0.8, pst.pos.z);
      if (aimK < 1) g.camera.quaternion.slerp(this.deathFrom.quat, 1 - aimK);
      const fov = lerp(this.deathFrom.fov, 60, k); if (Math.abs(g.camera.fov - fov) > 0.05) { g.camera.fov = fov; g.camera.updateProjectionMatrix(); }
      if (g.camera.near !== 0.15) { g.camera.near = 0.15; g.camera.updateProjectionMatrix(); }
      this.introOutside = true; this.cockpit?.setActive(false); // show our own crew/truck from outside
      return;
    }
    const intro = this._introK(dt);
    if (this.role === 'driver') {
      const cockpitEye = this.chase.mode >= 3 ? null : this._cockpitEye(dt, pst, _t2);
      const ck = this.cockpit, lookBackEye = ck && cmds.driver.lookBack && this.chase.mode === 0 ? ck.lookBackWorld(_t3) : null;
      this.chase.update(dt, pst.pos, pst.quat, pst.vel, { cockpitEye, fovBase: g.driverFovBase ?? 85, lookBack: !!cmds.driver.lookBack, lookBackEye, mouseYaw: cmds.driver.mouseYaw, mousePitch: cmds.driver.mousePitch, boosting: pst.boosting, yawRate: this.sim ? this.player.veh.yawRate : 0, lookX: cmds.driver.lookX, lookY: cmds.driver.lookY, airborne: pst.airborne,
        vehicleSpec: pst.spec, restComHeight: pst.ride?.restComHeight ?? 0, vehicleView: this.wv?.cars?.get(this.playerId)?.view,
        raycastWorld: this._driverCameraWorldRay || (this._driverCameraWorldRay = (o, d, max) => this._worldRay(o, d, max)),
        groundY: this._driverCameraGroundY || (this._driverCameraGroundY = (x, originY, z) => this._groundY(x, originY - 4, z)),
      });
      if (ck) {
        ck.setUnits?.(g.units);
        ck.setActive(this.chase.mode === 0 && !lookBackEye && !this.introOutside); ck.update(dt, this.hud2, g.look?.night ?? 0);
        let behind = false; for (const st of this.states.values()) if (st.kind === 'enemy' && !st.exploded) { _v.copy(st.pos).sub(pst.pos); if (_v.lengthSq() < 170 * 170 && _v.dot(_f.set(0, 0, 1).applyQuaternion(pst.quat)) < 5) { behind = true; break; } }
        ck.threatBehind = behind;
      }
      g.audio?.setCabin?.(ck && ck.active ? 1 : 0);
      const cl = g.cabinLight;
      if (cl) {
        const nightK = clamp(((g.look?.night ?? 0) - 0.1) / 0.5, 0, 1), on = ck && ck.active ? 1 : 0;
        cl.intensity = on * (0.07 + 0.18 * nightK); // a faint daytime fill too: shaded cabs (canyon, mountains) went near-black
        if (on > 0) cl.position.copy(cockpitEye).addScaledVector(_f.set(0, 0, 1).applyQuaternion(pst.quat), 0.42).addScaledVector(_v.set(0, 1, 0).applyQuaternion(pst.quat), -0.28);
      }
      this.camDir.set(0, 0, -1).applyQuaternion(g.camera.quaternion);
    } else if (this.gunner) {
      g.audio?.setCabin?.(0); if (this.abridge) this.abridge.windGain = this.gcam.firstPerson ? 1.3 : 1; // standing in the open bed: the wind roars
      const w = this.gunner.weapon;
      if (w.mounted) {
        _mountedDir.set(Math.sin(this.gunner.yaw) * Math.cos(this.gunner.pitch), Math.sin(this.gunner.pitch), Math.cos(this.gunner.yaw) * Math.cos(this.gunner.pitch));
        this.wv.aimMountedWeapon(pst, _mountedDir, this.gunner.weaponId);
        const rig = this.wv.mountedWeapon(pst, this.gunner.weaponId);
        if (rig?.eyeWorld(_mountedEye, .60)) {
          this.eye.copy(_mountedEye); this.eye.y += .12;
          if (rig.eyeWorld(_mountedEye)) this.eye.lerp(_mountedEye, this.gunner.ads);
        }
      }
      if (w.mounted) _mountedBaseEye.copy(this.eye);
      const dir = this.gcam.update(dt, this.eye, this.gunner.yaw, this.gunner.pitch, this.gunner.ads > 0.5 && !this.gunner.reloading, { scoped: !!w.scope, scopeFov: w.scopeFov, fovBase: g.fovBase, speed01: clamp(pst.speed / 60, 0, 1), boosting: pst.boosting, truckQuat: pst.quat });
      this.camDir.copy(dir);
      if (w.mounted) {
        const rig = this.wv.mountedWeapon(pst, this.gunner.weaponId);
        if (rig?.aimWorld(dir) && rig.eyeWorld(_mountedEye, .60)) {
          // Recoil turns the cradle with the view. Move its physical eye by the
          // same delta, retaining continuous shoulder/third-person/shake offsets.
          this.eye.copy(_mountedEye); this.eye.y += .12;
          if (rig.eyeWorld(_mountedEye)) this.eye.lerp(_mountedEye, this.gunner.ads);
          g.camera.position.add(_mountedEye.subVectors(this.eye, _mountedBaseEye));
          rig.pitchJoint.getWorldQuaternion(_q2);
          _mountedDir.set(0, 0, 1).applyQuaternion(_q2);
          _mountedAimQuat.setFromUnitVectors(this.camDir, _mountedDir);
          g.camera.quaternion.premultiply(_mountedAimQuat);
          this.camDir.copy(_mountedDir);
          this.wv.syncMountedHands?.(pst, this.gunner.reloading);
        }
      }
    }
    if (intro < 1) this._introCam(intro, pst);
  }

  /** 0..1 progress of the start-of-run camera move (1 = done / first person). */
  _introK(dt) {
    if (this.introDone) return 1;
    const counting = this.sim ? this.sim.state === 'countdown' : !this.goSeen;
    if (!counting) { this.introDone = true; this.introOutside = false; return 1; }
    if (this.sim) return this.groundOk ? clamp(1 - this.countdown / 3.2, 0, 1) : 0;
    this.introT = (this.introT || 0) + dt; return clamp(this.introT / 4, 0, 1);
  }
  /** Countdown fly-by: front-right low -> alongside -> behind the gunner -> into the first-person eye (the final pose is the
   *  normal first-person camera computed just before, so the hand-off is seamless). */
  _introCam(k, pst) {
    const cam = this.g.camera;
    const fpPos = _t3.copy(cam.position), fpQuat = _q2.copy(cam.quaternion), fpFov = cam.fov;
    const L = this.spec.length || 5;
    const keys = [[-4.8, 1.0, L * 0.5 + 4.5], [-5.6, 1.9, -0.8], [-1.2, 2.9, -L * 0.5 - 5.5]];
    const looks = [[0, 1.0, 0.6], [0, 1.4, -0.2], [0, 1.9, 1.5]];
    const u = clamp(k / 0.72, 0, 1), seg = Math.min(1, u * 2 | 0), f = smooth01(u * 2 - seg);
    const a = keys[seg], b = keys[seg + 1], la = looks[seg], lb = looks[seg + 1];
    const up = pst.ride.restComHeight;
    _v.set(lerp(a[0], b[0], f), lerp(a[1], b[1], f) - up, lerp(a[2], b[2], f)).applyQuaternion(pst.quat).add(pst.pos);
    _f.set(lerp(la[0], lb[0], f), lerp(la[1], lb[1], f) - up, lerp(la[2], lb[2], f)).applyQuaternion(pst.quat).add(pst.pos);
    cam.position.copy(_v); cam.lookAt(_f);
    this.introOutside = k < 0.86; this.cinematic = this.introOutside;
    if (k > 0.72) {
      const t = smooth01((k - 0.72) / 0.28);
      cam.position.lerp(fpPos, t); cam.quaternion.slerp(fpQuat, t);
      cam.fov = lerp(52, fpFov, t);
    } else cam.fov = 52;
    cam.updateProjectionMatrix();
  }

  /** Driver's eye: the (hidden) head of the seated driver, expressed in the truck frame and smoothed there (no lag, no judder). */
  _cockpitEye(dt, pst, out) {
    const sd = pst.spec.seats.driver || [0.4, 0.6, 0.5];
    const loc = this._eyeLocal || (this._eyeLocal = new THREE.Vector3(sd[0], sd[1] + 0.68, sd[2] + 0.14));
    const crew = this.wv.cars.get(1)?.crew.driver;
    const head = crew?.bones?.Head;
    if (head) {
      head.getWorldPosition(_v);
      _v.sub(pst.pos).applyQuaternion(_q2.copy(pst.quat).invert()); _v.y += pst.ride.restComHeight;   // -> truck-local (ground origin)
      _v.z -= 0.05; _v.y += 0.14;                                                                        // behind/above the head joint: a natural distance to the wheel and glass, over the hood kit, no own shoulders in view
      const k = 1 - Math.exp(-dt * 10); loc.lerp(_v, k);
    }
    return out.set(loc.x, loc.y - pst.ride.restComHeight, loc.z).applyQuaternion(pst.quat).add(pst.pos);
  }

  /** The player's standing gunner eye in the render-interpolated truck frame. */
  _gunnerEye(pst, out) {
    const seat = pst.spec.seats.gunner || [0, 1, -1];
    out.set(seat[0], seat[1] + 1.66 - pst.ride.restComHeight, seat[2] + 0.08).applyQuaternion(pst.quat).add(pst.pos);
    return out;
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
    const b = this.road.biomeAt(s);
    const chapter = TEN_LEVELS[(this.journey.mode === 'campaign' ? this.journey.level : this.road.journeyLevelAt(s)) - 1];
    const progressTotal = this.journey.mode === 'campaign' ? chapter.bossDistance : this.journey.mode === 'marathon' ? TEN_LEVELS.length * MARATHON_LEVEL_LENGTH : BOSS_S;
    const d = {
      speed: pst ? pst.speed : 0, rpm01: pst ? pst.rpm01 : 0, nitro01: 0, nitroMax: this.spec.nitro?.capacity || 0, nitroRechargeLocked: !!pst?.nitroRechargeLocked,
      hp01: pst ? pst.hp01 : 1, dhp01: 1, ghp01: 1, dist: s, time: this.sim ? this.sim.time : (this.hud?.time || 0), biome: this.journey.mode === 'legacy' ? BIOMES[b.w > 0.5 ? b.b : b.a].name : chapter.name, prog01: s / progressTotal, boss,
      spreadPx: this.gunner ? (this.gunner.spreadNow() * Math.PI / 180) / (this.g.camera.fov * Math.PI / 180) * innerHeight : undefined,
      scoped: this.gunner && this.humanGunner && this.role !== 'driver' ? !!this.gunner.weapon.scope && this.gunner.ads > 0.85 : false, // never the AI gunner's scope on the driver's screen
      hideCross: this.gunner ? this.gcam.firstPerson && this.gcam.adsK > 0.6 : false,
      weapon: this.gunner ? this.gunner.weapon.name : undefined, mag: this.gunner ? this.gunner.magNow : 0, reloading: this.gunner ? this.gunner.reloading : false,
      showDriver: this.role !== 'gunner',
    };
    if (P) { d.nitro01 = P.veh.nitro / Math.max(0.001, P.veh.nitroMax); d.dhp01 = P.crew.driver.hp / P.crew.driver.max; d.ghp01 = P.crew.gunner ? P.crew.gunner.hp / P.crew.gunner.max : 1; }
    else if (this.hud && this.hud.dhp01 !== undefined) { d.dhp01 = this.hud.dhp01; d.ghp01 = this.hud.ghp01; d.nitro01 = this.hud.nitro01; d.hp01 = this.hud.hp01; }
    d.arrows = this.threatHud ? [] : this._threatArrows(pst); // the ThreatHUD chevrons replace the old edge arrows
    if (this.gunner && this.humanGunner && this.role !== 'driver') { d.gunner = this.gunner; d.events = this.allEvents; d.cam = this.g.camera; d.playerId = this.playerId; }   // GunnerHud
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
      if (this.sim && !this.summary && this.overT > 0.3) { this.summary = this.victorySummary || this.buildSummary(this.sim.won); if (this.net) this.net.sendJSON({ t: 'summary', s: this.summary }); }
      const summary = this.summary || this.remoteSummary;
      if (summary && this.overT > (summary.won ? 4.5 : 2.2)) this.finished = true;
    }
  }

  /** Sim peer: final results + cash breakdown (the profile owner credits it). */
  buildSummary(won = false) {
    if (won && this.victorySummary) return structuredClone(this.victorySummary);
    const sim = this.sim, st = sim.victoryStats || sim.stats, E = ECONOMY;
    const journey = this.journey || normalizeJourney(this.cfg?.journey);
    const L = sim.director.level;
    const dist = Math.max(0, st.distance - (this.cfg.startS ?? 40));
    const lines = [];
    lines.push({ label: 'RAIDERS WRECKED', amount: this.cash });
    const distCash = Math.round(Math.max(0, dist) * E.perMeter * (1 + E.perMeterLevel * L) * this.effects.cashMul);
    lines.push({ label: `DISTANCE ${(dist / 1000).toFixed(1)} KM`, amount: distCash });
    const elapsed = sim.victoryTime ?? sim.time;
    const timeCash = Math.round(elapsed * E.perSecond * this.effects.cashMul);
    lines.push({ label: 'TIME SURVIVED', amount: timeCash });
    if (this.minibossCash) lines.push({ label: 'WARLORD BOUNTIES', amount: this.minibossCash });
    const finiteLevel = journey.mode === 'campaign' ? TEN_LEVELS[journey.level - 1] : null;
    const levelCleared = !!(won && finiteLevel && (journey.level === 10 ? sim.boss?.exploded : sim.director.campaignComplete));
    if (won && (!finiteLevel || journey.level === 10)) lines.push({ label: 'THE LEVIATHAN', amount: E.bossBounty });
    if (levelCleared && journey.level < 10) lines.push({ label: `${finiteLevel.name} CLEARED`, amount: Math.round(finiteLevel.bounty * this.effects.cashMul) });
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const why = sim.result?.why;
    return {
      id: this.id, won, journey, levelCleared, cash: total, breakdown: lines, distance: dist, startS: this.cfg.startS ?? 40, furthestS: st.distance, time: elapsed, kills: st.kills, crashKills: st.crashKills || 0,
      bestStreak: sim.combat?.best ?? this.bestMulti ?? 0, shots: this.shots, hits: st.hits, cause: won ? 'VICTORY' : why === 'car' ? 'TRUCK DESTROYED' : why === 'driver' ? 'DRIVER KILLED' : why === 'gunner' ? 'GUNNER KILLED' : 'WRECKED',
      biome: journey.mode === 'legacy' ? BIOMES[(sim.road || this.road)?.biomeAt?.(st.distance)?.a || biomeAt(st.distance).a].name : TEN_LEVELS[((sim.road || this.road)?.journeyLevelAt?.(st.distance) ?? journey.level) - 1].name, minibosses: this.minibossesKilled || [],
    };
  }

  // ---------------------------------------------------------------------------------------------- networking
  _sendNet(dt) {
    this.snapAcc = advanceCadence(this.snapAcc, dt);
    if (this.snapAcc >= 1 / 30) {
      this.snapAcc = consumeCadence(this.snapAcc);
      const P = this.player;
      const bossHud = this._bossHud(); const hud = { bossId: bossHud.id, bossHp01: bossHud.hp01, hp01: P.hp / P.maxHp, dhp01: P.crew.driver.hp / P.crew.driver.max, ghp01: P.crew.gunner ? P.crew.gunner.hp / P.crew.gunner.max : 1, nitro01: P.veh.nitro / Math.max(0.001, P.veh.nitroMax), cash: this.cash, kills: this.sim.stats.kills, streak: this.sim.stats.streak, level: this.sim.director.level, dist: P.s, medkits: this.medkits };
      this.net.sendFast(encodeSnapshot(this.sim, this.sim.tick, hud));
    }
    const out = this.events.filter((e) => !e.remote && !e.localOnly);
    if (out.length) this.net.sendJSON({ t: 'events', e: out });
    this.encounterSendAcc = advanceCadence(this.encounterSendAcc || 0, dt, .1);
    if (this.encounterSendAcc >= .1) {
      this.encounterSendAcc = consumeCadence(this.encounterSendAcc, .1);
      const state = this.encounters?.snapshot();
      // An empty state also retires the last encounter on the viewer. This
      // uses bounded JSON on the reliable channel, dropping superseded poses
      // under backpressure. Retry retirement until the empty state is sent.
      if (state && (state.actors.length || this.sentEncounterActors) &&
        this.net.sendTransientJSON({ t: 'events', e: [{ t: 'stageState', state }] })) this.sentEncounterActors = state.actors.length;
    }
  }
  _sendGunner(dt) {
    if (this.victoryPresentation) { this.outEvents.length = 0; return; }
    this.gunnerSendAcc = advanceCadence(this.gunnerSendAcc, dt);
    if (this.gunnerSendAcc >= 1 / 30 && this.gunner) {
      this.gunnerSendAcc = consumeCadence(this.gunnerSendAcc);
      const gn = this.gunner;
      this.net.sendJSON({ t: 'g', y: +gn.yaw.toFixed(4), p: +gn.pitch.toFixed(4), f: gn.trigger && gn.magNow > 0 ? 1 : 0, c: 0, a: gn.ads > 0.5 ? 1 : 0, w: gn.cur, r: gn.reloading ? 1 : 0, x: 0, z: 0 }, true);
    }
    if (this.outEvents.length) { this.net.sendJSON({ t: 'shotfx', e: this.outEvents }); this.outEvents = []; }
  }
  /** Called by Game when a network message arrives during a run. */
  onNet(m) {
    if (!m || this.disposed) return;
    if (m.t === 'runReady') { this.partnerReady = true; return; }
    if (m.t === 'events') {
      if (!Array.isArray(m.e) || m.e.length > 256) return;
      if (!this.sim) rememberDefeat(this, m.e);
      for (const e of m.e) {
        if (e?.t === 'combatState' || e?.t === 'damageReceipt' || e?.t === 'combatNuke') {
          const peerRole = this.net?.activeRunRoles?.[this.net.isHost ? 'guest' : 'host'];
          if (!this.sim && m.runId === this.id && peerRole === 'driver') {
            if (e.t === 'combatState') this._receiveCombatState(e.state);
            else if (e.t === 'damageReceipt') this._receiveDamageReceipt(e);
            else if (validNukeCue(e, this.id) && e.award > this.nukeShownAward) {
              this.nukeShownAward = e.award; (this.netEvents || (this.netEvents = [])).push(e);
            }
          }
        }
        else if (e?.t === 'stageState') { if (!this.sim) this.encounters?.applySnapshot(e.state); }
        else if (e) (this.netEvents || (this.netEvents = [])).push(e);
      }
      return;
    }
    if (m.t === 'feed') { this.g.hud.feed(m.text, m.crash ? '#ffc21a' : '#fff'); if (this.gunner) this.g.hud.hitMarker(true); return; }
    if (m.t === 'summary') { this.remoteSummary = m.s; this.over = true; if (!this.sim) rememberDefeat(this); return; }
    if (m.t === 'go') { this.goSeen = true; this.g.hud.message('GO!', 900, '#ffc21a'); this.abridge?.runStart(); return; }
    if (this.sim) {
      if (victoryPresenting(this)) return;
      if (m.t === 'nuke') {
        const peerRole = this.net?.activeRunRoles?.[this.net.isHost ? 'guest' : 'host'];
        if (peerRole === 'gunner' && m.runId === this.id) this.sim.activateNuke(m, 'peer');
      }
      else if (m.t === 'g') { const r = this.gunnerRemote; r.yaw = m.y; r.pitch = m.p; r.fire = !!m.f; r.crouch = false; r.ads = !!m.a; r.weapon = m.w; r.reloading = !!m.r; r.x = 0; r.z = 0; }
      else if (m.t === 'hit') this.sim.applyHit(m.h);
      else if (m.t === 'rocket') this.sim.projectiles.addRocket(new V3(...m.o), new V3(...m.d), m.cfg, 1);
      else if (m.t === 'grenade') this.sim.projectiles.addGrenade(this.sim, new V3(...m.o), new V3(...m.v), m.cfg, 1);
      else if (m.t === 'shotfx') {
        const peerRole = this.net?.activeRunRoles?.[this.net.isHost ? 'guest' : 'host'];
        if (peerRole !== 'gunner' || m.runId !== this.id || !Array.isArray(m.e) || m.e.length > 64) return;
        for (const e of m.e) if (validRemoteGunnerFX(e, this.effects.weapons)) {
          if (e.t === 'shot') this.shots++; this.sim.emit({ ...e, remote: true });
        }
      }
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
    if (this.disposed) return; this.disposed = true;
    this._victoryControls = null; this.aiDriver = null; this.aiGunner = null; this.gunner = null; this.victoryPresentation = false;
    if (this.streamer) { this.streamer.onChunk = null; this.streamer.onChunkDrop = null; }
    this.cockpit?.dispose(); this.cockpit = null; this.threatHud?.dispose(); this.threatHud = null;
    this.banner?.dispose(); this.banner = null; this.hazMarks?.dispose(); this.hazMarks = null; this.bossMarks?.dispose(); this.bossMarks = null;
    this.g.fx?.clear();
    this.combatHud = null; this.combatRevision = -1; this.damageReceiptRevision = 0; this.nukeRequestSeq = 0;
    this.nukeShownAward = 0; this.nukePresentedAward = 0;
    this.g.hud?.setCombat?.(null);
    try { this.dressing?.dispose(); } catch (e) { console.warn(e); }
    this.structures?.dispose();
    this.abridge?.reset();
    this.wv?.dispose();
    this.encounterView?.dispose(); this.encounterView = null;
    if (!this.sim) this.encounters?.dispose();
    this.streamer?.dispose();
    this.sim?.dispose(); this.qworld?.free(); this.qworld = null;
  }
}

const _f = new V3(), _v = new V3(), _t2 = new V3(), _t3 = new V3(), _aiDir = new V3(), _q2 = new THREE.Quaternion();
const _mountedDir = new V3(), _mountedEye = new V3(), _mountedBaseEye = new V3();
const _mountedAimQuat = new THREE.Quaternion();
const _deathDesired = new V3(), _deathBest = new V3(), _deathStep = new V3(), _deathDelta = new V3();
function deathCameraExterior(run, pst, position) {
  return Math.hypot(position.x - pst.pos.x, position.z - pst.pos.z) >= run.deathFrom.minRadius - 0.05;
}
function limitDeathCameraPosition(run, pst, position) {
  // Ray-limit first, including the clearance margin beyond the point, before a floor query.
  // This keeps an overhead roof from becoming ground and activates pull-in continuously.
  for (let i = 0; i < 2; i++) {
    const from = _t2.set(pst.pos.x, pst.pos.y + 0.8, pst.pos.z), dir = _v.copy(position).sub(from); const len = dir.length();
    if (len <= 1e-6) return false;
    dir.multiplyScalar(1 / len);
    const hit = run._worldRay(from, dir, len + 0.6);
    if (hit && hit.t < len + 0.6) position.copy(from).addScaledVector(dir, Math.max(0, Math.min(len, hit.t - 0.6)));
    const floorOriginY = Math.max(pst.pos.y + 0.8, position.y);
    const gy = run._groundY(position.x, floorOriginY - 4, position.z);
    if (gy === null || position.y >= gy + 1.2 - 1e-3) return true;
    position.y = gy + 1.2;
  }
  return false; // Floor and line-of-sight did not jointly settle within the bounded passes.
}
function boundDeathCameraMotion(run, pst, position, dt) {
  if (!run.deathFrom.lastClear) return true;
  const maxStep = Math.min(0.45, Math.max(0, dt) * 15);
  _deathStep.copy(position).sub(pst.pos).sub(run.deathFrom.lastOffset);
  const distance = _deathStep.length();
  if (distance <= maxStep + 1e-6) return true;
  _deathStep.multiplyScalar(maxStep / distance).add(run.deathFrom.lastOffset).add(pst.pos);
  if (!limitDeathCameraPosition(run, pst, _deathStep) || !deathCameraExterior(run, pst, _deathStep)) return false;
  if (_deathDelta.copy(_deathStep).sub(pst.pos).sub(run.deathFrom.lastOffset).length() > maxStep + 1e-4) return false;
  position.copy(_deathStep); return true;
}

function g_kill(run, e) {
  // cash + style: crash kills and multi-kills pay more
  const base = KILL_CASH[e.spec] || 60;
  const L = run.sim.director.level;
  let mult = 1 + L * ECONOMY.killLevel;
  if (e.crash) { mult *= ECONOMY.crashMul; run.sim.stats.crashKills = (run.sim.stats.crashKills || 0) + 1; }
  if (!e.nukeDerived) {
    if (run.streakT <= 0) run.multi = 0;
    run.streakT = 3.5; run.multi++; run.bestMulti = Math.max(run.bestMulti || 0, run.multi);
    if (run.multi >= 2) mult *= 1 + Math.min(run.multi - 1, 5) * 0.15;
    if (run.multi === 3 && !(run.lastPulse > run.time - 6)) { run.pulseT = 0.3; run.lastPulse = run.time; }
  }
  const cash = Math.round(base * mult * run.effects.cashMul);
  run.cash += cash;
  run.sim.stats.cash = run.cash;
  const displayCombo = run.sim.combat ? e.earnedCombo || 0 : run.multi;
  const label = `+$${cash}  ${e.nukeDerived ? 'NUKE ' : e.crash ? 'CRASH KILL ' : ''}${!e.nukeDerived && displayCombo >= 2 ? 'x' + displayCombo : ''}`;
  run.g.hud.feed(label, e.crash ? '#ffc21a' : '#fff');
  run.g.hud.hitMarker(true);
  if (run.net) run.net.sendJSON({ t: 'feed', text: label, crash: !!e.crash });
}

function smooth01(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
