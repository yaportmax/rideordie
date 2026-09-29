# API contract for the code modules (read DESIGN.md first)

Stack: Three.js r186 (WebGL2), Rapier, Vite, plain ES modules (no TypeScript). Target: 60 fps at 1080p on an RTX 2000 Ada laptop GPU
(≈ RTX 3050), ≤ ~1500 draw calls, ≤ ~2.5M visible triangles, ≤ 4000 live particles. Everything must degrade via `quality` (0 low … 3 ultra).
Run `npm run lint` (eslint no-undef etc.) before you finish. Dev server is already running on http://localhost:5173 (do NOT start another).
Screenshot/probe: `node tools/test/shot.mjs "<page?query>" shots/<you>/x.png --wait=3000 --eval="<js>"` then LOOK at the PNG (Read tool).
Do NOT edit files you don't own (listed per module). Do not git commit. Do not touch `src/main.js` (the integrator wires your module in from your report).

## Conventions
Meters, +Y up, vehicles/characters face +Z, `+X = LEFT` of a thing facing +Z. Steering +1 = left. Quaternions are THREE.Quaternion.
Road coordinates: `s` = distance along the road (m), `d` = lateral offset (left +). `road.sample(s)`, `road.pointAt(s,d)`, `road.nearest(x,z,hintS)`.

## Sim events (sim → view/audio/fx). Plain objects with `t`; positions are `[x,y,z]` arrays. Both peers receive the same events.
| t | fields | meaning |
|---|---|---|
| `spawn` / `remove` | id, spec, kind / id, why | car added/removed |
| `enemySpawn` | id, spec, label, behavior | |
| `shot` | src ('player' or car id), weapon (weapon id or 'enemy'), origin, rays:[{end, surface, normal, carId, zone, dmg}] (player hitscan) OR dir + speed (enemy bullets: rays=[dir...]), rocket, mode, role, pellets | muzzle flash + tracer + gunshot sound. Player rays are instantaneous hits; enemy `rays` are directions of visible fast bullets (speed m/s) |
| `hit` | pos, normal, surface ('metal','flesh','dirt','glass','tire','rock','sand',…), carId, zone, dmg, enemy | bullet impact (impact fx + sound) |
| `whizz` | pos, dist | near-miss bullet flyby |
| `crash` | id, other (-1=world), dv, speed, pos | car collision (sparks, crunch, camera shake) |
| `explode` | id, pos, size(1 normal, 1.8 heavy, 2.4 tanker), cause, spec, vel | car explosion fireball, debris, wreck |
| `boom` | pos, radius, kind ('rocket','grenade') | non-car explosion |
| `crewHit` / `crewDead` | id, role ('driver','gunner','gunner2'), hp, head, cause | crew damage/death (ragdoll, blood-less "hit puff") |
| `tirePop` `engineDead` `fuelLeak` `smoke` `fire` | id (,index) | car damage states |
| `kill` | id, spec, cause, pos, crash | player got a car kill (score popup) |
| `playerDown` / `runOver` | why | end of run |
| `nitro`, `drift`, `land` | id … | (emitted by the view layer itself from CarState) |
Gunner-side local events (same format): `weaponSwap`, `reloadStart {weapon,time}`, `reloadEnd`, `shellIn`, `dryClick`, `grenadeThrow {origin,vel}`.

## CarState (`src/view/car_state.js`) — what the view layer sees for every car (identical on both peers)
`{id, specId, spec, kind, pos, quat, vel, steer, L[], slip[], grounded[], flat[], hp01, driverAlive, gunnerAlive, exploded, dead, burning, smoking, braking, boosting, drifting, rpm01, speed, airborne, gunner:{yaw,pitch,fire,crouch,ads,weapon,reloading}}`.
`CarView` (`src/view/car_view.js`, exists) renders one car: `.root`, `.wheelNodes` (Map name→Object3D), `.sockets` (Map-like object name→Object3D: exhaust_L, smoke_engine, nitro_L, light_head_L …), `.panels`.

## Module: Fx  → `src/view/fx.js` (+ `src/view/fx/*.js`), test page `fx.html` + `src/dev_fx.js`
```js
export class Fx {
  constructor(scene, camera, opts = { quality: 2 })
  async load()                                  // loads /textures/particles/* sprite sheets (see public/textures/README.md)
  handleEvent(evt, ctx)                         // ctx = { carViews: Map(id → CarView), states: Map(id → CarState), playerId, cameraPos }
  updateCar(state, carView, dt, surface)        // per-frame per-car effects: tyre smoke / dust / gravel spray by wheel slip+surface, SKID MARKS (ribbon decals on the road, ring-buffered),
                                                // exhaust puffs, nitro flames (state.boosting), damage smoke/fire (state.smoking/burning), sparks when scraping, headlight cones optional
  update(dt)                                    // advance all particle systems
  wreck(state, carView)                         // called once on 'explode': char the car (multiply paint dark, emissive embers), attach a burning smoke column that lasts ~14 s
  dispose()
}
```
Required look (AAA): GPU-instanced billboard particles (single InstancedMesh per blend mode, custom shader, soft particles using depth if cheap), additive fire/flash, alpha smoke with
lighting-ish shading (tinted by sun), explosion = fireball sprites + shockwave ring + sparks/embers with streaks + debris chunks (small instanced meshes tumbling with fake physics) + brief point-light flash
(pool of 2 lights) + scorch decal + screen-shake request (`ctx.shake(amount)`), muzzle flash per weapon (star sprite + cone + light-less glow; 1-3 frames), tracers (thin additive quads streaking along the shot at ~700 m/s
for the player's, colour by weapon; slower visible bullets for enemies), impact effects per surface (metal sparks+flash, dirt puff, glass shards, flesh puff (no gore), tire pop hiss puff),
shell casings (small instanced brass with bounce), skid marks that fade, dust trails behind fast cars off-road, rocket smoke trail, grenade bounce sparks.
Perf: pool everything, no per-frame allocations, cap live particles by quality.

## Module: Audio  → `src/core/audio.js`, `src/view/audio_bridge.js`, test page `audio.html`
```js
export class AudioSys {
  constructor(camera)  async init(manifestUrl='/audio/manifest.json')   // resume on first user gesture
  play(name, { pos, gain=1, pitch=1, pitchVar=0.05, loop=false, bus='sfx' }) -> handle   // random variation pick (name + variation index), 3D panner (HRTF off; equal-power + distance rolloff + air absorption lowpass) when pos given
  engine(carId, spec) -> EngineSound        // update(rpm01, load(0..1), boost, distanceToListener, speed) : crossfaded RPM-stage loops from public/audio/vehicles/engine_*, pitch shifted, with turbo/blowoff/backfire; doppler from relative velocity
  music: setState('garage'|'run'|'boss'|'victory'|'title'), setIntensity(0..1) → layer stems (run_X_base/drums/lead/extra) crossfaded in bar-sync
  ambience.setBiome(id)  wind(speed01) tyre/road roar(speed, surface)   listener.update(camera, vel)
  bus volumes: master, sfx, music, ambience, ui; duck music on explosions; low-pass when a hit is heavy (concussion effect)
}
export class AudioBridge { constructor(audio) handleEvent(evt, ctx) updateCar(state, engineHandle...) }   // maps EVENTS → sounds (see table above)
```
Sounds live in `public/audio/<group>/<name>.ogg` with `public/audio/manifest.json` (written by the audio builder; may still be growing — read it, don't hardcode names; degrade gracefully when a name is missing).

## Module: Post → `src/view/post.js`, test `post.html`
```js
export class Post { constructor(renderer, scene, camera, opts) setSize(w,h) render(dt) setQuality(0..3) setParams({speed01, boost, damage01, night01, dof}) }
```
Pipeline: HDR render target → SSAO/GTAO (n8ao installed) → bloom (emissive/tracers/fire) → tone map ACES + grading (warm highlights, teal-ish shadows, slight contrast, saturation ~1.1) → SMAA (or TAA if stable) →
camera motion blur (depth reprojection or velocity) scaled by speed → chromatic aberration + vignette + film grain scaled by speed/damage → optional radial speed lines at boost. Package `postprocessing` (pmndrs) is installed; write custom Effects where needed.
Resolution scale option. Must keep 60 fps at 1080p on the target GPU at quality 2. Sun shadows are handled by `SkyRig` (do not touch `src/world/*`).

## Module: UI → `src/ui/*.js` (+ `src/ui/ui.css`), test page `ui.html`
Menus are DOM overlays. Title (Host / Join code / Solo / Settings / Quit), Lobby (room code big + copy, role picker Driver/Gunner with the other player's status, ready, start), Garage/shop (3D garage view supplied by the integrator via `garageView` callbacks;
you build the DOM: tabs TRUCK | ENGINE… | WEAPONS | GUNNER | COLORS, cost/level pips, buy buttons, stat bars, "READY" button, cash display, controller-navigable: d-pad/left stick moves focus, A confirm, B back — full gamepad + keyboard + mouse),
Results screen (distance, time, kills, style bonuses, cash earned → animated count-up), Pause menu + Settings (graphics quality, resolution scale, fov, mouse sens, gamepad sens, invert Y, volumes, key rebinding list, show controls), HUD is separate (`src/ui/hud.js` exists, extend only via your own wrapper).
Data model: `src/data/upgrades.js` (TRUCKS, UPGRADES, WEAPON_TRACKS, effects()) and `src/meta/profile.js` (buyTruck, buyUpgrade, buyWeapon, buyWeaponTrack, equipWeapon…) exist — use them; the shop must show stat previews computed from `effects()`.
Style: gritty desert-punk (rust orange #e8792b, hazard yellow #ffc21a, deep charcoal #14110f, worn stencil type via system fonts + CSS letter-spacing/skew), big readable buttons, animated subtle grain, skewed bars matching the HUD. 1080p and 720p and ultrawide layouts.
API: `const ui = new Ui(root, {input})`; `ui.showTitle(cb)`, `ui.showLobby(state, cb)`, `ui.showGarage(profile, cb)`, `ui.showResults(run, profile, cb)`, `ui.showPause(cb)`, `ui.showSettings(settings, cb)`, `ui.hideAll()`, `ui.toast(text)`; exact callback names go in your report + top-of-file JSDoc.

## Module: Dressing → `src/world/dressing.js`, test via `world.html`
Places props/structures along the road as terrain chunks stream (uses `TerrainStreamer.onChunk(chunkIndex, rec)` / `onChunkDrop`; chunk covers s ∈ [c·96, c·96+96)). Uses `public/models/props/manifest.json` and `public/models/structures/manifest.json`
(both written by asset builders), `road.features` (ramp, boost, roadblock, bridge, tunnel, overpass, guard — see `src/world/road.js`), biome scatter densities in `src/data/biomes.js`. InstancedMesh per prop type per chunk (or merged), LOD/billboards for trees,
shadow casting only for near props, no per-frame work. Also: water (sea/lake plane following the camera with animated normal/foam/reflection-ish shader at `seaLevel(road,biome)` from terrain_gen.js), guard rails (visual; collider strips optional via `physicsHook`),
jump ramps + boost pads (visual + `physicsHook({type:'ramp'|'boost'|…, s, d, …})` so the sim can add colliders/effects), roadblocks (wreck lines with a gap), bridges (deck+piers over the terrain dip), tunnels (portals + tube + hill cap; see notes in terrain_gen.js: terrain
is a strip mesh outside |d|>9.5 m; road strip sits between), overpasses, roadside billboards/signs/poles, city ruins, gas stations, etc. Deterministic from (seed, chunk) so both peers see the same world.
```js
export class Dressing { constructor(scene, road, seed, opts={quality, physicsHook}) ; async load(); onChunk(c, rec) ; onChunkDrop(c) ; update(dt, cameraPos, s) ; dispose() }
```
