// A firearm model with procedural mechanics: slide/bolt cycling on each shot, pump/bolt actions, magazine drop + insert on reload,
// trigger pull, hammer, RPG rocket reload, LMG belt. Data from public/models/weapons/README.md (pivots + travels).
import * as THREE from 'three';
import * as Assets from '../core/assets.js';

const MM = 0.001, DEG = Math.PI / 180;
// part -> {t:'tr'|'rot', axis:[x,y,z], amount (m or rad)}
const MECH = {
  pistol: { cycle: { slide: ['tr', [0, 0, -1], 38 * MM] }, trigger: 12, mag: ['tr', [0, -0.94, -0.342], 135 * MM] },
  revolver: { cycle: { hammer: ['rot', [1, 0, 0], -55 * DEG] }, trigger: 20, spin: { cylinder: 60 * DEG }, crane: ['rot', [0, 0, 1], -70 * DEG] },
  smg: { cycle: { bolt: ['tr', [0, 0, -1], 52 * MM], charging_handle: ['tr', [0, 0, -1], 52 * MM] }, trigger: 12, mag: ['tr', [0, -1, 0], 190 * MM] },
  shotgun: { pump: { pump: ['tr', [0, 0, -1], 62 * MM], bolt: ['tr', [0, 0, -1], 72 * MM] }, trigger: 14 },
  rifle: { cycle: { bolt: ['tr', [0, 0, -1], 95 * MM], charging_handle: ['tr', [0, 0, -1], 95 * MM] }, trigger: 12, mag: ['tr', [0, -0.995, 0.104], 260 * MM] },
  lmg: { cycle: { bolt: ['tr', [0, 0, 1], 90 * MM] }, trigger: 14, mag: ['tr', [0.447, -0.894, 0], 120 * MM], cover: ['rot', [1, 0, 0], -72 * DEG], belt: 14 * MM },
  sniper: { bolt: { bolt_handle: ['rot', [0, 0, 1], -90 * DEG], bolt: ['tr', [0, 0, -1], 105 * MM] }, trigger: 12, mag: ['tr', [0, -1, 0], 130 * MM] },
  rpg: { trigger: 12, cycle: { hammer: ['rot', [1, 0, 0], 35 * DEG] }, rocket: ['tr', [0, 0, 1], 420 * MM] },
};

export class WeaponView {
  constructor(id) {
    this.id = id;
    this.root = new THREE.Group(); this.root.name = 'weapon_' + id;
    const m = Assets.clone(`/models/weapons/${id}.glb`);
    this.model = m;
    this.nodes = {}; this.rest = {}; this.sockets = {};
    if (m) {
      this.root.add(m);
      m.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
        if (o.name) { this.nodes[o.name] = o; this.rest[o.name] = { p: o.position.clone(), q: o.quaternion.clone() }; }
        if (/^(muzzle|eject|grip_R|grip_L|mag_well|sight|stock)$/.test(o.name)) this.sockets[o.name] = o;
      });
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.7 }));
      box.position.z = 0.25; this.root.add(box);
      const mz = new THREE.Object3D(); mz.name = 'muzzle'; mz.position.set(0, 0.03, 0.56); this.root.add(mz); this.sockets.muzzle = mz;
    }
    this.mech = MECH[id] || {};
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
   * @param s {trigger:bool, reloading:bool, reload01:0..1 (progress), mode:'semi'|'auto'|'pump'|'bolt'|'launcher'}
   */
  update(dt, s = {}) {
    const M = this.mech;
    // slide / bolt cycling: fast back, slightly slower forward
    this.cycleT = Math.min(1, this.cycleT + dt / this.cycleLen);
    const c = this.cycleT < 0.35 ? this.cycleT / 0.35 : 1 - (this.cycleT - 0.35) / 0.65;
    if (M.cycle) for (const [n, sp] of Object.entries(M.cycle)) this._apply(n, sp, Math.max(0, c));
    // manual actions (pump / bolt): back then forward
    this.actionT = Math.min(1, this.actionT + dt / Math.max(0.1, this.actionLen));
    const a = this.actionT < 0.15 ? 0 : this.actionT < 0.55 ? (this.actionT - 0.15) / 0.4 : Math.max(0, 1 - (this.actionT - 0.55) / 0.35);
    if (M.pump) for (const [n, sp] of Object.entries(M.pump)) this._apply(n, sp, a);
    if (M.bolt) {
      // lift handle, pull back, push forward, lower handle
      const lift = this.actionT < 0.15 ? this.actionT / 0.15 : this.actionT > 0.85 ? (1 - this.actionT) / 0.15 : 1;
      this._apply('bolt_handle', M.bolt.bolt_handle, this.actionT >= 1 ? 0 : lift);
      this._apply('bolt', M.bolt.bolt, a);
    }
    this.trig += ((s.trigger ? 1 : 0) - this.trig) * Math.min(1, dt * 30);
    if (M.trigger && this.nodes.trigger) this._apply('trigger', ['rot', [1, 0, 0], M.trigger * DEG], this.trig);
    if (M.spin && this.nodes.cylinder) { const n = this.nodes.cylinder, r = this.rest.cylinder; this.spinV = (this.spinV || 0) + (this.spin - (this.spinV || 0)) * Math.min(1, dt * 25); n.quaternion.copy(r.q).multiply(_q.setFromAxisAngle(_ax.set(0, 0, 1), this.spinV)); }
    // reload: mag out (0..0.3), gone (0.3..0.6), in (0.6..0.85), rack (0.85..1)
    const r = s.reloading ? (s.reload01 ?? 0) : 0;
    if (M.mag) { const k = r <= 0 ? 0 : r < 0.3 ? r / 0.3 : r < 0.6 ? 1 : r < 0.85 ? 1 - (r - 0.6) / 0.25 : 0; this._apply('mag', M.mag, k * (r > 0.3 && r < 0.6 ? 1.8 : 1)); if (this.nodes.mag) this.nodes.mag.visible = !(r > 0.34 && r < 0.56); }
    if (M.cover && this.nodes.feed_cover) { const k = r <= 0 ? 0 : r < 0.15 ? r / 0.15 : r < 0.8 ? 1 : Math.max(0, 1 - (r - 0.8) / 0.12); this._apply('feed_cover', M.cover, k); }
    if (M.crane && this.nodes.crane) { const k = r <= 0 ? 0 : r < 0.15 ? r / 0.15 : r < 0.85 ? 1 : Math.max(0, 1 - (r - 0.85) / 0.15); this._apply('crane', M.crane, k); }
    if (M.rocket && this.nodes.rocket) { const k = r <= 0 ? 0 : r < 0.4 ? 99 : r < 0.8 ? 1 - (r - 0.4) / 0.4 : 0; this.nodes.rocket.visible = !(k === 99 || s.empty); this._apply('rocket', M.rocket, k === 99 ? 0 : k); }
    if (M.cycle && s.reloading && r > 0.85) for (const [n, sp] of Object.entries(M.cycle)) this._apply(n, sp, Math.sin((r - 0.85) / 0.15 * Math.PI));
  }

  muzzleWorld(out) { const m = this.sockets.muzzle; if (!m) return false; m.getWorldPosition(out); return true; }
  ejectWorld(out) { const m = this.sockets.eject; if (!m) return false; m.getWorldPosition(out); return true; }
  dispose() { this.root.removeFromParent(); }
}
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
