// AUTHORED UNRUN. Overlay into a clean candidate; root owns every test/import
// lease. Previous accepted schema/store bytes are retained as negative controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { sanitizeProfile, canonicalJson } from '../server/saves/schema.js';
import { assertSupportedProfile, contentProfileVersion, SUPPORTED_PROFILE_VERSION } from '../server/saves/profile_support.js';
import { WEAPON_ATTACHMENT_IDS, weaponAttachmentIdsFor } from '../server/saves/weapon_attachment_support.js';
import { normalizeProfile } from '../src/meta/profile.js';
import { SaveStore, SAVE_STORE_KEY, SAVE_BACKUP_KEY, SAVE_RECOVERY_KEY } from '../src/meta/save_store.js';

const prefix = 'weapon-before-attachment://source/';
const frozen = {
  'server/saves/schema.js': 'CC33D59CB995BDCCAF7EA14FC6321DDBD3951F3FC0D23870D11410BE9BDF32CF',
  'server/saves/profile_support.js': '6A98AFFA339ACE597868E38658FF332EEE28A8C55223C6A77E3C4138444DBDE4',
  'src/meta/save_store.js': '4F6F75C79F8BC4F6F6984527C0EECCB54DD83471594F36625B94F89AF3137F2B',
};
const oldSources = new Map(Object.entries(frozen).map(([path, expected]) => {
  const bytes = readFileSync(new URL(`./fixtures/weapon_before_attachments/${path}.txt`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), expected, path);
  return [prefix + path, bytes.toString('utf8')];
}));
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (oldSources.has(specifier)) return { url: specifier, shortCircuit: true };
    if (context.parentURL?.startsWith(prefix) && specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL).href;
      if (oldSources.has(url)) return { url, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (oldSources.has(url)) return { format: 'module', source: oldSources.get(url), shortCircuit: true };
    return next(url, context);
  },
});
let oldSchema, OldSaveStore;
try {
  oldSchema = await import(prefix + 'server/saves/schema.js');
  ({ SaveStore: OldSaveStore } = await import(prefix + 'src/meta/save_store.js'));
} finally { hooks.deregister(); }

const zero = () => ({ dmg: 0, mag: 0, rel: 0, hnd: 0 });
const raw = (patch = {}) => ({ v: 1, campaignId: 'paid-gun-owner', cash: 1234, totalCash: 21000,
  weapons: { pistol: zero(), rifle: { dmg: 2, mag: 1, rel: 2, hnd: 1 }, sniper: zero() },
  loadout: ['rifle', 'pistol', 'sniper'], ...patch });
const paidRows = () => ({
  pistol: { owned: ['extended_mag', 'laser'], equipped: ['laser'] },
  rifle: { owned: [...WEAPON_ATTACHMENT_IDS], equipped: [...WEAPON_ATTACHMENT_IDS] },
});
const paid = patch => normalizeProfile(raw({ weaponAttachments: paidRows(), ...patch }));
const isCode = code => error => error?.code === code;
let serial = 0;
const id = () => `00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, '0')}`;
const storage = () => ({ data: new Map(), writes: [], getItem(key) { return this.data.get(key) ?? null; },
  setItem(key, value) { const bytes = String(value); this.writes.push({ key, bytes }); this.data.set(key, bytes); } });
const bytes = local => [...local.data.entries()].sort(([a], [b]) => a.localeCompare(b));
function store(local = storage(), older = false, onNormalize) {
  let now = 1000;
  return new (older ? OldSaveStore : SaveStore)({ storage: local, id, now: () => ++now,
    normalize: value => { onNormalize?.(value); return normalizeProfile(value); },
    fresh: () => normalizeProfile({ v: 1, campaignId: 'fresh-gun-owner', cash: 0 }) });
}

test('empty attachment defaults preserve all three accepted legacy cloud signatures', () => {
  assert.equal(SUPPORTED_PROFILE_VERSION, 4);
  for (const source of [raw(), raw({ trucks: ['player_sedan_t1', 'player_hummer_t1'], truck: 'player_hummer_t1', vehicleUpgrades: { hummer: { armor: 2 } } }),
    raw({ trucks: ['player_sedan_t1', 'player_tank_t1'], truck: 'player_tank_t1', vehicleUpgrades: { tank: { ram: 2 } } })]) {
    const previous = oldSchema.sanitizeProfile(source);
    for (const weaponAttachments of [undefined, {}, { pistol: { owned: [], equipped: [] }, rifle: { owned: [], equipped: [] } }]) {
      const current = sanitizeProfile({ ...source, ...(weaponAttachments === undefined ? {} : { weaponAttachments }) });
      assert.equal(current.v, previous.v);
      assert.equal(Object.hasOwn(current, 'weaponAttachments'), false);
      assert.equal(canonicalJson(current), oldSchema.canonicalJson(previous));
      assert.equal(contentProfileVersion(current), previous.v);
    }
  }
});

test('paid or equipped compatible attachment requires capability four even when raw v is one', () => {
  for (const weaponId of ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'minigun']) {
    for (const attachmentId of weaponAttachmentIdsFor(weaponId)) {
      const source = raw({ weapons: { pistol: zero(), [weaponId]: zero() }, weaponAttachments: {
        [weaponId]: { owned: [attachmentId], equipped: [] },
      } });
      const original = structuredClone(source), wire = sanitizeProfile(source);
      assert.equal(wire.v, 4); assert.equal(contentProfileVersion(source), 4);
      assert.equal(assertSupportedProfile(source), 4);
      assert.throws(() => assertSupportedProfile(source, 3), error => error.code === 'unsupported-profile' && error.requiredVersion === 4);
      assert.deepEqual(wire.weaponAttachments[weaponId], { owned: [attachmentId], equipped: [] });
      assert.deepEqual(source, original, 'raw validation/projection must not mutate the caller');
      assert.equal(canonicalJson(sanitizeProfile(wire)), canonicalJson(wire));
    }
  }
});

test('new paid combat scope survives independently and marks capability four; old sight repairs remain unchanged', () => {
  for (const weaponId of ['rifle', 'sniper']) {
    const source = raw({ weaponOptics: { [weaponId]: { owned: ['standard', 'combat_3x'], equipped: 'combat_3x' } } });
    const wire = sanitizeProfile(source); assert.equal(wire.v, 4);
    assert.deepEqual(wire.weaponOptics[weaponId], source.weaponOptics[weaponId]);
    assert.equal(Object.hasOwn(wire, 'weaponAttachments'), false);
    assert.throws(() => assertSupportedProfile(source, 3), error => error.code === 'unsupported-profile' && error.requiredVersion === 4);
  }
  const recovered = normalizeProfile(raw({ weapons: { pistol: zero(), rpg: zero() }, weaponOptics: {
    rpg: { owned: ['wide_reflex'], equipped: 'wide_reflex' }, rifle: { owned: ['standard'], equipped: 'wide_reflex' },
  } }));
  assert.equal(recovered.weaponOptics.rpg.equipped, 'standard');
  assert.equal(Object.hasOwn(recovered.weaponOptics, 'rifle'), false, 'unowned legacy optic row is still repaired');
  assert.equal(recovered.v, 1);
});

test('permuted incoming paid attachment arrays share one canonical signature with browser normalization', () => {
  const ordered = raw({ weaponAttachments: {
    pistol: { owned: ['extended_mag', 'laser'], equipped: ['extended_mag', 'laser'] },
    rifle: { owned: [...WEAPON_ATTACHMENT_IDS], equipped: ['laser', 'stock'] },
  } });
  const permuted = raw({ weaponAttachments: {
    pistol: { owned: ['laser', 'extended_mag'], equipped: ['laser', 'extended_mag'] },
    rifle: { owned: ['stock', 'foregrip', 'laser', 'extended_mag'], equipped: ['stock', 'laser'] },
  } });
  const original = structuredClone(permuted), wire = sanitizeProfile(permuted);
  assert.deepEqual(wire.weaponAttachments, ordered.weaponAttachments);
  assert.equal(canonicalJson(wire), canonicalJson(sanitizeProfile(ordered)));
  assert.equal(canonicalJson(wire), canonicalJson(sanitizeProfile(normalizeProfile(permuted))), 'cloud apply cannot make catalogue-normalized local progress appear dirty');
  assert.deepEqual(permuted, original);
});

test('unsupported paid identities fail before wire/local projection; malformed known rows fail finite schema validation', () => {
  const unsupported = [
    { weaponAttachments: { rifle: { owned: ['future_barrel'], equipped: [] } } },
    { weaponAttachments: { future_gun: { owned: ['laser'], equipped: [] } } },
    { weaponAttachments: { pistol: { owned: ['foregrip'], equipped: [] } } },
    { weaponAttachments: { rpg: { owned: ['extended_mag'], equipped: [] } } },
    { weaponAttachments: { rifle: { owned: ['laser'], equipped: [], futureSlot: 'paid' } } },
    { weapons: { pistol: zero() }, weaponAttachments: { rifle: { owned: ['laser'], equipped: [] } } },
    { weaponOptics: { rifle: { owned: ['standard', 'future_scope'], equipped: 'future_scope' } } },
    { weaponOptics: { pistol: { owned: ['standard', 'combat_3x'], equipped: 'combat_3x' } } },
    { weapons: { pistol: zero() }, weaponOptics: { rifle: { owned: ['standard', 'combat_3x'], equipped: 'combat_3x' } } },
    { v: 5 },
  ];
  for (const patch of unsupported) {
    const source = raw(patch), original = structuredClone(source);
    assert.throws(() => assertSupportedProfile(source), isCode('unsupported-profile'));
    assert.throws(() => sanitizeProfile(source), isCode('unsupported-profile'));
    assert.throws(() => normalizeProfile(source), isCode('unsupported-profile'));
    const local = storage(), current = store(local), before = bytes(local);
    assert.throws(() => current.importSlot({ kind: 'rideordie-save', version: 2, name: 'Unsupported equipment', profile: source }), isCode('unsupported-profile'));
    assert.deepEqual(bytes(local), before); assert.deepEqual(source, original);
  }
  for (const weaponAttachments of [null, [], { rifle: null }, { rifle: [] }, { rifle: { owned: 'laser', equipped: [] } },
    { rifle: { owned: ['laser'], equipped: 'laser' } }, { rifle: { owned: [], equipped: ['laser'] } },
    { rifle: { owned: ['laser', 'laser', 'laser', 'laser', 'laser'], equipped: [] } }]) {
    const source = raw({ weaponAttachments }), original = structuredClone(source);
    assert.throws(() => sanitizeProfile(source), /invalid_profile/);
    const local = storage(), current = store(local), before = bytes(local);
    assert.throws(() => current.importSlot({ kind: 'rideordie-save', version: 2, name: 'Damaged equipment', profile: source }), isCode('invalid-profile'));
    assert.deepEqual(bytes(local), before); assert.deepEqual(source, original);
  }
});

test('actual personal save, backup, restore, duplicate, import, migration and remote apply preserve paid mods and old gun levels', () => {
  const local = storage(), current = store(local), pin = current.load();
  Object.assign(pin, paid({ campaignId: pin.campaignId, weaponOptics: { rifle: { owned: ['standard', 'combat_3x'], equipped: 'combat_3x' } } }));
  const expected = structuredClone({ weaponAttachments: pin.weaponAttachments, weaponOptics: pin.weaponOptics, weapons: pin.weapons, loadout: pin.loadout });
  assert.equal(pin.v, 4); assert.equal(current.save(pin).ok, true);
  pin.cash += 23; pin.revision++; assert.equal(current.save(pin).ok, true);
  const slotId = current.activeId(), backup = current.history(slotId).find(row => row.profile.cash === 1234 && row.profile.v === 4); assert.ok(backup);
  current.restore(slotId, backup.id);
  const verify = profile => { assert.equal(profile.v, 4); assert.equal(profile.cash, 1234); for (const [key, value] of Object.entries(expected)) assert.deepEqual(profile[key], value, key); };
  verify(current.load()); verify(current.duplicate(slotId, 'Gun mods copy').profile);
  const exported = current.exportSlot(slotId); assert.equal(exported.version, 2); verify(exported.profile);
  verify(current.importSlot(JSON.stringify(exported), 'Gun mods import').profile);
  verify(store(local).load(slotId));
  const singleton = storage(); singleton.setItem('rideordie.profile.v1', JSON.stringify(current.load())); verify(store(singleton).load());
  const remoteId = id(), remote = current.applyRemote({ id: remoteId, name: 'Cloud gun mods', profile: current.load(), version: 1,
    hash: 'a'.repeat(64), updatedAt: 3000, deleted: false }); verify(remote.profile); verify(current.load(remoteId));
});

test('exact older accepted SaveStore refuses v4 heads/backups/import/recovery without projection or byte loss', () => {
  const local = storage(), current = store(local), pin = current.load();
  Object.assign(pin, paid({ campaignId: pin.campaignId })); assert.equal(current.save(pin).ok, true);
  pin.cash++; assert.equal(current.save(pin).ok, true);
  const previous = bytes(local); let attemptedProjection = 0;
  const older = store(local, true, value => { if (value.v === 4) attemptedProjection++; });
  assert.equal(older.status().error.code, 'unsupported-profile');
  assert.throws(() => older.list(), isCode('unsupported-profile'));
  assert.equal(attemptedProjection, 0); assert.deepEqual(bytes(local), previous);
  const clean = storage(), oldClean = store(clean, true), before = bytes(clean);
  assert.throws(() => oldClean.importSlot({ kind: 'rideordie-save', version: 2, name: 'Paid guns', profile: paid() }), isCode('unsupported-profile'));
  assert.deepEqual(bytes(clean), before);
  const recoveryId = id(); clean.setItem(SAVE_RECOVERY_KEY, JSON.stringify({ version: 1, entries: [{ id: recoveryId, at: 1000, profile: paid() }] }));
  const recoveryBefore = bytes(clean);
  assert.throws(() => oldClean.restoreRecovery(recoveryId), isCode('unsupported-profile')); assert.deepEqual(bytes(clean), recoveryBefore);
  const backed = storage(), withBackup = store(backed); withBackup.retainBackup(withBackup.activeId(), { profile: paid(), name: 'Paid old branch' });
  const backupBefore = bytes(backed); assert.equal(store(backed, true).status().error.code, 'unsupported-profile'); assert.deepEqual(bytes(backed), backupBefore);
  assert.ok(local.getItem(SAVE_STORE_KEY)); assert.ok(local.getItem(SAVE_BACKUP_KEY));
});
