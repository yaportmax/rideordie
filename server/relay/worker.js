// Long-term TURN keys stay in Worker secrets. Browsers receive expiring ICE
// credentials only; no credentials, upstream bodies or errors are logged.
export const TURN_TTL_SECONDS = 21600;
export const UPSTREAM_TIMEOUT_MS = 8000;
const ALLOWED_ORIGINS = new Set([
  'https://ride.maxyaport.com',
  'http://localhost:4175',
  'http://localhost:5194',
]);
const MAX_REQUEST_BYTES = 1024;
const MAX_UPSTREAM_BYTES = 32768;
const CLOUD_FLARE_ICE_URL = /^(?:stun:stun\.cloudflare\.com:3478|turn:turn\.cloudflare\.com:(?:3478|443)\?transport=udp|turn:turn\.cloudflare\.com:(?:3478|80)\?transport=tcp|turns:turn\.cloudflare\.com:(?:5349|443)\?transport=tcp)$/;

function headers(origin) {
  const result = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin) result['Access-Control-Allow-Origin'] = origin;
  return result;
}

function reply(origin, status, error, extra = {}) {
  return new Response(JSON.stringify({ error }), { status, headers: { ...headers(origin), ...extra } });
}

async function readLimitedBody(body, limit, signal) {
  if (!body) return '';
  const reader = body.getReader();
  const chunks = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new Error('timeout');
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('timeout');
      if (done) break;
      length += value.byteLength;
      if (length > limit) { cancel(); throw new Error('too-large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

async function withDeadline(operation, duration, deps) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = deps.setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, duration);
  });
  try { return await Promise.race([operation(controller.signal), expired]); }
  finally { deps.clearTimeout(timer); }
}

function normalizedIceServers(value, keyId, secret) {
  if (!Array.isArray(value?.iceServers) || value.iceServers.length < 1 || value.iceServers.length > 8) throw new Error('invalid-upstream');
  let hasTurn = false;
  const result = value.iceServers.map((server) => {
    const urls = typeof server?.urls === 'string' ? [server.urls] : server?.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 12 || urls.some((url) => typeof url !== 'string' || !CLOUD_FLARE_ICE_URL.test(url))) throw new Error('invalid-upstream');
    const normalized = { urls: [...new Set(urls)] };
    if (urls.some((url) => /^turns?:/.test(url))) {
      const validCredential = (v) => typeof v === 'string' && v.length > 0 && v.length <= 2048 && !/[\r\n\x00]/.test(v) && !v.includes(secret) && !v.includes(keyId);
      if (!validCredential(server.username) || !validCredential(server.credential)) throw new Error('invalid-upstream');
      normalized.username = server.username;
      normalized.credential = server.credential;
      hasTurn = true;
    }
    return normalized;
  });
  if (!hasTurn) throw new Error('invalid-upstream');
  return result;
}

// Dependencies are injectable for deterministic tests, never supplied by HTTP.
export function createRelayWorker(overrides = {}) {
  const deps = { fetch: (...args) => globalThis.fetch(...args), now: () => Date.now(), setTimeout, clearTimeout, ...overrides };
  return {
    async fetch(request, env) {
      const incomingOrigin = request.headers.get('Origin');
      if (!ALLOWED_ORIGINS.has(incomingOrigin)) return reply(null, 403, 'origin-not-allowed');
      const origin = incomingOrigin;
      if (new URL(request.url).pathname !== '/ice') return reply(origin, 404, 'not-found');
      if (request.method === 'OPTIONS') {
        const wantedHeaders = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map((h) => h.trim()).filter(Boolean);
        if (request.headers.get('Access-Control-Request-Method') !== 'POST' || wantedHeaders.some((h) => h !== 'content-type')) return reply(origin, 403, 'preflight-not-allowed');
        return new Response(null, { status: 204, headers: {
          ...headers(origin), 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600',
        } });
      }
      if (request.method !== 'POST') return reply(origin, 405, 'method-not-allowed', { Allow: 'POST, OPTIONS' });
      const declaredLength = request.headers.get('Content-Length');
      if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_REQUEST_BYTES)) return reply(origin, 413, 'request-too-large');
      const contentType = request.headers.get('Content-Type');
      if (contentType && !/^application\/json(?:\s*;.*)?$/i.test(contentType)) return reply(origin, 415, 'content-type-not-allowed');
      const ip = request.headers.get('CF-Connecting-IP');
      if (!/^[0-9a-f:.]{3,64}$/i.test(ip || '') || !/^[0-9a-f]{32}$/i.test(env?.TURN_KEY_ID || '') || typeof env?.TURN_KEY_SECRET !== 'string' || env.TURN_KEY_SECRET.length < 32 || !env?.ICE_RATE_LIMIT?.limit) return reply(origin, 503, 'relay-unavailable');
      try {
        const result = await env.ICE_RATE_LIMIT.limit({ key: `ride-ice:${ip}` });
        if (result?.success !== true) return reply(origin, 429, 'too-many-requests', { 'Retry-After': '60' });
      } catch { return reply(origin, 503, 'relay-unavailable'); }
      try {
        const input = await withDeadline((signal) => readLimitedBody(request.body, MAX_REQUEST_BYTES, signal), 2000, deps);
        if (input.trim()) {
          const parsed = JSON.parse(input);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length) return reply(origin, 400, 'invalid-request');
        }
      } catch (error) { return reply(origin, error.message === 'too-large' ? 413 : 400, error.message === 'too-large' ? 'request-too-large' : 'invalid-request'); }
      try {
        // Compute expiry before the upstream call, so network time can never
        // extend a credential's claimed usable lifetime.
        const expiresAt = deps.now() + TURN_TTL_SECONDS * 1000;
        const iceServers = await withDeadline(async (signal) => {
          const upstream = await deps.fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
            method: 'POST', redirect: 'error', signal,
            headers: { Authorization: `Bearer ${env.TURN_KEY_SECRET}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
          });
          if (!upstream.ok) { void upstream.body?.cancel().catch(() => {}); throw new Error('upstream-unavailable'); }
          const body = await readLimitedBody(upstream.body, MAX_UPSTREAM_BYTES, signal);
          return normalizedIceServers(JSON.parse(body), env.TURN_KEY_ID, env.TURN_KEY_SECRET);
        }, UPSTREAM_TIMEOUT_MS, deps);
        return new Response(JSON.stringify({ iceServers, expiresAt }), { status: 200, headers: headers(origin) });
      } catch { return reply(origin, 503, 'relay-unavailable'); }
    },
  };
}

export default createRelayWorker();
