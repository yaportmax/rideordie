import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { REFLEX_MOUNTS, REFLEX_WINDOW } from '../data/weapon_optics.js';

// Five compatible weapons use three shared housing variants and one lens. These
// immutable resources have bounded application lifetime, like firearm templates.
const housingCache = new Map();
const housingMaterial = new THREE.MeshStandardMaterial({ name: 'optic_housing', color: 0x282b2c, roughness: .58, metalness: .76 });
const lensGeometry = new THREE.PlaneGeometry(REFLEX_WINDOW.width, REFLEX_WINDOW.height);
const lensMaterial = new THREE.MeshStandardMaterial({ name: 'optic_glass_lens', color: 0x92b9c1, transparent: true, opacity: .035,
  depthWrite: false, side: THREE.DoubleSide, roughness: .08, metalness: 0, envMapIntensity: .35 });

function roundedRect(path, x, y, w, h, r) {
  path.moveTo(x + r, y); path.lineTo(x + w - r, y); path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r); path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h); path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y); return path;
}
function extrude(shape, depth, z = 0) {
  return new THREE.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: true, bevelThickness: .00035,
    bevelSize: .00035, bevelSegments: 1, curveSegments: 4 }).translate(0, 0, z);
}
export function reflexHousingGeometry(plateWidth = .032, riserHeight = 0) {
  const key = `${plateWidth}:${riserHeight}`; if (housingCache.has(key)) return housingCache.get(key);
  const pieces = [], W = REFLEX_WINDOW.width, H = REFLEX_WINDOW.height, C = REFLEX_WINDOW.centerY + riserHeight;
  const block = (w, h, d, x, y, z, r = .001) => pieces.push(extrude(roundedRect(new THREE.Shape(), x - w / 2, y - h / 2, w, h, r), d, z - d / 2));
  block(plateWidth, .004, .048, 0, .002 + riserHeight, 0);
  block(.024, .008, .030, 0, .008 + riserHeight, 0);
  const frame = roundedRect(new THREE.Shape(), -W / 2 - .0035, C - H / 2 - .0035, W + .007, H + .007, .005);
  frame.holes.push(roundedRect(new THREE.Path(), -W / 2, C - H / 2, W, H, .0015));
  pieces.push(extrude(frame, .010, .010));
  // Brightness controls and clamp hardware stay outside the viewing aperture.
  block(.005, .008, .013, -W / 2 - .006, C - .007, .010);
  if (riserHeight) block(plateWidth * .8, riserHeight, .030, 0, riserHeight / 2, 0);
  const geometry = mergeGeometries(pieces, false); for (const piece of pieces) piece.dispose();
  geometry.clearGroups(); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); housingCache.set(key, geometry); return geometry;
}

const RETICLE_VS = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RETICLE_FS = `uniform float uI; uniform float uRing; varying vec2 vUv;
void main() {
  vec2 p = (vUv - .5) * vec2(.034, .030);
  // The reticle is a physical plane inside the lens, not an unbounded billboard.
  vec2 q = abs(p) - vec2(.0155, .0135);
  if (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) > .0015) discard;
  float r = length(p), dotAlpha = 1.0 - smoothstep(.00036, .00060, r);
  float ringAlpha = (1.0 - smoothstep(.00012, .00028, abs(r - .003))) * uRing * .65;
  float alpha = max(dotAlpha, ringAlpha) * uI;
  if (alpha < .01) discard;
  gl_FragColor = vec4(vec3(2.5, .07, .035) * alpha, alpha);
}`;

/** Each attachment owns only its reticle uniforms/material; geometry and PBR materials are shared. */
export function attachReflexOptic(weapon) {
  const mount = REFLEX_MOUNTS[weapon.id]; if (!mount || !weapon.model) return null;
  weapon.root.updateWorldMatrix(true, true);
  const parent = weapon.nodes[mount.parent] || weapon.model;
  const root = new THREE.Group(); root.name = 'optic_open_reflex';
  const point = new THREE.Vector3(...mount.rootPosition); weapon.root.localToWorld(point); parent.worldToLocal(point);
  root.position.copy(point); parent.add(root);
  const housing = new THREE.Mesh(reflexHousingGeometry(mount.plateWidth, mount.riserHeight || 0), housingMaterial);
  const glass = new THREE.Mesh(lensGeometry, lensMaterial); glass.position.set(0, REFLEX_WINDOW.centerY + (mount.riserHeight || 0), REFLEX_WINDOW.lensZ);
  const aim = new THREE.Object3D(); aim.name = 'optic_sight'; aim.position.copy(glass.position);
  const reticleMaterial = new THREE.ShaderMaterial({ name: 'optic_reflex_reticle', vertexShader: RETICLE_VS, fragmentShader: RETICLE_FS,
    uniforms: { uI: { value: .25 }, uRing: { value: mount.ring ? 1 : 0 } }, transparent: true, depthWrite: false,
    depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
  const reticle = new THREE.Mesh(lensGeometry, reticleMaterial); reticle.position.copy(glass.position); reticle.position.z -= .00015;
  reticle.userData.opticReticle = true;
  reticle.renderOrder = 6; reticle.frustumCulled = false;
  root.add(housing, glass, aim, reticle);
  const replaced = mount.replaces ? weapon.nodes[mount.replaces] : null;
  const wasVisible = replaced?.visible; if (replaced) replaced.visible = false;
  let disposed = false;
  return { root, housing, glass, aim, reticle, mount, replaced, wasVisible,
    dispose(retainMaterials = null) {
      if (disposed) return; disposed = true; root.removeFromParent(); if (replaced) replaced.visible = wasVisible;
      if (retainMaterials) retainMaterials.add(reticleMaterial); else reticleMaterial.dispose();
    } };
}

/** Use the exact VM projection/depth convention, so the dot cannot escape its housing. */
export function configureReflexProjection(optic, projectionUniform, band) {
  if (!optic) return;
  const material = optic.reticle.material;
  material.uniforms.vmProj = projectionUniform;
  material.vertexShader = `uniform mat4 vmProj; varying vec2 vUv;
void main() { vUv = uv; gl_Position = vmProj * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = (gl_Position.z + gl_Position.w) * ${band.toFixed(4)} - gl_Position.w; }`;
  material.needsUpdate = true;
}
