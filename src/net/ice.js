// Temporary relay credentials only. The service key never enters the game build.
export const ICE_ENDPOINT = 'https://ride-or-die-network.yaportmax.workers.dev/ice';
const ERROR = 'Could not prepare the online connection. Please try creating or joining the room again.';
const SAFE_URL = /^(?:stun:stun\.cloudflare\.com:(?:3478|443)|turns?:turn\.cloudflare\.com:(?:3478|443|80|5349)(?:\?transport=(?:udp|tcp))?)$/;

export function createIceProvider({ endpoint = ICE_ENDPOINT, fetcher = (...args) => fetch(...args), now = () => Date.now(), timeout = 10000 } = {}) {
  let cached = null, pending = null;
  return function getConfig() {
    if (cached && cached.expiresAt > now() + 300000) return Promise.resolve(structuredClone(cached.config));
    if (!pending) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      pending = (async () => {
        try {
          const response = await fetcher(endpoint, { method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (!response.ok) throw new Error(ERROR);
          const body = await response.json(), servers = body?.iceServers;
          if (!Array.isArray(servers) || !servers.length || servers.length > 8 || !Number.isFinite(body.expiresAt) || body.expiresAt <= now() + 60000 || body.expiresAt > now() + 21660000) throw new Error(ERROR);
          let relay = false;
          const iceServers = servers.map(server => {
            const urls = typeof server?.urls === 'string' ? [server.urls] : server?.urls;
            if (!Array.isArray(urls) || !urls.length || urls.length > 12 || urls.some(url => typeof url !== 'string' || !SAFE_URL.test(url))) throw new Error(ERROR);
            const hasRelay = urls.some(url => /^turns?:/.test(url));
            if (hasRelay && (typeof server.username !== 'string' || !server.username || server.username.length > 2048 || /[\r\n\x00]/.test(server.username) || typeof server.credential !== 'string' || !server.credential || server.credential.length > 2048 || /[\r\n\x00]/.test(server.credential))) throw new Error(ERROR);
            relay ||= hasRelay;
            return hasRelay ? { urls: [...urls], username: server.username, credential: server.credential } : { urls: [...urls] };
          });
          if (!relay) throw new Error(ERROR);
          cached = { expiresAt: body.expiresAt, config: { iceServers } };
          return cached.config;
        } catch { throw new Error(ERROR); }
        finally { clearTimeout(timer); }
      })().finally(() => { pending = null; });
    }
    return pending.then(config => structuredClone(config));
  };
}

// Relay activation is a deployment prerequisite. Keep direct connections
// available in builds released before that service has been provisioned.
export const getIceConfig = import.meta.env?.VITE_TURN_ENABLED === '1'
  ? createIceProvider()
  : async () => ({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }] });
