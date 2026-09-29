# Player trucks (truck_t1 .. truck_t4)

Built procedurally with headless Blender 4.5 (`tools/blender/vehicles/player/`). Rebuild all four:

    "C:/Dev/tools/Blender-4.5.11-portable/blender.exe" -b --factory-startup -P tools/blender/vehicles/player/build.py -- --tier all
    (--tier 3  one truck,  --fast  skip AO/texture bake,  --out models/_test/x.glb  write elsewhere)
    node tools/blender/vehicles/player/verify.mjs          # loads all four in the viewer, checks the contract nodes

The four trucks share one layout (cab forward, open bed behind, **driver on the LEFT = +X**, front = +Z, Y up, metres, origin on the ground under
the vehicle centre) and are a visible upgrade path T1 < T2 < T3 < T4.

| file | name | tris | bbox x*y*z (m, incl. mirrors/kit) | glTF mesh nodes / primitives | wheel Ø x width | wheelbase | file size |
|---|---|---|---|---|---|---|---|
| truck_t1.glb | Rustbucket | 57 850 | 2.08 x 1.78 x 4.95 (body 1.78 wide) | 17 / 61 | 0.67 x 0.185 | 2.75 | 3.2 MB |
| truck_t2.glb | Hauler | 63 650 | 2.49 x 2.55 x 5.70 (body 2.02 wide) | 17 / 59 | 0.84 x 0.265 | 3.35 | 3.5 MB |
| truck_t3.glb | Bruiser | 68 960 | 2.56 x 2.42 x 5.99 (body 2.06 wide) | 21 / 69 | 0.88 x 0.285 | 3.40 | 4.0 MB |
| truck_t4.glb | Juggernaut | 74 780 | 2.90 x 2.70 x 6.64 (body 2.30 wide, plow 2.44) | 19 / 66 | 1.00 x 0.32 | 3.60 | 4.2 MB |

Hub centres (glTF x, y, z): FL/FR = (+-track, R, front axle), RL/RR = (+-track, R, rear axle):
T1 (0.735, 0.335, +1.54 / -1.21) - T2 (0.825, 0.42, +1.80 / -1.55) - T3 (0.84, 0.44, +1.82 / -1.58) - T4 (0.94, 0.50, +2.00 / -1.60).

## Contract nodes (all four trucks, verified with `verify.mjs`)
* `body` - hull incl. chassis, axles, leaf springs, shocks, driveshaft, fuel tank, exhaust, engine bay (block, radiator, fan, hoses, battery),
  firewall, cab shell/roof/pillars/glass, dash + gauges, seats, steering column, floor, bed (floor, sides with wheel arches, headache board),
  gunner frame/cage/nest and all kit parts. Looks complete with every `panel_*` removed.
* Wheels `wheel_FL wheel_FR wheel_RL wheel_RR`: node origin = hub centre, axle = local X, geometry centred on it, rims face outward on both
  sides. Each is one glTF mesh with 2-3 primitives (tyre `rubber_tire`, `rim` incl. lug nuts/spokes/beadlock, hub+brake disc in `rubber_tire`).
  Everything in a wheel node is rotationally symmetric about X (no calipers), so `rotation.x` spinning and `rotation.y` steering both look right.
  Tyre profile has sidewall bulge, shoulder lugs and tread blocks (T1: bald with shallow grooves).
* Detachable panels (origin at hinge or centre; what is underneath exists): `panel_hood` (hinge = windshield base, underside dark, engine visible),
  `panel_door_L/R` (hinge = front edge, includes glass, frame, handle, mirror, door card), `panel_fender_L/R` (incl. arch lip, flare, side marker,
  mud flap), `panel_bumper_F`, `panel_bumper_R`, `panel_tailgate` (hinge = bottom edge, chains, latch).
  Extra: T3 `panel_armor_L/R` (door plates with window slits + mirrors), `panel_armor_windshield`, `panel_armor_roof`; T4 `panel_armor_skirt_L/R`
  (spiked). Lamps are separate small meshes: `lamp_head_L/R` (reflector + `light_head` lens), `lamp_tail_L/R` (`light_tail` + `light_amber`).
* Sockets (empties, identity rotation => +Z forward, +Y up; rotated where noted):
  `seat_driver` (hip point, +X side), `steering_wheel` (centre; +Z = column direction, tilted 25 deg down), `seat_gunner` (feet centre on the bed floor, x=0),
  `light_head_L/R` (front, facing +Z), `light_tail_L/R` (rear, rotated to face -Z), `exhaust_L/R` (tip, facing -Z; T1 has ONE pipe on the right and `exhaust_L`
  coincides with `exhaust_R`; T2 dual rear tailpipes; T3/T4 vertical stacks - socket at the stack top, +Z rotated to point backwards/up),
  `smoke_engine` (under the hood front), `fuel_cap` (left bedside, +Z points out along +X), `nitro_L/R` (under the rear bumper, +Z backwards),
  `camera_hood`, `roof_top`. T3 also `gun_mount` (gunner shield pivot); T4 `gun_mount` (roof turret pivot).
  seat_driver (x,y,z): T1 (0.37, 0.72, 0.03) - T2 (0.42, 0.82, 0.03) - T3 (0.42, 0.84, 0.03) - T4 (0.46, 0.90, 0.05).
  seat_gunner (x,y,z): T1 (0, 0.805, -1.45) - T2 (0, 0.985, -1.65) - T3 (0, 1.005, -1.675) - T4 (0, 1.065, -1.78).
* Gunner platform (free bed floor inside the waist-high frame): T1 1.70 x 1.42 (gas-pipe ring), T2 1.80 x 1.58, T3 1.82 x 1.53, T4 2.1 x 1.7 (nest).

## Materials, tinting, baked detail
* Palette names only: `paint`, `paint2` (tintable), `metal_dark metal_bare rust chrome rubber rubber_tire rim armor spike interior fabric leather wood glass
  light_head light_tail light_amber` (T4 no `wood`). `glass` is alpha-blended (0.38) + double sided. Emissive strengths 2.5-3.
* `paint`/`paint2`: baseColorFactor = white, baseColorTexture = **grayscale** wear map (0.9 fade, sun-bleach blotches, streaks, chips, scratches) -
  set `material.color` to the tint (the viewer's `tint=` does exactly this). Do not tint any other material.
  Suggested default tints: T1 paint `#7f9f9c` faded teal, paint2 (right door only) `#8a4a3a`; T2 paint `#c39a2b` mustard, paint2 `#5b6a3a` olive
  (unused by the model but reserved); T3 paint `#1b1c1e` matte black, paint2 `#f2b705` warning yellow (hazard chevrons on plates/ram/skirts/nest);
  T4 paint `#15151a` gloss graphite, paint2 `#ff6a00` flame orange (flame decals + hazard stripes).
* Every mesh has `COLOR_0` (grayscale multiply): Cycles-baked ambient occlusion + height dirt gradient + noise; wheels are baked in isolation so the AO
  does not rotate wrongly. Other materials (`metal_*`, `rust`, `armor`, `rim`, `fabric`, ...) carry their fixed colour x a shared grunge map in the
  baseColorTexture (JPEG, 1024). Textures are box-projected from world space (UV0, 1.25 m tile). No normal maps.
* Rust holes/patches, flames and hazard stripes are real thin geometry (3-8 mm proud of the panel) so the paint stays tintable.

## Per truck
**T1 Rustbucket** - 1980s compact: faded paint with rust patches/holes along edges and arches, dents, mismatched right door (`paint2`), cracked
windshield + duct tape, bent aerial, missing right mirror, skinny bald tyres on steel wheels, dangling tail pipe, welded gas-pipe ring in the bed (waist
high), jerry can, rope coil tied to a post, fuzzy dice.
**T2 Hauler** - F-250 style 3/4-ton: bull bar + winch (drum, fairlead, hook, D-rings, in `panel_bumper_F`), roll bar with LED light bar + 2 spots, tube
gunner frame with padded rails, roof rack with spare wheel, sandbags/planks/toolbox in the bed, fender flares, side step bars, dual exhaust with chrome tips.
**T3 Bruiser** - armored: door plates with window slits, windshield slit visor, roof plate (all detachable), spiked armored grille + headlamp cages, ram
bumper with tusks and hazard cap, side skirts, rebar + chain-link gunner cage with sloped shield, twin exhaust stacks, beadlock wheels.
**T4 Juggernaut** - hero: chrome supercharger through a hood cut-out (belt drive, injector stacks, scoop), spiked plow ram + hydraulics, spiked detachable
skirts, roof turret ring with arc shield (`gun_mount`), armored gunner nest (sloped side/rear plates, tall shield with gun notch, ammo boxes, nitro
bottles), dual chrome stacks per side, mud tyres on beadlock alloys, flame decals, roof light bar, nitrous nozzles.

## Notes / limits
* The lengths above are bbox lengths including bull bar/ram/plow, stacks, mirrors; the sheet-metal body of T3/T4 is ~5.5 / ~6.0 m.
* Free standing width of T1 is 1.70 m (bed interior), i.e. exactly the spec minimum.
* Mesh nodes are 17-21 per truck; each node splits into one primitive per material (59-69 total). `tools/blender/vehicles/player/build.py` (`NODE_MERGE`, `MERGE_ALL`)
  folds minor materials; more folding is possible if draw calls matter.
* Hinge pivots: hood at the cowl edge, doors at the front edge, tailgate at the bottom edge; all other panels use their centre.
