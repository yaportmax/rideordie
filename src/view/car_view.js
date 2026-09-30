// Renders a vehicle: GLB model (per ASSET_SPEC) or a procedural placeholder; wheels/suspension/steer, lights, paint tint, panels.
import * as THREE from 'three';
import * as Assets from '../core/assets.js';
import { buildCarLod, makeLodMaterial } from './car_lod.js';
import { buildEliteKit, ramBar, makeGlint } from './elite_kits.js';
import { MINIBOSSES } from '../data/boss.js';
import { VEHICLES } from '../data/vehicles.js';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const WHEEL_ORDER = ['FL', 'FR', 'RL', 'RR'];

export class CarView {
  /**
   * @param spec vehicle spec (data/vehicles.js)
   * @param opts {paint:number, paint2:number, modelUrl?:string}
   */
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.root = new THREE.Group(); this.root.name = 'car_' + spec.id;
    this.wheelNodes = new Map();   // wheel name -> Object3D
    this.panels = new Map();
    this.sockets = {};
    this.taillights = []; this.headlights = [];
    this.model = null;
    const url = opts.modelUrl ?? `/models/vehicles/${spec.id}.glb`;
    const model = Assets.clone(url);
    if (model) this._adoptModel(model, opts); else this._placeholder(opts);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // far LOD (enemies): one vertex-coloured body + one mesh per wheel
    this.lod = null; this.lodOn = false;
    if (model && opts.lod !== false) {
      const L = buildCarLod(url, Assets.template(url));
      if (L && L.body) {
        const mat = makeLodMaterial(opts.paint, opts.paint2 ?? 0x30302e);
        const g = new THREE.Group(); g.name = 'lod'; g.visible = false;
        const body = new THREE.Mesh(L.body, mat); body.castShadow = true; body.receiveShadow = true; g.add(body);
        this.lodWheels = [];
        for (const [name, geo] of L.wheels) { const w = new THREE.Mesh(geo, mat); w.castShadow = true; w.rotation.order = 'YXZ'; g.add(w); this.lodWheels.push([name, w]); }
        this.root.add(g); this.lod = g; this.lodMat = mat;
        // shadow proxy (raiders): the merged body casts the car's shadow in ONE draw instead of one per material
        // (the full model stops casting); in the main pass it is a zero-alpha blend (no colour, no depth)
        if (opts.shadowProxy) {
          // (a colorWrite:false material silently stops it casting -- a zero-alpha transparent one works and blends nothing)
          const pm = CarView._proxyMat || (CarView._proxyMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
          const px = new THREE.Mesh(L.body, pm); px.name = 'shadow_proxy'; px.castShadow = true; px.receiveShadow = false; px.frustumCulled = true;
          this.root.add(px); this.shadowProxy = px;
          this.model.traverse((o) => {
            if (!o.isMesh) return;
            let wheel = false; for (let p = o; p && p !== this.model; p = p.parent) if (/^wheel_/.test(p.name)) { wheel = true; break; }
            if (!wheel) o.castShadow = false;           // wheels spin/steer: they keep casting their own shadows
          });
        }
      }
    }
    this.usesModel = !!model;
    this.smoke = 0;
    // the gunless rammer always wears a spiked ram bar: "that one will ram you" reads at a glance
    if (spec.id === 'e_muscle') { const g = new THREE.Group(); g.name = 'ram_bar'; this.root.add(g); ramBar(g, spec, false); }
    this.kit = null; this.glint = null; this.intent = null; this.intentT = 0;
  }

  _adoptModel(model, opts) {
    this.model = model;
    Assets.ownMaterials(model, /^(paint|paint2|light_.*)$/);
    this.root.add(model);
    model.traverse((o) => {
      const n = o.name;
      if (/^wheel_/.test(n)) this.wheelNodes.set(n.slice(6), o);
      else if (/^panel_/.test(n)) this.panels.set(n.slice(6), o);
      else if (/^(seat_|steering_wheel|gun_mount|light_head_|light_tail_|exhaust|smoke_engine|fuel_cap|nitro_|camera_hood|roof_top|turret|rocket_pod|flame_|muzzle|floodlight|smoke_stack)/.test(n)) this.sockets[n] = o;
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.name === 'paint' || m.name === 'paint2') (this.paintMats || (this.paintMats = [])).push(m);
          if (m.name === 'paint' && opts.paint !== undefined) m.color.setHex(opts.paint);
          if (m.name === 'paint2' && opts.paint2 !== undefined) m.color.setHex(opts.paint2);
          if (m.name === 'light_tail') this.taillights.push(m);
          if (m.name === 'light_head') this.headlights.push(m);
          if (m.name === 'glass') { m.transparent = true; m.depthWrite = false; }
        }
      }
    });
    for (const [name, node] of this.wheelNodes) { node.rotation.order = 'YXZ'; node.userData.rest = node.position.clone(); }
  }

  _placeholder(opts) {
    const s = this.spec, g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: opts.paint ?? 0x8a5a3a, roughness: 0.55, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.6 });
    for (const [i, b] of s.colliders.entries()) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.half[0] * 2, b.half[1] * 2, b.half[2] * 2), i === 0 ? paint : glass);
      m.position.set(b.center[0], b.center[1], b.center[2]); g.add(m);
    }
    const tyreGeo = new THREE.CylinderGeometry(s.wheelRadius, s.wheelRadius, 0.3, 20); tyreGeo.rotateZ(Math.PI / 2);
    for (const w of s.wheels) {
      const n = new THREE.Group(); n.rotation.order = 'YXZ';
      const t = new THREE.Mesh(tyreGeo, dark); n.add(t);
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.32, s.wheelRadius * 1.2, 0.06), new THREE.MeshStandardMaterial({ color: 0xcccccc })); n.add(spoke);
      n.position.set(w.x, s.wheelRadius, w.z); n.userData.rest = n.position.clone();
      g.add(n); this.wheelNodes.set(w.name, n);
    }
    // gunner mount marker + driver seat marker
    const sg = s.seats.gunner; if (sg) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), dark); p.position.set(sg[0], sg[1], sg[2]); g.add(p); }
    // nose marker so orientation is unmistakable
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.3), new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0x554400 }));
    nose.position.set(0, 0.6, s.length / 2 - 0.05); g.add(nose);
    this.root.add(g); this.model = g;
  }

  /** Update from a CarState (same path for the local sim and for network snapshots). */
  update(st, dt) {
    const ri = st.ride, spec = st.spec;
    const pos = st.pos, quat = st.quat;
    this.root.position.set(pos.x, pos.y, pos.z).addScaledVector(_up.set(0, -ri.restComHeight, 0).applyQuaternion(quat), 1);
    this.root.quaternion.copy(quat);
    // wheel spin from ground speed along the car's forward axis
    _fw.set(0, 0, 1).applyQuaternion(quat);
    const vf = st.vel.dot(_fw);
    for (let i = 0; i < spec.wheels.length; i++) {
      const w = spec.wheels[i], node = this.wheelNodes.get(w.name);
      if (!node) continue;
      st.spin[i] += (vf / spec.wheelRadius) * dt * (st.braking && st.slip[i] > 0.6 ? 0.2 : 1);
      const steer = w.front ? st.steer : 0;
      node.position.set(w.x, ri.mountY - st.L[i] + ri.restComHeight, w.z);
      node.rotation.set(st.spin[i], steer, 0, 'YXZ');
    }
    this._syncLodWheels();
    if (st.kind === 'enemy') this._raider(st, dt);
    // hit flash: a quick hot glint on the bodywork when rounds land
    const f = Math.max(0, st.hitFlash || 0) / 0.12;
    if (this.paintMats && (f > 0.01 || this._flashOn)) {
      this._flashOn = f > 0.01;
      for (const m of this.paintMats) { m.emissive.setRGB(1, 0.55, 0.25); m.emissiveIntensity = f * 0.9; }
    }
  }

  /** Raider extras: warlord kit + nameplate, the gunner's wind-up glint, intent cues for the lights. */
  _raider(st, dt) {
    if (st.elite && !this.kit && !this._kitTried) { this._kitTried = true; this.kit = buildEliteKit(this, this.spec, st.elite, st.id); }
    if (this.kit) this.kit.update(dt, st);
    this.intent = st.exploded ? null : st.intent; this.intentT += dt;
    // wind-up glint: the gunner has shouldered his gun and is about to fire (hidden once the muzzle flashes take over)
    const seat = this.spec.seats.gunner;
    if (!seat) return;
    const winding = st.gunnerAlive && !st.exploded && st.gunner.ads && !st.gunner.fire;
    if (!this.glint) { if (!winding) return; this.glint = makeGlint(); this.root.add(this.glint); this.glintK = 0; }
    this.glintK = winding ? Math.min(1, this.glintK + dt * 2.2) : Math.max(0, this.glintK - dt * 8);
    const g = this.glint; g.visible = this.glintK > 0.01;
    if (!g.visible) return;
    const cp = Math.cos(st.gunner.pitch);
    _fw.set(Math.sin(st.gunner.yaw) * cp, Math.sin(st.gunner.pitch), Math.cos(st.gunner.yaw) * cp).applyQuaternion(_qi.copy(st.quat).invert());
    g.position.set(seat[0], seat[1] + 1.35, seat[2]).addScaledVector(_fw, 0.95);
    const k = this.glintK, flick = 0.8 + 0.2 * Math.sin(this.intentT * 40);
    g.material.opacity = k * flick; const sc = 0.02 + 0.03 * k; g.scale.set(sc, sc, 1);
  }

  /** Switch between the full model and the far LOD. */
  setLod(far) {
    if (!this.lod || far === this.lodOn) return;
    this.lodOn = far; this.lod.visible = far; if (this.model) { this.model.visible = !far; this.model.matrixWorldAutoUpdate = !far; } // hidden full model: skip its matrix updates
    if (this.shadowProxy) this.shadowProxy.visible = !far; // (the far LOD body casts its own shadow)
    this.lod.matrixWorldAutoUpdate = far;
  }
  _syncLodWheels() {
    if (!this.lodOn || !this.lodWheels) return;
    for (const [name, w] of this.lodWheels) { const n = this.wheelNodes.get(name); if (n) { w.position.copy(n.position); w.quaternion.copy(n.quaternion); w.visible = !n.userData.gone; } }
  }
  setLights(braking, night) {
    // raider tells: a brake-check blazes the brake lights, a rammer flashes his high beams at you
    const block = this.intent === 'block', ram = this.intent === 'ram';
    for (const m of this.taillights) m.emissiveIntensity = block ? 10 : braking ? 5 : (night ? 1.4 : 0.6);
    for (const m of this.headlights) m.emissiveIntensity = ram ? (Math.sin(this.intentT * 26) > 0 ? 9 : 1) : night ? 4 : 1.2;
  }
  setTint(hex, hex2) {
    if (this.lodMat) { this.lodMat.userData.uPaint.value.setHex(hex); if (hex2 !== undefined) this.lodMat.userData.uPaint2.value.setHex(hex2); }
    this.root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) { if (m.name === 'paint') m.color.setHex(hex); if (m.name === 'paint2' && hex2 !== undefined) m.color.setHex(hex2); } });
  }
  dispose() { this.kit?.dispose(); this.glint?.material.dispose(); this.root.removeFromParent(); }
}
const _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _qi = new THREE.Quaternion();

/** Prewarm (Game.prewarm): one car per warlord with its kit, nameplate, flags and a visible wind-up glint, so the first warlord /
 *  raider wind-up compiles no shader programs and uploads no canvas textures mid-run. */
export function warmRaiderViews() {
  const out = [];
  MINIBOSSES.forEach((M, i) => {
    const v = new CarView(VEHICLES[M.spec], { paint: 0x888888, paint2: 0x333333 });
    v.kit = buildEliteKit(v, v.spec, i + 1, i + 1);
    v.glint = makeGlint(); v.glint.visible = true; v.glint.material.opacity = 1; v.root.add(v.glint);
    out.push(v.root);
  });
  return out;
}
