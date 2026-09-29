// Small CPU-simulated instanced meshes: explosion debris chunks, metal plates, shell casings, grenades.
// Fixed pools (no allocation), fake physics (gravity, drag, ground bounce with friction, tumbling), optional car-local frame
// (casings ride the truck bed), shrink-out at end of life.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _ax = new THREE.Vector3(), _g = new THREE.Vector3(), _qi = new THREE.Quaternion(), _mr = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _col = new THREE.Color();

export class MeshPool {
  /**
   * @param opts {cap, gravity, restitution, friction, radius (collision radius as fraction of scale), fadeTime, castShadow}
   * hooks: groundFn(x,z)->y ; onBounce(pool,i,x,y,z,impactSpeed) ; onTrail(pool,i,x,y,z) (called every `trailEvery` seconds if flagged)
   */
  constructor(scene, geometry, material, opts = {}) {
    this.cap = opts.cap ?? 64; const n = this.cap;
    this.mesh = new THREE.InstancedMesh(geometry, material, n);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _col.set(0xffffff)); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.gravity = opts.gravity ?? 9.8; this.rest = opts.restitution ?? 0.38; this.fric = opts.friction ?? 0.55; this.rad = opts.radius ?? 0.5; this.fadeTime = opts.fadeTime ?? 0.5;
    this.drag = opts.drag ?? 0.05;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.q = new Float32Array(n * 4); this.av = new Float32Array(n * 3); this.sc = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.age = new Float32Array(n); this.gy = new Float32Array(n); this.trailT = new Float32Array(n); this.flags = new Uint8Array(n);
    this.frames = new Array(n).fill(null); this.floorY = new Float32Array(n);
    this.head = 0; this.hw = 0; this.alive = 0;
    this.groundFn = null; this.onBounce = null; this.onTrail = null; this.trailEvery = 0.07; this.airDragFrame = 0;
    for (let i = 0; i < n; i++) { this.q[i * 4 + 3] = 1; }
    this.colorsDirty = false;
  }

  /** Spawn an item. `frame` (Object3D) = simulate in that object's local space (floorY = local floor height). Returns slot. */
  spawn(x, y, z, vx, vy, vz, sx, sy, sz, avx, avy, avz, life, hex, trail = false, frame = null, floorY = 0) {
    const i = this.head; this.head = (i + 1) % this.cap; if (i + 1 > this.hw) this.hw = i + 1;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.sc[i * 3] = sx; this.sc[i * 3 + 1] = sy; this.sc[i * 3 + 2] = sz;
    this.av[i * 3] = avx; this.av[i * 3 + 1] = avy; this.av[i * 3 + 2] = avz;
    // random orientation from the angular velocity direction (cheap, deterministic enough)
    _q.set(Math.sin(avx * 1.7 + 0.3), Math.sin(avy * 2.3 + 1.1), Math.sin(avz * 1.3 + 2.1), Math.cos(avx + avy * 0.7 + 0.2)).normalize();
    this.q[i * 4] = _q.x; this.q[i * 4 + 1] = _q.y; this.q[i * 4 + 2] = _q.z; this.q[i * 4 + 3] = _q.w;
    this.life[i] = life; this.age[i] = 0; this.trailT[i] = 0; this.flags[i] = trail ? 1 : 0; this.frames[i] = frame; this.floorY[i] = floorY;
    this.gy[i] = (this.groundFn && !frame) ? this.groundFn(x, z) : y - 1;
    this.mesh.setColorAt(i, _col.setHex(hex)); this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = this.hw;
    return i;
  }

  update(dt) {
    let alive = 0;
    const n = this.hw, g = this.gravity;
    for (let i = 0; i < n; i++) {
      const life = this.life[i];
      let age = this.age[i];
      if (age >= life) { if (age < life + 1) { this._hide(i); this.age[i] = life + 2; } continue; }
      age += dt; this.age[i] = age; alive++;
      const fr = this.frames[i];
      let gvx = 0, gvy = -g, gvz = 0;
      if (fr) {
        if (!fr.parent) { this.age[i] = life; continue; }
        _qi.copy(fr.quaternion).invert(); _g.set(0, -g, 0).applyQuaternion(_qi); gvx = _g.x; gvy = _g.y; gvz = _g.z;
      }
      let vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
      const dk = Math.exp(-this.drag * dt);
      vx = vx * dk + gvx * dt; vy = vy * dk + gvy * dt; vz = vz * dk + gvz * dt;
      let x = this.px[i] + vx * dt, y = this.py[i] + vy * dt, z = this.pz[i] + vz * dt;
      const size = Math.max(this.sc[i * 3], this.sc[i * 3 + 1], this.sc[i * 3 + 2]) * this.rad;
      const floor = fr ? this.floorY[i] : (this.groundFn ? this.groundFn(x, z) : this.gy[i]);
      let resting = false;
      if (y - size < floor) {
        y = floor + size;
        if (vy < 0) {
          const imp = -vy;
          if (imp > 1.2) { vy = imp * this.rest; vx *= this.fric; vz *= this.fric; this.av[i * 3] *= 0.6; this.av[i * 3 + 1] *= 0.6; this.av[i * 3 + 2] *= 0.6; if (this.onBounce) this.onBounce(this, i, fr ? x : x, y, z, imp, fr); }
          else { vy = 0; vx *= 0.86; vz *= 0.86; resting = true; }
        }
      }
      this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz; this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      // tumble
      let ax = this.av[i * 3], ay = this.av[i * 3 + 1], az = this.av[i * 3 + 2];
      if (resting) { ax *= 0.85; ay *= 0.85; az *= 0.85; this.av[i * 3] = ax; this.av[i * 3 + 1] = ay; this.av[i * 3 + 2] = az; }
      const w = Math.sqrt(ax * ax + ay * ay + az * az);
      const qo = i * 4;
      _q.set(this.q[qo], this.q[qo + 1], this.q[qo + 2], this.q[qo + 3]);
      if (w > 0.01) { _ax.set(ax / w, ay / w, az / w); _dq.setFromAxisAngle(_ax, w * dt); _q.premultiply(_dq).normalize(); this.q[qo] = _q.x; this.q[qo + 1] = _q.y; this.q[qo + 2] = _q.z; this.q[qo + 3] = _q.w; }
      // shrink out
      const left = life - age;
      const k = left < this.fadeTime ? Math.max(0, left / this.fadeTime) : 1;
      _p.set(x, y, z); _s.set(this.sc[i * 3] * k, this.sc[i * 3 + 1] * k, this.sc[i * 3 + 2] * k);
      _m.compose(_p, _q, _s);
      if (fr) { _mr.compose(fr.position, fr.quaternion, _one); _m.premultiply(_mr); }
      this.mesh.setMatrixAt(i, _m);
      if (this.flags[i] && this.onTrail) { this.trailT[i] += dt; if (this.trailT[i] > this.trailEvery) { this.trailT[i] = 0; const wp = fr ? _p.applyMatrix4(_mr) : _p; this.onTrail(this, i, wp.x, wp.y, wp.z, k); } }
    }
    this.alive = alive;
    this.mesh.instanceMatrix.needsUpdate = n > 0;
  }

  _hide(i) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); }
  worldPos(i, out) {
    const fr = this.frames[i];
    out.set(this.px[i], this.py[i], this.pz[i]);
    if (fr) { _mr.compose(fr.position, fr.quaternion, _one); out.applyMatrix4(_mr); }
    return out;
  }
  kill(i) { this.age[i] = this.life[i]; }
  dispose() { this.mesh.removeFromParent(); this.mesh.dispose(); }
}
