import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveStore, SAVE_STORE_KEY, SAVE_BACKUP_KEY, SAVE_RECOVERY_KEY } from '../src/meta/save_store.js';
import { normalizeProfile } from '../src/meta/profile.js';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';

let serial = 0;
const uuid = () => `00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, '0')}`;
const personal = (cash = 0, campaignId = 'personal-campaign') => normalizeProfile({ ...DEFAULT_PROFILE(), cash, campaignId });
function storage(data = new Map()) {
  return { data, writes: [], getItem(key) { return data.get(key); }, setItem(key, raw) { this.writes.push({ key, raw }); data.set(key, raw); } };
}
function fixture(existing = storage()) {
  let tick = 1000;
  const store = new SaveStore({ storage: existing, normalize: normalizeProfile, fresh: () => personal(0, 'fresh-person'), now: () => ++tick, id: uuid });
  return { store, storage: existing, data: existing.data };
}
const isCode = code => error => error.code === code;
const remote = (slot, patch = {}) => ({ id: slot.id, name: slot.name, profile: slot.profile, version: 1, hash: 'a'.repeat(64), updatedAt: 3000, deleted: false, ...patch });

test('migrates only the personal singleton once and retains its exact original', () => {
  const local = storage(); const initial = personal(3200, 'owner');
  local.data.set('rideordie.profile.v1', JSON.stringify(initial));
  local.data.set('rideordie.profile.v1.foreign-host', JSON.stringify(personal(9000, 'foreign-host')));
  const { store } = fixture(local);
  assert.equal(store.list().length, 1); assert.equal(store.load().cash, 3200);
  assert.equal(store.list()[0].name, 'Main save');
  assert.equal(store.recoveries()[0].raw, JSON.stringify(initial));
  assert.notEqual(store.activeId(), initial.campaignId);
  local.data.set('rideordie.profile.v1', JSON.stringify(personal(7777, 'other')));
  const reloaded = fixture(local).store;
  assert.equal(reloaded.list().length, 1); assert.equal(reloaded.load().cash, 3200);
  assert.equal(local.data.get('rideordie.profile.v1.foreign-host'), JSON.stringify(personal(9000, 'foreign-host')));
});

test('corrupt legacy bytes are retained before any compatibility overwrite', () => {
  const local = storage(); local.data.set('rideordie.profile.v1', '{broken legacy');
  const { store } = fixture(local);
  const retentionIndex = local.writes.findIndex(write => write.key === SAVE_RECOVERY_KEY);
  const mirrorIndex = local.writes.findIndex(write => write.key === 'rideordie.profile.v1');
  assert.ok(retentionIndex >= 0 && mirrorIndex > retentionIndex);
  assert.equal(store.recoveries()[0].raw, '{broken legacy'); assert.equal(store.load().cash, 0);
  assert.equal(store.status().error.code, 'legacy-corrupt');
  const blocked = storage(); blocked.data.set('rideordie.profile.v1', '{do not overwrite');
  const put = blocked.setItem;
  blocked.setItem = function (key, value) { if (key === SAVE_RECOVERY_KEY) throw Error('quota'); return put.call(this, key, value); };
  const failed = fixture(blocked).store;
  assert.equal(failed.status().durable, false); assert.equal(failed.status().error.code, 'storage-write');
  assert.equal(blocked.data.get('rideordie.profile.v1'), '{do not overwrite');
  assert.equal(blocked.data.has(SAVE_STORE_KEY), false); assert.equal(failed.load().cash, 0);
});

test('recovers a damaged primary from verified previous head without losing damaged bytes', () => {
  const { store, storage: local, data } = fixture(); const profile = store.load();
  profile.cash = 100; profile.revision++; assert.equal(store.save(profile).ok, true);
  profile.cash = 200; profile.revision++; assert.equal(store.save(profile).ok, true);
  const goodBackup = data.get(SAVE_BACKUP_KEY); data.set(SAVE_STORE_KEY, '{damaged primary');
  const recovered = fixture(local).store;
  assert.equal(recovered.load().cash, 100); assert.equal(data.get(SAVE_STORE_KEY), goodBackup);
  assert.equal(recovered.recoveries()[0].raw, '{damaged primary'); assert.equal(data.get(SAVE_BACKUP_KEY), goodBackup);
});

test('future store and profile versions are explicitly rejected without replacing bytes', () => {
  const { storage: local, data } = fixture();
  const previous = data.get(SAVE_STORE_KEY), future = JSON.stringify({ ...JSON.parse(previous), version: 50 });
  data.set(SAVE_BACKUP_KEY, previous); data.set(SAVE_STORE_KEY, future);
  const unsupported = fixture(local).store;
  assert.equal(unsupported.status().error.code, 'unsupported-store');
  assert.equal(data.get(SAVE_STORE_KEY), future); assert.throws(() => unsupported.list(), isCode('unsupported-store'));
  const old = storage(); const raw = JSON.stringify({ ...personal(), v: 7 }); old.data.set('rideordie.profile.v1', raw);
  const futureProfile = fixture(old).store;
  assert.equal(futureProfile.status().error.code, 'unsupported-profile'); assert.equal(old.data.get('rideordie.profile.v1'), raw);
  assert.equal(futureProfile.recoveries()[0].raw, raw);
});

test('metadata commits keep an originating profile writable after active save switches', () => {
  const { store, data } = fixture(); const profile = store.load(), originalId = store.activeId();
  const other = store.create('Other', personal(80, 'other-person'));
  const generation = store.list().find(slot => slot.id === originalId).generation;
  store.rename(originalId, 'My road'); const renamed = store.list().find(slot => slot.id === originalId);
  assert.equal(renamed.generation, generation + 1);
  store.setSync(originalId, { dirty: false, version: 3, baseVersion: 3, hash: 'b'.repeat(64), recoveryCode: 'excluded' });
  assert.equal(store.list().find(slot => slot.id === originalId).generation, renamed.generation);
  store.retainBackup(originalId, { profile: personal(2), name: 'Cloud loser' });
  store.activate(other.id); const before = structuredClone(profile);
  profile.cash = 450; profile.revision++; const expected = structuredClone(profile);
  assert.equal(store.save(profile).ok, true); assert.deepEqual(profile, expected);
  assert.equal(store.activeId(), other.id); assert.equal(store.load().cash, 80);
  assert.equal(store.load(originalId).cash, 450); assert.equal(before.campaignId, profile.campaignId);
  assert.equal(JSON.parse(data.get('rideordie.profile.v1')).cash, 450);
  assert.equal(JSON.parse(data.get(`rideordie.profile.v1.${profile.campaignId}`)).cash, 450);
  assert.equal(store.list().find(slot => slot.id === originalId).sync.recoveryCode, undefined);
});

test('stale loaded objects and a second tab cannot overwrite newer personal progress', () => {
  const { store, storage: local } = fixture(); const stale = store.load();
  const secondTab = fixture(local).store, winner = secondTab.load(); winner.cash = 1200; winner.revision++;
  assert.equal(secondTab.save(winner).ok, true); stale.cash = 999; stale.revision++;
  const result = store.save(stale);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'stale-profile');
  assert.equal(result.conflict.local.cash, 999); assert.equal(result.conflict.current.profile.cash, 1200);
  assert.equal(store.load().cash, 1200); assert.equal(store.recoveries()[0].profile.cash, 999);
  const copiedStale = structuredClone(stale);
  assert.equal(store.save(copiedStale).error.code, 'unpinned-profile'); assert.equal(store.load().cash, 1200);
  const recovered = store.restoreRecovery(result.conflict.recoveryId, 'My offline progress');
  assert.equal(recovered.profile.cash, 999); assert.notEqual(recovered.profile.campaignId, stale.campaignId);
  assert.notEqual(recovered.id, result.conflict.slotId);
});

test('fresh unpinned personal profiles are adopted once; foreign profiles cannot replace existing progress', () => {
  const { store } = fixture(), owned = personal(900, 'manual-owner');
  assert.equal(store.save(owned).ok, true); assert.equal(store.load().campaignId, 'manual-owner');
  owned.cash = 850; assert.equal(store.save(owned).ok, true);
  const loaded = store.load(); loaded.cash = 800; assert.equal(store.save(loaded).ok, true);
  const foreign = personal(10000, 'shared-host'); const result = store.save(foreign);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'unpinned-profile'); assert.equal(store.load().cash, 800);
  const copies = store.importSlot(store.exportSlot(store.activeId()));
  assert.equal(copies.profile.campaignId, 'manual-owner');
  assert.equal(store.save(personal(700, 'manual-owner')).error.code, 'unpinned-profile', 'ambiguous archive identity must not pick an arbitrary personal slot');
});

test('duplicate preserves inventory, cash and campaign progress but creates new slot and wallet identities', () => {
  const { store } = fixture(), profile = store.load();
  profile.cash = 5432; profile.totalCash = 16000; profile.trucks.push('truck_t2'); profile.truck = 'truck_t2';
  profile.vehicleUpgrades.rustbucket.engine = 2; profile.upgrades.vest = 1;
  profile.weapons.rifle = { dmg: 2, mag: 1, rel: 0, hnd: 0 }; profile.loadout.push('rifle');
  profile.campaignProgress = { version: 1, unlockedLevel: 2, cleared: [1], selectedLevel: 2, selectedMode: 'campaign', marathonUnlocked: false, clearRuns: { 1: 'won-1' } };
  assert.equal(store.save(profile).ok, true);
  const source = store.list()[0], copy = store.duplicate(source.id, 'Second road');
  assert.notEqual(copy.id, source.id); assert.notEqual(copy.profile.campaignId, source.profile.campaignId);
  assert.deepEqual({ ...copy.profile, campaignId: source.profile.campaignId }, source.profile);
});

test('history bounds and restores retain the displaced head independently of game revision', () => {
  const { store } = fixture(), profile = store.load(), id = store.activeId();
  for (let cash = 1; cash <= 14; cash++) { profile.cash = cash; profile.revision = cash; assert.equal(store.save(profile).ok, true); }
  const history = store.history(id); assert.equal(history.length, 10); assert.equal(history[0].profile.cash, 13);
  const restored = store.restore(id, history[3].id);
  assert.equal(restored.profile.cash, 10); assert.equal(restored.profile.revision, 10);
  assert.equal(store.history(id)[0].profile.cash, 14); assert.equal(store.history(id).length, 10);
  profile.cash = 16; assert.equal(store.save(profile).error.code, 'stale-profile');
  const clone = store.history(id); clone[0].profile.cash = 999; assert.equal(store.history(id)[0].profile.cash, 14);
});

test('available save and deleted recovery bounds allow more than twelve lifetime save IDs', () => {
  const { store } = fixture(); const first = store.activeId(); let oldest;
  for (let n = 0; n < 13; n++) {
    const slot = store.create(`Trip ${n}`); if (n === 0) oldest = slot.id; store.remove(slot.id);
  }
  assert.equal(store.list().length, 1); assert.equal(store.list({ includeDeleted: true }).length, 13);
  assert.equal(store.list({ includeDeleted: true }).some(slot => slot.id === oldest), false);
  assert.throws(() => store.remove(first), isCode('active-delete'));
  for (let n = 0; n < 11; n++) store.create(`Available ${n}`);
  assert.equal(store.list().length, 12); assert.throws(() => store.create('Too many'), isCode('slot-limit'));
  const deleted = store.list({ includeDeleted: true }).filter(slot => slot.deleted).at(-1);
  assert.throws(() => store.restoreDeleted(deleted.id), isCode('slot-limit'));
  store.remove(store.list().find(slot => slot.id !== first).id);
  const restored = store.restoreDeleted(deleted.id); assert.equal(restored.deleted, false); assert.equal(store.list().length, 12);
});

test('exports and imports exclude credentials, leave existing heads intact, and reject unsafe schemas', () => {
  const { store } = fixture(), id = store.activeId(), before = store.load();
  const exported = store.exportSlot(id); exported.profile.recoveryCode = 'ROD1-secret'; exported.profile.token = 'secret'; exported.profile.settings = { apiKey: 'secret' };
  const imported = store.importSlot(JSON.stringify(exported), 'Imported');
  assert.notEqual(imported.id, id); assert.equal(imported.name, 'Imported'); assert.equal(store.activeId(), id);
  assert.equal(JSON.stringify(store.exportSlot(imported.id)).includes('secret'), false); assert.deepEqual(store.load(), before);
  for (const invalid of [null, [], { ...exported, version: 3 }, { ...exported, profile: {} }, { ...exported, profile: { ...exported.profile, campaignId: 123 } }, { ...exported, profile: { ...exported.profile, v: 3 } }, { ...exported, profile: { ...exported.profile, cash: Infinity } }, { ...exported, profile: { ...exported.profile, weapons: { pistol: { dmg: 'bad' } } } }, { ...exported, profile: { ...exported.profile, campaignProgress: { version: 3 } } }]) assert.throws(() => store.importSlot(invalid));
  assert.throws(() => store.importSlot('{bad json'), isCode('invalid-import'));
  assert.throws(() => store.importSlot({ ...exported, filler: 'x'.repeat(70 * 1024) }));
  assert.throws(() => store.importSlot('x'.repeat(70 * 1024)), isCode('save-too-large'));
  const cyclic = { ...exported }; cyclic.self = cyclic; assert.throws(() => store.importSlot(cyclic), isCode('invalid-profile'));
});

test('backup and primary failures leave the last verified head recoverable and report failure', () => {
  for (const failedKey of [SAVE_BACKUP_KEY, SAVE_STORE_KEY]) {
    const { store, storage: local, data } = fixture(), profile = store.load(), original = data.get(SAVE_STORE_KEY);
    const put = local.setItem; local.setItem = function (key, raw) { if (key === failedKey) throw Error('quota exceeded'); return put.call(this, key, raw); };
    profile.cash = 600; const snapshot = structuredClone(profile), result = store.save(profile);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'storage-write'); assert.deepEqual(profile, snapshot);
    assert.equal(data.get(SAVE_STORE_KEY), original); assert.equal(store.load().cash, 0);
    assert.equal(store.recoveries().find(entry => entry.id === result.recovery.id).profile.cash, 600);
    if (failedKey === SAVE_STORE_KEY) assert.equal(data.get(SAVE_BACKUP_KEY), original);
  }
});

test('failed read-back verification never claims a durable gameplay save', () => {
  const { store, storage: local, data } = fixture(), profile = store.load(), original = data.get(SAVE_STORE_KEY);
  const put = local.setItem;
  local.setItem = function (key, raw) { if (key !== SAVE_STORE_KEY) return put.call(this, key, raw); this.writes.push({ key, raw }); };
  profile.cash = 300; const result = store.save(profile);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'storage-verification');
  assert.equal(data.get(SAVE_STORE_KEY), original); assert.equal(data.get(SAVE_BACKUP_KEY), original);
});

test('partial mirror errors report committed progress and preserve a writable caller pin', () => {
  const { store, storage: local } = fixture(), profile = store.load(); const put = local.setItem;
  local.setItem = function (key, raw) { if (key === `rideordie.profile.v1.${profile.campaignId}`) throw Error('mirror quota'); return put.call(this, key, raw); };
  profile.cash = 500; const result = store.save(profile);
  assert.equal(result.ok, false); assert.equal(result.error.committed, true); assert.equal(result.slot.profile.cash, 500);
  assert.equal(store.load().cash, 500); assert.equal(store.status().durable, true);
  assert.equal(result.recovery, undefined); assert.equal(store.recoveries().some(entry => entry.reason === 'failed-save'), false);
  local.setItem = put; profile.cash = 450; assert.equal(store.save(profile).ok, true);
});

test('uncertain primary reads reconcile a confirmed write without a false stale conflict', () => {
  const { store, storage: local } = fixture(), profile = store.load();
  const put = local.setItem, get = local.getItem; let failReads = 0;
  local.setItem = function (key, raw) { put.call(this, key, raw); if (key === SAVE_STORE_KEY) failReads = 2; };
  local.getItem = function (key) { if (key === SAVE_STORE_KEY && failReads > 0) { failReads--; throw Error('temporarily blocked read'); } return get.call(this, key); };
  profile.cash = 300; const result = store.save(profile);
  assert.equal(result.ok, false); assert.equal(result.error.uncertain, true);
  local.setItem = put; profile.cash = 280;
  assert.equal(store.save(profile).ok, true); assert.equal(store.load().cash, 280);
  assert.equal(store.recoveries().some(entry => entry.reason === 'stale-profile'), false);
});

test('one transient verification read completes a proven commit, mirrors it, and retains the caller pin', () => {
  const { store, storage: local, data } = fixture(), profile = store.load();
  const put = local.setItem, get = local.getItem; let failRead = false;
  local.setItem = function (key, raw) { put.call(this, key, raw); if (key === SAVE_STORE_KEY) failRead = true; };
  local.getItem = function (key) { if (key === SAVE_STORE_KEY && failRead) { failRead = false; throw Error('transient read'); } return get.call(this, key); };
  profile.cash = 190; const result = store.save(profile);
  assert.equal(result.ok, true); assert.equal(result.slot.profile.cash, 190);
  assert.equal(store.status().warning.code, 'storage-verification');
  assert.equal(JSON.parse(data.get('rideordie.profile.v1')).cash, 190); assert.equal(JSON.parse(data.get(`rideordie.profile.v1.${profile.campaignId}`)).cash, 190);
  local.setItem = put; profile.cash = 150; assert.equal(store.save(profile).ok, true);
});

test('uncertain first adoption reconciles ownership and retains its first persisted head', () => {
  const { store, storage: local } = fixture(), profile = personal(70, 'adopted-owner');
  const put = local.setItem, get = local.getItem; let failReads = 0;
  local.setItem = function (key, raw) { put.call(this, key, raw); if (key === SAVE_STORE_KEY) failReads = 2; };
  local.getItem = function (key) { if (key === SAVE_STORE_KEY && failReads > 0) { failReads--; throw Error('read blocked'); } return get.call(this, key); };
  assert.equal(store.save(profile).error.uncertain, true);
  local.setItem = put; profile.campaignId = 'foreign-owner';
  assert.equal(store.save(profile).error.code, 'identity-conflict'); assert.equal(store.load().campaignId, 'adopted-owner');
  profile.campaignId = 'adopted-owner'; profile.cash = 60; assert.equal(store.save(profile).ok, true);
  assert.equal(store.history(store.activeId())[0].profile.cash, 70);
});

test('an aborted initial adoption cannot bypass ownership after another save initializes the catalogue', () => {
  const { store, storage: local } = fixture(), profile = personal(70, 'adoption-not-written');
  const put = local.setItem;
  local.setItem = function (key, raw) { if (key === SAVE_STORE_KEY) throw Error('quota'); return put.call(this, key, raw); };
  assert.equal(store.save(profile).error.code, 'storage-write');
  local.setItem = put; store.create('Second save');
  assert.equal(store.save(profile).error.code, 'unpinned-profile'); assert.equal(store.load().campaignId, 'fresh-person');
});

test('a full recovery disk still exposes both stale branches for manual preservation', () => {
  const { store, storage: local } = fixture(), first = store.load(), stale = store.load();
  first.cash = 20; assert.equal(store.save(first).ok, true);
  const put = local.setItem; local.setItem = function (key, raw) { if (key === SAVE_RECOVERY_KEY) throw Error('quota'); return put.call(this, key, raw); };
  stale.cash = 18; const result = store.save(stale);
  assert.equal(result.error.code, 'stale-profile'); assert.equal(result.conflict.recoveryPersisted, false);
  assert.equal(result.conflict.local.cash, 18); assert.equal(result.conflict.current.profile.cash, 20);
  assert.equal(store.status().conflict.local.cash, 18); assert.equal(store.recoveries()[0].profile.cash, 18);
});

test('retained damaged catalogue envelopes cannot be falsely restored as empty progress', () => {
  const { store, storage: local, data } = fixture(); const current = data.get(SAVE_STORE_KEY);
  data.set(SAVE_BACKUP_KEY, current); const damaged = JSON.parse(current); damaged.activeId = 'missing';
  data.set(SAVE_STORE_KEY, JSON.stringify(damaged));
  const recovered = fixture(local).store; const record = recovered.recoveries()[0];
  assert.equal(record.reason, 'damaged-store'); assert.throws(() => recovered.restoreRecovery(record.id), isCode('invalid-recovery'));
  assert.equal(recovered.list().length, 1); assert.equal(store.load().cash, 0);
});

test('a racing tab between backup and primary writes is detected before overwrite', () => {
  const { store, storage: local, data } = fixture(), profile = store.load();
  const rivalRaw = JSON.parse(data.get(SAVE_STORE_KEY)); rivalRaw.sequence++; rivalRaw.slots[0].profile.cash = 999; rivalRaw.slots[0].generation++; rivalRaw.slots[0].headId = uuid();
  const put = local.setItem;
  local.setItem = function (key, raw) { put.call(this, key, raw); if (key === SAVE_BACKUP_KEY) data.set(SAVE_STORE_KEY, JSON.stringify(rivalRaw)); };
  profile.cash = 1; const result = store.save(profile);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'storage-conflict'); assert.equal(store.load().cash, 999);
});

test('cloud applies use local generation CAS, retain heads, and never mutate running objects', () => {
  const { store } = fixture(), running = store.load(), id = store.activeId(), initial = store.list()[0];
  const unchanged = structuredClone(running), applied = store.applyRemote(remote(initial, { profile: personal(777, running.campaignId), version: 4 }), { expectedGeneration: initial.generation });
  assert.equal(applied.profile.cash, 777); assert.equal(applied.sync.version, 4); assert.equal(applied.sync.dirty, false);
  assert.deepEqual(running, unchanged); assert.equal(store.history(id)[0].profile.cash, 0);
  assert.equal(store.save(running).error.code, 'stale-profile');
  assert.throws(() => store.applyRemote(remote(initial), { expectedGeneration: initial.generation }), isCode('generation-conflict'));
  const current = store.list()[0]; assert.throws(() => store.applyRemote(remote(current, { deleted: true }), { expectedGeneration: current.generation }), isCode('active-delete'));
  assert.equal(store.activeId(), id); assert.equal(store.load().cash, 777);
  const secondary = store.create('Other cloud', personal(12, 'other'));
  const deleted = store.applyRemote(remote(secondary, { deleted: true, version: 2 }), { expectedGeneration: secondary.generation });
  assert.equal(deleted.deleted, true); assert.equal(deleted.profile.cash, 12); assert.equal(store.list().some(slot => slot.id === secondary.id), false);
  assert.equal(store.list({ includeDeleted: true }).find(slot => slot.id === secondary.id).deleted, true);
});

test('cloud imports keep exact slot IDs while generations and external metadata remain independent', () => {
  const { store } = fixture(); const importedId = uuid();
  const slot = store.applyRemote(remote({ id: importedId, name: 'Remote', profile: personal(60, 'remote-owner') }), { expectedGeneration: 0 });
  assert.equal(slot.id, importedId); assert.equal(slot.generation, 1); assert.equal(store.activeId() === importedId, false);
  const running = store.load(importedId); const before = slot.generation;
  store.setSync(importedId, { version: 8, baseVersion: 8, ackGeneration: before, vaultId: 'hashed-vault', dirty: false });
  assert.equal(store.list().find(entry => entry.id === importedId).generation, before);
  running.cash = 30; assert.equal(store.save(running).ok, true);
  assert.equal(store.list().find(entry => entry.id === importedId).sync.dirty, true);
  assert.throws(() => store.applyRemote(remote(slot, { hash: 'wrong' })), isCode('invalid-remote'));
});

test('notifications can unsubscribe and returned records cannot mutate stored data', () => {
  const { store } = fixture(), events = [], unsubscribe = store.onChange(event => events.push(event));
  const slot = store.create('Copy'); slot.profile.cash = 4000; assert.equal(store.load(slot.id).cash, 0);
  store.rename(slot.id, 'Renamed'); store.setSync(slot.id, { dirty: false });
  assert.deepEqual(events.map(event => event.type), ['create', 'rename', 'sync']);
  unsubscribe(); store.remove(slot.id); assert.equal(events.length, 3);
  const profile = store.load(); assert.throws(() => store.restore(store.activeId(), 'missing'), isCode('missing-backup'));
  assert.equal(profile.cash, 0);
});

test('an invalid normalizer cannot commit an envelope that rejects its own required profile fields', () => {
  const local = storage();
  assert.throws(() => new SaveStore({ storage: local, normalize: () => ({ v: 1, campaignId: 'incomplete' }), fresh: personal, now: () => 1000, id: uuid }), isCode('invalid-profile'));
  assert.equal(local.data.has(SAVE_STORE_KEY), false);
});

test('quota failures preserve attempted progress after title discards its caller and allow later recovery', () => {
  const { store, storage: local } = fixture(), id = store.activeId(); let profile = store.load();
  const put = local.setItem; local.setItem = () => { throw Error('full disk'); };
  profile.cash = 600; profile.revision = 4; profile.recoveryCode = 'ROD1-not-save-data';
  const failed = store.save(profile); assert.equal(failed.ok, false); assert.equal(failed.recovery.volatile, true);
  profile = store.load(); assert.equal(profile.cash, 0); assert.equal(store.exportSlot(id).profile.cash, 0);
  const branch = store.recoveries().find(entry => entry.id === failed.recovery.id);
  assert.equal(branch.profile.cash, 600); assert.equal(branch.profile.revision, 4); assert.equal(branch.volatile, true);
  assert.equal(JSON.stringify(branch.profile).includes('ROD1-not-save-data'), false);
  assert.equal(store.status().volatileRecoveryCount, 1);
  const exportForManualPreservation = { kind: 'rideordie-save', version: 2, name: branch.name, profile: branch.profile, exportedAt: 5000 };
  assert.equal(exportForManualPreservation.profile.cash, 600);
  local.setItem = put;
  const restored = store.restoreRecovery(branch.id, 'Recovered after full disk');
  assert.equal(restored.profile.cash, 600); assert.equal(restored.profile.revision, 4);
  assert.notEqual(restored.profile.campaignId, profile.campaignId); assert.equal(store.load().cash, 0);
});

test('failed-save recovery persists when only the primary is blocked and survives store reload', () => {
  const { store, storage: local } = fixture(), profile = store.load(); const put = local.setItem;
  local.setItem = function (key, raw) { if (key === SAVE_STORE_KEY) throw Error('head write blocked'); return put.call(this, key, raw); };
  profile.cash = 600; const result = store.save(profile);
  assert.equal(result.recovery.volatile, false); assert.equal(store.status().volatileRecoveryCount, 0);
  const reloaded = fixture(local).store;
  assert.equal(reloaded.load().cash, 0);
  const branch = reloaded.recoveries().find(entry => entry.id === result.recovery.id);
  assert.equal(branch.profile.cash, 600); assert.equal(branch.volatile, false);
});

test('blocked reads still expose a volatile failed-save recovery without duplicating the same attempt', () => {
  const { store, storage: local } = fixture(), profile = store.load(); const get = local.getItem;
  local.getItem = () => { throw Error('reads unavailable'); };
  profile.cash = 600; const first = store.save(profile), repeated = store.save(profile);
  assert.equal(first.error.code, 'storage-read'); assert.equal(first.recovery.volatile, true);
  assert.equal(repeated.recovery.id, first.recovery.id);
  assert.equal(store.recoveries()[0].profile.cash, 600); assert.equal(store.status().volatileRecoveryCount, 1);
  local.getItem = get;
  const restored = store.restoreRecovery(first.recovery.id, 'Recovered blocked read'); assert.equal(restored.profile.cash, 600);
});
