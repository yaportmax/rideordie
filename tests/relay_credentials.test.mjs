import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelayWorker, TURN_TTL_SECONDS, UPSTREAM_TIMEOUT_MS } from '../server/relay/worker.js';

const keyId = '0123456789abcdef0123456789abcdef';
const secret = 'master-key-must-stay-server-side-'.repeat(2);
const origin = 'https://ride.maxyaport.com';
const endpoint = 'https://ride-or-die-network.example.workers.dev/ice';
function request(options = {}) {
  const method = options.method || 'POST';
  const h = { Origin: origin, 'CF-Connecting-IP': '192.0.2.40', ...options.headers };
  for (const [name, value] of Object.entries(h)) if (value === null) delete h[name];
  return new Request(options.url || endpoint, { method, headers: h, ...(options.body === undefined ? {} : { body: options.body, duplex: 'half' }) });
}
function payload() {
  return { iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478', ignored: secret },
    { urls: [
      'turn:turn.cloudflare.com:3478?transport=udp',
      'turn:turn.cloudflare.com:443?transport=udp',
      'turn:turn.cloudflare.com:3478?transport=tcp',
      'turn:turn.cloudflare.com:80?transport=tcp',
      'turns:turn.cloudflare.com:5349?transport=tcp',
      'turns:turn.cloudflare.com:443?transport=tcp',
    ], username: 'temporary-user', credential: 'temporary-password', ignored: secret },
  ], ignored: secret, keyId };
}
function setup(overrides = {}) {
  const calls = [], limited = [];
  const env = { TURN_KEY_ID: keyId, TURN_KEY_SECRET: secret, ICE_RATE_LIMIT: { limit: async (v) => { limited.push(v); return { success: true }; } } };
  const worker = createRelayWorker({ now: () => 10000, fetch: async (...args) => { calls.push(args); return Response.json(payload(), { status: 201 }); }, ...overrides });
  return { worker, env, calls, limited };
}
function clock() {
  const active = new Set();
  const deps = {
    setTimeout: (fn, ms) => { const timer = { fn, ms }; active.add(timer); return timer; },
    clearTimeout: (timer) => active.delete(timer),
  };
  async function fire(duration) {
    for (let n = 0; n < 20; n++) await Promise.resolve();
    const timer = [...active].find((t) => t.ms === duration);
    assert.ok(timer, `missing ${duration}ms deadline`);
    timer.fn();
  }
  return { active, deps, fire };
}

test('issues only short-lived normalized ICE credentials with safe expiry and no cache', async () => {
  const { worker, env, calls, limited } = setup();
  const response = await worker.fetch(request({ body: '{}', headers: { 'Content-Type': 'application/json' } }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Vary'), 'Origin');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  const output = await response.text();
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes(keyId), false);
  assert.equal(output.includes('ignored'), false);
  const data = JSON.parse(output);
  assert.equal(data.expiresAt, 10000 + TURN_TTL_SECONDS * 1000);
  assert.equal(TURN_TTL_SECONDS, 21600);
  assert.deepEqual(data.iceServers[0], { urls: ['stun:stun.cloudflare.com:3478'] });
  assert.equal(data.iceServers[1].urls.length, 6);
  assert.equal(data.iceServers[1].credential, 'temporary-password');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`);
  assert.equal(calls[0][1].headers.Authorization, `Bearer ${secret}`);
  assert.equal(calls[0][1].redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0][1].body), { ttl: 21600 });
  assert.equal(calls[0][1].signal.aborted, false);
  assert.deepEqual(limited, [{ key: 'ride-ice:192.0.2.40' }]);
});

test('only exact public and two local origins pass CORS; preflight does not issue credentials', async () => {
  const { worker, env, calls, limited } = setup();
  for (const allowed of [origin, 'http://localhost:4175', 'http://localhost:5194']) {
    const response = await worker.fetch(request({ method: 'OPTIONS', headers: { Origin: allowed, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type' } }), env);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowed);
    assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  for (const denied of [null, 'null', 'https://ride.maxyaport.com.evil.test', 'https://ride.maxyaport.com/', 'http://ride.maxyaport.com', 'http://localhost:5173', 'http://127.0.0.1:4175']) {
    const response = await worker.fetch(request({ headers: { Origin: denied } }), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  for (const preflight of [{ 'Access-Control-Request-Method': 'GET' }, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization, Content-Type' }]) {
    assert.equal((await worker.fetch(request({ method: 'OPTIONS', headers: preflight }), env)).status, 403);
  }
  assert.equal(calls.length, 0); assert.equal(limited.length, 0);
});

test('denies unsupported paths and methods before issuing credentials', async () => {
  const { worker, env, calls } = setup();
  assert.equal((await worker.fetch(request({ url: endpoint + '/elsewhere' }), env)).status, 404);
  const get = await worker.fetch(request({ method: 'GET' }), env);
  assert.equal(get.status, 405); assert.equal(get.headers.get('Allow'), 'POST, OPTIONS');
  assert.equal((await worker.fetch(request({ method: 'PUT' }), env)).status, 405);
  assert.equal(calls.length, 0);
});

test('does not accept client TTLs, arbitrary data, malformed JSON or oversized bodies', async () => {
  const { worker, env, calls } = setup();
  for (const body of ['{"ttl":86400}', '{"iceServers":[]}', '[]', 'null', 'true', '{broken']) {
    assert.equal((await worker.fetch(request({ body, headers: { 'Content-Type': 'application/json' } }), env)).status, 400);
  }
  assert.equal((await worker.fetch(request({ body: 'x'.repeat(1025), headers: { 'Content-Type': 'application/json' } }), env)).status, 413);
  assert.equal((await worker.fetch(request({ headers: { 'Content-Length': '1025' } }), env)).status, 413);
  assert.equal((await worker.fetch(request({ headers: { 'Content-Length': 'nope' } }), env)).status, 413);
  assert.equal((await worker.fetch(request({ headers: { 'Content-Type': 'text/plain' } }), env)).status, 415);
  assert.equal(calls.length, 0);
});

test('bounds chunked request bodies and cancels their stream when too large', async () => {
  const { worker, env, calls } = setup(); let canceled = 0;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(800)); c.enqueue(new Uint8Array(800)); }, cancel() { canceled++; } });
  assert.equal((await worker.fetch(request({ body: stream }), env)).status, 413);
  assert.equal(canceled, 1); assert.equal(calls.length, 0);
});

test('missing secrets, unavailable rate binding and missing trusted IP fail closed', async () => {
  const { worker, env, calls } = setup();
  for (const broken of [
    { ...env, TURN_KEY_ID: '' }, { ...env, TURN_KEY_ID: 'not-a-key' },
    { ...env, TURN_KEY_SECRET: '' }, { ...env, ICE_RATE_LIMIT: undefined },
    { ...env, ICE_RATE_LIMIT: { limit: async () => { throw new Error(secret); } } },
  ]) {
    const response = await worker.fetch(request(), broken);
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes(secret), false);
  }
  assert.equal((await worker.fetch(request({ headers: { 'CF-Connecting-IP': null, 'X-Forwarded-For': '192.0.2.40' } }), env)).status, 503);
  assert.equal(calls.length, 0);
});

test('native limiter rejects exhausted issuances before contacting upstream', async () => {
  const { worker, env, calls } = setup(); let tokens = 2;
  env.ICE_RATE_LIMIT = { limit: async () => ({ success: tokens-- > 0 }) };
  assert.equal((await worker.fetch(request(), env)).status, 200);
  assert.equal((await worker.fetch(request(), env)).status, 200);
  const denied = await worker.fetch(request(), env);
  assert.equal(denied.status, 429); assert.equal(denied.headers.get('Retry-After'), '60');
  assert.equal(calls.length, 2);
});

test('upstream failures expose no master key, body or exception detail', async () => {
  for (const fetch of [
    async () => new Response(`secret=${secret}`, { status: 403 }),
    async () => { throw new Error(`Authorization: Bearer ${secret}`); },
    async () => new Response(`secret=${secret}`, { status: 201 }),
    async () => new Response('x'.repeat(32769), { status: 201 }),
  ]) {
    const { worker, env } = setup({ fetch });
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'relay-unavailable' });
  }
});

test('rejects unrelated destinations, missing TURN credentials and master-key reflection', async () => {
  const badPayloads = [
    {}, { iceServers: [] }, { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] },
    { iceServers: [{ urls: 'turn:evil.example:3478', username: 'user', credential: 'pass' }] },
    { iceServers: [{ urls: 'turn:turn.cloudflare.com.evil.example:3478?transport=udp', username: 'user', credential: 'pass' }] },
    { iceServers: [{ urls: 'turns:turn.cloudflare.com:443?transport=tcp' }] },
    { iceServers: [{ urls: 'turns:turn.cloudflare.com:443?transport=tcp', username: secret, credential: 'pass' }] },
    { iceServers: [{ urls: 'turns:turn.cloudflare.com:443?transport=tcp', username: 'user', credential: secret }] },
    { iceServers: [{ urls: 'turns:turn.cloudflare.com:443?transport=tcp', username: 'user\n', credential: 'pass' }] },
    { iceServers: [{ urls: 'turns:turn.cloudflare.com:443?transport=tcp', username: 'user', credential: 'x'.repeat(2049) }] },
  ];
  for (const bad of badPayloads) {
    const { worker, env } = setup({ fetch: async () => Response.json(bad, { status: 201 }) });
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'relay-unavailable' });
  }
});

test('eight-second upstream deadline aborts fetch and clears both timers', async () => {
  const controlled = clock(); let signal;
  const { worker, env } = setup({ ...controlled.deps, fetch: async (_url, options) => { signal = options.signal; return await new Promise(() => {}); } });
  const pending = worker.fetch(request(), env);
  await controlled.fire(UPSTREAM_TIMEOUT_MS);
  const response = await pending;
  assert.equal(response.status, 503); assert.equal(signal.aborted, true);
  assert.equal(UPSTREAM_TIMEOUT_MS, 8000); assert.equal(controlled.active.size, 0);
});

test('upstream response-body stall shares the upstream deadline and releases the reader', async () => {
  const controlled = clock(); let canceled = 0;
  const stream = new ReadableStream({ cancel() { canceled++; } });
  const { worker, env } = setup({ ...controlled.deps, fetch: async () => new Response(stream, { status: 201 }) });
  const pending = worker.fetch(request(), env);
  await controlled.fire(UPSTREAM_TIMEOUT_MS);
  assert.equal((await pending).status, 503);
  for (let n = 0; n < 5; n++) await Promise.resolve();
  assert.equal(canceled, 1); assert.equal(stream.locked, false); assert.equal(controlled.active.size, 0);
});

test('stalled request body has bounded lifetime, canceled reader and no upstream request', async () => {
  const controlled = clock(); let canceled = 0;
  const stream = new ReadableStream({ cancel() { canceled++; } });
  const { worker, env, calls } = setup(controlled.deps);
  const pending = worker.fetch(request({ body: stream }), env);
  await controlled.fire(2000);
  assert.equal((await pending).status, 400);
  for (let n = 0; n < 5; n++) await Promise.resolve();
  assert.equal(canceled, 1); assert.equal(stream.locked, false); assert.equal(calls.length, 0); assert.equal(controlled.active.size, 0);
});

test('success also clears deadlines and expires conservatively before upstream latency', async () => {
  const controlled = clock(); let current = 10000;
  const { worker, env } = setup({ ...controlled.deps, now: () => current, fetch: async () => { current += 5000; return Response.json(payload(), { status: 201 }); } });
  const data = await (await worker.fetch(request(), env)).json();
  assert.equal(data.expiresAt, 10000 + 21600 * 1000);
  assert.equal(controlled.active.size, 0);
});
