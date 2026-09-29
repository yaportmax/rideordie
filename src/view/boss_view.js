// Renders THE LEVIATHAN from a boss state {pos, quat, v, alive{part:bool}, dead, exploded, phase}.
import * as THREE from 'three';
import * as Assets from '../core/assets.js';
import { BOSS_WHEELS, PART_NAMES } from '../data/boss.js';

export const BOSS_URL = '/models/vehicles/boss_warrig.glb';

export class BossView {
  constructor(debris) {
    this.debris = debris;
    this.root = Assets.clone(BOSS_URL) || new THREE.Mesh(new THREE.BoxGeometry(8, 7, 36), new THREE.MeshStandardMaterial({ color: 0x553322 }));
    this.root.name = 'boss';
    Assets.ownMaterials(this.root);
    this.parts = new Map(); this.wheels = []; this.sockets = {}; this.charred = false;
    this.root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      if (PART_NAMES.includes(o.name)) this.parts.set(o.name, o);
      else if (/^wheel_/.test(o.name) && BOSS_WHEELS[o.name.slice(6)]) { o.rotation.order = 'YXZ'; this.wheels.push({ node: o, r: BOSS_WHEELS[o.name.slice(6)].r || 1.4 }); }
      if (/^(flame_|muzzle_main|turret_|rocket_pod_|smoke_stack_|exhaust_|ramp_rear|weak_engine|nitro_|light_|floodlight_)/.test(o.name)) this.sockets[o.name] = o;
    });
    this.gone = new Set();
  }

  update(st, dt) {
    this.root.position.copy(st.pos); this.root.quaternion.copy(st.quat);
    for (const w of this.wheels) w.node.rotation.x += (st.v / w.r) * dt;
    for (const [name, node] of this.parts) {
      if (st.alive[name] !== false || this.gone.has(name)) continue;
      this.gone.add(name);
      // armour plates and small parts fly off; big weapons are blown apart (hidden, the fx leaves fire there)
      if (/^panel_|stack|plow|pod/.test(name) && this.debris) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 10, 6 + Math.random() * 6, (Math.random() - 0.5) * 6).add(st.vel || new THREE.Vector3());
        this.debris.detach(node, v, new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6), 12);
      } else node.visible = false;
    }
    if (st.exploded && !this.charred) {
      this.charred = true;
      this.root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) { if (m.color) m.color.multiplyScalar(0.25); if (m.emissive && /light/.test(m.name || '')) m.emissiveIntensity = 0; } });
    }
  }
  dispose() { this.root.removeFromParent(); }
}
