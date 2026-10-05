// Firearm additions in authored weapon metres (+Z forward). Each assembly is
// merged by material and moving parent at construction, never rebuilt per frame.
// Cached atlas materials remain immutable; instance geometry dies with its gun.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sanitizeWeaponAttachmentIds } from '../data/weapon_attachments.js';
import { weaponVisualKey, weaponVisualLevels } from '../data/weapon_visual_config.js';
export { weaponVisualKey, weaponVisualLevels } from '../data/weapon_visual_config.js';

const METAL = new THREE.MeshStandardMaterial({ name: 'weapon_mod_metal', color: 0x34393b, roughness: .55, metalness: .78 });
const POLYMER = new THREE.MeshStandardMaterial({ name: 'weapon_mod_polymer', color: 0x222822, roughness: .82, metalness: .05 });
const RUBBER = new THREE.MeshStandardMaterial({ name: 'weapon_mod_rubber', color: 0x151919, roughness: .94, metalness: .01 });
const LASER = new THREE.MeshStandardMaterial({ name: 'weapon_mod_laser_lens', color: 0xe93120, emissive: 0xe82b18, emissiveIntensity: 1.7, roughness: .24, metalness: .05 });
const MATERIALS = Object.freeze({ metal: METAL, polymer: POLYMER, rubber: RUBBER, laser: LASER });
const box = (size, p, mat = 'metal', rot = null) => ({ kind: 'box', size, p, mat, rot });
const tube = (r, length, p, mat = 'metal', axis = 'z', inner = 0) => ({ kind: 'tube', r, length, p, mat, axis, inner });
const row = (id, parent, pieces, track = null, level = 1) => ({ id, parent, pieces, track, level });
const MAG_BOTTOM = Object.freeze({
  // Bottom seats are taken from the authored generator floorplates, not the
  // moving node pivots. Curved SMG/AK additions continue their terminal tangent.
  pistol: Object.freeze({ p: [0, -.085, -.030], size: [.030, .026, .036], rake: .349 }),
  smg: Object.freeze({ p: [0, -.176, .125], size: [.027, .054, .039], rake: -.442 }),
  rifle: Object.freeze({ p: [0, -.172, .206], size: [.032, .065, .062], rake: -.659 }),
  sniper: Object.freeze({ p: [0, -.012, .128], size: [.028, .042, .060], rake: 0 }),
  lmg: Object.freeze({ p: [.044, -.074, .056], size: [.078, .063, .154], rake: 0 }),
  minigun: Object.freeze({ p: [.255, -.215, -.055], size: [.215, .120, .245], rake: 0 }),
});
const BARREL = Object.freeze({
  pistol: [0, .058, .142, .011], revolver: [0, .077, .232, .013],
  smg: [0, .064, .310, .012], shotgun: [0, .054, .654, .014],
  rifle: [0, .092, .541, .012], lmg: [0, .090, .622, .015], sniper: [0, .074, .742, .018],
});
const LASER_MOUNT = Object.freeze({
  pistol: [.020, .038, .113], revolver: [.026, .064, .163],
  smg: [.026, .045, .247], shotgun: [.023, .054, .514],
  rifle: [.030, .065, .417], lmg: [.035, .067, .427],
  sniper: [.031, .042, .420], minigun: [.165, .050, .230],
});
const FOREGRIP = Object.freeze({
  smg: [.004, .040, .188], shotgun: [0, .027, .350],
  rifle: [0, .058, .325], lmg: [0, .051, .312],
});
const STOCK = Object.freeze({
  smg: [0, .062, -.322], shotgun: [0, .020, -.315],
  rifle: [0, .051, -.333], lmg: [0, .056, -.406], sniper: [0, .048, -.376],
});
const GRIP = Object.freeze({
  pistol: [0, -.021, -.008], revolver: [0, -.003, -.025],
  smg: [0, -.019, -.014], shotgun: [0, -.008, .020],
  rifle: [0, -.011, -.002], lmg: [0, -.019, -.008], sniper: [0, -.011, -.020],
  rpg: [0, -.022, 0], minigun: [0, -.105, -.35],
});

/** Declarative physical plan is also the actual source used by native renderers. */
export function weaponAttachmentPlan(id, levels = {}, attachments = []) {
  const lv = weaponVisualLevels(levels), mods = sanitizeWeaponAttachmentIds(id, attachments), rows = [];
  const has = value => mods.includes(value);
  const magLevel = Math.max(lv.mag, has('extended_mag') ? 2 : 0), bottom = MAG_BOTTOM[id];
  if (magLevel && bottom) {
    const s = bottom.size, p = bottom.p, h = s[1] * (.68 + .22 * magLevel);
    const cy = -Math.cos(bottom.rake), cz = -Math.sin(bottom.rake), along = d => [p[0], p[1] + cy * d, p[2] + cz * d];
    const pieces = [box([s[0], h, s[2]], along(h / 2 - .008), 'polymer', [bottom.rake, 0, 0]),
      box([s[0] + .006, .009, s[2] + .004], along(h - .010), 'metal', [bottom.rake, 0, 0])];
    for (let k = 0; k < magLevel + 1; k++) pieces.push(box([s[0] + .001, .0025, s[2] + .003], along(.011 + k * .014), 'rubber', [bottom.rake, 0, 0]));
    if (id === 'minigun') {
      // A wider circular end on the existing detachable drum, not a rifle mag.
      pieces.splice(0, pieces.length, tube(.151 + magLevel * .007, .080 + magLevel * .018, [.305, -.12, -.055], 'polymer', 'x'),
        tube(.155 + magLevel * .007, .012, [.351 + magLevel * .009, -.12, -.055], 'metal', 'x'));
    }
    rows.push(row('capacity_extension', 'mag', pieces, 'mag', magLevel));
  } else if (magLevel && id === 'shotgun') {
    // The pump stays on the factory action bars; magazine capacity lives in a
    // stationary under-barrel extension and clamp, never a detachable box.
    const length = .035 + .023 * magLevel;
    rows.push(row('capacity_extension', 'body', [tube(.016, length, [0, .027, .636 + length / 2]),
      tube(.018, .012, [0, .027, .636 + length], 'metal'),
      box([.038, .031, .018], [0, .040, .624], 'polymer')], 'mag', magLevel));
  } else if (lv.mag && id === 'revolver') {
    // Existing legacy capacity ownership remains visible as a machined cylinder
    // band. No detachable magazine or inaccurate additional reload clip.
    rows.push(row('legacy_capacity_cylinder', 'cylinder', [tube(.022 + lv.mag * .0007, .008 + lv.mag * .004, [0, .060, .077], 'metal', 'z', .0196)], 'mag', lv.mag));
  } else if (lv.mag && id === 'rpg') {
    rows.push(row('legacy_capacity_carrier', 'body', [box([.018, .031, .135], [-.039, .046, .305], 'polymer'),
      box([.022, .008, .139], [-.039, .027, .305], 'metal')], 'mag', lv.mag));
  }
  // Capacity uses max(old tier, separate magazine), never adds another buff.
  // These actual machined tier marks remain independently visible when a paid
  // extended magazine already supplies the same extension length as tier 1/2.
  if (lv.mag && bottom) {
    const pieces = [], s = bottom.size, p = bottom.p;
    if (id === 'minigun') {
      const faceX = .351 + magLevel * .009 + .007;
      for (let k = 0; k < lv.mag; k++) {
        const radius = .132 - k * .016;
        pieces.push(tube(radius, .003, [faceX, -.12, -.055], 'metal', 'x', radius - .004));
      }
    } else {
      const cy = -Math.cos(bottom.rake), cz = -Math.sin(bottom.rake);
      for (let k = 0; k < lv.mag; k++) {
        const d = .005 + k * .010;
        pieces.push(box([s[0] + .005, .003, s[2] + .006], [p[0], p[1] + cy * d, p[2] + cz * d], 'metal', [bottom.rake, 0, 0]));
      }
    }
    rows.push(row('legacy_capacity_index', 'mag', pieces, 'mag', lv.mag));
  } else if (lv.mag && id === 'shotgun') {
    const pieces = [];
    for (let k = 0; k < lv.mag; k++) pieces.push(tube(.018, .003, [0, .027, .645 + k * .012], 'metal', 'z', .0155));
    rows.push(row('legacy_capacity_index', 'body', pieces, 'mag', lv.mag));
  } else if (lv.mag && id === 'rpg') {
    const pieces = [];
    for (let k = 0; k < lv.mag; k++) pieces.push(box([.0025, .028, .009], [-.049, .046, .271 + k * .019], 'metal'));
    rows.push(row('legacy_capacity_index', 'body', pieces, 'mag', lv.mag));
  }
  if (has('laser') && LASER_MOUNT[id]) {
    const p = LASER_MOUNT[id];
    rows.push(row('laser', 'body', [box([.019, .019, .048], p, 'polymer'),
      tube(.006, .008, [p[0], p[1], p[2] + .027]),
      tube(.0036, .0015, [p[0], p[1], p[2] + .0315], 'laser'),
      box([.013, .006, .020], [p[0] - .006, p[1] + .011, p[2] - .010], 'metal')]));
  }
  if (has('foregrip') && FOREGRIP[id]) {
    const p = FOREGRIP[id];
    // Low angled rail insert around the original support-hand seat. Keeping the
    // authored grip socket avoids a floating hand or changing reload choreography.
    rows.push(row('foregrip', id === 'shotgun' ? 'pump' : 'body', [
      // Positive overlap with the actual handguard underside closes the former
      // 5 mm daylight gap. The bridge shares the same body/pump owner and leaves
      // the established support-hand contact and moving reload sockets intact.
      box([.020, .018, .062], [p[0], p[1] - .003, p[2]], 'metal'),
      box([.025, .010, .071], [p[0], p[1] - .014, p[2]], 'metal'),
      box([.027, .024, .044], [p[0], p[1] - .024, p[2] - .008], 'rubber', [.35, 0, 0]),
      box([.028, .023, .013], [p[0], p[1] - .018, p[2] + .030], 'polymer', [-.45, 0, 0])]));
  }
  if (has('stock') && STOCK[id]) {
    const p = STOCK[id];
    rows.push(row('stock', 'body', [box([.048, .068, .019], [p[0], p[1], p[2] - .008], 'rubber'),
      box([.040, .016, .092], [p[0], p[1] + .041, p[2] + .050], 'polymer'),
      box([.008, .029, .040], [p[0] - .026, p[1], p[2] + .027], 'metal'),
      box([.008, .029, .040], [p[0] + .026, p[1], p[2] + .027], 'metal')]));
  }
  if (lv.dmg) {
    if (BARREL[id]) {
      const [x, y, z, r] = BARREL[id], pieces = [];
      for (let k = 0; k < lv.dmg; k++) pieces.push(tube(r + .003, .007, [x, y, z - k * .012], 'metal', 'z', r + .0005));
      rows.push(row('match_barrel_collars', 'body', pieces, 'dmg', lv.dmg));
    } else if (id === 'rpg') {
      rows.push(row('warhead_jacket', 'rocket', [tube(.0465, .019 + lv.dmg * .005, [0, .09, .656], 'metal', 'z', .0422)], 'dmg', lv.dmg));
    } else if (id === 'minigun') {
      const pieces = [];
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        pieces.push(tube(.034, .015 + lv.dmg * .008, [Math.cos(a) * .078, Math.sin(a) * .078, .735], 'metal', 'z', .0295));
      }
      rows.push(row('match_barrel_collars', 'gun_mg_barrels', pieces, 'dmg', lv.dmg));
    }
  }
  if (lv.rel) {
    if (bottom) {
      const p = bottom.p, w = bottom.size[0];
      rows.push(row('reload_pull_tab', 'mag', [box([w + .009, .007, .012 + lv.rel * .005], [p[0], p[1] - .016, p[2] - bottom.size[2] / 2 - .006], 'rubber')], 'rel', lv.rel));
    } else if (id === 'shotgun') {
      rows.push(row('loading_port_guide', 'body', [box([.008, .007 + lv.rel * .002, .059], [-.015, .009, .135], 'metal'),
        box([.008, .007 + lv.rel * .002, .059], [.015, .009, .135], 'metal')], 'rel', lv.rel));
    } else if (id === 'revolver') {
      rows.push(row('speedloader_release', 'crane', [box([.012, .011 + lv.rel * .003, .021], [-.030, .064, .075], 'polymer')], 'rel', lv.rel));
    } else if (id === 'rpg') {
      rows.push(row('rocket_loading_guide', 'body', [tube(.029 + lv.rel * .0005, .016, [0, .090, .516], 'metal', 'z', .023)], 'rel', lv.rel));
    }
  }
  if (lv.hnd && GRIP[id]) {
    const p = GRIP[id], pieces = [];
    if (id === 'minigun') {
      for (const x of [-.19, .19]) for (let k = 0; k < lv.hnd + 1; k++) pieces.push(box([.048, .009, .048], [x, p[1] - .023 + k * .018, p[2]], 'rubber'));
    } else {
      for (let k = 0; k < lv.hnd + 1; k++) pieces.push(box([.032, .005, .037], [p[0], p[1] - .020 + k * .014, p[2]], 'rubber', [.15, 0, 0]));
    }
    rows.push(row('grip_texture_bands', 'body', pieces, 'hnd', lv.hnd));
  }
  return Object.freeze(rows.map(entry => Object.freeze(entry)));
}

function primitive(piece) {
  let geometry;
  if (piece.kind === 'box') geometry = new THREE.BoxGeometry(...piece.size);
  else if (piece.inner > 0) {
    // Annular ends preserve the barrel bore. Standard cylinders would cap it.
    const shape = new THREE.Shape(); shape.absarc(0, 0, piece.r, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, piece.inner, 0, Math.PI * 2, true); shape.holes.push(hole);
    geometry = new THREE.ExtrudeGeometry(shape, { depth: piece.length, bevelEnabled: false, curveSegments: 8, steps: 1 });
    geometry.translate(0, 0, -piece.length / 2);
  } else {
    geometry = new THREE.CylinderGeometry(piece.r, piece.r, piece.length, 12, 1);
    geometry.rotateX(Math.PI / 2);
  }
  if (piece.axis === 'x') geometry.rotateY(Math.PI / 2);
  else if (piece.axis === 'y') geometry.rotateX(Math.PI / 2);
  if (piece.rot) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...piece.rot)));
  geometry.translate(...piece.p);
  // Extrusions are non-indexed, box/cylinder primitives are indexed. Normalize
  // before merging so a barrel collar cannot silently drop an entire assembly.
  if (geometry.index) { const flat = geometry.toNonIndexed(); geometry.dispose(); geometry = flat; }
  return geometry;
}

/** Attach once. Animated magazines, pump, rotor and rocket own their additions. */
export function attachWeaponModifications(weapon, levels = {}, attachments = []) {
  const plan = weaponAttachmentPlan(weapon.id, levels, attachments), buckets = new Map(), objects = [];
  const frame = weapon.pitchJoint || weapon.root;
  weapon.root.updateWorldMatrix(true, true);
  for (const assembly of plan) {
    const parent = weapon.nodes[assembly.parent] || (assembly.parent === 'body' ? frame : null);
    if (!parent) continue; // malformed asset may not float a magazine in space
    for (const piece of assembly.pieces) {
      const key = `${assembly.parent}:${piece.mat}`;
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { parent, pieces: [], names: new Set(), material: MATERIALS[piece.mat] }; buckets.set(key, bucket); }
      bucket.names.add(assembly.id); bucket.pieces.push(primitive(piece));
    }
  }
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.pieces, false);
    for (const piece of bucket.pieces) piece.dispose();
    if (!geometry) continue;
    const toParent = new THREE.Matrix4().copy(bucket.parent.matrixWorld).invert().multiply(frame.matrixWorld);
    geometry.applyMatrix4(toParent); geometry.clearGroups(); geometry.computeBoundingSphere(); geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry, bucket.material);
    mesh.name = 'weapon_mod_' + [...bucket.names].join('_');
    mesh.userData.weaponAttachments = [...bucket.names]; mesh.userData.weaponMod = true;
    mesh.castShadow = false; mesh.receiveShadow = false;
    bucket.parent.add(mesh); objects.push(mesh); weapon._ownedResources.push(geometry);
  }
  if (sanitizeWeaponAttachmentIds(weapon.id, attachments).includes('foregrip') && weapon.sockets.grip_L && FOREGRIP[weapon.id]) {
    const socket = weapon.sockets.grip_L, p = FOREGRIP[weapon.id];
    // The real support-hand socket follows the added angled grip. Its existing
    // parent (shotgun pump or static body) and hand orientation stay authored.
    const target = new THREE.Vector3(p[0], p[1] - .018, p[2] - .010);
    frame.localToWorld(target); socket.parent.worldToLocal(target); socket.position.copy(target);
    weapon.root.updateWorldMatrix(true, true);
  }
  if (weapon.attachmentIds?.includes('laser') || sanitizeWeaponAttachmentIds(weapon.id, attachments).includes('laser')) {
    const p = LASER_MOUNT[weapon.id];
    if (p) {
      const parent = weapon.nodes.body || frame, emitter = new THREE.Object3D(); emitter.name = 'laser_emitter';
      emitter.position.set(p[0], p[1], p[2] + .0315); frame.localToWorld(emitter.position); parent.worldToLocal(emitter.position);
      parent.add(emitter); weapon.sockets.laser_emitter = emitter;
    }
  }
  weapon.visualLevels = weaponVisualLevels(levels);
  weapon.attachmentIds = Object.freeze(sanitizeWeaponAttachmentIds(weapon.id, attachments));
  weapon.visualKey = weaponVisualKey(weapon.id, weapon.opticId, weapon.visualLevels, weapon.attachmentIds);
  return Object.freeze({ plan, objects });
}
