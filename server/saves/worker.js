import { DurableObject } from 'cloudflare:workers';
import { MAX_BODY_BYTES, MAX_SLOTS, MAX_TOMBSTONES, MAX_BACKUPS, UUID, sanitizeName, sanitizeProfile, canonicalJson, sha256, contentHash } from './schema.js';
import { assertSupportedProfile, SUPPORTED_PROFILE_VERSION } from './profile_support.js';

const SERVICE = 'ride-or-die-saves';
const CODE = /^ROD1-[a-zA-Z0-9_-]{43}$/;
const INTERNAL = 'https://save-vault.internal';
const RATE_WINDOW_MS = 60_000;
const VAULT_RATE = 60;
class ApiError extends Error {
  constructor(status, error, extra = {}) { super(error); this.status = status; this.error = error; this.extra = extra; }
}
// Header absence is the last published Hummer client's capability, not permission
// to project a future slot into that client's smaller catalogue.
function profileCapability(request) {
  const value = request.headers.get('X-ROD-Profile-Version');
  if (value === null) return 2;
  if (!['1', '2', '3', String(SUPPORTED_PROFILE_VERSION)].includes(value)) throw new ApiError(409, 'unsupported_profile');
  return Number(value);
}
function compatibleProfile(profile, capability) {
  if (!profile) return;
  try { assertSupportedProfile(profile, capability); }
  catch (error) {
    if (error?.code === 'unsupported-profile') throw new ApiError(409, 'unsupported_profile', { ...(Number.isSafeInteger(error.requiredVersion) ? { requiredVersion: error.requiredVersion } : {}) });
    throw error;
  }
}
function allowedOrigin(origin) {
  if (origin === 'https://ride.maxyaport.com') return true;
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return origin === url.origin && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch { return false; }
}
function response(data, status = 200, origin, extraHeaders = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  if (allowedOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'ETag, Retry-After');
  }
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
}
function errorResponse(error, origin) {
  if (error instanceof ApiError) return response({ error: error.error, ...error.extra }, error.status, origin, error.status === 429 ? { 'Retry-After': '60' } : {});
  // Do not log arbitrary exceptions, requests, URLs, profiles or credentials.
  return response({ error: 'unavailable' }, 503, origin);
}
function route(request) {
  const url = new URL(request.url);
  if (url.search) throw new ApiError(400, 'query_not_allowed');
  if (url.pathname === '/v1/vault' && ['POST', 'GET'].includes(request.method)) return { type: 'vault' };
  const match = /^\/v1\/slots\/([^/]+)(?:\/(history|restore))?$/.exec(url.pathname);
  if (!match || !UUID.test(match[1])) throw new ApiError(404, 'not_found');
  const action = match[2];
  if ((!action && !['PUT', 'DELETE'].includes(request.method)) || (action === 'history' && request.method !== 'GET') || (action === 'restore' && request.method !== 'POST')) throw new ApiError(405, 'method_not_allowed');
  return { type: action || 'slot', id: match[1].toLowerCase() };
}
function baseVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(400, 'invalid_base_version');
  return value;
}
function mutationId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new ApiError(400, 'invalid_mutation_id');
  return value.toLowerCase();
}
async function readJson(request, { allowEmpty = false } = {}) {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new ApiError(413, 'body_too_large');
  const chunks = [], reader = request.body?.getReader();
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new ApiError(413, 'body_too_large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  // Cloudflare can represent a no-body POST as a truthy empty stream. Only
  // actual bounded bytes establish emptiness, never body or length metadata.
  if (size === 0 && allowEmpty) return null;
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json(?:\s*;.*)?$/i.test(type)) throw new ApiError(415, 'json_required');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ApiError(400, 'invalid_json'); }
}
async function payload(request, target) {
  if (request.method === 'GET') {
    if (request.body) throw new ApiError(400, 'body_not_allowed');
    return null;
  }
  if (target.type === 'vault') {
    // Creation accepts no body or an empty JSON object, including safe retries.
    const body = await readJson(request, { allowEmpty: true });
    if (body !== null && Object.keys(body).length) throw new ApiError(400, 'invalid_vault_body');
    return null;
  }
  const body = await readJson(request), data = { baseVersion: baseVersion(body.baseVersion), mutationId: mutationId(body.mutationId) };
  const precondition = request.headers.get('If-Match');
  if (precondition && ![String(data.baseVersion), `"${data.baseVersion}"`].includes(precondition)) throw new ApiError(400, 'invalid_precondition');
  try {
    if (request.method === 'PUT') { compatibleProfile(body.profile, profileCapability(request)); data.name = sanitizeName(body.name); data.profile = sanitizeProfile(body.profile); }
    if (target.type === 'restore') {
      if (body.backupId !== 'current' && (typeof body.backupId !== 'string' || !UUID.test(body.backupId))) throw new ApiError(400, 'invalid_backup_id');
      data.backupId = body.backupId === 'current' ? 'current' : body.backupId.toLowerCase();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, error.message === 'invalid_name' ? 'invalid_name' : 'invalid_profile');
  }
  return data;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    try {
      const url = new URL(request.url);
      if (origin && !allowedOrigin(origin)) throw new ApiError(403, 'origin_not_allowed');
      if (url.pathname === '/health' && request.method === 'GET' && !url.search) return response({ service: SERVICE, version: 1 }, 200, origin);
      if (!allowedOrigin(origin)) throw new ApiError(403, 'origin_required');
      if (request.method === 'OPTIONS') {
        const method = request.headers.get('Access-Control-Request-Method');
        const headers = (request.headers.get('Access-Control-Request-Headers') || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
        if (method && !['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new ApiError(403, 'preflight_not_allowed');
        if (headers.some(h => !['authorization', 'content-type', 'if-match', 'x-rod-profile-version'].includes(h))) throw new ApiError(403, 'preflight_not_allowed');
        return response(null, 204, origin, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, X-ROD-Profile-Version', 'Access-Control-Max-Age': '600' });
      }
      const target = route(request);
      const capability = profileCapability(request);
      if (!env.SAVE_IP_LIMIT || !env.SAVE_VAULT_LIMIT || !env.SAVE_VAULTS) throw new ApiError(503, 'unavailable');
      // This coarse IP budget mitigates random-vault creation/invalid-auth abuse.
      // It supplements the private identity limit; shared networks have 120/min.
      const ip = request.headers.get('CF-Connecting-IP') || 'local-development';
      if (!(await env.SAVE_IP_LIMIT.limit({ key: `${SERVICE}:ip:${ip}` })).success) throw new ApiError(429, 'rate_limited');
      const authorization = request.headers.get('Authorization') || '';
      const match = /^Bearer (ROD1-[a-zA-Z0-9_-]{43})$/.exec(authorization);
      if (!match || !CODE.test(match[1])) throw new ApiError(401, 'unauthorized');
      const identity = await sha256(`${SERVICE}:vault:v1\0${match[1]}`);
      if (!(await env.SAVE_VAULT_LIMIT.limit({ key: identity })).success) throw new ApiError(429, 'rate_limited');
      const data = await payload(request, target);
      const id = env.SAVE_VAULTS.idFromName(identity), stub = env.SAVE_VAULTS.get(id);
      // Authorization never crosses the Worker/DO boundary or enters storage.
      const internal = new Request(`${INTERNAL}${url.pathname}`, { method: request.method, headers: { 'Origin': origin, 'X-ROD-Profile-Version': String(capability), ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
      const result = await stub.fetch(internal);
      const headers = new Headers(result.headers);
      headers.set('Cache-Control', 'no-store'); headers.set('Vary', 'Origin');
      headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Expose-Headers', 'ETag, Retry-After');
      return new Response(result.body, { status: result.status, headers });
    } catch (error) { return errorResponse(error, origin); }
  },
};

export class SaveVault extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.storage.transactionSync(() => this.sql.exec(`
      CREATE TABLE IF NOT EXISTS vault_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS backups (slot_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (slot_id, id));
      CREATE INDEX IF NOT EXISTS backups_versions ON backups(slot_id, version DESC);
    `));
  }
  meta(key) { return this.sql.exec('SELECT value FROM vault_meta WHERE key = ?', key).toArray()[0]?.value; }
  setMeta(key, value) { this.sql.exec('INSERT INTO vault_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value)); }
  head(id) { const row = this.sql.exec('SELECT data FROM slots WHERE id = ?', id).toArray()[0]; return row ? JSON.parse(row.data) : null; }
  publicHead(head) {
    if (!head) return null;
    const { receipt: _receipt, deletionOrder: _order, ...slot } = head;
    return slot;
  }
  rate() {
    return this.storage.transactionSync(() => {
      const now = Date.now(), window = Math.floor(now / RATE_WINDOW_MS), prior = this.meta('rate');
      const row = prior ? JSON.parse(prior) : { window, count: 0 };
      const count = row.window === window ? row.count : 0;
      if (count >= VAULT_RATE) throw new ApiError(429, 'rate_limited');
      this.setMeta('rate', JSON.stringify({ window, count: count + 1 }));
    });
  }
  check(current, base, receipt) {
    if (receipt.id && current?.receipt?.id === receipt.id) {
      if (current.receipt.fingerprint === receipt.fingerprint) return true;
      throw new ApiError(409, 'conflict', { slot: this.publicHead(current) });
    }
    if ((current?.version || 0) !== base) throw new ApiError(409, 'conflict', { slot: this.publicHead(current) });
    return false;
  }
  commit(id, current, candidate, receipt) {
    // Vault-wide versions prevent ABA: pruning and recreating an old UUID must
    // never reuse a version still held by an offline device.
    const now = Date.now(), version = Math.max(Number(this.meta('versionSequence') || 0), current?.version || 0) + 1;
    if (!Number.isSafeInteger(version)) throw new ApiError(409, 'version_exhausted');
    if (!candidate.deleted && (!current || current.deleted) && this.sql.exec("SELECT COUNT(*) AS count FROM slots WHERE json_extract(data, '$.deleted') = 0").toArray()[0].count >= MAX_SLOTS) throw new ApiError(409, 'slot_limit');
    if (current) {
      const backup = { id: crypto.randomUUID(), at: now, name: current.name, profile: current.profile, version: current.version, hash: current.hash, deleted: current.deleted };
      this.sql.exec('INSERT INTO backups (slot_id, id, version, data) VALUES (?, ?, ?, ?)', id, backup.id, backup.version, JSON.stringify(backup));
      this.sql.exec('DELETE FROM backups WHERE slot_id = ? AND id NOT IN (SELECT id FROM backups WHERE slot_id = ? ORDER BY version DESC LIMIT ?)', id, id, MAX_BACKUPS);
    }
    this.setMeta('versionSequence', version);
    const deletionOrder = candidate.deleted ? version : null;
    const head = { id, ...candidate, version, createdAt: current?.createdAt || now, updatedAt: now, receipt, deletionOrder };
    this.sql.exec('INSERT INTO slots (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', id, JSON.stringify(head));
    const deleted = this.sql.exec("SELECT id FROM slots WHERE json_extract(data, '$.deleted') = 1 ORDER BY json_extract(data, '$.deletionOrder') ASC, id ASC").toArray();
    for (const row of deleted.slice(0, Math.max(0, deleted.length - MAX_TOMBSTONES))) {
      this.sql.exec('DELETE FROM backups WHERE slot_id = ?', row.id);
      this.sql.exec('DELETE FROM slots WHERE id = ?', row.id);
    }
    return this.publicHead(head);
  }
  async fetch(request) {
    const origin = request.headers.get('Origin');
    try {
      if (new URL(request.url).origin !== INTERNAL || !allowedOrigin(origin)) throw new ApiError(403, 'internal_only');
      const target = route(request), capability = profileCapability(request), body = await payload(request, target);
      // A unknown-vault read does not create a usable vault.
      if (target.type === 'vault' && request.method === 'POST') {
        this.rate();
        this.storage.transactionSync(() => { if (!this.meta('created')) this.setMeta('created', new Date().toISOString()); });
        // Retry creation must include existing heads, never claim they vanished.
        const slots = this.sql.exec('SELECT data FROM slots ORDER BY id').toArray().map(row => this.publicHead(JSON.parse(row.data)));
        return response({ version: 1, slots }, 200, origin);
      }
      if (!this.meta('created')) throw new ApiError(404, 'vault_not_found');
      this.rate();
      if (target.type === 'vault') {
        const slots = this.sql.exec('SELECT data FROM slots ORDER BY id').toArray().map(row => this.publicHead(JSON.parse(row.data)));
        return response({ version: 1, slots }, 200, origin);
      }
      const current = this.head(target.id);
      if (target.type === 'history') {
        if (!current) throw new ApiError(404, 'slot_not_found');
        const history = this.sql.exec('SELECT data FROM backups WHERE slot_id = ? ORDER BY version DESC LIMIT ?', target.id, MAX_BACKUPS).toArray().map(row => JSON.parse(row.data));
        return response({ history }, 200, origin);
      }
      const operation = target.type === 'restore' ? 'restore' : request.method.toLowerCase();
      const { mutationId: _mutationId, ...mutation } = body;
      const fingerprint = await sha256(canonicalJson({ operation, ...mutation }));
      const receipt = { id: body.mutationId, fingerprint };
      // Snapshot only a head matching the caller's base. Hashing yields; recheck
      // CAS inside the final transaction so this snapshot cannot overwrite a race.
      const prepared = this.storage.transactionSync(() => {
        const live = this.head(target.id);
        compatibleProfile(live?.profile, capability);
        if (this.check(live, body.baseVersion, receipt)) return { replay: this.publicHead(live) };
        if (request.method === 'PUT') return { candidate: { name: body.name, profile: body.profile, deleted: false } };
        if (!live) throw new ApiError(404, 'slot_not_found');
        if (target.type === 'restore') {
          const row = body.backupId === 'current' ? live : this.sql.exec('SELECT data FROM backups WHERE slot_id = ? AND id = ?', target.id, body.backupId).toArray()[0];
          if (!row) throw new ApiError(404, 'backup_not_found');
          const source = body.backupId === 'current' ? row : JSON.parse(row.data);
          compatibleProfile(source.profile, capability);
          return { candidate: { name: source.name, profile: source.profile, deleted: false } };
        }
        return { candidate: { name: live.name, profile: live.profile, deleted: true } };
      });
      if (prepared.replay) return response({ slot: prepared.replay }, 200, origin, { ETag: `"${prepared.replay.version}"` });
      const candidate = prepared.candidate;
      candidate.hash = await contentHash(candidate.name, candidate.profile, candidate.deleted);
      const slot = this.storage.transactionSync(() => {
        const live = this.head(target.id);
        // The head may have changed while contentHash yielded. Refusal must be
        // inside the same transaction as CAS, before backups/receipts/versions.
        compatibleProfile(live?.profile, capability);
        compatibleProfile(candidate.profile, capability);
        if (this.check(live, body.baseVersion, receipt)) return this.publicHead(live);
        return this.commit(target.id, live, candidate, receipt);
      });
      return response({ slot }, 200, origin, { ETag: `"${slot.version}"` });
    } catch (error) { return errorResponse(error, origin); }
  }
}
