// Deck origin, +Y up, +Z forward, metres. The base belongs to the vehicle, never
// a hand or floating gun frame. Only the yaw joint, pitch cradle and rotor move.
import * as THREE from 'three';
import * as Assets from '../core/assets.js';
import { configureWeaponShadows } from './weapon_view.js';

export const MOUNTED_MINIGUN_MODEL = '/models/weapons/mounted_minigun.glb';
export const MINIGUN_DECK_OFFSET = Object.freeze([0, 0, .58]);
// Muzzle is rotor-local: barrel_0 center lies at radius .078 and its authored
// .78m tube extends from z.445 to z.835. Other sockets are pitch-local.
export const MINIGUN_SOCKETS = Object.freeze({
  muzzle: Object.freeze([.078, 0, .835]),
  eject: Object.freeze([-.175, -.06, -.05]),
  grip_R: Object.freeze([-.19, -.105, -.35]),
  grip_L: Object.freeze([.19, -.105, -.35]),
  mag_well: Object.freeze([.255, -.12, -.055]),
  sight: Object.freeze([0, .275, -.10]),
});
const SOCKET_NAMES = new Set(Object.keys(MINIGUN_SOCKETS));
const TAU = Math.PI * 2, ROTOR_AXIS = new THREE.Vector3(0, 0, 1);
const localDir = new THREE.Vector3(), worldDir = new THREE.Vector3();
const inverseFrame = new THREE.Quaternion();
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;

function namedGroup(name, parent, position = [0, 0, 0]) {
  const g = new THREE.Group(); g.name = name; g.position.fromArray(position); parent.add(g); return g;
}

/** A missing asset still shows a pedestal/rotor, and advertises the fallback for diagnostics. */
function fallbackModel(owned) {
  const root = new THREE.Group(); root.name = 'mounted_minigun_fallback';
  const metal = new THREE.MeshStandardMaterial({ name: 'mounted_gun_metal', color: 0x292e30, roughness: .62, metalness: .75 });
  owned.push(metal);
  const box = (parent, name, size, position) => {
    const geo = new THREE.BoxGeometry(...size); owned.push(geo);
    const mesh = new THREE.Mesh(geo, metal); mesh.name = name; mesh.position.fromArray(position); parent.add(mesh); return mesh;
  };
  const base = namedGroup('gun_mount_base', root);
  box(base, 'footplate', [.44, .055, .44], [0, .0275, 0]);
  box(base, 'pedestal', [.10, 1.05, .10], [0, .58, 0]);
  const yaw = namedGroup('gun_mount_yaw', root, [0, 1.08, 0]);
  box(yaw, 'cradle_L', [.055, .20, .20], [.155, .105, 0]);
  box(yaw, 'cradle_R', [.055, .20, .20], [-.155, .105, 0]);
  const pitch = namedGroup('gun_mount_pitch', yaw, [0, .14, 0]);
  const body = namedGroup('body', pitch);
  box(body, 'receiver', [.26, .24, .36], [0, 0, -.09]);
  const rotor = namedGroup('gun_mg_barrels', pitch, [0, 0, .06]);
  const barrelGeo = new THREE.CylinderGeometry(.029, .029, .78, 12, 1, true); owned.push(barrelGeo);
  for (let i = 0; i < 6; i++) {
    const angle = i * TAU / 6, mesh = new THREE.Mesh(barrelGeo, metal);
    mesh.name = 'barrel_' + i; mesh.rotation.x = Math.PI / 2;
    mesh.position.set(Math.cos(angle) * .078, Math.sin(angle) * .078, .445); rotor.add(mesh);
  }
  const mag = namedGroup('mag', pitch, [.255, -.12, -.055]);
  box(mag, 'ammo_drum', [.21, .24, .24], [0, -.07, 0]);
  const cover = namedGroup('feed_cover', pitch, [.115, .11, -.05]);
  box(cover, 'feed_lid', [.16, .025, .20], [.08, 0, 0]);
  for (const x of [-.19, .19]) box(body, 'spade_handle', [.045, .14, .045], [x, -.105, -.35]);
  const optic = namedGroup('optic', pitch, MINIGUN_SOCKETS.sight);
  for (const x of [-.041, .041]) box(optic, 'optic_side', [.012, .079, .022], [x, 0, 0]);
  for (const y of [-.0335, .0335]) box(optic, 'optic_crossbar', [.094, .012, .022], [0, y, 0]);
  for (const [name, p] of Object.entries(MINIGUN_SOCKETS)) {
    const socket = new THREE.Object3D(); socket.name = name; socket.position.fromArray(p);
    if (name === 'eject') socket.rotation.z = -Math.PI / 2;
    (name === 'muzzle' ? rotor : pitch).add(socket);
  }
  return root;
}

function factoryReflex(weapon) {
  const aim = weapon.sockets.sight, parent = aim?.parent;
  if (!parent) return null;
  const geometry = new THREE.PlaneGeometry(.070, .055); weapon._ownedResources.push(geometry);
  const material = new THREE.ShaderMaterial({ name: 'mounted_open_reflex_reticle',
    uniforms: { uI: { value: .85 }, uRing: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uI; uniform float uRing; varying vec2 vUv;
      void main(){ vec2 p=(vUv-.5)*vec2(.070,.055); float r=length(p);
        float dotA=1.0-smoothstep(.00075,.00125,r);
        float ringA=(1.0-smoothstep(.00035,.00070,abs(r-.0065)))*uRing*.6;
        float a=max(dotA,ringA)*uI; if(a<.01) discard; gl_FragColor=vec4(vec3(2.8,.08,.03)*a,a); }`,
    transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const reticle = new THREE.Mesh(geometry, material); reticle.name = 'mounted_reflex_reticle';
  reticle.position.copy(aim.position); reticle.position.z -= .00015;
  reticle.renderOrder = 6; reticle.frustumCulled = false; reticle.userData.opticReticle = true;
  reticle.castShadow = false; reticle.receiveShadow = false; parent.add(reticle);
  let disposed = false;
  return { root: weapon.nodes.optic || parent, housing: weapon.nodes.optic, glass: null, aim, reticle,
    mount: { relief: .30, ring: true },
    dispose(retainMaterials = null) {
      if (disposed) return; disposed = true; reticle.removeFromParent();
      if (retainMaterials) retainMaterials.add(material); else material.dispose();
    },
  };
}

/** WeaponView-compatible render adapter. A factory open reflex is included in standard. */
export class MountedGun {
  constructor(id = 'minigun', opts = {}) {
    if (id !== 'minigun') throw new Error('MountedGun only supports minigun');
    this.id = id; this.opticId = 'standard'; this.mounted = true;
    this.root = new THREE.Group(); this.root.name = 'weapon_minigun_mounted';
    this._ownedResources = []; this.nodes = {}; this.rest = {}; this.sockets = {};
    this.model = opts.model || Assets.clone(MOUNTED_MINIGUN_MODEL);
    this.fallback = !this.model;
    if (!this.model) this.model = fallbackModel(this._ownedResources);
    else {
      // Car damage and crew visibility code may alter colour/depth uniforms.
      // Keep those edits local while immutable cached model geometry is shared.
      const materials = new Map();
      this.model.traverse(mesh => {
        if (!mesh.isMesh) return;
        const own = original => {
          if (!materials.has(original)) { const material = original.clone(); materials.set(original, material); this._ownedResources.push(material); }
          return materials.get(original);
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
      });
    }
    this.root.add(this.model);
    this.model.traverse(node => {
      if (node.name) { this.nodes[node.name] = node; this.rest[node.name] = { p: node.position.clone(), q: node.quaternion.clone() }; }
      if (SOCKET_NAMES.has(node.name)) this.sockets[node.name] = node;
    });
    this.yawJoint = this.nodes.gun_mount_yaw;
    this.pitchJoint = this.nodes.gun_mount_pitch;
    this.rotor = this.nodes.gun_mg_barrels;
    if (!this.yawJoint || !this.pitchJoint || !this.rotor || [...SOCKET_NAMES].some(n => !this.sockets[n])) {
      this.dispose(); throw new Error('mounted_minigun.glb: missing mount joint or gameplay socket');
    }
    configureWeaponShadows(this.model);
    this.optic = factoryReflex(this); this.sockets.optic_sight = this.sockets.sight;
    this.spinSpeed = 0; this.spinAngle = 0; this.shotHold = 0;
    this.cycleT = 1; this.cycleLen = .04; this.trig = 0; this.reload = 0; this.reloading = false;
    this.mech = {}; this.beltStep = 0;
  }

  /** The seat is the standing gunner's deck position in car-local space. */
  attachToDeck(carRoot, seat, offset = MINIGUN_DECK_OFFSET) {
    carRoot.add(this.root);
    this.root.position.set(seat[0] + offset[0], seat[1] + offset[1], seat[2] + offset[2]);
    this.root.quaternion.identity(); return this;
  }

  /** Convert world aim through the full rolling/pitched vehicle frame. No body/hand parent is involved. */
  aimWorld(direction) {
    if (!direction || !Number.isFinite(direction.x + direction.y + direction.z) || direction.lengthSq() < 1e-12) return false;
    this.root.updateWorldMatrix(true, false);
    this.root.getWorldQuaternion(inverseFrame).invert();
    localDir.copy(direction).normalize().applyQuaternion(inverseFrame);
    this.yawJoint.rotation.y = Math.atan2(localDir.x, localDir.z);
    // Match the controller's supported vertical aim, including steep deck attitude.
    this.pitchJoint.rotation.x = -Math.atan2(localDir.y, Math.hypot(localDir.x, localDir.z));
    this.root.updateWorldMatrix(false, true); return true;
  }

  fire(rateHz = 20) {
    this.shotHold = .12; this.cycleT = 0; this.cycleLen = Math.min(.08, .8 / Math.max(1, finite(rateHz, 20)));
    this.beltStep++;
  }
  action() {} // rotary automatic fire has no pump/bolt override

  update(dt, s = {}) {
    dt = clamp(finite(dt), 0, .1);
    if (s.aimDirection) this.aimWorld(s.aimDirection);
    else if (Number.isFinite(s.aimYaw) && Number.isFinite(s.aimPitch)) {
      const cp = Math.cos(s.aimPitch);
      worldDir.set(Math.sin(s.aimYaw) * cp, Math.sin(s.aimPitch), Math.cos(s.aimYaw) * cp); this.aimWorld(worldDir);
    }
    this.shotHold = Math.max(0, this.shotHold - dt);
    this.reloading = !!s.reloading; this.reload = this.reloading ? clamp(finite(s.reload01), 0, 1) : 0;
    const firing = !this.reloading && !s.empty && (!!s.trigger || this.shotHold > 0);
    this.trig += ((firing ? 1 : 0) - this.trig) * (1 - Math.exp(-dt * 25));
    this.spinSpeed += ((firing ? 34 : 0) - this.spinSpeed) * (1 - Math.exp(-dt * (firing ? 12 : 4)));
    this.spinAngle = (this.spinAngle + this.spinSpeed * dt) % TAU;
    this.rotor.quaternion.copy(this.rest.gun_mg_barrels.q).multiply(inverseFrame.setFromAxisAngle(ROTOR_AXIS, this.spinAngle));
    this.cycleT = Math.min(1, this.cycleT + dt / this.cycleLen);
    const mag = this.nodes.mag, cover = this.nodes.feed_cover, parts = s.parts;
    const r = this.reload;
    const magK = parts?.mag ?? (r <= 0 ? 0 : r < .25 ? r / .25 : r < .6 ? 1 : r < .85 ? ( .85 - r ) / .25 : 0);
    if (mag) { mag.position.copy(this.rest.mag.p).addScaledVector(localDir.set(1, -.7, 0), Math.max(0, finite(magK)) * .23);
      mag.visible = parts?.magVisible ?? !(r > .28 && r < .56); }
    if (cover) {
      const coverK = parts?.cover ?? (r <= 0 ? 0 : r < .12 ? r / .12 : r < .84 ? 1 : Math.max(0, (1 - r) / .16));
      cover.quaternion.copy(this.rest.feed_cover.q).multiply(inverseFrame.setFromAxisAngle(localDir.set(0, 0, 1), -1.15 * clamp(finite(coverK), 0, 1)));
    }
  }

  muzzleWorld(out) { if (!this.sockets.muzzle) return false; this.sockets.muzzle.getWorldPosition(out); return true; }
  ejectWorld(out, directionOut = null) {
    const socket = this.sockets.eject; if (!socket) return false;
    socket.getWorldPosition(out);
    // Authored -90deg Z socket rotation: local -Y is gun-right (-X).
    if (directionOut) { socket.getWorldQuaternion(inverseFrame); directionOut.set(0, -1, 0).applyQuaternion(inverseFrame).normalize(); }
    return true;
  }
  sightWorld(out) { if (!this.sockets.sight) return false; this.sockets.sight.getWorldPosition(out); return true; }
  /** Actual vehicle-bound ADS eye point behind the moving factory reflex. */
  eyeWorld(out, relief = this.optic?.mount.relief ?? .30) {
    if (!this.sightWorld(out)) return false;
    this.pitchJoint.getWorldDirection(worldDir);
    out.addScaledVector(worldDir, -Math.max(0, finite(relief, .30))); return true;
  }
  prepareSightBores() { return []; } // the factory optic is an authored physical opening

  dispose(retainMaterials = null) {
    if (this.disposed) return; this.disposed = true;
    this.root.removeFromParent(); this.optic?.dispose(retainMaterials);
    for (const resource of this._ownedResources) {
      if (retainMaterials && resource.isMaterial) retainMaterials.add(resource); else resource.dispose();
    }
    this._ownedResources.length = 0;
  }
}
