// A firearm model with procedural mechanics: slide/bolt cycling on each shot, pump/bolt actions, magazine drop + insert on reload,
// trigger pull, hammer, RPG rocket reload, LMG belt. Data from public/models/weapons/README.md (pivots + travels).
// Third person drives the reload from `reload01`; the first-person viewmodel drives every part itself (`s.parts`, see update()).
import * as THREE from 'three';
import * as Assets from '../core/assets.js';
import { sightBoreGeometry, supportsSightBoreGeometry } from './sight_geometry.js';
import { REFLEX_GUNS, sanitizeOpticId } from '../data/weapon_optics.js';
import { attachReflexOptic } from './reflex_optic.js';
import { configureFactorySights } from './factory_sights.js';
import { attachCombatScope } from './combat_scope.js';
import { attachWeaponModifications } from './weapon_attachments.js';

const MM = 0.001, DEG = Math.PI / 180;
const bore = (part, centerX, centerY, radius, minZ, maxZ) => ({ part, centerX, centerY, radius, minZ, maxZ });
const cap = (part, centerX, centerY, radius, z) => bore(part, centerX, centerY, radius, z - 0.00002, z + 0.00002);
/** Shipped optic caps in weapon-root metres. Open only their optical bore in the local ADS copy. */
export const SIGHT_BORES = {
  smg: [
    // The authored 1.5 mm diopter hole is too small at the game's eye relief.
    // Open the complete rear plate bore, leaving its outer housing intact.
    bore('body', 0, .107, .005, -.06802, -.05198),
    cap('body', 0, .104, .0085, .286), cap('body', 0, .104, .0085, .300),
  ],
  rifle: [bore('optic', 0, .1585, .010, -.07102, -.01248)],
  // A ghost ring needs a useful window, including the inner walls between caps.
  lmg: [bore('feed_cover', 0, .146, .0045, -.01202, -.00898)],
  shotgun: [bore('body', 0, .09, .0045, .00648, .00952)],
  sniper: [
    cap('scope', 0, .124, .014, -.125), cap('scope', 0, .124, .014, .250),
    ...[-.049, -.031, .111, .129, .1592, .1607].map(z => cap('scope', 0, .124, .014, z)),
    bore('scope', 0, .124, .014, -.00502, .04502),
    bore('body', 0, .124, .018, -.315, -.1251),
  ],
  rpg: [bore('body', .064, .106, .012, -.12802, .10902)],
};
// part -> {t:'tr'|'rot', axis:[x,y,z], amount (m or rad)}
export const MECH = {
  pistol: { cycle: { slide: ['tr', [0, 0, -1], 38 * MM] }, trigger: 12, mag: ['tr', [0, -0.94, -0.342], 135 * MM], rack: { slide: ['tr', [0, 0, -1], 38 * MM] } },
  revolver: { cycle: { hammer: ['rot', [1, 0, 0], -55 * DEG] }, trigger: 20, spin: { cylinder: 60 * DEG }, crane: ['rot', [0, 0, 1], -70 * DEG] },
  smg: { cycle: { bolt: ['tr', [0, 0, -1], 52 * MM], charging_handle: ['tr', [0, 0, -1], 52 * MM] }, trigger: 12, mag: ['tr', [0, -1, 0], 190 * MM], rack: { bolt: ['tr', [0, 0, -1], 52 * MM], charging_handle: ['tr', [0, 0, -1], 52 * MM] } },
  shotgun: { pump: { pump: ['tr', [0, 0, -1], 62 * MM], bolt: ['tr', [0, 0, -1], 72 * MM] }, trigger: 14 },
  rifle: { cycle: { bolt: ['tr', [0, 0, -1], 95 * MM], charging_handle: ['tr', [0, 0, -1], 95 * MM] }, trigger: 12, mag: ['tr', [0, -0.995, 0.104], 260 * MM], rack: { bolt: ['tr', [0, 0, -1], 95 * MM], charging_handle: ['tr', [0, 0, -1], 95 * MM] } },
  lmg: { cycle: { bolt: ['tr', [0, 0, 1], 90 * MM] }, trigger: 14, mag: ['tr', [0.447, -0.894, 0], 120 * MM], cover: ['rot', [1, 0, 0], -72 * DEG], belt: 14 * MM, rack: { charging_handle: ['tr', [0, 0, -1], 90 * MM] } },
  sniper: { bolt: { bolt_handle: ['rot', [0, 0, 1], -90 * DEG], bolt: ['tr', [0, 0, -1], 105 * MM] }, trigger: 12, mag: ['tr', [0, -1, 0], 130 * MM] },
  rpg: { trigger: 12, cycle: { hammer: ['rot', [1, 0, 0], 35 * DEG] }, rocket: ['tr', [0, 0, 1], 420 * MM] },
};

/** Keep a readable firearm shadow with one caster, instead of drawing every mechanism. */
export function configureWeaponShadows(root) {
  let big = null, bigN = 0, bodyFound = false;
  root.traverse((o) => {
    if (!o.isMesh) return;
    let body = /^(mesh_body|body)(_|$)/.test(o.name);
    for (let p = o.parent; p && p !== root; p = p.parent) if (p.name === 'body') { body = true; break; }
    const n = o.geometry.attributes.position?.count || 0;
    if ((body && !bodyFound) || (body === bodyFound && n > bigN)) { big = o; bigN = n; bodyFound = body; }
  });
  root.traverse((o) => { if (o.isMesh) { o.castShadow = o === big; o.receiveShadow = false; } });
  return big;
}

export class WeaponView {
  /** Temporary boot group uploads each mounted variant; its material owner keeps warmed shader references alive. */
  static warmReflexObjects(registerCleanup, retainMaterials) {
    const group = new THREE.Group(); group.name = 'warm_reflex_optics';
    for (const id of REFLEX_GUNS) {
      const weapon = new WeaponView(id, { opticId: 'wide_reflex' }); group.add(weapon.root);
      registerCleanup?.(() => weapon.dispose(retainMaterials));
    }
    // World optics and VM optics compile different projection programs. Warm
    // the two supported world scope mounts as a finite pair, not all loadouts.
    for (const id of ['rifle', 'sniper']) {
      const weapon = new WeaponView(id, { opticId: 'combat_3x' }); group.add(weapon.root);
      registerCleanup?.(() => weapon.dispose(retainMaterials));
    }
    return group;
  }

  constructor(id, opts = {}) {
    this.id = id;
    this.opticId = sanitizeOpticId(id, opts.opticId);
    this._ownedResources = [];
    this.root = new THREE.Group(); this.root.name = 'weapon_' + id;
    const m = opts.model || Assets.clone(`/models/weapons/${id}.glb`);
    this.model = m;
    this.nodes = {}; this.rest = {}; this.sockets = {};
    if (m) {
      this.root.add(m);
      configureWeaponShadows(m);
      m.traverse((o) => {
        if (o.name) { this.nodes[o.name] = o; this.rest[o.name] = { p: o.position.clone(), q: o.quaternion.clone() }; }
        if (/^(muzzle|eject|grip_R|grip_L|mag_well|sight|stock|rocket_tip)$/.test(o.name)) this.sockets[o.name] = o;
      });
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.7 }));
      this._ownedResources.push(box.geometry, box.material);
      box.castShadow = true;
      box.position.z = 0.25; this.root.add(box);
      const mz = new THREE.Object3D(); mz.name = 'muzzle'; mz.position.set(0, 0.03, 0.56); this.root.add(mz); this.sockets.muzzle = mz;
    }
    this.factorySight = configureFactorySights(this);
    if (this.factorySight) this.sockets.factory_sight = this.factorySight.aim;
    this.optic = this.opticId === 'wide_reflex' ? attachReflexOptic(this) : this.opticId === 'combat_3x' ? attachCombatScope(this) : null;
    if (this.optic) { this.sockets.optic_sight = this.optic.aim; configureWeaponShadows(this.root); }
    this.modifications = attachWeaponModifications(this, opts.levels, opts.attachments); this.mech = MECH[id] || {};
    this.cycleT = 1; this.cycleLen = 0.08; this.actionT = 1; this.actionLen = 0.5; this.trig = 0; this.spin = 0; this.reload = 0; this.reloading = false;
  }

  /** Call on every shot. */
  fire(rateHz = 8) { this.cycleT = 0; this.cycleLen = Math.min(0.09, 0.8 / rateHz); if (this.mech.spin) this.spin += this.mech.spin.cylinder; this.beltStep = (this.beltStep || 0) + 1; }
  /** Pump / bolt manual action after the shot. */
  action(len) { this.actionT = 0; this.actionLen = len; }

  _apply(name, spec, k) {
    const n = this.nodes[name], r = this.rest[name]; if (!n || !r) return;
    const [t, ax, amt] = spec;
    if (t === 'tr') n.position.set(r.p.x + ax[0] * amt * k, r.p.y + ax[1] * amt * k, r.p.z + ax[2] * amt * k);
    else { _ax.set(ax[0], ax[1], ax[2]); n.quaternion.copy(r.q).multiply(_q.setFromAxisAngle(_ax, amt * k)); }
  }

  /**
   * @param s {trigger:bool, reloading:bool, reload01:0..1 (progress), empty:bool,
   *           parts?: {mag, magVisible, rack, cover, crane, rocket, rocketVisible, pump, bolt}}  (viewmodel: every part driven explicitly)
   */
  update(dt, s = {}) {
    const M = this.mech, P = s.parts;
    // slide / bolt cycling: fast back, slightly slower forward
    this.cycleT = Math.min(1, this.cycleT + dt / this.cycleLen);
    const c = this.cycleT < 0.35 ? this.cycleT / 0.35 : 1 - (this.cycleT - 0.35) / 0.65;
    if (M.cycle) for (const [n, sp] of Object.entries(M.cycle)) this._apply(n, sp, Math.max(0, c));
    // manual actions (pump / bolt): back then forward
    this.actionT = Math.min(1, this.actionT + dt / Math.max(0.1, this.actionLen));
    const a = this.actionT < 0.15 ? 0 : this.actionT < 0.55 ? (this.actionT - 0.15) / 0.4 : Math.max(0, 1 - (this.actionT - 0.55) / 0.35);
    const pumpK = P && P.pump !== undefined ? P.pump : a;
    if (M.pump) { this._apply('pump', M.pump.pump, pumpK); this._apply('bolt', M.pump.bolt, Math.min(1, Math.max(0, pumpK * 1.1 - 0.05))); }
    if (M.bolt) {
      if (P && P.bolt !== undefined) {
        // viewmodel bolt: 0..1 lift, 1..2 back, 2..3 forward, 3..4 down (one continuous 0..4 parameter)
        const b = P.bolt, lift = b <= 0 ? 0 : b < 1 ? b : b < 3 ? 1 : Math.max(0, 4 - b), back = b <= 1 ? 0 : b < 2 ? b - 1 : b < 3 ? 3 - b : 0;
        this._apply('bolt_handle', M.bolt.bolt_handle, lift); this._apply('bolt', M.bolt.bolt, back);
      } else {
        // lift handle, pull back, push forward, lower handle
        const lift = this.actionT < 0.15 ? this.actionT / 0.15 : this.actionT > 0.85 ? (1 - this.actionT) / 0.15 : 1;
        this._apply('bolt_handle', M.bolt.bolt_handle, this.actionT >= 1 ? 0 : lift);
        this._apply('bolt', M.bolt.bolt, a);
      }
    }
    this.trig += ((s.trigger ? 1 : 0) - this.trig) * Math.min(1, dt * 30);
    if (M.trigger && this.nodes.trigger) this._apply('trigger', ['rot', [1, 0, 0], M.trigger * DEG], this.trig);
    if (M.spin && this.nodes.cylinder) { const n = this.nodes.cylinder, r = this.rest.cylinder; this.spinV = (this.spinV || 0) + (this.spin - (this.spinV || 0)) * Math.min(1, dt * 25); n.quaternion.copy(r.q).multiply(_q.setFromAxisAngle(_ax.set(0, 0, 1), this.spinV)); }
    if (M.belt && this.nodes.belt) { const k = this.cycleT < 1 ? Math.min(1, this.cycleT * 3) : 0; this._apply('belt', ['tr', [1, 0, 0], M.belt], (1 - k) * 0.6); }
    if (P) { this._manual(P); return; }
    // reload: mag out (0..0.3), gone (0.3..0.6), in (0.6..0.85), rack (0.85..1)
    const r = s.reloading ? (s.reload01 ?? 0) : 0;
    if (M.mag) { const k = r <= 0 ? 0 : r < 0.3 ? r / 0.3 : r < 0.6 ? 1 : r < 0.85 ? 1 - (r - 0.6) / 0.25 : 0; this._apply('mag', M.mag, k * (r > 0.3 && r < 0.6 ? 1.8 : 1)); if (this.nodes.mag) this.nodes.mag.visible = !(r > 0.34 && r < 0.56); }
    if (M.cover && this.nodes.feed_cover) { const k = r <= 0 ? 0 : r < 0.15 ? r / 0.15 : r < 0.8 ? 1 : Math.max(0, 1 - (r - 0.8) / 0.12); this._apply('feed_cover', M.cover, k); }
    if (M.crane && this.nodes.crane) { const k = r <= 0 ? 0 : r < 0.15 ? r / 0.15 : r < 0.85 ? 1 : Math.max(0, 1 - (r - 0.85) / 0.15); this._apply('crane', M.crane, k); }
    if (M.rocket && this.nodes.rocket) { const k = r <= 0 ? 0 : r < 0.4 ? 99 : r < 0.8 ? 1 - (r - 0.4) / 0.4 : 0; this.nodes.rocket.visible = !(k === 99 || s.empty); this._apply('rocket', M.rocket, k === 99 ? 0 : k); }
    if (M.cycle && s.reloading && r > 0.85) for (const [n, sp] of Object.entries(M.cycle)) this._apply(n, sp, Math.sin((r - 0.85) / 0.15 * Math.PI));
  }

  /** Viewmodel: parts set explicitly (travel fractions 0..1; the mag may travel beyond 1 = pulled clear of the well). */
  _manual(P) {
    const M = this.mech, N = this.nodes;
    if (M.mag && N.mag) { this._apply('mag', M.mag, P.mag || 0); N.mag.visible = P.magVisible !== false; }
    if (M.cover && N.feed_cover) this._apply('feed_cover', M.cover, P.cover || 0);
    if (M.crane && N.crane) this._apply('crane', M.crane, P.crane || 0);
    if (M.rocket && N.rocket) { N.rocket.quaternion.copy(this.rest.rocket.q); this._apply('rocket', M.rocket, P.rocket || 0); N.rocket.visible = P.rocketVisible !== false; }   // (the viewmodel may have carried it in the hand)
    if (M.rack) for (const [n, sp] of Object.entries(M.rack)) {
      // Cycle-driven parts already reset above; preserve their firing cycle.
      // A rack-only handle still needs its rest transform after reload ends.
      if ((P.rack || 0) > 0 || !M.cycle?.[n]) this._apply(n, sp, P.rack || 0);
    }
  }

  muzzleWorld(out) { const m = this.sockets.muzzle; if (!m) return false; m.getWorldPosition(out); return true; }
  ejectWorld(out) { const m = this.sockets.eject; if (!m) return false; m.getWorldPosition(out); return true; }
  laserWorld(out) { const emitter = this.sockets.laser_emitter; if (!emitter) return false; emitter.getWorldPosition(out); return true; }
  /** Prepare immutable geometry variants; callers decide when their local ADS copy uses them. */
  prepareSightBores(channels = SIGHT_BORES[this.id]) {
    if (!channels?.length) return [];
    this.root.updateMatrixWorld(true);
    const cuts = [], perMesh = new Map(), toMesh = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const channel of channels) {
      // Load-time batching can bake body/optic meshes directly into the scene.
      // Animated cover/scope pivots stay intact; static cuts use exact root-space
      // bounds rather than relying on an empty authored group retaining meshes.
      const part = /^(body|optic)$/.test(channel.part) ? this.root : this.nodes[channel.part]; if (!part) continue;
      part.traverse(mesh => {
        if (!mesh.isMesh || mesh.isSkinnedMesh || Array.isArray(mesh.material) || /glass|lens/.test(mesh.material.name || '')) return;
        toMesh.copy(mesh.matrixWorld).invert().multiply(this.root.matrixWorld);
        const e = toMesh.elements;
        // Authored firearm parts have an unrotated local +Z bore. Do not carve
        // unrelated or rotated mechanisms using an axis-aligned approximation.
        if (Math.abs(e[1]) + Math.abs(e[2]) + Math.abs(e[4]) + Math.abs(e[6]) + Math.abs(e[8]) + Math.abs(e[9]) > 1e-6
          || Math.abs(Math.abs(e[0]) - Math.abs(e[5])) > 1e-6) return;
        a.set(channel.centerX, channel.centerY, channel.minZ).applyMatrix4(toMesh);
        b.set(channel.centerX, channel.centerY, channel.maxZ).applyMatrix4(toMesh);
        let list = perMesh.get(mesh); if (!list) { list = []; perMesh.set(mesh, list); }
        list.push({ centerX: a.x, centerY: a.y, radius: channel.radius * Math.abs(e[0]), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) });
      });
    }
    for (const [mesh, list] of perMesh) {
      const full = mesh.geometry; if (!supportsSightBoreGeometry(full)) continue;
      const keep = sightBoreGeometry(full, list);
      if (keep !== full) cuts.push({ mesh, full, keep, on: false });
    }
    return cuts;
  }
  dispose(retainMaterials = null) {
    if (this.disposed) return; this.disposed = true;
    this.root.removeFromParent(); this.optic?.dispose(retainMaterials); this.factorySight?.dispose();
    for (const resource of this._ownedResources) resource.dispose(); this._ownedResources.length = 0;
  }
}
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
