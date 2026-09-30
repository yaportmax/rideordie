// Game: owns the renderer/scene/input/HUD/post and drives whichever mode is active (menus, garage, run).
import * as THREE from 'three';
import { createRenderer } from '../core/renderer.js';
import { Input } from '../core/input.js';
import * as Assets from '../core/assets.js';
import { loadGroundArrays, makeTerrainMaterial, makeRoadMaterial, groundPrewarmMeshes } from '../world/terrain_material.js';
import { SkyRig } from '../world/sky.js';
import { Water } from '../world/water.js';
import { NightLights } from '../world/night_lights.js';
import { lookAt } from '../world/look.js';
import { Hud } from '../ui/hud.js';
import { Run } from './run.js';
import { GarageScene } from './garage_scene.js';
import { VEHICLES } from '../data/vehicles.js';
import { Post } from '../view/post.js';
import { Fx } from '../view/fx.js';
import { AudioSys } from '../core/audio.js';
import { CarView, warmRaiderViews } from '../view/car_view.js';
import { HazardMarks } from '../view/hazard_marks.js';
import { BossMarks } from '../view/boss_marks.js';
import { BossView } from '../view/boss_view.js';
import { WeaponView } from '../view/weapon_view.js';
import { CrewView } from '../view/crew_view.js';
import { ViewModel } from '../view/viewmodel.js';
import { clamp } from '../core/util.js';

export class Game {
  constructor(opts = {}) {
    this.renderer = createRenderer({ antialias: false });
    this.canvas = this.renderer.domElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.15, 9000);
    this.scene.add(this.camera);
    this.input = new Input(this.canvas);
    this.sky = new SkyRig(this.renderer, this.scene, { shadowSize: (opts.quality ?? 2) >= 3 ? 4096 : 2048 });
    this.hud = new Hud(); this.hud.setVisible(false);
    // player headlights: always in the scene (intensity 0 by day) so the light count never changes => no shader recompiles
    this.lampLights = new NightLights(this.scene);   // pooled street-lamp point lights (constant light count)
    // cockpit fill: a dim warm dash/instrument glow so the driver's hands and wheel read at night (always in the scene:
    // constant light count => no shader recompiles; intensity 0 unless the local driver is in the cockpit at night)
    this.cabinLight = new THREE.PointLight(0xffc48a, 0, 1.9, 2); this.cabinLight.castShadow = false; this.cabinLight.name = 'cabin_light'; this.scene.add(this.cabinLight);
    this.headlights = [0, 1].map(() => { const l = new THREE.SpotLight(0xffe6c4, 0, 95, 0.5, 0.85, 1.35); l.castShadow = false; this.scene.add(l, l.target); return l; });
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
    const urls = [...Object.keys(VEHICLES).map((k) => `/models/vehicles/${k}.glb`), '/models/vehicles/boss_warrig.glb', ...['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'rpg'].map((w) => `/models/weapons/${w}.glb`),
      ...['hero_gunner', 'hero_driver', 'raider_a', 'raider_b', 'raider_c', 'raider_d', 'raider_driver', 'raider_a2', 'raider_b2', 'raider_c2', 'raider_d2', 'raider_driver2', 'fp_arms'].map((c) => `/models/characters/${c}.glb`)];   // fp_arms: first-person gunner + driver arms
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
    try { this.fx = new Fx(this.scene, this.camera, { quality: this.quality }); await this.fx.load(); this.fx.setDepthSource?.(this.post); } catch (e) { console.warn('fx disabled', e); this.fx = null; }
    this.garage = new GarageScene(this.renderer);
    return this;
  }

  /**
   * Warm meshes before they are ever drawn: upload their textures (one per frame) and compile their programs asynchronously
   * (KHR_parallel_shader_compile) against the same kind of HDR target the post pipeline renders into. Resolves when done.
   */
  warmMeshes(meshes) {
    const texKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'];
    const texs = [];
    for (const m of meshes) for (const mat of [].concat(m.material || [])) for (const k of texKeys) if (mat && mat[k] && !mat[k].__up) { mat[k].__up = true; texs.push(mat[k]); }
    const q = this._texQueue || (this._texQueue = []);
    const texDone = texs.length ? new Promise((res) => { q.push(...texs); q.push(res); }) : Promise.resolve();
    return texDone.then(async () => {
      if (!this._warmRT) this._warmRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
      const vis = meshes.map((m) => m.visible);
      for (const m of meshes) m.visible = true;
      const prev = this.renderer.getRenderTarget();
      if (this.post) this.renderer.setRenderTarget(this._warmRT);
      let p;
      try { p = this.renderer.compileAsync(meshes.length === 1 ? meshes[0] : Object.assign(new THREE.Group(), { children: meshes }), this.camera, this.scene); } catch (e) { p = Promise.resolve(); }
      this.renderer.setRenderTarget(prev);
      meshes.forEach((m, i) => { m.visible = vis[i]; });
      try { await p; } catch { /* ignore */ }
    });
  }
  _pumpTextures() {
    const q = this._texQueue; if (!q || !q.length) return;
    const t0 = performance.now();
    while (q.length && performance.now() - t0 < 4) {
      const t = q.shift();
      if (typeof t === 'function') { t(); continue; }
      try { this.renderer.initTexture(t); } catch { /* ignore */ }
    }
  }

  setQuality(q) {
    this.quality = q; this.post?.setQuality(q); this.fx?.setQuality?.(q);
    this.sky.setShadowSize(q >= 3 ? 4096 : q === 0 ? 1024 : 2048);
  }

  showGarage(truckId, paint, loadout) { this.mode = 'garage'; this.garage.setTruck(truckId, paint, loadout); this.hud.setVisible(false); if (this.post) this.post.enabled = false; }

  /** Compile every material the run can show (all vehicles, weapons, boss, fx) so the first explosion or new enemy never hitches. */
  async prewarm() {
    if (this._warm) return; this._warm = true;
    const g = new THREE.Group(); g.position.set(0, -5000, 0);
    // build the real view objects (same shadow/transparency flags => same shader programs as in play)
    for (const k of Object.keys(VEHICLES)) { const v = new CarView(VEHICLES[k], { paint: 0x888888, paint2: 0x333333, shadowProxy: true }); g.add(v.root); }
    for (const r of warmRaiderViews()) g.add(r); g.add(HazardMarks.warmGroup()); g.add(BossMarks.warmGroup());   // warlord kits / nameplates / glints + roadblock telegraph
    g.add(new BossView(null).root);
    for (const w of ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'rpg']) g.add(new WeaponView(w).root);
    for (const c of ['hero_gunner', 'raider_a', 'raider_b', 'raider_c', 'raider_d', 'raider_a2', 'raider_b2', 'raider_c2', 'raider_d2']) g.add(new CrewView(c, { role: 'gunner', weapon: 'rifle' }).root);
    for (const c of ['hero_driver', 'raider_driver', 'raider_driver2']) g.add(new CrewView(c, { role: 'driver' }).root);
    g.add(ViewModel.warmObject());   // first-person viewmodel programs (patched projection) + its flash / reticle
    for (const m of Water.prewarmMeshes()) g.add(m);   // sea / lake + shoreline programs (first shown at 19 km)
    for (const m of groundPrewarmMeshes(this.terrainMat, this.roadMat)) g.add(m);   // terrain / road / ground-cover programs
    this.scene.add(g);
    this.sky.setLook(lookAt(0), true); // environment map + fog must exist, they are part of every program's key
    // compile against an HDR target like the post pipeline's scene pass (linear output => different program keys than the canvas)
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    try {
      const fxDone = this.fx?.prewarm?.(); this._fxPrewarmDone = typeof fxDone === 'function' ? fxDone : () => this.fx?.prewarmDone?.();
      if (this.post) { this.renderer.setRenderTarget(rt); await this.renderer.compileAsync(this.scene, this.camera); this.renderer.setRenderTarget(null); }
      await this.renderer.compileAsync(this.scene, this.camera);
      // upload pass: compileAsync builds programs but uploads no textures / vertex buffers, so the first raider of a run still cost
      // an 80-120 ms frame (+10 geometries, +14 textures). Draw the warm-up group once (culling off) into the tiny target.
      const culled = []; g.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
      this.renderer.setRenderTarget(rt); this.renderer.render(this.scene, this.camera); this.renderer.setRenderTarget(null);
      for (const o of culled) o.frustumCulled = true;
    } catch (e) { console.warn('prewarm', e); }
    this.renderer.setRenderTarget(null); rt.dispose(); this._fxPrewarmDone?.();
    try { await this.post?.warm?.(); }
    catch (e) { console.warn('post prewarm', e); }
    finally { this.scene.remove(g); }
  }

  async startRun(cfg) {
    this.endRun();
    const generation = this._runGeneration;
    this.fade(1, 0);
    await this.prewarm();
    if (generation !== this._runGeneration) return null;
    const run = new Run(this, cfg);
    try { await run.init(); } catch (e) { run.dispose(); this.fade(0); throw e; }
    if (generation !== this._runGeneration) { run.dispose(); return null; }
    this.run = run; this.mode = 'run'; this.paused = false;
    if (this.post) { this.post.enabled = true; this.post.cut?.(); }
    this.hud.setVisible(true); this.hud.show({ driver: run.humanDriver, gunner: run.humanGunner });
    const pad = this.input.lastDevice === 'pad';
    const H = { driver: pad ? '<b>RT</b> GAS &nbsp; <b>LT</b> BRAKE &nbsp; <b>LS</b> STEER &nbsp; <b>A</b> DRIFT &nbsp; <b>RB</b> NITRO &nbsp; <b>LB</b> LOOK BACK &nbsp; <b>Y</b> FLIP &nbsp; <b>R3</b> VIEW' : '<b>W/S</b> GAS/BRAKE &nbsp; <b>A/D</b> STEER &nbsp; <b>SPACE</b> DRIFT &nbsp; <b>SHIFT</b> NITRO &nbsp; <b>Q/E</b> OIL/MINES &nbsp; <b>B</b> LOOK BACK &nbsp; <b>R</b> FLIP &nbsp; <b>C</b> VIEW',
      gunner: pad ? '<b>RS</b> AIM &nbsp; <b>RT</b> FIRE &nbsp; <b>LT</b> SIGHTS &nbsp; <b>X</b> RELOAD &nbsp; <b>RB</b> GRENADE &nbsp; <b>Y</b> SWAP &nbsp; <b>B</b> DUCK &nbsp; <b>BACK</b> VIEW' : '<b>MOUSE</b> AIM &nbsp; <b>LMB</b> FIRE &nbsp; <b>RMB</b> SIGHTS &nbsp; <b>R</b> RELOAD &nbsp; <b>G</b> GRENADE &nbsp; <b>1-3</b> WEAPONS &nbsp; <b>CTRL</b> DUCK &nbsp; <b>V</b> VIEW',
      solo: '<b>WASD</b> DRIVE &nbsp; <b>SPACE</b> DRIFT &nbsp; <b>SHIFT</b> NITRO &nbsp; <b>T</b> FLIP &nbsp;|&nbsp; <b>MOUSE</b> AIM &nbsp; <b>LMB</b> FIRE &nbsp; <b>R</b> RELOAD &nbsp; <b>G</b> GRENADE &nbsp; <b>X</b> MEDKIT' };
    this.hud.hints([run.role === 'solo' ? H.solo : run.role === 'driver' ? H.driver : H.gunner, 'SHOOT THE DRIVERS &middot; SHOOT THE FUEL TANKS &middot; DON\'T CRASH']);
    return run;
  }
  /** Full-screen black fade (0..1) over `secs`. */
  fade(to, secs = 0.6) {
    if (!this._fadeEl) { const f = this._fadeEl = document.createElement('div'); f.style.cssText = 'position:fixed;inset:0;background:#000;pointer-events:none;z-index:5;opacity:0;transition:opacity 0.6s'; document.body.appendChild(f); }
    this._fadeEl.style.transition = `opacity ${secs}s`; this._fadeEl.style.opacity = to;
  }
  endRun() { this._runGeneration = (this._runGeneration || 0) + 1; this.paused = false; this.onPause = this.onRunEnd = null; if (this.run) { this.run.dispose(); this.run = null; } if (window.__app) window.__app._releasing = true; this.input.releaseLock(); this.input.reset(); this.hud.setVisible(false); if (this._lockEl) this._lockEl.style.display = 'none'; }

  frame(now) {
    const frameMs = now - this.last;
    const dt = Math.min(0.05, frameMs / 1000); this.last = now;
    if (this.mode === 'run' && this.run?.started && !this.paused && !this.run.over) this.post?.adaptResolution(frameMs);
    const input = this.input;
    input.poll();
    if (this.mode === 'run' && this.run) this._runFrame(dt, now);
    else if (this.mode === 'garage') { this.garage.update(dt, input); this.garage.render(); }
    this._pumpTextures();
    this.audio?.setGameplayPaused?.(this.mode === 'run' && this.paused && !this.run?.net && !this.run?.over);
    this.audio?.update(dt);
    input.endFrame();
    this.frames++;
  }

  _runFrame(dt, now) {
    const run = this.run, input = this.input;
    // pause: Esc / Start
    if ((input.hit('pause') || input.edge(9)) && this.onPause && !run.over) this.onPause();
    const frozen = this.paused && !run.net;
    let cmds;
    if (run.role === 'solo') cmds = input.solo(dt);
    else if (run.role === 'driver') cmds = { driver: input.driver(dt), gunner: input.gunner(dt) };
    else cmds = { driver: input.driver(dt), gunner: input.gunner(dt, run.gunner && run.gunner.ads > 0.5) };
    if (this.paused) {
      for (const c of [cmds.driver, cmds.gunner]) for (const k of Object.keys(c)) c[k] = typeof c[k] === 'number' ? (k === 'slot' ? -1 : 0) : false;
    }
    if (window.__forceInput) Object.assign(cmds.driver, window.__forceInput);
    if (window.__forceGunner) Object.assign(cmds.gunner, window.__forceGunner);
    const t0 = performance.now();
    if (!frozen) run.update(dt, cmds, now / 1000);
    const t1 = performance.now();
    this.look = lookAt(run.playerS || 0);
    this.sky.setLook(this.look, this.frames === 0);
    const p = run.states.get(1);
    this.sky.update(dt, this.camera, p ? p.pos : this.camera.position);
    run.dressing?.setShadowFocus?.(this.sky.shadowFocus);   // shadow casters are picked around the (camera-ahead) shadow box
    this.post?.setLook?.(this.look, this.sky.sunDir);
    run.wv.night = this.look.night;
    this.lampLights.update(this.camera, run.dressing, this.look.night);
    if (p) {
      const night = Math.max(0, (this.look.night - 0.05) / 0.6);
      this.headlights.forEach((l, i) => {
        const x = i ? -0.62 : 0.62, fz = run.spec.length / 2;
        l.position.set(x, 0.8 - p.ride.restComHeight, fz - 0.2).applyQuaternion(p.quat).add(p.pos);
        l.target.position.set(x * 1.6, -2.2 - p.ride.restComHeight, fz + 30).applyQuaternion(p.quat).add(p.pos);
        l.intensity = p.exploded ? 0 : Math.min(1, night) * 900 / Math.max(1, this.look.exp * 2.1);   // night exposure is ~2.4x: keep the beams from blowing out
      });
    }
    if (this.post && p) {
      const vmax = run.spec.engine.vmax;
      this.post.setParams({ speed01: clamp(p.speed / vmax, 0, 1), boost: p.boosting ? 1 : 0, damage01: 1 - (run.hud2?.hp01 ?? 1), night01: this.look.night, dof: this.paused ? 0.8 : 0, slowmo: run.slowmo ? 1 - run.slowmo : 0, anchor: run.wv.cars.get(1)?.view.root });
      for (const e of run.allEvents || []) {
        if (e.t === 'explode' || e.t === 'boom') this.post.shockwave?.(new THREE.Vector3(...e.pos), e.size || (e.radius || 8) / 10);
        if (e.t === 'crewHit' && e.id === 1) this.post.hit?.(0.8);
      }
    }
    const t2 = performance.now();
    run.cockpit?.renderMirrors(this.renderer, this.scene, run.wv.cars.get(1)?.view.root);
    if (this.post) this.post.render(dt); else this.renderer.render(this.scene, this.camera);
    const t3 = performance.now();
    this.hud.update(dt, run.hud2, run.started && !this.paused && !!p);
    // mouse capture prompt for mouse users who aim
    const needLock = !window.__aimbot && !window.__camOverride && run.humanGunner && run.role !== 'driver' && !this.paused && !run.over && this.input.lastDevice !== 'pad' && !this.input.locked;
    if (!this._lockEl) { const e = this._lockEl = document.createElement('div'); e.textContent = 'CLICK TO AIM'; e.style.cssText = 'position:fixed;left:50%;top:58%;transform:translateX(-50%);padding:10px 22px;background:rgba(0,0,0,.55);color:#ffc21a;font:600 16px Bahnschrift,Segoe UI,sans-serif;letter-spacing:4px;border-left:3px solid #ffc21a;pointer-events:none;z-index:4;display:none'; document.body.appendChild(e); }
    this._lockEl.style.display = needLock ? 'block' : 'none';
    if (t3 - t0 > 80) (window.__hitches || (window.__hitches = [])).push({ at: +(performance.now() / 1000).toFixed(1), sim: +(t1 - t0).toFixed(0), look: +(t2 - t1).toFixed(0), render: +(t3 - t2).toFixed(0), chunks: run.streamer?.stats?.built, cars: run.states.size, progs: this.renderer.info.programs?.length, ev: (run.allEvents || []).map((e) => e.t).join(',').slice(0, 120) });
    const P = this.perf; P.sim = P.sim * 0.95 + (t1 - t0) * 0.05; P.render = P.render * 0.95 + (t3 - t2) * 0.05; P.frame = P.frame * 0.95 + dt * 1000 * 0.05; P.fps = 1000 / P.frame;
    const st = this.post?.stats; P.calls = st ? st.calls : this.renderer.info.render.calls; P.tris = st ? st.triangles : this.renderer.info.render.triangles; P.worst = Math.max(P.worst * 0.99, dt * 1000);
    this.fx?.update?.(dt);
    // particles / decals light themselves from the sun + hemi lights; at night the scene is lit mostly by exposure,
    // moon, lamps and emissives, so give them a cool moonlit floor (otherwise smoke turns into black blobs)
    const fl = this.fx?.U?.uLight?.value, nk = this.look ? Math.min(1, Math.max(0, (this.look.night - 0.05) / 0.55)) : 0;
    if (fl && nk > 0) fl.set(Math.max(fl.x, 0.2 * nk), Math.max(fl.y, 0.23 * nk), Math.max(fl.z, 0.32 * nk));
    if (run.finished && this.onRunEnd) { const cb = this.onRunEnd; this.onRunEnd = null; cb(run); }
  }

  loop() { const f = (now) => { this.frame(now); requestAnimationFrame(f); }; requestAnimationFrame(f); }
}
