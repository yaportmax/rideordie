import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudSaves } from '../src/meta/cloud_saves.js';
import { SaveStore } from '../src/meta/save_store.js';
import { sanitizeProfile, sanitizeName, canonicalJson, contentHash } from '../server/saves/schema.js';

const KEY = 'rideordie.cloud.v1';
const CODE_A = `ROD1-${'A'.repeat(43)}`, CODE_B = `ROD1-${'B'.repeat(43)}`;
const clone = value => structuredClone(value);
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const profile = (cash = 0, campaignId = 'personal-1') => sanitizeProfile({ v: 1, campaignId, cash });
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(body) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class MemoryStorage {
  data = new Map();
  fail = false;
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { if (this.fail && key === KEY) throw new Error('quota'); this.data.set(key, String(value)); }
  removeItem(key) { if (this.fail && key === KEY) throw new Error('blocked'); this.data.delete(key); }
}

// A controlled network boundary implementing CAS and exact current-head
// mutation receipts. Server validation/security has its own dedicated suite.
class VaultService {
  vaults = new Map();
  requests = [];
  interceptor = null;
  active = 0;
  maxActive = 0;
  async seed(code, slotId, value, name = 'Main save', deleted = false) {
    if (!this.vaults.has(code)) this.vaults.set(code, { slots: new Map(), history: new Map(), sequence: 0 });
    const vault = this.vaults.get(code), previous = vault.slots.get(slotId);
    const row = { id: slotId, name: sanitizeName(name), profile: sanitizeProfile(value), deleted,
      version: ++vault.sequence, updatedAt: 1000 + vault.sequence, hash: await contentHash(sanitizeName(name), sanitizeProfile(value), deleted) };
    if (previous) {
      const history = vault.history.get(slotId) || [];
      history.unshift({ id: `backup-${previous.version}`, at: previous.updatedAt, ...clone(previous) });
      // The backup ID is independent of the slot identity.
      history[0].id = `backup-${previous.version}`;
      vault.history.set(slotId, history.slice(0, 10));
    }
    vault.slots.set(slotId, row); return clone(row);
  }
  fetch = async (url, options = {}) => {
    const request = { url, method: options.method || 'GET', headers: options.headers, signal: options.signal,
      text: options.body || null, body: options.body ? JSON.parse(options.body) : null };
    this.requests.push(request); this.active++; this.maxActive = Math.max(this.maxActive, this.active);
    try { return this.interceptor ? await this.interceptor(request, () => this.dispatch(request)) : await this.dispatch(request); }
    finally { this.active--; }
  };
  async dispatch(request) {
    const code = request.headers?.Authorization?.replace(/^Bearer /, ''), path = new URL(request.url).pathname;
    if (path === '/v1/vault' && request.method === 'POST') {
      if (!this.vaults.has(code)) this.vaults.set(code, { slots: new Map(), history: new Map(), sequence: 0 });
      return response(200, { version: 1, slots: [] });
    }
    const vault = this.vaults.get(code);
    if (!vault) return response(404, { error: 'not_found' });
    if (path === '/v1/vault') return response(200, { version: 1, slots: [...vault.slots.values()] });
    const match = /^\/v1\/slots\/([^/]+)(?:\/(history|restore))?$/.exec(path);
    if (!match) return response(404, { error: 'not_found' });
    const slotId = match[1], current = vault.slots.get(slotId);
    if (match[2] === 'history') return response(200, { history: vault.history.get(slotId) || [] });
    const body = request.body, fingerprint = canonicalJson({ method: request.method, path, body });
    if (current?.receipt?.mutationId === body.mutationId && current.receipt.fingerprint === fingerprint) return response(200, { slot: current });
    if ((current?.version || 0) !== body.baseVersion) return response(409, { error: 'conflict', slot: current || null });
    let changed;
    if (request.method === 'PUT') changed = await this.seed(code, slotId, body.profile, body.name, false);
    else if (request.method === 'DELETE') {
      if (!current) return response(409, { error: 'conflict', slot: null });
      changed = await this.seed(code, slotId, current.profile, current.name, true);
    } else if (match[2] === 'restore') {
      const backup = body.backupId === 'current' ? current : vault.history.get(slotId)?.find(item => item.id === body.backupId);
      if (!backup) return response(404, { error: 'backup_not_found' });
      changed = await this.seed(code, slotId, backup.profile, backup.name, false);
    } else return response(405, { error: 'method' });
    changed.receipt = { mutationId: body.mutationId, fingerprint }; vault.slots.set(slotId, changed);
    return response(200, { slot: changed });
  }
}

function harness(t, { service = new VaultService(), storage = new MemoryStorage(), firstId = 1, gate = () => true,
  debounceMs = 5000, timeoutMs = 2000 } = {}) {
  let nextId = firstId;
  const store = new SaveStore({ storage, normalize: sanitizeProfile, fresh: () => profile(), id: () => id(nextId++) });
  const changes = [];
  const cloud = new CloudSaves({ store, storage, fetch: service.fetch, canApplyRemote: gate, debounceMs, timeoutMs,
    retryBaseMs: 60000, retryMaxMs: 60000, onChange: state => changes.push(state) });
  t.after(() => cloud.dispose());
  return { store, cloud, storage, service, changes };
}
function saveCash(store, cash, slotId = store.activeId()) {
  const loaded = store.load(slotId); loaded.cash = cash; loaded.revision++;
  const saved = store.save(loaded); assert.equal(saved.ok, true); return loaded;
}
const persisted = storage => JSON.parse(storage.getItem(KEY));
const writes = service => service.requests.filter(request => ['PUT', 'DELETE'].includes(request.method) || request.url.endsWith('/restore'));

test('new vault code is persisted before its first request and stays outside progress, exports, state and URLs', async t => {
  const h = harness(t); let observed;
  h.service.interceptor = async (request, next) => {
    if (request.method === 'POST' && request.url.endsWith('/v1/vault')) observed = persisted(h.storage).code;
    return next();
  };
  const state = await h.cloud.createVault(), code = h.cloud.recoveryCode();
  assert.match(code, /^ROD1-[A-Za-z0-9_-]{43}$/); assert.equal(observed, code);
  assert.equal(state.status, 'connected'); assert.equal(state.pending, 0);
  for (const value of [state, h.changes, h.store.list(), h.store.exportSlot(h.store.activeId())]) assert.equal(JSON.stringify(value).includes(code), false);
  for (const request of h.service.requests) {
    assert.equal(request.url.includes(code), false); assert.equal((request.text || '').includes(code), false);
    assert.equal(request.headers.Authorization, `Bearer ${code}`);
  }
  assert.equal(h.storage.getItem('rideordie.profile.v1').includes(code), false);
});

test('first connection imports missing IDs without selecting them and flags divergent same-ID content', async t => {
  const h = harness(t), active = h.store.activeId(), pinned = h.store.load();
  saveCash(h.store, 450);
  await h.service.seed(CODE_A, active, profile(900));
  await h.service.seed(CODE_A, id(50), profile(120, 'second-device'), 'Cloud road');
  const state = await h.cloud.connect(CODE_A);
  assert.equal(h.store.activeId(), active); assert.equal(h.store.load().cash, 450); assert.equal(pinned.cash, 0);
  assert.equal(h.store.list().find(slot => slot.id === id(50)).profile.cash, 120);
  assert.equal(state.conflicts.length, 1); assert.equal(state.conflicts[0].local.profile.cash, 450);
  assert.equal(state.conflicts[0].remote.profile.cash, 900); assert.equal(writes(h.service).length, 0);
});

test('invalid or unknown recovery code does not replace a previously validated vault or its acknowledgements', async t => {
  const h = harness(t); await h.cloud.createVault();
  const original = h.storage.getItem(KEY), code = h.cloud.recoveryCode();
  await h.cloud.connect('bad-code'); assert.equal(h.storage.getItem(KEY), original);
  await h.cloud.connect(CODE_B); assert.equal(h.cloud.recoveryCode(), code); assert.equal(h.storage.getItem(KEY), original);
  assert.equal(h.cloud.state().status, 'error');
});

test('offline accepted-but-lost PUT retries the identical immutable mutation across reload before sending newer progress', async t => {
  const h = harness(t); await h.cloud.createVault();
  const slotId = h.store.activeId(), code = h.cloud.recoveryCode(); saveCash(h.store, 100);
  let lost = false;
  h.service.interceptor = async (request, next) => {
    const result = await next();
    if (request.method === 'PUT' && !lost) { lost = true; throw new Error(`network ${code}`); }
    return result;
  };
  assert.equal((await h.cloud.sync()).status, 'offline');
  const queued = clone(persisted(h.storage).outbox[slotId]); assert.equal(queued.body.profile.cash, 100);
  assert.equal(JSON.stringify(h.cloud.state()).includes(code), false);
  saveCash(h.store, 200); assert.deepEqual(persisted(h.storage).outbox[slotId], queued);
  h.cloud.dispose(); h.service.interceptor = null;
  const restarted = harness(t, { storage: h.storage, service: h.service, firstId: 100 });
  assert.equal((await restarted.cloud.sync()).status, 'connected');
  const requests = writes(h.service), retry = requests.findLast(request => request.body.mutationId === queued.body.mutationId);
  assert.equal(retry.text, JSON.stringify(queued.body));
  assert.equal(requests.filter(request => request.body.mutationId === queued.body.mutationId).length, 2);
  assert.equal(h.service.vaults.get(code).slots.get(slotId).profile.cash, 200);
  assert.equal(restarted.store.load().cash, 200); assert.equal(Object.keys(persisted(h.storage).outbox).length, 0);
});

test('two devices branching from one head conflict without cash/revision newest-wins heuristics', async t => {
  const service = new VaultService(), a = harness(t, { service }), b = harness(t, { service });
  await a.cloud.createVault(); await b.cloud.connect(a.cloud.recoveryCode());
  const pa = saveCash(a.store, 900), pb = saveCash(b.store, 100); pb.revision = pa.revision + 100; assert.equal(b.store.save(pb).ok, true);
  await a.cloud.sync(); const state = await b.cloud.sync();
  assert.equal(state.status, 'conflict'); assert.equal(b.store.load().cash, 100);
  assert.equal(state.conflicts[0].remote.profile.cash, 900); assert.equal(state.conflicts[0].local.profile.cash, 100);
  assert.equal(service.vaults.get(a.cloud.recoveryCode()).slots.get(a.store.activeId()).profile.cash, 900);
});

test('explicit local conflict choice retains cloud loser and CAS-writes against its exact version', async t => {
  const h = harness(t); await h.cloud.createVault(); const slotId = h.store.activeId(), code = h.cloud.recoveryCode();
  saveCash(h.store, 300); const remote = await h.service.seed(code, slotId, profile(700)); await h.cloud.sync();
  const state = await h.cloud.resolve(slotId, 'local');
  assert.equal(state.status, 'connected'); assert.equal(h.store.load().cash, 300);
  assert.ok(h.store.history(slotId).some(backup => backup.profile.cash === 700));
  assert.equal(writes(h.service).at(-1).body.baseVersion, remote.version);
  assert.equal(h.service.vaults.get(code).slots.get(slotId).profile.cash, 300);
});

test('both conflict choice preserves local branch in a fresh slot/campaign and cloud branch in original history', async t => {
  const h = harness(t); await h.cloud.createVault(); const slotId = h.store.activeId(), code = h.cloud.recoveryCode();
  const pinned = saveCash(h.store, 300); await h.service.seed(code, slotId, profile(700)); await h.cloud.sync();
  await h.cloud.resolve(slotId, 'both');
  const slots = h.store.list(), copy = slots.find(slot => slot.id !== slotId);
  assert.equal(slots.length, 2); assert.equal(h.store.activeId(), slotId); assert.equal(h.store.load().cash, 700);
  assert.equal(copy.profile.cash, 300); assert.notEqual(copy.profile.campaignId, pinned.campaignId);
  assert.match(copy.name, /conflict copy/); assert.equal(pinned.cash, 300);
  assert.ok(h.store.history(slotId).some(backup => backup.profile.cash === 300));
});

test('clean remote active-head pull is deferred while gameplay is active and legitimate pinned autosave remains valid', async t => {
  let safe = true; const h = harness(t, { gate: () => safe }); await h.cloud.createVault();
  const slotId = h.store.activeId(), pinned = h.store.load(), generation = h.store.list()[0].generation;
  safe = false; await h.service.seed(h.cloud.recoveryCode(), slotId, profile(800));
  const state = await h.cloud.sync(); assert.equal(state.status, 'pending'); assert.equal(state.pending, 1);
  assert.equal(h.store.list()[0].generation, generation); assert.equal(h.store.load().cash, 0);
  pinned.cash = 150; pinned.revision++; assert.equal(h.store.save(pinned).ok, true);
  safe = true; assert.equal((await h.cloud.sync()).status, 'conflict');
  await h.cloud.resolve(slotId, 'cloud'); assert.equal(h.store.load().cash, 800); assert.equal(pinned.cash, 150);
  assert.ok(h.store.history(slotId).some(backup => backup.profile.cash === 150));
});

test('disconnect cancels a delayed fetch, clears only credential and prevents its late remote import', async t => {
  const h = harness(t); await h.cloud.createVault(); const code = h.cloud.recoveryCode();
  await h.service.seed(code, id(80), profile(400, 'late-road'), 'Late road');
  const entered = deferred(), release = deferred();
  h.service.interceptor = async (request, next) => { if (request.method === 'GET') { entered.resolve(request); await release.promise; } return next(); };
  const pending = h.cloud.sync(), request = await entered.promise;
  const state = h.cloud.disconnect(); assert.equal(request.signal.aborted, true); assert.equal(state.connected, false);
  assert.equal(h.storage.getItem(KEY), null); assert.equal(h.store.list().length, 1);
  await pending; release.resolve(); await tick(); assert.equal(h.store.list().length, 1); assert.equal(h.cloud.recoveryCode(), null);
});

test('another tab changing vault ownership during GET cannot apply old-vault progress', async t => {
  const h = harness(t); await h.cloud.createVault(); const slotId = h.store.activeId();
  await h.service.seed(h.cloud.recoveryCode(), slotId, profile(600));
  const entered = deferred(), release = deferred();
  h.service.interceptor = async (request, next) => { if (request.method === 'GET') { entered.resolve(); await release.promise; } return next(); };
  const pending = h.cloud.sync(); await entered.promise;
  h.storage.removeItem(KEY); release.resolve(); await pending;
  assert.equal(h.store.load().cash, 0); assert.equal(h.cloud.state().connected, false); assert.equal(h.cloud.state().status, 'disconnected');
});

test('title gate is rechecked after the conflict-decision GET before creating a copy or changing backups', async t => {
  let safe = true; const h = harness(t, { gate: () => safe }); await h.cloud.createVault(); const slotId = h.store.activeId();
  saveCash(h.store, 50); await h.service.seed(h.cloud.recoveryCode(), slotId, profile(500)); await h.cloud.sync();
  const before = h.store.history(slotId), entered = deferred(), release = deferred();
  h.service.interceptor = async (request, next) => { if (request.method === 'GET') { entered.resolve(); await release.promise; } return next(); };
  const pending = h.cloud.resolve(slotId, 'both'); await entered.promise; safe = false; release.resolve();
  const state = await pending; assert.equal(state.status, 'error'); assert.equal(h.store.list().length, 1);
  assert.equal(h.store.load().cash, 50); assert.deepEqual(h.store.history(slotId), before);
});

test('pruned acknowledged cloud ID conflicts and explicit local recovery publishes a fresh ID without recreating the old one', async t => {
  const h = harness(t); await h.cloud.createVault(); const slotId = h.store.activeId(), code = h.cloud.recoveryCode();
  h.service.vaults.get(code).slots.delete(slotId); const state = await h.cloud.sync();
  assert.equal(state.status, 'conflict'); assert.equal(state.conflicts[0].remote, null);
  const requestCount = writes(h.service).length; await h.cloud.resolve(slotId, 'local');
  const copy = h.store.list().find(slot => slot.id !== slotId);
  assert.ok(copy); assert.notEqual(copy.profile.campaignId, h.store.load(slotId).campaignId);
  assert.equal(h.service.vaults.get(code).slots.has(slotId), false); assert.equal(h.service.vaults.get(code).slots.has(copy.id), true);
  assert.ok(writes(h.service).slice(requestCount).every(request => !request.url.endsWith(`/slots/${slotId}`)));
  assert.equal((await h.cloud.sync()).status, 'connected');
});

test('queued CAS returning conflict with a missing head releases outbox into a resolvable missing-ID conflict', async t => {
  const h = harness(t); await h.cloud.createVault(); const slotId = h.store.activeId(), code = h.cloud.recoveryCode(); saveCash(h.store, 250);
  h.service.interceptor = async request => { if (request.method === 'PUT') throw new Error('offline'); return h.service.dispatch(request); };
  await h.cloud.sync(); assert.ok(persisted(h.storage).outbox[slotId]);
  h.service.vaults.get(code).slots.delete(slotId); h.service.interceptor = null;
  const state = await h.cloud.sync(); assert.equal(state.status, 'conflict'); assert.equal(state.conflicts[0].remote, null);
  assert.equal(persisted(h.storage).outbox[slotId], undefined); assert.equal(h.store.load().cash, 250);
});

test('remote history restore uses known CAS, retains current local backup and does not mutate a previously loaded object', async t => {
  const h = harness(t); await h.cloud.createVault(); const slotId = h.store.activeId();
  saveCash(h.store, 120); await h.cloud.sync(); const pinned = h.store.load(), history = await h.cloud.history(slotId);
  assert.ok(history.length); assert.equal(history[0].profile.cash, 0);
  const before = persisted(h.storage).acks[slotId].version;
  const state = await h.cloud.restoreCloud(slotId, history[0].id);
  assert.equal(state.status, 'connected'); assert.equal(h.store.load().cash, 0); assert.equal(pinned.cash, 120);
  assert.ok(h.store.history(slotId).some(backup => backup.profile.cash === 120));
  const request = writes(h.service).at(-1); assert.equal(request.body.baseVersion, before); assert.match(request.body.mutationId, /^[0-9a-f-]{36}$/);
});

test('offline newer local content followed by delete retains that content as backup even when cloud tombstone uses older head', async t => {
  const h = harness(t); await h.cloud.createVault(); const extra = h.store.create('Extra', profile(100, 'extra-person'));
  await h.cloud.sync(); saveCash(h.store, 600, extra.id); h.store.remove(extra.id);
  const state = await h.cloud.sync(); assert.equal(state.status, 'connected');
  const deleted = h.store.list({ includeDeleted: true }).find(slot => slot.id === extra.id);
  assert.equal(deleted.deleted, true); assert.ok(h.store.history(extra.id).some(backup => backup.profile.cash === 600));
  assert.equal(h.service.vaults.get(h.cloud.recoveryCode()).slots.get(extra.id).deleted, true);
});

test('legitimate24-row vault including12 tombstones connects and reloads its private acknowledgement maps', async t => {
  const h = harness(t); const mainId = h.store.activeId();
  await h.service.seed(CODE_A, mainId, profile());
  for (let n = 2; n <= 24; n++) await h.service.seed(CODE_A, id(n), profile(n, `person-${n}`), `Road ${n}`, n > 12);
  assert.equal((await h.cloud.connect(CODE_A)).status, 'connected');
  assert.equal(h.store.list().length, 12); assert.equal(h.store.list({ includeDeleted: true }).length, 24);
  h.cloud.dispose(); const reloaded = harness(t, { storage: h.storage, service: h.service, firstId: 100 });
  assert.equal(reloaded.cloud.state().connected, true); assert.equal((await reloaded.cloud.sync()).status, 'connected');
});

test('debounced autosaves serialize fetches and upload committed personal slot snapshots without blocking synchronous saves', async t => {
  const h = harness(t, { debounceMs: 5 }); await h.cloud.createVault();
  const entered = deferred(), release = deferred(); let blocked = false;
  h.service.interceptor = async (request, next) => {
    if (request.method === 'PUT' && !blocked) { blocked = true; entered.resolve(); await release.promise; }
    return next();
  };
  saveCash(h.store, 10); saveCash(h.store, 20); await entered.promise;
  const last = saveCash(h.store, 30); assert.equal(last.cash, 30); const sync = h.cloud.sync();
  release.resolve(); await sync; await delay(20);
  assert.equal(h.service.maxActive, 1); assert.equal(h.store.load().cash, 30);
  assert.equal(h.service.vaults.get(h.cloud.recoveryCode()).slots.get(h.store.activeId()).profile.cash, 30);
});

test('bounded request timeout keeps immutable outbox and reports a secret-free error', async t => {
  const h = harness(t, { timeoutMs: 15 }); await h.cloud.createVault(); saveCash(h.store, 70);
  const release = deferred(); h.service.interceptor = async (request, next) => request.method === 'PUT' ? (await release.promise, next()) : next();
  // Keep a referenced fixture timer while the request's bounded timer runs.
  const [state] = await Promise.all([h.cloud.sync(), delay(30)]);
  assert.equal(state.status, 'offline'); assert.match(state.error, /timed out/);
  assert.ok(persisted(h.storage).outbox[h.store.activeId()]); assert.equal(JSON.stringify(state).includes(h.cloud.recoveryCode()), false);
  release.resolve(); await tick(); assert.ok(persisted(h.storage).outbox[h.store.activeId()]);
});

test('credential persistence failure prevents an upload and does not report a successful disconnect', async t => {
  const h = harness(t); await h.cloud.createVault(); saveCash(h.store, 90); const count = writes(h.service).length;
  h.storage.fail = true; const state = await h.cloud.sync(); assert.equal(state.status, 'error'); assert.equal(writes(h.service).length, count);
  const disconnected = h.cloud.disconnect(); assert.equal(disconnected.connected, false); assert.equal(disconnected.status, 'error');
  assert.match(disconnected.error, /could not be removed/); assert.ok(h.storage.getItem(KEY)); assert.equal(h.store.load().cash, 90);
});

test('unknown vault-create outcome retries the persisted recovery code across reload', async t => {
  const h = harness(t); let lose = true;
  h.service.interceptor = async (request, next) => {
    const result = await next();
    if (request.method === 'POST' && request.url.endsWith('/v1/vault') && lose) { lose = false; throw new Error('lost create response'); }
    return result;
  };
  const state = await h.cloud.createVault(), code = h.cloud.recoveryCode();
  assert.equal(state.status, 'offline'); assert.equal(state.pending, 1); assert.equal(persisted(h.storage).creating, true);
  h.cloud.dispose(); h.service.interceptor = null;
  const restarted = harness(t, { storage: h.storage, service: h.service, firstId: 100 });
  await restarted.cloud.sync(); assert.equal(restarted.cloud.recoveryCode(), code);
  const creates = h.service.requests.filter(request => request.method === 'POST' && request.url.endsWith('/v1/vault'));
  assert.equal(creates.length, 2); assert.equal(creates[0].headers.Authorization, creates[1].headers.Authorization);
  assert.equal(h.service.vaults.size, 1);
});

test('active remote deletion conflicts and both choice cannot partially create copies before refusing deletion', async t => {
  const h = harness(t); await h.cloud.createVault(); const slotId = h.store.activeId();
  await h.service.seed(h.cloud.recoveryCode(), slotId, profile(), 'Main save', true);
  const state = await h.cloud.sync(); assert.equal(state.status, 'conflict'); assert.equal(state.conflicts[0].remote.deleted, true);
  const before = h.store.history(slotId);
  assert.equal((await h.cloud.resolve(slotId, 'both')).status, 'error');
  assert.equal(h.store.list().length, 1); assert.deepEqual(h.store.history(slotId), before);
  await h.cloud.resolve(slotId, 'local'); assert.equal(h.store.load().cash, 0);
  assert.equal(h.service.vaults.get(h.cloud.recoveryCode()).slots.get(slotId).deleted, false);
});

test('a deferred active remote head pruned before the next sync becomes a missing conflict instead of permanent pending', async t => {
  let safe = true; const h = harness(t, { gate: () => safe }); await h.cloud.createVault(); const slotId = h.store.activeId(), code = h.cloud.recoveryCode();
  safe = false; await h.service.seed(code, slotId, profile(80)); assert.equal((await h.cloud.sync()).status, 'pending');
  h.service.vaults.get(code).slots.delete(slotId); safe = true;
  const state = await h.cloud.sync(); assert.equal(state.status, 'conflict'); assert.equal(state.conflicts[0].remote, null);
  assert.equal(h.store.load().cash, 0);
});

test('unsupported future profile or excess live response is rejected before any local import', async t => {
  const h = harness(t), slotId = h.store.activeId(); await h.service.seed(CODE_A, slotId, profile());
  const row = await h.service.seed(CODE_A, id(80), profile(55, 'future-road'), 'Future road');
  row.profile.v = 2; h.service.vaults.get(CODE_A).slots.set(id(80), row);
  assert.equal((await h.cloud.connect(CODE_A)).status, 'error'); assert.equal(h.storage.getItem(KEY), null); assert.equal(h.store.list().length, 1);
  h.service.vaults.get(CODE_A).slots.delete(id(80));
  for (let n = 2; n <= 13; n++) await h.service.seed(CODE_A, id(n), profile(n, `road-${n}`), `Road ${n}`);
  assert.equal((await h.cloud.connect(CODE_A)).status, 'error'); assert.equal(h.store.list().length, 1); assert.equal(h.storage.getItem(KEY), null);
});
