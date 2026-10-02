# Ride or Die private cloud saves

Dedicated `ride-or-die-saves` Worker on account `6ba6abe9133ad77796b3809ab899ee9c`. It uses the existing Wrangler OAuth session. Deployment creates the SQLite Durable Object namespace through the `v1` migration; no D1 database, API token, secret, TURN or DNS change is needed. Preview URLs and Worker observability are disabled. Never enable request/header/body logging for this service.

## Private vaults and API

The browser creates 32 cryptographically random bytes and formats their unpadded base64url encoding as `ROD1-<43 characters>`. All vault routes require that recovery capability in the `Authorization: Bearer ...` header, plus a recognized `Origin`. SHA256 of a service-scoped recovery code identifies a separate Durable Object. The raw bearer is never forwarded to the object, included in URLs or stored in SQL. Knowing a campaign or slot ID grants no access. There is no account recovery if the code is lost; anyone possessing it can access its vault. CORS is browser protection, not authentication, and direct callers can supply an Origin themselves.

Allowed origins are exactly `https://ride.maxyaport.com` and HTTP `localhost`/`127.0.0.1` origins, including optional ports. Private responses and errors have `Cache-Control: no-store`. Recognized preflights allow Authorization, Content-Type and If-Match. Public `GET /health` accepts no Origin and returns only `{service,version}`.

Endpoints follow `work/cloud-saves-contract.md`: create/list vault, PUT/DELETE slot, GET history and POST restore. Public `createdAt`, `updatedAt` and history `at` are numeric Unix milliseconds. Server `version` is an opaque safe integer allocated from a monotonically increasing per-vault sequence, independent of `profile.revision`; different slot changes can make an individual slot's versions skip. Every mutation requires an exact `baseVersion` (0 creates only an absent ID). Missing acknowledged heads also conflict. An optional If-Match must agree with the body version.

PUT, DELETE and restore accept optional `mutationId` UUIDs. Clients should persist and reuse an ID with the exact operation, base and wire content on an unknown-outcome retry. Only the receipt on the current head can prove an idempotent retry; reused IDs with changed content/base and superseded retries return 409 with the current head. Receipts remain private. A successful restore can be retried even if its source backup aged out, because the current receipt is checked first.

Each vault holds at most 12 live heads and 12 recoverable deleted heads. Deleting a slot frees a live slot. The thirteenth deleted head atomically removes only the oldest tombstone and its backups. Retained heads keep their ten newest previous snapshots. Undeleting into a full live vault fails. The vault-wide version sequence prevents stale-version overwrite after a pruned UUID is explicitly recreated. Tombstone pruning is intentional expiration; clients must preserve unsent local progress and report missing acknowledged remote slots as conflicts instead of silently recreating them.

The portable `schema.js` is shared with the browser. It projects a fixed progression whitelist, bounds known catalogs/tracks/arrays/strings and rejects invalid finite values or unsupported schema versions. Unknown metadata is dropped, and strings resembling recovery codes are rejected in save names, campaign IDs and run IDs to prevent accidental plaintext credential persistence. Device settings and legacy `seen` become empty objects. Legacy driver purchases migrate into the pickup inventory. Supported cash and marathon records retain safe-number range without arbitrary game-distance/economy caps. SHA256 content hashes use sorted-key canonical JSON of `{name,profile,deleted}`. Writes, prior-head backup, history pruning, version allocation and tombstone pruning commit together with `storage.transactionSync`; hashing happens before the final CAS transaction, which reads and verifies the current head again.

## Input limits

Requests are streamed and rejected above 65,536 bytes regardless of Content-Length. The early `SAVE_IP_LIMIT` binding permits 120 calls per 60 seconds for a trusted Cloudflare connecting IP, guarding malformed auth and random-vault creation. `SAVE_VAULT_LIMIT` permits 60 calls per 60 seconds keyed only by hashed vault identity. Both bindings must be present and healthy or private requests fail closed. IP is a coarse abuse limit and shared networks share that budget; normal save traffic is debounced and well below it.

Cloudflare's [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) is local to a Cloudflare location, permissive and eventually consistent. It cannot alone prove a global exact limit. The DO additionally keeps a transactional 60-request fixed-minute budget per existing/created vault in its SQLite metadata. Reconstructing an object retains the budget. A fixed window can admit traffic on both sides of a minute boundary. Missing-vault reads do not create usable vaults. These are application limits, not a claim of global resource quotas across arbitrarily generated capabilities.

The implementation follows Cloudflare's [SQLite storage transaction API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) and [Durable Object concurrency guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/). [Wrangler migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) use `new_sqlite_classes` for the initial namespace.

## Root-owned execution and deployment

Run from `C:\Dev\worktrees\rideordie-fast-opt`. These are commands for the root execution lease; the server implementation agent has not run any test, build, development server, provisioning or deploy command.

```powershell
node --test --test-isolation=none tests/cloud_save_server.test.mjs
wrangler.cmd whoami
wrangler.cmd deploy --dry-run --config server/saves/wrangler.jsonc --outdir work/cloud-saves-worker-dry-run
wrangler.cmd deploy --config server/saves/wrangler.jsonc
wrangler.cmd deployments list --config server/saves/wrangler.jsonc
Invoke-RestMethod -Uri 'https://ride-or-die-saves.yaportmax.workers.dev/health'
```

Do not put recovery codes in command-line arguments, environment diagnostics, shell history, URLs or saved HTTP traces. Perform private deployment verification through the game or a root-owned script that generates an ephemeral capability in memory and reports only sanitized status/results. Do not enable observability/tailing to inspect requests. Plan eligibility, namespace provisioning, live CORS, persistence across Cloudflare runtime restarts and real browser sync require root verification; source tests are not a live durability claim. If deployment introduces a billing/terms gate, stop before accepting it.

## Test scope

`tests/cloud_save_server.test.mjs` loads the actual Worker source with a temporary platform-base constructor shim, then executes its SQL against Node `node:sqlite` `DatabaseSync`. The fixture adapts only the synchronous SQL cursor and transaction interface. It does not reimplement the service or CAS policy. Tests cover auth isolation, CORS, real parallel requests, strict CAS/retry behavior, backups/restore, real SQLite rollback on an injected head-write failure, reconstructed objects, bounded live/deleted/history storage, pruned-ID ABA, wire progression preservation, forged metadata, schema negatives, streamed byte bounds and binding/global-vault rate enforcement. They require Node 24 with `registerHooks` and `node:sqlite` (root verified Node 24.18.0). They do not simulate Cloudflare output gates, cross-region networking or production binding accuracy.
