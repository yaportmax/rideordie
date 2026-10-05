import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { normalizeProfile } from '../src/meta/profile.js';
import { sanitizeProfile } from '../server/saves/schema.js';

// Install this WORK draft in candidate/tests before running. The only substituted
// platform code is DurableObject's base constructor. The public HTTP handler,
// raw-content guard, projection, authorization, SQL, CAS and receipts are actual
// candidate source; a real in-memory SQLite database enforces transactions.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'fixture:attachment-cloudflare-workers', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'fixture:attachment-cloudflare-workers') return { format: 'module', source: 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
    return next(url, context);
  },
});
let worker, SaveVault;
try { ({ default: worker, SaveVault } = await import('../server/saves/worker.js')); }
finally { hooks.deregister(); }

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
      assert.ok(!(result instanceof Promise), 'DO transactions must stay synchronous');
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  persistentSnapshot() {
    // Existing request-rate bookkeeping is intentionally mutable even for
    // rejected requests. Head JSON includes private mutation receipts; this
    // comparison covers heads, receipts, backups and the version sequence.
    return JSON.stringify({
      slots: this.db.prepare('SELECT id, data FROM slots ORDER BY id').all(),
      backups: this.db.prepare('SELECT slot_id, id, version, data FROM backups ORDER BY slot_id, version, id').all(),
      sequence: this.db.prepare("SELECT value FROM vault_meta WHERE key = 'versionSequence'").all(),
    });
  }
}

const ORIGIN = 'https://ride.maxyaport.com';
const URL_BASE = 'https://ride-or-die-saves.yaportmax.workers.dev';
const code = () => `ROD1-${randomBytes(32).toString('base64url')}`;
const cap = version => version === null ? {} : { 'X-ROD-Profile-Version': String(version) };
const allMods = ['extended_mag', 'laser', 'foregrip', 'stock'];
const rifleMods = { owned: [...allMods], equipped: ['extended_mag', 'laser', 'foregrip', 'stock'] };

function harness(t) {
  const objects = new Map(), forwarded = [];
  const env = {
    SAVE_IP_LIMIT: { async limit() { return { success: true }; } },
    SAVE_VAULT_LIMIT: { async limit() { return { success: true }; } },
    SAVE_VAULTS: {
      idFromName(name) { return name; },
      get(id) {
        if (!objects.has(id)) {
          const storage = new SqliteStorage();
          objects.set(id, { storage, vault: new SaveVault({ storage }, env) });
        }
        return { fetch(request) {
          forwarded.push({ url: request.url, capability: request.headers.get('X-ROD-Profile-Version'), authorization: request.headers.get('Authorization') });
          return objects.get(id).vault.fetch(request);
        } };
      },
    },
  };
  t.after(() => { for (const { storage } of objects.values()) storage.db.close(); });
  async function send(method, path, recovery, body, version = 4) {
    const headers = new Headers({ Origin: ORIGIN, 'CF-Connecting-IP': '192.0.2.94', ...cap(version) });
    if (recovery !== null) headers.set('Authorization', `Bearer ${recovery}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await worker.fetch(new Request(`${URL_BASE}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  const snapshot = () => JSON.stringify([...objects.values()].map(({ storage }) => storage.persistentSnapshot()));
  return { objects, forwarded, send, snapshot };
}

function baseProfile(cash = 2000, extra = {}) {
  return normalizeProfile({ v: 1, campaignId: 'attachment-cloud-http', cash, totalCash: 20000, ...extra });
}
function attachmentProfile(cash = 2000, attachments = { rifle: rifleMods }) {
  const p = baseProfile(cash, {
    weapons: { pistol: { dmg: 0, mag: 0, rel: 0, hnd: 0 }, rifle: { dmg: 0, mag: 0, rel: 0, hnd: 0 } },
    loadout: ['pistol', 'rifle'], campaignProgress: { version: 1, cleared: [1, 2, 3], selectedLevel: 4 },
  });
  // Deliberately raw v1 plus paid content: compatibility must derive capability4
  // from the attachment payload before a projector can erase it.
  p.v = 1;
  p.weaponAttachments = structuredClone(attachments);
  return p;
}
const write = (h, secret, id, p, baseVersion = 0, version = 4, mutationId = randomUUID()) => h.send('PUT', `/v1/slots/${id}`, secret, { name: 'Attachment save', profile: p, baseVersion, mutationId }, version);

test('actual Worker accepts explicit capabilities1/2/3/4, keeps missing capability2, and still accepts legacy Tank capability3', async t => {
  const h = harness(t), secret = code();
  for (const version of [1, 2, 3, 4, null]) {
    const created = await h.send('POST', '/v1/vault', secret, undefined, version);
    assert.equal(created.status, 200);
    assert.equal(h.forwarded.at(-1).capability, String(version ?? 2));
    assert.equal(h.forwarded.at(-1).authorization, null, 'private bearer must never cross the DO boundary');
    assert.equal((await write(h, secret, randomUUID(), baseProfile(), 0, version)).status, 200);
  }
  const tank = baseProfile(700, {
    trucks: ['player_sedan_t1', 'player_tank_t1'], truck: 'player_tank_t1',
    vehicleUpgradeSchema: 2, vehicleUpgrades: { tank: { engine: 3, armor: 5, tires: 4, nitro: 2, ram: 3, spikes: 2, glass: 2, fueltank: 2, oil: 2, mines: 2 } },
  });
  const accepted = await write(h, secret, randomUUID(), tank, 0, 3);
  assert.equal(accepted.status, 200, 'adding capability4 must not accidentally reject header3');
  assert.equal(accepted.data.slot.profile.v, 3);
  assert.deepEqual(accepted.data.slot.profile.vehicleUpgrades.tank, tank.vehicleUpgrades.tank);
});

test('paid rifle and pistol attachments survive actual capability4 cloud history, restore, tombstone and exact mutation retries', async t => {
  const h = harness(t), secret = code(), id = randomUUID();
  assert.equal((await h.send('POST', '/v1/vault', secret)).status, 200);
  const firstProfile = attachmentProfile(2000, { rifle: rifleMods, pistol: { owned: ['laser'], equipped: ['laser'] } });
  const firstMutation = randomUUID();
  const first = await write(h, secret, id, firstProfile, 0, 4, firstMutation);
  assert.equal(first.status, 200);
  assert.equal(first.data.slot.profile.v, 4, 'raw paid content promotes the wire profile, despite declared v1');
  assert.deepEqual(first.data.slot.profile.weaponAttachments, firstProfile.weaponAttachments);
  assert.deepEqual(first.data.slot.profile.campaignProgress, firstProfile.campaignProgress);
  assert.deepEqual(first.data.slot.profile.weapons, firstProfile.weapons);
  const replay = await write(h, secret, id, firstProfile, 0, 4, firstMutation);
  assert.deepEqual(replay.data.slot, first.data.slot, 'receipt retry retains the exact head');
  assert.equal((await h.send('GET', `/v1/slots/${id}/history`, secret)).data.history.length, 0);

  const secondProfile = attachmentProfile(1700, { rifle: { owned: [...allMods], equipped: ['laser', 'foregrip'] }, pistol: { owned: ['laser'], equipped: [] } });
  const second = await write(h, secret, id, secondProfile, first.data.slot.version);
  assert.equal(second.status, 200);
  assert.deepEqual(second.data.slot.profile.weaponAttachments, secondProfile.weaponAttachments, 'unequipped purchases are retained separately');
  const history = (await h.send('GET', `/v1/slots/${id}/history`, secret)).data.history;
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].profile.weaponAttachments, firstProfile.weaponAttachments);
  const restoreBody = { backupId: history[0].id, baseVersion: second.data.slot.version, mutationId: randomUUID() };
  const restored = await h.send('POST', `/v1/slots/${id}/restore`, secret, restoreBody);
  assert.equal(restored.status, 200);
  assert.ok(restored.data.slot.version > second.data.slot.version);
  assert.deepEqual(restored.data.slot.profile.weaponAttachments, firstProfile.weaponAttachments);
  assert.deepEqual((await h.send('POST', `/v1/slots/${id}/restore`, secret, restoreBody)).data.slot, restored.data.slot);
  const staleSnapshot = h.snapshot();
  const stale = await write(h, secret, id, secondProfile, first.data.slot.version);
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error, 'conflict');
  assert.equal(h.snapshot(), staleSnapshot, 'stale attachment writes preserve head, history, receipt and sequence');
  const deleted = await h.send('DELETE', `/v1/slots/${id}`, secret, { baseVersion: restored.data.slot.version, mutationId: randomUUID() });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.slot.deleted, true);
  assert.deepEqual(deleted.data.slot.profile.weaponAttachments, firstProfile.weaponAttachments);
  const current = await h.send('POST', `/v1/slots/${id}/restore`, secret, { backupId: 'current', baseVersion: deleted.data.slot.version, mutationId: randomUUID() });
  assert.equal(current.status, 200);
  assert.equal(current.data.slot.deleted, false);
  assert.deepEqual(current.data.slot.profile.weaponAttachments, firstProfile.weaponAttachments);
  const listed = (await h.send('GET', '/v1/vault', secret)).data.slots.find(slot => slot.id === id);
  assert.deepEqual(listed, current.data.slot);
});

test('old capabilities cannot allocate paid attachment saves or PUT/DELETE/RESTORE their heads, receipts or backups', async t => {
  const h = harness(t), secret = code(), id = randomUUID();
  await h.send('POST', '/v1/vault', secret);
  const paid = attachmentProfile();
  const newSnapshot = h.snapshot();
  for (const version of [1, 2, 3, null]) {
    const refused = await write(h, secret, id, paid, 0, version);
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error, 'unsupported_profile');
    assert.equal(refused.data.requiredVersion, 4, `raw v1 + paid row is not silently projected for capability${version ?? 'missing2'}`);
    assert.equal(h.snapshot(), newSnapshot, 'rejected new attachment saves allocate no head or mutation receipt');
  }
  const mutationId = randomUUID();
  const first = (await write(h, secret, id, paid, 0, 4, mutationId)).data.slot;
  const plain = baseProfile(1000);
  const protectedSnapshot = h.snapshot();
  for (const version of [1, 2, 3, null]) {
    for (const [method, path, body] of [
      ['PUT', `/v1/slots/${id}`, { name: 'Old build', profile: plain, baseVersion: first.version, mutationId: randomUUID() }],
      ['DELETE', `/v1/slots/${id}`, { baseVersion: first.version, mutationId: randomUUID() }],
      ['POST', `/v1/slots/${id}/restore`, { backupId: 'current', baseVersion: first.version, mutationId: randomUUID() }],
      ['PUT', `/v1/slots/${id}`, { name: 'Attachment save', profile: paid, baseVersion: 0, mutationId }],
    ]) {
      const refused = await h.send(method, path, secret, body, version);
      assert.equal(refused.status, 409, `${method} must check supported content before retry/CAS acceptance`);
      assert.equal(refused.data.error, 'unsupported_profile');
      assert.equal(refused.data.requiredVersion, 4);
      assert.equal(h.snapshot(), protectedSnapshot, 'old requests must not mutate head, receipt, backup or version');
    }
  }
  // Restoring an older-content head is permitted by capability4, but the paid
  // snapshot remains protected in history even when the current head is legacy.
  const replaced = await write(h, secret, id, plain, first.version);
  assert.equal(replaced.status, 200);
  assert.ok(replaced.data.slot.profile.v <= 3);
  const paidBackup = (await h.send('GET', `/v1/slots/${id}/history`, secret)).data.history.find(row => row.profile.weaponAttachments?.rifle?.owned.length);
  assert.ok(paidBackup, 'history must actually contain the paid snapshot');
  const legacyHeadSnapshot = h.snapshot();
  for (const version of [1, 2, 3, null]) {
    const refused = await h.send('POST', `/v1/slots/${id}/restore`, secret, { backupId: paidBackup.id, baseVersion: replaced.data.slot.version, mutationId: randomUUID() }, version);
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error, 'unsupported_profile');
    assert.equal(refused.data.requiredVersion, 4);
    assert.equal(h.snapshot(), legacyHeadSnapshot, 'guard must check restore source, not only the current head');
  }
});

test('actual raw attachment errors are rejected before schema projection and cannot replace a valid paid head', async t => {
  const h = harness(t), secret = code(), id = randomUUID();
  await h.send('POST', '/v1/vault', secret);
  const current = (await write(h, secret, id, attachmentProfile())).data.slot;
  const variants = [
    ['unknown attachment', { rifle: { owned: ['teleporter'], equipped: [] } }, 409, 'unsupported_profile'],
    ['unknown weapon row', { laser_cannon: { owned: ['laser'], equipped: [] } }, 409, 'unsupported_profile'],
    ['incompatible pistol stock', { pistol: { owned: ['stock'], equipped: ['stock'] } }, 409, 'unsupported_profile'],
    ['unknown row key', { rifle: { owned: ['laser'], equipped: [], hiddenPower: 10 } }, 409, 'unsupported_profile'],
    ['owned is not an array', { rifle: { owned: 'laser', equipped: [] } }, 400, 'invalid_profile'],
    ['equipped is not an array', { rifle: { owned: ['laser'], equipped: 'laser' } }, 400, 'invalid_profile'],
    ['equipped is not purchased', { rifle: { owned: ['extended_mag'], equipped: ['laser'] } }, 400, 'invalid_profile'],
  ];
  for (const [name, row, status, error] of variants) {
    const snapshot = h.snapshot();
    const bad = attachmentProfile(100, row);
    const response = await write(h, secret, id, bad, current.version);
    assert.equal(response.status, status, name);
    assert.equal(response.data.error, error, name);
    assert.equal(h.snapshot(), snapshot, `${name} cannot drop content while replacing head, backup or receipt`);
  }
  const unowned = baseProfile(100);
  unowned.v = 1;
  unowned.weaponAttachments = { rifle: { owned: ['laser'], equipped: ['laser'] } };
  const snapshot = h.snapshot();
  const response = await write(h, secret, id, unowned, current.version);
  assert.equal(response.status, 409);
  assert.equal(response.data.error, 'unsupported_profile');
  assert.equal(h.snapshot(), snapshot, 'an unowned weapon attachment row cannot disappear during projection');
  const head = (await h.send('GET', '/v1/vault', secret)).data.slots.find(slot => slot.id === id);
  assert.deepEqual(head, current);
  assert.deepEqual(head.profile.weaponAttachments, sanitizeProfile(attachmentProfile()).weaponAttachments);
});
