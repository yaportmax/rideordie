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

First-person driver: `view/cockpit.js` (live rear-view + door mirrors from ONE shared rear render every other frame — glass placed on the
truck's `mirror_C/L/R` sockets or measured housings; gauge cluster with needles/nitro/lamps; windshield dust + bullet-hole/crash cracks; clear
per-instance cockpit glass; T3 visor hidden from inside; look-back anchor), `view/camera_rig.js` ChaseCam mode 0 (cockpit: head-bone eye in the
truck frame, damped pitch/roll share, G-force head sway, mouse/stick free look, look-back B/LB), `ui/threat_hud.js` (off-screen raider chevrons
with distance + RAM!/BRAKE! from `st.intent`), `game.cabinLight` (night dash glow, constant light count). Run intro: countdown fly-by that lands in
first person (`run._introCam`); death camera pulls out of the first-person pose. Cabin audio: `audio.setCabin(0..1)`.
Enemy presentation: `view/elite_kits.js` (warlord kits, nameplates, weak-point glow), `view/hazard_marks.js` (roadblock telegraphs, breakable
barricades), `ui/banner.js` (encounter / warlord intro banners).

## World (additions)
`world/atmosphere.js` (shared sky model: sky dome, fog on every material, IBL, water), `world/night_lights.js` (pooled street-lamp point lights),
`dressing/groundcover.js` (verge grass/scrub/pebbles, 4 draws), `dressing/city.js` + `city_mat.js` + `mbuild.js` (procedural Ashen City),
`dressing/dam.js`, `damroad.js`, `gallery.js`, `setpieces.js`, `setmat.js` (dam, lake road, avalanche galleries, Leviathan gauntlet),
`dressing/rocks.js` + `moments.js` (arches, hoodoos, sea stacks, villages, wrecks, cable cars), `dressing/warm.js` (set-material prewarm).

## Network
`net/transport.js` (PeerJS signalling + reliable channel + extra unreliable RTCDataChannel), `net/snapshot.js` (binary 30 Hz snapshots incl. boss, client
interpolation), `net/session.js` (lobby, roles, host-authoritative profile/shop). Gunner client does hit detection on ghost cars and reports hits.

## Data / balance
`data/vehicles.js` (+ `model_info.json` extracted from GLBs by `tools/extract_model_info.mjs` — re-run after rebuilding vehicle models), `weapons.js`, `enemies.js`,
`upgrades.js`, `economy.js`, `boss.js` (parts, minibosses), `biomes.js`, `features.js`.
Balance tools: `tools/test/campaign_sim.mjs` (bot campaign), `boss_test.mjs`, `sim_run.mjs`, `vehicle_sim.mjs`, `crash_diag.mjs`, `repro_crash.mjs`.

## Tests / tools
Review loop: `npx vite build --outDir review_build` + `npx vite preview --outDir review_build --port 5190` (frozen build for independent reviewers).
`tools/test/cockpit_seq.mjs` (cockpit + look-back), `strip.mjs` (frame strip after load), `hitchprobe.mjs` (long frames + programs compiled by road position),
`ground_shots.mjs`, `setshots.mjs`, `frontend_shots.mjs`, `threat_probe.mjs`.
`npx vite --config vite.test.config.js` (no-HMR server on :5180 for automated tests), `tools/test/shot.mjs`, `drawcalls.mjs`, `moment.mjs`, `finale.mjs`,
`flow_net.mjs` (2-browser full flow), `net_game.mjs`, `snap_test.mjs`, `road_test.mjs`, `terrain_test.mjs`.

## Known gaps / ideas
- Economy/difficulty tuned with bots only — needs human play-testing (campaign target 2-3 h).
- Water reflects the sky only; one shadow cascade (~75 m).
- Build is ~215 MB; could be halved with gltf-transform (meshopt + webp).
- Gamepad buttons are not rebindable (keys are).
