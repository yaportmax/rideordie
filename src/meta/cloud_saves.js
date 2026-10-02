// Progress belongs to SaveStore's personal slots. Cloud requests never touch
// App/Session profile references, and credentials never enter slot data.
import { sanitizeProfile, sanitizeName, canonicalJson } from '../../server/saves/schema.js';

const KEY = 'rideordie.cloud.v1';
const DEFAULT_URL = 'https://ride-or-die-saves.yaportmax.workers.dev';
const CODE = /^ROD1-[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const MAX_SLOTS = 24; // At most12 live heads plus12 recoverable tombstones.
const clone = value => JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.hasOwn(object, key);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const signature = slot => canonicalJson({ name: sanitizeName(slot.name), profile: sanitizeProfile(slot.profile), deleted: slot.deleted === true });
const publicSlot = slot => slot ? { id: slot.id, name: sanitizeName(slot.name), profile: sanitizeProfile(slot.profile),
  generation: slot.generation, version: slot.version, hash: slot.hash, updatedAt: slot.updatedAt, deleted: slot.deleted === true } : null;

class CloudError extends Error {
  constructor(kind, status = 0, slot = null) { super(kind); this.kind = kind; this.status = status; this.slot = slot; }
}
const stale = () => new CloudError('cancelled');
const messageFor = error => {
  if (error?.kind === 'storage') return 'Cloud connection could not be saved on this device. Local saves are retained.';
  if (error?.kind === 'disconnect-storage') return 'Cloud connection could not be removed from this device. Synchronization is paused.';
  if (error?.kind === 'invalid-code') return 'Enter a valid recovery code.';
  if (error?.kind === 'crypto') return 'Secure recovery codes are unavailable in this browser.';
  if (error?.kind === 'unsafe') return 'Return to the disconnected title screen before changing this save.';
  if (error?.kind === 'local') return 'Cloud progress could not be stored locally. Existing local saves are retained.';
  if (error?.kind === 'invalid-response') return 'The cloud service returned an unsupported response.';
  if (error?.kind === 'missing-conflict') return 'This conflict has changed. Synchronize again before choosing.';
  if (error?.kind === 'timeout') return 'Cloud request timed out. Local saves are retained for retry.';
  if (error?.status === 404) return 'Cloud vault was not found. Check the recovery code.';
  if (error?.status === 401 || error?.status === 403) return 'Cloud access was refused. Local saves are retained.';
  if (error?.status === 413) return 'This save exceeds the cloud size limit. Local progress is retained.';
  if (error?.status === 409) return 'Cloud progress changed. Choose how to resolve the conflict.';
  return 'Cloud is unavailable. Local saves are retained for retry.';
};
const retryable = error => error?.kind === 'network' || error?.kind === 'timeout' || error?.status === 429 || error?.status >= 500;

function randomId() {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  if (!crypto?.getRandomValues) throw new CloudError('crypto');
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function newCode() {
  if (!globalThis.crypto?.getRandomValues || !globalThis.btoa) throw new CloudError('crypto');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return `ROD1-${btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}
function remoteSlot(value) {
  if (!record(value) || !UUID.test(value.id) || !Number.isSafeInteger(value.version) || value.version < 1 || !HASH.test(value.hash)
    || typeof value.deleted !== 'boolean' || !Number.isFinite(value.updatedAt)) throw new CloudError('invalid-response');
  try { return { id: value.id, name: sanitizeName(value.name), profile: sanitizeProfile(value.profile), version: value.version,
    hash: value.hash, updatedAt: value.updatedAt, deleted: value.deleted }; }
  catch { throw new CloudError('invalid-response'); }
}
function vaultResponse(value) {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.slots) || value.slots.length > MAX_SLOTS) throw new CloudError('invalid-response');
  const slots = value.slots.map(remoteSlot);
  if (new Set(slots.map(slot => slot.id)).size !== slots.length || slots.filter(slot => slot.deleted).length > 12
    || slots.filter(slot => !slot.deleted).length > 12) throw new CloudError('invalid-response');
  return slots;
}
function persistedVault(value) {
  if (!record(value) || value.version !== 1 || !CODE.test(value.code) || !UUID.test(value.owner)
    || !record(value.acks) || !record(value.dirty) || !record(value.outbox)) throw new CloudError('storage');
  for (const map of [value.acks, value.dirty, value.outbox]) if (Object.keys(map).length > MAX_SLOTS) throw new CloudError('storage');
  for (const [id, ack] of Object.entries(value.acks)) {
    if (!UUID.test(id) || !record(ack) || !Number.isSafeInteger(ack.version) || ack.version < 0
      || !Number.isSafeInteger(ack.generation) || typeof ack.signature !== 'string' || !(ack.hash === null || HASH.test(ack.hash))) throw new CloudError('storage');
  }
  for (const [id, dirty] of Object.entries(value.dirty)) {
    if (!UUID.test(id) || !record(dirty) || !Number.isSafeInteger(dirty.generation) || typeof dirty.signature !== 'string') throw new CloudError('storage');
  }
  for (const [id, entry] of Object.entries(value.outbox)) {
    if (!UUID.test(id) || !record(entry) || !UUID.test(entry.body?.mutationId) || !Number.isSafeInteger(entry.body?.baseVersion)
      || entry.body.baseVersion < 0 || !Number.isSafeInteger(entry.generation) || typeof entry.signature !== 'string'
      || !['PUT', 'DELETE', 'POST'].includes(entry.method) || entry.path !== `/v1/slots/${id}${entry.method === 'POST' ? '/restore' : ''}`) throw new CloudError('storage');
    if (entry.method === 'PUT') { sanitizeName(entry.body.name); sanitizeProfile(entry.body.profile); }
    if (entry.method === 'POST' && (typeof entry.body.backupId !== 'string' || entry.body.backupId.length > 128)) throw new CloudError('storage');
  }
  return clone(value);
}

export class CloudSaves {
  #vault = null;
  constructor({ store, storage, fetch: fetcher = globalThis.fetch?.bind(globalThis), url,
    onChange, canApplyRemote = () => true, debounceMs = 600, timeoutMs = 10000, retryBaseMs = 2000, retryMaxMs = 60000 } = {}) {
    if (!store || !storage || typeof fetcher !== 'function') throw new TypeError('CloudSaves requires a store, storage and fetch.');
    this.store = store; this.storage = storage; this.fetch = fetcher; this.canApplyRemote = canApplyRemote;
    const parsed = new URL(url || import.meta.env?.VITE_SAVE_API_URL || DEFAULT_URL);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || !(parsed.protocol === 'https:'
      || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) throw new TypeError('Invalid cloud service URL.');
    this.url = parsed.href.replace(/\/$/, '');
    this.debounceMs = Math.max(0, Math.min(5000, debounceMs)); this.timeoutMs = Math.max(1, Math.min(30000, timeoutMs));
    this.retryBaseMs = Math.max(1, retryBaseMs); this.retryMaxMs = Math.max(this.retryBaseMs, Math.min(60000, retryMaxMs));
    this._status = 'disconnected'; this._error = null; this._lastSyncedAt = null; this._epoch = 0;
    this._disposed = false; this._suspended = false; this._connecting = false; this._suppress = 0;
    this._queue = Promise.resolve(); this._syncPromise = null; this._controllers = new Set(); this._listeners = new Set();
    this._conflicts = new Map(); this._deferred = new Map(); this._timer = null; this._retries = 0;
    if (typeof onChange === 'function') this._listeners.add(onChange);
    try {
      const raw = storage.getItem(KEY);
      if (raw) { this.#vault = persistedVault(JSON.parse(raw)); this._lastSyncedAt = this.#vault.lastSyncedAt || null; this._status = 'pending'; }
    } catch { this._error = messageFor(new CloudError('storage')); this._status = 'error'; }
    this._unsubscribe = store.onChange(event => this._storeChanged(event));
    this._online = () => { this._retries = 0; this._schedule(0); };
    this._storageChanged = event => {
      if (event?.key !== KEY || !this.#vault) return;
      try { this._ownership(); } catch (error) { if (error?.kind !== 'cancelled') this._fail(error); }
    };
    globalThis.addEventListener?.('online', this._online);
    globalThis.addEventListener?.('storage', this._storageChanged);
    if (this.#vault) this._schedule(this.debounceMs);
  }

  state() {
    const pending = new Set([...Object.keys(this.#vault?.dirty || {}), ...Object.keys(this.#vault?.outbox || {}),
      ...this._deferred.keys(), ...this._conflicts.keys()]).size;
    return { connected: !!this.#vault && !this._suspended, status: this._status, lastSyncedAt: this._lastSyncedAt,
      ...(this._error ? { error: this._error } : {}), conflicts: [...this._conflicts].map(([slotId, conflict]) => ({ slotId,
        local: publicSlot(conflict.local), remote: publicSlot(conflict.remote) })), pending };
  }
  recoveryCode() { return this.#vault?.code || null; }
  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit() { const state = this.state(); for (const fn of this._listeners) { try { fn(clone(state)); } catch { /* UI listeners cannot break durable synchronization. */ } } }
  _check(epoch) {
    if (this._disposed || epoch !== this._epoch) throw stale();
    if (this.#vault && !this._connecting) this._ownership();
  }
  _ownership() {
    if (!this.#vault || this._suspended) throw stale();
    let disk;
    try { disk = JSON.parse(this.storage.getItem(KEY)); } catch { throw new CloudError('storage'); }
    if (disk?.code !== this.#vault.code || disk?.owner !== this.#vault.owner) {
      this._rotate(); this.#vault = null; this._conflicts.clear(); this._deferred.clear();
      this._status = 'disconnected'; this._error = null; this._emit(); throw stale();
    }
  }
  _rotate() {
    this._epoch++; this._clearTimer(); this._syncPromise = null;
    for (const controller of this._controllers) controller.abort();
    this._controllers.clear(); this._retries = 0;
    return this._epoch;
  }
  _clearTimer() { if (this._timer !== null) clearTimeout(this._timer); this._timer = null; }
  _schedule(delay = this.debounceMs) {
    if (!this.#vault || this._disposed || this._suspended || this._connecting || this._retries >= 6) return;
    this._clearTimer();
    this._timer = setTimeout(() => { this._timer = null; void this.sync(); }, delay);
    this._timer.unref?.();
  }
  _readLocal(id) { return this.store.list({ includeDeleted: true }).find(slot => slot.id === id) || null; }
  _writeVault(value) {
    try {
      const bytes = JSON.stringify(value);
      this.storage.setItem(KEY, bytes);
      if (this.storage.getItem(KEY) !== bytes) throw new CloudError('storage');
      this.#vault = value;
    } catch { throw new CloudError('storage'); }
  }
  _commit(change) {
    if (!this.#vault || this._suspended) throw stale();
    // Detect an explicit disconnect/reconnection in another tab before writing
    // this tab's acknowledgements or stale credentials back into storage.
    this._ownership();
    const next = clone(this.#vault); change(next);
    const localIds = new Set(this.store.list({ includeDeleted: true }).map(slot => slot.id));
    for (const id of Object.keys(next.acks)) if (!localIds.has(id) && !own(next.outbox, id)) delete next.acks[id];
    for (const id of Object.keys(next.dirty)) if (!localIds.has(id)) delete next.dirty[id];
    this._writeVault(next);
  }
  _metadata(id, patch) {
    this._suppress++;
    try { this.store.setSync(id, patch); } catch { throw new CloudError('local'); }
    finally { this._suppress--; }
  }
  _storeChanged(event) {
    if (this._suppress || this._disposed || !this.#vault || this._suspended || this._connecting
      || ['sync', 'active', 'activate', 'remote', 'backup', 'error'].includes(event?.type)) return;
    try {
      const slots = event?.slotId ? [this._readLocal(event.slotId)].filter(Boolean) : this.store.list({ includeDeleted: true });
      this._commit(next => { for (const slot of slots) next.dirty[slot.id] = { generation: slot.generation, signature: signature(slot) }; });
      for (const slot of slots) this._metadata(slot.id, { dirty: true, vaultId: this.#vault.owner });
      this._retries = 0;
      if (this._status !== 'syncing') this._status = this._conflicts.size ? 'conflict' : 'pending';
      this._error = null; this._emit(); this._schedule();
    } catch (error) { this._fail(error); }
  }
  _fail(error) {
    if (error?.kind === 'cancelled') return;
    this._error = messageFor(error); this._status = retryable(error) ? 'offline' : 'error';
    if (retryable(error)) { this._retries++; this._schedule(Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** (this._retries - 1))); }
    this._emit();
  }
  _enqueue(epoch, fn) {
    const work = this._queue.then(async () => {
      this._check(epoch);
      try { await fn(); }
      catch (error) { if (epoch === this._epoch) this._fail(error); }
      return this.state();
    }).catch(error => { if (epoch === this._epoch) this._fail(error); return this.state(); });
    this._queue = work.then(() => undefined); return work;
  }
  async _request(code, path, { method = 'GET', body } = {}, epoch) {
    this._check(epoch);
    const controller = new AbortController(); this._controllers.add(controller);
    let timeout = false, timer, rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = () => reject(timeout ? new CloudError('timeout') : stale()); controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
    timer = setTimeout(() => { timeout = true; controller.abort(); }, this.timeoutMs); timer.unref?.();
    try {
      const operation = (async () => {
        let response;
        try { response = await this.fetch(`${this.url}${path}`, { method, signal: controller.signal, cache: 'no-store', credentials: 'omit',
          headers: { Authorization: `Bearer ${code}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
        catch { throw new CloudError('network'); }
        let data;
        try { data = await response.json(); } catch { throw new CloudError('invalid-response'); }
        if (!response.ok) {
          let slot = null;
          if (response.status === 409 && data?.slot) slot = remoteSlot(data.slot);
          throw new CloudError(response.status === 409 && data?.error === 'conflict' ? 'conflict' : 'http', response.status, slot);
        }
        return data;
      })();
      const data = await Promise.race([operation, aborted]); this._check(epoch); return data;
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', rejectAbort); this._controllers.delete(controller);
    }
  }

  async createVault() {
    if (this._disposed) return this.state();
    const epoch = this._rotate(); this._connecting = true; this._error = null; this._status = 'connecting';
    try {
      // Persist the random code before the first network attempt. An unknown
      // create outcome must retry this vault, never generate another code.
      const dirty = Object.fromEntries(this.store.list({ includeDeleted: true }).map(slot => [slot.id, { generation: slot.generation, signature: signature(slot) }]));
      this._writeVault({ version: 1, code: newCode(), owner: randomId(), creating: true, acks: {}, dirty, outbox: {}, lastSyncedAt: null });
      this._suspended = false;
      this._conflicts.clear(); this._deferred.clear(); this._lastSyncedAt = null;
    } catch (error) { this._connecting = false; this._fail(error); return this.state(); }
    this._emit();
    return this._enqueue(epoch, async () => { this._connecting = false; await this._sync(epoch); });
  }
  async connect(input) {
    const code = typeof input === 'string' ? input.trim() : '';
    if (!CODE.test(code)) { this._fail(new CloudError('invalid-code')); return this.state(); }
    if (this._disposed) return this.state();
    const epoch = this._rotate(); this._connecting = true; this._error = null; this._status = 'connecting'; this._emit();
    return this._enqueue(epoch, async () => {
      try {
        const slots = vaultResponse(await this._request(code, '/v1/vault', {}, epoch)); this._check(epoch);
        const sameVault = this.#vault?.code === code && !this._suspended;
        if (!sameVault) {
          const dirty = Object.fromEntries(this.store.list({ includeDeleted: true }).map(slot => [slot.id, { generation: slot.generation, signature: signature(slot) }]));
          this._writeVault({ version: 1, code, owner: randomId(), creating: false, acks: {}, dirty, outbox: {}, lastSyncedAt: null });
          this._suspended = false;
          this._conflicts.clear(); this._deferred.clear(); this._lastSyncedAt = null;
        }
        this._connecting = false;
        await this._sync(epoch, slots);
      } finally { if (epoch === this._epoch) this._connecting = false; }
    });
  }
  disconnect() {
    this._rotate(); this._connecting = false;
    try {
      this.storage.removeItem(KEY);
      if (this.storage.getItem(KEY) !== null && this.storage.getItem(KEY) !== undefined) throw new CloudError('disconnect-storage');
      this.#vault = null; this._suspended = false; this._conflicts.clear(); this._deferred.clear(); this._lastSyncedAt = null;
      this._error = null; this._status = 'disconnected'; this._emit();
    } catch { this._suspended = true; this._fail(new CloudError('disconnect-storage')); }
    return this.state();
  }
  sync() {
    if (!this.#vault || this._suspended || this._disposed || this._connecting) return Promise.resolve(this.state());
    if (this._syncPromise) return this._syncPromise;
    this._clearTimer(); const epoch = this._epoch;
    const promise = this._enqueue(epoch, () => this._sync(epoch)); this._syncPromise = promise;
    void promise.finally(() => { if (this._syncPromise === promise) this._syncPromise = null; });
    return promise;
  }
  _conflict(id, local, remote) { this._conflicts.set(id, { local: clone(local), remote: clone(remote) }); this._deferred.delete(id); }
  _ack(id, remote, generation, content) {
    const current = this._readLocal(id), dirty = current && (current.generation !== generation || signature(current) !== content);
    this._commit(next => {
      next.acks[id] = { version: remote?.version || 0, hash: remote?.hash || null, generation, signature: content };
      if (dirty) next.dirty[id] = { generation: current.generation, signature: signature(current) }; else delete next.dirty[id];
    });
    if (current) this._metadata(id, { dirty: !!dirty, version: remote?.version || 0, baseVersion: remote?.version || 0,
      hash: remote?.hash || null, baseHash: remote?.hash || null, ackGeneration: generation, vaultId: this.#vault.owner, error: null });
    this._conflicts.delete(id); this._deferred.delete(id);
  }
  _apply(remote, local) {
    this._ownership();
    if (!this.canApplyRemote(remote.id)) { this._deferred.set(remote.id, clone(remote)); return false; }
    this._suppress++;
    try {
      const slot = this.store.applyRemote(clone(remote), local ? { expectedGeneration: local.generation } : {});
      this._ack(remote.id, remote, slot.generation, signature(slot)); return true;
    } catch (error) {
      if (['active-delete', 'generation-conflict', 'stale-generation'].includes(error?.code)) {
        this._conflict(remote.id, this._readLocal(remote.id) || local, remote); return false;
      }
      this._deferred.set(remote.id, clone(remote)); throw new CloudError('local');
    } finally { this._suppress--; }
  }
  _queueSlot(slot, baseVersion) {
    if (own(this.#vault.outbox, slot.id)) return;
    const content = signature(slot), method = slot.deleted ? 'DELETE' : 'PUT';
    const body = { ...(method === 'PUT' ? { name: sanitizeName(slot.name), profile: sanitizeProfile(slot.profile) } : {}), baseVersion, mutationId: randomId() };
    this._commit(next => { next.outbox[slot.id] = { method, path: `/v1/slots/${slot.id}`, body, generation: slot.generation, signature: content }; });
  }
  async _sendQueued(id, epoch) {
    if (!this.#vault.outbox[id]) return null;
    const entry = clone(this.#vault.outbox[id]);
    try {
      const response = await this._request(this.#vault.code, entry.path, { method: entry.method, body: entry.body }, epoch);
      const remote = remoteSlot(response?.slot);
      if (remote.id !== id || remote.version <= entry.body.baseVersion
        || (entry.method === 'PUT' && signature(remote) !== entry.signature)
        || (entry.method === 'DELETE' && !remote.deleted)) throw new CloudError('invalid-response');
      this._check(epoch);
      // Clear only after proof from the exact immutable mutation request.
      // If persisting the receipt fails, retain that same request for retry.
      this._commit(next => {
        if (next.outbox[id]?.body.mutationId === entry.body.mutationId) delete next.outbox[id];
        if (entry.method === 'PUT') next.acks[id] = { version: remote.version, hash: remote.hash, generation: entry.generation, signature: signature(remote) };
        const local = this._readLocal(id);
        if (local && (local.generation !== entry.generation || signature(local) !== entry.signature)) next.dirty[id] = { generation: local.generation, signature: signature(local) };
        else delete next.dirty[id];
      });
      if (entry.method !== 'PUT') {
        const local = this._readLocal(id);
        if (!local || (local.generation === entry.generation && signature(local) === entry.signature)) this._apply(remote, local);
        else this._conflict(id, local, remote);
      } else this._ack(id, remote, entry.generation, entry.signature);
      return remote;
    } catch (error) {
      if (error?.status === 409 && error.kind === 'conflict') {
        this._check(epoch);
        this._commit(next => { if (next.outbox[id]?.body.mutationId === entry.body.mutationId) delete next.outbox[id]; });
        this._conflict(id, this._readLocal(id), error.slot); return error.slot;
      }
      throw error;
    }
  }
  async _sync(epoch, knownSlots) {
    this._check(epoch); this._status = 'syncing'; this._error = null; this._emit();
    if (this.#vault.creating) {
      vaultResponse(await this._request(this.#vault.code, '/v1/vault', { method: 'POST' }, epoch));
      this._commit(next => { next.creating = false; });
    }
    const slots = knownSlots || vaultResponse(await this._request(this.#vault.code, '/v1/vault', {}, epoch));
    const remoteMap = new Map(slots.map(slot => [slot.id, slot]));
    // Retry unacknowledged mutations before comparing GET heads. Identical
    // content alone does not prove a timed-out CAS request was accepted.
    for (const id of Object.keys(this.#vault.outbox)) {
      const remote = await this._sendQueued(id, epoch);
      if (remote) remoteMap.set(id, remote);
      else if (this._conflicts.get(id)?.remote === null) remoteMap.delete(id);
    }
    for (const remote of remoteMap.values()) {
      this._check(epoch); const local = this._readLocal(remote.id), ack = this.#vault.acks[remote.id];
      if (!local) { this._apply(remote, null); continue; }
      const content = signature(local), same = content === signature(remote);
      if (this._conflicts.has(remote.id)) { if (same) this._ack(remote.id, remote, local.generation, content); else this._conflict(remote.id, local, remote); continue; }
      if (same) { this._ack(remote.id, remote, local.generation, content); continue; }
      const dirty = !ack || local.generation !== ack.generation || content !== ack.signature || own(this.#vault.dirty, local.id);
      const changed = !ack || remote.version !== ack.version || remote.hash !== ack.hash;
      if (!dirty) this._apply(remote, local);
      else if (changed) this._conflict(remote.id, local, remote);
    }
    for (const id of this._deferred.keys()) if (!remoteMap.has(id)) this._deferred.delete(id);
    for (const local of this.store.list({ includeDeleted: true })) {
      this._check(epoch);
      if (this._conflicts.has(local.id) || this._deferred.has(local.id)) continue;
      const ack = this.#vault.acks[local.id], content = signature(local), remote = remoteMap.get(local.id);
      if (!remote && ack?.version > 0) {
        if (ack.missing && ack.generation === local.generation && ack.signature === content) continue;
        this._conflict(local.id, local, null); continue;
      }
      if (ack && ack.generation === local.generation && ack.signature === content && !own(this.#vault.dirty, local.id)) continue;
      if (local.deleted && !remote) { this._ack(local.id, null, local.generation, content); continue; }
      this._queueSlot(local, ack?.version || 0); await this._sendQueued(local.id, epoch);
    }
    this._check(epoch);
    this._lastSyncedAt = Date.now(); this._commit(next => { next.lastSyncedAt = this._lastSyncedAt; });
    this._retries = 0; this._error = null;
    this._status = this._conflicts.size ? 'conflict' : this.state().pending ? 'pending' : 'connected'; this._emit();
    if (Object.keys(this.#vault.dirty).some(id => !this._conflicts.has(id) && !this._deferred.has(id))) this._schedule();
  }

  resolve(slotId, choice) {
    if (!['local', 'cloud', 'both'].includes(choice)) { this._fail(new CloudError('missing-conflict')); return Promise.resolve(this.state()); }
    const epoch = this._epoch;
    return this._enqueue(epoch, async () => {
      if (!this.#vault || this._suspended || !this.canApplyRemote(slotId)) throw new CloudError('unsafe');
      const conflict = this._conflicts.get(slotId), local = this._readLocal(slotId);
      if (!conflict || !local || local.generation !== conflict.local?.generation) throw new CloudError('missing-conflict');
      // Re-fetch CAS head at the decision boundary. A decision on an older
      // displayed conflict must not overwrite a third device's newer branch.
      const slots = vaultResponse(await this._request(this.#vault.code, '/v1/vault', {}, epoch));
      const remote = slots.find(slot => slot.id === slotId); this._check(epoch);
      const current = this._readLocal(slotId);
      if (!this.canApplyRemote(slotId)) throw new CloudError('unsafe');
      if (remote?.deleted && choice !== 'local' && this.store.activeId() === slotId) throw new CloudError('unsafe');
      if ((conflict.remote ? !remote || remote.version !== conflict.remote.version || remote.hash !== conflict.remote.hash : !!remote)
        || current?.generation !== local.generation) {
        if (remote && current) this._conflict(slotId, current, remote);
        throw new CloudError('missing-conflict');
      }
      this._suppress++;
      try {
        if (!remote) {
          // A pruned tombstone/absent acknowledged ID cannot be recreated.
          // Explicit local recovery keeps it and publishes a fresh identity.
          if (choice === 'cloud') {
            if (this.store.activeId() === slotId) throw new CloudError('unsafe');
            this.store.remove(slotId);
          } else this.store.duplicate(slotId, `${local.name.slice(0, 42)} (recovered copy)`);
          const retained = this._readLocal(slotId);
          this._commit(next => {
            next.acks[slotId] = { ...next.acks[slotId], missing: true, generation: retained.generation, signature: signature(retained) };
            delete next.dirty[slotId]; delete next.outbox[slotId];
          });
          this._conflicts.delete(slotId);
        } else if (choice === 'local') {
          this.store.retainBackup(slotId, { profile: clone(remote.profile), name: remote.name });
          this._commit(next => {
            next.acks[slotId] = { version: remote.version, hash: remote.hash, generation: local.generation, signature: signature(remote) };
            next.dirty[slotId] = { generation: local.generation, signature: signature(local) }; delete next.outbox[slotId];
          });
          this._conflicts.delete(slotId); this._queueSlot(local, remote.version); await this._sendQueued(slotId, epoch);
        } else {
          if (choice === 'both') this.store.duplicate(slotId, `${local.name.slice(0, 42)} (conflict copy)`);
          if (!this._apply(remote, local)) throw new CloudError('local');
        }
      } catch (error) { if (error instanceof CloudError) throw error; throw new CloudError('local'); }
      finally { this._suppress--; }
      await this._sync(epoch);
    });
  }
  history(slotId) {
    const epoch = this._epoch;
    // History participates in the same serial request lane but returns records.
    let history = [];
    return this._enqueue(epoch, async () => {
      if (!this.#vault || !UUID.test(slotId) || this._suspended) throw new CloudError('unsafe');
      const result = await this._request(this.#vault.code, `/v1/slots/${slotId}/history`, {}, epoch);
      if (!Array.isArray(result?.history) || result.history.length > 10) throw new CloudError('invalid-response');
      try {
        history = result.history.map(item => {
          if (!record(item) || typeof item.id !== 'string' || item.id.length > 128 || !Number.isFinite(item.at)
            || !Number.isSafeInteger(item.version) || item.version < 1 || !HASH.test(item.hash)) throw new CloudError('invalid-response');
          return { id: item.id, at: item.at, name: sanitizeName(item.name), profile: sanitizeProfile(item.profile), version: item.version, hash: item.hash };
        });
      } catch { throw new CloudError('invalid-response'); }
    }).then(() => history);
  }
  restoreCloud(slotId, backupId) {
    const epoch = this._epoch;
    return this._enqueue(epoch, async () => {
      if (!this.#vault || this._suspended || !this.canApplyRemote(slotId)) throw new CloudError('unsafe');
      const local = this._readLocal(slotId), ack = this.#vault.acks[slotId];
      if (!local || !ack || !ack.version || own(this.#vault.outbox, slotId) || own(this.#vault.dirty, slotId)
        || local.generation !== ack.generation || signature(local) !== ack.signature || this._conflicts.has(slotId)
        || typeof backupId !== 'string' || !backupId || backupId.length > 128) throw new CloudError('missing-conflict');
      this._commit(next => { next.outbox[slotId] = { method: 'POST', path: `/v1/slots/${slotId}/restore`,
        body: { backupId, baseVersion: ack.version, mutationId: randomId() }, generation: local.generation, signature: signature(local) }; });
      await this._sendQueued(slotId, epoch); await this._sync(epoch);
    });
  }
  dispose() {
    this._disposed = true; this._rotate(); this._unsubscribe?.(); this._listeners.clear();
    globalThis.removeEventListener?.('online', this._online); globalThis.removeEventListener?.('storage', this._storageChanged);
  }
}
