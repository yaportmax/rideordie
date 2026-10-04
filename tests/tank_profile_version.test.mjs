// AUTHORED UNRUN. Actual normalizers/stores/client/Worker execute only when root
// grants a CPU lease. Frozen pre-tank code is original bytes, not a mock repair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_PROFILE, UPGRADE_BY_ID, effects } from '../src/data/upgrades.js';
import { VEHICLE_FAMILIES } from '../src/data/vehicle_families.js';
import { normalizeProfile, loadProfile, buyTruck, buyUpgrade, selectTruck } from '../src/meta/profile.js';
import { SaveStore, SAVE_STORE_KEY, SAVE_BACKUP_KEY, SAVE_RECOVERY_KEY } from '../src/meta/save_store.js';
import { CloudSaves } from '../src/meta/cloud_saves.js';
import { assertSupportedProfile, contentProfileVersion, PROFILE_FAMILY_CAPS, PROFILE_VEHICLE_IDS } from '../server/saves/profile_support.js';
import { sanitizeProfile, canonicalJson } from '../server/saves/schema.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const prefix = 'tank-before-version://source/';
const expected = {
  'src/meta/profile.js': '87C679C9C4DD9A333F4BD6D63893D480E324FB0ECEA29FBCBB62CB5088436C42',
  'src/meta/save_store.js': '296BA4197B9D4D3BC63F5D80DEF39EB72E73B8D1F53FBC4B1B861C275CFB89CF',
  'src/data/upgrades.js': '6ADAC0C2822AC92E412EF4C667EC90D5498173BDC8FF8044053F0150D7BABB9A',
  'src/data/vehicle_families.js': '787974365C4C150385D94AEA943479797B8331E3BD96B9D3F5C41F9DA3C24EC6',
  'src/meta/cloud_saves.js': '0FFFFCCA0B38FDDD343609842045B04797A22F8C308FA30A258DA2C173811CDC',
  'server/saves/schema.js': '86F721C72E40C827D3C0505E3BA3AD82FBF665A6E4A188FE7210D7C0779F863E',
};
const oldSources = new Map(Object.entries(expected).map(([path, hash]) => {
  const source = readFileSync(resolve(root, 'tests/fixtures/tank_before_version', path + '.txt'), 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex').toUpperCase(), hash, path);
  return [prefix + path, source];
}));
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (oldSources.has(specifier)) return { url: specifier, shortCircuit: true };
    if (specifier === 'cloudflare:workers') return { url: 'tank-profile:platform', shortCircuit: true };
    if (context.parentURL?.startsWith(prefix) && specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL).href;
      return { url: oldSources.has(url) ? url : pathToFileURL(resolve(root, new URL(url).pathname.slice(1))).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (oldSources.has(url)) return { format: 'module', source: oldSources.get(url), shortCircuit: true };
    if (url === 'tank-profile:platform') return { format: 'module', source: 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
    return next(url, context);
  },
});
let oldProfile, oldStore, oldUpgrades, oldSchema, OldCloudSaves, worker, SaveVault;
try {
  oldProfile = await import(prefix + 'src/meta/profile.js');
  oldStore = await import(prefix + 'src/meta/save_store.js');
  oldUpgrades = await import(prefix + 'src/data/upgrades.js');
  oldSchema = await import(prefix + 'server/saves/schema.js');
  ({ CloudSaves: OldCloudSaves } = await import(prefix + 'src/meta/cloud_saves.js'));
  ({ default: worker, SaveVault } = await import('../server/saves/worker.js'));
} finally { hooks.deregister(); }
const TANK = 'player_tank_t1', HUMMER = 'player_hummer_t1';
const zero = Object.fromEntries(Object.keys(PROFILE_FAMILY_CAPS.tank).map(id => [id, 0]));
const paid = { ...zero, engine: 2, armor: 5, tires: 3, nitro: 2, ram: 3, mines: 1 };
const value = owned => normalizeProfile({ ...DEFAULT_PROFILE(), campaignId: 'tank-save-person', cash: 1000,
  totalCash: 251000, truck: owned ? TANK : 'player_sedan_t1', trucks: owned ? ['player_sedan_t1', TANK] : ['player_sedan_t1'],
  vehicleUpgradeSchema: 2, vehicleUpgrades: { tank: structuredClone(paid), rustbucket: { armor: 2 }, hummer: { engine: 1 } } });
let serial = 0;
const id = () => `00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, '0')}`;
const storage = () => ({ data: new Map(), writes: [], getItem(key) { return this.data.get(key) ?? null; },
  setItem(key, bytes) { this.writes.push({ key, bytes: String(bytes) }); this.data.set(key, String(bytes)); }, removeItem(key) { this.data.delete(key); } });
const bytes = local => [...local.data.entries()].sort(([a], [b]) => a.localeCompare(b));
const isCode = code => error => error?.code === code;
const makeStore = (local, old = false, onNormalize) => {
  const normalize = old ? oldProfile.normalizeProfile : normalizeProfile;
  let now = 1000;
  return new (old ? oldStore.SaveStore : SaveStore)({ storage: local, now: () => ++now, id,
    normalize: value => { onNormalize?.(value); return normalize(value); },
    fresh: () => normalize({ ...(old ? oldUpgrades.DEFAULT_PROFILE() : DEFAULT_PROFILE()), campaignId: 'fresh-tank-person' }) });
};
const assertTank = (p, owned) => { assert.equal(p.v, 3); assert.deepEqual(p.vehicleUpgrades.tank, paid);
  assert.equal(p.trucks.includes(TANK), owned); assert.equal(p.truck, owned ? TANK : 'player_sedan_t1');
  assert.equal(p.vehicleUpgrades.rustbucket.armor, 2); assert.equal(p.vehicleUpgrades.hummer.engine, 1); };

test('profile capability matches all five live family caps and appends exactly one known vehicle', () => {
  assert.deepEqual(Object.keys(PROFILE_FAMILY_CAPS), Object.keys(VEHICLE_FAMILIES));
  for (const [family, row] of Object.entries(VEHICLE_FAMILIES)) assert.deepEqual(PROFILE_FAMILY_CAPS[family], row.caps);
  assert.deepEqual(PROFILE_VEHICLE_IDS, [...oldSchema.sanitizeProfile(oldProfile.normalizeProfile(DEFAULT_PROFILE())).trucks.slice(0, 1),
    'player_sedan_t2', 'truck_t1', 'truck_t2', 'truck_t3', 'truck_t4', 'player_buggy_t1', 'player_buggy_t2', 'player_buggy_t3', HUMMER, TANK]);
});

test('owned base or positive unowned tank progress marks v3; zero absent families preserve legacy canonical bytes', () => {
  for (const owned of [true, false]) { const p = value(owned); assertTank(p, owned); assert.deepEqual(normalizeProfile(p), p); assertTank(sanitizeProfile(p), owned); }
  const ownedEmpty = normalizeProfile({ ...DEFAULT_PROFILE(), trucks: ['player_sedan_t1', TANK] });
  assert.equal(ownedEmpty.v, 3); assert.equal(sanitizeProfile(ownedEmpty).v, 3);
  for (const raw of [DEFAULT_PROFILE(), { ...DEFAULT_PROFILE(), trucks: ['player_sedan_t1', HUMMER], vehicleUpgrades: { hummer: { engine: 2 } } }]) {
    const old = oldProfile.normalizeProfile(raw), current = normalizeProfile(raw);
    assert.equal(current.v, old.v); assert.equal(contentProfileVersion(current), old.v);
    assert.equal(canonicalJson(sanitizeProfile(current)), oldSchema.canonicalJson(oldSchema.sanitizeProfile(old)));
    assert.ok(!Object.hasOwn(sanitizeProfile(current).vehicleUpgrades, 'tank'));
  }
});

test('tank unlock and all 27 purchases charge requester cash once and preserve every other family and crew inventory', () => {
  const p = normalizeProfile({ ...DEFAULT_PROFILE(), cash: 1000000, upgrades: { medkit: 1, scavenger: 2 },
    vehicleUpgrades: { sedan: { engine: 1 }, hummer: { armor: 2 }, rustbucket: { nitro: 2 }, buggy: { tires: 1 } } });
  const stranger = normalizeProfile({ ...DEFAULT_PROFILE(), cash: 99 }), otherBefore = structuredClone(stranger), initial = structuredClone(p);
  const poor = { ...structuredClone(p), cash: 249999 }, beforePoor = structuredClone(poor);
  assert.deepEqual(buyTruck(poor, TANK), { ok: false, reason: 'cash' }); assert.deepEqual(poor, beforePoor);
  assert.deepEqual(buyTruck(p, TANK), { ok: true }); assert.equal(p.v, 3); assert.equal(p.cash, 750000);
  const gear = structuredClone({ upgrades: p.upgrades, weapons: p.weapons, loadout: p.loadout });
  let count = 0;
  for (const [track, cap] of Object.entries(PROFILE_FAMILY_CAPS.tank)) for (let level = 0; level < cap; level++) {
    const cash = p.cash; assert.deepEqual(buyUpgrade(p, track), { ok: true }); assert.equal(p.cash, cash - UPGRADE_BY_ID[track].costs[level]);
    assert.equal(p.vehicleUpgrades.tank[track], level + 1); count++;
  }
  assert.equal(count, 27);
  for (const family of ['sedan', 'hummer', 'rustbucket', 'buggy']) assert.deepEqual(p.vehicleUpgrades[family], initial.vehicleUpgrades[family]);
  assert.deepEqual({ upgrades: p.upgrades, weapons: p.weapons, loadout: p.loadout }, gear); assert.deepEqual(stranger, otherBefore);
  const before = structuredClone(p); assert.deepEqual(buyTruck(p, TANK), { ok: false, reason: 'owned' }); assert.deepEqual(buyUpgrade(p, 'engine'), { ok: false, reason: 'max' }); assert.deepEqual(p, before);
  assert.deepEqual(selectTruck(p, 'player_sedan_t1'), { ok: true }); assert.equal(effects(p).vehicleUpgradeLevels.engine, 1);
  assert.deepEqual(selectTruck(p, TANK), { ok: true }); assert.equal(effects(p).vehicleUpgradeLevels.engine, 3);
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(p))).vehicleUpgrades, p.vehicleUpgrades);
});

test('retained negative: exact previous normalizer/cloud schema silently lose falsely v2-labelled tank progress', () => {
  const unguarded = { ...value(false), v: 2 };
  assert.equal(Object.hasOwn(oldProfile.normalizeProfile(unguarded).vehicleUpgrades, 'tank'), false);
  assert.equal(Object.hasOwn(oldSchema.sanitizeProfile(unguarded).vehicleUpgrades, 'tank'), false);
});

test('exact previous SaveStore refuses v3 shared heads, backups, imports and recovery before normalization or byte mutation', () => {
  for (const owned of [true, false]) {
    const local = storage(), older = makeStore(local, true), pin = older.load(), newer = makeStore(local), p = newer.load();
    const stale = local.getItem(SAVE_STORE_KEY);
    Object.assign(p, value(owned), { campaignId: p.campaignId }); assert.equal(newer.save(p).ok, true);
    p.cash++; assert.equal(newer.save(p).ok, true); local.setItem(SAVE_BACKUP_KEY, stale);
    const original = bytes(local); let calls = 0;
    const oldAgain = makeStore(local, true, input => { if (input.v === 3) calls++; });
    assert.equal(oldAgain.status().error.code, 'unsupported-profile'); oldAgain.load(); assert.equal(calls, 0);
    pin.cash++; const rejected = older.save(pin); assert.equal(rejected.ok, false); assert.equal(rejected.error.code, 'unsupported-profile');
    assert.throws(() => oldAgain.list(), isCode('unsupported-profile')); assert.deepEqual(bytes(local), original);
    const clean = storage(), oldClean = makeStore(clean, true), cleanBefore = bytes(clean);
    assert.throws(() => oldClean.importSlot({ kind: 'rideordie-save', version: 2, name: 'Tank', profile: value(owned) }), isCode('unsupported-profile'));
    assert.deepEqual(bytes(clean), cleanBefore);
    const recovery = id(); clean.setItem(SAVE_RECOVERY_KEY, JSON.stringify({ version: 1, entries: [{ id: recovery, at: 1000, profile: value(owned) }] }));
    const recoveryBefore = bytes(clean); assert.throws(() => oldClean.restoreRecovery(recovery), isCode('unsupported-profile')); assert.deepEqual(bytes(clean), recoveryBefore);
  }
  const local = storage(), store = makeStore(local); store.retainBackup(store.activeId(), { profile: value(false), name: 'Unowned paid tank' });
  const original = bytes(local), old = makeStore(local, true); assert.equal(old.status().error.code, 'unsupported-profile'); assert.deepEqual(bytes(local), original);
});

test('current local slot v2 envelope round-trips all v3 family gear through save, backup, restore, duplicate, import and singleton migration', () => {
  for (const owned of [true, false]) {
    const local = storage(), store = makeStore(local), p = store.load(); Object.assign(p, value(owned), { campaignId: p.campaignId });
    assert.equal(store.save(p).ok, true); p.cash += 7; assert.equal(store.save(p).ok, true);
    const slot = store.activeId(), back = store.history(slot).find(row => row.profile.cash === 1000 && row.profile.v === 3); assert.ok(back);
    store.restore(slot, back.id); assertTank(store.load(), owned); assertTank(store.duplicate(slot, 'Tank copy').profile, owned);
    const envelope = store.exportSlot(slot); assert.equal(envelope.version, 2); assertTank(envelope.profile, owned);
    assertTank(store.importSlot(JSON.stringify(envelope), 'Tank import').profile, owned); assertTank(makeStore(local).load(slot), owned);
    const legacy = storage(); legacy.setItem('rideordie.profile.v1', JSON.stringify(value(owned))); assertTank(makeStore(legacy).load(), owned);
  }
  const previous = globalThis.localStorage, local = storage(), p = value(true);
  try { globalThis.localStorage = local; local.setItem('rideordie.profile.v1.' + p.campaignId, JSON.stringify(p)); assertTank(loadProfile(p.campaignId), true); }
  finally { globalThis.localStorage = previous; }
});

test('future versions, chassis, families and track keys fail raw before any local projection or overwrite', () => {
  assert.throws(() => assertSupportedProfile({ ...DEFAULT_PROFILE(), truck: TANK }, 2), isCode('unsupported-profile'), 'lower-capability callers cannot project an explicitly selected newer chassis, even with malformed ownership');
  const patches = [{ v: 4 }, { trucks: ['player_tank_future'] }, { truck: 'player_hovercraft_t1' },
    { vehicleUpgrades: { hovercraft: { armor: 1 } } }, { vehicleUpgrades: { tank: { futureDrive: 1 } } }];
  for (const patch of patches) {
    const p = { ...value(true), ...patch }, raw = structuredClone(p); assert.throws(() => assertSupportedProfile(p), isCode('unsupported-profile'));
    assert.throws(() => normalizeProfile(p), isCode('unsupported-profile')); assert.deepEqual(p, raw);
    const local = storage(), store = makeStore(local), before = bytes(local);
    assert.throws(() => store.importSlot({ kind: 'rideordie-save', version: 2, name: 'Future', profile: p }), isCode('unsupported-profile'));
    assert.deepEqual(bytes(local), before);
  }
});

class SqliteStorage {
  constructor() { this.db = new DatabaseSync(':memory:'); this.sql = { exec: (query, ...args) => {
    if (query.trim().startsWith('CREATE TABLE')) { this.db.exec(query); return { toArray: () => [] }; }
    const statement = this.db.prepare(query), rows = statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
    return { toArray: () => rows };
  } }; }
  transactionSync(callback) { this.db.exec('BEGIN IMMEDIATE'); try { const value = callback(); assert.ok(!(value instanceof Promise)); this.db.exec('COMMIT'); return value; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  progress() { return JSON.stringify({ sequence: this.db.prepare("SELECT value FROM vault_meta WHERE key = 'versionSequence'").all(),
    slots: this.db.prepare('SELECT * FROM slots ORDER BY id').all(), backups: this.db.prepare('SELECT * FROM backups ORDER BY slot_id, version').all() }); }
}
function service(t) {
  const objects = new Map(), forwarded = [], requests = [], secret = `ROD1-${'T'.repeat(43)}`, endpoint = 'https://tank-save.local';
  const env = { SAVE_IP_LIMIT: { limit: async () => ({ success: true }) }, SAVE_VAULT_LIMIT: { limit: async () => ({ success: true }) },
    SAVE_VAULTS: { idFromName: value => value, get(key) { if (!objects.has(key)) { const storage = new SqliteStorage(); objects.set(key, { storage, vault: new SaveVault({ storage }, env) }); }
      return { fetch(request) { forwarded.push([...request.headers.entries()]); return objects.get(key).vault.fetch(request); } }; } } };
  t.after(() => { for (const row of objects.values()) row.storage.db.close(); });
  const fetch = (url, options = {}) => { const headers = new Headers(options.headers); headers.set('Origin', 'https://ride.maxyaport.com');
    headers.set('CF-Connecting-IP', '192.0.2.87'); requests.push({ method: options.method || 'GET', path: new URL(url).pathname });
    return worker.fetch(new Request(url, { ...options, headers }), env); };
  const send = async (method, path, body, capability = '3') => {
    const response = await fetch(endpoint + path, { method, headers: { Authorization: 'Bearer ' + secret,
      ...(capability === null ? {} : { 'X-ROD-Profile-Version': capability }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), headers: response.headers };
  };
  return { objects, forwarded, requests, secret, endpoint, fetch, send, progress: () => [...objects.values()].map(row => row.storage.progress()) };
}

test('public Worker forwards exact profile capability; unsupported headers and preflight leave vault untouched', async t => {
  const s = service(t), cors = await s.send('OPTIONS', '/v1/vault', undefined); assert.equal(cors.status, 204);
  assert.match(cors.headers.get('Access-Control-Allow-Headers'), /X-ROD-Profile-Version/);
  for (const cap of ['0', '4', '03', '3, 2', '3.0', 'garbage']) {
    const r = await s.send('POST', '/v1/vault', undefined, cap); assert.equal(r.status, 409); assert.equal(r.data.error, 'unsupported_profile');
  }
  assert.equal(s.objects.size, 0);
  assert.equal((await s.send('POST', '/v1/vault', undefined, null)).status, 200);
  assert.equal(new Map(s.forwarded.at(-1)).get('x-rod-profile-version'), '2');
  await s.send('GET', '/v1/vault'); assert.equal(new Map(s.forwarded.at(-1)).get('x-rod-profile-version'), '3');
  assert.equal(new Map(s.forwarded.at(-1)).has('authorization'), false);
});

test('old capabilities cannot PUT over, delete or restore v3 head/source; exact heads, backups, receipts and sequences survive refusals', async t => {
  for (const owned of [true, false]) await t.test(owned ? 'owned chassis' : 'positive unowned gear', async t => {
    const s = service(t), slot = id(); await s.send('POST', '/v1/vault');
    const first = await s.send('PUT', '/v1/slots/' + slot, { name: 'Tank', profile: value(owned), baseVersion: 0, mutationId: id() }); assert.equal(first.status, 200);
    const v3 = first.data.slot, original = s.progress();
    for (const cap of [null, '1', '2']) for (const [method, path, data] of [
      ['PUT', '/v1/slots/' + slot, { name: 'Old overwrite', profile: oldProfile.normalizeProfile(DEFAULT_PROFILE()), baseVersion: v3.version, mutationId: id() }],
      ['DELETE', '/v1/slots/' + slot, { baseVersion: v3.version, mutationId: id() }],
      ['POST', '/v1/slots/' + slot + '/restore', { backupId: 'current', baseVersion: v3.version, mutationId: id() }],
    ]) { const r = await s.send(method, path, data, cap); assert.equal(r.status, 409); assert.equal(r.data.error, 'unsupported_profile'); assert.deepEqual(s.progress(), original); }
    assert.deepEqual((await s.send('GET', '/v1/vault', undefined, null)).data.slots[0], v3, 'GET must expose exact stored v3, never legacy projection');
    const replacement = await s.send('PUT', '/v1/slots/' + slot, { name: 'Legacy head', profile: oldProfile.normalizeProfile(DEFAULT_PROFILE()), baseVersion: v3.version, mutationId: id() }); assert.equal(replacement.status, 200);
    const backup = (await s.send('GET', '/v1/slots/' + slot + '/history')).data.history.find(row => row.profile.v === 3); assert.ok(backup);
    const unchanged = s.progress();
    for (const cap of [null, '1', '2']) { const r = await s.send('POST', '/v1/slots/' + slot + '/restore', { backupId: backup.id, baseVersion: replacement.data.slot.version, mutationId: id() }, cap); assert.equal(r.status, 409); assert.equal(r.data.error, 'unsupported_profile'); assert.deepEqual(s.progress(), unchanged); }
    const restored = await s.send('POST', '/v1/slots/' + slot + '/restore', { backupId: backup.id, baseVersion: replacement.data.slot.version, mutationId: id() }); assert.equal(restored.status, 200); assertTank(restored.data.slot.profile, owned);
  });
});

test('frozen old cloud refuses v3 pull before pending CAS, while current cloud round-trips tank progress with header3', async t => {
  const s = service(t); await s.send('POST', '/v1/vault');
  const oldLocal = storage(), old = makeStore(oldLocal, true), oldCloud = new OldCloudSaves({ store: old, storage: oldLocal, fetch: s.fetch, url: s.endpoint, debounceMs: 5000 }); t.after(() => oldCloud.dispose());
  assert.equal((await oldCloud.connect(s.secret)).status, 'connected');
  const pin = old.load(); pin.cash++; assert.equal(old.save(pin).ok, true); oldCloud._clearTimer();
  const oldSlot = old.list().find(row => row.id === old.activeId()), ack = JSON.parse(oldLocal.getItem('rideordie.cloud.v1')).acks[oldSlot.id];
  oldCloud._queueSlot(oldSlot, ack.version);
  const slot = id(); assert.equal((await s.send('PUT', '/v1/slots/' + slot, { name: 'Tank', profile: value(true), baseVersion: 0, mutationId: id() })).status, 200);
  const before = s.progress(), disk = bytes(oldLocal), count = s.requests.filter(row => row.method !== 'GET').length;
  assert.equal((await oldCloud.sync()).status, 'error'); assert.deepEqual(s.progress(), before); assert.deepEqual(bytes(oldLocal), disk);
  assert.equal(s.requests.filter(row => row.method !== 'GET').length, count);
  const local = storage(), store = makeStore(local), cloud = new CloudSaves({ store, storage: local, fetch: s.fetch, url: s.endpoint, debounceMs: 5000 }); t.after(() => cloud.dispose());
  assert.equal((await cloud.connect(s.secret)).status, 'connected'); assertTank(store.list().find(row => row.id === slot).profile, true);
  const p = store.load(); Object.assign(p, value(false), { campaignId: p.campaignId }); assert.equal(store.save(p).ok, true); cloud._clearTimer();
  assert.equal((await cloud.sync()).status, 'connected'); assert.ok(s.forwarded.some(row => new Map(row).get('x-rod-profile-version') === '3'));
  const head = (await s.send('GET', '/v1/vault')).data.slots.find(row => row.id === store.activeId()); assertTank(head.profile, false);
});
