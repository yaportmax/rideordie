import test from 'node:test';
import assert from 'node:assert/strict';
import { createIceProvider, getIceConfig } from '../src/net/ice.js';

const creds = (now = 1000) => ({ expiresAt: now + 21600000, iceServers: [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'temporary-user', credential: 'temporary-password', unexpectedMasterKey: 'never-copy-me' },
] });
const response = body => ({ ok: true, json: async () => body });

test('unprovisioned deployment keeps independent healthy STUN configurations without requesting credentials', async () => {
  const first = await getIceConfig(), second = await getIceConfig();
  assert.deepEqual(first, { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }] });
  first.iceServers.pop(); assert.equal(second.iceServers.length, 2);
});

test('parallel room attempts share issuance; callers cannot mutate cached credentials', async () => {
  let calls = 0, release, seen;
  const get = createIceProvider({ now: () => 1000, fetcher: async (...args) => { calls++; seen = args; await new Promise(resolve => { release = resolve; }); return response(creds()); } });
  const a = get(), b = get(); assert.equal(calls, 1); release();
  const [first, second] = await Promise.all([a, b]); first.iceServers[1].urls.pop();
  assert.equal(second.iceServers[1].urls.length, 2);
  assert.equal(JSON.stringify(second).includes('never-copy-me'), false);
  assert.equal((await get()).iceServers[1].urls.length, 2); assert.equal(calls, 1);
  assert.equal(seen[1].credentials, 'omit'); assert.equal(seen[1].cache, 'no-store'); assert.equal(seen[1].method, 'POST');
});

test('credential cache renews before expiry and failed issuance can retry', async () => {
  let time = 1000, calls = 0;
  const get = createIceProvider({ now: () => time, fetcher: async () => { calls++; if (calls === 2) throw new Error('private upstream token'); return response(creds(time)); } });
  await get(); time += 21400000;
  await assert.rejects(get(), error => !error.message.includes('token') && /try creating/.test(error.message));
  await get(); assert.equal(calls, 3);
});

test('rejects expired, untrusted, malformed or relay-less credential responses', async () => {
  const variants = [null, { ...creds(), expiresAt: 0 }, { ...creds(), expiresAt: 9e12 }, { ...creds(), iceServers: [] },
    { ...creds(), iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] },
    { ...creds(), iceServers: [{ urls: ['turn:localhost:3478'], username: 'a', credential: 'b' }] },
    { ...creds(), iceServers: [{ urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: '', credential: 'b' }] }];
  for (const body of variants) await assert.rejects(createIceProvider({ now: () => 1000, fetcher: async () => response(body) })(), /Could not prepare/);
});

test('timeout aborts network work, hides server errors and clears pending retry', async () => {
  let calls = 0, aborted = false;
  const get = createIceProvider({ now: () => 1000, timeout: 5, fetcher: async (_url, options) => {
    if (++calls > 1) return response(creds());
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('sensitive upstream error')); }, { once: true }));
  } });
  await assert.rejects(get(), /Could not prepare/); assert.equal(aborted, true); await get(); assert.equal(calls, 2);
});

test('synchronously rejected fetch also clears the pending cache for retry', async () => {
  let calls = 0;
  const get = createIceProvider({ now: () => 1000, fetcher: () => { if (++calls === 1) throw new Error('private token'); return Promise.resolve(response(creds())); } });
  await assert.rejects(get(), /Could not prepare/);
  await get(); assert.equal(calls, 2);
});
