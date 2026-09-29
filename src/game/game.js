// Game: owns the renderer/scene/input/HUD/post and drives whichever mode is active (menus, garage, run).
import * as THREE from 'three';
import { createRenderer } from '../core/renderer.js';
import { Input } from '../core/input.js';
import * as Assets from '../core/assets.js';
import { loadGroundArrays, makeTerrainMaterial, makeRoadMaterial } from '../world/terrain_material.js';
import { SkyRig } from '../world/sky.js';
import { lookAt } from '../world/look.js';
import { Hud } from '../ui/hud.js';
import { Run } from './run.js';
import { GarageScene } from './garage_scene.js';
import { VEHICLES } from '../data/vehicles.js';
import { Post } from '../view/post.js';
import { Fx } from '../view/fx.js';
import { AudioSys } from '../core/audio.js';
import { clamp } from '../core/util.js';

export class Game {
  constructor(opts = {}) {
    this.renderer = createRenderer({ antialias: false });
    this.canvas = this.renderer.domElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.15, 9000);
    this.scene.add(this.camera);
    this.input = new Input(this.canvas);
    this.sky = new SkyRig(this.renderer, this.scene);
    this.hud = new Hud(); this.hud.setVisible(false);
    this.run = null; this.look = null; this.frames = 0; this.last = performance.now();
    this.fx = null; this.audio = null; this.post = null; this.ui = null; this.garage = null;
    this.mode = 'menu';           // menu | garage | run
    this.paused = false;          // solo pause freezes the sim
    this.onRunEnd = null; this.onPause = null;
    this.quality = opts.quality ?? 2;
    this.perf = { sim: 0, render: 0, frame: 16.7, fps: 60, worst: 0 };
    window.__perf = this.perf;
    addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('click', () => { if (this.mode === 'run' && this.run && !this.run.over && !this.paused) this.input.requestLock(); });
  }

  resize() {
    if (this.post) this.post.setSize(innerWidth, innerHeight); else this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.garage?.resize();
  }

  async boot(onProgress) {
    const tl = new THREE.TextureLoader();
    const tex = (n, srgb) => { const t = tl.load(`/textures/asphalt/${n}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; };
    const urls = [...Object.keys(VEHICLES).map((k) => `/models/vehicles/${k}.glb`), '/models/vehicles/boss_warrig.glb', ...['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'rpg'].map((w) => `/models/weapons/${w}.glb`)];
    await Assets.preload(urls, onProgress);
    const arrays = await loadGroundArrays();
    this.terrainMat = makeTerrainMaterial(arrays);
    this.roadMat = makeRoadMaterial({ albedo: tex('albedo', true), normal: tex('normal', false), arm: tex('arm', false) });
    try { this.post = new Post(this.renderer, this.scene, this.camera, { quality: this.quality }); this.post.setSize(innerWidth, innerHeight); }
    catch (e) { console.warn('post disabled', e); this.post = null; }
    try {
      this.audio = new AudioSys(this.camera); await this.audio.init();
      const unlock = () => this.audio.unlock();
      addEventListener('pointerdown', unlock); addEventListener('keydown', unlock); addEventListener('gamepadconnected', unlock);
    } catch (e) { console.warn('audio disabled', e); this.audio = null; }
    try { this.fx = new Fx(this.scene, this.camera, { quality: this.quality }); await this.fx.load(); } catch (e) { console.warn('fx disabled', e); this.fx = null; }
    this.garage = new GarageScene(this.renderer);
    return this;
  }

  setQuality(q) { this.quality = q; this.post?.setQuality(q); this.fx?.setQuality?.(q); }

  showGarage(truckId, paint) { this.mode = 'garage'; this.garage.setTruck(truckId, paint); this.hud.setVisible(false); if (this.post) this.post.enabled = false; }

  async startRun(cfg) {
    if (this.run) this.endRun();
    const run = new Run(this, cfg);
    await run.init();
    this.run = run; this.mode = 'run'; this.paused = false;
    if (this.post) { this.post.enabled = true; this.post.cut?.(); }
    this.hud.setVisible(true); this.hud.show({ driver: run.driverLocal, gunner: run.gunnerLocal });
    return run;
  }
  endRun() { if (this.run) { this.run.dispose(); this.run = null; } this.input.releaseLock(); this.hud.setVisible(false); }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const input = this.input;
    input.poll();
    if (this.mode === 'run' && this.run) this._runFrame(dt, now);
    else if (this.mode === 'garage') { this.garage.update(dt, input); this.garage.render(); }
    this.audio?.update(dt);
    input.endFrame();
    this.frames++;
  }

  _runFrame(dt, now) {
    const run = this.run, input = this.input;
    // pause: Esc / Start
    if ((input.hit('pause') || input.edge(9)) && this.onPause && !run.over) this.onPause();
    const frozen = this.paused && run.role === 'solo';
    let cmds;
    if (run.role === 'solo') cmds = input.solo(dt);
    else if (run.role === 'driver') cmds = { driver: input.driver(dt), gunner: input.gunner(dt) };
    else cmds = { driver: input.driver(dt), gunner: input.gunner(dt, run.gunner && run.gunner.ads > 0.5) };
    if (this.paused) { for (const k of Object.keys(cmds.driver)) if (typeof cmds.driver[k] !== 'number') cmds.driver[k] = false; else cmds.driver[k] = 0; cmds.gunner.fire = cmds.gunner.firePressed = cmds.gunner.reload = cmds.gunner.grenade = false; cmds.gunner.dYaw = cmds.gunner.dPitch = 0; }
    if (window.__forceInput) Object.assign(cmds.driver, window.__forceInput);
    if (window.__forceGunner) Object.assign(cmds.gunner, window.__forceGunner);
    const t0 = performance.now();
    if (!frozen) run.update(dt, cmds, now / 1000);
    const t1 = performance.now();
    this.look = lookAt(run.playerS || 0);
    this.sky.setLook(this.look, this.frames === 0);
    const p = run.states.get(1);
    this.sky.update(dt, this.camera, p ? p.pos : this.camera.position);
    run.wv.night = this.look.night;
    if (this.post && p) {
      const vmax = run.spec.engine.vmax;
      this.post.setParams({ speed01: clamp(p.speed / vmax, 0, 1), boost: p.boosting ? 1 : 0, damage01: 1 - (run.hud2?.hp01 ?? 1), night01: this.look.night, dof: this.paused ? 0.8 : 0, slowmo: 0, anchor: run.wv.cars.get(1)?.view.root });
      for (const e of run.allEvents || []) {
        if (e.t === 'explode' || e.t === 'boom') this.post.shockwave?.(new THREE.Vector3(...e.pos), e.size || (e.radius || 8) / 10);
        if (e.t === 'crewHit' && e.id === 1) this.post.hit?.(0.8);
      }
    }
    const t2 = performance.now();
    if (this.post) this.post.render(dt); else this.renderer.render(this.scene, this.camera);
    const t3 = performance.now();
    this.hud.update(dt, run.hud2);
    const P = this.perf; P.sim = P.sim * 0.95 + (t1 - t0) * 0.05; P.render = P.render * 0.95 + (t3 - t2) * 0.05; P.frame = P.frame * 0.95 + dt * 1000 * 0.05; P.fps = 1000 / P.frame;
    const st = this.post?.stats; P.calls = st ? st.calls : this.renderer.info.render.calls; P.tris = st ? st.triangles : this.renderer.info.render.triangles; P.worst = Math.max(P.worst * 0.99, dt * 1000);
    this.fx?.update?.(dt);
    if (run.finished && this.onRunEnd) { const cb = this.onRunEnd; this.onRunEnd = null; cb(run); }
  }

  loop() { const f = (now) => { this.frame(now); requestAnimationFrame(f); }; requestAnimationFrame(f); }
}
