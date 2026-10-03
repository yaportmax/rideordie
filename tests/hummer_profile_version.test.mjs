// Authored, unrun. Portable profile-version boundary regressions.
// Old implementations are exact published source snapshots, not replacement
// normalizers or stores. Cloud requests execute the actual Worker and SQLite.
// Platform constructor/SQL cursor and fetch delivery are the only server shims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { normalizeProfile, loadProfile } from '../src/meta/profile.js';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { SaveStore, SAVE_STORE_KEY, SAVE_BACKUP_KEY, SAVE_RECOVERY_KEY } from '../src/meta/save_store.js';
import { CloudSaves } from '../src/meta/cloud_saves.js';
import { sanitizeProfile, canonicalJson, contentHash } from '../server/saves/schema.js';
import { sanitizeProfile as sanitizeLegacyProfile } from './fixtures/hummer_legacy_schema_v1.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const frozen = resolve(root, 'tests/fixtures/hummer_before_version');
const prefix = 'hummer-before-version://source/';
const snapshots = new Set(['src/meta/profile.js', 'src/meta/save_store.js',
  'src/data/upgrades.js', 'src/data/vehicle_families.js']);
const cloudSource = readFileSync(resolve(root, 'src/meta/cloud_saves.js'), 'utf8');
// Its entire implementation is still the published client; only the schema
// module binding changes for the old-client execution below.
assert.equal(createHash('sha256').update(cloudSource).digest('hex'),
  '0ffffcca0b38fddd343609842045b04797a22f8c308fa30a258da2c173811cdc');
const oldSources = new Map([...snapshots].map(path => [prefix + path,
  readFileSync(resolve(frozen, path + '.txt'), 'utf8')]));
oldSources.set(prefix + 'src/meta/cloud_saves.js', cloudSource);
const oldHooks = registerHooks({
  resolve(specifier, context, next) {
    if (oldSources.has(specifier)) return { url: specifier, shortCircuit: true };
    if (context.parentURL?.startsWith(prefix) && specifier.startsWith('.')) {
      const virtual = new URL(specifier, context.parentURL).href;
      if (oldSources.has(virtual)) return { url: virtual, shortCircuit: true };
      const path = new URL(virtual).pathname.slice(1);
      if (path === 'server/saves/schema.js') return {
        url: pathToFileURL(resolve(root, 'tests/fixtures/hummer_legacy_schema_v1.mjs')).href,
        shortCircuit: true,
      };
      return { url: pathToFileURL(resolve(root, path)).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (oldSources.has(url)) return { format: 'module', source: oldSources.get(url), shortCircuit: true };
    return next(url, context);
  },
});
let oldProfile, oldStoreModule, oldUpgrades, OldCloudSaves;
try {
  [oldProfile, oldStoreModule, oldUpgrades, { CloudSaves: OldCloudSaves }] = await Promise.all([
    import(prefix + 'src/meta/profile.js'), import(prefix + 'src/meta/save_store.js'),
    import(prefix + 'src/data/upgrades.js'), import(prefix + 'src/meta/cloud_saves.js'),
  ]);
} finally { oldHooks.deregister(); }

const platformHooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'hummer-profile-version:platform', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'hummer-profile-version:platform') return {
      format: 'module', source: 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }',
      shortCircuit: true,
    };
    return next(url, context);
  },
});
let worker, SaveVault;
try { ({ default: worker, SaveVault } = await import('../server/saves/worker.js')); }
finally { platformHooks.deregister(); }

const HUMMER = 'player_hummer_t1';
const cloudKey = 'rideordie.cloud.v1';
const capability = `ROD1-${'V'.repeat(43)}`;
const clone = value => structuredClone(value);
const isCode = code => error => error?.code === code;
const zeroHummer = { engine: 0, armor: 0, tires: 0, nitro: 0, ram: 0, spikes: 0, glass: 0, fueltank: 0, oil: 0, mines: 0 };
const paidHummer = { ...zeroHummer, engine: 2, armor: 4, tires: 3, nitro: 2, ram: 3, glass: 2, mines: 1 };
const raw = owned => ({ ...DEFAULT_PROFILE(), campaignId: owned ? 'owned-hummer-version' : 'unowned-hummer-gear-version',
  cash: 700, totalCash: 100700, truck: owned ? HUMMER : 'player_sedan_t1',
  trucks: owned ? ['player_sedan_t1', HUMMER] : ['player_sedan_t1'],
  vehicleUpgradeSchema: 2, vehicleUpgrades: { hummer: clone(paidHummer), rustbucket: { armor: 2 } },
});
const value = owned => normalizeProfile(raw(owned));
let serial = 0;
const id = () => `00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, '0')}`;
const storage = () => ({ data: new Map(), writes: [],
  getItem(key) { return this.data.get(key) ?? null; },
  setItem(key, bytes) { this.writes.push({ key, bytes: String(bytes) }); this.data.set(key, String(bytes)); },
  removeItem(key) { this.data.delete(key); },
});
const bytes = local => [...local.data.entries()].sort(([a], [b]) => a.localeCompare(b));
const makeStore = (local, old = false, onNormalize) => {
  const normalize = old ? oldProfile.normalizeProfile : normalizeProfile;
  let clock = 1000;
  return new (old ? oldStoreModule.SaveStore : SaveStore)({ storage: local,
    normalize: input => { onNormalize?.(input); return normalize(input); },
    fresh: () => normalize({ ...(old ? oldUpgrades.DEFAULT_PROFILE() : DEFAULT_PROFILE()), campaignId: 'fresh-version-person' }),
    now: () => ++clock, id,
  });
};
const assertGear = (p, owned) => {
  assert.equal(p.v, 2); assert.deepEqual(p.vehicleUpgrades.hummer, paidHummer);
  assert.equal(p.trucks.includes(HUMMER), owned); assert.equal(p.truck, owned ? HUMMER : 'player_sedan_t1');
  assert.equal(p.vehicleUpgrades.rustbucket.armor, 2);
};

test('only real Hummer ownership or positive repaired family gear opts into profile v2', () => {
  for (const owned of [true, false]) {
    const p = value(owned); assertGear(p, owned);
    assert.deepEqual(normalizeProfile(p), p); assertGear(sanitizeProfile(p), owned);
  }
  const ownedZero = normalizeProfile({ ...raw(true), vehicleUpgrades: { hummer: zeroHummer } });
  assert.equal(ownedZero.v, 2); assert.equal(sanitizeProfile(ownedZero).v, 2);
  const empty = normalizeProfile({ ...raw(false), vehicleUpgrades: { hummer: zeroHummer } });
  assert.equal(empty.v, 1); assert.equal(sanitizeProfile(empty).v, 1);
  assert.equal(Object.hasOwn(sanitizeProfile(empty).vehicleUpgrades, 'hummer'), false);
});

test('retained negative: actual old normalizer and v1 SaveStore silently lose owned and unowned Hummer data', () => {
  for (const owned of [true, false]) {
    const unguarded = { ...value(owned), v: 1 };
    const lost = oldProfile.normalizeProfile(unguarded);
    assert.equal(lost.v, 1); assert.equal(lost.trucks.includes(HUMMER), false);
    assert.equal(lost.truck, 'player_sedan_t1'); assert.equal(Object.hasOwn(lost.vehicleUpgrades, 'hummer'), false);
    const local = storage(), store = makeStore(local, true);
    const adopted = store.create('Unguarded negative', unguarded);
    const p = store.load(adopted.id); p.cash++;
    assert.equal(store.save(p).ok, true);
    assert.equal(Object.hasOwn(store.exportSlot(adopted.id).profile.vehicleUpgrades, 'hummer'), false);
    if (!owned) assert.equal(Object.hasOwn(sanitizeLegacyProfile(unguarded).vehicleUpgrades, 'hummer'), false,
      'old cloud whitelist accepts only-legacy IDs while dropping positive unowned gear');
  }
});

test('actual old constructor/load and a stale live pin cannot replace shared v2 heads or recover stale backups', () => {
  for (const owned of [true, false]) {
    const local = storage(), older = makeStore(local, true), oldPin = older.load();
    const newer = makeStore(local), current = newer.load();
    const staleLegacyHead = local.getItem(SAVE_STORE_KEY);
    Object.assign(current, value(owned), { campaignId: current.campaignId });
    assert.equal(newer.save(current).ok, true);
    current.cash += 7; assert.equal(newer.save(current).ok, true);
    // A parse fallback could otherwise replace the new head with this genuinely
    // older, valid nine-ID save. Unsupported profiles must hard-stop that path.
    local.setItem(SAVE_BACKUP_KEY, staleLegacyHead);
    const original = bytes(local), rawHead = local.getItem(SAVE_STORE_KEY), rawBackup = local.getItem(SAVE_BACKUP_KEY);
    assert.ok(rawBackup); assert.equal(JSON.parse(rawBackup).slots[0].profile.v, 1);
    assert.equal(JSON.parse(rawHead).slots[0].profile.v, 2);
    let normalizedV2 = 0;
    const restartedOld = makeStore(local, true, input => { if (input.v === 2) normalizedV2++; });
    assert.equal(restartedOld.status().error.code, 'unsupported-profile');
    const fallback = restartedOld.load(); assert.equal(fallback.v, 1);
    assert.equal(restartedOld.status().error.code, 'unsupported-profile'); assert.equal(normalizedV2, 0);
    oldPin.cash = 99999;
    const refused = older.save(oldPin); assert.equal(refused.ok, false); assert.equal(refused.error.code, 'unsupported-profile');
    for (const operation of [() => restartedOld.list(), () => restartedOld.exportSlot(),
      () => restartedOld.history(newer.activeId()), () => restartedOld.create('Old copy', fallback)]) {
      assert.throws(operation, isCode('unsupported-profile'));
    }
    assert.deepEqual(bytes(local), original);
    assert.equal(local.getItem(SAVE_STORE_KEY), rawHead); assert.equal(local.getItem(SAVE_BACKUP_KEY), rawBackup);
  }
});

test('a v2 paid backup alone blocks old store parsing even when its current profile is legacy v1', () => {
  const local = storage(), newer = makeStore(local), selected = newer.activeId();
  newer.retainBackup(selected, { profile: value(false), name: 'Paid unowned family' });
  assert.equal(newer.load().v, 1); assertGear(newer.history(selected)[0].profile, false);
  const original = bytes(local), older = makeStore(local, true);
  assert.equal(older.status().error.code, 'unsupported-profile');
  assert.throws(() => older.history(selected), isCode('unsupported-profile'));
  assert.deepEqual(bytes(local), original);
});

test('actual old import and recovery reject v2 before normalization and preserve exact existing storage', () => {
  for (const owned of [true, false]) {
    const local = storage(); let normalizedV2 = 0;
    const store = makeStore(local, true, input => { if (input.v === 2) normalizedV2++; });
    const original = bytes(local), p = value(owned);
    assert.throws(() => store.importSlot({ kind: 'rideordie-save', version: 2, name: 'New family', profile: p }), isCode('unsupported-profile'));
    assert.deepEqual(bytes(local), original); assert.equal(normalizedV2, 0);
    const recoveryId = id();
    local.setItem(SAVE_RECOVERY_KEY, JSON.stringify({ version: 1, entries: [{ id: recoveryId, at: 1000, profile: p }] }));
    const beforeRecovery = bytes(local);
    assert.throws(() => store.restoreRecovery(recoveryId), isCode('unsupported-profile'));
    assert.deepEqual(bytes(local), beforeRecovery); assert.equal(normalizedV2, 0);
  }
});

test('new actual store preserves paid v2 data through resave, backup, restore, duplicate and portable import', () => {
  for (const owned of [true, false]) {
    const local = storage(), store = makeStore(local), p = store.load();
    Object.assign(p, value(owned), { campaignId: p.campaignId });
    assert.equal(store.save(p).ok, true); assertGear(store.load(), owned);
    const selected = store.activeId(); p.cash += 9; assert.equal(store.save(p).ok, true);
    const previous = store.history(selected).find(row => row.profile.v === 2 && row.profile.cash === 700);
    assert.ok(previous); assertGear(previous.profile, owned);
    store.restore(selected, previous.id); assert.equal(store.load().cash, 700); assertGear(store.load(), owned);
    const duplicate = store.duplicate(selected, 'Paid copy'); assertGear(duplicate.profile, owned);
    const exported = store.exportSlot(selected); assert.equal(exported.version, 2); assertGear(exported.profile, owned);
    const imported = store.importSlot(JSON.stringify(exported), 'Paid import'); assertGear(imported.profile, owned);
    const reloaded = makeStore(local); assertGear(reloaded.load(selected), owned);
    assertGear(reloaded.load(imported.id), owned);
  }
});

test('new singleton migration and campaign mirror loading retain v2 while raw migration bytes stay recoverable', () => {
  const originalStorage = globalThis.localStorage;
  try {
    for (const owned of [true, false]) {
      const local = storage(), p = value(owned), original = JSON.stringify(p);
      local.setItem('rideordie.profile.v1', original);
      const store = makeStore(local); assertGear(store.load(), owned);
      assert.equal(store.recoveries()[0].raw, original);
      const recovered = store.restoreRecovery(store.recoveries()[0].id); assertGear(recovered.profile, owned);
      local.setItem('rideordie.profile.v1.' + p.campaignId, original);
      globalThis.localStorage = local; assertGear(loadProfile(p.campaignId), owned);
      // This overload bypassed the old version gate; it remains a documented
      // read-only negative, while named-slot persistence rejects the same v2.
      const oldRead = oldProfile.loadProfile(p.campaignId);
      assert.equal(oldRead.v, 1); assert.equal(Object.hasOwn(oldRead.vehicleUpgrades, 'hummer'), false);
      assert.equal(local.getItem('rideordie.profile.v1.' + p.campaignId), original);
    }
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage;
  }
});

test('all legacy v1 canonical bytes and hashes remain unchanged with empty unowned Hummer defaults', async () => {
  const corpus = [
    { v: 1, campaignId: 'legacy-version-default' },
    { v: 1, campaignId: 'legacy-version-pickup', cash: 720, truck: 'truck_t3', upgrades: { armor: 5, nitro: 4, vest: 2 } },
    { v: 1, campaignId: 'legacy-version-buggy', truck: 'player_buggy_t3', trucks: ['player_sedan_t1', 'player_buggy_t3'],
      vehicleUpgradeSchema: 2, vehicleUpgrades: { buggy: { tires: 5, engine: 3 } } },
  ];
  for (const input of corpus) {
    const before = sanitizeLegacyProfile(input), after = sanitizeProfile(normalizeProfile(input));
    assert.equal(after.v, 1); assert.equal(canonicalJson(after), canonicalJson(before));
    const expectedHash = createHash('sha256').update(canonicalJson({ name: 'Legacy', profile: before, deleted: false })).digest('hex');
    assert.equal(await contentHash('Legacy', after, false), expectedHash);
  }
});

class SqliteStorage {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.sql = { exec: (query, ...bindings) => {
      if (query.trim().startsWith('CREATE TABLE')) { this.db.exec(query); return { toArray: () => [] }; }
      const statement = this.db.prepare(query);
      const rows = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { toArray: () => rows };
    } };
  }
  transactionSync(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); assert.ok(!(result instanceof Promise)); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  dump() { return JSON.stringify(['vault_meta', 'slots', 'backups'].map(table => this.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())); }
}
function service(t) {
  const objects = new Map(), requests = [];
  const origin = 'https://ride.maxyaport.com', endpoint = 'https://version-save.local';
  const env = { SAVE_IP_LIMIT: { limit: async () => ({ success: true }) }, SAVE_VAULT_LIMIT: { limit: async () => ({ success: true }) },
    SAVE_VAULTS: { idFromName: identity => identity, get(identity) {
      if (!objects.has(identity)) { const storage = new SqliteStorage(); objects.set(identity, { storage, vault: new SaveVault({ storage }, env) }); }
      return { fetch: request => objects.get(identity).vault.fetch(request) };
    } },
  };
  t.after(() => { for (const row of objects.values()) row.storage.db.close(); });
  const fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers); headers.set('Origin', origin); headers.set('CF-Connecting-IP', '192.0.2.81');
    requests.push({ method: options.method || 'GET', path: new URL(url).pathname });
    return worker.fetch(new Request(url, { ...options, headers }), env);
  };
  const send = async (method, path, body) => {
    const response = await fetch(endpoint + path, { method, headers: { Authorization: 'Bearer ' + capability,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const writes = () => requests.filter(row => row.method !== 'GET');
  const heads = () => [...objects.values()].flatMap(row => row.storage.db.prepare('SELECT data FROM slots ORDER BY id').all().map(record => JSON.parse(record.data)));
  return { objects, requests, fetch, send, writes, heads, endpoint };
}
const client = (t, svc, local = storage(), old = false) => {
  const store = makeStore(local, old);
  const cloud = new (old ? OldCloudSaves : CloudSaves)({ store, storage: local, fetch: svc.fetch, url: svc.endpoint,
    debounceMs: 5000, retryBaseMs: 60000, retryMaxMs: 60000 });
  t.after(() => cloud.dispose());
  return { store, cloud, local };
};

test('actual old cloud refuses raw v2 owned and positive-unowned heads before applying or flushing a pending CAS', async t => {
  for (const owned of [true, false]) await t.test(owned ? 'owned base' : 'positive unowned gear', async t => {
    const svc = service(t); assert.equal((await svc.send('POST', '/v1/vault')).status, 200);
    const older = client(t, svc, storage(), true);
    assert.equal((await older.cloud.connect(capability)).status, 'connected');
    const p = older.store.load(); p.cash = 912; assert.equal(older.store.save(p).ok, true);
    older.cloud._clearTimer();
    const pendingSlot = older.store.list().find(row => row.id === older.store.activeId());
    const acknowledged = JSON.parse(older.local.getItem(cloudKey)).acks[pendingSlot.id];
    // Use the actual client's queue operation to retain one immutable CAS
    // request, then prove the newer raw profile is refused BEFORE that send.
    older.cloud._queueSlot(pendingSlot, acknowledged.version);
    assert.equal(Object.keys(JSON.parse(older.local.getItem(cloudKey)).outbox).length, 1);
    const slotId = id(), first = await svc.send('PUT', '/v1/slots/' + slotId,
      { name: 'New family', profile: value(owned), baseVersion: 0, mutationId: id() });
    assert.equal(first.status, 200); assertGear(first.data.slot.profile, owned);
    const before = canonicalJson(svc.heads()), writeCount = svc.writes().length;
    const localBefore = bytes(older.local);
    const failed = await older.cloud.sync();
    assert.equal(failed.status, 'error'); assert.match(failed.error, /unsupported response/);
    assert.equal(svc.writes().length, writeCount); assert.equal(canonicalJson(svc.heads()), before);
    assert.deepEqual(bytes(older.local), localBefore, 'failed pull must neither adopt nor acknowledge projected new-family data');
    assert.equal(older.store.list().some(row => row.id === slotId), false);
    const secondFailure = await older.cloud.sync(); assert.equal(secondFailure.status, 'error');
    assert.equal(svc.writes().length, writeCount); assert.equal(canonicalJson(svc.heads()), before);
  });
});

test('new actual Worker/client keeps v2 gear on imports, repeated reads, real CAS updates, retries and cloud restore', async t => {
  for (const owned of [true, false]) await t.test(owned ? 'owned base' : 'positive unowned gear', async t => {
    const svc = service(t); await svc.send('POST', '/v1/vault');
    const slotId = id(), mutationId = id(), original = value(owned);
    const body = { name: 'Paid version', profile: original, baseVersion: 0, mutationId };
    const first = await svc.send('PUT', '/v1/slots/' + slotId, body);
    assert.equal(first.status, 200); assertGear(first.data.slot.profile, owned);
    const retry = await svc.send('PUT', '/v1/slots/' + slotId, body);
    assert.equal(retry.status, 200); assert.deepEqual(retry.data.slot, first.data.slot);
    const newer = client(t, svc); assert.equal((await newer.cloud.connect(capability)).status, 'connected');
    assertGear(newer.store.load(slotId), owned);
    const pin = newer.store.load(slotId), slotBefore = newer.store.list().find(row => row.id === slotId);
    const historyBefore = newer.store.history(slotId), writesBefore = svc.writes().length;
    for (let i = 0; i < 4; i++) assert.equal((await newer.cloud.sync()).status, 'connected');
    assert.equal(newer.store.list().find(row => row.id === slotId).generation, slotBefore.generation);
    assert.deepEqual(newer.store.history(slotId), historyBefore); assert.equal(svc.writes().length, writesBefore);
    pin.cash += 11; assert.equal(newer.store.save(pin).ok, true);
    assert.equal((await newer.cloud.sync()).status, 'connected');
    const current = svc.heads().find(row => row.id === slotId); assertGear(current.profile, owned);
    assert.equal(current.profile.cash, 711); assert.ok(current.version > first.data.slot.version);
    const stale = await svc.send('PUT', '/v1/slots/' + slotId, { ...body, mutationId: id() });
    assert.equal(stale.status, 409); assert.equal(stale.data.slot.version, current.version);
    const oldReceipt = await svc.send('PUT', '/v1/slots/' + slotId, body);
    assert.equal(oldReceipt.status, 409); assert.equal(oldReceipt.data.slot.hash, current.hash);
    const history = await newer.cloud.history(slotId); assert.equal(history.length, 1); assertGear(history[0].profile, owned);
    assert.equal(history[0].hash, first.data.slot.hash);
    assert.equal((await newer.cloud.restoreCloud(slotId, history[0].id)).status, 'connected');
    assertGear(newer.store.load(slotId), owned); assert.equal(newer.store.load(slotId).cash, 700);
    assert.equal((await svc.send('GET', '/v1/vault')).data.slots.find(row => row.id === slotId).profile.v, 2);
  });
});

test('actual new client repeated legacy reads preserve v1 hash, generations, histories and loaded pins', async t => {
  const svc = service(t); await svc.send('POST', '/v1/vault');
  const legacy = sanitizeLegacyProfile({ v: 1, campaignId: 'old-version-road', cash: 42 });
  const slotId = id(), first = await svc.send('PUT', '/v1/slots/' + slotId,
    { name: 'Legacy road', profile: legacy, baseVersion: 0, mutationId: id() });
  assert.equal(first.status, 200); assert.equal(first.data.slot.profile.v, 1);
  assert.equal(canonicalJson(first.data.slot.profile), canonicalJson(legacy));
  const newer = client(t, svc); assert.equal((await newer.cloud.connect(capability)).status, 'connected');
  const pinned = newer.store.load(slotId), before = newer.store.list().find(row => row.id === slotId);
  const history = newer.store.history(slotId), count = svc.writes().length;
  for (let i = 0; i < 8; i++) assert.equal((await newer.cloud.sync()).status, 'connected');
  assert.equal(svc.writes().length, count); assert.equal(newer.store.list().find(row => row.id === slotId).generation, before.generation);
  assert.deepEqual(newer.store.history(slotId), history);
  assert.equal(svc.heads().find(row => row.id === slotId).hash, first.data.slot.hash);
  pinned.cash = 43; assert.equal(newer.store.save(pinned).ok, true, 'unchanged reads keep the loaded pin usable');
  assert.equal((await newer.cloud.sync()).status, 'connected');
  assert.equal(svc.heads().find(row => row.id === slotId).profile.v, 1);
});
