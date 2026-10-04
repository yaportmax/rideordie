// Front-end 3D stages, rendered behind the transparent menu UI through MenuPost (MSAA + bloom + grade):
//   'garage' - the player's truck on a turntable in a corrugated-steel desert workshop at golden hour. Polished, reflective
//              concrete floor, sunset through the open roll-up door, a weapons workbench. The camera frames the subject of the
//              current shop tab (truck / upgrades / weapon on the bench / gunner / paint) inside the free screen area between the
//              UI panels and glides between framings.
//   'title'  - TitleScene (the dusk highway chase behind the title menu).
// Game renders this in its 'garage' mode (Game.showGarage); the App picks the stage.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CarView } from '../view/car_view.js';
import { makeCarState } from '../view/car_state.js';
import { VEHICLES, vehicleModelURL } from '../data/vehicles.js';
import { PLAYER_VEHICLE_IDS, DRIVER_UPGRADE_MAX } from '../data/vehicle_families.js';
import { sanitizeVisualLevels, visualKey } from '../view/car_upgrade_plan.js';
import { CrewView } from '../view/crew_view.js';
import { WeaponView } from '../view/weapon_view.js';
import { MountedGun } from '../view/mounted_gun.js';
import { REFLEX_GUNS, sanitizeOpticId, weaponOpticKey } from '../data/weapon_optics.js';
import { MenuPost, warmScene } from './menu_post.js';
import { TitleScene } from './title_scene.js';
import { buildGarageSet, BENCH, SUN_DIR, DOOR, BACK_Z } from './garage_env.js';
import { PuffSystem } from './menu_fx.js';
import { GpuTimer } from '../view/post/gpu_timer.js';
import { HUMMER_GARAGE_ID, TANK_GARAGE_ID, HummerGarageEnvelope, TankGarageEnvelope, hummerGarageFitDistance } from './hummer_garage_fit.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const REFL = 1;                      // layer seen by the floor reflection camera
const TRUCK_IDS = PLAYER_VEHICLE_IDS;
const WEAPON_IDS = ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'rpg', 'minigun'];
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Tab framings: az = camera azimuth around the subject (0 = in front of the turntable, toward +z), el = elevation, fit = size factor. */
const VIEWS = {
  truck: { subject: 'truck', az: 0.5, el: 0.13, fit: 0.84, fov: 30, spin: 0.16 },
  upgrades: { subject: 'truck', az: 0.28, el: 0.05, fit: 0.8, fov: 30, spin: 0.1, y: -0.12 },
  weapons: { subject: 'bench', az: Math.PI / 2 + 0.28, el: 0.2, fit: 1.0, fov: 28, spin: 0.16 },
  gunner: { subject: 'gunner', az: 0.62, el: 0.14, fit: 1.0, fov: 28, spin: 0, present: -2.35 },
  paint: { subject: 'truck', az: -0.55, el: 0.16, fit: 0.84, fov: 30, spin: 0.12 },
  title: { subject: 'truck', az: 0.5, el: 0.13, fit: 1.0, fov: 30, spin: 0.16 },
};

export class GarageScene {
  constructor(renderer) {
    this.renderer = renderer;
    this.post = new MenuPost(renderer);
    this.post.setLook({ exposure: 0.8, vignette: 0.6, grain: 0.03, bloom: { strength: 0.38, radius: 0.5, threshold: 1.25 } });
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x0b0806);
    s.fog = new THREE.FogExp2(0x5a3a28, 0.0042);
    // placeholder PMREM with the same size/defines as the captured one below: programs never recompile when it is swapped
    const pm = new THREE.PMREMGenerator(renderer);
    s.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; s.environmentIntensity = 0.25; pm.dispose();
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
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.32, 0.14, 96), new THREE.MeshStandardMaterial({ color: 0x5a5650, metalness: 0.45, roughness: 0.72, envMapIntensity: 0.7, map: discTex(), roughnessMap: discTex(true) }));
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
    this.sparks = new PuffSystem(120, { tex: 'spark', renderOrder: 9, animFrames: false });
    this.sparks.mat.blending = THREE.AdditiveBlending; this.sparks.mat.uniforms.uAmb.value.set(4, 2.2, 0.8); this.sparks.mat.uniforms.uSunCol.value.set(0, 0, 0); this.sparks.mat.uniforms.uGrid.value.set(1, 1);
    s.add(this.sparks.mesh);
    // ---------------------------------------------------------------- truck / crew / bench weapon
    this.view = null; this.truckId = null; this.paint = null; this.crew = []; this.crewQ = new THREE.Quaternion();
    this.base = { truck: 'player_sedan_t1', paint: 0x8f6a3d, weapon: 'pistol', opticId: 'standard', upgradeLevels: sanitizeVisualLevels() };
    this.preview = {};
    this.benchWeapon = null; this.benchId = null; this.benchDrop = 0;
    this.drop = 0;
  }
  /** Loads + warms both menu stages (started on first use, so ?solo dev runs never pay for it). */
  get ready() { return this._ready || (this._ready = this._boot()); }

  /**
   * Startup (behind the boot screen): build the title chase + the garage set, compile every program they can show (all trucks,
   * weapons, crew) and draw both stages once off-screen. ANGLE finishes shader work on the first draw, so compiling alone
   * is not enough: after this the title, the garage and every shop preview render without a hitch.
   */
  async _boot() {
    const L = (m) => (window.__menuLog || (window.__menuLog = [])).push([+(performance.now() / 1000).toFixed(2), m]);
    this._initTitle();
    await this.set.propsReady; L('props');
    const g = await this._warm(); L('warmed');
    this._envCapture(); L('env');
    try { await this.titleReady; await Promise.race([this.title.propsLoaded, new Promise((r) => setTimeout(r, 9000))]); } catch { /* ignore */ }
    L('title');
    this._drawWarm(g); L('drawn');
    for (const view of g.userData.warmVehicleViews || []) view.dispose();
    for (const view of g.userData.warmWeaponViews || []) view.dispose(this._warmMaterials);
    for (const crew of g.userData.warmCrewViews || []) crew.dispose();
    this.scene.remove(g);
    this.warmed = true;
  }
  /** Render both stages (and the preview group) once into the pipeline's own targets. */
  _drawWarm(g) {
    const r = this.renderer, cam = this.camera;
    try {
      g.position.set(0, 0.14, 0); g.updateMatrixWorld(true);
      g.traverse((o) => o.layers.enable(REFL));
      this.sparks.emit(_v.set(0, 1, 0), _v2.set(0, 1, 0), { life: 0.2 }); this.sparks.update(0.01);
      // every framing the shop uses (truck, bench, gunner, side), with the floor reflection pass
      for (const [p, l] of [[[7, 3, 12], [0, 1, 0]], [[-8.5, 1.8, 5.5], [BENCH.x, BENCH.y, BENCH.z]], [[3, 2.6, 3], [0, 1.8, -1]], [[-2, 3, -6], [0, 1.2, 4]]]) {
        cam.position.set(...p); cam.lookAt(...l); cam.updateMatrixWorld();
        this.refl.update(r, this.scene, cam);
        this.post.render(this.scene, cam, 0.016);
      }
      g.position.set(0, -400, 0);
      const T = this.title;
      if (T?.hero) {
        for (let i = 0; i < T.shots.length; i++) { T.shot = i; T.shotT = 2; T.update(0.016); this.post.render(T.scene, T.camera, 0.016); }
        T.shot = 0; T.shotT = 0.4;
      }
      r.setRenderTarget(null);
    } catch (e) { console.warn('menu draw warm', e); }
  }

  _lights() {
    const s = this.scene;
    // low sun through the door: long golden patch across the floor, backlight on the truck
    const sun = this.sun = new THREE.DirectionalLight(0xffb070, 3.6);
    sun.position.copy(SUN_DIR).multiplyScalar(60).add(new THREE.Vector3(3, 0, -4)); sun.target.position.set(3, 0, 2);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    const c = sun.shadow.camera; c.left = -13; c.right = 13; c.top = 13; c.bottom = -13; c.near = 20; c.far = 110;
    s.add(sun, sun.target);
    // key: warm top-front spot on the bay (shadowed), cool rim from the back-left, lamp pools
    const key = this.key = new THREE.SpotLight(0xffe2c0, 520, 0, 0.5, 0.6, 2);
    key.position.set(4.5, 9.5, 8); key.target.position.set(0, 0.6, 0); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02;
    s.add(key, key.target);
    const rim = new THREE.SpotLight(0x9ab4ff, 300, 0, 0.3, 0.8, 2); rim.position.set(-7, 6.5, -7.5); rim.target.position.set(0, 1.7, 0); s.add(rim, rim.target);
    // (kept to 1 directional + 3 spots: every extra light makes every program slower to compile and to shade)
    const bench = this.benchLight = new THREE.SpotLight(0xffe0b8, 70, 0, 0.6, 0.7, 2); bench.position.set(BENCH.x + 0.3, 2.4, BENCH.z); bench.target.position.copy(BENCH); s.add(bench, bench.target);
    s.add(new THREE.HemisphereLight(0x7a6a60, 0x1a120c, 0.6));
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
      const old = this.scene.environment;
      this.scene.environment = pm.fromCubemap(rt.texture).texture; this.scene.environmentIntensity = 0.8;
      pm.dispose(); rt.dispose(); old?.dispose();
    } catch (e) { console.warn('garage env capture', e); }
  }

  /** Compile every truck / weapon / crew program in this scene against the MSAA half-float target: no hitch on first preview. */
  async _warm() {
    const g = new THREE.Group(); g.position.set(0, -400, 0);
    const warmMaterials = this._warmMaterials ??= new Set();
    const seen = new Set(); g.userData.warmVehicleViews = [];
    for (const id of TRUCK_IDS) {
      const spec = VEHICLES[id], url = vehicleModelURL(spec);
      if (seen.has(url)) continue; seen.add(url);
      const v = new CarView(spec, { paint: 0x777777, paint2: 0x30302e, lod: false, upgradeLevels: DRIVER_UPGRADE_MAX, warmMaterials });
      g.add(v.root); g.userData.warmVehicleViews.push(v);
    }
    g.userData.warmWeaponViews = [];
    for (const w of WEAPON_IDS) { const v = w === 'minigun' ? new MountedGun(w) : new WeaponView(w); g.add(v.root); g.userData.warmWeaponViews.push(v); }
    for (const w of REFLEX_GUNS) { const v = new WeaponView(w, { opticId: 'wide_reflex' }); g.add(v.root); g.userData.warmWeaponViews.push(v); }
    g.userData.warmCrewViews = [new CrewView('hero_gunner', { role: 'gunner', weapon: 'rifle' }), new CrewView('hero_driver', { role: 'driver' })];
    for (const crew of g.userData.warmCrewViews) g.add(crew.root);
    this.scene.add(g);
    await warmScene(this.renderer, this.scene, this.camera, this.post);
    return g;
  }

  /** Graphics quality 0..3 (settings): LOW/MEDIUM drop MSAA, the floor reflection and bloom radius; HIGH/ULTRA get everything. */
  setQuality(q = 2) {
    if (q === this.quality) return;
    this.quality = q;
    const rt = this.post.rt, want = q >= 2 ? 4 : 0;
    if (rt.samples !== want) { rt.samples = want; rt.dispose(); }
    this.reflOn = q >= 1; this.refl.strength.value = this.reflOn ? 1 : 0;
    this.post.bloom.radius = q >= 2 ? 0.55 : 0.4;
  }

  // ------------------------------------------------------------------------------------------------ stages
  /** 'garage' | 'title'. Cross-fades through black. */
  setStage(stage) {
    void this.ready;
    if (stage === 'title') this._initTitle();
    if (stage === this.stage && !this.pendingStage) return;
    if (this.fade > 0.99 && !this.pendingStage) { this._enterStage(stage); return; }
    this.pendingStage = stage; this.fadeTo = 1;
  }
  /** The title chase is built (and its props start streaming) as early as possible: the first thing a player sees. */
  _initTitle() {
    if (this.title) return;
    this.title = new TitleScene(this.renderer);
    this.titleReady = this.title.load().then(() => { this.title.setHero(this.base.truck, this.base.paint, this.base.weapon, this.base); return this.title.warm(this.post); });
  }
  _enterStage(stage) {
    this.stage = stage; this.pendingStage = null;
    if (stage === 'title') {
      this.title.setHero(this.base.truck, this.base.paint, this.base.weapon, this.base);
      this.post.setLook({ exposure: 1.0, vignette: 0.7, grain: 0.03, bloom: { strength: 0.48, radius: 0.55, threshold: 1.0 } });
      // hold black until the chase is loaded + compiled
      this.fade = 1; this.fadeTo = 1;
      this.titleReady.then(() => { if (this.stage === 'title') this.fadeTo = 0; });
    } else {
      this.post.setLook({ exposure: 0.8, vignette: 0.6, grain: 0.03, bloom: { strength: 0.38, radius: 0.5, threshold: 1.25 } });
      this.fadeTo = 0;
      this._snapCamera();
    }
  }
  /** A run is starting: free the big menu render targets (re-allocated on the next menu frame; programs stay compiled). */
  release() { this.post.rt.dispose(); this.refl.rt.dispose(); this.refl.size.set(0, 0); }
  /** Fade in from black (entering the garage after a run). */
  fadeIn() { this.fade = 1; this.fadeTo = 0; }

  // ------------------------------------------------------------------------------------------------ garage content
  /** Show the player's chassis and owned {weapon, opticId, upgradeLevels}. */
  setTruck(id, paint, loadout) {
    const weapon = loadout?.weapon || 'pistol';
    this.base = { truck: id, paint, weapon, opticId: sanitizeOpticId(weapon, loadout?.opticId), upgradeLevels: sanitizeVisualLevels(loadout?.upgradeLevels) };
    this._apply();
  }
  /** Shop previews: {truck?, paint?, weapon?, opticId?, upgradeLevels?}. */
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
      this.sparks.emit(at, _v2, { size: 0.12 + Math.random() * 0.1, grow: 0.2, life: 0.5 + Math.random() * 0.6, alpha: 1, drag: 0.6, rise: -9, spin: 0, frameRow: 0 });
    }
  }

  _apply() {
    const truck = this.preview.truck || this.base.truck;
    const weapon = this.preview.weapon || this.base.weapon;
    const want = { truck, paint: this.preview.paint ?? this.base.paint, weapon, opticId: sanitizeOpticId(weapon, this.preview.opticId ?? (weapon === this.base.weapon ? this.base.opticId : 'standard')),
      upgradeLevels: sanitizeVisualLevels(this.preview.upgradeLevels ?? (truck === this.base.truck ? this.base.upgradeLevels : {})) };
    const truckKey = `${want.truck}`, crewKey = `${want.truck}:${weaponOpticKey(this.base.weapon, this.base.opticId)}`;
    let fitChanged = false;
    if (truckKey !== this.truckKey) { this._buildTruck(want.truck); this.truckKey = truckKey; this.crewKey = null; this.drop = 1; fitChanged = true; }
    const appearanceKey = visualKey(want.upgradeLevels);
    if (appearanceKey !== this.appearanceKey) {
      this.view?.setUpgradeLevels(want.upgradeLevels); this.appearanceKey = appearanceKey;
      this.view?.root.traverse(o => o.layers.enable(REFL));
      fitChanged = true;
    }
    if (crewKey !== this.crewKey) { this._buildCrew(this.base.weapon, this.base.opticId); this.crewKey = crewKey; fitChanged = true; }
    if (want.paint !== this.paint) { this.paint = want.paint; this.view?.setTint(want.paint, 0x30302e); }
    if (weaponOpticKey(want.weapon, want.opticId) !== this.benchId) { this._buildBench(want.weapon, want.opticId); }
    if (fitChanged) this.hummerEnvelope = this.spec?.id === HUMMER_GARAGE_ID ? new HummerGarageEnvelope(this.view, this.crew, this.turntable) : this.spec?.id === TANK_GARAGE_ID ? new TankGarageEnvelope(this.view, this.crew, this.turntable) : null;
    if (this.title && this.stage === 'title') this.title.setHero(this.base.truck, this.base.paint, this.base.weapon, this.base);
  }
  _buildTruck(id) {
    if (this.view) { this.view.dispose(); this.view = null; }
    for (const c of this.crew) c.dispose(); this.crew = [];
    const spec = VEHICLES[id] || VEHICLES.player_sedan_t1;
    this.spec = spec;
    this.view = new CarView(spec, { paint: this.paint ?? 0x8f6a3d, paint2: 0x30302e, lod: false });
    this.state = makeCarState(0, spec.id, 'player');
    this.state.pos.set(0, this.state.ride.restComHeight, 0);
    for (let i = 0; i < this.state.L.length; i++) this.state.L[i] = this.state.ride.restLen;
    this.view.update(this.state, 0);
    this.view.setLights?.(false, 0);
    for (const m of this.view.headlights || []) m.emissiveIntensity = 0.7;
    for (const m of this.view.taillights || []) m.emissiveIntensity = 0.5;
    this.turntable.add(this.view.root);
    this.view.root.traverse((o) => o.layers.enable(REFL));
    this.paint = null; // re-tint below
    this.appearanceKey = null;
  }
  _buildCrew(weapon, opticId = 'standard') {
    for (const c of this.crew) c.dispose(); this.crew = []; this.gunnerCrew = null;
    const spec = this.spec; if (!spec || !this.view) return;
    if (spec.seats.gunner) { const g = new CrewView('hero_gunner', { role: 'gunner', weapon: weapon || 'pistol', opticId }); this.view.root.add(g.root); g.attach(this.view, spec.seats.gunner); this.crew.push(g); this.gunnerCrew = g; }
    if (spec.seats.driver) { const d = new CrewView('hero_driver', { role: 'driver' }); this.view.root.add(d.root); d.attach(this.view, spec.seats.driver); this.crew.push(d); }
    for (const c of this.crew) {
      c.root.traverse((o) => o.layers.enable(REFL));
      c.weapon?.root.traverse((o) => o.layers.enable(REFL));
    }
  }
  _buildBench(id, opticId = 'standard') {
    if (this.benchWeapon) {
      const old = this.benchWeapon; old.root.removeFromParent(); old.view.root.removeFromParent(); old.view.dispose?.();
      old.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      this.benchWeapon = null;
    }
    this.benchId = weaponOpticKey(id, opticId);
    // Handheld previews use the hanging bench lamp's original table target.
    this.benchLight?.target.position.copy(BENCH);
    if (!id) return;
    const w = id === 'minigun' ? new MountedGun(id) : new WeaponView(id, { opticId });
    // Centre the model, with its muzzle toward -z. A mounted gun keeps its
    // full-height upright pedestal rather than occupying the table lamp.
    const holder = new THREE.Group(); holder.add(w.root);
    w.root.rotation.set(0, Math.PI, 0);
    const box = new THREE.Box3().setFromObject(w.root), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    w.root.position.sub(ctr);
    holder.userData.size = Math.max(size.x, size.y, size.z);
    // small rotating display plinth under the gun
    const L = Math.max(size.x, size.z);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(L * 0.52, L * 0.55, 0.04, 48), this._plinthMat || (this._plinthMat = new THREE.MeshStandardMaterial({ color: 0x18171a, metalness: 0.7, roughness: 0.35 })));
    plinth.position.y = -size.y / 2 - (w.mounted ? .02 : .045); plinth.receiveShadow = true; holder.add(plinth);
    const pr = new THREE.Mesh(new THREE.TorusGeometry(L * 0.535, 0.006, 6, 96).rotateX(Math.PI / 2), this.ringMat); pr.position.y = -size.y / 2 - (w.mounted ? .002 : .024); holder.add(pr);
    if (w.mounted) {
      // The 1.53m rig on the 1.02m bench intersects the hanging lamp at 2.42m.
      // Stage it on a floor plinth beside the table instead. The plinth bottom
      // is on y=0; the original fixture, intensity and gun materials stay intact.
      holder.position.set(BENCH.x + 1.45, size.y / 2 + 0.04, BENCH.z);
      // Enclose the full world-axis box through any display rotation. Its
      // floor corners combine both horizontal extents even where the round
      // plinth has no vertices; keep that conservative envelope inside the UI.
      const horizontal = Math.max(L * 0.55, Math.hypot(size.x, size.z) / 2);
      holder.userData.framingRadius = Math.hypot(size.y / 2 + 0.04, Math.SQRT2 * horizontal) + 0.025;
      this.benchLight?.target.position.copy(holder.position);
    } else holder.position.copy(BENCH).add(_v.set(0, size.y / 2 + 0.07, 0));
    holder.userData.base = holder.position.clone();
    this.scene.add(holder);
    // WeaponView owns its one-body caster policy. Optic lenses and reticle
    // planes must keep their non-casting flags in the bench preview too.
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
    const f = this.fade * this.fade * (3 - 2 * this.fade);
    this.post.mat.uniforms.uFade.value = this.stage === 'title' && this.title ? Math.max(f, this.title.cutFade || 0) : f;
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
      r.rotation.y = this.benchWeapon.view.mounted ? this.turn : Math.sin(this.t * 0.35) * 0.35 + 0.2;
      r.position.copy(r.userData.base); r.position.y += Math.sin(this.benchDrop * Math.PI) * 0.12;
    }
    // ring pulse after purchases
    this.ringPulse = Math.max(0, (this.ringPulse || 0) - dt * 1.4);
    this.ringMat.emissiveIntensity = 2.2 + Math.sin(this.t * 2) * 0.3 + this.ringPulse * 14;
    // set animation
    this.set.motes.mat.uniforms.uTime.value = this.t;
    this.set.motes.mat.uniforms.uPx.value = this.renderer.getPixelRatio() * innerHeight / 1080 * 2.2;
    this.set.rayMat.opacity = 0.75 + Math.sin(this.t * 0.6) * 0.1;
    this.sparks.update(dt);
    this._cameraRig(dt, v);
  }

  _subject(v, out) {
    const spec = this.spec || VEHICLES.truck_t1;
    if (v.subject === 'bench' && this.benchWeapon) { out.copy(this.benchWeapon.root.userData.base); return Math.max(0.45, this.benchWeapon.root.userData.framingRadius ?? this.benchWeapon.root.userData.size * 0.62); }
    if (v.subject === 'gunner' && this.gunnerCrew) { this.gunnerCrew.root.getWorldPosition(out); out.y += 1.05; return 1.25; }
    if (v.subject === 'truck' && [HUMMER_GARAGE_ID, TANK_GARAGE_ID].includes(this.spec?.id) && this.hummerEnvelope) {
      this.hummerEnvelope.update().worldCenter(out);
      out.y += v.y || 0;
      return this.hummerEnvelope.radius + Math.abs(v.y || 0);
    }
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
    // For the mounted support envelope, allow for its nearer corners rather
    // than fitting radius only at the subject's center-depth plane.
    const mountedBench = v.subject === 'bench' && this.benchWeapon?.view.mounted;
    g.dist = (mountedBench ? Math.hypot(R, need) : need) * v.fit;
    const hummerTruck = v.subject === 'truck' && [HUMMER_GARAGE_ID, TANK_GARAGE_ID].includes(this.spec?.id) && this.hummerEnvelope;
    if (hummerTruck) g.dist = hummerGarageFitDistance(R, c.fov, W, H, fr);
    // smooth (critically damped-ish); a fast cut when snapping
    const k = damp(this.snap ? 60 : 3.0, dt); this.snap = false;
    c.tx += (g.tx - c.tx) * k; c.ty += (g.ty - c.ty) * k; c.tz += (g.tz - c.tz) * k;
    c.az += wrapPi(g.az - c.az) * k; c.el += (g.el - c.el) * k; c.dist += (g.dist - c.dist) * k; c.fov += (g.fov - c.fov) * k;
    if (hummerTruck) {
      // Retain target/azimuth easing, but enlarged kit cannot wait behind UI.
      // Enclose target smoothing displacement around the actual subject too.
      const offset = Math.hypot(c.tx - g.tx, c.ty - g.ty, c.tz - g.tz);
      c.dist = Math.max(c.dist, hummerGarageFitDistance(R + offset, c.fov, W, H, fr));
    }
    // gentle breathing
    const az = c.az + Math.sin(this.t * 0.13) * 0.025, el = c.el + Math.sin(this.t * 0.21) * 0.01;
    cam.position.set(c.tx + Math.sin(az) * Math.cos(el) * c.dist, c.ty + Math.sin(el) * c.dist, c.tz + Math.cos(az) * Math.cos(el) * c.dist);
    cam.position.y = Math.max(0.35, cam.position.y);
    cam.lookAt(c.tx, c.ty, c.tz);
    if (Math.abs(cam.fov - c.fov) > 1e-3 || hummerTruck) cam.fov = c.fov;
    // centre of projection = centre of the free rect
    const cx = (fr.l + fr.r) / 2, cy = (fr.t + fr.b) / 2;
    cam.setViewOffset(W, H, -(cx - W / 2), -(cy - H / 2), W, H);
  }
  _snapCamera() { this.snap = true; }
  /** Mouse drag on the 3D view: spin the turntable. */
  drag(dx) { this.dragVel = (this.dragVel || 0) + dx * 0.02; }

  render() {
    // dev: window.__menuProfile = true -> GPU ms per pass in window.__menuGpu
    const T = window.__menuProfile ? (this._gpu || (this._gpu = new GpuTimer(this.renderer))) : null;
    if (T) { T.poll(); window.__menuGpu = Object.fromEntries([...T.ms].map(([k, v]) => [k, +v.toFixed(2)])); }
    if (this.stage === 'title') {
      T?.begin('title');
      if (this.title?.ready && this.title.hero) this.post.render(this.title.scene, this.title.camera, this.dt);
      else this.post.render(this.scene, this.camera, this.dt);
      T?.end();
      return;
    }
    T?.begin('refl'); if (this.reflOn !== false) this.refl.update(this.renderer, this.scene, this.camera); T?.end();
    T?.begin('garage'); this.post.render(this.scene, this.camera, this.dt); T?.end();
  }
}

// ------------------------------------------------------------------------------------------------ planar floor reflection
class FloorReflection {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.cam = new THREE.PerspectiveCamera(); this.cam.layers.set(REFL);
    this.texMatrix = new THREE.Matrix4();
    this.strength = { value: 1 };
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
    // reuse last frame's shadow maps (three re-renders every shadow map on every render() call otherwise)
    const prev = renderer.getRenderTarget(), au = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt); renderer.clear();
    renderer.render(scene, rc);
    renderer.setRenderTarget(prev);
    renderer.shadowMap.autoUpdate = au;
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
    sh.uniforms.uReflK = refl.strength;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 uReflMat; varying vec4 vReflUv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvReflUv = uReflMat * (modelMatrix * vec4(transformed, 1.0));');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uRefl; uniform float uReflK; varying vec4 vReflUv;')
      .replace('#include <opaque_fragment>', `
      {
        vec2 ruv = vReflUv.xy / vReflUv.w + normal.xz * 0.012;
        float rough = clamp(roughnessFactor, 0.0, 1.0);
        vec3 rc = textureLod(uRefl, ruv, 1.0 + rough * 3.5).rgb;
        vec3 vdir = normalize(vViewPosition);
        float fres = 0.18 + 0.82 * pow(1.0 - abs(dot(normal, -vdir)), 4.0);
        float k = (1.0 - smoothstep(0.35, 0.95, rough)) * 0.4 * fres * uReflK;
        outgoingLight = outgoingLight * (1.0 - k * 0.35) + rc * k;
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'garageFloorRefl';
  return m;
}

/** Turntable top: dark steel with concentric machining rings, a darker inner disc and radial seams (no moire at a distance). */
function discTex(rough = false) {
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), m = n / 2;
  g.fillStyle = rough ? '#8a8a8a' : '#6a655e'; g.fillRect(0, 0, n, n);
  for (let r = 4; r < m; r += 3) {
    const v = Math.random() < 0.5 ? 40 : 170;
    g.strokeStyle = rough ? `rgba(${v},${v},${v},0.25)` : `rgba(${v},${v * 0.94},${v * 0.88},0.16)`;
    g.lineWidth = 1.2; g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.stroke();
  }
  g.fillStyle = rough ? 'rgba(200,200,200,0.5)' : 'rgba(20,18,16,0.55)'; g.beginPath(); g.arc(m, m, m * 0.36, 0, Math.PI * 2); g.fill();
  g.strokeStyle = rough ? 'rgba(255,255,255,0.6)' : 'rgba(10,9,8,0.8)'; g.lineWidth = 3;
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.beginPath(); g.moveTo(m + Math.cos(a) * m * 0.37, m + Math.sin(a) * m * 0.37); g.lineTo(m + Math.cos(a) * m * 0.99, m + Math.sin(a) * m * 0.99); g.stroke(); }
  g.beginPath(); g.arc(m, m, m * 0.37, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = rough ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
