# Ride or Die relay credentials

The Worker issues six-hour Cloudflare TURN credentials for the game. The long-term TURN key ID and secret remain in Worker secrets. Responses are never cached or logged by this source. There are no client-supplied credentials, TTLs or destinations.

`POST /ice` accepts an empty body or `{}` and returns `{ iceServers, expiresAt }`, with `expiresAt` as Unix milliseconds. CORS permits exactly `https://ride.maxyaport.com`, `http://localhost:4175` and `http://localhost:5194`. Unsupported origins, routes, methods and bodies are rejected before contacting TURN. Missing configuration, upstream failures and the eight-second upstream deadline return a generic 503.

Default game builds use healthy Cloudflare/Google STUN for direct connections. Build with `VITE_TURN_ENABLED=1` only after provisioning this service and testing it. That build waits for valid relay credentials before creating or joining a room; failure presents a retry message. The subscription activation, master-key provisioning and native UDP/TLS 443 relay checks are pending. Do not claim relay coverage for the default build.

Deployment uses the existing Cloudflare account and does not switch the account to a paid Workers plan:

1. Create a dedicated TURN key in the account, using a token with Calls Write permission or the dashboard.
2. From the repository, supply `TURN_KEY_ID` and `TURN_KEY_SECRET` through `wrangler secret put --config server/relay/wrangler.jsonc`. Use stdin or the hidden prompt, never command arguments, source files or logs. Each secret is a separate command.
3. Deploy with `npx --yes wrangler deploy --config server/relay/wrangler.jsonc`. Record the returned workers.dev URL and set the game's credential endpoint to that URL plus `/ice`.
4. Verify the permitted-origin preflight, POST credentials and denied-origin behavior without printing temporary credentials. Test actual selected relay candidates with UDP and TLS port 443 before claiming restrictive-network coverage.

`ICE_RATE_LIMIT` allows ten credential requests per IP per minute, namespace `417520260930`, using the key prefix `ride-ice:`. This is an anonymous game's abuse guard, so multiple players behind one public IP share that allowance. Cloudflare's native limiter is approximate and scoped to each Cloudflare location, not a global billing quota. Keep this namespace separate from unrelated Workers. Wrangler 4.36.0 or newer supports this binding; the current operator CLI is newer. Missing or failed limit bindings fail closed.

CPU checks: `node --test tests/relay_credentials.test.mjs`. Deployment and genuine WebRTC testing are separate checks.

Primary references: [credential generation](https://developers.cloudflare.com/realtime/turn/generate-credentials/), [rate limit binding and locality](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
