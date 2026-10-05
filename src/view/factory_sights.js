// Free factory sights for the Raider AR. Its baked AK leaf sits below the
// railed cover; merely lowering the old optic eye point would aim into that
// cover. Two physical flip-up sights clear the rail without cutting the body.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FACTORY_RIFLE_IRONS = Object.freeze({
  rearZ: -.100, frontZ: .405, axisY: .1592,
  eye: Object.freeze([0, .1592, -.170]), relief: .12, adsFov: 52,
});

let rifleGeometry = null;
const metal = new THREE.MeshStandardMaterial({ name: 'factory_iron_sights', color: 0x242a2c,
  roughness: .64, metalness: .76 });

function ironGeometry() {
  if (rifleGeometry) return rifleGeometry;
  const pieces = [];
  const box = (size, position) => pieces.push(new THREE.BoxGeometry(...size).translate(...position));
  const { rearZ, frontZ, axisY } = FACTORY_RIFLE_IRONS;
  // Rear U-notch: the aiming ray passes between the ears, above its solid base.
  box([.032, .004, .022], [0, .1283, rearZ]);
  box([.018, .009, .008], [0, .1348, rearZ]);
  for (const x of [-.010, .010]) {
    box([.006, .030, .007], [x, .151, rearZ]);
    box([.006, .006, .012], [x, .166, rearZ]);
  }
  // The front blade is attached to a small bridge on the gas block. Its
  // upper edge is the sight line; protective ears sit outside the center view.
  box([.032, .006, .024], [0, .128, frontZ]);
  box([.008, .018, .007], [0, .140, frontZ]);
  box([.0022, .0102, .0032], [0, axisY - .0051, frontZ]);
  for (const x of [-.011, .011]) box([.004, .034, .008], [x, .148, frontZ]);
  rifleGeometry = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  rifleGeometry.name = 'factory_rifle_flipup_irons'; rifleGeometry.clearGroups();
  rifleGeometry.computeBoundingBox(); rifleGeometry.computeBoundingSphere();
  return rifleGeometry;
}

/**
 * Change only the standard rifle copy. mergeRigid preserves the exact `optic`
 * authored node, so hiding it removes its complete housing/lenses/riser without
 * removing receiver or gun mechanism triangles from their shared template.
 * The returned tune is consumed by the viewmodel, not by combat simulation.
 */
export function configureFactorySights(weapon) {
  if (weapon.id !== 'rifle' || weapon.opticId !== 'standard' || !weapon.model) return null;
  const replaced = weapon.nodes.optic;
  // Fail closed to the existing sight if a changed asset no longer carries the
  // isolated optic. Never guess a body-space region and cut unrelated metal.
  if (!replaced || replaced.name !== 'optic') return null;
  const wasVisible = replaced.visible; replaced.visible = false;
  const root = new THREE.Group(); root.name = 'factory_rifle_irons';
  const housing = new THREE.Mesh(ironGeometry(), metal); housing.name = 'factory_rifle_iron_hardware';
  housing.castShadow = false; housing.receiveShadow = false;
  const aim = new THREE.Object3D(); aim.name = 'factory_sight'; aim.position.fromArray(FACTORY_RIFLE_IRONS.eye);
  root.add(housing, aim); weapon.root.add(root);
  let disposed = false;
  return { root, housing, aim, replaced, wasVisible,
    tune: Object.freeze({ adsSight: FACTORY_RIFLE_IRONS.eye, adsRot: Object.freeze([0, 0, 0]),
      relief: FACTORY_RIFLE_IRONS.relief, adsFov: FACTORY_RIFLE_IRONS.adsFov, reticle: null }),
    dispose() { if (disposed) return; disposed = true; root.removeFromParent(); replaced.visible = wasVisible; },
  };
}
