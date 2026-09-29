# Enemy vehicles B — van, heavy, tanker + boss (procedural, Blender 4.5 headless)

Files in this folder: `e_van.glb`, `e_heavy.glb`, `e_tanker.glb`, `boss_warrig.glb` (the boss is **The Leviathan**, a 34 m war-train).
Sources / rebuild: `tools/blender/vehicles/enemy_b/` (`vlib.py` toolkit, `vmat.py` materials + textures, `parts.py`, `boss_parts.py`, one script per vehicle).
Rebuild one: `blender -b --factory-startup -P tools/blender/vehicles/enemy_b/<e_van|e_heavy|e_tanker|boss_warrig>.py` (about 5-20 s each).
Node/socket regression check (needs the dev server): `python tools/blender/vehicles/enemy_b/check_nodes.py`.

Conventions (ASSET_SPEC): meters, front = **+Z**, up = **+Y**, **left = +X (driver on +X)**, origin on the ground under the vehicle centre
(boss: at the middle of the train). Every model is one flat list of top-level nodes (no parent/child hierarchy), all with unit scale.
Sockets are empties with identity rotation (+Z forward, +Y up) unless a rotation is stated below.

## Common notes for the game programmer
* **Wheels**: node origin = hub centre, axle = local X, the node holds two primitives (tyre + rim). Spin `rotation.x`, steer `rotation.y`.
  All left wheels share one mesh and all right wheels another (mirrored, rims face outward on both sides). The outer tyre radius (lug tops) is exactly `R`
  (van 0.43, heavy 0.66, tanker 0.58, boss 1.35), so `hub.y == R` puts the tread on y = 0. Tyre widths 0.30 / 0.44 / 0.38 / 0.95 m.
* **Materials** (palette names): `paint`, `paint2` are tintable (near-white base, grayscale wear; tint by setting `material.color`), everything else is fixed.
  Colour detail lives in **embedded JPEG textures** (albedo + ORM + normal, world-scale UV, tileable) plus **COLOR_0 vertex colours** (baked AO / grime / dust; multiplied into the base
  colour, so keep `vertexColors` on, which GLTFLoader does by default). Lights (`light_head`, `light_tail`, `light_amber`) are emissive and not darkened by the vertex colours.
  `glass` is alpha blended and double sided. Extra fixed names used that are not in the palette list (harmless if untouched): `decal_red`, `decal_yellow`
  (hazard markings on van + tanker); `cloth_red` (van/heavy pennants).
* **Detachable pieces** are independent nodes whose *origin is the pivot* (hinge for hoods/doors/tailgates/ramp, centre for plates). The geometry underneath exists
  (engine bay under every hood, door liners + seat + dash behind doors, the reactor behind the boss' rear plates, cab interior behind glass); `body` never contains the
  panels/parts and looks complete without them.
* **Instancing**: wheels share mesh data (2 meshes per vehicle); triangle counts below include every instance.
* `body` = chassis, cab shell + interior, undercarriage (frames, axles, springs, drive shafts, exhaust, tanks), props.
* Sockets that carry a rotation: `steering_wheel` (+Z = column, pitched down toward the front), boss `rocket_pod_L/R` (+Z = tube axis), `flame_L/R` (+Z = flame direction = backwards),
  `floodlight_1..4` (4 deg down).

| file | tris | glTF meshes / mesh nodes | primitives (draw calls) | bbox incl. spikes/antennas (x, y, z) | body size | GLB |
|---|---|---|---|---|---|---|
| `e_van.glb` | 34.1k | 13 / 15 | 40 | 2.7 x 3.7 x 6.5 m | 5.6 x 2.1 x 2.4 m (3.3 m with gunner) | 3.1 MB |
| `e_heavy.glb` | 42.8k | 13 / 17 | 39 | 3.2 x 4.7 x 9.0 m | 8.4 x 2.6 x 3.15 m (cab roof) | 3.2 MB |
| `e_tanker.glb` | 56.6k | 14 / 20 | 40 | 3.1 x 4.9 x 10.2 m | 9.8 x 2.5 x 3.35 m (tank top) | 3.4 MB |
| `boss_warrig.glb` | 162k | 32 / 42 | 89 (69 unique) | 9.3 x 10.2 x 36.1 m | 34.4 (plow tip to rear ramp) x ~7.6 x 9.0 (stack tops; skull crest 10.2) | 9.8 MB |

## e_van "Boxer" (armored cargo van)
* Wheels `wheel_FL wheel_FR wheel_RL wheel_RR` (R 0.43, hubs x +-0.85, z +1.65 / -1.55).
* Panels: `panel_hood` (hinge at the cowl, 0,1.16,1.68), `panel_door_L/R` (hinge at the front edge, +-1.0,1.35,1.0), `panel_fender_L/R` (front flares), `panel_bumper_F`
  (ram grille + spikes, 0,0.7,2.8), `panel_bumper_R` (0,0.62,-2.86), `panel_tailgate` (welded rear double door, 0,1.5,-2.84), `panel_armor_L/R` (welded side plates over the cargo box).
* Roof hatch: a real 0.9 x 0.9 m opening in the roof, armored ring (coaming) around it, lid standing open at the rear edge; a crate platform inside puts his feet at y 1.5.
* Sockets: `seat_driver` (0.42,0.98,0.42), `steering_wheel` (0.42,1.31,0.86), `seat_gunner` (0,1.5,-0.95 = feet centre in the hatch; torso and head stand above the roof),
  `light_head_L/R`, `light_tail_L/R`, `exhaust_L` (low tailpipe) / `exhaust_R` (side stack top), `smoke_engine`, `camera_hood`, `roof_top`, `fuel_cap` (left flank), `nitro_L/R`.
* Roof rack: spare tyre, jerry cans, canvas roll, 4 spotlights, whip antenna with a rag flag.

## e_heavy "Hauler" (6x6 flatbed gunner platform)
* Wheels `wheel_FL/FR` (z 2.9), `wheel_ML/MR` (z -1.1), `wheel_RL/RR` (z -2.7); R 0.66, hubs x +-1.02.
* Deck top y 1.6. Gunners: `seat_gunner` (0.45,1.6,-0.12) and `seat_gunner2` (-0.45,1.6,-3.05), each in a sandbag bunker; `gun_mount` (0,2.8,-1.9 = top of the pedestal, rotate the mounted gun about Y).
* Panels: `panel_hood` (0,2.1,2.8 hinge), `panel_door_L/R` (+-1.14,2.3,2.5 hinge), `panel_fender_L/R`, `panel_bumper_F` (plow + spikes, 0,1.0,3.95), `panel_bumper_R`,
  `panel_tailgate` (armored bed gate, pivot at its bottom edge 0,1.7,-4.0), `panel_armor_L/R` (3-plate bed side armor).
* Sockets: `seat_driver`, `steering_wheel`, `light_head_L/R`, `light_tail_L/R`, `exhaust_L/R` (twin cab-back stacks), `smoke_engine`, `camera_hood`, `roof_top`, `fuel_cap`, `nitro_L/R`.

## e_tanker "Fuel Bomb"
* Wheels: `wheel_FL/FR` (z 3.5), `wheel_ML/MR` (0.1), `wheel_RL/RR` (-1.25), `wheel_RL2/RR2` (-3.2); R 0.58, hubs x +-1.02.
* The tank is part of `body`: dented aluminium shell (dents are real geometry), red band with "HIGHLY FLAMMABLE / DANGER", hazard diamonds, manways, rollover rail, rear ladder, and a fuel manifold with
  red hand-wheel valves at the rear. Tank spans z -3.9 ... +1.0, axis at y 2.28, radius about 1.1.
* Gunner platform on the cab roof: deck y 3.3, sandbags in front, rails; `seat_gunner` (0,3.35,2.02) (= `roof_top`).
* Panels: `panel_hood` (0,2.42,3.07), `panel_door_L/R` (+-1.2,2.3,2.75), `panel_fender_L/R`, `panel_bumper_F` (bull-bar), `panel_bumper_R`, `panel_armor_L/R` (cab plates),
  `panel_stack_L/R` (chrome stacks, pivot at the base +-1.28,1.4,1.28).
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
* Textures on the boss are tiled at 2.6x scale (bigger rust / chip blotches for the bigger object); baked AO uses a 3 m ray length.

## Deviations / notes
* Boss re-scoped to the 34 m Leviathan as instructed (162k tris). glTF `meshes` = 32 (<= 60), but runtime draw calls = 89 (69 unique primitives; the 12 wheels alone are 24 primitives:
  tyre + rim) because about 30 detachable panels/parts are separate nodes by design (most of them single-material to keep the count down).
* `panel_trunk` is provided as `panel_tailgate` where it makes sense (van, heavy); the tanker has no tail panel.
* Materials outside the palette: `decal_red`, `decal_yellow` (van/tanker markings). `chrome` is a textured variant (smudged, roughness varying) rather than a flat mirror.
