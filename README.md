# RIDE OR DIE

Two-player online co-op road combat. One of you **drives** a battered pickup, the other stands in the **truck bed with the guns**.
Survive the raider convoys along a 37.3 mi (60 km) highway (desert → red canyon → coastal cliffs → mountains → ruined city → the dam),
wreck the five warlord minibosses, and bring down **the Leviathan** — a 36 m war-train — to win.
When you die you go back to the garage, spend your cash on trucks, weapons, armor and upgrades, and ride again.

## Play
- Play the public build at **https://ride.maxyaport.com**. Both players open that address, then use HOST GAME / JOIN GAME and the room code below.
- Both players should reload after an update before joining. Multiplayer checks protocol compatibility and asks older clients to reload.
- Double-click **`Play Ride or Die.bat`** (first launch installs + builds, then opens `http://localhost:4173`).
- Co-op: one player clicks **HOST GAME** and shares the 5-letter room code; the other clicks **JOIN GAME** and types it.
  Your friend opens the address the launcher prints (your Tailscale IP, e.g. `http://100.x.x.x:4173`) — or any public host of the `dist/` folder.
  Connections are peer-to-peer (WebRTC); the free PeerJS service only introduces the two browsers.
- Direct co-op is verified on the public build with both host seats and repeated runs. Restrictive-network relay is awaiting service activation, and joining from a different household remains unverified.
- In the lobby pick seats (DRIVER / GUNNER), both press READY, the host starts. The host's save file is the shared campaign. Each player keeps their own cash, pays for their own purchases, and earns the team run reward independently. Truck upgrades and equipment remain shared, and changing seats does not move your cash.
- **SOLO** lets one person drive (WASD) and shoot (mouse) at the same time — good for practice.
- Distance and speed default to miles and mph; switch to kilometers in Settings.
- Chrome or Edge recommended. On a laptop with two GPUs set Windows *Settings → Display → Graphics → your browser → High performance*.

## Controls
| | Keyboard / mouse | Gamepad |
|---|---|---|
| **Driver** | W/S gas & brake/reverse · A/D steer · Space drift (handbrake) · Shift nitro · Q oil slick · E mines · X medkit · hold R flip truck · C camera · hold B look behind | RT gas · LT brake · left stick steer · A drift · RB nitro · X oil · B mines · d-pad ↓ medkit · hold Y flip · R3 camera · hold LB look behind · right stick look |
| **Gunner** | Mouse aim · LMB fire · RMB aim down sights / scope · R reload · G grenade · 1-3 / wheel weapons · X medkit | Right stick aim · RT fire · LT sights · X reload · RB/LB grenade · Y next weapon · d-pad weapons · R3 medkit |
| **Solo** | WASD drive · Space drift · Shift nitro · T flip · mouse aim/fire · R reload · G grenade | |
Esc / Start opens the pause menu (settings, controls, quit to garage).

## Tips
- Shoot the **driver** and the car swerves out of control — often into its friends. Chain crashes and explosions pay extra.
- Fuel tanks (rear) and engines (front) blow cars up; tyres make them spin out. Headshots hurt.
- Crashing hurts: a head-on hit can take a third of your truck. Ramps launch you but never damage you.
- The run is distance-based: a faster truck reaches the dam sooner (~20 min with the best truck, ~40 with the worst).

## Development
`npm install` · `npm run dev` (http://localhost:5173) · `npm run build` · `npm run lint`.
Dev URL flags: `?solo&s=<metres>&maxed=1&weapons=rifle,lmg` jumps straight into a run. Docs: `docs/DESIGN.md`, `docs/API.md`, `docs/ASSET_SPEC.md`.
Headless tests: `node tools/test/vehicle_sim.mjs truck_t1`, `sim_run.mjs`, `boss_test.mjs`, `campaign_sim.mjs`, `flow_net.mjs` (two browsers, needs the dev server).
Asset pipelines (Blender 4.5 headless): `tools/blender/*`, `tools/characters/`, `tools/env/`, `tools/audio/`. Credits for CC0 sources: `CREDITS.md`.
