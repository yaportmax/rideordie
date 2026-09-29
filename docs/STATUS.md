# RIDE OR DIE — status & map of the code (2026-09-29)

## Flow
`src/main.js` → `App` (`src/app.js`): TITLE → SOLO | HOST/JOIN → LOBBY (`src/net/session.js`) → GARAGE (`src/game/garage_scene.js` + `src/ui/screens/garage.js`)
→ RUN (`src/game/run.js`, owned by `Game` in `src/game/game.js`) → RESULTS → GARAGE. Victory after the Leviathan → modal → garage.
Dev shortcuts: `index.html?solo&s=<m>&maxed=1&weapons=a,b&seed=N` (straight into a run), `?devnet=host&role=driver` / `?devnet=join&code=X`.

## Simulation (DOM-free, runs on the driver's machine / solo)
`src/sim/sim.js` (Sim: cars, contacts → crash damage, blasts, run state), `vehicle.js` (raycast suspension, friction-circle tyres, drift governor,
nitro, air control), `car.js` (crew + hit zones + ray tests, GhostCar for the client), `ai.js` (EnemyBrain: chaser/flanker/rammer/blocker/heavy/dropper/summoner +
gunnery), `director.js` (difficulty level L from distance, spawning, minibosses, boss spawn), `boss.js` (Leviathan: kinematic 36 m war-train, parts, phases),
`projectiles.js` (enemy bullets w/ travel time, rockets, grenades), `hazards.js` (ramp/boost/guardrail/roadblock colliders, oil, mines), `structure_colliders.js`
(Dressing → trimesh colliders), `sync_ground.js` (headless terrain colliders). Physics: Rapier, 120 Hz fixed step.

## World
`src/world/road.js` (deterministic 60 km road + features), `terrain_gen.js` (profiles per biome, chunk meshes, sea level), `terrain.js` (worker streaming + colliders),
`terrain_material.js` (12-layer splat array textures, road shader), `sky.js` + `look.js` (time of day by distance), `dressing.js` + `dressing/*` (props, furniture,
features, landmarks, backdrop), `water.js`.

## View
`src/game/world_view.js` (cars, crews, debris, boss view, LOD switching), `view/car_view.js` (+ `car_lod.js` far LOD), `view/crew_view.js` (rigged characters,
spine aim + two-bone IK to weapon grips / steering wheel, deaths), `view/weapon_view.js` (gun mechanics), `view/boss_view.js`, `view/fx.js` + `view/fx/*`,
`view/post.js` + `view/post/*`, `core/audio.js` + `view/audio_bridge.js`, `view/camera_rig.js` (chase + gunner cams), `ui/hud.js`, `ui/ui.js` + `ui/screens/*`.
First-person gunner: `view/viewmodel.js` (FP arms + weapon rig: own projection/depth band, sway/bob/recoil springs, ADS, reload choreography,
FP muzzle flash; arms from `models/characters/fp_arms.glb` or cut from hero_gunner), `ui/gunner_hud.js` (crosshair, hit/kill markers, damage arcs,
ammo, scope overlays). Capture harness for gun feel: `shots/gunfeel/cap.mjs <plan>` (plans in `shots/gunfeel/plans.mjs`).

## Network
`net/transport.js` (PeerJS signalling + reliable channel + extra unreliable RTCDataChannel), `net/snapshot.js` (binary 30 Hz snapshots incl. boss, client
interpolation), `net/session.js` (lobby, roles, host-authoritative profile/shop). Gunner client does hit detection on ghost cars and reports hits.

## Data / balance
`data/vehicles.js` (+ `model_info.json` extracted from GLBs by `tools/extract_model_info.mjs` — re-run after rebuilding vehicle models), `weapons.js`, `enemies.js`,
`upgrades.js`, `economy.js`, `boss.js` (parts, minibosses), `biomes.js`, `features.js`.
Balance tools: `tools/test/campaign_sim.mjs` (bot campaign), `boss_test.mjs`, `sim_run.mjs`, `vehicle_sim.mjs`, `crash_diag.mjs`, `repro_crash.mjs`.

## Tests / tools
`npx vite --config vite.test.config.js` (no-HMR server on :5180 for automated tests), `tools/test/shot.mjs`, `drawcalls.mjs`, `moment.mjs`, `finale.mjs`,
`flow_net.mjs` (2-browser full flow), `net_game.mjs`, `snap_test.mjs`, `road_test.mjs`, `terrain_test.mjs`.

## Known gaps / ideas
- Economy/difficulty tuned with bots only — needs human play-testing (campaign target 2-3 h).
- No normal maps on vehicles; foliage a bit bright; city windows unlit; water reflects sky only.
- Build is ~215 MB; could be halved with gltf-transform (meshopt + webp).
- Gamepad buttons are not rebindable (keys are).
