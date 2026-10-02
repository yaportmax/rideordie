// Detached car parts (hoods, doors, bumpers, wheels): cheap ballistic bodies with ground bounce, spin and fade-out.
// Parts blown off by an explosion (fast) smoulder: a smoke trail with licks of fire for their first seconds; every hard
// landing throws sparks (metal on asphalt) and a puff of dust. Effects go through the Fx instance registered in
// DebrisSystem.fx (set by Fx.load), so there is no dependency the other way round.
import * as THREE from 'three';
import { disposeUpgradeNode } from './car_upgrade_kit.js';
import { disposeCarViewNode } from './car_view_resources.js';

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _b = new THREE.Box3();
const G = 17.5;

export class DebrisSystem {
  /** groundY(x, y, z) -> number|null : height of the ground under a point (world raycast). */
  constructor(scene, groundY) { this.scene = scene; this.groundY = groundY; this.items = []; this.max = 48; }

  /** Detach a node from its car and throw it. vel = world velocity (Vector3), spin = angular speed (rad/s Vector3). */
  detach(node, vel, spin, life = 9) {
    if (!node || !node.parent) return null;
    node.updateWorldMatrix(true, false);
    this.scene.attach(node); // keeps the world transform
    node.visible = true;
    _b.setFromObject(node); const r = Math.max(0.12, Math.min(0.6, _b.getSize(_s).length() * 0.15));
    const hot = vel.lengthSq() > 64 ? 2.2 + Math.random() * 1.5 : 0;   // thrown by a blast: it burns for a moment
    this.items.push({ node, vel: vel.clone(), spin: spin.clone(), life, age: 0, r, rest: false, hot, trailT: 0 });
    if (this.items.length > this.max) { const o = this.items.shift(); disposeUpgradeNode(o.node); disposeCarViewNode(o.node); o.node.removeFromParent(); }
    return node;
  }

  update(dt) {
    const fx = DebrisSystem.fx && DebrisSystem.fx.loaded ? DebrisSystem.fx : null;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i]; d.age += dt;
      if (d.age > d.life) { disposeUpgradeNode(d.node); disposeCarViewNode(d.node); d.node.removeFromParent(); this.items.splice(i, 1); continue; }
      const n = d.node;
      if (!d.rest) {
        d.vel.y -= G * dt;
        n.position.addScaledVector(d.vel, dt);
        _q.setFromEuler(_e.set(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt)); n.quaternion.premultiply(_q);
        const gy = this.groundY(n.position.x, n.position.y, n.position.z);
        if (gy !== null && n.position.y - d.r < gy) {
          n.position.y = gy + d.r;
          const imp = -d.vel.y;
          if (d.vel.y < -1.2) {
            if (fx && imp > 4) fx.debrisImpact(n.position.x, gy, n.position.z, imp, d.vel.x, d.vel.z, d.r);
            d.vel.y *= -0.32; d.vel.x *= 0.78; d.vel.z *= 0.78; d.spin.multiplyScalar(0.7);
          }
          else { d.vel.y = 0; d.vel.x *= 0.9; d.vel.z *= 0.9; d.spin.multiplyScalar(0.85); if (d.vel.lengthSq() < 0.25) d.rest = true; }
        }
      }
      if (fx && d.age < d.hot) {
        d.trailT += dt;
        if (d.trailT > 0.045) { d.trailT = 0; fx.debrisSmoulder(n.position.x, n.position.y, n.position.z, 1 - d.age / d.hot, d.r); }
      }
      const fade = d.life - d.age;
      if (fade < 1) n.scale.setScalar(Math.max(0.01, fade));
    }
  }
  clear() { for (const d of this.items) { disposeUpgradeNode(d.node); disposeCarViewNode(d.node); d.node.removeFromParent(); } this.items.length = 0; }
}
DebrisSystem.fx = null;
