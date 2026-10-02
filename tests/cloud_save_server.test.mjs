import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { normalizeProfile } from '../src/meta/profile.js';
import { MAX_BODY_BYTES, sanitizeProfile, canonicalJson } from '../server/saves/schema.js';

// Only the platform base constructor is substituted. Every HTTP handler,
// authorization check, schema projection, query and transaction is production
// source. Real SQLite enforces constraints and rolls back injected write faults.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'fixture:cloudflare-workers', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'fixture:cloudflare-workers') return { format: 'module', source: 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
    return next(url, context);
  },
});
let worker, SaveVault;
try { ({ default: worker, SaveVault } = await import('../server/saves/worker.js')); }
finally { hooks.deregister(); }

class SqliteStorage {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.transactions = 0;
    this.fail = null;
    this.sql = { exec: (query, ...bindings) => {
      if (this.fail?.(query)) throw new Error('injected sqlite write failure');
      if (query.trim().startsWith('CREATE TABLE')) {
        this.db.exec(query);
        return { toArray: () => [] };
      }
      const statement = this.db.prepare(query);
      const rows = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { toArray: () => rows };
    } };
  }
  transactionSync(callback) {
    this.transactions++;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      assert.ok(!(result instanceof Promise), 'DO transaction callback must remain synchronous');
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  dump() {
    return JSON.stringify(['vault_meta', 'slots', 'backups'].map(table => this.db.prepare(`SELECT * FROM ${table}`).all()));
  }
}

const ORIGIN = 'https://ride.maxyaport.com';
const URL_BASE = 'https://ride-or-die-saves.yaportmax.workers.dev';
const code = () => `ROD1-${randomBytes(32).toString('base64url')}`;
const profile = (cash = 0, extra = {}) => normalizeProfile({ v: 1, campaignId: 'personal-campaign', cash, totalCash: cash, ...extra });
function harness(t, { emptyPostForwarding = false } = {}) {
  const objects = new Map(), forwarded = [], identities = [], ips = [], privateLimits = [];
  const env = {
    SAVE_IP_LIMIT: { async limit({ key }) { ips.push(key); return { success: true }; } },
    SAVE_VAULT_LIMIT: { async limit({ key }) { privateLimits.push(key); return { success: true }; } },
    SAVE_VAULTS: {
      idFromName(name) { identities.push(name); return name; },
      get(id) {
        if (!objects.has(id)) {
          const storage = new SqliteStorage();
          objects.set(id, { storage, vault: new SaveVault({ storage }, env) });
        }
        return { fetch(request) {
          forwarded.push({ url: request.url, headers: [...request.headers.entries()] });
          if (emptyPostForwarding && request.method === 'POST' && new URL(request.url).pathname === '/v1/vault' && !request.body) {
            request = new Request(request.url, { method: 'POST', headers: request.headers, body: new ReadableStream({ start(controller) { controller.close(); } }), duplex: 'half' });
          }
          return objects.get(id).vault.fetch(request);
        } };
      },
    },
  };
  t.after(() => { for (const { storage } of objects.values()) storage.db.close(); });
  async function send(method, path, recovery = null, body, options = {}) {
    const headers = new Headers({ 'CF-Connecting-IP': '192.0.2.44' });
    if (options.origin !== null) headers.set('Origin', options.origin || ORIGIN);
    if (recovery !== null) headers.set('Authorization', `Bearer ${recovery}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    for (const [key, value] of Object.entries(options.headers || {})) headers.set(key, value);
    const response = await worker.fetch(new Request(`${URL_BASE}${path}`, { method, headers, ...(body !== undefined ? { body: options.raw ? body : JSON.stringify(body) } : {}) }), env);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, headers: response.headers, data };
  }
  return { env, objects, forwarded, identities, ips, privateLimits, send };
}
const put = (h, recovery, id, baseVersion, cash = 0, extra = {}) => h.send('PUT', `/v1/slots/${id}`, recovery, { name: 'Main save', profile: profile(cash), baseVersion, ...extra });

test('public health and strict CORS reject arbitrary, null, missing, pathful and HTTPS local origins before data access', async t => {
  const h = harness(t);
  assert.equal((await h.send('GET', '/health', null, undefined, { origin: null })).data.service, 'ride-or-die-saves');
  for (const origin of ['https://evil.example', 'null', 'https://ride.maxyaport.com.evil.example', 'https://ride.maxyaport.com/path', 'https://localhost:5173', 'http://127.0.0.1.evil.example', 'http://localhost:5173/path']) {
    const r = await h.send('GET', '/v1/vault', code(), undefined, { origin });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal((await h.send('GET', '/v1/vault', code(), undefined, { origin: null })).status, 403);
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:4173', ORIGIN]) {
    const r = await h.send('OPTIONS', '/v1/vault', null, undefined, { origin, headers: { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type,if-match' } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), origin);
    assert.match(r.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  }
  assert.equal((await h.send('OPTIONS', '/v1/vault', null, undefined, { headers: { 'Access-Control-Request-Headers': 'x-untrusted' } })).status, 403);
  assert.equal(h.objects.size, 0);
});

test('bearer shape is required and private codes isolate the same slot/campaign without raw credentials crossing or entering SQL', async t => {
  const h = harness(t), a = code(), b = code(), id = randomUUID();
  for (const bad of [null, 'short', `ROD1-${'a'.repeat(42)}`, `ROD1-${'a'.repeat(44)}`, `ROD1-${'+'.repeat(43)}`]) assert.equal((await h.send('POST', '/v1/vault', bad)).status, 401);
  assert.equal((await h.send('GET', '/v1/vault', a)).status, 404);
  for (const secret of [a, b]) assert.equal((await h.send('POST', '/v1/vault', secret)).status, 200);
  assert.equal((await put(h, a, id, 0, 111)).status, 200);
  assert.deepEqual((await h.send('GET', '/v1/vault', b)).data.slots, []);
  assert.equal((await put(h, b, id, 0, 222)).status, 200);
  assert.equal((await h.send('GET', '/v1/vault', a)).data.slots[0].profile.cash, 111);
  assert.equal((await h.send('GET', '/v1/vault', b)).data.slots[0].profile.cash, 222);
  const evidence = JSON.stringify({ forwarded: h.forwarded, identities: h.identities, privateLimits: h.privateLimits, storage: [...h.objects.values()].map(v => v.storage.dump()) });
  assert.ok(!evidence.includes(a) && !evidence.includes(b));
  assert.ok(h.identities.every(identity => /^[a-f0-9]{64}$/.test(identity)));
  assert.equal(new Set(h.identities).size, 2);
});

test('create is idempotent and returns existing heads on a later retry', async t => {
  const h = harness(t), secret = code(), id = randomUUID();
  assert.deepEqual((await h.send('POST', '/v1/vault', secret)).data, { version: 1, slots: [] });
  await put(h, secret, id, 0, 18);
  const retry = await h.send('POST', '/v1/vault', secret, {});
  assert.equal(retry.status, 200);
  assert.equal(retry.data.slots[0].profile.cash, 18);
  assert.equal((await h.send('POST', '/v1/vault', secret, { injected: true })).status, 400);
});

test('vault creation reads actual empty POST streams at Worker and DO boundaries; nonempty bodies cannot bypass JSON or empty-object rules', async t => {
  const h = harness(t, { emptyPostForwarding: true }), secret = code();
  const stream = text => new ReadableStream({ start(controller) {
    if (text) controller.enqueue(new TextEncoder().encode(text));
    controller.close();
  } });
  async function post(text, extraHeaders = {}) {
    const body = stream(text);
    assert.ok(body, 'regression must exercise a truthy stream even when byte length is zero');
    const request = new Request(`${URL_BASE}/v1/vault`, { method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${secret}`, 'CF-Connecting-IP': '192.0.2.44', ...extraHeaders }, body, duplex: 'half' });
    const response = await worker.fetch(request, h.env);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return { status: response.status, data: await response.json() };
  }
  assert.deepEqual(await post(''), { status: 200, data: { version: 1, slots: [] } });
  assert.equal((await post('', { 'Content-Type': 'text/plain', 'Content-Length': '0' })).status, 200);
  assert.equal((await post('{}', { 'Content-Type': 'application/json' })).status, 200);
  assert.equal((await post('{}', { 'Content-Type': 'text/plain', 'Content-Length': '0' })).status, 415);
  assert.equal((await post('{}')).status, 415);
  assert.equal((await post('{"injected":true}', { 'Content-Type': 'application/json', 'Content-Length': '0' })).status, 400);
  assert.equal((await post('{broken', { 'Content-Type': 'application/json' })).status, 400);
  assert.equal((await post('[]', { 'Content-Type': 'application/json' })).status, 400);
  assert.equal((await post('x'.repeat(MAX_BODY_BYTES + 1), { 'Content-Type': 'text/plain', 'Content-Length': '0' })).status, 413);
  assert.equal(h.objects.size, 1);
  assert.equal((await h.send('GET', '/v1/vault', secret)).data.slots.length, 0);
});

test('parallel writers at one base accept exactly one head and preserve one previous snapshot', async t => {
  const h = harness(t), secret = code(), id = randomUUID();
  await h.send('POST', '/v1/vault', secret);
  const first = (await put(h, secret, id, 0, 10)).data.slot;
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => put(h, secret, id, first.version, index + 100, { mutationId: randomUUID() })));
  const successes = results.filter(r => r.status === 200), conflicts = results.filter(r => r.status === 409);
  assert.equal(successes.length, 1);
  assert.equal(conflicts.length, 7);
  assert.ok(successes[0].data.slot.version > first.version);
  const head = (await h.send('GET', '/v1/vault', secret)).data.slots[0];
  assert.equal(head.profile.cash, successes[0].data.slot.profile.cash);
  for (const r of conflicts) assert.equal(r.data.slot.version, head.version);
  const history = (await h.send('GET', `/v1/slots/${id}/history`, secret)).data.history;
  assert.equal(history.length, 1);
  assert.equal(history[0].profile.cash, 10);
});

test('same content at stale base conflicts without proof; exact mutation retry succeeds only while still current', async t => {
  const h = harness(t), secret = code(), id = randomUUID(), mutationId = randomUUID();
  await h.send('POST', '/v1/vault', secret);
  const first = await put(h, secret, id, 0, 40, { mutationId });
  const retry = await put(h, secret, id, 0, 40, { mutationId });
  assert.deepEqual(retry.data, first.data);
  assert.equal((await put(h, secret, id, 0, 40)).status, 409);
  assert.equal((await put(h, secret, id, 0, 41, { mutationId })).status, 409);
  assert.equal((await put(h, secret, id, first.data.slot.version, 40, { mutationId })).status, 409);
  const newer = await put(h, secret, id, first.data.slot.version, 50, { mutationId: randomUUID() });
  const late = await put(h, secret, id, 0, 40, { mutationId });
  assert.equal(late.status, 409);
  assert.equal(late.data.slot.version, newer.data.slot.version);
  assert.equal(late.data.slot.profile.cash, 50);
  assert.equal((await h.send('GET', `/v1/slots/${id}/history`, secret)).data.history.length, 1);
});

test('delete preserves progress, restore is CAS-protected, and restore/current undeletes with monotonic new versions', async t => {
  const h = harness(t), secret = code(), id = randomUUID();
  await h.send('POST', '/v1/vault', secret);
  const a = (await put(h, secret, id, 0, 100)).data.slot;
  const b = (await put(h, secret, id, a.version, 250)).data.slot;
  const deletion = { baseVersion: b.version, mutationId: randomUUID() };
  const deleted = (await h.send('DELETE', `/v1/slots/${id}`, secret, deletion)).data.slot;
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.profile.cash, 250);
  assert.equal((await h.send('GET', '/v1/vault', secret)).data.slots[0].deleted, true);
  assert.deepEqual((await h.send('DELETE', `/v1/slots/${id}`, secret, deletion)).data.slot, deleted);
  const history = (await h.send('GET', `/v1/slots/${id}/history`, secret)).data.history;
  assert.deepEqual(history.map(row => row.profile.cash), [250, 100]);
  const oldest = history[1];
  assert.equal((await h.send('POST', `/v1/slots/${id}/restore`, secret, { backupId: oldest.id, baseVersion: b.version })).status, 409);
  const restore = { backupId: oldest.id, baseVersion: deleted.version, mutationId: randomUUID() };
  const restored = (await h.send('POST', `/v1/slots/${id}/restore`, secret, restore)).data.slot;
  assert.equal(restored.profile.cash, 100);
  assert.equal(restored.deleted, false);
  assert.ok(restored.version > deleted.version);
  assert.deepEqual((await h.send('POST', `/v1/slots/${id}/restore`, secret, restore)).data.slot, restored);
  const deletedAgain = (await h.send('DELETE', `/v1/slots/${id}`, secret, { baseVersion: restored.version })).data.slot;
  const current = (await h.send('POST', `/v1/slots/${id}/restore`, secret, { backupId: 'current', baseVersion: deletedAgain.version })).data.slot;
  assert.equal(current.profile.cash, 100);
  assert.equal(current.deleted, false);
  assert.ok(current.version > deletedAgain.version);
});

test('ten newest previous snapshots remain; writes and SQL faults never lose current head or add partial history', async t => {
  const h = harness(t), secret = code(), id = randomUUID();
  await h.send('POST', '/v1/vault', secret);
  let head = (await put(h, secret, id, 0, 0)).data.slot;
  for (let cash = 1; cash <= 15; cash++) head = (await put(h, secret, id, head.version, cash)).data.slot;
  const history = (await h.send('GET', `/v1/slots/${id}/history`, secret)).data.history;
  assert.equal(history.length, 10);
  assert.deepEqual(history.map(row => row.profile.cash), [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  const entry = [...h.objects.values()][0];
  entry.storage.fail = query => query.startsWith('INSERT INTO slots');
  assert.equal((await put(h, secret, id, head.version, 1000)).status, 503);
  entry.storage.fail = null;
  assert.deepEqual((await h.send('GET', '/v1/vault', secret)).data.slots[0], head);
  assert.deepEqual((await h.send('GET', `/v1/slots/${id}/history`, secret)).data.history, history);
  entry.vault = new SaveVault({ storage: entry.storage }, h.env);
  assert.equal((await h.send('GET', '/v1/vault', secret)).data.slots[0].profile.cash, 15);
  assert.ok(entry.storage.transactions > 15);
});

test('12 live plus 12 newest deleted slots, old tombstones pruned, retained history intact and recreated UUID cannot suffer ABA', async t => {
  const h = harness(t), secret = code();
  await h.send('POST', '/v1/vault', secret);
  const live = [];
  for (let i = 0; i < 12; i++) live.push((await put(h, secret, randomUUID(), 0, i)).data.slot);
  assert.equal((await put(h, secret, randomUUID(), 0)).data.error, 'slot_limit');
  const deleted = [];
  for (let i = 0; i < 13; i++) {
    const head = live.shift();
    const r = await h.send('DELETE', `/v1/slots/${head.id}`, secret, { baseVersion: head.version });
    assert.equal(r.status, 200);
    deleted.push({ prior: head, deleted: r.data.slot });
    const fresh = await put(h, secret, randomUUID(), 0, i + 100);
    assert.equal(fresh.status, 200);
    live.push(fresh.data.slot);
  }
  const slots = (await h.send('GET', '/v1/vault', secret)).data.slots;
  assert.equal(slots.length, 24);
  assert.equal(slots.filter(s => !s.deleted).length, 12);
  assert.equal(slots.filter(s => s.deleted).length, 12);
  assert.ok(!slots.some(s => s.id === deleted[0].prior.id));
  const retained = deleted[1];
  assert.equal((await h.send('GET', `/v1/slots/${retained.prior.id}/history`, secret)).data.history[0].profile.cash, retained.prior.profile.cash);
  assert.equal((await h.send('GET', `/v1/slots/${deleted[0].prior.id}/history`, secret)).status, 404);
  assert.equal((await put(h, secret, deleted[0].prior.id, deleted[0].deleted.version, 999)).status, 409);
  await h.send('DELETE', `/v1/slots/${live[0].id}`, secret, { baseVersion: live[0].version });
  const recreated = await put(h, secret, deleted[0].prior.id, 0, 700);
  assert.equal(recreated.status, 200);
  assert.ok(recreated.data.slot.version > deleted[0].deleted.version, 'pruned UUID recreation must never reuse an old revision');
  const stale = await put(h, secret, deleted[0].prior.id, deleted[0].prior.version, 888);
  assert.equal(stale.status, 409);
  assert.equal(stale.data.slot.profile.cash, 700);
});

test('fixed wire schema preserves genuine purchased gear, campaign/cash/records and migrates legacy driver inventory', async t => {
  const h = harness(t), secret = code(), id = randomUUID();
  await h.send('POST', '/v1/vault', secret);
  const original = profile(123456, {
    totalCash: 765432, revision: 12, runs: 9, wins: 3, trucks: ['player_sedan_t1', 'truck_t4', 'player_buggy_t3'], truck: 'truck_t4',
    vehicleUpgradeSchema: 2, vehicleUpgrades: { rustbucket: { engine: 5, armor: 5 }, buggy: { tires: 5 }, sedan: { engine: 4 } },
    upgrades: { vest: 3, grenades: 3, scavenger: 2 },
    weapons: { pistol: {}, minigun: { dmg: 3, mag: 2 }, rifle: { rel: 2 } }, loadout: ['minigun', 'rifle', 'pistol'],
    weaponOptics: { rifle: { owned: ['standard', 'wide_reflex'], equipped: 'wide_reflex' } },
    campaignProgress: { version: 1, cleared: [1, 2], selectedLevel: 3, clearRuns: { 1: 'run-one', 2: 'run-two' } },
    campaignRecords: { 1: { distance: 3600.5, kills: 11 }, 2: { distance: 4000 } },
    best: { distance: 60000, kills: 75 }, marathonBest: { distance: 500000, furthestS: 500001 }, lastRunId: 'personal-payout', coopLastRunId: 'coop-payout',
  });
  const r = await h.send('PUT', `/v1/slots/${id}`, secret, { name: '  Owned progress  ', profile: original, baseVersion: 0 });
  assert.equal(r.status, 200);
  const p = r.data.slot.profile;
  for (const key of ['cash', 'totalCash', 'revision', 'runs', 'wins', 'trucks', 'truck', 'vehicleUpgrades', 'upgrades', 'weapons', 'weaponOptics', 'loadout', 'campaignProgress', 'campaignRecords', 'best', 'marathonBest', 'lastRunId', 'coopLastRunId']) assert.deepEqual(p[key], original[key], key);
  assert.equal(r.data.slot.name, 'Owned progress');
  const expectedHash = createHash('sha256').update(canonicalJson({ name: 'Owned progress', profile: p, deleted: false })).digest('hex');
  assert.equal(r.data.slot.hash, expectedHash);
  const legacy = sanitizeProfile({ v: 1, campaignId: 'old-campaign', truck: 'truck_t4', trucks: [], upgrades: { engine: 5, vest: 3 } });
  assert.ok(legacy.trucks.includes('truck_t4'));
  assert.equal(legacy.vehicleUpgrades.rustbucket.engine, 5);
  assert.equal(legacy.upgrades.vest, 3);
  assert.ok(!Object.hasOwn(legacy.upgrades, 'engine'));
});

test('untrusted metadata, credentials and prototype keys cannot enter saved profiles or hashes', async t => {
  const h = harness(t), secret = code(), id = randomUUID();
  await h.send('POST', '/v1/vault', secret);
  const body = JSON.parse(JSON.stringify({ name: 'Private', profile: profile(9), baseVersion: 0, version: 999, hash: 'forged', owner: 'attacker' }));
  body.profile.recoveryCode = secret; body.profile.token = secret; body.profile.session = { nested: secret }; body.profile.settings = { key: secret }; body.profile.seen = { key: secret };
  Object.defineProperty(body.profile, '__proto__', { value: { polluted: true }, enumerable: true });
  body.profile.weapons.unknown = { token: secret }; body.profile.vehicleUpgrades.unknown = { token: secret };
  const r = await h.send('PUT', `/v1/slots/${id}`, secret, body);
  assert.equal(r.status, 200);
  assert.equal(r.data.slot.version, 1);
  for (const key of ['recoveryCode', 'token', 'session', '__proto__', 'owner', 'hash', 'version']) assert.ok(!Object.hasOwn(r.data.slot.profile, key));
  assert.deepEqual(r.data.slot.profile.settings, {});
  assert.deepEqual(r.data.slot.profile.seen, {});
  assert.equal({}.polluted, undefined);
  assert.ok(![...h.objects.values()][0].storage.dump().includes(secret));
  for (const known of [{ campaignId: secret }, { lastRunId: secret }, { coopLastRunId: secret }]) {
    assert.equal((await h.send('PUT', `/v1/slots/${id}`, secret, { name: 'Private', profile: { ...profile(), ...known }, baseVersion: r.data.slot.version })).status, 400);
  }
  assert.equal((await h.send('PUT', `/v1/slots/${id}`, secret, { name: secret, profile: profile(), baseVersion: r.data.slot.version })).data.error, 'invalid_name');
  assert.ok(![...h.objects.values()][0].storage.dump().includes(secret));
});

test('future/invalid schema, nonfinite numbers, unsupported gear, oversized arrays, bad versions and preconditions never replace the head', async t => {
  const h = harness(t), secret = code(), id = randomUUID();
  await h.send('POST', '/v1/vault', secret);
  const first = (await put(h, secret, id, 0, 12)).data.slot;
  const patches = [{ v: 2 }, { campaignId: '../bad' }, { cash: -1 }, { cash: 1.5 }, { totalCash: Number.MAX_SAFE_INTEGER + 1 }, { best: { distance: Infinity } }, { weapons: { pistol: { dmg: 4 } } }, { trucks: ['arbitrary'] }, { vehicleUpgrades: { sedan: { engine: 5 } } }, { loadout: ['pistol', 'pistol', 'pistol', 'pistol'] }, { campaignProgress: { version: 2 } }, { campaignProgress: { cleared: [11] } }, { lastRunId: 'x'.repeat(129) }];
  for (const patch of patches) {
    const r = await h.send('PUT', `/v1/slots/${id}`, secret, { name: 'bad', profile: { ...profile(), ...patch }, baseVersion: first.version });
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.equal(r.data.error, 'invalid_profile');
  }
  for (const baseVersion of [-1, 1.5, '1', null]) assert.equal((await put(h, secret, id, baseVersion)).status, 400);
  for (const name of ['', 'x'.repeat(65), 'bad\u0000name']) assert.equal((await h.send('PUT', `/v1/slots/${id}`, secret, { name, profile: profile(), baseVersion: first.version })).data.error, 'invalid_name');
  assert.equal((await put(h, secret, id, first.version, 0, { mutationId: 'bad-id' })).status, 400);
  assert.equal((await h.send('PUT', `/v1/slots/${id}`, secret, { name: 'bad', profile: profile(), baseVersion: first.version }, { headers: { 'If-Match': '"999"' } })).status, 400);
  assert.deepEqual((await h.send('GET', '/v1/vault', secret)).data.slots[0], first);
  assert.deepEqual((await h.send('GET', `/v1/slots/${id}/history`, secret)).data.history, []);
});

test('streamed 64KiB byte bound cannot be bypassed by missing or lying Content-Length; invalid JSON/types rejected before DO', async t => {
  const h = harness(t), secret = code(), id = randomUUID(), path = `/v1/slots/${id}`;
  const oversized = JSON.stringify({ name: 'x', profile: { v: 1, campaignId: 'x', injected: '😀'.repeat(MAX_BODY_BYTES / 4) }, baseVersion: 0 });
  for (const headers of [{}, { 'Content-Length': '1' }, { 'Content-Length': String(MAX_BODY_BYTES + 1) }]) assert.equal((await h.send('PUT', path, secret, oversized, { raw: true, headers })).status, 413);
  assert.equal((await h.send('PUT', path, secret, '{broken', { raw: true })).status, 400);
  assert.equal((await h.send('PUT', path, secret, [] )).status, 400);
  assert.equal((await h.send('PUT', path, secret, {}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await h.send('PUT', `${path}?secret=unsafe`, secret, {})).status, 400);
  assert.equal(h.objects.size, 0);
  await h.send('POST', '/v1/vault', secret);
  const bounded = { name: 'At the limit', profile: { v: 1, campaignId: 'bounded', ignoredPadding: '' }, baseVersion: 0 };
  const overhead = Buffer.byteLength(JSON.stringify(bounded));
  bounded.profile.ignoredPadding = 'x'.repeat(MAX_BODY_BYTES - overhead);
  assert.equal(Buffer.byteLength(JSON.stringify(bounded)), MAX_BODY_BYTES);
  const accepted = await h.send('PUT', path, secret, bounded);
  assert.equal(accepted.status, 200);
  assert.ok(!Object.hasOwn(accepted.data.slot.profile, 'ignoredPadding'));
});

test('rate bindings fail closed and gate work before auth/DO; durable per-vault rate cap is exact across reconstructed instances', async t => {
  const h = harness(t), secret = code();
  const originalIp = h.env.SAVE_IP_LIMIT;
  h.env.SAVE_IP_LIMIT = { async limit() { return { success: false }; } };
  const refused = await h.send('POST', '/v1/vault', secret);
  assert.equal(refused.status, 429); assert.equal(refused.headers.get('Retry-After'), '60');
  assert.equal(h.objects.size, 0); assert.equal(h.privateLimits.length, 0);
  h.env.SAVE_IP_LIMIT = originalIp;
  const originalPrivate = h.env.SAVE_VAULT_LIMIT;
  h.env.SAVE_VAULT_LIMIT = undefined;
  assert.equal((await h.send('POST', '/v1/vault', secret)).status, 503);
  h.env.SAVE_VAULT_LIMIT = { async limit() { return { success: false }; } };
  assert.equal((await h.send('POST', '/v1/vault', secret)).status, 429);
  assert.equal(h.objects.size, 0);
  h.env.SAVE_VAULT_LIMIT = originalPrivate;
  await h.send('POST', '/v1/vault', secret);
  const entry = [...h.objects.values()][0];
  // Pin the stored window, so this assertion never depends on wall-clock minute rollover.
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  entry.storage.db.prepare('UPDATE vault_meta SET value = ? WHERE key = ?').run(JSON.stringify({ window: Math.floor(now / 60_000), count: 0 }), 'rate');
  const accepted = await Promise.all(Array.from({ length: 60 }, () => h.send('GET', '/v1/vault', secret)));
  assert.ok(accepted.every(r => r.status === 200));
  entry.vault = new SaveVault({ storage: entry.storage }, h.env);
  assert.equal((await h.send('GET', '/v1/vault', secret)).status, 429);
  t.mock.restoreAll();
});
