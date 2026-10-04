// AUTHORED UNRUN. Root alone grants the CPU lease. Run this file in its own
// process: its narrow real-WebCrypto interposition must never overlap a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sanitizeProfile, canonicalJson } from '../server/saves/schema.js';
import { assertSupportedProfile } from '../server/saves/profile_support.js';

// Normal actual-source imports above and below. This package is overlaid into
// the isolated tank candidate, not executed from inside its sparse WORK folder.
const workerUrl = new URL('../server/saves/worker.js', import.meta.url).href;
const schemaUrl = new URL('../server/saves/schema.js', import.meta.url).href;
const supportUrl = new URL('../server/saves/profile_support.js', import.meta.url).href;
const negativeUrl = new URL('./fixtures/tank_worker_no_final_profile_guard.js.txt', import.meta.url).href;
const hashes = new Map([
  [workerUrl, 'E6011732242CCE114848AE4318B26CACAF7083BC045793737A98281FB0B56189'],
  [schemaUrl, 'CC33D59CB995BDCCAF7EA14FC6321DDBD3951F3FC0D23870D11410BE9BDF32CF'],
  [supportUrl, '6A98AFFA339ACE597868E38658FF332EEE28A8C55223C6A77E3C4138444DBDE4'],
  [negativeUrl, '4F560E07D6DBC7AD99B6DE7C9ECD65472D53AE0EEE365140998689BFC3C6AA47'],
]);
const sources = new Map([...hashes].map(([url, expected]) => {
  const bytes = readFileSync(new URL(url));
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), expected, `frozen source binding: ${url}`);
  return [url, bytes.toString('utf8')];
}));
const normalizeLines = source => source.replace(/\r\n/g, '\n');
const finalGuards = '        compatibleProfile(live?.profile, capability);\n        compatibleProfile(candidate.profile, capability);\n';
const actualSource = normalizeLines(sources.get(workerUrl));
assert.equal(actualSource.split(finalGuards).length - 1, 1, 'negative control removes one unique final-transaction pair');
assert.equal(normalizeLines(sources.get(negativeUrl)), actualSource.replace(finalGuards, ''),
  'negative control changes only the final live/candidate compatibility checks; auth, prep, CAS and commit remain actual source');

const platformUrl = 'tank-capability-race:platform';
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: platformUrl, shortCircuit: true };
    if (context.parentURL === negativeUrl && specifier === './schema.js') return { url: schemaUrl, shortCircuit: true };
    if (context.parentURL === negativeUrl && specifier === './profile_support.js') return { url: supportUrl, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === platformUrl) return { format: 'module', source: 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
    if (url === negativeUrl) return { format: 'module', source: sources.get(negativeUrl), shortCircuit: true };
    return next(url, context);
  },
});
let actual, withoutFinalGuard;
try { actual = await import(workerUrl); withoutFinalGuard = await import(negativeUrl); }
finally { hooks.deregister(); }

// Only the platform constructor and namespace/rate bindings are fixtures.
// Real Node SQLite executes every actual-source query and synchronous
// transaction. No test writes a head/backup/receipt/version directly.
class SqliteStorage {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.sql = { exec: (query, ...bindings) => {
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
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      assert.ok(!(result instanceof Promise), 'actual DO transactions must remain synchronous');
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  // Read-only byte witnesses. A refused request still consumes the existing
  // per-vault rate budget, so only that unrelated metadata is excluded.
  snapshot() {
    return JSON.stringify({
      meta: this.db.prepare("SELECT key, value FROM vault_meta WHERE key != 'rate' ORDER BY key").all(),
      slots: this.db.prepare('SELECT id, data FROM slots ORDER BY id').all(),
      backups: this.db.prepare('SELECT slot_id, id, version, data FROM backups ORDER BY slot_id, version, id').all(),
    });
  }
}

const ORIGIN = 'https://ride.maxyaport.com';
const ENDPOINT = 'https://ride-or-die-saves.yaportmax.workers.dev';
function publicHttpHarness(t, module) {
  const objects = new Map(), forwarded = [], identityWitnesses = [];
  const secret = `ROD1-${randomBytes(32).toString('base64url')}`;
  const env = {
    SAVE_IP_LIMIT: { async limit() { return { success: true }; } },
    SAVE_VAULT_LIMIT: { async limit() { return { success: true }; } },
    SAVE_VAULTS: {
      idFromName(name) { identityWitnesses.push(name); return name; },
      get(id) {
        if (!objects.has(id)) {
          const storage = new SqliteStorage();
          objects.set(id, { storage, vault: new module.SaveVault({ storage }, env) });
        }
        return { fetch(request) {
          forwarded.push({ method: request.method, path: new URL(request.url).pathname,
            capability: request.headers.get('X-ROD-Profile-Version'), authorization: request.headers.get('Authorization') });
          return objects.get(id).vault.fetch(request);
        } };
      },
    },
  };
  t.after(() => { for (const { storage } of objects.values()) storage.db.close(); });
  async function send(method, path, body, capability = '3') {
    const headers = new Headers({ Origin: ORIGIN, Authorization: `Bearer ${secret}`, 'CF-Connecting-IP': '192.0.2.71' });
    if (capability !== null) headers.set('X-ROD-Profile-Version', capability);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const result = await module.default.fetch(new Request(`${ENDPOINT}${path}`, { method, headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    return { status: result.status, data: await result.json() };
  }
  function snapshot() {
    assert.equal(objects.size, 1, 'ordinary bearer authentication must select one isolated vault');
    return [...objects.values()][0].storage.snapshot();
  }
  return { send, snapshot, forwarded, identityWitnesses };
}

const tankId = 'player_tank_t1';
const paidTank = Object.freeze({ engine: 2, armor: 3, tires: 4, nitro: 2, ram: 3, spikes: 1, glass: 2, fueltank: 2, oil: 1, mines: 2 });
function legacyProfile(cash) {
  return sanitizeProfile({ v: 1, campaignId: 'capability-race-person', cash, totalCash: 1000,
    truck: 'player_sedan_t1', trucks: ['player_sedan_t1'], vehicleUpgradeSchema: 2,
    vehicleUpgrades: { sedan: { engine: 2, armor: 1 } } });
}
function tankProfile(owned) {
  const profile = sanitizeProfile({ ...legacyProfile(350000), v: 3, totalCash: 650000, revision: 9,
    truck: owned ? tankId : 'player_sedan_t1', trucks: owned ? ['player_sedan_t1', tankId] : ['player_sedan_t1'],
    vehicleUpgrades: { sedan: { engine: 2, armor: 1 }, tank: { ...paidTank } } });
  assert.equal(profile.v, 3, 'positive unowned tank purchases require capability 3 as well as owned chassis');
  assert.equal(profile.trucks.includes(tankId), owned);
  assert.equal(profile.truck, owned ? tankId : 'player_sedan_t1');
  assert.deepEqual(profile.vehicleUpgrades.tank, paidTank);
  assert.equal(assertSupportedProfile(profile, 3), 3);
  assert.throws(() => assertSupportedProfile(profile, 2), error => error?.code === 'unsupported-profile' && error.requiredVersion === 3);
  return profile;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
// Hold the return of the actual SHA-256 operation for exactly one candidate's
// canonical contentHash envelope, after the real digest has computed. Worker
// auth and mutation fingerprints, cap3 hashes and all other digests run normally.
// Reaching this envelope means actual prep CAS and restore lookup have completed.
function holdActualCandidateHash(expectedText) {
  const subtle = globalThis.crypto.subtle, original = subtle.digest.bind(subtle);
  const previous = Object.getOwnPropertyDescriptor(subtle, 'digest');
  const reached = deferred(), released = deferred();
  let releasedAlready = false;
  const witness = { hits: 0, input: null, hash: null };
  Object.defineProperty(subtle, 'digest', { configurable: true, writable: true, value: async function (algorithm, data) {
    const result = await original(algorithm, data);
    const name = typeof algorithm === 'string' ? algorithm : algorithm?.name;
    const text = new TextDecoder().decode(data);
    if (name.toUpperCase() === 'SHA-256' && text === expectedText) {
      witness.hits++;
      assert.equal(witness.hits, 1, 'only the single old candidate contentHash may be suspended');
      witness.input = text;
      witness.hash = Buffer.from(result).toString('hex');
      reached.resolve(witness);
      await released.promise;
    }
    return result;
  } });
  return {
    reached: reached.promise, witness,
    release() { if (!releasedAlready) { releasedAlready = true; released.resolve(); } },
    restore() { if (previous) Object.defineProperty(subtle, 'digest', previous); else delete subtle.digest; },
  };
}
async function waitForRealHash(gate, pending) {
  let timer;
  try {
    return await Promise.race([
      gate.reached,
      pending.then(() => { throw new Error('old API request completed before its actual candidate contentHash suspension'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('actual contentHash suspension not reached within 5s')), 5000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function race(t, { module = actual, operation, owned, oldHeader, expectedError = 'unsupported_profile' }) {
  const h = publicHttpHarness(t, module), slotId = randomUUID(), slotPath = `/v1/slots/${slotId}`;
  assert.deepEqual(await h.send('POST', '/v1/vault'), { status: 200, data: { version: 1, slots: [] } });
  const firstWrite = { name: 'Legacy first', profile: legacyProfile(100), baseVersion: 0, mutationId: randomUUID() };
  const firstResponse = await h.send('PUT', slotPath, firstWrite);
  assert.equal(firstResponse.status, 200);
  const first = firstResponse.data.slot;
  const currentResponse = await h.send('PUT', slotPath, { name: 'Legacy current', profile: legacyProfile(200),
    baseVersion: first.version, mutationId: randomUUID() });
  assert.equal(currentResponse.status, 200);
  const current = currentResponse.data.slot;
  assert.equal(current.version, first.version + 1);
  assert.equal(current.profile.v, 1);
  const historyResponse = await h.send('GET', `${slotPath}/history`);
  assert.equal(historyResponse.status, 200);
  assert.equal(historyResponse.data.history.length, 1);
  const backup = historyResponse.data.history[0];
  assert.deepEqual(backup.profile, first.profile);
  assert.equal(backup.version, first.version);

  const mutationId = randomUUID(), baseVersion = current.version;
  const old = operation === 'PUT' ? {
    method: 'PUT', path: slotPath,
    body: { name: 'Old cap2 put', profile: legacyProfile(999), baseVersion, mutationId },
    candidate: { name: 'Old cap2 put', profile: legacyProfile(999), deleted: false },
  } : operation === 'DELETE' ? {
    method: 'DELETE', path: slotPath, body: { baseVersion, mutationId },
    candidate: { name: current.name, profile: current.profile, deleted: true },
  } : {
    method: 'POST', path: `${slotPath}/restore`, body: { backupId: backup.id, baseVersion, mutationId },
    candidate: { name: backup.name, profile: backup.profile, deleted: false },
  };
  assert.ok(['PUT', 'DELETE', 'restore'].includes(operation));
  const expectedEnvelope = canonicalJson(old.candidate);
  const before = h.snapshot(), gate = holdActualCandidateHash(expectedEnvelope);
  let pending, oldSettled = false;
  try {
    pending = h.send(old.method, old.path, old.body, oldHeader).then(result => { oldSettled = true; return result; });
    const actualHash = await waitForRealHash(gate, pending);
    assert.equal(oldSettled, false, 'old public API request is still suspended after actual prep and actual SHA-256');
    assert.equal(actualHash.input, expectedEnvelope);
    assert.equal(actualHash.hash, createHash('sha256').update(expectedEnvelope).digest('hex'), 'suspended digest result remains real SHA-256');
    assert.equal(actualHash.hits, 1);
    assert.equal(h.snapshot(), before, 'old prep/hash cannot allocate a version, receipt, head or backup');
    const oldForwarded = h.forwarded.at(-1);
    assert.equal(oldForwarded.method, old.method);
    assert.equal(oldForwarded.path, old.path);
    assert.equal(oldForwarded.capability, '2', 'explicit cap2 and absent public header both forward the real compatibility capability 2');

    // The winner uses the same ordinary slot/base through the public Worker.
    // It is neither a manually fabricated head nor a test dispatch of commit.
    const newProfile = tankProfile(owned);
    const winningWrite = { name: owned ? 'Owned Bastion progress' : 'Unowned Bastion purchases', profile: newProfile,
      baseVersion: current.version, mutationId: randomUUID() };
    const winnerResponse = await h.send('PUT', slotPath, winningWrite, '3');
    assert.equal(winnerResponse.status, 200, 'valid cap3 tank progress must commit while cap2 candidate hashing is suspended');
    const winner = winnerResponse.data.slot;
    assert.deepEqual(winner.profile, newProfile);
    assert.equal(winner.name, winningWrite.name);
    assert.equal(winner.deleted, false);
    assert.equal(winner.version, current.version + 1, 'only the actual winning commit allocates the next version');
    assert.equal(winner.hash, createHash('sha256').update(canonicalJson({ name: winner.name, profile: newProfile, deleted: false })).digest('hex'));
    assert.equal(oldSettled, false, 'cap3 commit completes before release of cap2 contentHash');
    const afterWinner = h.snapshot();
    assert.notEqual(afterWinner, before);
    const winningRows = JSON.parse(afterWinner);
    assert.equal(winningRows.backups.length, 2, 'cap3 stores the two genuine prior legacy heads exactly once');
    assert.equal(winningRows.slots.length, 1);
    const privateWinner = JSON.parse(winningRows.slots[0].data);
    assert.equal(privateWinner.receipt.id, winningWrite.mutationId);
    assert.equal(privateWinner.receipt.fingerprint, createHash('sha256').update(canonicalJson({ operation: 'put',
      baseVersion: winningWrite.baseVersion, name: winningWrite.name, profile: newProfile })).digest('hex'));
    assert.equal(privateWinner.deletionOrder, null);
    assert.equal(winningRows.meta.find(row => row.key === 'versionSequence').value, String(winner.version));
    assert.equal(h.forwarded.at(-1).capability, '3');

    gate.release();
    const late = await pending;
    assert.equal(late.status, 409);
    assert.equal(late.data.error, expectedError,
      'compatibility is revalidated on the current cap3 head in the final transaction before stale-base CAS');
    if (expectedError === 'unsupported_profile') {
      assert.equal(late.data.requiredVersion, 3);
      assert.equal(Object.hasOwn(late.data, 'slot'), false, 'unsupported_profile is distinguishable from the later generic CAS branch');
    } else {
      assert.equal(expectedError, 'conflict');
      assert.deepEqual(late.data.slot, winner, 'negative control still retains real stale-base CAS protection');
      assert.equal(Object.hasOwn(late.data, 'requiredVersion'), false);
    }
    assert.equal(h.snapshot(), afterWinner,
      'resumed old PUT/DELETE/restore cannot overwrite, tombstone, restore, back up, replace receipt or allocate another version');
    const liveResponse = await h.send('GET', '/v1/vault');
    assert.equal(liveResponse.status, 200);
    assert.deepEqual(liveResponse.data.slots, [winner]);
    const backupsResponse = await h.send('GET', `${slotPath}/history`);
    assert.equal(backupsResponse.status, 200);
    assert.equal(backupsResponse.data.history.length, 2);
    assert.deepEqual(backupsResponse.data.history.map(row => row.profile), [current.profile, first.profile]);
    assert.equal(h.snapshot(), afterWinner);
    // Exact ordinary cap3 receipt retry must still find the winner, with no
    // third backup, rewritten receipt or monotonic version consumption.
    assert.deepEqual(await h.send('PUT', slotPath, winningWrite, '3'), { status: 200, data: { slot: winner } });
    assert.equal(h.snapshot(), afterWinner);
    assert.ok(h.forwarded.every(row => row.authorization === null), 'bearer code never crosses the actual Worker/DO boundary');
    assert.ok(h.identityWitnesses.every(identity => /^[a-f0-9]{64}$/.test(identity)));
    assert.equal(new Set(h.identityWitnesses).size, 1);
    assert.equal(gate.witness.hits, 1, 'other normal API hashes must not hit the suspended candidate envelope');
  } finally {
    gate.release();
    gate.restore();
    // Settle the released actual API call before t.after closes its SQLite.
    if (pending) await pending.catch(() => {});
  }
}

for (const operation of ['PUT', 'DELETE', 'restore']) {
  for (const owned of [true, false]) {
    for (const oldHeader of ['2', null]) {
      test(`actual contentHash yield: ${operation}, ${owned ? 'owned tank' : 'positive unowned tank gear'}, ${oldHeader === null ? 'absent cap2 header' : 'explicit cap2'}`,
        { concurrency: false, timeout: 15000 }, t => race(t, { operation, owned, oldHeader }));
    }
  }
}
for (const operation of ['PUT', 'DELETE', 'restore']) {
  test(`negative control: removing only final compatibility checks reaches generic CAS conflict after ${operation} hash yield`,
    { concurrency: false, timeout: 15000 }, t => race(t, { module: withoutFinalGuard, operation, owned: true, oldHeader: '2', expectedError: 'conflict' }));
}
