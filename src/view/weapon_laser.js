// Local player's active aiming laser. Its unit belongs to the gun model, while
// this depth-tested world effect lives outside garage framing and the VM band.
import * as THREE from 'three';

const RANGE = 80, QUERY_SECONDS = .05;
const NO_TARGETS = Object.freeze([]);
/** The viewer's boss-clear branch skips firing, so laser lifetime cannot rely
 * only on the active fire branch. Both authority and viewer use this policy. */
export function canPresentWeaponLaser(run, playerState, phase) {
  return !!(run?.gunner?.crewAlive && playerState && !playerState.dead && !playerState.exploded &&
    phase === 'run' && !run.victoryPresentation && !run.cinematic && !run.introOutside && !run.deathCamT);
}
export class WeaponLaser {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = 'active_weapon_laser'; this.root.visible = false; scene.add(this.root);
    this.positions = new Float32Array(6);
    this.beamGeometry = new THREE.BufferGeometry(); this.beamGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.beamMaterial = new THREE.LineBasicMaterial({ name: 'weapon_laser_beam', color: 0xff2815, transparent: true,
      opacity: .24, depthTest: true, depthWrite: false, toneMapped: false });
    this.beam = new THREE.Line(this.beamGeometry, this.beamMaterial); this.beam.frustumCulled = false; this.root.add(this.beam);
    this.dotGeometry = new THREE.SphereGeometry(.022, 8, 6);
    this.dotMaterial = new THREE.MeshBasicMaterial({ name: 'weapon_laser_dot', color: 0xff321a, toneMapped: false,
      depthTest: true, depthWrite: false });
    this.dot = new THREE.Mesh(this.dotGeometry, this.dotMaterial); this.dot.castShadow = false; this.dot.receiveShadow = false; this.root.add(this.dot);
    this.origin = new THREE.Vector3(); this.direction = new THREE.Vector3(); this.endpoint = new THREE.Vector3();
    this.weapon = null; this.queryT = 0; this.hit = false; this.queryCount = 0; this.disposed = false;
  }

  /** Uses current rendered emitter, world/target collision, and no shot/damage path. */
  update(dt, gunner, weapon, originProvider, visible = true) {
    if (this.disposed) return;
    const selected = gunner?.attachments?.[gunner.weaponId]?.includes('laser');
    if (!visible || !selected || !weapon?.sockets?.laser_emitter || gunner.reloading || gunner.throwing > 0 || gunner.swapT > 0 || !originProvider?.laserWorld(this.origin)) {
      this.hide(); return;
    }
    this.direction.copy(gunner.aimPoint).sub(this.origin);
    if (!Number.isFinite(this.direction.x + this.direction.y + this.direction.z) || this.direction.lengthSq() < 1e-8) { this.hide(); return; }
    this.direction.normalize();
    this.queryT -= Math.max(0, Number.isFinite(dt) ? dt : 0);
    if (this.weapon !== weapon || this.queryT <= 0) {
      this.weapon = weapon; this.queryT = QUERY_SECONDS; this.queryCount++;
      let distance = RANGE;
      const worldHit = gunner.ctx.raycastWorld?.(this.origin, this.direction, RANGE);
      this.hit = !!(worldHit && Number.isFinite(worldHit.t) && worldHit.t >= 0 && worldHit.t <= RANGE);
      if (this.hit) distance = worldHit.t;
      // The production gunner target iterable excludes its own vehicle. Retain
      // an explicit identity guard for alternate host/solo context providers.
      const own = gunner.ctx.ownCar?.();
      for (const car of gunner.ctx.targets?.() || NO_TARGETS) {
        if (car === own || own && car.id === own.id || car.exploded && car.wreckOnly) continue;
        const hit = car.raycast?.(this.origin, this.direction, distance, null);
        if (hit && Number.isFinite(hit.t) && hit.t >= 0 && hit.t < distance) { distance = hit.t; this.hit = true; }
      }
      this.endpoint.copy(this.origin).addScaledVector(this.direction, distance);
    }
    this.root.visible = true;
    // A deliberately short visible beam avoids drawing a bright 80m line
    // across the whole view. It never extends beyond the measured impact.
    const distance = this.origin.distanceTo(this.endpoint), length = Math.min(.65, distance);
    this.positions[0] = this.origin.x; this.positions[1] = this.origin.y; this.positions[2] = this.origin.z;
    if (distance > 1e-8) this.direction.copy(this.endpoint).sub(this.origin).multiplyScalar(length / distance);
    else this.direction.set(0, 0, 0);
    this.positions[3] = this.origin.x + this.direction.x; this.positions[4] = this.origin.y + this.direction.y; this.positions[5] = this.origin.z + this.direction.z;
    this.beamGeometry.attributes.position.needsUpdate = true;
    this.dot.visible = this.hit;
    if (this.hit) {
      this.dot.position.copy(this.endpoint);
      // Pull off the contact by 3mm along the incoming ray to avoid z-fighting.
      if (distance > 1e-8) this.dot.position.addScaledVector(this.direction, -.003 / Math.max(length, 1e-8));
      this.dot.scale.setScalar(Math.max(.65, Math.min(2.2, distance / 30)));
    }
  }
  hide() {
    this.root.visible = false; this.dot.visible = false;
    this.weapon = null; this.queryT = 0; this.hit = false;
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.root.removeFromParent();
    this.beamGeometry.dispose(); this.beamMaterial.dispose(); this.dotGeometry.dispose(); this.dotMaterial.dispose();
  }
}
