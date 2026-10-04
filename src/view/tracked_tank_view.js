// HELD bounded visual track approximation. No GPU/native/performance claim.
// Four authoritative contact pivots stay unchanged on the wire. Extra roadwheels
// follow their side's end-contact interpolation; belts are visual capsules.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const modulo = (x, n) => ((x % n) + n) % n;
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;
const descendant = (node, root) => { for (let p = node; p; p = p.parent) if (p === root) return true; return false; };

/** Suspended two-equal-radius capsule in the local YZ plane.
 * Returns position and pitch of a shoe whose +Z follows its travel tangent.
 * This is not a continuous terrain contact solver or track-link simulation.
 */
export function tankBeltPose(front, rear, radius, distance, out) {
  const dy = front.y - rear.y, dz = front.z - rear.z, length = Math.hypot(dy, dz);
  if (!(length > .001 && radius > 0) || !Number.isFinite(dy) || !Number.isFinite(dz) || !Number.isFinite(radius) || !Number.isFinite(distance)) throw new Error('Invalid suspended tank belt');
  const uy = dy / length, uz = dz / length, ny = uz, nz = -uy, arc = Math.PI * radius;
  let s = modulo(distance, 2 * length + 2 * arc), y, z, ty, tz;
  if (s < length) { y = rear.y + radius * ny + s * uy; z = rear.z + radius * nz + s * uz; ty = uy; tz = uz; }
  else if ((s -= length) < arc) {
    const a = s / radius, c = Math.cos(a), sn = Math.sin(a);
    y = front.y + radius * (ny * c + uy * sn); z = front.z + radius * (nz * c + uz * sn);
    ty = -ny * sn + uy * c; tz = -nz * sn + uz * c;
  } else if ((s -= arc) < length) { y = front.y - radius * ny - s * uy; z = front.z - radius * nz - s * uz; ty = -uy; tz = -uz; }
  else {
    s -= length;
    const a = s / radius, c = Math.cos(a), sn = Math.sin(a);
    y = rear.y - radius * (ny * c + uy * sn); z = rear.z - radius * (nz * c + uz * sn);
    ty = ny * sn - uy * c; tz = nz * sn - uz * c;
  }
  out.y = y; out.z = z; out.pitch = Math.atan2(-ty, tz); out.length = 2 * length + TAU * radius;
  return out;
}

function findMaterial(model, name) {
  let found;
  model.traverse(node => { if (!found && node.isMesh) found = [].concat(node.material).find(material => material?.name === name); });
  if (!found) throw new Error(`Actual tank PBR material missing: ${name}`);
  return found; // borrowed from the asset; this class never disposes it
}

export class TrackedTankView {
  constructor(view) {
    this.view = view; this.root = view.root; this.spec = view.spec; this.disposed = false; this.level = 0;
    this.previousQuaternion = new THREE.Quaternion(); this.seenPose = false; this.previousRevision = undefined;
    this.localVelocity = new THREE.Vector3(); this.inverse = new THREE.Quaternion(); this.delta = new THREE.Quaternion();
    this.worldRoot = new THREE.Quaternion(); this.parentRotation = new THREE.Quaternion(); this.turretRotation = new THREE.Quaternion();
    this.aim = new THREE.Vector3(); this.yawQuaternion = new THREE.Quaternion(); this.up = new THREE.Vector3(0, 1, 0);
    this.matrix = new THREE.Matrix4(); this.pos = new THREE.Vector3(); this.scale = new THREE.Vector3();
    this.rotation = new THREE.Quaternion(); this.euler = new THREE.Euler(); this.pose = { y: 0, z: 0, pitch: 0, length: 0 };
    this.records = []; this.ownedGeometry = [];
    const config = this.spec.trackVisual;
    if (this.spec.driveMode !== 'tracks' || !view.usesModel || config?.shoeCountPerSide !== 64) throw new Error('Tank visual requires actual loaded tracked model');
    const dark = findMaterial(view.model, 'metal_dark'), bare = findMaterial(view.model, 'metal_bare');
    // All buffer construction belongs to the constructor/configuration change,
    // never a frame update. Unit cubes preserve one borrowed PBR material/draw.
    const shoeGeometry = new THREE.BoxGeometry(1, 1, 1), bandGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.ownedGeometry.push(shoeGeometry, bandGeometry);
    this.turret = view.panels.get('turret');
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldQuaternion(this.worldRoot);
    this.turret?.getWorldQuaternion(this.turretRotation);
    this.turretRest = this.worldRoot.clone().invert().multiply(this.turretRotation);
    try {
      for (const [side, letter] of [[1, 'L'], [-1, 'R']]) {
        const front = view.wheelNodes.get('F' + letter), rear = view.wheelNodes.get('R' + letter);
        const staticNode = view.model.getObjectByName('part_track_' + letter);
        const middle = [0, 1, 2, 3].map(i => view.model.getObjectByName(`part_roadwheel_${letter}${i}`));
        if (!front || !rear || !staticNode || middle.some(node => !node)) throw new Error(`Actual tank belt nodes missing: ${letter}`);
        // Middle nodes may load as bare mesh roots and were made rigid by the
        // shared adoption path. They alone become movable; child primitives stay rigid.
        for (const node of middle) { node.matrixAutoUpdate = true; node.rotation.order = 'YXZ'; }
        const group = new THREE.Group(); group.name = `tank_belt_visual_${letter}`;
        const shoes = new THREE.InstancedMesh(shoeGeometry, dark, 64), bands = new THREE.InstancedMesh(bandGeometry, bare, 64);
        shoes.name = `tank_shoes_${letter}`; bands.name = `tank_belt_reinforcement_${letter}`;
        for (const mesh of [shoes, bands]) {
          mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(mesh);
        }
        this.root.add(group);
        this.records.push({ side, letter, front, rear, staticNode, staticVisible: staticNode.visible, middle, group, shoes, bands, phase: 0, spin: 0 });
      }
      // Keep actual exported fallback belts intact until both runtime sides exist.
      for (const r of this.records) {
        r.staticNode.visible = false;
        this._writeBelt(r, 2 * r.front.position.distanceTo(r.rear.position) + TAU * config.pathRadius);
      }
    } catch (error) { this.dispose(); throw error; }
  }

  setUpgradeLevel(level) {
    const next = Math.max(0, Math.min(4, Math.trunc(finite(level))));
    if (next === this.level) return false;
    this.level = next;
    // Garage has no advancing CarView.update. Rebuild only the existing
    // instance matrices from current pivots/phase; never advance clocks,
    // suspension, spin, revisions or simulation for a paid preview.
    for (const r of this.records) this._writeBelt(r, 2 * r.front.position.distanceTo(r.rear.position) + TAU * this.spec.trackVisual.pathRadius);
    return true;
  }

  _writeBelt(r, length) {
    const config = this.spec.trackVisual;
    for (let i = 0; i < 64; i++) {
      tankBeltPose(r.front.position, r.rear.position, config.pathRadius, i * length / 64 + r.phase, this.pose);
      this.pos.set(r.front.position.x, this.pose.y, this.pose.z);
      this.rotation.setFromEuler(this.euler.set(this.pose.pitch, 0, 0));
      this.scale.set(config.shoeWidth, .056, length / 64 * .94);
      this.matrix.compose(this.pos, this.rotation, this.scale); r.shoes.setMatrixAt(i, this.matrix);
      // Reinforcement stays inside the original radial contact thickness.
      this.pos.addScaledVector(this.aim.set(0, Math.cos(this.pose.pitch), Math.sin(this.pose.pitch)), .021);
      this.scale.set(config.shoeWidth * (.93 + this.level * .008), .018, .025 + this.level * .009);
      this.matrix.compose(this.pos, this.rotation, this.scale); r.bands.setMatrixAt(i, this.matrix);
    }
    r.shoes.instanceMatrix.needsUpdate = true; r.bands.instanceMatrix.needsUpdate = true;
  }

  update(st, dt) {
    if (this.disposed) return;
    const seconds = Math.max(0, Math.min(.05, finite(dt))), config = this.spec.trackVisual;
    this.inverse.copy(st.quat).invert(); this.localVelocity.copy(st.vel).applyQuaternion(this.inverse);
    const discontinuity = !this.seenPose || this.previousRevision !== st.poseRevision;
    let yawRate = 0;
    if (!discontinuity && seconds > .00001) {
      this.delta.copy(this.previousQuaternion).invert().multiply(st.quat).normalize();
      if (this.delta.w < 0) { this.delta.x *= -1; this.delta.y *= -1; this.delta.z *= -1; this.delta.w *= -1; }
      const vectorLength = Math.hypot(this.delta.x, this.delta.y, this.delta.z);
      if (vectorLength > .000001) yawRate = this.delta.y / vectorLength * 2 * Math.atan2(vectorLength, this.delta.w) / seconds;
      yawRate = Math.max(-4, Math.min(4, finite(yawRate)));
    }
    this.previousQuaternion.copy(st.quat); this.previousRevision = st.poseRevision; this.seenPose = true;
    for (const r of this.records) {
      const present = descendant(r.front, this.root) && descendant(r.rear, this.root) && !r.front.userData.gone && !r.rear.userData.gone;
      r.group.visible = present && !st.exploded;
      for (const node of r.middle) node.visible = present && !st.exploded;
      if (!present) continue; // lost contact assembly cannot leave a floating belt
      const speed = finite(this.localVelocity.z - yawRate * r.front.position.x);
      const length = 2 * r.front.position.distanceTo(r.rear.position) + TAU * config.pathRadius;
      if (discontinuity) { r.phase = 0; r.spin = 0; }
      else {
        r.phase = modulo(r.phase + speed * seconds, length);
        // Belt circumference is not an integer number of roadwheel turns.
        // A separate wrapped angle avoids a spoke jump when belt phase wraps.
        r.spin = modulo(r.spin + speed * seconds / this.spec.wheelRadius, TAU);
      }
      r.front.rotation.x = r.spin; r.rear.rotation.x = r.spin;
      for (let i = 0; i < r.middle.length; i++) {
        const node = r.middle[i], z = config.middleZ[i], t = (z - r.rear.position.z) / (r.front.position.z - r.rear.position.z);
        node.position.y = r.rear.position.y + (r.front.position.y - r.rear.position.y) * t;
        node.rotation.x = r.spin;
      }
      this._writeBelt(r, length);
    }
    if (this.turret && descendant(this.turret, this.root) && !this.turret.userData.gone) {
      const gunnerYaw = finite(st.gunner?.yaw);
      this.aim.set(Math.sin(gunnerYaw), 0, Math.cos(gunnerYaw)).applyQuaternion(this.inverse);
      const yaw = Math.atan2(this.aim.x, this.aim.z);
      this.root.getWorldQuaternion(this.worldRoot); this.turret.parent.getWorldQuaternion(this.parentRotation);
      this.yawQuaternion.setFromAxisAngle(this.up, yaw);
      this.turret.quaternion.copy(this.parentRotation).invert().multiply(this.worldRoot).multiply(this.yawQuaternion).multiply(this.turretRest);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const r of this.records) {
      r.group.removeFromParent(); r.shoes.dispose(); r.bands.dispose(); r.staticNode.visible = r.staticVisible;
    }
    for (const geometry of this.ownedGeometry) geometry.dispose();
    this.records.length = 0; this.ownedGeometry.length = 0;
  }
}
