# Enemy vehicles B — van, heavy, tanker + boss (procedural, Blender 4.5 headless)

Files in this folder: `e_van.glb`, `e_heavy.glb`, `e_tanker.glb`, `boss_warrig.glb` (the boss is **The Leviathan**, a 34 m war-train).
Sources / rebuild: `tools/blender/vehicles/enemy_b/` — `vlib.py` toolkit, `vmat.py` materials + textures, `vbake.py` (unique wear-atlas bake, v2 raiders),
`parts.py` (legacy parts, used by the boss), `parts2.py` (v2 detail parts: wheels, sandbags, mesh screens, lamps, patches, seats ...), `boss_parts.py`, one script per vehicle.
Rebuild one: `bash tools/blender/vehicles/enemy_b/run.sh <e_van|e_heavy|e_tanker|boss_warrig>.py` (raiders ~1.5-3 min each because of the bake, boss ~10 s).
Test builds: `VEH_OUT=shots/enemy_b/test` writes the GLB there instead of `public/` (Vite serves it as `/shots/enemy_b/test/<id>.glb`); `BAKE_QUICK=1` bakes at half density.
Node/socket regression check: `python tools/blender/vehicles/enemy_b/check_nodes.py e_van e_heavy e_tanker [--base=http://localhost:5180] [--dir=shots/enemy_b/test] [--ref=old_model_info.json]`
(`--ref` lists every socket / hub that moved by more than 1.5 mm).

Conventions (ASSET_SPEC): meters, front = **+Z**, up = **+Y**, **left = +X (driver on +X)**, origin on the ground under the vehicle centre
(boss: at the middle of the train). Every model is a flat list of top-level nodes with unit scale; the only child node is `steering_wheel_mesh` (see below).
Sockets are empties with identity rotation (+Z forward, +Y up) unless a rotation is stated below.

## Common notes for the game programmer
* **Wheels**: node origin = hub centre, axle = local X, the node holds two primitives (tyre + wheel incl. brake drum). Spin `rotation.x`, steer `rotation.y`.
  All left wheels share one mesh and all right wheels another (mirrored, rims face outward on both sides). The outer tyre radius (lug tops) is `R`
  (van 0.43, heavy 0.66, tanker 0.58, boss 1.35), so `hub.y == R` puts the tread on y = 0. Van/heavy: mud-terrain tyres (staggered lug blocks), sand-painted
  steel wheels with 6/8 cut-outs, beadlock ring, hub + nuts, brake drum visible through the holes. Tanker: ribbed highway tyres, 5-hole disc wheels.
* **Steering wheel**: `steering_wheel` (socket, unchanged position/rotation, +Z = column) now has one child mesh node **`steering_wheel_mesh`** (rim, spokes, hub)
  whose origin is the socket, geometry centred on it: rotate the socket (or the child) about its local Z to turn the wheel. The column/shroud stays in `body`.
  (`tools/extract_model_info.mjs` lists it under `sockets` because of its name prefix — harmless.)
* **Materials / textures of the three raiders (v2)**: palette names as before. `paint`, `paint2` stay tintable (near-white **grayscale** albedo, runtime
  `material.color` multiplies it). Every opaque material carries a **unique baked wear atlas** (base colour + ORM: roughness in G, metalness in B) on
  **TEXCOORD_1**, plus a small tiling detail normal map on TEXCOORD_0. The bake (Cycles AO + cavity, convex-edge distance, weld heat tint, rust streaks that run down
  from rivets/edges/welds, height + wheel-spray road dirt, dust on up-facing surfaces, a warm dust film, scratches, chips) is per texel, so these GLBs have
  **no COLOR_0 vertex colours** any more (the boss still has them). Emissive `light_head` / `light_tail` / `light_amber` and alpha `glass` are unchanged.
* **Folded materials**: small materials are merged into bigger ones to save draw calls, but each part keeps its own baked look. So a chrome handle, a rusty patch,
  a hazard stripe or a rubber mud flap may live in `armor` / `metal_dark` / `decal_red`. Consequences: these three models have **no `chrome` material** (the loader's
  chrome darkening no longer applies; their chrome parts are baked as dirty chrome), the tanker's aluminium tank is `metal_bare` and its red band `decal_red`.
  Materials per model: van `paint paint2 armor metal_dark interior canvas rubber_tire rim glass light_*`; heavy the same + `wood`; tanker
  `paint paint2 armor metal_dark metal_bare decal_red interior canvas rubber_tire rim glass light_*`.
* **Detachable pieces** are independent nodes whose *origin is the pivot* (hinge for hoods/doors/tailgates/ramp, centre for plates). The geometry underneath exists
  (engine bay under every hood, door cards + seats + dash behind doors, cab interior behind glass); `body` never contains the panels and looks complete without them.
* **Instancing**: wheels share mesh data (2 meshes per vehicle); triangle counts below include every instance.
* `body` = chassis, cab shell + interior, undercarriage (frames, axles, springs, drive shafts, exhaust, tanks), props.
* Sockets that carry a rotation: `steering_wheel` (+Z = column, pitched down toward the front), boss `rocket_pod_L/R` (+Z = tube axis), `flame_L/R` (+Z = flame direction = backwards),
  `floodlight_1..4` (4 deg down).

| file | tris | glTF meshes / mesh nodes | draw calls (primitives incl. wheel instances) | bbox incl. spikes/antennas (x, y, z) | GLB | texture memory (RGBA8 + mips) |
|---|---|---|---|---|---|---|
| `e_van.glb` | 34 986 | 14 / 16 | 39 | 2.71 x 3.68 x 6.50 m | 3.4 MB | ~53 MB |
| `e_heavy.glb` | 44 772 | 14 / 18 | 43 | 3.24 x 4.75 x 9.00 m | 3.9 MB | ~63 MB |
| `e_tanker.glb` | 43 240 | 15 / 21 | 47 | 3.13 x 4.85 x 10.20 m | 3.5 MB | ~64 MB |
| `boss_warrig.glb` | 162k | 32 / 42 | 89 (69 unique) | 9.3 x 10.2 x 36.1 m | 9.8 MB | ~59 MB |

v2 rebuild (the three raiders): before 34.1k / 42.8k / 56.6k tris and 3.1 / 3.2 / 3.4 MB. Wheel hubs, every socket position/rotation and the overall bbox are unchanged
(within 1 cm; spikes/mirrors were placed to keep the collider-relevant width/length identical); extracted wheel radius within ±1 mm.

## e_van "Boxer" (armored cargo van)
* Wheels `wheel_FL wheel_FR wheel_RL wheel_RR` (R 0.43, hubs x +-0.85, z +1.65 / -1.55).
* Panels: `panel_hood` (hinge at the cowl, 0,1.16,1.68; armored skin + big mesh-mouthed air scoop, hood pins), `panel_door_L/R` (hinge at the front edge, +-1.0,1.35,1.0;
  mesh window, welded armor plate with a firing port, door card inside, braced mirror), `panel_fender_L/R` (front flares), `panel_bumper_F` (0,0.7,2.8: box-beam ram with
  hazard stripes, V cow-catcher with teeth, grille guard, headlamp hoops, winch), `panel_bumper_R` (0,0.62,-2.86: spiked step bumper, hitch, plate),
  `panel_tailgate` (0,1.5,-2.84: welded double doors, cam lock bars, view slits, chained padlock), `panel_armor_L/R` (welded plates over the cargo box:
  steel / patched paint / rust, gun port with flap, low welded spikes, stencil, hanging chain on L).
* Roof gunner nest: the 0.9 x 0.9 m hatch opening with armored coaming, lid open at the rear edge (skull painted on its outer face — the rear read), a notched gun
  shield with two view slits in front of the hatch, sandbag walls both sides, ammo cans; crate platform inside puts his feet at y 1.5.
* Windshield: glass + hinged armored visor with two vision slits over the upper half + welded mesh screen over the lower half. Caged/taped headlamps, caged tail lamps
  on the rear corner posts, roof light bar (4 lamps), rear rack with spare wheel, jerrycans, crate, tarp roll, ratchet strap, whip antenna with a rag flag,
  side exhaust stack with heat shield, ladder up the right rear corner.
* Sockets: `seat_driver` (0.42,0.98,0.42), `steering_wheel` (0.42,1.31,0.86), `seat_gunner` (0,1.5,-0.95 = feet centre in the hatch; torso and head stand above the roof),
  `light_head_L/R`, `light_tail_L/R`, `exhaust_L` (low tailpipe) / `exhaust_R` (side stack top), `smoke_engine`, `camera_hood`, `roof_top`, `fuel_cap` (left flank), `nitro_L/R`.

## e_heavy "Hauler" (6x6 flatbed gunner platform)
* Wheels `wheel_FL/FR` (z 2.9), `wheel_ML/MR` (z -1.1), `wheel_RL/RR` (z -2.7); R 0.66, hubs x +-1.02.
* Deck top y 1.6 (wood planks, steel straps, stake pockets). Gunners: `seat_gunner` (0.45,1.6,-0.12) and `seat_gunner2` (-0.45,1.6,-3.05), each in a sandbag bunker
  (3 / 2 courses) with improvised shield plates; `gun_mount` (0,2.8,-1.9 = top of the welded pedestal with gussets and a traverse ring; rotate the mounted gun about Y).
  Headboard (cab protector) with two jerrycans, roll arch over the bed with four lamps, a horned skull and a chain, fuel drums, crates, ammo cans, folded tarp, banner flag.
* Cab: slit-visor + mesh windshield, snorkel up the right A-pillar, twin exhaust stacks, roof rack with spare wheel and light bar, whip antenna; military grille.
* Panels: `panel_hood` (0,2.1,2.8 hinge; long armored bonnet, mesh intake, louvres, rubber T-latches), `panel_door_L/R` (+-1.14,2.3,2.5 hinge; firing port, mesh window,
  west-coast mirror), `panel_fender_L/R`, `panel_bumper_F` (plow: welded V blade with ribs, cutting edge with teeth, spikes, hazard stripes, tow loop; 0,1.0,3.95),
  `panel_bumper_R` (pintle hook, spikes), `panel_tailgate` (armored gate with hazard stripes, pivot at its bottom edge 0,1.7,-4.0), `panel_armor_L/R`
  (3-plate bed side armor, gun port, welded spikes, KEEP BACK stencil).
* Sockets: `seat_driver`, `steering_wheel`, `light_head_L/R`, `light_tail_L/R`, `exhaust_L/R` (twin cab-back stacks), `smoke_engine`, `camera_hood`, `roof_top`, `fuel_cap`, `nitro_L/R`.

## e_tanker "Fuel Bomb"
* Wheels: `wheel_FL/FR` (z 3.5), `wheel_ML/MR` (0.1), `wheel_RL/RR` (-1.25), `wheel_RL2/RR2` (-3.2); R 0.58, hubs x +-1.02.
* The tank is part of `body`: dented aluminium shell (`metal_bare`, dents are real geometry) with the red **FLAMMABLE** band (`decal_red`, part of the shell), hazard
  placards, skull diamond + FLAMMABLE on the rear head, manways, fuel filler, vents, catwalk + roll-over rail, rear ladder, a welded cage (hoops + rails) with scrap-plate
  skirts and spikes on the lower flanks, and the rear fuel manifold with red hand-wheel valves. Tank spans z -3.9 ... +1.0, axis at y 2.28, radius about 1.1.
* Gunner nest on the cab roof: deck y 3.3, three courses of sandbags + shield plate in front, sandbag sides, rails, two lamps, ammo cans, ladder up the cab back;
  `seat_gunner` (0,3.35,2.02) (= `roof_top`).
* Panels: `panel_hood` (0,2.42,3.07), `panel_door_L/R` (+-1.2,2.3,2.75), `panel_fender_L/R`, `panel_bumper_F` (spiked bull-bar), `panel_bumper_R`, `panel_armor_L/R` (cab plates),
  `panel_stack_L/R` (exhaust stacks, pivot at the base +-1.28,1.4,1.28). Big grille with a horned skull (body).
* Sockets: `seat_driver`, `steering_wheel`, `fuel_cap` (0,3.73,-1.65 = tank top, main filler), `light_head_L/R`, `light_tail_L/R` (tank rear), `exhaust_L/R` (stack tops),
  `smoke_engine`, `camera_hood`, `roof_top`, `nitro_L/R`.

## boss_warrig "The Leviathan" (articulated war-train, one rigid model)
Layout along +Z: spiked plow (z 17.4) - tractor (hood, cab z 6.6..10.6, twin stacks) - fifth-wheel deck - **trailer #1 fortress** (z 3 ... -8.4) - hitch - **trailer #2** (z -9.7 ... -17) with the
reactor tower and ramp at the back. Width about 7.6 m (tyres +-3.42, tanks/pods +-3.85; 9.3 m with flank spikes), height about 9 m (stack tops 9.0, rear-tower spikes 9.5,
cab skull crest 10.2), length 34.4 m (36 m with spikes).
* **Wheels (12)**: `wheel_FL/FR` (z 12.6, steer), `wheel_ML/MR` (7.4), `wheel_RL/RR` (5.0), `wheel_R2L/R2R` (-2.4), `wheel_T1L/T1R` (-5.2), `wheel_T2L/T2R` (-13.6); R 1.35, hubs x +-2.95.
* **Driver cage**: `seat_driver` (1.0,4.05,8.4), `steering_wheel` (1.0,4.9,9.2, pitched 32 deg); the slit windshield is covered by a bar cage; `camera_hood`, `roof_top` (0,7.2,8.5).
* **Lights**: `light_head_L/R` (2.6,3.5,15.15) (huge caged lamps), `floodlight_1..4` (roof gantry, +Z forward), `light_tail_L/R` (rear pillars, -Z side).
* **Engine / exhaust**: `smoke_engine` (0,4.3,12.5), `smoke_stack_L/R` and `exhaust_L/R` (stack tops +-2.4,9.0,6.15), `nitro_L/R` (rear thrusters +-1.9,2.2,-17.25).
* **Turrets** (socket = pivot = origin of the destructible part; +Z forward, yaw about Y): `turret_1` (0,4.7,-0.2) -> `part_turret_1`, `turret_2` (0,4.7,-5.6) -> `part_turret_2`
  (twin heavy MGs behind slanted shields, on sandbagged pedestal rings), `turret_main` (0,4.65,-12.8) -> `part_turret_main` (long cannon, barrel along +Z),
  `muzzle_main` (0,5.51,-6.1 = barrel tip in the rest pose).
* **Missile racks**: `part_pod_L/R` (origin = trunnion, +-3.0,5.75,-4.0); sockets `rocket_pod_L/R` at the muzzle-plane centre (+-3.0,6.9,-1.1), rotated so **+Z = tube axis** (elevated 22 deg).
* **Gunners** (standing, feet centre, platform y 3.9): `seat_gunner` (1.2,3.9,-2.4), `seat_gunner2` (-1.2,3.9,-2.4), `seat_gunner3` (1.2,3.9,-3.5), `seat_gunner4` (-1.2,3.9,-3.5).
* **Fuel tanks**: `part_tank_L/R` (+-3.05,4.1,-13.7), horizontal cylinders on trailer #2's flanks; `fuel_cap` socket on tank L (3.05,5.14,-15.2).
* **Flame throwers**: `flame_L/R` (+-2.55,4.1,-17.05) at the rear corners; socket **+Z = flame direction (backwards, 15 deg outward)**.
* **Rear**: `ramp_rear` = drop-down ramp door, closed = vertical, hinge at its bottom edge (0,3.02,-17.0): rotate about X by -90 deg to lay it out backwards (about -70 deg is a car ramp).
  Above it the reactor tower: **`part_engine`** (= reactor core with glowing `light_amber` rods, origin 0,6.75,-16.05; socket **`weak_engine`** at the same point) hidden behind three bolt-on plates
  `panel_armor_rear_1` (centre, 0,6.75,-17.05), `panel_armor_rear_2` (left, 1.35,...), `panel_armor_rear_3` (right, -1.35,...). The tower's other faces are closed, so the core only shows once the plates are gone.
* **Other destructibles**: `part_plow` (0,1.4,16.0; blade, spikes, impaled skulls, chains), `part_stack_L/R` (chrome stacks, pivot at base +-2.4,3.0,6.15), `panel_hood` (0,4.6,10.8 hinge),
  `panel_fender_L/R` (+-2.9,3.2,12.6), `panel_grille` (0,3.2,14.95: grille bars + skull face with glowing eyes), `panel_chin` (lower cab-front armor), `panel_armor_roof`, `panel_armor_cab_L/R`,
  `panel_armor_t1_L1/L2/R1/R2` (trailer #1 flank armor, 2 per side), `panel_tower_L/R` (reactor-tower side plates).
* Props: hanging chains, banners on tall poles (cloth uses `paint2`, so banners take the tint), horned skulls (`plastic`, glowing `light_amber` eyes) on the cab crest, roof, towers and impaled on the plow,
  catwalks + ladders (cab flanks, trailer #1 flanks, rear tower, hitch bridge), generator + cables, radio mast, chained loot (crates/barrels/tyres) at the back of trailer #1, spare tyres + toolboxes +
  air hoses on the tractor deck, corner towers with floodlights/spikes, spiked flanks.
* Textures on the boss are tiled at 2.6x scale (bigger rust / chip blotches for the bigger object); baked AO uses a 3 m ray length. The boss still uses the legacy tiling-texture +
  vertex-colour path (`Model(bake=False)`); rebuilding it after the v2 changes gives a byte-identical GLB.

## How the v2 wear bake works (`vbake.py`, opt-in with `Model(..., bake=True)`)
1. **Charts**: every primitive is split into planar-ish charts (faces binned by dominant signed axis, connected components); tiny primitives (rivets, bolts, weld beads)
   become one chart. Vertical charts are oriented so atlas-down = world-down.
2. **Packing**: one atlas per material (keeps the runtime far-LOD average colour of every material right); shelf packing with column stacking; the smallest
   power-of-two atlas that holds ~85 % of the target texel density is chosen (per-material caps in `bake_opts['max_size']`); enclosed charts (inner faces of plates,
   covered surfaces; a few BVH rays) get less density. Typical exterior density 150-225 texels/m.
3. **Raster** world position / normal per texel, **Cycles bakes** AO (1 m) and cavity (7 cm) at half resolution.
4. **Masks**: convex-edge distance per primitive (edge wear + bare-metal chips, width clamped by part size), weld proximity (heat tint rings, bead ripples),
   rust sources (rivets, top edges, welds, random) smeared downward into streaks, height/wheel-spray dirt, dust on open up-facing faces, road-dust film, scratches.
5. **Recipes** per material (`RECIPES`; a part folded into another material keeps its own recipe as a "look") -> albedo (sRGB) + roughness + metalness; gutters dilated.
