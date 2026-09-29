// Game: owns the renderer/scene/input/HUD and drives whichever mode is active (menus, garage, run).
import * as THREE from 'three';
import { createRenderer } from '../core/renderer.js';
import { Input } from '../core/input.js';
import * as Assets from '../core/assets.js';
import { loadGroundArrays, makeTerrainMaterial, makeRoadMaterial } from '../world/terrain_material.js';
import { SkyRig } from '../world/sky.js';
import { lookAt } from '../world/look.js';
import { Hud } from '../ui/hud.js';
import { Run } from './run.js';
import { VEHICLES } from '../data/vehicles.js';
import { DEFAULT_PROFILE, TRUCK_COLORS } from '../data/upgrades.js';

export class Game {
  constructor() {
    this.renderer = createRenderer({ antialias: true });
    this.canvas = this.renderer.domElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.15, 9000);
    this.scene.add(this.camera);
    this.input = new Input(this.canvas);
    this.sky = new SkyRig(this.renderer, this.scene);
    this.hud = new Hud();
    this.run = null; this.look = null; this.frames = 0; this.last = performance.now();
    this.fx = null; this.audio = null; this.post = null; this.ui = null;
    this.onRunEnd = null;
    this.perf = { sim: 0, render: 0, frame: 0, fps: 0, n: 0, acc: 0, worst: 0 };
    window.__perf = this.perf;
    addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('click', () => { if (this.run && !this.run.over) this.input.requestLock(); });
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.post?.setSize?.(innerWidth, innerHeight);
  }

  async boot(onProgress) {
    const tl = new THREE.TextureLoader();
    const tex = (n, srgb) => { const t = tl.load(`/textures/asphalt/${n}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; };
    const urls = Object.keys(VEHICLES).map((k) => `/models/vehicles/${k}.glb`);
    await Assets.preload(urls, onProgress);
    const arrays = await loadGroundArrays();
    this.terrainMat = makeTerrainMaterial(arrays);
    this.roadMat = makeRoadMaterial({ albedo: tex('albedo', true), normal: tex('normal', false), arm: tex('arm', false) });
    return this;
  }

  async startRun(cfg) {
    if (this.run) this.endRun();
    const run = new Run(this, cfg);
    await run.init();
    this.run = run;
    this.hud.setVisible(true); this.hud.show({ driver: run.driverLocal, gunner: run.gunnerLocal });
    return run;
  }
  endRun() { if (this.run) { this.run.dispose(); this.run = null; } this.input.releaseLock(); }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const input = this.input;
    input.poll();
    if (this.run) {
      const run = this.run;
      let cmds;
      if (run.role === 'solo') cmds = input.solo(dt);
      else if (run.role === 'driver') cmds = { driver: input.driver(dt), gunner: input.gunner(dt) };
      else cmds = { driver: input.driver(dt), gunner: input.gunner(dt, run.gunner && run.gunner.ads > 0.5) };
      if (window.__forceInput) Object.assign(cmds.driver, window.__forceInput);
      if (window.__forceGunner) Object.assign(cmds.gunner, window.__forceGunner);
      const t0 = performance.now();
      run.update(dt, cmds, now / 1000);
      const t1 = performance.now();
      this.look = lookAt(run.playerS || 0);
      this.sky.setLook(this.look, this.frames === 0);
      const p = run.states.get(1);
      this.sky.update(dt, this.camera, p ? p.pos : this.camera.position);
      run.wv.night = this.look.night;
      const t2 = performance.now();
      if (this.post) this.post.render(dt); else this.renderer.render(this.scene, this.camera);
      const t3 = performance.now();
      this.hud.update(dt, run.hud2);
      const P = this.perf; P.sim = P.sim * 0.95 + (t1 - t0) * 0.05; P.render = P.render * 0.95 + (t3 - t2) * 0.05; P.frame = P.frame * 0.95 + dt * 1000 * 0.05; P.fps = 1000 / P.frame; P.calls = this.renderer.info.render.calls; P.tris = this.renderer.info.render.triangles; P.worst = Math.max(P.worst * 0.99, dt * 1000);
      this.fx?.update?.(dt);
      if (run.finished && this.onRunEnd) { const cb = this.onRunEnd; this.onRunEnd = null; cb(run); }
    }
    input.endFrame();
    this.frames++;
  }

  loop() { const f = (now) => { this.frame(now); requestAnimationFrame(f); }; requestAnimationFrame(f); }
}
