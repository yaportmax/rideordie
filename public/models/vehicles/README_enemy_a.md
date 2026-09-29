# Enemy vehicles A: sedan, muscle, buggy, technical (procedural, Blender 4.5 headless)

Files: `e_sedan.glb` ("Bandit"), `e_muscle.glb` ("Rammer"), `e_buggy.glb` ("Skirmisher"), `e_technical.glb` ("Technical").
Sources: `tools/blender/vehicles/enemy_a/`. Each vehicle has one script (`sedan.py`, `muscle.py`, `buggy.py`, `technical.py`) built on the shared helpers
`veh_lib.py` (geometry: loft/prism/box/tube/bolts/decal blobs; x=left, f=forward, z=up), `veh_parts.py` (wheels),
`veh_pipeline.py` (materials, wear bake, assembly, export), `veh_decals.py` (spray-paint masks), plus `buggy_parts.py` and `muscle_parts.py`.
Rebuild: `bash tools/blender/vehicles/enemy_a/bl.sh <sedan|muscle|buggy|technical> --res 2048 --orm 1024 --samples 16` (about 1.5-2 min each, Cycles GPU bake).
Shape-only pass: add `--nobake`. QA renders: `node tools/blender/vehicles/enemy_a/qa.mjs e_sedan sheet,close,mid,far,rear34,under --tint=8a3a1e --alltint [--nodes]`.

## Conventions (ASSET_SPEC)
* Meters. Front = **+Z**, up = **+Y**, **left = +X (driver on +X)**. Origin is on the ground under the vehicle centre. Positions below are glTF (x, y, z).
* Top-level nodes: `body` (Object3D holding one mesh with several primitives), `wheel_*`, `panel_*`, sockets. Every node has unit scale.
* **Wheels**: node origin = hub centre, axle = local X, children = `<name>_tire` + `<name>_rim`. Spin `rotation.x`, steer `rotation.y`. `hub.y` equals the tyre radius (tread touches y = 0).
  Rims face outward on both sides (the right side is mirrored). Brake disc is visible behind the spokes.
* **Panels**: each `panel_*` is its own node, with its origin at the **hinge** (hood: rear edge at the windshield base; doors: front edge;
  trunk/tailgate: hinge edge; bumpers: centre). The body underneath is complete: engine bay (block, heads, radiator, hoses, battery), door-less cabin with interior,
  trunk contents, frame rails. Panel inner faces use the panel's own paint.
* **Sockets** are empties with identity rotation (+Z forward, +Y up) except `steering_wheel` (pitched so +Z runs down the column),
  `light_tail_*` / `exhaust*` / `nitro_*` (yaw 180, +Z points backwards) and `fuel_cap` (yaw +90, +Z points outward on the left flank).
* **Materials**: palette names only. `paint` and `paint2` are tintable: the albedo is near-white with grayscale wear (rust, chips, dirt, decals are dark grey),
  so setting `material.color` tints them. Everything else is fixed. Extra fixed names used: `cloth_red`, `cloth_dark`, `cloth_tan` (flags/rags), `spike`, `gun_metal`.
* **Textures**: one embedded 2048 JPEG albedo atlas + one 1024 JPEG ORM atlas per vehicle (R = AO -> `occlusionTexture`, G = roughness, B = metalness), shared by
  all textured materials. Small parts (bolts, rivets, thin wires) sample a flat per-material colour cell. `glass` (alpha 0.38, double-sided) and the emissive lights
  (`light_head`, `light_tail`, `light_amber`) are untextured. No vertex colours, no normal maps.
* Wheels on the same axle side share mesh data.

| file | tris | primitives | bbox x * y * z (m) | GLB |
|---|---|---|---|---|
| `e_sedan.glb` | 24,452 | 42 | 2.17 * 2.02 * 5.40 (flag tip 2.02 m; body 1.97 wide, roof 1.44) | 1.3 MB |
| `e_muscle.glb` | 24,758 | 39 | 2.07 * 1.62 * 5.19 (incl. ram plate; roof 1.34, flag 1.62) | 2.0 MB |
| `e_buggy.glb` | 29,060 | 35 | 2.02 * 2.55 * 3.78 (whip antennas 2.55; cage top ~1.72) | 2.2 MB |
| `e_technical.glb` | 25,668 | 42 | 2.30 * 2.39 * 5.32 (MG shield top 2.39; cab roof 1.66) | 1.8 MB |

## e_sedan "Bandit" (1980s land yacht, chopped roof)
* Wheels R 0.39: `wheel_FL/FR` (+-0.79, 0.39, 1.62), `wheel_RL/RR` (+-0.79, 0.39, -1.42).
* Panels: `panel_hood` (hinge 0, 0.99, 0.72), `panel_trunk` (hinge 0, 0.99, -1.365, has plate + licence plate), `panel_door_L/R` (front doors, hinge +-0.90, 0.65, 0.66),
  **`panel_door_L2/R2`** (rear doors, hinge +-0.90, 0.65, -0.32), `panel_bumper_F` (chrome bumper + armor push bar, 0, 0.47, 2.55), `panel_bumper_R` (0, 0.47, -2.55).
* Roof is torch-cut behind the front seats (ragged edge). Welded roll hoop at z -0.47 with braces, plus a waist-high U rail behind the rear seat for the gunner.
* Sockets: `seat_driver` (0.40, 0.56, 0.03), `steering_wheel` (0.40, 0.925, 0.46), **`seat_gunner` (0, 0.555, -0.86)** = feet on the rear-seat cushion (beltline ~0.95,
  so his torso stands clear), `light_head_L/R` (+-0.64, 0.79, 2.50), `light_tail_L/R` (+-0.56, 0.81, -2.50), `exhaust_L/R` (+-0.50, 0.27, -2.68), `smoke_engine` (0, 0.86, 1.85),
  `fuel_cap` (0.985, 0.80, -2.05), `roof_top` (0, 1.46, -0.10), `camera_hood` (0, 1.02, 1.35).
* Tint zones: `paint` = body, hood, trunk, door_R, door_L2; `paint2` = mismatched door_L and door_R2. Spray skull on the hood, tally marks on the trunk, X on the right quarter.
  Rust patches and arch lips are fixed-colour `rust` geometry, so they stay rust under any tint. Coat-hanger antenna + red rag flag at the rear-left.

## e_muscle "Rammer" (1970 fastback coupe, driver only)
* Wheels: front R 0.355 `wheel_FL/FR` (+-0.80, 0.355, 1.30), fat rear R 0.375 `wheel_RL/RR` (+-0.79, 0.375, -1.62).
* Panels: `panel_hood` (hinge 0, 0.985, 0.70; has a cut-out with welded trim, so the **blower stays with the engine** when the hood flies), `panel_trunk` (0, 0.975, -1.96, with ducktail),
  `panel_door_L/R` (+-0.92, 0.65, 0.62), `panel_bumper_F` = **the spiked wedge ram plate** (0, 0.40, 2.35), `panel_bumper_R` (0, 0.38, -2.35).
* Roots blower + bug-catcher scoop on a V8 with headers, side-exit side pipes with heat shields, full roll cage visible through the glass (door X-bars), bucket seats.
* Sockets: `seat_driver` (0.42, 0.53, -0.04), `steering_wheel` (0.42, 0.895, 0.30), `light_head_L/R` (+-0.56, 0.78, 2.30), `light_tail_L/R` (+-0.47, 0.76, -2.30),
  `exhaust_L/R` (+-0.42, 0.30, -2.50), `smoke_engine`, `fuel_cap` (0.972, 0.80, -1.95), `roof_top` (0, 1.34, -0.25), `camera_hood`. **No `seat_gunner`**.
* Tint zones: `paint` = body + doors (roof skull, door tally/X), `paint2` = hood + trunk (worn twin stripes). Intended tint: near-black (e.g. `22232a`).

## e_buggy "Skirmisher" (tube-frame dune buggy)
* Wheels: front R 0.37 W 0.26 `wheel_FL/FR` (+-0.78, 0.37, 1.20); rear **paddle** tyres R 0.46 W 0.42 on beadlock rims `wheel_RL/RR` (+-0.79, 0.46, -1.10).
* Panels (no doors on a buggy): `panel_hood` (fibreglass nose cowl, 0, 0.88, 0.86), `panel_fender_L/R` (front wings, +-0.78, 0.85, 1.20), `panel_trunk` = **rear engine cover** (0, 0.98, -1.14),
  `panel_bumper_F` (tube bumper + skid plate, 0, 0.40, 1.76), `panel_bumper_R` (0, 0.42, -1.76).
* Exposed rear flat-four with headers, twin filters and belt, visible from the rear/top. Long-travel coilovers, bucket seats with harnesses, spare wheel, fuel cell, light bar.
* Sockets: `seat_driver` (0.36, 0.50, 0.14), `steering_wheel` (0.36, 0.88, 0.60), **`seat_gunner` (0, 0.70, -0.68)** = feet on the diamond-plate platform inside the rear cage,
  **`gun_mount` (0, 1.995, -0.24)** = pivot post on the cage roof (no gun mesh), `light_head_L/R` (+-0.30, 0.72, 1.645), `light_tail_L/R` (+-0.36, 0.86, -1.72), `exhaust_L/R` (+-0.24, 0.38, -1.84),
  `nitro_L/R` (+-0.14, 0.52, -1.84), `smoke_engine` (0, 0.90, -1.36, over the rear engine), `fuel_cap` (0.36, 0.50, -0.55), `roof_top` (0, 1.72, 0.22), `camera_hood`.
* Tint zones: `paint` = fibreglass nose/wings with baked flames (flames stay light, the base goes dark, so the tint colours the flames); `paint2` = roll cage, side pods, engine cover (X/tally/skull graffiti).

## e_technical "Technical" (beat-up single-cab pickup with a pedestal HMG)
* Wheels R 0.40: `wheel_FL/FR` (+-0.79, 0.40, 1.48), `wheel_RL/RR` (+-0.79, 0.40, -1.33). Steel wheels, chunky tread.
* Panels: `panel_hood` (0, 1.06, 0.94), `panel_door_L/R` (+-0.90, 0.70, 0.86), **`panel_tailgate`** (hinge at the bottom edge 0, 0.93, -2.40; this vehicle has no `panel_trunk`),
  `panel_bumper_F` (cheap pipe bull bar + tow hook + spot lamps, 0, 0.47, 2.44), `panel_bumper_R` (0, 0.47, -2.53).
* **`gun_mount` (0, 2.14, -0.92)** = trunnion pivot. Its child **`gun_mount/gun_mg`** is the MG (receiver, finned barrel jacket, shield plates, ammo can + belt, spade grips),
  modelled facing +Z, so yaw/pitch `gun_mount` to aim. Muzzle tip is about 1.37 m ahead of the pivot. The welded pedestal is part of `body`.
* **`seat_gunner` (0, 0.944, -1.42)** = bed floor behind the mount, with a free area about 1.3 x 1.2 m, sandbag lines along the bed sides and front, and rails.
* Sockets: `seat_driver` (0.38, 0.665, -0.06), `steering_wheel` (0.38, 1.10, 0.44), `light_head_L/R` (+-0.66, 0.80, 2.26), `light_tail_L/R` (+-0.78, 0.72, -2.42),
  **`exhaust`** (single side-exit pipe, 0.62, 0.24, -2.62), `smoke_engine` (0, 0.88, 1.95), `fuel_cap` (0.935, 0.98, -2.02), `roof_top` (0, 1.98, -0.30), `camera_hood`.
* Colour-blocked: `paint` = cab, front fenders, roof, tailgate (primer patch, roof X, tailgate tally); `paint2` = hood, doors, bed sides (primer patches, bed tally + skull).
  Roof rack with drum + spot lamps, jerry cans, spare wheel, bolted plates and patches, wood planks in the bed.

## Deviations / notes
* The sedan has extra rear-door panels `panel_door_L2/R2`. The technical uses `panel_tailgate` (no `panel_trunk`) and one `exhaust` socket. The buggy has no doors, and its `panel_trunk` is the engine cover.
* Muscle length is 5.19 m including the ram plate (body 4.75 m). Buggy height 2.55 m is the whip antennas; the cage top is about 1.72 m.
* Lights are always emissive (material emission). Toggle via material if needed.
