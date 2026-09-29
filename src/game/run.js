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
import { BOSS_S, biomeAt, BIOMES } from '../data/biomes.js';
import { clamp, damp } from '../core/util.js';

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
    this.wv = new WorldView({ scene: g.scene, playerPaint: cfg.paint, fx: g.fx, audio: g.audio });
    this.wv.armorTier = effects.armorTier; this.wv.playerWeapon = effects.weapons[0];
    if (this.gunnerLocal) this.gunner = new GunnerController(gunnerLoadout(effects), this._gunnerCtx());
    return this;
  }

  // ---------------------------------------------------------------------------------------------- gunner plumbing
  _gunnerCtx() {
    const run = this;
    return {
      ownCar: () => run.sim ? run.player : run.ghosts.get(run.playerId),
      targets: function* () {
        if (run.sim) { for (const c of run.sim.cars.values()) if (c.kind === 'enemy') yield c; }
        else for (const gh of run.ghosts.values()) if (gh.kind === 'enemy') yield gh;
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
    const g = this.g; this.time += dt;
    const P = this.sim ? this.player : null;
    if (this.sim) {
      // countdown -> start once the ground under the truck exists
      if (this.sim.state === 'countdown') {
        this.streamer.update(P.s);
        if (P.held && this.streamer.groundReady(P.s)) { this.groundOk = true; }
        if (this.groundOk) {
          this.countdown -= dt;
          if (this.countdown <= 0) { this.sim.releaseCar(P); this.sim.start(); this.started = true; g.hud.message('GO!', 900, '#ffc21a'); this.g.emitUi && this.g.emitUi('go'); }
          else g.hud.message(String(Math.ceil(this.countdown - 0.2)) || 'GO', 500, '#fff');
        }
      }
      if (this.driverLocal) P.veh.setInput(cmds.driver);
      else if (this.remoteDriverInput) P.veh.setInput(this.remoteDriverInput);
      // gunner state onto the sim car (from the local controller or from the remote gunner)
      const gs = P.crew.gunner;
      if (this.gunner) {
        gs.aimYaw = this.gunner.yaw; gs.aimPitch = this.gunner.pitch; gs.fire = this.gunner.trigger && this.gunner.magNow > 0; gs.crouch = this.gunner.crouch > 0.5; gs.ads = this.gunner.ads > 0.5;
        gs.weapon = this.gunner.cur; gs.reloading = this.gunner.reloading; gs.x = this.gunner.pos.x; gs.z = this.gunner.pos.z;
      } else { const r = this.gunnerRemote; gs.aimYaw = r.yaw; gs.aimPitch = r.pitch; gs.fire = r.fire; gs.crouch = r.crouch; gs.ads = r.ads; gs.weapon = r.weapon; gs.reloading = r.reloading; gs.x = r.x; gs.z = r.z; }
      this.acc += dt;
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
      this.proj = [...this.sim.projectiles.rockets.map((r) => ({ k: 1, x: r.x, y: r.y, z: r.z })), ...this.sim.projectiles.grenades.map((q) => { const t = q.body.translation(); return { k: 2, x: t.x, y: t.y, z: t.z }; })];
    } else {
      // viewer peer: interpolate snapshots
      const info = this.buf.sample(now);
      if (info) {
        this.states = this.buf.states; this.hud = info.hud; this.playerS = info.hud.dist; this.proj = info.hud.proj;
        this.simState = info.hud.state;
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
      if (best) {
        this.wv.gunnerPivot(pst, this.pivot);
        _v.copy(best.pos).add(_f.set(0, 1.2, 0)).sub(this.pivot);
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
      this.gunner.update(dt, cmds.gunner, { position: g.camera.position, dir: this.camDir }, carYaw, { carVel: pst.vel });
    }
    // world view
    const localGunner = this.gunner ? { crouch: this.gunner.crouch, reload: this.gunner.reloading, swap: this.gunner.swapT, recoil: this.gunner.recoilAnim, throwing: this.gunner.throwing, weapon: this.gunner.weaponId, reloadT: this.gunner.reloadT, reloadLen: this.gunner.weapon.reload } : null;
    const evs = this.events.concat(this.localEvents.filter(() => !this.sim)); // in solo the local events already went through sim.emit
    this.localEvents.length = 0;
    this.wv.update(dt, this.states, evs, { night: g.look?.night ?? 0, playerId: this.playerId, playerWeaponId: this.gunner ? this.gunner.weaponId : this.effects.weapons[0], localGunner, proj: this.proj });
    this.allEvents = evs;
    // cameras
    this._camera(dt, cmds, pst);
    // HUD data
    this.hud2 = this._hudData(pst);
    if (this.role === 'gunner' && this.net) this._sendGunner(dt);
    this._outcome(dt);
  }

  _simEventsToRun() {
    for (const e of this.events) {
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
    const boss = null;
    const b = biomeAt(s);
    const d = {
      speed: pst ? pst.speed : 0, rpm01: pst ? pst.rpm01 : 0, nitro01: 0, nitroMax: this.spec.nitro?.capacity || 0,
      hp01: pst ? pst.hp01 : 1, dhp01: 1, ghp01: 1, dist: s, time: this.sim ? this.sim.time : 0, biome: BIOMES[b.w > 0.5 ? b.b : b.a].name, prog01: s / BOSS_S, boss,
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
    if (this.over && !this.finished) { this.overT = (this.overT || 0) + dt; if (this.overT > 0.6) { this.finished = true; } }
  }

  // ---------------------------------------------------------------------------------------------- networking
  _sendNet(dt) {
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / 30) {
      this.snapAcc = 0;
      const P = this.player;
      const hud = { hp01: P.hp / P.maxHp, dhp01: P.crew.driver.hp / P.crew.driver.max, ghp01: P.crew.gunner ? P.crew.gunner.hp / P.crew.gunner.max : 1, nitro01: P.veh.nitro / Math.max(0.001, P.veh.nitroMax), cash: this.cash, kills: this.sim.stats.kills, streak: this.sim.stats.streak, level: this.sim.director.level, dist: P.s, medkits: this.medkits };
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
    if (this.sim) {
      if (m.t === 'g') { const r = this.gunnerRemote; r.yaw = m.y; r.pitch = m.p; r.fire = !!m.f; r.crouch = !!m.c; r.ads = !!m.a; r.weapon = m.w; r.reloading = !!m.r; r.x = m.x; r.z = m.z; }
      else if (m.t === 'hit') this.sim.applyHit(m.h);
      else if (m.t === 'rocket') this.sim.projectiles.addRocket(new V3(...m.o), new V3(...m.d), m.cfg, 1);
      else if (m.t === 'grenade') this.sim.projectiles.addGrenade(this.sim, new V3(...m.o), new V3(...m.v), m.cfg, 1);
      else if (m.t === 'shotfx') for (const e of m.e) this.sim.emit({ ...e, remote: true });
      else if (m.t === 'input') this.remoteDriverInput = m.i;
    }
  }
  onFast(buf) {
    if (this.role !== 'gunner') return;
    const s = decodeSnapshot(buf); if (!s) return;
    s.proj = s.proj || [];
    this.buf.push(s, performance.now() / 1000);
  }

  dispose() {
    this.wv?.dispose();
    this.streamer?.dispose();
  }
}

const _f = new V3(), _v = new V3();
function g_kill(run, e) {
  // cash + style: crash kills and multi-kills pay more
  const base = { e_sedan: 40, e_buggy: 55, e_muscle: 70, e_technical: 95, e_van: 160, e_heavy: 260, e_tanker: 240 }[e.spec] || 40;
  const L = run.sim.director.level;
  let mult = 1 + L * 1.4;
  if (e.crash) mult *= 1.4;
  run.streakT = 3.5; run.multi++;
  if (run.multi >= 2) mult *= 1 + Math.min(run.multi - 1, 5) * 0.15;
  const cash = Math.round(base * mult * run.effects.cashMul);
  run.cash += cash;
  run.sim.stats.cash = run.cash;
  run.g.hud.feed(`+$${cash}  ${e.crash ? 'CRASH KILL ' : ''}${run.multi >= 2 ? 'x' + run.multi : ''}`, e.crash ? '#ffc21a' : '#fff');
  run.g.hud.hitMarker(true);
}
