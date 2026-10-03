// Visible encounter actors follow the authoritative encounter system. No view
// timer can arm a hazard, deal damage, break a gate or move a falling body.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { plannedStageEncounters, stageBoatWaterCutBounds } from '../data/stage_encounters.js';
import { EDGE, seaLevel } from '../world/terrain_gen.js';
import { DS } from '../world/road.js';

// Authority retains rear threats to 240 m and can fire to 170 m. Rear-view
// gunners must still see those targets throughout their complete active life.
export const STAGE_ENCOUNTER_VIEW_LIMITS = Object.freeze({ ahead: 430, behind: 270, actors: 48, templates: 48, viaducts: 3 });
export const STAGE_ENCOUNTER_PALETTES = Object.freeze({
  desert: Object.freeze({ metal: 0x744331, trim: 0xcda566, stone: 0xb78355, cloth: 0x68422c, accent: 0xe7a92b }),
  canyon: Object.freeze({ metal: 0x774238, trim: 0xc7946a, stone: 0xa65336, cloth: 0x533c31, accent: 0xeaa035 }),
  coast: Object.freeze({ metal: 0x2b7474, trim: 0xc6b496, stone: 0x9b9d90, cloth: 0x315554, accent: 0x38c9c0 }),
  mountain: Object.freeze({ metal: 0x586776, trim: 0xe0e8e8, stone: 0x7f8994, cloth: 0x78818b, accent: 0x64bfe9 }),
  city: Object.freeze({ metal: 0x48525d, trim: 0xe1b837, stone: 0x848384, cloth: 0x343d4c, accent: 0x24bbd9 }),
  dam: Object.freeze({ metal: 0x3e586a, trim: 0xc9b470, stone: 0x8c969c, cloth: 0x3d5362, accent: 0x4db1d9 }),
  underground: Object.freeze({ metal: 0x414a4f, trim: 0xb38242, stone: 0x676968, cloth: 0x435657, accent: 0x3dd7dc }),
  sky: Object.freeze({ metal: 0x64518c, trim: 0xc8d7e9, stone: 0x9daccf, cloth: 0x494c7c, accent: 0x50e3ed }),
  hell: Object.freeze({ metal: 0x483237, trim: 0xba6539, stone: 0x3c3234, cloth: 0x57322e, accent: 0xff6728 }),
  space: Object.freeze({ metal: 0x46516d, trim: 0xd3d8e4, stone: 0x697286, cloth: 0x344261, accent: 0x42d4ed }),
});

const _matrix = new THREE.Matrix4(), _position = new THREE.Vector3(), _scale = new THREE.Vector3();
const _quaternion = new THREE.Quaternion(), _euler = new THREE.Euler(), _inverse = new THREE.Quaternion();
const _weak = new THREE.Vector3(), _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3(), _gunForward = new THREE.Vector3(0, 0, 1);
const finitePoint = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const finiteHalf = h => finitePoint(h) && h.x > 0 && h.y > 0 && h.z > 0 && h.x <= 100 && h.y <= 100 && h.z <= 100;
const terminal = actor => ['dead', 'broken'].includes(actor.status || actor.phase);
const styles = new Set(Object.keys(STAGE_ENCOUNTER_PALETTES));
const supportedKinds = new Set(['gate', 'rock', 'tower', 'rifleman', 'arch', 'drone', 'boat', 'barrel', 'vent']);

// Primitive inputs are owned by the view. Baked templates share buffers between
// actors; retirement drops references and the bounded cache releases idle ones.
function primitives() {
  const unpack = geometry => {
    if (!geometry.index) return geometry;
    const result = geometry.toNonIndexed(); geometry.dispose(); return result;
  };
  const rock = unpack(new THREE.IcosahedronGeometry(1, 1));
  const p = rock.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = .89 + .11 * Math.sin(x * 13.1 + y * 8.7 + z * 17.9);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  rock.computeVertexNormals(); rock.computeBoundingBox();
  const box = rock.boundingBox;
  const size = new THREE.Vector3(), center = new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  rock.translate(-center.x, -center.y, -center.z);
  rock.scale(2 / size.x, 2 / size.y, 2 / size.z);
  const cone = unpack(new THREE.ConeGeometry(1, 1, 8));
  const sphere = unpack(new THREE.SphereGeometry(1, 10, 6));
  const cylinder = unpack(new THREE.CylinderGeometry(1, 1, 1, 10));
  const ring = unpack(new THREE.TorusGeometry(1, .045, 4, 24));
  // A pointed bow, flared sides and a flat transom make an actual boat silhouette.
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute([
    0, .6, 1, -1, .45, .25, 1, .45, .25,
    -1, .45, .25, -.92, .5, -1, .92, .5, -1, -1, .45, .25, .92, .5, -1, 1, .45, .25,
    0, -.8, .8, -.68, -.8, -.85, .68, -.8, -.85,
    0, .6, 1, 0, -.8, .8, -1, .45, .25,
    -1, .45, .25, 0, -.8, .8, -.68, -.8, -.85, -1, .45, .25, -.68, -.8, -.85, -.92, .5, -1,
    0, .6, 1, 1, .45, .25, 0, -.8, .8,
    1, .45, .25, .68, -.8, -.85, 0, -.8, .8, 1, .45, .25, .92, .5, -1, .68, -.8, -.85,
    -.92, .5, -1, -.68, -.8, -.85, .68, -.8, -.85, -.92, .5, -1, .68, -.8, -.85, .92, .5, -1,
  ], 3));
  // Face every triangle away from the hull interior; top and sloped sides must
  // remain visible with ordinary single-sided materials.
  const hp = hull.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), centerDirection = new THREE.Vector3();
  for (let i = 0; i < hp.count; i += 3) {
    a.fromBufferAttribute(hp, i); b.fromBufferAttribute(hp, i + 1); c.fromBufferAttribute(hp, i + 2);
    n.subVectors(b, a).cross(_position.subVectors(c, a));
    centerDirection.copy(a).add(b).add(c).multiplyScalar(1 / 3); centerDirection.y += .15; centerDirection.z += .1;
    if (n.dot(centerDirection) < 0) { hp.setXYZ(i + 1, c.x, c.y, c.z); hp.setXYZ(i + 2, b.x, b.y, b.z); }
  }
  hull.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(hull.attributes.position.count * 2), 2));
  hull.computeVertexNormals();
  return { box: unpack(new THREE.BoxGeometry(1, 1, 1)), cylinder, sphere, cone, ring, rock, hull };
}

class Batcher {
  constructor(view) { this.view = view; this.parts = new Map(); }
  add(shape, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const geometry = this.view.geometry[shape].clone();
    _position.set(x, y, z); _scale.set(sx, sy, sz);
    _quaternion.setFromEuler(_euler.set(rx, ry, rz));
    geometry.applyMatrix4(_matrix.compose(_position, _quaternion, _scale));
    let list = this.parts.get(material); if (!list) this.parts.set(material, list = []);
    list.push(geometry);
  }
  geometry(geometry, material) {
    let list = this.parts.get(material); if (!list) this.parts.set(material, list = []);
    list.push(geometry);
  }
  finish(name = 'body') {
    const group = new THREE.Group(); group.name = name;
    for (const [material, parts] of this.parts) {
      const geometry = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.parts.clear(); return group;
  }
}

export class StageEncountersView {
  constructor(scene, road = null) {
    this.scene = scene; this.group = new THREE.Group(); this.group.name = 'stage_encounters'; scene.add(this.group);
    this.geometry = primitives(); this.materials = new Map(); this.templates = new Map(); this.actors = new Map();
    this.disposed = false; this.clock = 0; this.wanted = new Set();
    this.road = road; this.viaducts = new Map(); this.viaductWant = new Set();
    this.waterCuts = road ? plannedStageEncounters(road).map(stageBoatWaterCutBounds).filter(Boolean) : [];
  }

  _materials(biome) {
    if (this.materials.has(biome)) return this.materials.get(biome);
    const p = STAGE_ENCOUNTER_PALETTES[biome];
    const standard = (color, metalness = .2, roughness = .78) => new THREE.MeshStandardMaterial({ color, metalness, roughness });
    const luminous = color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .7, roughness: .5 });
    const m = {
      metal: standard(p.metal, .6, .66), trim: standard(p.trim, .4), stone: standard(p.stone, 0, 1),
      cloth: standard(p.cloth, 0, 1), dark: standard(0x171b20, .45), skin: standard(0xa57b57, 0, .95),
      charred: standard(0x242326, .15, 1), ash: standard(0x55514d, 0, 1),
      accent: luminous(p.accent), red: luminous(0xdf3326), yellow: luminous(0xf4c72b), green: luminous(0x36db75),
      warning: new THREE.MeshBasicMaterial({ color: 0xf1b843, transparent: true, opacity: .72, depthWrite: false, side: THREE.DoubleSide }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x36291c, transparent: true, opacity: .24, depthWrite: false }),
      wake: new THREE.MeshBasicMaterial({ color: 0xc5eeed, transparent: true, opacity: .36, depthWrite: false, side: THREE.DoubleSide }),
      steam: new THREE.MeshStandardMaterial({ color: biome === 'hell' ? 0xff783d : 0xe0ebec, emissive: biome === 'hell' ? 0xaa2a05 : 0x13272b,
        emissiveIntensity: .2, transparent: true, opacity: .3, depthWrite: false, roughness: 1 }),
    };
    this.materials.set(biome, m); return m;
  }

  _template(actor, biome) {
    const h = actor.half, key = `${actor.kind}:${biome}:${h.x}:${h.y}:${h.z}`;
    let entry = this.templates.get(key);
    if (entry) { entry.refs++; return entry; }
    const m = this._materials(biome), batch = new Batcher(this), hx = h.x, hy = h.y, hz = h.z;
    const b = (...v) => batch.add(...v);
    switch (actor.kind) {
      case 'gate': {
        b('box', m.metal, 0, 0, 0, hx * 2, hy * 2, hz * 2);
        for (let y = -1; y <= 1; y++) b('box', m.trim, 0, y * hy * .65, -hz - .035, hx * 1.9, .12, .09);
        for (const x of [-.72, .72]) b('box', m.dark, x * hx, 0, -hz - .08, .14, hy * 1.8, .08);
        for (let x = -2; x <= 2; x++) b('box', m.yellow, x * hx * .33, -hy * .76, -hz - .08, hx * .19, .28, .05, 0, 0, -.55);
        break;
      }
      case 'rock':
        b('rock', m.stone, 0, 0, 0, hx, hy, hz);
        b('rock', m.trim, -hx * .27, hy * .25, -hz * .25, hx * .3, hy * .15, hz * .38);
        if (biome === 'hell') b('rock', m.accent, hx * .16, -hy * .04, -hz * .83, hx * .16, hy * .33, hz * .11);
        break;
      case 'tower': {
        b('box', m.stone, 0, -hy * .85, 0, hx * 2, hy * .3, hz * 2);
        const inset = .74;
        for (const x of [-1, 1]) for (const z of [-1, 1]) b('box', m.metal, x * hx * inset, 0, z * hz * inset, .24, hy * 1.76, .24);
        for (const y of [-.45, .35]) {
          b('box', m.trim, 0, y * hy, -hz * inset, hx * 1.5, .13, .13);
          b('box', m.trim, 0, y * hy, hz * inset, hx * 1.5, .13, .13);
          for (const x of [-1, 1]) b('box', m.trim, x * hx * inset, y * hy, 0, .13, .13, hz * 1.5);
        }
        for (const x of [-1, 1]) b('box', m.metal, x * hx * inset, 0, 0, .13, hy * 1.7, .15, .24 * x);
        b('box', m.metal, 0, hy * .74, 0, hx * 2, .22, hz * 2);
        b('box', m.stone, 0, hy * .88, -hz * .84, hx * 1.9, hy * .22, .36);
        for (const x of [-1, 1]) b('box', m.trim, x * hx * .9, hy * .94, 0, .1, .34, hz * 1.9);
        // A readable crew head and shoulders sit behind the gun parapet.
        b('box', m.metal, 0, hy + .12, -.1, .58, .52, .32);
        b('sphere', m.trim, 0, hy + .5, -.08, .19, .22, .19);
        b('sphere', m.dark, 0, hy + .62, -.1, .23, .16, .23);
        b('box', m.accent, -hx * .75, hy * .97, -hz * .92, .22, .2, .1);
        break;
      }
      case 'rifleman': {
        const sy = hy * .95, waist = -.15 * sy;
        b('box', m.cloth, 0, .18 * sy, 0, hx * 1.28, .8 * sy, hz * 1.03);
        for (const x of [-1, 1]) {
          b('box', m.cloth, x * hx * .37, -.57 * sy, 0, hx * .48, .77 * sy, hz * .75, 0, 0, -.08 * x);
          b('box', m.dark, x * hx * .42, -.91 * sy, hz * .24, hx * .56, .19 * sy, hz * 1.15);
          b('box', m.skin, x * hx * .69, .23 * sy, hz * .22, hx * .3, .39 * sy, hz * .34, -.45, 0, .25 * x);
        }
        b('box', m.trim, 0, waist, -hz * .56, hx * 1.4, .09 * sy, .07);
        b('sphere', m.skin, 0, .77 * sy, 0, hx * .5, .22 * sy, hz * .56);
        b('sphere', m.dark, 0, .91 * sy, -.02, hx * .62, .14 * sy, hz * .65);
        b('box', m.dark, 0, .72 * sy, hz * .51, hx * .88, .11 * sy, .035);
        break;
      }
      case 'arch': {
        b('box', m.stone, 0, 0, 0, hx * 2, hy * 2, hz * 2);
        for (let x = -4; x <= 4; x++) b('box', m.trim, x * hx * .205, -hy * .48, -hz - .025, hx * .19, hy * .5, .055);
        for (let x = -4; x <= 4; x++) b('box', m.dark, x * hx * .205, 0, -hz - .012, .055, hy * 1.75, .04);
        break;
      }
      case 'drone': {
        b('box', m.metal, 0, 0, 0, hx * .9, hy * 1.6, hz * 1.25);
        b('sphere', m.dark, 0, -.12 * hy, hz * .56, hx * .32, hy * .58, hz * .28);
        b('box', m.accent, 0, -.12 * hy, hz * .77, hx * .27, hy * .23, .06);
        for (const x of [-1, 1]) for (const z of [-1, 1]) {
          b('box', m.trim, x * hx * .49, .12 * hy, z * hz * .5, hx * .9, .09, .11, 0, -.45 * x * z);
          b('cylinder', m.dark, x * hx * .76, .25 * hy, z * hz * .7, hx * .17, hy * .5, hx * .17);
        }
        for (const x of [-1, 1]) b('box', m.metal, x * hx * .33, -hy * .72, 0, .06, .1, hz * 1.13);
        break;
      }
      case 'boat':
        b('hull', m.metal, 0, -hy * .12, 0, hx, hy, hz);
        b('box', m.trim, 0, hy * .48, -hz * .21, hx * 1.66, .1, hz * 1.3);
        b('box', m.dark, 0, hy * .83, -hz * .38, hx * .94, hy * .65, hz * .45);
        b('box', m.accent, 0, hy * .98, -hz * .14, hx * .72, hy * .26, .04);
        for (const x of [-1, 1]) {
          b('box', m.trim, x * hx * .88, hy * .59, -hz * .26, .08, .1, hz * 1.33);
          b('box', m.dark, x * hx * .67, -hy * .1, -hz * .93, hx * .3, hy * .75, hz * .24);
        }
        break;
      case 'barrel':
        b('cylinder', m.metal, 0, 0, 0, hx, hy * 2, hz);
        for (const y of [-.76, .76]) b('cylinder', m.dark, 0, y * hy, 0, hx * 1.035, .07, hz * 1.035);
        b('box', m.yellow, 0, .08 * hy, -hz - .02, hx * 1.1, hy * .69, .045);
        b('box', m.red, 0, .08 * hy, -hz - .047, hx * .46, hy * .42, .045, 0, 0, Math.PI / 4);
        break;
      case 'vent':
        b('cylinder', m.metal, 0, -hy * .45, 0, hx, hy, hz);
        b('cylinder', m.dark, 0, .07 * hy, 0, hx * .77, .12, hz * .77);
        for (let x = -2; x <= 2; x++) b('box', m.trim, x * hx * .27, .15 * hy, 0, .09, .09, hz * 1.3);
        for (const x of [-1, 1]) b('box', m.yellow, x * hx * .8, -.04 * hy, 0, .12, .12, hz * 1.2);
        break;
      default: break;
    }
    const body = batch.finish();
    entry = { key, body, refs: 1 }; this.templates.set(key, entry); this._trimCache(); return entry;
  }

  _trimCache() {
    for (const [key, entry] of this.templates) {
      if (this.templates.size <= STAGE_ENCOUNTER_VIEW_LIMITS.templates) break;
      if (!entry.refs) { this._disposeTemplate(entry); this.templates.delete(key); }
    }
  }

  _disposeTemplate(entry) {
    entry.body.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    entry.wreck?.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }

  _wreckTemplate(actor, entry) {
    if (entry.wreck) return entry.wreck;
    const biome = styles.has(actor.biome) ? actor.biome : 'desert', m = this._materials(biome);
    const batch = new Batcher(this), h = actor.half;
    if (actor.kind === 'rifleman') {
      // Bake an immediately fallen corpse into its own buffer. Shared healthy
      // geometry is never rotated, recolored or edited by a terminal actor.
      const parts = entry.body.children.map(mesh => mesh.geometry);
      const geometry = mergeGeometries(parts, false);
      geometry.rotateX(Math.PI / 2);
      const body = new THREE.Group(); body.name = 'fallen_rifleman';
      const mesh = new THREE.Mesh(geometry, m.charred); mesh.castShadow = true; mesh.receiveShadow = true; body.add(mesh);
      entry.wreck = body; return body;
    }
    if (actor.kind === 'tower') {
      batch.add('box', m.ash, 0, -.05, 0, h.x * 1.8, .35, h.z * 1.8);
      for (let i = 0; i < 5; i++) {
        batch.add('box', m.charred, (i % 3 - 1) * h.x * .45, .16 + i * .06, (i % 2 ? 1 : -1) * h.z * .35,
          .18, h.y * .72, .2, Math.PI / 2, i * .69, .12 * (i - 2));
      }
      batch.add('box', m.charred, h.x * .2, .16, h.z * .2, h.x * 1.5, .14, h.z * 1.2, .1, .25, .06);
    } else if (actor.kind === 'drone') {
      batch.add('box', m.charred, 0, 0, 0, h.x * .75, h.y * .85, h.z * 1.15, .08, .18, -.13);
      for (const x of [-1, 1]) batch.add('box', m.ash, x * h.x * .49, -.06, x * h.z * .23, h.x * .84, .08, .1, 0, -.65 * x, .1 * x);
      batch.add('sphere', m.charred, h.x * .51, -.03, -h.z * .55, h.x * .13, h.y * .25, h.x * .13);
    } else if (actor.kind === 'boat') {
      batch.add('hull', m.charred, 0, -h.y * .18, 0, h.x, h.y, h.z, .04, 0, .11);
      batch.add('box', m.ash, 0, h.y * .21, -h.z * .3, h.x * 1.5, .11, h.z * 1.07, .02, .06, .13);
      batch.add('box', m.charred, h.x * .21, h.y * .43, -h.z * .48, h.x * .83, h.y * .3, h.z * .4, .14, -.11, -.16);
    }
    entry.wreck = batch.finish(`wrecked_${actor.kind}`); return entry.wreck;
  }

  _create(actor) {
    const biome = styles.has(actor.biome) ? actor.biome : 'desert', material = this._materials(biome);
    const template = this._template(actor, biome), group = new THREE.Group();
    group.name = `encounter_${actor.kind}_${actor.id}`; group.userData.actorId = actor.id;
    const body = template.body.clone(); group.add(body);
    const record = { group, body, wreck: null, template, kind: actor.kind, rotors: [], rotorMesh: null, weakpoint: null, gun: null, tell: null, warning: null, dust: null, plume: null, legs: null, gap: null, wake: null };
    if (actor.kind === 'gate') {
      const batch = new Batcher(this);
      for (const x of [-1, 1]) {
        batch.add('box', material.trim, x * actor.half.x, 0, 0, .12, actor.half.y * 2, .18);
        batch.add('box', material.green, x * actor.half.x, actor.half.y * .75, -.17, .18, .28, .1);
      }
      const gap = batch.finish('cleared_gate_edges');
      gap.traverse(o => { if (o.isMesh) { o.userData.encounterOwnedGeometry = true; o.castShadow = false; } });
      gap.visible = false; group.add(gap); record.gap = gap;
    }
    if (actor.kind === 'arch') {
      const legs = new THREE.Group(); legs.name = 'arch_supports';
      // Fixed supports are 7.2 m high; the authority removes them on collapse.
      for (const x of [-1, 1]) {
        const leg = new THREE.Mesh(this.geometry.box, material.stone);
        leg.scale.set(1.3, 7.2, actor.half.z * 2); leg.position.set(x * 8, -3.6, 0); leg.castShadow = true; leg.receiveShadow = true; legs.add(leg);
      }
      group.add(legs); record.legs = legs;
    }
    if (actor.weakpoint) {
      const batch = new Batcher(this);
      // Entire visible canister, including cap and bands, fits the authoritative
      // target sphere. Its corners never promise a hit outside that sphere.
      batch.add('cylinder', material.red, 0, 0, 0, .64, 1.44, .64);
      for (const y of [-.6, .6]) batch.add('cylinder', material.yellow, 0, y, 0, .69, .15, .69);
      batch.add('box', material.dark, 0, .83, 0, .27, .12, .28);
      const weakpoint = batch.finish('shootable_red_canister');
      weakpoint.traverse(o => { if (o.isMesh) o.userData.encounterOwnedGeometry = true; });
      group.add(weakpoint); record.weakpoint = weakpoint;
    }
    if (actor.kind === 'drone') {
      const blades = new THREE.InstancedMesh(this.geometry.box, material.dark, 4);
      blades.name = 'rotor_blades'; blades.castShadow = false; blades.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (const x of [-1, 1]) for (const z of [-1, 1]) {
        const rotor = new THREE.Object3D();
        rotor.name = 'rotor'; rotor.scale.set(actor.half.x * .62, .025, .08);
        rotor.position.set(x * actor.half.x * .76, actor.half.y * .53, z * actor.half.z * .7);
        rotor.updateMatrix(); blades.setMatrixAt(record.rotors.length, rotor.matrix);
        group.add(rotor); record.rotors.push(rotor);
      }
      // A full rotation fits this stable bound; no frame can cull a rotor only
      // because its long blade has turned beyond the initial pose's AABB.
      blades.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, actor.half.y * .53, 0),
        Math.hypot(actor.half.x * .76, actor.half.z * .7) + actor.half.x * .31 + .1);
      group.add(blades); record.rotorMesh = blades;
    }
    if (actor.kind === 'tower' || actor.kind === 'rifleman' || actor.kind === 'drone' || actor.kind === 'boat') {
      const batch = new Batcher(this);
      batch.add('cylinder', material.dark, 0, 0, -.4, .055, .8, .055, Math.PI / 2);
      batch.add('box', material.metal, 0, -.01, -.77, .16, .18, .36);
      batch.add('box', material.dark, 0, -.16, -.69, .12, .23, .16);
      const gun = batch.finish('encounter_weapon');
      gun.traverse(o => { if (o.isMesh) o.userData.encounterOwnedGeometry = true; });
      const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; gun.add(muzzle);
      // The authority's one-second aiming phase gets a short visible red beam.
      // It ends at the muzzle and follows the actual firing direction.
      const tell = new THREE.Mesh(this.geometry.cylinder, material.red);
      tell.name = 'enemy_aim_tell'; tell.scale.set(.018, 7, .018); tell.rotation.x = Math.PI / 2; tell.position.z = 3.5;
      tell.castShadow = false; tell.receiveShadow = false; tell.visible = false; gun.add(tell); record.tell = tell;
      group.add(gun); record.gun = gun;
    }
    if (actor.kind === 'rock' || actor.kind === 'vent') {
      const warning = new THREE.Group(); warning.name = 'impact_warning_ring';
      const ring = new THREE.Mesh(this.geometry.ring, material.warning);
      ring.rotation.x = -Math.PI / 2; ring.scale.set(actor.half.x * 1.45, actor.half.z * 1.45, 1); warning.add(ring);
      const shadow = new THREE.Mesh(this.geometry.cylinder, material.shadow);
      shadow.scale.set(actor.half.x, .015, actor.half.z); shadow.position.y = -.025; warning.add(shadow);
      // Small loose fragments at the impact zone accompany the ground shadow;
      // the large rock's descent itself always comes from authority.
      const batch = new Batcher(this);
      for (let k = 0; k < 4; k++) {
        const angle = k * Math.PI / 2;
        batch.add('rock', material.stone, Math.cos(angle) * actor.half.x * 1.12, .12, Math.sin(angle) * actor.half.z * 1.12, .19, .12, .18);
      }
      const dust = batch.finish('loose_warning_fragments');
      dust.traverse(o => { if (o.isMesh) { o.castShadow = false; o.userData.encounterOwnedGeometry = true; } });
      warning.add(dust); record.dust = dust;
      warning.traverse(o => { if (o.isMesh) o.castShadow = false; });
      this.group.add(warning); record.warning = warning;
    }
    if (actor.kind === 'boat') {
      const wake = new THREE.Group(); wake.name = 'boat_wake';
      for (const x of [-1, 1]) {
        const strip = new THREE.Mesh(this.geometry.box, material.wake);
        strip.scale.set(.16, .03, actor.half.z * 1.5); strip.position.set(x * actor.half.x * .7, -.15, -actor.half.z * 1.5); strip.rotation.y = x * .25; wake.add(strip);
      }
      group.add(wake); record.wake = wake;
    }
    if (actor.kind === 'vent') {
      const batch = new Batcher(this);
      for (let k = 0; k < 4; k++) {
        const spread = .68 + k * .09;
        batch.add('sphere', material.steam, Math.sin(k * 2) * actor.half.x * .13, .52 + k * .63, Math.cos(k * 3) * actor.half.z * .13,
          actor.half.x * spread, .46, actor.half.z * spread);
      }
      const plume = batch.finish('damaging_vent_plume');
      plume.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.userData.encounterOwnedGeometry = true; } });
      plume.visible = false; group.add(plume); record.plume = plume;
    }
    this.group.add(group); this.actors.set(actor.id, record); return record;
  }

  _retire(id, record) {
    record.group.traverse(o => { if (o.isMesh && o.userData.encounterOwnedGeometry) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    record.warning?.traverse(o => { if (o.isMesh && o.userData.encounterOwnedGeometry) o.geometry.dispose(); });
    record.group.removeFromParent(); record.warning?.removeFromParent();
    record.template.refs--; this.actors.delete(id); this._trimCache();
  }

  _viaduct(cut) {
    const road = this.road, sea = seaLevel(road, cut.biome), m = this._materials(cut.biome), batch = new Batcher(this);
    const anchor = road.pointAt(cut.start, 0, {}), topSamples = [];
    const localPoint = (s, d, lower) => {
      const p = road.pointAt(s, d, {});
      return [p.x - anchor.x, lower === null ? p.y - .18 - anchor.y : lower - anchor.y, p.z - anchor.z];
    };
    // A closed, thin retaining face sits entirely inland of the paved seam.
    // Its top samples the exact banked road edge; it cannot become a new rail
    // above the asphalt or cover the gunner's downwards line toward boats.
    for (let start = cut.start; start < cut.end; start += DS) {
      const end = Math.min(cut.end, start + DS), outer = cut.side * (EDGE - .03), inner = cut.side * (EDGE - .19);
      const v = [localPoint(start, outer, null), localPoint(end, outer, null), localPoint(start, inner, null), localPoint(end, inner, null),
        localPoint(start, outer, sea - 1), localPoint(end, outer, sea - 1), localPoint(start, inner, sea - 1), localPoint(end, inner, sea - 1)];
      topSamples.push({ s: start, y: v[0][1] + anchor.y, d: outer }, { s: end, y: v[1][1] + anchor.y, d: outer });
      const faces = [[0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6], [0, 4, 6, 2], [1, 3, 7, 5]], vertices = [];
      const center = new THREE.Vector3(); for (const point of v) center.add(new THREE.Vector3(...point)); center.multiplyScalar(1 / 8);
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3(), direction = new THREE.Vector3();
      for (const face of faces) for (const index of [[face[0], face[1], face[2]], [face[0], face[2], face[3]]]) {
        a.fromArray(v[index[0]]); b.fromArray(v[index[1]]); c.fromArray(v[index[2]]);
        normal.subVectors(b, a).cross(_position.subVectors(c, a)); direction.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(center);
        const indices = normal.dot(direction) < 0 ? [index[0], index[2], index[1]] : index;
        for (const i of indices) vertices.push(...v[i]);
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(vertices.length / 3 * 2), 2)); geometry.computeVertexNormals(); batch.geometry(geometry, m.stone);
    }
    // Piers and transverse beams explain the road's load path, without adding
    // colliders or changing its existing pavement and guardrails.
    for (let s = cut.start + 18; s < cut.end; s += 36) {
      const p = road.pointAt(s, cut.side * (EDGE - .7), {}), top = p.y - .65, bottom = sea - 3;
      if (top > bottom + .5) {
        batch.add('box', m.stone, p.x - anchor.x, (top + bottom) / 2 - anchor.y, p.z - anchor.z, .75, top - bottom, 1.25, 0, p.th);
        const beam = road.pointAt(s, cut.side * (EDGE * .48), {});
        batch.add('box', m.metal, beam.x - anchor.x, Math.min(p.y, beam.y) - .88 - anchor.y, beam.z - anchor.z, EDGE, .38, 1.35, 0, beam.th);
      }
    }
    const group = batch.finish('waterside_viaduct'); group.position.set(anchor.x, anchor.y, anchor.z);
    group.userData.siteId = cut.id; group.userData.topSamples = topSamples; group.userData.waterY = sea;
    this.group.add(group); return group;
  }

  _updateViaducts(playerS) {
    const wanted = this.viaductWant; wanted.clear();
    for (const cut of this.waterCuts) {
      if (cut.end < playerS - STAGE_ENCOUNTER_VIEW_LIMITS.behind || cut.start > playerS + STAGE_ENCOUNTER_VIEW_LIMITS.ahead) continue;
      if (wanted.size >= STAGE_ENCOUNTER_VIEW_LIMITS.viaducts) break;
      wanted.add(cut.id); if (!this.viaducts.has(cut.id)) this.viaducts.set(cut.id, this._viaduct(cut));
    }
    for (const [id, group] of this.viaducts) if (!wanted.has(id)) {
      group.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); group.removeFromParent(); this.viaducts.delete(id);
    }
  }

  update(dt, system, playerS = 0) {
    if (this.disposed) return;
    this.clock += Number.isFinite(dt) ? Math.max(0, Math.min(dt, .1)) : 0;
    if (this.road) this._updateViaducts(playerS);
    const entities = system instanceof Map ? system : system?.entities;
    const wanted = this.wanted; wanted.clear();
    if (entities?.values) for (const actor of entities.values()) {
      if (!actor || !Number.isSafeInteger(actor.id) || actor.id < 0 || !supportedKinds.has(actor.kind) || !finitePoint(actor.pos) || !finiteHalf(actor.half)) continue;
      if (Number.isFinite(actor.s) && (actor.s < playerS - STAGE_ENCOUNTER_VIEW_LIMITS.behind || actor.s > playerS + STAGE_ENCOUNTER_VIEW_LIMITS.ahead)) continue;
      if (wanted.size >= STAGE_ENCOUNTER_VIEW_LIMITS.actors) break;
      wanted.add(actor.id);
      let record = this.actors.get(actor.id);
      const biome = styles.has(actor.biome) ? actor.biome : 'desert';
      const key = `${actor.kind}:${biome}:${actor.half.x}:${actor.half.y}:${actor.half.z}`;
      if (record && record.template.key !== key) { this._retire(actor.id, record); record = null; }
      if (!record) record = this._create(actor);
      const group = record.group; group.position.copy(actor.pos);
      if (actor.quat && [actor.quat.x, actor.quat.y, actor.quat.z, actor.quat.w].every(Number.isFinite)) group.quaternion.copy(actor.quat);
      else group.rotation.set(0, Number.isFinite(actor.yaw) ? actor.yaw : 0, 0);
      const stopped = terminal(actor), phase = actor.status || actor.phase;
      const wreckedShooter = stopped && ['tower', 'rifleman', 'drone', 'boat'].includes(actor.kind);
      record.body.visible = !((actor.kind === 'gate' || actor.kind === 'barrel') && stopped) && !wreckedShooter;
      if (wreckedShooter && !record.wreck) {
        record.wreck = this._wreckTemplate(actor, record.template).clone(); group.add(record.wreck);
      }
      if (record.wreck) {
        record.wreck.visible = wreckedShooter;
        if (wreckedShooter) {
          // Static end-state debris follows authoritative ground/water height.
          // It cannot create new collision, damage or independently timed falls.
          const ground = Number.isFinite(actor.groundY) ? actor.groundY : actor.pos.y;
          const offset = actor.kind === 'boat' ? .1 : actor.kind === 'rifleman' ? actor.half.x * .7 : .24;
          _weak.set(actor.pos.x, ground + offset, actor.pos.z).sub(actor.pos).applyQuaternion(_inverse.copy(group.quaternion).invert());
          record.wreck.position.copy(_weak);
        }
      }
      if (record.gap) record.gap.visible = stopped;
      if (record.legs) record.legs.visible = phase === 'armed';
      _inverse.copy(group.quaternion).invert();
      if (record.weakpoint) {
        const point = actor.weakpoint;
        record.weakpoint.visible = !stopped && phase !== 'falling' && phase !== 'rubble' && finitePoint(point?.pos) && Number.isFinite(point?.radius) && point.radius > 0;
        if (record.weakpoint.visible) {
          _weak.copy(point.pos).sub(actor.pos).applyQuaternion(_inverse);
          record.weakpoint.position.copy(_weak); record.weakpoint.scale.setScalar(point.radius);
        }
      }
      if (record.gun) {
        record.gun.visible = !stopped && finitePoint(actor.muzzle);
        if (record.gun.visible) {
          _muzzle.copy(actor.muzzle).sub(actor.pos).applyQuaternion(_inverse); record.gun.position.copy(_muzzle);
          if (finitePoint(actor.aimDir) && (actor.aimDir.x ** 2 + actor.aimDir.y ** 2 + actor.aimDir.z ** 2) > 1e-8) {
            _aim.copy(actor.aimDir).applyQuaternion(_inverse).normalize(); record.gun.quaternion.setFromUnitVectors(_gunForward, _aim);
          } else record.gun.quaternion.identity();
        }
        if (record.tell) record.tell.visible = record.gun.visible && actor.firePhase > 0;
      }
      if (record.rotorMesh) record.rotorMesh.visible = !stopped;
      if (record.rotorMesh && !stopped) {
        for (let i = 0; i < record.rotors.length; i++) {
          const rotor = record.rotors[i]; rotor.rotation.y = this.clock * 48; rotor.updateMatrix(); record.rotorMesh.setMatrixAt(i, rotor.matrix);
        }
        record.rotorMesh.instanceMatrix.needsUpdate = true;
      }
      if (record.warning) {
        record.warning.visible = Number.isFinite(actor.groundY) && (phase === 'armed' || phase === 'falling');
        if (record.warning.visible) record.warning.position.set(actor.pos.x, actor.groundY + .055, actor.pos.z);
        if (record.dust) record.dust.position.y = phase === 'falling' ? .05 * Math.sin(this.clock * 17) : 0;
      }
      if (record.wake) record.wake.visible = !stopped;
      if (record.plume) {
        record.plume.visible = !stopped && actor.firePhase > 0;
        if (record.plume.visible) record.plume.scale.y = .75 + .25 * Math.min(1, actor.firePhase / .85);
      }
    }
    for (const [id, record] of this.actors) if (!wanted.has(id)) this._retire(id, record);
  }

  /** Scene prewarming can gather these standard materials without spawning sites. */
  warmMaterials() {
    const result = new Set();
    if (this.disposed) return result;
    for (const biome of styles) for (const material of Object.values(this._materials(biome))) result.add(material);
    return result;
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const [id, record] of this.actors) this._retire(id, record);
    for (const template of this.templates.values()) this._disposeTemplate(template);
    this.templates.clear();
    for (const group of this.viaducts.values()) { group.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); group.removeFromParent(); }
    this.viaducts.clear(); this.viaductWant.clear();
    for (const geometry of Object.values(this.geometry)) geometry.dispose();
    for (const material of this.materials.values()) for (const item of Object.values(material)) item.dispose();
    this.materials.clear(); this.group.removeFromParent();
    this.wanted.clear();
  }
}
