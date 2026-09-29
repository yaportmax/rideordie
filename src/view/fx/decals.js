// Pooled ground/surface decals (scorch marks, bullet holes): one InstancedMesh per sheet, fade handled in the vertex shader.
import * as THREE from 'three';

const VERT = /* glsl */`
uniform float uTime; uniform vec2 uGridCR; uniform float uFogD;
attribute vec4 aDecal;                       // birth, life, alpha, cell
varying vec2 vUv; varying float vA; varying float vFog;
void main() {
  float age = uTime - aDecal.x;
  if (age < 0.0 || age > aDecal.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vUv = vec2(0.0); vFog = 0.0; return; }
  float t = age / aDecal.y;
  vA = aDecal.z * smoothstep(0.0, min(0.4 / aDecal.y, 0.5), t) * (1.0 - smoothstep(0.7, 1.0, t));
  float col = mod(aDecal.w, uGridCR.x); float row = floor(aDecal.w / uGridCR.x);
  vUv = (vec2(col, uGridCR.y - 1.0 - row) + uv) / uGridCR;
  vec4 mv = viewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vFog = 1.0 - exp(-uFogD * uFogD * dot(mv.xyz, mv.xyz));
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap; uniform vec3 uTint; uniform vec3 uLight; uniform vec3 uFogCol;
varying vec2 vUv; varying float vA; varying float vFog;
void main() {
  vec4 tx = texture2D(uMap, vUv);
  float a = tx.a * vA;
  if (a < 0.003) discard;
  vec3 rgb = tx.rgb * uTint * min(uLight, vec3(1.0));
  rgb = mix(rgb, uFogCol, vFog * 0.85);
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

export class DecalPool {
  /** opts {texture, cap, cols, rows, uniforms(shared uFogD,uFogCol,uLight), tint, order} */
  constructor(scene, opts) {
    this.cap = opts.cap; this.head = 0; this.time = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4), 4); this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDecal', this.attr);
    this.uniforms = {
      uTime: opts.time, uMap: { value: opts.texture }, uGridCR: { value: new THREE.Vector2(opts.cols, opts.rows) },
      uTint: { value: new THREE.Color(...(opts.tint || [1, 1, 1])) }, uFogD: opts.uniforms.uFogD, uFogCol: opts.uniforms.uFogCol, uLight: opts.uniforms.uLight,
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.cap);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = opts.order ?? 60; this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < this.cap; i++) this.mesh.setMatrixAt(i, _m);
    scene.add(this.mesh);
    this.n = 0;
  }

  /** Place a decal on a surface point with normal (nx,ny,nz). */
  add(x, y, z, nx, ny, nz, size, cell, rot, life, alpha, time) {
    const i = this.head; this.head = (i + 1) % this.cap; if (i + 1 > this.n) this.n = i + 1;
    _n.set(nx, ny, nz).normalize();
    _q.setFromUnitVectors(_z, _n);
    _q2.setFromAxisAngle(_z, rot); _q.multiply(_q2);
    _p.set(x + _n.x * 0.02, y + _n.y * 0.02, z + _n.z * 0.02); _s.set(size, size, 1);
    _m.compose(_p, _q, _s); this.mesh.setMatrixAt(i, _m);
    this.attr.setXYZW(i, time, life, alpha, cell);
    this.mesh.instanceMatrix.addUpdateRange(i * 16, 16); this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.addUpdateRange(i * 4, 4); this.attr.needsUpdate = true;
    this.mesh.count = this.n;
    return i;
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
