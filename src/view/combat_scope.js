// A purchased 3x combat optic. The annular housing is actual rigid geometry,
// including its inner wall; both end faces retain a real viewing aperture.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const COMBAT_SCOPE_MOUNTS = Object.freeze({
  rifle: Object.freeze({ parent: 'body', replaces: 'optic', rootPosition: Object.freeze([0, .1263, -.050]),
    axisY: .034, relief: .12, adsFov: 24 }),
  sniper: Object.freeze({ parent: 'body', replaces: 'scope', rootPosition: Object.freeze([0, .1027, -.050]),
    axisY: .034, relief: .12, adsFov: 24 }),
});
// An 80 mm compact combat optic with a genuinely wider objective bell. The
// rear aperture/eye position stays at the same weapon-root point as revision 2.
export const COMBAT_SCOPE_WINDOW = Object.freeze({ rearZ: -.040, frontZ: .040,
  innerRadius: .018, frontInnerRadius: .028, lensDiameter: .036, frontLensDiameter: .056, reticleZ: .006 });

const housingMaterial = new THREE.MeshStandardMaterial({ name: 'combat_scope_housing', color: 0x25292b,
  roughness: .54, metalness: .79 });
const lensMaterial = new THREE.MeshStandardMaterial({ name: 'combat_scope_glass_lens', color: 0xa3c2ca,
  transparent: true, opacity: .025, depthWrite: false, side: THREE.DoubleSide,
  roughness: .07, metalness: 0, envMapIntensity: .30 });
const rearLensGeometry = new THREE.CircleGeometry(COMBAT_SCOPE_WINDOW.innerRadius, 64);
const frontLensGeometry = new THREE.CircleGeometry(COMBAT_SCOPE_WINDOW.frontInnerRadius, 64);
const reticleGeometry = new THREE.PlaneGeometry(COMBAT_SCOPE_WINDOW.lensDiameter, COMBAT_SCOPE_WINDOW.lensDiameter);
const housingCache = new Map();

function annularFrustum(outerRear, outerFront, innerRear, innerFront, rearZ, frontZ, centerY) {
  // Split cap vertices from bore vertices to retain solid, crisp metal rims.
  // Continuous analytical radial normals keep the interior from looking like
  // a faceted opaque tunnel. No inward wall or end cap is removed.
  const segments = 64, positions = [], normals = [], uv = [], indices = [];
  const length = frontZ - rearZ;
  const surfaces = [
    { r: [outerRear, outerFront], z: [rearZ, frontZ], nr: 1, nz: -(outerFront - outerRear) / length, flip: false },
    { r: [innerRear, innerFront], z: [rearZ, frontZ], nr: -1, nz: (innerFront - innerRear) / length, flip: true },
    { r: [innerRear, outerRear], z: [rearZ, rearZ], nr: 0, nz: -1, flip: false },
    { r: [innerFront, outerFront], z: [frontZ, frontZ], nr: 0, nz: 1, flip: true },
  ];
  for (const surface of surfaces) {
    const start = positions.length / 3, norm = Math.hypot(surface.nr, surface.nz);
    for (let ring = 0; ring < 2; ring++) for (let i = 0; i <= segments; i++) {
      const theta = i / segments * Math.PI * 2, x = Math.cos(theta), y = Math.sin(theta);
      positions.push(x * surface.r[ring], centerY + y * surface.r[ring], surface.z[ring]);
      normals.push(x * surface.nr / norm, y * surface.nr / norm, surface.nz / norm); uv.push(i / segments, ring);
    }
    for (let i = 0; i < segments; i++) {
      const a = start + i, b = a + 1, d = a + segments + 1, c = d + 1;
      if (surface.flip) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
  return geometry;
}

export function combatScopeHousingGeometry(axisY = .034) {
  if (housingCache.has(axisY)) return housingCache.get(axisY);
  const pieces = [], box = (size, position) => pieces.push(new THREE.BoxGeometry(...size).translate(...position));
  const { rearZ, frontZ, innerRadius, frontInnerRadius } = COMBAT_SCOPE_WINDOW;
  pieces.push(annularFrustum(.0225, .034, innerRadius, frontInnerRadius, rearZ, frontZ, axisY));
  // Rear ocular ring follows the flare, avoiding a second narrow internal tube.
  pieces.push(annularFrustum(.0245, .0254, innerRadius, .01875, rearZ, rearZ + .006, axisY));
  // Objective ring is wider than the rear pupil and stays outside its sight cone.
  pieces.push(annularFrustum(.034, .0348, .027, frontInnerRadius, frontZ - .008, frontZ, axisY));
  // Actual clamps and turrets remain outside the inner bore.
  for (const z of [-.018, .018]) {
    const r0 = .0225 + (z - .0035 - rearZ) / (frontZ - rearZ) * (.034 - .0225);
    const r1 = .0225 + (z + .0035 - rearZ) / (frontZ - rearZ) * (.034 - .0225);
    pieces.push(annularFrustum(r0 + .002, r1 + .002, r0, r1, z - .0035, z + .0035, axisY));
    // The objective flare sits lower than the old straight tube. Follow its
    // actual exterior underside: a fixed tall foot would enter the lower sight
    // cone even though both annular end openings themselves were wide enough.
    // The foot top overlaps the exterior clamp wall by 2 mm, below the bore.
    box([.024, .010, .012], [0, axisY - Math.max(r0, r1) - .005, z]);
    for (const x of [-.018, .018]) box([.009, .008, .012], [x, .006, z]);
  }
  box([.034, .004, .062], [0, .002, 0]);
  const topDial = new THREE.CylinderGeometry(.0115, .0115, .011, 16);
  topDial.translate(0, axisY + .031, -.001); pieces.push(topDial);
  const sideDial = new THREE.CylinderGeometry(.010, .010, .010, 16);
  sideDial.rotateZ(Math.PI / 2).translate(-.033, axisY, -.001); pieces.push(sideDial);
  // Normalize transient layouts before merging; shared output is immutable.
  const compatible = pieces.map(piece => piece.index ? piece.toNonIndexed() : piece);
  const geometry = mergeGeometries(compatible, false);
  for (let i = 0; i < pieces.length; i++) {
    if (compatible[i] !== pieces[i]) compatible[i].dispose();
    pieces[i].dispose();
  }
  if (!geometry) throw new Error('Combat scope housing cannot merge its rigid geometry');
  geometry.name = 'combat_scope_open_annular_housing'; geometry.clearGroups();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); housingCache.set(axisY, geometry); return geometry;
}

const RETICLE_VS = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
const RETICLE_FS = `uniform float uI; uniform float uRing; varying vec2 vUv;
void main(){
  vec2 p=(vUv-.5)*.036; float radius=length(p);
  if(radius>.0168) discard;
  float dotA=1.0-smoothstep(.00018,.00032,radius);
  float gap=smoothstep(.0010,.0014,max(abs(p.x),abs(p.y)));
  float crossA=(1.0-smoothstep(.00009,.00017,min(abs(p.x),abs(p.y))))*gap;
  float edge=1.0-smoothstep(.0115,.0125,max(abs(p.x),abs(p.y)));
  float a=max(dotA,crossA*edge*.70)*uI; if(a<.01) discard;
  gl_FragColor=vec4(vec3(2.7,.065,.025)*a,a);
}`;

/** Same reticle/aim contract as attachReflexOptic; projection is configured by the existing VM helper. */
export function attachCombatScope(weapon) {
  const mount = COMBAT_SCOPE_MOUNTS[weapon.id]; if (!mount || !weapon.model) return null;
  const replaced = weapon.nodes[mount.replaces];
  // Replacement identity is exact. A changed hierarchy must be investigated,
  // rather than clipping a guessed box out of a merged receiver or barrel.
  if (!replaced || replaced.name !== mount.replaces) return null;
  weapon.root.updateWorldMatrix(true, true);
  const parent = weapon.nodes[mount.parent] || weapon.model;
  const root = new THREE.Group(); root.name = 'optic_combat_3x';
  const point = new THREE.Vector3(...mount.rootPosition); weapon.root.localToWorld(point); parent.worldToLocal(point);
  root.position.copy(point); parent.add(root);
  const housing = new THREE.Mesh(combatScopeHousingGeometry(mount.axisY), housingMaterial);
  housing.name = 'combat_scope_housing';
  const glass = new THREE.Mesh(rearLensGeometry, lensMaterial); glass.name = 'combat_scope_rear_lens';
  glass.position.set(0, mount.axisY, COMBAT_SCOPE_WINDOW.rearZ);
  const frontGlass = new THREE.Mesh(frontLensGeometry, lensMaterial); frontGlass.name = 'combat_scope_front_lens';
  frontGlass.position.set(0, mount.axisY, COMBAT_SCOPE_WINDOW.frontZ);
  const aim = new THREE.Object3D(); aim.name = 'optic_sight'; aim.position.copy(glass.position);
  const reticleMaterial = new THREE.ShaderMaterial({ name: 'combat_scope_reticle', vertexShader: RETICLE_VS,
    fragmentShader: RETICLE_FS, uniforms: { uI: { value: .25 }, uRing: { value: 0 } },
    transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false });
  const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial); reticle.name = 'combat_scope_reticle';
  reticle.position.set(0, mount.axisY, COMBAT_SCOPE_WINDOW.reticleZ);
  reticle.userData.opticReticle = true; reticle.renderOrder = 6; reticle.frustumCulled = false;
  reticle.castShadow = false; reticle.receiveShadow = false;
  root.add(housing, glass, frontGlass, aim, reticle);
  const wasVisible = replaced.visible; replaced.visible = false;
  let disposed = false;
  return { root, housing, glass, frontGlass, aim, reticle, mount, replaced, wasVisible,
    dispose(retainMaterials = null) {
      if (disposed) return; disposed = true; root.removeFromParent(); replaced.visible = wasVisible;
      if (retainMaterials) retainMaterials.add(reticleMaterial); else reticleMaterial.dispose();
    },
  };
}
