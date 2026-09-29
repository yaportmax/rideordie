// Detached car parts (hoods, doors, bumpers, wheels): cheap ballistic bodies with ground bounce, spin and fade-out.
import * as THREE from 'three';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
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
    const box = new THREE.Box3().setFromObject(node); const r = Math.max(0.12, Math.min(0.6, box.getSize(_s).length() * 0.15));
    this.items.push({ node, vel: vel.clone(), spin: spin.clone(), life, age: 0, r, rest: false });
    if (this.items.length > this.max) { const o = this.items.shift(); o.node.removeFromParent(); }
    return node;
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i]; d.age += dt;
      if (d.age > d.life) { d.node.removeFromParent(); this.items.splice(i, 1); continue; }
      const n = d.node;
      if (!d.rest) {
        d.vel.y -= G * dt;
        n.position.addScaledVector(d.vel, dt);
        _q.setFromEuler(new THREE.Euler(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt)); n.quaternion.premultiply(_q);
        const gy = this.groundY(n.position.x, n.position.y, n.position.z);
        if (gy !== null && n.position.y - d.r < gy) {
          n.position.y = gy + d.r;
          if (d.vel.y < -1.2) { d.vel.y *= -0.32; d.vel.x *= 0.78; d.vel.z *= 0.78; d.spin.multiplyScalar(0.7); }
          else { d.vel.y = 0; d.vel.x *= 0.9; d.vel.z *= 0.9; d.spin.multiplyScalar(0.85); if (d.vel.lengthSq() < 0.25) d.rest = true; }
        }
      }
      const fade = d.life - d.age;
      if (fade < 1) n.scale.setScalar(Math.max(0.01, fade));
    }
  }
  clear() { for (const d of this.items) d.node.removeFromParent(); this.items.length = 0; }
}
