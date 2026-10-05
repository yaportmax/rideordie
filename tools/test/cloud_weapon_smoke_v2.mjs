// AUTHORED UNRUN V2. Root executes from the revised candidate only against
// the unchanged bound Worker4. Prior V1 helper/report remain separate evidence.
// One disposable capability lives only in memory.
// No stdin, credentials, account/config changes or existing vaults are used.
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_PROFILE } from '../../src/data/upgrades.js';
import { normalizeProfile, buyWeapon, buyTruck, buyUpgrade, buyWeaponAttachment, equipWeaponAttachment, buyWeaponOptic } from '../../src/meta/profile.js';
import { creditCampaignLevel } from '../../src/data/campaign.js';
import { SaveStore } from '../../src/meta/save_store.js';
import { CloudSaves } from '../../src/meta/cloud_saves.js';
import { sanitizeProfile, canonicalJson } from '../../server/saves/schema.js';
import { SUPPORTED_PROFILE_VERSION } from '../../server/saves/profile_support.js';

const ENDPOINT = 'https://ride-or-die-saves.yaportmax.workers.dev';
const ORIGIN = 'https://ride.maxyaport.com';
const BOUND = Object.freeze({
  'server/saves/worker.js': '0BA1F6EED32CB5CEB6F38F2D0046EC90C0064BEB39BF394542B4C3DA9A302CAB',
  'server/saves/schema.js': '7F64D8B771F23D3AB1D847EF22BCAADF00BC31ADE2124ADBF89E3DAC22D7E6AE',
  'server/saves/profile_support.js': '39BD7441849CA9034FBC2B45504B4A149BAEA71FD80CECCEEF33150C492DE7A1',
  'server/saves/weapon_attachment_support.js': '5B2229B40640AD4B10BA0839CAC6013544DD27C833300BA0D7001C06FFED5499',
  'server/saves/weapon_optic_support.js': '8CD6797DD42D479777EE917372BF9EE2E88914076208F35DC0C70E6081F23275',
  'server/saves/wrangler.jsonc': '796FC6D4996C7EAB293B29B1DED25C33AD2F3EB37F58ED477005FE75AFBAACEC',
  'src/meta/profile.js': '90C0B27E02C9D22EA88AEA61FEFDBF48E18B05C0D6BD1AA95F414188B1F038CE',
  'src/meta/weapon_tuning.js': '943C6E42A62F6CB357B6B9C3612C5255505AA7A26CE98E378CC22BED3CCDA52F',
  'src/meta/save_store.js': '374A1753BB7F324202AF76405F0EECB8DE6B62BD58D419821739FD2F89035196',
  'src/meta/cloud_saves.js': '82751868E509BB908483162111D74EEA757D3E8BC5EC960F5A7F681B79FEB481',
});
const ERROR_CODES = new Set(['configuration', 'source_binding', 'profile_contract', 'fresh_vault', 'network', 'response', 'headers',
  'cloud_client', 'receipt', 'history', 'old_capability', 'legacy_tank', 'request_bound', 'cleanup_scope', 'cleanup', 'report_write', 'report_redaction']);
const fail = code => { throw new Error(ERROR_CODES.has(code) ? code : 'response'); };
const need = (condition, code) => { if (!condition) fail(code); };
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const hash = slot => createHash('sha256').update(canonicalJson({ name: slot.name, profile: slot.profile, deleted: slot.deleted })).digest('hex');
class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

async function main() {
  const output = process.env.ROD_WEAPON_CLOUD_OUTPUT;
  if (!output || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    console.log(JSON.stringify({ passed: false, error: 'configuration' })); process.exitCode = 1; return;
  }
  try { await stat(output); console.log(JSON.stringify({ passed: false, error: 'configuration' })); process.exitCode = 1; return; }
  catch (error) { if (error.code !== 'ENOENT') { console.log(JSON.stringify({ passed: false, error: 'configuration' })); process.exitCode = 1; return; } }
  const startedAt = new Date().toISOString(), requests = [], checks = [], sourceHashes = {};
  const ownedIds = new Set(), bodies = new Map(), observed = new Map();
  const cleanup = { attempted: false, passed: true, liveRemaining: 0 };
  let secret = null, ownedVault = false, stage = 'configuration', failure = null, cloud = null;
  async function check(name, fn) {
    stage = name; const before = requests.length;
    try { await fn(); checks.push({ name, passed: true, requests: requests.length - before }); }
    catch (error) { checks.push({ name, passed: false, requests: requests.length - before }); throw error; }
    finally { cloud?._clearTimer(); }
  }
  async function transport(url, options = {}) {
    const parsed = new URL(url), method = options.method || 'GET';
    need(parsed.origin === ENDPOINT && !parsed.search && !parsed.hash && !parsed.username && !parsed.password, 'configuration');
    need(parsed.pathname === '/v1/vault' || /^\/v1\/slots\/[0-9a-f-]{36}(?:\/history|\/restore)?$/i.test(parsed.pathname), 'configuration');
    // Reserve four requests for owned-head cleanup; normal acceptance uses20.
    need(requests.length < (stage === 'cleanup' ? 25 : 20), 'request_bound');
    const headers = new Headers(options.headers), bearer = headers.get('Authorization');
    need(typeof bearer === 'string' && /^Bearer ROD1-[A-Za-z0-9_-]{43}$/.test(bearer), 'configuration');
    if (secret === null) secret = bearer.slice(7);
    need(bearer === `Bearer ${secret}`, 'configuration');
    headers.set('Origin', ORIGIN);
    const capability = Number(headers.get('X-ROD-Profile-Version'));
    need(capability === 3 || capability === 4, 'configuration');
    if (options.body && ['PUT', 'POST'].includes(method) && parsed.pathname !== '/v1/vault') {
      try { bodies.set(`${method} ${parsed.pathname}`, JSON.parse(options.body)); } catch { fail('response'); }
    }
    const receipt = { stage, method, capability, status: null }; requests.push(receipt);
    let response;
    try { response = await fetch(url, { ...options, headers, redirect: 'error', cache: 'no-store', signal: options.signal || AbortSignal.timeout(15000) }); }
    catch { fail('network'); }
    receipt.status = response.status;
    need(response.headers.get('Cache-Control') === 'no-store' && response.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'headers');
    need((response.headers.get('Vary') || '').toLowerCase().split(',').map(value => value.trim()).includes('origin'), 'headers');
    let data; try { data = await response.clone().json(); } catch { fail('response'); }
    if (method === 'POST' && parsed.pathname === '/v1/vault' && response.ok) {
      need(data?.version === 1 && Array.isArray(data.slots) && data.slots.length === 0, 'fresh_vault'); ownedVault = true;
    }
    if (response.ok && data?.slot && ownedIds.has(data.slot.id)) {
      const slot = data.slot;
      need(slot.hash === hash(slot) && Number.isSafeInteger(slot.version) && slot.version > 0, 'response');
      const etag = response.headers.get('ETag'); need(etag === `"${slot.version}"` || etag === `W/"${slot.version}"`, 'headers');
      observed.set(slot.id, structuredClone(slot));
    }
    return response;
  }
  async function request(method, path, body, capability = 4) {
    need(secret !== null, 'configuration');
    const response = await transport(ENDPOINT + path, { method,
      headers: { Authorization: `Bearer ${secret}`, 'X-ROD-Profile-Version': String(capability), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    let data; try { data = await response.json(); } catch { fail('response'); }
    return { status: response.status, data };
  }
  async function vault() {
    const result = await request('GET', '/v1/vault');
    need(result.status === 200 && result.data?.version === 1 && Array.isArray(result.data.slots), 'response');
    return result.data.slots;
  }
  const parts = profile => {
    need(profile?.v === 4, 'profile_contract');
    need(same(profile.weaponAttachments?.rifle?.owned, ['extended_mag', 'laser', 'foregrip', 'stock']), 'profile_contract');
    need(same(profile.weaponAttachments?.pistol, { owned: ['laser'], equipped: ['laser'] }), 'profile_contract');
    need(profile.weaponOptics?.rifle?.equipped === 'combat_3x' && profile.weaponOptics?.sniper?.equipped === 'combat_3x', 'profile_contract');
    need(profile.weapons?.rifle?.dmg === 0 && profile.weapons?.rifle?.mag === 0 && profile.weapons?.sniper?.rel === 0, 'profile_contract');
  };
  try {
    await check('bound_source', async () => {
      need(SUPPORTED_PROFILE_VERSION === 4, 'source_binding');
      for (const [path, expected] of Object.entries(BOUND)) {
        const actual = createHash('sha256').update(await readFile(new URL('../../' + path, import.meta.url))).digest('hex').toUpperCase();
        sourceHashes[path] = actual; need(actual === expected, 'source_binding');
      }
    });
    const storage = new MemoryStorage(), store = new SaveStore({ storage, normalize: normalizeProfile, fresh: () => normalizeProfile(DEFAULT_PROFILE()), id: randomUUID });
    const id = store.activeId(); ownedIds.add(id);
    const profile = store.load(); profile.cash = 200000;
    for (let level = 1; level < 5; level++) need(creditCampaignLevel(profile,
      { runId: `disposable-clear-${level}`, level, mode: 'campaign', won: true }), 'profile_contract');
    need(buyWeapon(profile, 'rifle').ok && buyWeapon(profile, 'sniper').ok, 'profile_contract');
    for (const part of ['extended_mag', 'laser', 'foregrip', 'stock']) need(buyWeaponAttachment(profile, 'rifle', part).ok, 'profile_contract');
    need(buyWeaponAttachment(profile, 'pistol', 'laser').ok, 'profile_contract');
    need(buyWeaponOptic(profile, 'rifle', 'combat_3x').ok && buyWeaponOptic(profile, 'sniper', 'combat_3x').ok, 'profile_contract');
    profile.revision++; need(store.save(profile).ok, 'cloud_client'); const initialProfile = sanitizeProfile(profile); parts(initialProfile);
    cloud = new CloudSaves({ store, storage, fetch: transport, url: ENDPOINT, debounceMs: 5000, timeoutMs: 15000, retryBaseMs: 60000, retryMaxMs: 60000 });
    let first, advanced, backup, restored;
    await check('actual_client_paid_upload', async () => {
      need((await cloud.createVault()).status === 'connected', 'cloud_client'); need(ownedVault, 'fresh_vault');
      first = observed.get(id); parts(first?.profile); need(same(first.profile, initialProfile), 'profile_contract');
    });
    await check('exact_put_retry_and_list', async () => {
      const body = bodies.get(`PUT /v1/slots/${id}`); need(body?.mutationId, 'receipt');
      const retried = await request('PUT', `/v1/slots/${id}`, body);
      need(retried.status === 200 && same(retried.data.slot, first), 'receipt');
      need(same((await vault()).find(row => row.id === id), first), 'receipt');
    });
    await check('actual_client_change_and_history', async () => {
      const changed = store.load(); need(equipWeaponAttachment(changed, 'rifle', 'laser', false).ok, 'profile_contract');
      changed.cash -= 7; changed.revision++; need(store.save(changed).ok, 'cloud_client'); cloud._clearTimer();
      need((await cloud.sync()).status === 'connected', 'cloud_client'); advanced = observed.get(id);
      need(advanced.version > first.version && advanced.hash !== first.hash, 'history'); parts(advanced.profile);
      need(same(advanced.profile.weaponAttachments.rifle.equipped, ['extended_mag', 'foregrip', 'stock']), 'profile_contract');
      const rows = await cloud.history(id); need(rows.length === 1 && rows[0].hash === first.hash && same(rows[0].profile, first.profile), 'history'); backup = rows[0];
    });
    await check('capability_three_cannot_erase_paid_content', async () => {
      const plain = normalizeProfile(DEFAULT_PROFILE()); plain.campaignId = advanced.profile.campaignId;
      const rejected = [
        await request('PUT', `/v1/slots/${id}`, { name: advanced.name, profile: plain, baseVersion: advanced.version, mutationId: randomUUID() }, 3),
        await request('DELETE', `/v1/slots/${id}`, { baseVersion: advanced.version, mutationId: randomUUID() }, 3),
        await request('POST', `/v1/slots/${id}/restore`, { backupId: backup.id, baseVersion: advanced.version, mutationId: randomUUID() }, 3),
      ];
      need(rejected.every(result => result.status === 409 && result.data?.error === 'unsupported_profile' && result.data?.requiredVersion === 4), 'old_capability');
      need(same((await vault()).find(row => row.id === id), advanced), 'old_capability');
      const rows = await cloud.history(id); need(rows.length === 1 && same(rows[0], backup), 'old_capability');
    });
    await check('actual_client_restore_and_exact_restore_retry', async () => {
      need((await cloud.restoreCloud(id, backup.id)).status === 'connected', 'cloud_client'); restored = observed.get(id);
      need(restored.version > advanced.version && restored.hash === first.hash && same(restored.profile, first.profile), 'history');
      parts(store.load()); need(same(sanitizeProfile(store.load()), first.profile), 'profile_contract');
      const body = bodies.get(`POST /v1/slots/${id}/restore`); need(body?.mutationId, 'receipt');
      const retry = await request('POST', `/v1/slots/${id}/restore`, body);
      need(retry.status === 200 && same(retry.data.slot, restored), 'receipt');
    });
    await check('legacy_tank_three_and_actual_client_read', async () => {
      const tank = normalizeProfile(DEFAULT_PROFILE()); tank.cash = 1000000;
      need(buyTruck(tank, 'player_tank_t1').ok && buyUpgrade(tank, 'engine').ok, 'legacy_tank');
      need(tank.v === 3 && !Object.hasOwn(tank, 'weaponAttachments'), 'legacy_tank');
      const tankId = randomUUID(); ownedIds.add(tankId);
      const body = { name: 'Disposable legacy Tank3', profile: tank, baseVersion: 0, mutationId: randomUUID() };
      const written = await request('PUT', `/v1/slots/${tankId}`, body, 3);
      need(written.status === 200 && written.data?.slot?.profile?.v === 3 && same(written.data.slot.profile, sanitizeProfile(tank)), 'legacy_tank');
      const retry = await request('PUT', `/v1/slots/${tankId}`, body, 3); need(retry.status === 200 && same(retry.data.slot, written.data.slot), 'receipt');
      const before = requests.length; need((await cloud.sync()).status === 'connected', 'cloud_client');
      need(requests.length === before + 1 && requests[before].method === 'GET', 'cloud_client');
      const local = store.load(tankId); need(local.v === 3 && local.truck === 'player_tank_t1' && local.vehicleUpgrades.tank.engine === 1, 'legacy_tank');
      need(!Object.hasOwn(local, 'weaponAttachments'), 'legacy_tank');
      need((await cloud.history(tankId)).length === 0, 'receipt');
    });
  } catch (error) { failure = ERROR_CODES.has(error?.message) ? error.message : 'response'; }
  finally {
    cloud?.dispose();
    if (ownedVault) {
      cleanup.attempted = true; stage = 'cleanup';
      try {
        const rows = await vault(); need(rows.every(row => ownedIds.has(row.id)), 'cleanup_scope');
        for (const row of rows) if (!row.deleted) {
          const removed = await request('DELETE', `/v1/slots/${row.id}`, { baseVersion: row.version, mutationId: randomUUID() });
          need(removed.status === 200 && removed.data?.slot?.deleted === true, 'cleanup');
        }
        cleanup.liveRemaining = (await vault()).filter(row => !row.deleted).length; need(cleanup.liveRemaining === 0, 'cleanup');
      } catch { cleanup.passed = false; }
    }
  }
  const report = { kind: 'ride-or-die-weapon-cloud-smoke', version: 2, startedAt, finishedAt: new Date().toISOString(), endpoint: ENDPOINT,
    passed: !failure && checks.length === 7 && checks.every(row => row.passed) && cleanup.attempted && cleanup.passed && requests.length >= 12 && requests.length <= 25,
    sourceHashes, checks, requests, cleanup, ...(failure ? { error: failure } : {}),
    scope: 'Real HTTPS authorized existing Worker; actual CloudSaves/SaveStore in isolated memory with explicit manual sync and timers cleared between steps. Controlled funded career/purchases; all four rifle parts, pistol laser, rifle/sniper3x, history/restore, exact retries, cap3 mutation refusal and legacyTank3 read. Node Origin header is not browser/cross-device/background-retry proof. Only disposable live heads removed; private capabilities discarded, dummy tombstones/backups may remain.' };
  const bytes = JSON.stringify(report, null, 2) + '\n';
  if ((secret && bytes.includes(secret)) || /ROD1-[A-Za-z0-9_-]{43}/.test(bytes)) {
    console.log(JSON.stringify({ passed: false, error: 'report_redaction' })); process.exitCode = 1; return;
  }
  try { await mkdir(dirname(output), { recursive: true }); await writeFile(output, bytes, { encoding: 'utf8', flag: 'wx' }); }
  catch { console.log(JSON.stringify({ passed: false, error: 'report_write' })); process.exitCode = 1; return; }
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, requests: requests.length, cleanup: cleanup.passed, ...(failure ? { error: failure } : {}) }));
  if (!report.passed) process.exitCode = 1;
}
await main();
