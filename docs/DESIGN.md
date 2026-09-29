# RIDE OR DIE — design + architecture

Asymmetric 2-player online co-op. One player **drives** a pickup truck, the other stands in the **truck bed with guns**.
Survive as long as you can against ever-growing waves of raider cars (each with a driver + a gunner). Die -> back to the
garage -> spend cash on upgrades -> ride again. After a long run (fully upgraded) a **boss convoy** shows up. Kill it, win.
Arcade, crisp, loud, fast. Total campaign ~2-3 h across many runs (each run 3-15 min).

Stack: **Three.js (WebGL2) + Rapier3D (WASM) + Vite**, networking over **WebRTC data channels** (PeerJS for signalling +
free TURN). Assets: headless Blender 4.5 (`C:\Dev\tools\Blender-4.5.11-portable\blender.exe`) -> GLB in `public/models`.
Dev server: `npm run dev` (port 5173). Screenshot / probe tool: `node tools/test/shot.mjs` (headless Chrome, NVIDIA GPU).

## Units, axes, conventions
- Meters, seconds, kg. Three.js right-handed, **Y up**. World roughly runs toward **+Z**.
- **Vehicles, characters and guns FACE +Z** in glTF/Three.js (= Blender front toward **-Y**, export "+Y up").
- Entity local frame: +X = right (when looking along +Z, +X is LEFT of the driver! Three.js: looking along +Z with Y up,
  +X points to the viewer's LEFT). To avoid confusion the code names sides by sign of X: `L = +X`, `R = -X` for anything
  facing +Z. Asset node names follow that: `wheel_FL` has +X.

## Authority / networking model
- **The DRIVER's machine is the simulation authority**: it runs Rapier, all enemy AI, spawning, damage, projectiles.
- The **GUNNER's machine is a thin client**: it renders interpolated snapshots (~100 ms behind), sends aim/fire input and
  *hit reports* (client-side hit detection against the ghosts it sees = zero perceived latency; the sim applies damage).
- Room creator = "host" (owns the save file + lobby); roles are chosen in the lobby and are independent of host.
- Channels: reliable ordered (events, lobby, shop) + unreliable unordered (snapshots 30 Hz, gunner aim 30 Hz).
- Solo/dev mode (`?solo`): one human drives with WASD and aims/shoots with the mouse (both seats, no AI).
- Everything world-related is **deterministic from a seed** (road, terrain, props) so both peers build the same world.

## Modules (src/)
core/ renderer, post-fx, input, assets, audio, loop, rng, math.  world/ road, terrain, biomes, props, sky, structures.
sim/ physics, vehicle, ai, enemies, damage, weapons, projectiles, director(spawner), boss.  net/ transport, session.
view/ car views, characters (rig + IK + procedural anims), weapon views, fx (particles/decals/explosions), camera, hud.
meta/ profile (save), upgrades, garage scene, menus.  data/ static tables (vehicles, weapons, enemies, upgrades, biomes).

## Gameplay summary
- **Driver**: WASD / arrows steer+throttle+brake, Space handbrake (drift), Shift nitro, Q oil slick / E mines (unlockable),
  R flip/reset when stuck. Car HP, boost meter, engine/tyre/armor upgrades, new trucks.
- **Gunner**: mouse aim (third-person over-the-shoulder, free 360), LMB fire, RMB aim-down-sights, R reload, G grenade,
  1-6 / wheel swap weapons, Q/E lean. Infinite ammo; magazines + reloads. Body armor, grenades, weapons, mag upgrades.
- Enemy raider cars each carry a **driver** and (mostly) a **gunner**. Shoot the driver -> the car goes out of control and
  crashes (chain reactions!). Shoot the gunner -> ragdoll off the car. Shoot tyres -> swerve. Shoot the engine -> smoke, fire,
  explosion. Fuel tank hits / RPG / grenades -> explosion with blast damage + impulse to nearby cars.
- Player dies when: car HP <= 0 (explodes), OR driver HP <= 0, OR gunner HP <= 0.
- Enemy intensity is a function of run time; a Director spawns formations (chasers, rammers, blockers, heavies).
- Cash = kills, distance, time, style bonuses (crash kills, multi kills). Spend it at the garage.
- **Progress is DISTANCE along the road**: biomes (desert -> canyon -> coast -> mountains -> city -> dam, 10 km each, ~60 km total), time of day
  (morning -> noon -> sunset -> night -> pre-dawn) and difficulty all follow distance. Faster truck = reach the boss sooner: ~20 min with the fastest
  truck, ~40 min with the slowest. A run that reaches the dam meets the FINAL BOSS.
- **Minibosses** (named elite vehicles with health bars and gimmicks) at 9.3, 19.3, 29.3, 40.3 and 49.3 km.
- **Final boss = THE LEVIATHAN**, a colossal 34 m articulated war-train (NOT a group of cars): plow cab, fortress trailers with turrets, rocket
  pods, cannon, flamethrowers, drop-ramp that releases raider cars, fuel tanks + exposed reactor weak points behind armour plates. Multi-phase, part-based damage.
  Beat it -> victory (then endless mode).
- Early runs last 1-5 min; a fully-upgraded run lasts the full 30 min. Whole campaign ~2-3 h.

## Art direction
Sun-scorched apocalypse highway, "Mad Max meets a modern arcade racer". Saturated golden-hour light, heavy dust and
haze, long shadows, punchy contrast. Vehicles are rusty, patched, armor-plated, spiked, mismatched paint. Raiders wear
bandanas, goggles, leather, scrap armor. Player crew is cleaner and brighter so they read at a glance.
Biomes along the road: desert highway -> red canyon -> coastal cliffs -> pine mountains -> ruined city -> the dam (boss).
