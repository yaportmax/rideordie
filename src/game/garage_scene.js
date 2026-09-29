// Front-end 3D stages, rendered behind the transparent menu UI through MenuPost (MSAA + bloom + grade):
//   'garage' - the player's truck on a turntable in a corrugated-steel desert workshop at golden hour. Polished, reflective
//              concrete floor, sunset through the open roll-up door, a weapons workbench. The camera frames the subject of the
//              current shop tab (truck / upgrades / weapon on the bench / gunner / paint) inside the free screen area between the
//              UI panels and glides between framings.
//   'title'  - TitleScene (the dusk highway chase behind the title menu).
// Game renders this in its 'garage' mode (Game.showGarage); the App picks the stage.
import * as THREE from 'three';
import { CarView } from '../view/car_view.js';
import { makeCarState } from '../view/car_state.js';
import { VEHICLES } from '../data/vehicles.js';
import { CrewView } from '../view/crew_view.js';
import { WeaponView } from '../view/weapon_view.js';
import { MenuPost } from './menu_post.js';
import { TitleScene } from './title_scene.js';
import { buildGarageSet, BENCH, SUN_DIR, DOOR, BACK_Z } from './garage_env.js';
import { PuffSystem } from './menu_fx.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const REFL = 1;                      // layer seen by the floor reflection camera
const TRUCK_IDS = ['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4'];
const WEAPON_IDS = ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'rpg'];
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Tab framings: az = camera azimuth around the subject (0 = in front of the turntable, toward +z), el = elevation, fit = size factor. */
const VIEWS = {
  truck: { subject: 'truck', az: 0.5, el: 0.13, fit: 1.0, fov: 30, spin: 0.16 },
  upgrades: { subject: 'truck', az: 0.28, el: 0.05, fit: 0.92, fov: 30, spin: 0.1, y: -0.12 },
  weapons: { subject: 'bench', az: Math.PI / 2 + 0.28, el: 0.2, fit: 1.0, fov: 28, spin: 0.16 },
  gunner: { subject: 'gunner', az: 0.62, el: 0.14, fit: 1.0, fov: 28, spin: 0, present: -2.35 },
  paint: { subject: 'truck', az: 1.2, el: 0.1, fit: 0.98, fov: 30, spin: 0.12 },
  title: { subject: 'truck', az: 0.5, el: 0.13, fit: 1.0, fov: 30, spin: 0.16 },
};

export class GarageScene {
  constructor(renderer) {
    this.renderer = renderer;
    this.post = new MenuPost(renderer);
    this.post.setLook({ exposure: 1.0, vignette: 0.6, grain: 0.03, bloom: { strength: 0.5, radius: 0.55, threshold: 0.95 } });
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x0b0806);
    s.fog = new THREE.FogExp2(0x6a3a22, 0.0042);
    this.camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 1500);
    this.camera.layers.enable(REFL);
    this.stage = 'garage'; this.title = null; this.fade = 1; this.fadeTo = 0; this.pendingStage = null;
    this.t = 0; this.dt = 0.016;
    this.tab = 'truck'; this.frameRect = null; this.dragging = false;
    // camera state (smoothed) + goal
    this.cam = { tx: 0, ty: 1, tz: 0, az: 0.5, el: 0.13, dist: 14, fov: 30 };
    this.goal = { ...this.cam };
    this.orbit = 0; this.turn = 0.4; this.turnVel = 0.16; this.present = null;
    // ---------------------------------------------------------------- floor with planar reflection
    this.refl = new FloorReflection(renderer);
    this.floorMat = makeFloorMaterial(this.refl);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 24).rotateX(-Math.PI / 2), this.floorMat);
    floor.position.set(0, 0, 1); floor.receiveShadow = true; s.add(floor);
    // ---------------------------------------------------------------- turntable: steel disc, amber LED ring
    const tt = new THREE.Group(); s.add(tt);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.32, 0.14, 96), new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.85, roughness: 0.42, map: diamondPlate(), bumpMap: diamondPlate(true), bumpScale: 2 }));
    disc.position.y = 0.07; disc.receiveShadow = true; disc.castShadow = false; tt.add(disc);
    this.ringMat = new THREE.MeshStandardMaterial({ color: 0x1a1206, emissive: 0xffa21a, emissiveIntensity: 4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.27, 0.028, 8, 160).rotateX(Math.PI / 2), this.ringMat); ring.position.y = 0.145; tt.add(ring);
    const skirt = new THREE.Mesh(new THREE.TorusGeometry(4.33, 0.02, 6, 160).rotateX(Math.PI / 2), this.ringMat); skirt.position.y = 0.02; tt.add(skirt);
    this.turntable = new THREE.Group(); this.turntable.position.y = 0.14; s.add(this.turntable);
    this.ttDisc = tt; tt.traverse((o) => o.layers.enable(REFL));
    // ---------------------------------------------------------------- the set (walls, sky through the door, lamps, neon reflect in the floor; decals / fx do not)
    this.set = buildGarageSet(s);
    this.set.group.traverse((o) => { if ((o.isMesh && !(o.material.transparent && !o.material.depthWrite)) || o === this.set.neon) o.layers.enable(REFL); });
    this._lights();
    this.sparks = new PuffSystem(120, { tex: 'spark', renderOrder: 9 });
    this.sparks.mat.blending = THREE.AdditiveBlending; this.sparks.mat.uniforms.uAmb.value.set(4, 2.2, 0.8); this.sparks.mat.uniforms.uSunCol.value.set(0, 0, 0); this.sparks.mat.uniforms.uGrid.value.set(1, 1);
    s.add(this.sparks.mesh);
    // ---------------------------------------------------------------- truck / crew / bench weapon
    this.view = null; this.truckId = null; this.paint = null; this.crew = []; this.crewQ = new THREE.Quaternion();
    this.base = { truck: 'truck_t1', paint: 0x8f6a3d, weapon: 'pistol', armorTier: 0 };
    this.preview = {};
    this.benchWeapon = null; this.benchId = null; this.benchDrop = 0;
    this.drop = 0;
    this.ready = this.set.propsReady.then(() => this._envCapture()).then(() => this._warm());
  }

  _lights() {
    const s = this.scene;
    // low sun through the door: long golden patch across the floor, backlight on the truck
    const sun = this.sun = new THREE.DirectionalLight(0xffa052, 6.5);
    sun.position.copy(SUN_DIR).multiplyScalar(60).add(new THREE.Vector3(3, 0, -4)); sun.target.position.set(3, 0, 2);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    const c = sun.shadow.camera; c.left = -20; c.right = 20; c.top = 20; c.bottom = -20; c.near = 20; c.far = 110;
    s.add(sun, sun.target);
    // key: warm top-front spot on the bay (shadowed), cool rim from the back-left, lamp pools
    const key = this.key = new THREE.SpotLight(0xffe2c0, 520, 0, 0.5, 0.6, 2);
    key.position.set(4.5, 9.5, 8); key.target.position.set(0, 0.6, 0); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02;
    s.add(key, key.target);
    const rim = new THREE.SpotLight(0x8fb0ff, 420, 0, 0.55, 0.7, 2); rim.position.set(-7, 5.5, -7.5); rim.target.position.set(0, 1.0, 0); s.add(rim, rim.target);
    const lamp = new THREE.SpotLight(0xffb870, 180, 0, 0.75, 0.9, 2); lamp.position.set(-3.2, 6.2, -1.5); lamp.target.position.set(-2.5, 0, -1); s.add(lamp, lamp.target);
    const lamp2 = new THREE.SpotLight(0xffb870, 160, 0, 0.75, 0.9, 2); lamp2.position.set(3.4, 6.2, 1.8); lamp2.target.position.set(3, 0, 2.5); s.add(lamp2, lamp2.target);
    const bench = this.benchLight = new THREE.SpotLight(0xffe0b8, 60, 0, 0.6, 0.7, 2); bench.position.set(BENCH.x + 0.3, 2.4, BENCH.z); bench.target.position.copy(BENCH); s.add(bench, bench.target);
    const neon = new THREE.PointLight(0xff7a3a, 26, 14, 2); neon.position.set(-14, 5.2, -4.2); s.add(neon);
    s.add(new THREE.HemisphereLight(0x6a5a52, 0x1a120c, 0.55));
  }

  /** Environment reflections from the finished set (cube capture -> PMREM), so paint and chrome reflect this room. */
  _envCapture() {
    try {
      const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
      const cc = new THREE.CubeCamera(0.1, 1000, rt); cc.position.set(0, 1.6, 0); cc.layers.enableAll();
      const tt = this.turntable.visible; this.turntable.visible = false;
      this.scene.add(cc); cc.update(this.renderer, this.scene); this.scene.remove(cc);
      this.turntable.visible = tt;
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromCubemap(rt.texture).texture; this.scene.environmentIntensity = 0.9;
      pm.dispose(); rt.dispose();
    } catch (e) { console.warn('garage env capture', e); }
  }

  /** Compile every truck / weapon / crew program in this scene against the MSAA half-float target: no hitch on first preview. */
  async _warm() {
    const g = new THREE.Group(); g.position.set(0, -400, 0);
    for (const id of TRUCK_IDS) { const v = new CarView(VEHICLES[id], { paint: 0x777777, paint2: 0x30302e, lod: false }); g.add(v.root); }
    for (const w of WEAPON_IDS) g.add(new WeaponView(w).root);
    for (const t of [0, 1, 2, 3]) g.add(new CrewView('hero_gunner', { role: 'gunner', weapon: 'rifle', armorTier: t }).root);
    g.add(new CrewView('hero_driver', { role: 'driver' }).root);
    this.scene.add(g);
    const r = this.renderer, prev = r.getRenderTarget(), tm = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping; r.setRenderTarget(this.post.rt);
    let p; try { p = r.compileAsync(this.scene, this.camera); } catch { p = Promise.resolve(); }
    r.setRenderTarget(prev); r.toneMapping = tm;
    try { await p; } catch { /* ignore */ }
    this.post.warm(this.scene, this.camera);
    this.scene.remove(g);
    this.warmed = true;
  }

  // ------------------------------------------------------------------------------------------------ stages
  /** 'garage' | 'title'. Cross-fades through black. */
  setStage(stage) {
    if (stage === 'title' && !this.title) {
      this.title = new TitleScene(this.renderer);
      this.titleReady = this.title.load().then(() => { this.title.setHero(this.base.truck, this.base.paint, this.base.weapon); return this.title.warm(this.post); });
    }
    if (stage === this.stage && !this.pendingStage) return;
    if (this.fade > 0.99 && !this.pendingStage) { this._enterStage(stage); return; }
    this.pendingStage = stage; this.fadeTo = 1;
  }
  _enterStage(stage) {
    this.stage = stage; this.pendingStage = null;
    if (stage === 'title') {
      this.title.setHero(this.base.truck, this.base.paint, this.base.weapon);
      this.post.setLook({ exposure: 1.05, vignette: 0.7, grain: 0.035, bloom: { strength: 0.62, radius: 0.6, threshold: 0.9 } });
      // hold black until the chase is loaded + compiled
      this.fade = 1; this.fadeTo = 1;
      this.titleReady.then(() => { if (this.stage === 'title') this.fadeTo = 0; });
    } else {
      this.post.setLook({ exposure: 1.0, vignette: 0.6, grain: 0.03, bloom: { strength: 0.5, radius: 0.55, threshold: 0.95 } });
      this.fadeTo = 0;
      this._snapCamera();
    }
  }
  /** Fade in from black (entering the garage after a run). */
  fadeIn() { this.fade = 1; this.fadeTo = 0; }

  // ------------------------------------------------------------------------------------------------ garage content
  /** Show the player's truck (spec id) with a paint colour and loadout {weapon, armorTier}. */
  setTruck(id, paint, loadout) {
    this.base = { truck: id, paint, weapon: loadout?.weapon || 'pistol', armorTier: loadout?.armorTier || 0 };
    this._apply();
  }
  /** Shop previews: {truck?, paint?, weapon?, armorTier?} (undefined = the owned/equipped value). */
  setPreview(p = {}) { this.preview = p; this._apply(); }
  /** Camera framing for a shop tab ('truck'|'upgrades'|'weapons'|'gunner'|'paint'). */
  setTab(tab) {
    if (!VIEWS[tab]) tab = 'truck';
    if (tab === this.tab) return;
    this.tab = tab;
    const v = VIEWS[tab];
    this.present = v.present ?? null;
  }
  /** Free screen rect for the subject, in CSS px {l, r, t, b} (the gap between the UI panels). */
  setFrameRect(rect) { this.frameRect = rect; }
  /** A purchase landed: sparks + ring pulse. */
  celebrate(kind) {
    this.ringPulse = 1;
    const at = kind === 'weapon' ? BENCH.clone().add(_v.set(0.3, 0.25, 0)) : kind === 'gunner' && this.gunnerCrew ? this.gunnerCrew.root.getWorldPosition(_v).add(_v2.set(0, 1.2, 0)) : _v.set(0, 1.2, 0);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      _v2.set(Math.cos(a) * (2 + u * 4), 2 + Math.random() * 5, Math.sin(a) * (2 + u * 4));
      this.sparks.emit(at, _v2, { size: 0.05 + Math.random() * 0.06, grow: 0.2, life: 0.5 + Math.random() * 0.6, alpha: 1, drag: 0.6, rise: -9, spin: 0, frameRow: 0 });
    }
  }

  _apply() {
    const want = { truck: this.preview.truck || this.base.truck, paint: this.preview.paint ?? this.base.paint, weapon: this.preview.weapon || this.base.weapon, armorTier: this.preview.armorTier ?? this.base.armorTier };
    const truckKey = `${want.truck}`, crewKey = `${want.truck}:${this.base.weapon}:${want.armorTier}`;
    if (truckKey !== this.truckKey) { this._buildTruck(want.truck); this.truckKey = truckKey; this.crewKey = null; this.drop = 1; }
    if (crewKey !== this.crewKey) { this._buildCrew(this.base.weapon, want.armorTier); this.crewKey = crewKey; }
    if (want.paint !== this.paint) { this.paint = want.paint; this.view?.setTint(want.paint, 0x30302e); }
    if (want.weapon !== this.benchId) { this._buildBench(want.weapon); }
    if (this.title && this.stage === 'title') this.title.setHero(this.base.truck, this.base.paint, this.base.weapon);
  }
  _buildTruck(id) {
    if (this.view) { this.view.dispose(); this.view = null; }
    for (const c of this.crew) c.dispose(); this.crew = [];
    const spec = VEHICLES[id] || VEHICLES.truck_t1;
    this.spec = spec;
    this.view = new CarView(spec, { paint: this.paint ?? 0x8f6a3d, paint2: 0x30302e, lod: false });
    this.state = makeCarState(0, spec.id, 'player');
    this.state.pos.set(0, this.state.ride.restComHeight, 0);
    for (let i = 0; i < this.state.L.length; i++) this.state.L[i] = this.state.ride.restLen;
    this.view.update(this.state, 0);
    this.view.setLights?.(false, 0.6);
    this.turntable.add(this.view.root);
    this.view.root.traverse((o) => o.layers.enable(REFL));
    this.paint = null; // re-tint below
  }
  _buildCrew(weapon, armorTier) {
    for (const c of this.crew) c.dispose(); this.crew = []; this.gunnerCrew = null;
    const spec = this.spec; if (!spec || !this.view) return;
    if (spec.seats.gunner) { const g = new CrewView('hero_gunner', { role: 'gunner', weapon: weapon || 'pistol', armorTier }); this.view.root.add(g.root); g.attach(this.view, spec.seats.gunner); this.crew.push(g); this.gunnerCrew = g; }
    if (spec.seats.driver) { const d = new CrewView('hero_driver', { role: 'driver' }); this.view.root.add(d.root); d.attach(this.view, spec.seats.driver); this.crew.push(d); }
    for (const c of this.crew) c.root.traverse((o) => o.layers.enable(REFL));
  }
  _buildBench(id) {
    if (this.benchWeapon) { this.benchWeapon.root.removeFromParent(); this.benchWeapon = null; }
    this.benchId = id;
    if (!id) return;
    const w = new WeaponView(id);
    // centre the model on the display point, lying on its side along the bench (muzzle toward -z)
    const holder = new THREE.Group(); holder.add(w.root);
    w.root.rotation.set(0, Math.PI, 0);
    const box = new THREE.Box3().setFromObject(w.root), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    w.root.position.sub(ctr);
    holder.userData.size = Math.max(size.x, size.y, size.z);
    holder.position.copy(BENCH).add(_v.set(0, size.y / 2 + 0.06, 0));
    holder.userData.base = holder.position.clone();
    this.scene.add(holder);
    w.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.benchWeapon = { root: holder, view: w };
    this.benchDrop = 1;
  }

  // ------------------------------------------------------------------------------------------------ frame
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.title?.resize(); this.post.setSize(innerWidth, innerHeight); }

  update(dt, input) {
    this.dt = dt; this.t += dt;
    // stage fade
    const fk = this.fadeTo > this.fade ? dt / 0.22 : dt / 0.5;
    this.fade = this.fadeTo > this.fade ? Math.min(this.fadeTo, this.fade + fk) : Math.max(this.fadeTo, this.fade - fk);
    if (this.pendingStage && this.fade >= 0.999) this._enterStage(this.pendingStage);
    this.post.mat.uniforms.uFade.value = this.fade * this.fade * (3 - 2 * this.fade);
    if (this.stage === 'title') { if (this.title?.ready) this.title.update(dt); return; }
    this._garage(dt, input);
  }

  _garage(dt, input) {
    const v = VIEWS[this.tab] || VIEWS.truck;
    // turntable: eases to a presentation angle on the gunner tab, otherwise turns slowly (right stick / drag adds spin)
    const pad = input?.pad;
    const stick = pad && Math.abs(pad.axes[2] || 0) > 0.2 ? pad.axes[2] : 0;
    if (this.present != null && !stick) {
      const d = wrapPi(this.present - this.turn);
      this.turnVel += (d * 3.2 - this.turnVel) * damp(6, dt);
    } else {
      const target = v.spin + stick * 1.6 + (this.dragVel || 0);
      this.turnVel += (target - this.turnVel) * damp(2.2, dt);
    }
    this.dragVel = (this.dragVel || 0) * Math.exp(-dt * 2.5);
    this.turn += this.turnVel * dt;
    this.turntable.rotation.y = this.turn;
    this.ttDisc.rotation.y = this.turn;
    // truck drop-in on swap
    if (this.drop > 0) { this.drop = Math.max(0, this.drop - dt * 2.4); }
    const dy = this.drop > 0 ? Math.sin(this.drop * Math.PI * 0.5) * 0.9 * this.drop : 0;
    this.turntable.position.y = 0.14 + dy;
    // crews idle: gunner scans (or looks toward the camera on the gunner tab)
    if (this.crew.length) {
      this.turntable.updateMatrixWorld(true);
      const q = this.view.root.getWorldQuaternion(this.crewQ);
      const truckYaw = _e.setFromQuaternion(q, 'YXZ').y;
      let yaw = truckYaw + Math.sin(this.t * 0.4) * 0.5, pitch = -0.05 + Math.sin(this.t * 0.3) * 0.05;
      if (this.tab === 'gunner' && this.gunnerCrew) {
        this.gunnerCrew.root.getWorldPosition(_v);
        yaw = Math.atan2(this.camera.position.x - _v.x, this.camera.position.z - _v.z) + 0.55 + Math.sin(this.t * 0.35) * 0.08;
        pitch = 0.02;
      }
      for (const c of this.crew) c.update(dt, { alive: true, aimYaw: yaw, aimPitch: pitch, fire: false, crouch: false, reloading: false, quat: q, vel: _v2.set(0, 0, 0), steer: Math.sin(this.t * 0.5) * 0.1 });
    }
    // bench weapon: slow turn + a small hop when swapped
    if (this.benchWeapon) {
      this.benchDrop = Math.max(0, this.benchDrop - dt * 3);
      const r = this.benchWeapon.root;
      r.rotation.y = Math.sin(this.t * 0.35) * 0.35 + 0.2;
      r.position.copy(r.userData.base); r.position.y += Math.sin(this.benchDrop * Math.PI) * 0.12;
    }
    // ring pulse after purchases
    this.ringPulse = Math.max(0, (this.ringPulse || 0) - dt * 1.4);
    this.ringMat.emissiveIntensity = 4 + Math.sin(this.t * 2) * 0.4 + this.ringPulse * 18;
    // set animation
    this.set.motes.mat.uniforms.uTime.value = this.t;
    this.set.motes.mat.uniforms.uPx.value = this.renderer.getPixelRatio() * innerHeight / 1080 * 2.2;
    this.set.rayMat.opacity = 0.75 + Math.sin(this.t * 0.6) * 0.1;
    this.sparks.update(dt);
    this._cameraRig(dt, v);
  }

  _subject(v, out) {
    const spec = this.spec || VEHICLES.truck_t1;
    if (v.subject === 'bench' && this.benchWeapon) { out.copy(this.benchWeapon.root.userData.base); return Math.max(0.45, this.benchWeapon.root.userData.size * 0.62); }
    if (v.subject === 'gunner' && this.gunnerCrew) { this.gunnerCrew.root.getWorldPosition(out); out.y += 1.05; return 1.25; }
    out.set(0, 0.14 + spec.height * 0.46 + (v.y || 0), 0);
    return Math.hypot(spec.length, spec.height) * 0.5;
  }

  _cameraRig(dt, v) {
    const g = this.goal, c = this.cam, cam = this.camera;
    const R = this._subject(v, _v);
    g.tx = _v.x; g.ty = _v.y; g.tz = _v.z; g.az = v.az + this.orbit; g.el = v.el; g.fov = v.fov;
    // fit the subject into the free rect between the panels
    const W = innerWidth, H = innerHeight, fr = this.frameRect || { l: W * 0.32, r: W * 0.72, t: H * 0.14, b: H * 0.86 };
    const fx = Math.max(0.15, (fr.r - fr.l) / W), fy = Math.max(0.2, (fr.b - fr.t) / H);
    const tv = Math.tan(THREE.MathUtils.degToRad(c.fov) / 2);
    const need = Math.max(R / (fy * tv), R / (fx * tv * (W / H)));
    g.dist = need * v.fit;
    // smooth (critically damped-ish); a fast cut when snapping
    const k = damp(this.snap ? 60 : 3.0, dt); this.snap = false;
    c.tx += (g.tx - c.tx) * k; c.ty += (g.ty - c.ty) * k; c.tz += (g.tz - c.tz) * k;
    c.az += wrapPi(g.az - c.az) * k; c.el += (g.el - c.el) * k; c.dist += (g.dist - c.dist) * k; c.fov += (g.fov - c.fov) * k;
    // gentle breathing
    const az = c.az + Math.sin(this.t * 0.13) * 0.025, el = c.el + Math.sin(this.t * 0.21) * 0.01;
    cam.position.set(c.tx + Math.sin(az) * Math.cos(el) * c.dist, c.ty + Math.sin(el) * c.dist, c.tz + Math.cos(az) * Math.cos(el) * c.dist);
    cam.position.y = Math.max(0.35, cam.position.y);
    cam.lookAt(c.tx, c.ty, c.tz);
    if (Math.abs(cam.fov - c.fov) > 1e-3) cam.fov = c.fov;
    // centre of projection = centre of the free rect
    const cx = (fr.l + fr.r) / 2, cy = (fr.t + fr.b) / 2;
    cam.setViewOffset(W, H, -(cx - W / 2), -(cy - H / 2), W, H);
  }
  _snapCamera() { this.snap = true; }
  /** Mouse drag on the 3D view: spin the turntable. */
  drag(dx) { this.dragVel = (this.dragVel || 0) + dx * 0.02; }

  render() {
    if (this.stage === 'title') {
      if (this.title?.ready && this.title.hero) this.post.render(this.title.scene, this.title.camera, this.dt);
      else this.post.render(this.scene, this.camera, this.dt);
      return;
    }
    this.refl.update(this.renderer, this.scene, this.camera);
    this.post.render(this.scene, this.camera, this.dt);
  }
}

// ------------------------------------------------------------------------------------------------ planar floor reflection
class FloorReflection {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.cam = new THREE.PerspectiveCamera(); this.cam.layers.set(REFL);
    this.texMatrix = new THREE.Matrix4();
    this.size = new THREE.Vector2();
  }
  update(renderer, scene, camera) {
    const cw = renderer.domElement.width, ch = renderer.domElement.height;
    const w = Math.max(4, Math.floor(cw / 2)), h = Math.max(4, Math.floor(ch / 2));
    if (w !== this.size.x || h !== this.size.y) { this.size.set(w, h); this.rt.setSize(w, h); }
    camera.updateMatrixWorld();
    const cp = _v.setFromMatrixPosition(camera.matrixWorld);
    if (cp.y <= 0.02) return;
    const rc = this.cam;
    // mirror the camera across y = 0
    rc.position.set(cp.x, -cp.y, cp.z);
    const look = _v2.set(0, 0, -1).applyQuaternion(camera.quaternion).add(cp);
    rc.up.set(0, 1, 0).applyQuaternion(camera.quaternion); rc.up.y = -rc.up.y;
    rc.lookAt(look.x, -look.y, look.z);
    rc.far = camera.far; rc.updateMatrixWorld();
    rc.projectionMatrix.copy(camera.projectionMatrix);
    this.texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    // oblique near plane = the floor
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(rc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const P = rc.projectionMatrix.elements, q = new THREE.Vector4((Math.sign(clip.x) + P[8]) / P[0], (Math.sign(clip.y) + P[9]) / P[5], -1, (1 + P[10]) / P[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    P[2] = clip.x; P[6] = clip.y; P[10] = clip.z + 1 - 0.003; P[14] = clip.w;
    rc.projectionMatrixInverse.copy(rc.projectionMatrix).invert();
    const prev = renderer.getRenderTarget(), fog = scene.fog;
    renderer.setRenderTarget(this.rt); renderer.clear();
    renderer.render(scene, rc);
    renderer.setRenderTarget(prev);
    scene.fog = fog;
  }
}

function makeFloorMaterial(refl) {
  const tl = new THREE.TextureLoader();
  const t = (n, srgb) => { const x = tl.load(`/textures/concrete/${n}.jpg`); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.set(7, 5.6); x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; x.anisotropy = 8; return x; };
  const m = new THREE.MeshStandardMaterial({ map: t('albedo', true), normalMap: t('normal', false), roughnessMap: t('arm', false), roughness: 0.75, color: 0x8a7e72, envMapIntensity: 0.35, normalScale: new THREE.Vector2(0.6, 0.6) });
  m.userData.refl = refl;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRefl = { value: refl.rt.texture };
    sh.uniforms.uReflMat = { value: refl.texMatrix };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 uReflMat; varying vec4 vReflUv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvReflUv = uReflMat * (modelMatrix * vec4(transformed, 1.0));');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uRefl; varying vec4 vReflUv;')
      .replace('#include <opaque_fragment>', `
      {
        vec2 ruv = vReflUv.xy / vReflUv.w + normal.xz * 0.012;
        float rough = clamp(roughnessFactor, 0.0, 1.0);
        vec3 rc = textureLod(uRefl, ruv, 1.0 + rough * 3.5).rgb;
        vec3 vdir = normalize(vViewPosition);
        float fres = 0.18 + 0.82 * pow(1.0 - abs(dot(normal, -vdir)), 4.0);
        float k = (1.0 - smoothstep(0.35, 0.95, rough)) * 0.55 * fres;
        outgoingLight = outgoingLight * (1.0 - k * 0.35) + rc * k;
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'garageFloorRefl';
  return m;
}

function diamondPlate(bump = false) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bump ? '#000' : '#5a5650'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) for (let x = 0; x < 128; x += 16) {
    const o = (y / 16) % 2 ? 8 : 0;
    g.save(); g.translate(x + o + 4, y + 8); g.rotate(((y / 16) % 2 ? 1 : -1) * 0.7);
    g.fillStyle = bump ? '#fff' : '#7a766e'; g.fillRect(-5, -1.5, 10, 3); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); t.colorSpace = bump ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
