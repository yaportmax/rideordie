# ASSET SPEC (contract between the asset builders and the game code)

Read `docs/DESIGN.md` first for the art direction. The game is a Three.js (WebGL2, r186) browser game; assets are **GLB**
files in `public/`. Game code finds things **by node name and material name**, so the names below are mandatory.

## Tooling
- Blender 4.5 headless: `"C:/Dev/tools/Blender-4.5.11-portable/blender.exe" -b --factory-startup -P tools/blender/<area>/<asset>.py -- [args]`
- Helper lib: `tools/blender/rod_lib.py` (`from rod_lib import *` after adding `..` to sys.path — see `tools/blender/_test/orient.py`).
  Extend it or add your own helper modules in your own area folder; do not break existing functions.
- **In-engine QA (use this constantly, judge your own work by it):** the dev server is already running on
  `http://localhost:5173` (do NOT start another / do not use port 5173 for anything else). Screenshot:
  `node tools/test/shot.mjs "viewer.html?model=/models/<path>.glb&sheet=1" shots/<you>/<name>.png --quiet --eval="JSON.stringify(window.__viewer)"`
  then LOOK at the PNG with the Read tool. Viewer options: `sheet=1` (6-view contact sheet), `az=35&el=14&dist=8` (one view), `tint=cc3311`
  (tints materials named `paint*`), `wire=1`, `sun=25` (sun elevation), `spin`, `grid=1`, `w/h` via `--w=1600 --h=900`.
  `window.__viewer` reports triangle count, node tree (names + positions), material names, bbox.
  Lighting in the viewer ≈ the game (golden hour sun + sky IBL, ACES tonemap). Iterate until it looks GOOD in these screenshots —
  not just "correct". Compare against how real vehicles/weapons/people look; fix flat, toy-like, blobby or noisy results.
- Python: system Python 3.14 has no numpy — for numpy/scipy work use `C:/Dev/conduit/art_src/venv/Scripts/python.exe` (has numpy, scipy).
- ffmpeg is on PATH (`ffmpeg`). Node 24 + npm available (`npm i -D <pkg>` allowed for tooling, e.g. `@gltf-transform/cli`).
- Downloads: only CC0 / public-domain (Poly Haven, ambientCG, Kenney, Quaternius, OpenGameArt CC0). Keep a `CREDITS.md` line for anything downloaded.
- Do NOT edit `src/`, `index.html`, `package.json`, or files in other agents' folders. Do not `git commit`. Put scratch renders in `shots/<you>/`.
- Web budget: whole game < ~300 MB over the wire once. Textures: JPG/PNG, max 2048 (1024 for props), power-of-two, tileable when tiling.
  Prefer few materials per asset (merge meshes by material). Run `npx @gltf-transform/cli optimize` (meshopt, no texture resize surprises)
  only if you verify the result still loads in the viewer (viewer supports meshopt, not draco).

## Global conventions
- Meters, kg, degrees in scripts. Human height ~1.78 m. Model **FRONT faces Blender -Y** (→ **+Z** in glTF/Three.js after export), Z up.
  Model **LEFT = Blender +X**. Naming: `*_L` = +X side, `*_R` = -X side. Origin at ground level under the vehicle centre / at the grip for guns.
- Every mesh has a named material from the palettes below (game code tints/swaps by name). glTF PBR (Principled BSDF → metal/rough);
  avoid procedural-only shaders — anything the exporter can't bake won't arrive. Use image textures / vertex colours for detail.
- **Bevel every hard edge** (0.5-2 cm) and shade smooth-by-angle: crisp specular edge highlights are what make hard-surface models read as
  "AAA" instead of "primitive boxes". Add real detail: panel gaps, bolts, rivets, hinges, handles, vents, wires, welds, straps.
- Add wear: rust, chipped paint, dirt in crevices, grime lower on the body, scratches — via UV-mapped baked/painted textures
  (grayscale multiply for `paint` so runtime tint works) and/or vertex colours (COLOR_0 multiplies base colour). Avoid uniform plastic look.
- Triangles count as: `window.__viewer.tris`. Budgets are per model and are targets, not licences to be lazy.
- Empties (Blender "plain axes") export as Object3D nodes: use them for sockets. Sockets' +Z is "forward", +Y up (after export).
- Write a `<group>/README.md` next to your outputs (or `public/models/<group>/manifest.json`) listing each file, tri count, node names, sockets,
  materials, dimensions, anything the game programmer must know (e.g. "hood hinge pivot is at the windshield base").

## Material palette (names are the contract)
Tintable (runtime multiplies base colour, keep base near white + grayscale detail): `paint`, `paint2`.
Fixed: `metal_dark`, `metal_bare` (worn steel), `rust`, `chrome`, `rubber`, `rim`, `armor` (plate steel), `spike`, `plastic`, `interior`,
`fabric`, `leather`, `wood`, `canvas`, `brass`, `glass` (alpha ≈ 0.3-0.45 tinted, roughness ~0.05, double_sided), `light_head` (emissive warm white),
`light_tail` (emissive red), `light_amber`, `rubber_tire`, `gun_metal`, `gun_black`, `gun_steel`, `polymer`, `skin`, `cloth_*`, `hair`, `glass_lens`.
Emissive materials: emission strength ~2-4 (bloom in game will do the rest).

## VEHICLES  — `public/models/vehicles/<id>.glb`
Required node names (Object3D, exact):
- `body` — main hull (may be a group of meshes). Must look complete with detachable panels removed.
- Wheels: `wheel_FL wheel_FR wheel_RL wheel_RR` (+ extra axles for trucks: `wheel_ML wheel_MR`, `wheel_RL2 wheel_RR2`). Each is a **node whose origin is the
  hub centre**; wheel geometry is centred on that origin, axle along local X, tyre+rim as children (game spins `rotation.x`, steers `rotation.y`).
  Rims face outward on both sides. Real tyre profile: sidewall, tread blocks/grooves, rim with lugs. Visible brake disc/caliper behind spokes is a plus.
- Detachable panels (independent meshes/groups, origin at hinge or centre of mass, they fly off when damaged): `panel_hood`, `panel_door_L`, `panel_door_R`,
  `panel_bumper_F`, `panel_bumper_R`, `panel_trunk` (or `panel_tailgate`), optional `panel_roof`, `panel_fender_L/R`, `panel_armor_*`. What is underneath must exist
  (engine bay with engine block/radiator, door interior, etc.).
- Sockets (empties): `seat_driver` (hip point of the driver, facing +Z), `steering_wheel` (centre of the wheel, +Z axis = column direction), `seat_gunner`
  (feet centre of the standing gunner in the bed / on the rear deck, for vehicles that have one), `gun_mount` (pivot of a mounted gun, if any),
  `light_head_L/R`, `light_tail_L/R`, `exhaust_L`, `exhaust_R` (or `exhaust`), `smoke_engine` (under hood front), `fuel_cap`, `nitro_L/R` (rear, flame origin),
  `camera_hood`, `roof_top`.
- Interiors visible through glass: seats, dash, steering wheel, roll cage — no hollow shells.
- Lights: separate small meshes with `light_head` / `light_tail` materials (lens + reflector detail).
- Player trucks: driver on the LEFT (+X). Bed has a free standing area ≥ 1.7 m (x) × 1.5 m (z) with a waist-high frame/rail; `seat_gunner` at the centre.
- Silhouette must read at 60 m: distinct per type. Rugged post-apocalyptic: bull bars, plating, spikes, roof racks, jerry cans, spare tyre, chains, flags.
- Budgets: player trucks 45-80k tris; enemy cars 20-40k; heavies 40-70k; boss 150-250k. ≤ 30 meshes after merging by material.
Ids: player `truck_t1 truck_t2 truck_t3 truck_t4`; enemies `e_sedan e_muscle e_buggy e_technical e_van e_heavy e_tanker`; boss `boss_warrig`.

## WEAPONS — `public/models/weapons/<id>.glb`
Model faces **+Z (muzzle)**, origin at the **pistol-grip centre**, +Y up, scale 1:1 (meters). Moving parts are separate named nodes with the **origin at their pivot**
(game animates them procedurally): `mag` (magazine/drum/ammo box; origin at the top where it seats), `slide` or `bolt` or `charging_handle`, `pump` (shotgun fore-end),
`bolt_handle` (sniper), `cylinder` (revolver), `trigger`, `hammer`, `belt` + `feed_cover` (LMG), `rocket` (RPG loaded warhead), `scope`.
Sockets: `muzzle` (barrel tip, +Z), `eject` (case ejection port, +X = eject dir), `grip_R` (right palm centre), `grip_L` (support hand: foregrip/handguard/pump),
`mag_well`, `sight` (eye alignment point behind the rear sight/scope), `stock` (shoulder pad centre; omit for pistol).
Ids: `pistol smg shotgun rifle lmg sniper rpg revolver` + `grenade` (frag, with `pin`,`lever`), `rocket` (projectile), `shell_9mm shell_shotgun shell_rifle` (casings), `mag_pistol` etc. only if not embedded.
Real proportions & real mechanical detail (rails, sights, vents, screws, wear). Budgets: 12-35k tris per gun. Materials `gun_metal gun_black gun_steel polymer wood rubber brass glass_lens`.

## CHARACTERS — `public/models/characters/<id>.glb`
One shared skeleton for all humans (Mixamo-style names, no prefix): `Hips Spine Spine1 Spine2 Neck Head` + `LeftShoulder LeftArm LeftForeArm LeftHand` (+ 3-bone fingers
`LeftHandThumb1..3 LeftHandIndex1..3 ... Pinky`), same for Right, `LeftUpLeg LeftLeg LeftFoot LeftToeBase`, same Right. T-pose or A-pose bind, facing +Z.
Skinned meshes with clean weights (no candy-wrapper elbows/shoulders), ≥ 15k tris for heroes, 8-12k for raiders. Face with eyes/teeth; hair meshes (cards or solid).
Sockets as bones or empties parented to bones: `socket_hand_R`, `socket_hand_L`, `socket_back` (weapon on back), `socket_head`.
Ids: `hero_gunner` (player: survivor look — tank top/jacket, gloves, goggles on forehead, fingerless-glove details), `hero_driver`, gunner armor tiers as separate skinned
meshes on the same skeleton `armor_t1 armor_t2 armor_t3` (vest → plate carrier → heavy armor, they are toggled visible by the game; export inside hero_gunner.glb as hidden nodes named so),
raiders `raider_a raider_b raider_c raider_d raider_driver` (bandana/goggles grunt, mohawk punk, masked heavy in scrap armor, hooded bomber, driver with cap) — distinct silhouettes, dirty.
Baked animation clips (glTF animations, 30 fps, names exact): `idle_stand` (loop, braced legs, gentle sway), `idle_sit_drive` (loop, hands on wheel pose), `sit_lean_L`, `sit_lean_R`,
`flinch_a`, `flinch_b`, `throw_grenade`, `celebrate`, `crouch_idle`, `death_fall`. The game layers procedural two-bone IK (hands→gun sockets), spine aim and recoil on top — so
`idle_stand` should be a neutral standing pose with arms in a generic "holding a rifle at chest" position.

## ENVIRONMENT — `public/textures/<name>/{albedo,normal,arm}.jpg` (+ `public/models/props/*.glb`)
`arm` = R:AO G:roughness B:metallic. Normal maps OpenGL (Y+). Tileable. Names: `asphalt`, `asphalt_worn`, `asphalt_cracked`, `sand`, `dirt_red`, `dry_grass`, `gravel`, `rock_red`, `rock_grey`,
`cliff`, `snow`, `forest_floor`, `concrete`, `concrete_cracked`, `rust_metal`, `brick_ruin`, `paint_road` (road markings atlas made procedurally), `dust_particle`/`smoke_particle` sprite sheets.
Props (instanced by the world generator, so **low poly + LOD friendly**, origin at base centre, Y up): rocks ×6, boulders ×3, dead trees ×3, cactus ×3, pine ×3 (+ `_lod` ~300 tris),
shrubs ×4, grass tuft, jersey barrier, guard-rail segment (4 m), road cone, barrel (also `barrel_explosive`), road signs ×4, billboard, utility pole, street lamp, wrecked cars ×3, jump ramp,
bridge segment, tunnel portal, overpass, ruined buildings ×5 (10-60 m tall), water tower, shipping containers, gas station, radio tower, and boss-arena dam pieces. Provide `public/models/props/manifest.json`.

## AUDIO — `public/audio/<group>/<name>.ogg` (Vorbis q5, mono for positional sfx, stereo for music/ambience, 44.1 kHz, peak ≤ -1 dBFS, no clipping)
Groups & names in `docs/AUDIO_LIST.md` (audio builder maintains it and the manifest `public/audio/manifest.json`).
