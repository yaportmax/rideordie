import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadWeaponAssets, THREE, Assets } from './helpers/weapon-assets.mjs';
import { CrewView } from '../src/view/crew_view.js';
import { disposeOwnedSkeletons } from '../src/view/owned_skeletons.js';

// Actual shipped rigs and the production CrewView. Only browser image decoding
// is stubbed by the existing helper and the local extra-asset preload below.
// No transformed reference CrewView, renderer, browser or synthetic rig is used.
await loadWeaponAssets();

async function loadAdditionalCrewAssets() {
  const old = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self,
    createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
  globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
  globalThis.Request = class extends old.Request {
    constructor(url, opts) { super(typeof url === 'string' && url.startsWith('/') ? 'http://vest-crew-test.local' + url : url, opts); }
  };
  globalThis.fetch = async request => {
    const url = new URL(typeof request === 'string' ? request : request.url);
    if (url.origin !== 'http://vest-crew-test.local') return old.fetch(request);
    return new Response(readFileSync(new URL('../public' + url.pathname, import.meta.url)), { headers: { 'Content-Type': 'application/octet-stream' } });
  };
  try { await Assets.preload(['/models/characters/hero_driver.glb', '/models/characters/raider_a.glb']); }
  finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
}
await loadAdditionalCrewAssets();

const HERO_URL = '/models/characters/hero_gunner.glb';
const VESTS = ['armor_t1', 'armor_t2', 'armor_t3'];
const BASE_MESHES = ['body', 'hair', 'eyes'];
const SOCKETS_AND_BONES = ['Head', 'RightHand', 'LeftHand', 'socket_head', 'socket_hand_R', 'socket_hand_L'];
const below = (node, root) => { for (let current = node; current; current = current.parent) if (current === root) return true; return false; };
// Never give assert a cyclic Three graph or a large geometry/clip array to
// format on failure. Preserve exact identity, with a finite scalar diagnostic.
const same = (actual, expected, label) => assert.ok(actual === expected, label);
const different = (actual, expected, label) => assert.ok(actual !== expected, label);
function authoredMesh(model, url, name) {
  const source = Assets.template(url)?.getObjectByName(name);
  assert.ok(source?.isSkinnedMesh, `${url}/${name}: authored skinned mesh exists`);
  const matches = [];
  model.traverse(node => {
    if (node.isSkinnedMesh && node.name === name && node.geometry === source.geometry) matches.push(node);
  });
  assert.equal(matches.length, 1, `${url}/${name}: exactly one authored clone mesh remains`);
  // A held weapon enters this model's bone subtree after _mount('R'/'L'). Its
  // own named body must never be mistaken for the authored character body.
  return matches[0];
}
function skeletons(root) {
  const result = new Set(); root.traverse(node => { if (node.isSkinnedMesh) result.add(node.skeleton); }); return result;
}
function visibility(root) {
  const result = []; root.traverse(node => result.push({ name: node.name, visible: node.visible, parent: node === root ? null : node.parent?.name ?? null })); return result;
}
function fixture(t, options = {}) {
  const crew = new CrewView('hero_gunner', { role: 'gunner', weapon: 'rifle', ...options });
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const car = { root, spec: { id: 'vest-visual-fixture' } }, seat = [0, .95, -.85];
  root.add(crew.root); crew.attach(car, seat); scene.updateMatrixWorld(true);
  t.after(() => crew.dispose());
  return { crew, scene, state: { alive: true, weaponId: 'rifle', quat: new THREE.Quaternion(), vel: new THREE.Vector3(),
    speed: 0, steer: 0, aimYaw: .25, aimPitch: .05, fire: false, ads: false, crouch: false, reloading: false, far: false } };
}
function assertHiddenAttached(crew, reference = null) {
  const template = Assets.template(HERO_URL);
  for (const name of VESTS) {
    const node = authoredMesh(crew.model, HERO_URL, name), authored = template.getObjectByName(name);
    assert.ok(authored?.isSkinnedMesh, `${name}: shipped asset contains the exact authored tier`);
    assert.ok(node?.isSkinnedMesh, `${name}: real cloned tier remains present`);
    assert.equal(node.visible, false, `${name}: tier is hidden`);
    same(crew.bones[name], node, `${name}: bones map retains the exact node`);
    assert.ok(below(node, crew.model), `${name}: tier stays attached to the owned model`);
    assert.equal(node.parent?.name, authored.parent?.name, `${name}: authored parent is preserved`);
    same(node.geometry, authored.geometry, `${name}: shared authored geometry is retained`);
    same(node.geometry.attributes.position, authored.geometry.attributes.position, `${name}: authored vertices are retained`);
    assert.ok(node.material && node.skeleton);
    different(node.skeleton, authored.skeleton, `${name}: clone owns its skeleton`);
    same(node.skeleton.boneInverses, authored.skeleton.boneInverses, `${name}: immutable authored inverse binds are shared`);
    assert.ok(node.skeleton.bones.every(bone => below(bone, crew.model)), `${name}: all bones belong to this clone`);
    if (reference) {
      same(node, reference.get(name).node, `${name}: update never substitutes or detaches the tier`);
      same(node.skeleton, reference.get(name).skeleton, `${name}: updates retain ownership`);
    }
  }
}
const vestReferences = crew => new Map(VESTS.map(name => {
  const node = authoredMesh(crew.model, HERO_URL, name); return [name, { node, skeleton: node.skeleton }];
}));

test('every stale or malformed hero armor tier leaves the exact three authored vest meshes hidden and attached', t => {
  const templateBefore = visibility(Assets.template(HERO_URL));
  for (const armorTier of [undefined, 0, 1, 2, 3, -1, 4, NaN, Infinity, '3', true, null, { tier: 3 }, []]) {
    const { crew } = fixture(t, { armorTier });
    assertHiddenAttached(crew);
    assert.equal(skeletons(crew.model).size, 6, 'body/hair/eyes and three hidden tiers retain all six clone owners');
    crew.dispose();
  }
  assert.deepEqual(visibility(Assets.template(HERO_URL)), templateBefore, 'constructor cannot alter the cached authored graph');
});

test('unarmored body, hair, eyes, hand/head sockets and original animation clips survive vest retirement', t => {
  const { crew } = fixture(t, { armorTier: 3 }), template = Assets.template(HERO_URL), clips = Assets.getAnimations(HERO_URL);
  assert.equal(crew.rigged, true); assertHiddenAttached(crew);
  for (const name of BASE_MESHES) {
    const node = authoredMesh(crew.model, HERO_URL, name), source = template.getObjectByName(name);
    assert.ok(node?.isSkinnedMesh && source?.isSkinnedMesh, name);
    assert.ok(below(node, crew.model)); assert.equal(node.visible, true, `${name}: unarmored appearance is visible`);
    same(node.geometry, source.geometry, `${name}: exact authored geometry`); same(node.geometry.attributes.position, source.geometry.attributes.position, `${name}: exact authored vertices`);
    different(node.skeleton, source.skeleton, `${name}: clone-local skeleton`); same(node.skeleton.boneInverses, source.skeleton.boneInverses, `${name}: exact inverse-bind ownership`);
  }
  for (const name of SOCKETS_AND_BONES) {
    const node = crew.model.getObjectByName(name);
    assert.ok(node && template.getObjectByName(name), `${name}: shipped socket or bone exists`);
    same(crew.bones[name], node, `${name}: exact public bone/socket`); assert.ok(below(node, crew.model));
  }
  same(crew.bones.socket_hand_R.parent, crew.bones.RightHand, 'right socket retains its exact hand parent');
  same(crew.bones.socket_hand_L.parent, crew.bones.LeftHand, 'left socket retains its exact hand parent');
  same(crew.bones.socket_head.parent, crew.bones.Head, 'head socket retains its exact head parent');
  same(crew.clips, clips, 'exact authored clip array'); same(crew.model.animations, clips, 'model retains authored clips'); assert.ok(clips.length > 0);
  for (const name of ['idle_stand', 'pose_rifle', 'aim_rifle', 'fire_rifle_auto', 'reload_rifle', 'death_fall']) {
    const clip = clips.find(candidate => candidate.name === name);
    assert.ok(clip?.tracks.length > 0, `${name}: authored animation remains available`);
    same(crew.clipIdx.get(name), clip, `${name}: exact authored clip identity`);
  }
});

test('regular aiming, firing and reload updates animate the real rig without revealing or replacing vest nodes', t => {
  const { crew, state, scene } = fixture(t, { armorTier: 2 }), reference = vestReferences(crew);
  const clips = crew.clips, time = crew.mixer.time, model = crew.model;
  for (const stage of [
    { aimYaw: .1, aimPitch: -.1, ads: false, fire: false, reloading: false },
    { aimYaw: .8, aimPitch: .2, ads: true, fire: true, reloading: false },
    { aimYaw: -.5, aimPitch: .12, ads: false, fire: false, reloading: true },
    { aimYaw: .3, aimPitch: .05, ads: false, fire: false, reloading: false },
  ]) {
    Object.assign(state, stage); crew.update(1 / 30, state); scene.updateMatrixWorld(true);
    assertHiddenAttached(crew, reference); same(crew.model, model, 'same character model after update'); same(crew.clips, clips, 'same clips after update');
    assert.equal(authoredMesh(crew.model, HERO_URL, 'body').visible, true);
  }
  assert.ok(crew.mixer.time > time, 'authored mixer still advances');
  assert.ok(crew.acts.size > 0, 'production animation actions still exist');
});

test('shadow-only entry and exit restore body details without restoring retired armor visibility', t => {
  const { crew } = fixture(t, { armorTier: 3 }), reference = vestReferences(crew);
  const details = BASE_MESHES.map(name => authoredMesh(crew.model, HERO_URL, name));
  const original = details.map(node => ({ node, material: node.material, visible: node.visible }));
  for (let cycle = 0; cycle < 3; cycle++) {
    crew._setShadowOnly(true); assert.equal(crew._shadowOnlyOn, true); assertHiddenAttached(crew, reference);
    const bodyMaterials = [].concat(details[0].material);
    assert.ok(bodyMaterials.every(material => material.colorWrite === false && material.depthWrite === false));
    crew._setShadowOnly(false); assert.equal(crew._shadowOnlyOn, false); assertHiddenAttached(crew, reference);
    for (const entry of original) { same(entry.node.material, entry.material, `${entry.node.name}: exact material restored`); assert.equal(entry.node.visible, entry.visible); }
  }
});

test('real weapon and optic replacements retain unarmored character nodes and hidden tier ownership', t => {
  const { crew, state, scene } = fixture(t, { armorTier: 1 }), reference = vestReferences(crew), body = authoredMesh(crew.model, HERO_URL, 'body');
  const bodyGeometry = body.geometry, bodySkeleton = body.skeleton;
  for (const [weaponId, opticId] of [['pistol', 'wide_reflex'], ['smg', 'wide_reflex'], ['rifle', 'standard']]) {
    const previous = crew.weapon;
    crew._setShadowOnly(true); crew.setWeapon(weaponId, opticId);
    assert.equal(previous.disposed, true, 'replaced real weapon is disposed');
    assert.equal(crew.weaponId, weaponId); assert.equal(crew.weapon.opticId, opticId); assert.ok(crew.weapon.model);
    assertHiddenAttached(crew, reference);
    crew._setShadowOnly(false); state.weaponId = weaponId; state.opticId = opticId;
    crew.update(1 / 60, state); scene.updateMatrixWorld(true);
    assertHiddenAttached(crew, reference);
    same(authoredMesh(crew.model, HERO_URL, 'body'), body, `${weaponId}/${opticId}: exact authored character body after hand mount`);
    same(body.geometry, bodyGeometry, `${weaponId}/${opticId}: character geometry retained`);
    same(body.skeleton, bodySkeleton, `${weaponId}/${opticId}: character skeleton retained`);
    assert.ok(below(body, crew.model), `${weaponId}/${opticId}: authored body stays attached`); assert.equal(body.visible, true);
  }
});

test('death restores the external body and head without revealing a retired vest', t => {
  const { crew, state, scene } = fixture(t, { armorTier: 3 }), reference = vestReferences(crew);
  crew._setShadowOnly(true); crew.bones.Head.scale.setScalar(1e-4);
  crew.die({ head: true });
  assert.equal(crew.alive, false); assert.equal(crew.body.visible, true); assert.equal(crew._shadowOnlyOn, false);
  assert.equal(crew.bones.Head.scale.x, 1); assertHiddenAttached(crew, reference);
  state.alive = false; crew.update(1 / 60, state); scene.updateMatrixWorld(true);
  assertHiddenAttached(crew, reference);
  for (const name of BASE_MESHES) assert.equal(authoredMesh(crew.model, HERO_URL, name).visible, true, `${name}: death view restores the authored detail`);
});

test('CrewView disposes all six owners including hidden tier skeletons exactly once and preserves live siblings/shared assets', t => {
  const { crew } = fixture(t, { armorTier: 3 }), { crew: sibling } = fixture(t, { armorTier: 1 }), template = Assets.template(HERO_URL);
  assertHiddenAttached(crew); assertHiddenAttached(sibling);
  const owned = skeletons(crew.model), live = skeletons(sibling.model), source = skeletons(template);
  assert.equal(owned.size, 6); assert.equal(live.size, 6); assert.equal(source.size, 1);
  const upload = set => [...set].map(skeleton => {
    skeleton.computeBoneTexture(); const record = { skeleton, texture: skeleton.boneTexture, disposed: 0 };
    record.texture.addEventListener('dispose', () => record.disposed++); return record;
  });
  const records = upload(owned), liveRecords = upload(live), sourceTextures = [...source].map(skeleton => [skeleton, skeleton.boneTexture]);
  const shared = new Set();
  for (const model of [template, crew.model, sibling.model]) model.traverse(node => {
    if (!node.isMesh) return; shared.add(node.geometry);
    for (const material of [].concat(node.material)) { shared.add(material); for (const value of Object.values(material)) if (value?.isTexture) shared.add(value); }
  });
  let sharedDisposed = 0; const onDispose = () => sharedDisposed++;
  for (const resource of shared) resource.addEventListener('dispose', onDispose);
  t.after(() => { for (const resource of shared) resource.removeEventListener('dispose', onDispose); });
  crew.dispose(); crew.dispose();
  same(crew.root.parent, null, 'disposed crew detaches'); assert.equal(disposeOwnedSkeletons(crew.model), 0, 'ownership registry is already cleared');
  for (const record of records) { assert.equal(record.disposed, 1); same(record.skeleton.boneTexture, null, 'owned bone texture released'); }
  for (const record of liveRecords) { assert.equal(record.disposed, 0); same(record.skeleton.boneTexture, record.texture, 'sibling bone texture survives'); }
  for (const [skeleton, texture] of sourceTextures) same(skeleton.boneTexture, texture, 'template bone texture unchanged');
  assert.equal(sharedDisposed, 0, 'hidden meshes keep shared material/geometry/atlas ownership unchanged');
  assertHiddenAttached(sibling);
});

for (const [kind, role, weapon] of [['hero_driver', 'driver', null], ['raider_a', 'gunner', 'rifle']]) {
  test(`${kind} keeps its authored visible graph when stale player armor options are supplied`, t => {
    const url = `/models/characters/${kind}.glb`, template = Assets.template(url), authored = visibility(template);
    for (const armorTier of [0, 1, 2, 3, '3']) {
      const crew = new CrewView(kind, { role, weapon, armorTier }); t.after(() => crew.dispose());
      assert.equal(crew.rigged, true); assert.deepEqual(visibility(crew.model), authored);
      for (const name of BASE_MESHES) {
        const node = authoredMesh(crew.model, url, name), source = template.getObjectByName(name);
        assert.ok(node && source, name); assert.equal(node.visible, source.visible); same(node.geometry, source.geometry, `${kind}/${name}: authored geometry`);
      }
      same(crew.clips, Assets.getAnimations(url), `${kind}: exact authored clips`); crew.dispose();
    }
    assert.deepEqual(visibility(template), authored, 'non-player template remains unchanged');
  });
}
