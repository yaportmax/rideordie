// Rapier wrapper: world creation, collision groups, small helpers. Works in browser and Node.
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

// Collision membership bits.
export const G = { WORLD: 1, CAR: 2, DEBRIS: 4, PROP: 8, RAGDOLL: 16, BULLET: 32, GRENADE: 64 };
/** Rapier InteractionGroups: high 16 bits = membership, low 16 = filter. */
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const GROUPS = {
  world: groups(G.WORLD, G.CAR | G.DEBRIS | G.PROP | G.RAGDOLL | G.GRENADE),
  car: groups(G.CAR, G.WORLD | G.CAR | G.PROP | G.GRENADE),
  grenade: groups(G.GRENADE, G.WORLD | G.CAR),
  debris: groups(G.DEBRIS, G.WORLD),
  prop: groups(G.PROP, G.WORLD | G.CAR | G.PROP | G.DEBRIS),
  ragdoll: groups(G.RAGDOLL, G.WORLD),
};
/** Raycast filters (query groups). */
export const RAY_WORLD = groups(0xffff, G.WORLD);
export const RAY_SHOT = groups(0xffff, G.WORLD | G.PROP);

let ready = null;
export function initPhysics() {
  if (!ready) ready = RAPIER.init();
  return ready;
}

export const GRAVITY = 17.5; // a bit heavier than real for arcade weight

export function createWorld(dt = 1 / 120) {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = dt;
  world.numSolverIterations = 6;
  return world;
}

/** Static trimesh collider (terrain strips, structure collision). */
export function addStaticTrimesh(world, vertices, indices, opts = {}) {
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const desc = RAPIER.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(GROUPS.world).setFriction(opts.friction ?? 0.9).setRestitution(0.0);
  const col = world.createCollider(desc, rb);
  return { rb, col };
}

export function addStaticBox(world, center, half, rotQuat, opts = {}) {
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], center[1], center[2]));
  const desc = RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setCollisionGroups(GROUPS.world).setFriction(opts.friction ?? 0.3).setRestitution(opts.restitution ?? 0.05);
  if (rotQuat) desc.setRotation({ x: rotQuat[0], y: rotQuat[1], z: rotQuat[2], w: rotQuat[3] });
  const col = world.createCollider(desc, rb);
  return { rb, col };
}

export function removeBody(world, rb) { if (rb) world.removeRigidBody(rb); }

/** Debug: collider handle -> label for static geometry (terrain chunk, road chunk, hazard ...). */
export const COLLIDER_LABELS = new Map();
