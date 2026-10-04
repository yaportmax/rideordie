// Hummer garage-only geometry envelope. The run, other chassis and benches
// retain their existing cameras. Static geometry scans happen on content changes.
// A skinned point is a convex sum of bone-transformed bind points. Cache each
// bone's influenced bind-space box once per crew instance, then transform only
// eight corners per bone while garage idle animation runs.
import * as THREE from 'three';

export const HUMMER_GARAGE_ID = 'player_hummer_t1';
export const TANK_GARAGE_ID = 'player_tank_t1';
const crewCache = new WeakMap();
const _point = new THREE.Vector3(), _corner = new THREE.Vector3();
const _frameInv = new THREE.Matrix4(), _matrix = new THREE.Matrix4(), _skinWorld = new THREE.Matrix4();
const _instance = new THREE.Matrix4(), _instanceWorld = new THREE.Matrix4();

function corners(box, fn) {
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    _corner.set(x, y, z); fn(_corner);
  }
}
function includeBox(out, box, matrix) {
  corners(box, point => out.expandByPoint(point.applyMatrix4(matrix)));
}
function geometryBox(mesh) {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) throw new Error('Hummer garage requires measured mesh bounds');
  return geometry.boundingBox;
}
function isCrew(mesh, roots) {
  for (let node = mesh; node; node = node.parent) if (roots.has(node)) return true;
  return false;
}
function cacheCrew(root) {
  const cached = crewCache.get(root);
  if (cached) return cached;
  const records = [];
  root.updateWorldMatrix(true, true);
  root.traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    if (!mesh.isSkinnedMesh) {
      records.push({ mesh, box: geometryBox(mesh) }); return;
    }
    const geometry = mesh.geometry, position = geometry.attributes.position;
    const index = geometry.attributes.skinIndex, weight = geometry.attributes.skinWeight;
    // The current hero assets have no active morph-position animation. Do not
    // silently accept an unhandled deformation if their contract later changes.
    if (!position || !index || !weight || geometry.morphAttributes.position?.length) throw new Error('Unsupported Hummer garage crew deformation');
    const bones = new Map();
    for (let i = 0; i < position.count; i++) {
      let total = 0;
      for (let lane = 0; lane < 4; lane++) {
        const k = weight.getComponent(i, lane);
        if (!Number.isFinite(k) || k < 0) throw new Error('Invalid Hummer garage skin weight');
        total += k;
        if (!k) continue;
        const bone = index.getComponent(i, lane), inverse = mesh.skeleton.boneInverses[bone];
        if (!Number.isInteger(bone) || !inverse || !mesh.skeleton.bones[bone]) throw new Error('Invalid Hummer garage skin bone');
        let box = bones.get(bone);
        if (!box) bones.set(bone, box = new THREE.Box3());
        _point.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(inverse);
        box.expandByPoint(_point);
      }
      if (Math.abs(total - 1) > 1e-6) throw new Error('Hummer garage requires normalized skin weights');
    }
    records.push({ mesh, bones: [...bones].map(([index, box]) => ({ bone: mesh.skeleton.bones[index], box })) });
  });
  crewCache.set(root, records);
  return records;
}

export class HummerGarageEnvelope {
  constructor(view, crews, frame, { tank = false } = {}) {
    if (view.spec.id !== (tank ? TANK_GARAGE_ID : HUMMER_GARAGE_ID) || !view.usesModel) throw new Error('Garage fitting requires its loaded chassis model');
    const roots = new Set(crews.map(crew => crew.root));
    const owner = new Set([view.root]);
    // A physical deck minigun is owned by its crew but parented to car.root.
    // Its yaw/pitch joints must follow the dynamic rigid-corner path too.
    for (const crew of crews) {
      const weapon = crew.weapon?.root;
      if (weapon?.parent && weapon.visible && isCrew(weapon, owner) && !isCrew(weapon, roots)) roots.add(weapon);
    }
    this.frame = frame; this.crews = [...roots].map(root => ({ root, records: cacheCrew(root) }));
    this.staticBox = new THREE.Box3(); this.box = new THREE.Box3(); this.center = new THREE.Vector3(); this.radius = 0;
    this.contentKey = view.upgradeKey; this.meshCount = 0; this.skinBoneCount = this.crews.reduce((n, crew) => n + crew.records.reduce((m, record) => m + (record.bones?.length || 0), 0), 0);
    frame.updateWorldMatrix(true, true);
    _frameInv.copy(frame.matrixWorld).invert();
    view.root.traverseVisible(mesh => {
      if (!mesh.isMesh || isCrew(mesh, roots)) return;
      _matrix.multiplyMatrices(_frameInv, mesh.matrixWorld);
      if (tank && mesh.isInstancedMesh) {
        // Tracks are 64 separately transformed shoes, not one unit cube at the
        // car origin. Scan only when garage content changes, never per frame.
        const box = geometryBox(mesh);
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, _instance); _instanceWorld.multiplyMatrices(_matrix, _instance);
          includeBox(this.staticBox, box, _instanceWorld);
        }
      } else includeBox(this.staticBox, geometryBox(mesh), _matrix);
      this.meshCount++;
    });
    if (!this.meshCount || this.staticBox.isEmpty()) throw new Error('Missing Hummer garage model/kit bounds');
    this.update();
  }
  update() {
    this.frame.updateWorldMatrix(true, false);
    _frameInv.copy(this.frame.matrixWorld).invert();
    this.box.copy(this.staticBox);
    for (const crew of this.crews) {
      crew.root.parent?.updateWorldMatrix(true, false);
      // SkinnedMesh.updateMatrixWorld refreshes attached bindMatrixInverse;
      // Object3D.updateWorldMatrix alone does not call that skin override.
      crew.root.updateMatrixWorld(true);
      for (const record of crew.records) {
        const mesh = record.mesh;
        if (!record.bones) {
          _matrix.multiplyMatrices(_frameInv, mesh.matrixWorld); includeBox(this.box, record.box, _matrix);
        } else {
          // This is the source SkinnedMesh vertex transform including both
          // bind matrices; no posed vertex or GPU palette is sampled per frame.
          _skinWorld.multiplyMatrices(_frameInv, mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
          for (const influence of record.bones) {
            _matrix.multiplyMatrices(_skinWorld, influence.bone.matrixWorld);
            includeBox(this.box, influence.box, _matrix);
          }
        }
      }
    }
    // Cover float skin-weight summation and affine-transform roundoff only.
    // This is a small geometry clearance, not a guessed camera zoom factor.
    this.box.expandByScalar(.0001);
    this.box.getCenter(this.center);
    this.radius = this.box.getSize(_point).length() * .5;
    return this;
  }
  worldCenter(out) { return out.copy(this.center).applyMatrix4(this.frame.matrixWorld); }
}

export class TankGarageEnvelope extends HummerGarageEnvelope {
  constructor(view, crews, frame) { super(view, crews, frame, { tank: true }); }
}

/** Exact angular sphere fit: d >= R/sin(half-angle). R/tan fits only
 * the centre-depth disc and can lose nearer box corners. Use the real free rect,
 * without the legacy fractional clamps that could exceed a small panel gap. */
export function hummerGarageFitDistance(radius, fov, width, height, rect) {
  const fx = (rect.r - rect.l) / width, fy = (rect.b - rect.t) / height;
  if (!(radius > 0 && fx > 0 && fy > 0 && width > 0 && height > 0 && fov > 0 && fov < 180)) throw new Error('Invalid Hummer garage fitting geometry');
  const tv = Math.tan(THREE.MathUtils.degToRad(fov) * .5);
  const need = Math.max(radius / (fy * tv), radius / (fx * tv * width / height));
  return Math.hypot(radius, need);
}

