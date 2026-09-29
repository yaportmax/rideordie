# Enemy vehicles A: sedan, muscle, buggy, technical (procedural, Blender 4.5 headless)

Files: `e_sedan.glb` ("Bandit"), `e_muscle.glb` ("Rammer"), `e_buggy.glb` ("Skirmisher"), `e_technical.glb` ("Technical").
Sources: `tools/blender/vehicles/enemy_a/`. Each vehicle has one script (`sedan.py`, `muscle.py`, `buggy.py`, `technical.py`) built on the shared helpers
`veh_lib.py` (geometry: loft/prism/box/tube/bolts; x=left, f=forward, z=up), `veh_kit.py` (hard-surface kit: sealed-beam/rect lamps with housing,
chrome reflector bowl, faceted emissive lens, bezel, tape-X / wire-cage / smashed variants; ribbed tail-lamp clusters; rippled weld beads; spikes with
collars; riveted/welded plates; expanded-metal and square-bar grilles; jerry cans, spare tyres, crates, tarp rolls, ammo boxes, chains, straps, sandbags;
bucket and pleated bench seats, door cards, gauge clusters, steering wheels; organic rust / primer patches and bullet holes projected onto panels),
`veh_parts.py` (v2 wheels: tyre carcass with sidewall bulge + separate tread/shoulder lugs, rims with barrel/bead seats/dish/windows or star spokes,
raised hub, hex lug nuts, brake rotor + hat, static calipers), `veh_pipeline.py` (materials, wear bake, atlas, assembly, export), `veh_decals.py`
(spray-paint masks), `buggy_parts.py`, `muscle_parts.py`.

Rebuild (about 2-4 min each depending on GPU load, Cycles GPU bake; run them one after another):
```
bash tools/blender/vehicles/enemy_a/bl.sh <sedan|muscle|buggy|technical> --res 2048 --orm 1024 --samples 16
```
Options: `--nobake` shape-only pass (flat materials, fast), `--parts` prints a per-part triangle table, `--nomerge` skips the small-material consolidation,
`--nrm 0` skips the normal-map bake. Log: `shots/enemy_a/_<name>.log`.
QA: `node tools/blender/vehicles/enemy_a/qa.mjs e_sedan sheet,close,rear34,cab,wheel,nose,tail,close_n --tint=8a3a1e --tag=x` (viewer on :5180, `paint2` is
shown in the game's `30302e`; a `_n` suffix renders the view at night). Contract check against the shipped baseline:
`node tools/blender/vehicles/enemy_a/check_contract.mjs` (node names, parents, positions, rotations, materials, bbox, tris, size; baseline in
`contract_baseline.json`). Draw calls per node: `node tools/blender/vehicles/enemy_a/prims.mjs e_sedan`.

## Conventions (ASSET_SPEC)
* Meters. Front = **+Z**, up = **+Y**, **left = +X (driver on +X)**. Origin is on the ground under the vehicle centre. Positions below are glTF (x, y, z).
* Top-level nodes: `body` (Object3D holding one mesh with several primitives), `wheel_*`, `panel_*`, sockets. Every node has unit scale.
* **Wheels**: node origin = hub centre, axle = local X, children = `<name>_tire` + `<name>_rim`. Spin `rotation.x`, steer `rotation.y`. `hub.y` equals the tyre radius (tread touches y = 0).
  Rims face outward on both sides (the right side is mirrored). Brake rotor + hat spin with the rim; the caliper is static (part of `body`).
* **Steering wheel**: rim/spokes/hub are the mesh node **`steering_wheel_mesh`**, child of the `steering_wheel` socket with identity local transform
  (geometry centred on the socket; rotate the socket's child about local Z to turn the wheel). The column stays in `body`.
* **Panels**: each `panel_*` is its own node, with its origin at the **hinge** (hood: rear edge at the windshield base; doors: front edge;
  trunk/tailgate: hinge edge; bumpers: centre). The body underneath is complete: engine bay (block, heads, radiator, hoses, battery), door-less cabin with
  interior, trunk contents, frame rails. Panel inner faces use the panel's own paint; doors carry their door cards (armrest, pull, crank, speaker).
  Loads strapped to a lid ride on that panel (the sedan's trunk junk flies off with `panel_trunk`).
* **Sockets** are empties with identity rotation (+Z forward, +Y up) except `steering_wheel` (pitched so +Z runs down the column),
  `light_tail_*` / `exhaust*` / `nitro_*` (yaw 180, +Z points backwards) and `fuel_cap` (yaw +90, +Z points outward on the left flank; the buggy's is
  yaw -90, exactly as it shipped - the game only uses its position).
* **Materials**: palette names only. `paint` and `paint2` are tintable: the albedo is near-white with grayscale wear (rust, chips, primer rings, dirt,
  decals are dark grey), so setting `material.color` tints them. Everything else is fixed. Rust and dark-primer repairs are separate `rust` / `paint2`
  patch geometry so they survive any tint. Extra fixed names used: `cloth_red`, `cloth_dark`, `cloth_tan`, `spike`, `gun_metal`, `gun_steel`, `gun_black`, `brass`.
* **Textures**: per vehicle one embedded 2048 JPEG albedo atlas, one 2048 JPEG tangent-space **normal map** (OpenGL, baked from procedural height:
  rust crust, chips, scratches, pitting, dents, weave, wood grain) and one 1024 JPEG ORM atlas (R = AO -> `occlusionTexture`, G = roughness, B = metalness),
  shared by all textured materials; tangents are exported. Micro parts (bolts, rivets, welds, lug nuts, tyre lugs, spikes, grilles, chains, cages) sample a
  flat per-material colour cell, so the painted panels get the texel density (paint islands are weighted x1.4). `glass` (alpha 0.40, double-sided) and the
  emissive lights (`light_head`, `light_tail`, `light_amber`) are untextured. No vertex colours.
* Tiny single-use materials inside one mesh are folded into a close palette neighbour before baking (fewer draw calls).
* Wheels on the same axle side share mesh data.

| file | tris (before -> now) | primitives | bbox x * y * z (m) | GLB (before -> now) |
|---|---|---|---|---|
| `e_sedan.glb` | 24,452 -> 35,244 | 76 | 2.18 * 2.00 * 5.39 (flag tip 2.00; x/z within 1 cm of the original) | 1.3 -> 3.1 MB |
| `e_muscle.glb` | 24,758 -> 32,886 | 53 | 2.07 * 1.62 * 5.18 (incl. ram plate) | 2.0 -> 3.3 MB |
| `e_buggy.glb` | 29,060 -> 32,692 | 40 | 2.02 * 2.55 * 3.78 (whip antennas 2.55; cage top ~1.72) | 2.2 -> 3.8 MB |
| `e_technical.glb` | 25,668 -> 35,612 | 67 | 2.30 * 2.60 * 5.32 (banner tip 2.60, MG shield 2.39) | 1.8 -> 3.3 MB |

Length and width are kept within ~1 cm of the shipped models on purpose: `src/data/vehicles.js` scales the physics colliders from the model bbox
length and width. Only a height changed (technical banner pole). Hub positions and every socket are unchanged (`check_contract.mjs`).

## e_sedan "Bandit" (1980s land yacht, chopped roof)
* Wheels R 0.39: `wheel_FL/FR` (+-0.79, 0.39, 1.62), `wheel_RL/RR` (+-0.79, 0.39, -1.42). All-terrain tread, 6-window steel wheels, 5 lug nuts, rotor + caliper.
* Panels: `panel_hood` (hinge 0, 0.99, 0.72), `panel_trunk` (hinge 0, 0.99, -1.365, carries the junk pile + licence plate), `panel_door_L/R` (front doors,
  hinge +-0.90, 0.65, 0.66), **`panel_door_L2/R2`** (rear doors, hinge +-0.90, 0.65, -0.32), `panel_bumper_F` (steel bumper + spiked push bar + cow skull,
  0, 0.47, 2.55), `panel_bumper_R` (bumper, hitch, dragging chain, 0, 0.47, -2.55).
* Look: slatted armour shutter bolted over the windscreen (vision slits), torch-cut roof, black welded roll hoop with two caged spot lamps, gunner rail with
  rag grip, quad sealed-beam lamps (outer-left taped, inner-right smashed), ribbed tail clusters (left one broken + taped), driver window guard + truck
  mirror, salvaged round mirror on the right, riveted and welded plates, patched fender, bullet-hole burst across the right doors, rust + dark-primer
  patches, trunk load (spare tyre, jerry cans, crate, bedroll, straps), tattered red war flag. Interior: pleated bench seats, dash with gauges and radio,
  column shifter, door cards, pedals, ammo box on the rear floor.
* Sockets: `seat_driver` (0.40, 0.56, 0.03), `steering_wheel` (0.40, 0.925, 0.46), **`seat_gunner` (0, 0.555, -0.86)** = feet on the rear-seat cushion,
  `light_head_L/R` (+-0.64, 0.79, 2.50), `light_tail_L/R` (+-0.56, 0.81, -2.50), `exhaust_L/R` (+-0.50, 0.27, -2.68), `smoke_engine` (0, 0.86, 1.85),
  `fuel_cap` (0.985, 0.80, -2.05), `roof_top` (0, 1.46, -0.10), `camera_hood` (0, 1.02, 1.35).
* Tint zones: `paint` = body, hood, trunk, door_R, door_L2; `paint2` = mismatched door_L and door_R2, dark primer repairs, one trunk jerry can.

## e_muscle "Rammer" (1970 fastback coupe, driver only)
* Wheels: front R 0.355 `wheel_FL/FR` (+-0.80, 0.355, 1.30), fat rear R 0.375 `wheel_RL/RR` (+-0.79, 0.375, -1.62). 5-spoke star rims with
  **chariot spike spinners** on every hub (they spin with the wheel), riveted bolt-on arch flares. The spinners make `model_info` report a wider wheel `w`
  (0.34 / 0.41); `spec.wheelWidth` is assigned but not read by the sim.
* Panels: `panel_hood` (hinge 0, 0.985, 0.70; cut-out with welded trim, the **blower stays with the engine** when the hood flies), `panel_trunk` (0, 0.975, -1.96,
  ducktail), `panel_door_L/R` (+-0.92, 0.65, 0.62), `panel_bumper_F` = **spiked wedge ram plate** with welded scrap patches, gussets and a chain to the
  left fender (0, 0.40, 2.35), `panel_bumper_R` (0, 0.38, -2.35).
* Look: roots blower + bug-catcher scoop with mesh screen, louvered steel shutter over the fastback glass, riveted roof plate, guard bars over the passenger
  half of the windscreen, driver window net, armour plate over the passenger window, caged (left) / taped (right) lamps in the hidden-headlight slot,
  side pipes with heat shields, full roll cage, race buckets with red harness, nitro button + line, bullet holes on the left door.
* Sockets: `seat_driver` (0.42, 0.53, -0.04), `steering_wheel` (0.42, 0.895, 0.30), `light_head_L/R` (+-0.56, 0.78, 2.30), `light_tail_L/R` (+-0.47, 0.76, -2.30),
  `exhaust_L/R` (+-0.42, 0.30, -2.50), `smoke_engine`, `fuel_cap` (0.972, 0.80, -1.95), `roof_top` (0, 1.34, -0.25), `camera_hood`. **No `seat_gunner`**.
* Tint zones: `paint` = body + doors (roof skull, door tally/X), `paint2` = hood + trunk (worn twin stripes). Note: the game also adds its own runtime
  `ram_bar` to `e_muscle` (car_view.js), in front of this model's ram plate.

## e_buggy "Skirmisher" (tube-frame dune buggy)
* Wheels: front R 0.37 W 0.26 `wheel_FL/FR` (+-0.78, 0.37, 1.20), mud tread; rear **paddle** tyres R 0.46 W 0.42 on beadlock rims `wheel_RL/RR` (+-0.79, 0.46, -1.10).
* Panels (no doors on a buggy): `panel_hood` (fibreglass nose cowl with a spike ridge, 0, 0.88, 0.86), `panel_fender_L/R` (front wings, +-0.78, 0.85, 1.20),
  `panel_trunk` = **rear engine cover** (0, 0.98, -1.14), `panel_bumper_F` (spiked tube bumper + skid plate, 0, 0.40, 1.76), `panel_bumper_R` (0, 0.42, -1.76).
* Look: sagging canvas sun tarp over the front cage, caged spots on the roof bar, caged (left) / taped (right) headlights, expanded-metal side panels around
  the gunner, spare wheel, red jerry can in a side rack, shovel strapped to the pod, chain across the rear hoop, tattered flags on whip antennas,
  exposed flat-four with headers, coilovers, race buckets with harnesses.
* Sockets: `seat_driver` (0.36, 0.50, 0.14), `steering_wheel` (0.36, 0.88, 0.60), **`seat_gunner` (0, 0.70, -0.68)**, **`gun_mount` (0, 1.995, -0.24)**
  (pivot post on the cage roof, no gun mesh), `light_head_L/R` (+-0.30, 0.72, 1.645), `light_tail_L/R` (+-0.36, 0.86, -1.72), `exhaust_L/R` (+-0.24, 0.38, -1.84),
  `nitro_L/R` (+-0.14, 0.52, -1.84), `smoke_engine` (0, 0.90, -1.36), `fuel_cap` (0.36, 0.50, -0.55), `roof_top` (0, 1.72, 0.22), `camera_hood`.
* Tint zones: `paint` = nose/wings with baked flames (the tint colours the flames); `paint2` = roll cage, side pods, engine cover, platform jerry can.

## e_technical "Technical" (beat-up single-cab pickup with a pedestal HMG)
* Wheels R 0.40: `wheel_FL/FR` (+-0.79, 0.40, 1.48), `wheel_RL/RR` (+-0.79, 0.40, -1.33). Deep-dish steel wheels, 6 lugs, mud tread, rubber mud flaps.
* Panels: `panel_hood` (0, 1.06, 0.94), `panel_door_L/R` (+-0.90, 0.70, 0.86), **`panel_tailgate`** (hinge at the bottom edge 0, 0.93, -2.40), `panel_bumper_F`
  (bull bar with bolted plate, caged/taped driving lamps, red D-rings, 0, 0.47, 2.44), `panel_bumper_R` (0, 0.47, -2.53).
* **`gun_mount` (0, 2.14, -0.92)** = trunnion pivot. Its child **`gun_mount/gun_mg`** is the HMG (riveted receiver, perforated barrel jacket, flash hider,
  sights, carry handle, wooden spade grips, ammo can + link belt with brass rounds, shield with wings and ears), modelled facing +Z.
* **`seat_gunner` (0, 0.944, -1.42)** = bed floor behind the mount, free area about 1.3 x 1.2 m.
* Look: expanded-metal grenade screen over the windscreen, raised air snorkel, roof rack with caged spots, jerry cans, bedroll and crate, square sealed beams
  (right one smashed), black banner pole, sandbag walls, oil drum, ammo crates, spare wheel with wing-nut bolt, rifle rack with a rifle, CB radio, bench seat.
* Sockets: `seat_driver` (0.38, 0.665, -0.06), `steering_wheel` (0.38, 1.10, 0.44), `light_head_L/R` (+-0.66, 0.80, 2.26), `light_tail_L/R` (+-0.78, 0.72, -2.42),
  **`exhaust`** (0.62, 0.24, -2.62), `smoke_engine` (0, 0.88, 1.95), `fuel_cap` (0.935, 0.98, -2.02), `roof_top` (0, 1.98, -0.30), `camera_hood`.
* Colour-blocked: `paint` = cab, front fenders, roof, tailgate; `paint2` = hood, doors, bed sides, one bed jerry can, one rack can.

## Deviations / notes
* The sedan has extra rear-door panels `panel_door_L2/R2`. The technical uses `panel_tailgate` (no `panel_trunk`) and one `exhaust` socket. The buggy has no doors, and its `panel_trunk` is the engine cover.
* `steering_wheel_mesh` also shows up in `model_info.json` sockets (the extractor matches the `steering_wheel` prefix), at the socket position.
* Lights are always emissive (material emission); the game modulates `emissiveIntensity` by material name.
* Bake robustness: the pipeline checks atlas coverage after every bake (retries on the CPU if a shared-GPU bake silently fails) and collapses degenerate
  UV slivers before packing (one sliver once made the packer shrink every island to nothing).
