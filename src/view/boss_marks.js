// Per-part health markers over the Leviathan: a small label + bar floating over every live core part (guns, cannon, tanks,
// rear armour, reactor). The current phase's targets are bright, the rest dimmed; the reactor only appears once its armour is
// gone (big pulsing red bar). Screen-constant size, drawn over everything. Works on both peers (bossState + per-part hp).
import * as THREE from 'three';
import { BOSS_PARTS, PART_NAMES, bossZones } from '../data/boss.js';

const COLORS = { 1: 0xffa21a, 2: 0xffd23a, 3: 0xff3a1a };
const ARMOR = 0x9ab4ff;
const LABELS = {};
function labelTex(text) {
  if (LABELS[text]) return LABELS[text];
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const x = c.getContext('2d');
  x.font = 'italic 800 30px Bahnschrift, "Arial Narrow", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.strokeText(text, 128, 26); x.fillStyle = '#fff4e0'; x.fillText(text, 128, 26);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (LABELS[text] = t);
}
const spriteMat = (o) => new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false, ...o });

export class BossMarks {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'boss_marks'; this.group.visible = false; scene.add(this.group);
    this.scene = scene; this.t = 0;
    const zones = new Map(bossZones().filter((z) => z.kind !== 'body').map((z) => [z.kind, z]));
    this.marks = [];
    for (const n of PART_NAMES) {
      const def = BOSS_PARTS[n]; if (!def.core && !def.marker) continue;
      const z = zones.get(n); if (!z) continue;
      const big = !!def.weak, w = big ? 0.085 : 0.05, h = big ? 0.009 : 0.0065;
      const col = n.startsWith('panel_armor_rear') ? ARMOR : COLORS[def.phase || 2];
      const g = new THREE.Group();
      const bg = new THREE.Sprite(spriteMat({ color: 0x000000, opacity: 0.6 })); bg.center.set(0.5, 0.5); bg.scale.set(w + 0.003, h + 0.003, 1); bg.renderOrder = 990;
      const fill = new THREE.Sprite(spriteMat({ color: col })); fill.center.set(0, 0.5); fill.scale.set(w, h, 1); fill.position.x = 0; fill.renderOrder = 991;
      const label = new THREE.Sprite(spriteMat({ map: labelTex(def.label || n) })); label.center.set(0.5, 0); label.scale.set(big ? 0.06 : 0.045, big ? 0.0113 : 0.0084, 1); label.renderOrder = 991;
      // the three rear plates sit side by side: one label for the group, bars only on the others
      const dupe = /^panel_armor_rear_[23]$/.test(n);
      g.add(bg, fill); if (!dupe) g.add(label);
      this.group.add(g);
      // lift the marker above the part's box
      this.marks.push({ n, def, g, bg, fill, label, w, h, local: new THREE.Vector3(z.c[0], z.c[1] + z.h[1] + (big ? 1.4 : 0.9), z.c[2]) });
    }
    this._v = new THREE.Vector3(); this._r = new THREE.Vector3();
  }

  /**
   * @param bs bossState (pos, quat, alive, phase, dead) or null
   * @param hpOf (partName) => 0..1
   * @param camera for the screen-space bar offset
   */
  update(dt, bs, hpOf, camera) {
    this.t += dt;
    const on = !!bs && !bs.dead && !bs.exploded;
    this.group.visible = on; if (!on) return;
    const cam = camera;
    for (const m of this.marks) {
      const alive = bs.alive[m.n], locked = (m.def.needs && m.def.needs.some((k) => bs.alive[k])) || (m.def.phase || 1) > (bs.phase || 1);   // sealed until its phase
      const vis = alive && !locked;
      m.g.visible = vis; if (!vis) continue;
      const hp = Math.max(0, Math.min(1, hpOf(m.n)));
      this._v.copy(m.local).applyQuaternion(bs.quat).add(bs.pos);
      m.g.position.copy(this._v);
      // the fill sprite is anchored at its left edge: shift it half a bar to the left in screen space (camera right vector)
      if (cam) {
        const d = cam.position.distanceTo(this._v);
        m.fill.position.copy(this._r.set(1, 0, 0).applyQuaternion(cam.quaternion)).multiplyScalar(-m.w * 0.5 * d);   // bar grows from its left end
        m.label.position.copy(this._r.set(0, 1, 0).applyQuaternion(cam.quaternion)).multiplyScalar(m.h * 0.9 * d);   // label just above the bar
      }
      m.fill.scale.x = Math.max(0.0005, m.w * hp);
      const focus = (m.def.phase || 2) <= bs.phase || m.def.weak;
      const pulse = m.def.weak ? 0.75 + 0.25 * Math.sin(this.t * 8) : 1;
      const a = (focus ? 1 : 0.45) * pulse;
      m.fill.material.opacity = a; m.bg.material.opacity = 0.6 * (focus ? 1 : 0.6); m.label.material.opacity = focus ? 1 : 0.4;
    }
  }

  dispose() { this.scene.remove(this.group); this.group.traverse((o) => { if (o.material) o.material.dispose(); }); }

  /** Prewarm (Game.prewarm): the marker materials/textures. */
  static warmGroup() { const b = new BossMarks(new THREE.Group()); b.group.visible = true; return b.group; }
}
