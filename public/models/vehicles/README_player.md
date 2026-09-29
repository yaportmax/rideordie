# Player trucks (truck_t1 .. truck_t4)

Built procedurally with headless Blender 4.5 (`tools/blender/vehicles/player/`). Rebuild:

    C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/blender/vehicles/player/gen_tex.py      # only if the texture inputs change (tex/*.png, deterministic)
    "C:/Dev/tools/Blender-4.5.11-portable/blender.exe" -b --factory-startup -P tools/blender/vehicles/player/build.py -- --tier all
    (--tier 3  one truck,  --fast  skip the AO bake,  --out models/_test/t3.glb  write elsewhere)
    node tools/blender/vehicles/player/verify.mjs          # loads all four in the viewer (:5180), checks the contract nodes
    bash tools/blender/vehicles/player/install.sh 1 2 3 4  # verify public/models/_test/t<N>.glb and copy it over truck_t<N>.glb
    node tools/extract_model_info.mjs                      # refresh src/data/model_info.json

QA pages/scripts (need the :5180 test server): `tools/blender/vehicles/player/ckview.html?model=/models/vehicles/truck_t2.glb&t=2&views=drv,drvL,drvR,drvU,gun,gunD,lampF,lampR&cluster=1[&night=1]`
(driver's-eye / gunner / lamp close-up views with the game's glass + chrome tweaks), `ingame.sh <tier> <driver|gunner> out.png` (real in-game shot),
`grid.py` (contact sheets).

The four trucks share one layout (cab forward, open bed behind, **driver on the LEFT = +X**, front = +Z, Y up, metres, origin on the ground under
the vehicle centre) and are a visible upgrade path T1 < T2 < T3 < T4.

| file | name | tris | bbox x*y*z (m, incl. mirrors/kit) | mesh nodes / primitives | wheel Ø x width | wheelbase | file size |
|---|---|---|---|---|---|---|---|
| truck_t1.glb | Rustbucket | 82 494 | 2.05 x 1.78 x 4.95 (body 1.78 wide) | 18 / 87 | 0.67 x 0.185 | 2.75 | 4.66 MB |
| truck_t2.glb | Hauler | 99 384 | 2.45 x 2.55 x 5.70 (body 2.02 wide) | 18 / 83 | 0.84 x 0.265 | 3.35 | 5.63 MB |
| truck_t3.glb | Bruiser | 99 646 | 2.61 x 2.42 x 5.99 (body 2.06 wide) | 22 / 100 | 0.88 x 0.285 | 3.40 | 5.86 MB |
| truck_t4.glb | Juggernaut | 104 418 | 2.90 x 2.70 x 6.64 (body 2.30 wide, plow 2.44) | 20 / 94 | 1.00 x 0.32 | 3.60 | 5.97 MB |

Hub centres (glTF x, y, z): FL/FR = (+-track, R, front axle), RL/RR = (+-track, R, rear axle):
T1 (0.735, 0.335, +1.54 / -1.21) - T2 (0.825, 0.42, +1.80 / -1.55) - T3 (0.84, 0.44, +1.82 / -1.58) - T4 (0.94, 0.50, +2.00 / -1.60).
(Unchanged by the 2026-09-29 interior pass; the bbox x changed by 2-3 cm because of the new door-mirror heads.)

## Contract nodes (all four trucks, verified with `verify.mjs`)
* `body` - hull incl. chassis, axles, leaf springs, shocks, driveshaft, fuel tank, exhaust, engine bay (block, radiator, fan, hoses, battery),
  firewall, cab shell/roof/pillars/glass, the whole cab interior (see below), bed (floor, sides with wheel arches, headache board),
  gunner frame/cage/nest and all kit parts. Looks complete with every `panel_*` removed.
* Wheels `wheel_FL wheel_FR wheel_RL wheel_RR`: node origin = hub centre, axle = local X, geometry centred on it, rims face outward on both
  sides. Each is one glTF mesh with 2-3 primitives. Everything in a wheel node is rotationally symmetric about X (no calipers).
* Detachable panels (origin at hinge or centre; what is underneath exists): `panel_hood` (hinge = windshield base), `panel_door_L/R` (hinge = front
  edge, includes glass, frame, handle, mirror, door card), `panel_fender_L/R`, `panel_bumper_F`, `panel_bumper_R`, `panel_tailgate` (hinge = bottom edge).
  Extra: T3 `panel_armor_L/R` (door plates with window slits + mirrors), `panel_armor_windshield`, `panel_armor_roof`; T4 `panel_armor_skirt_L/R`.
  Lamps are separate small meshes: `lamp_head_L/R`, `lamp_tail_L/R`.
* **`steering_wheel_mesh`** (NEW) - rim + spokes + hub/horn pad, **child of the `steering_wheel` socket with an identity local transform**; the
  geometry is centred on the socket and lies in its local XY plane, so rotating the socket (or this node) about local **Z** spins the wheel.
  The column, shroud, stalks and key stay in `body`. Rim centre-line radius 0.19 / 0.20 / 0.195 / 0.185 m (T1..T4) - the driver IK grips at 0.18.
  To keep the hands on the rim, spin by the same angle the crew IK uses (`-steer * 2.6` rad about local +Z).
* Sockets (empties, identity rotation => +Z forward, +Y up; rotated where noted):
  `seat_driver` (hip point, +X side), `steering_wheel` (centre; +Z = column direction, tilted 25 deg down), `seat_gunner` (feet centre on the bed floor, x=0),
  `light_head_L/R`, `light_tail_L/R` (rotated to face -Z), `exhaust_L/R`, `smoke_engine`, `fuel_cap` (+Z out along +X), `nitro_L/R` (+Z backwards),
  `camera_hood`, `roof_top`; T3/T4 `gun_mount`.
  NEW: **`shifter_knob`** (top of the gear-lever knob, identity rotation; T1 (0.06, 0.93, 0.36) - positions differ per tier),
  **`mirror_C`** (centre of the rear-view mirror's flat rear face, rotated so +Z points backwards; glass area 0.25 x 0.07 m),
  **`mirror_L` / `mirror_R`** (centre of the door-mirror glass, +Z backwards, **children of `panel_door_L/R`** (T3: of `panel_armor_L/R`) so they fly
  off with the door; glass T1 0.09 x 0.14, T2 0.13 x 0.23, T3 0.12 x 0.19, T4 0.14 x 0.21 m). T1 has no right mirror (missing on purpose).
  These are an optional, more robust alternative to measuring mirror housings at runtime.
  seat_driver (x,y,z): T1 (0.37, 0.72, 0.03) - T2 (0.42, 0.82, 0.03) - T3 (0.42, 0.84, 0.03) - T4 (0.46, 0.90, 0.05).
  seat_gunner (x,y,z): T1 (0, 0.805, -1.45) - T2 (0, 0.985, -1.65) - T3 (0, 1.005, -1.675) - T4 (0, 1.065, -1.78).
* Cockpit runtime (`src/view/cockpit.js`) - verified in game on all four: the windshield is still the only non-door `glass` ahead of the wheel (lamp
  lenses, spotlight lenses, light-bar covers and the dash compass use `glass_lens`), the rear-view mirror housing is a compact `rubber` cluster with a flat
  rear face 0.25 x 0.07 m (live glass lands on it), door-mirror heads face rearward with their inner edge just outside |door glass x| + 0.1 m so the
  measured housing box matches the head (T3's door armour plates sit outside that limit, so T3 still gets no live door mirrors - same as before; use
  `mirror_L/R` if you want them). The instrument binnacle is a recessed hood around the runtime gauge cluster position (steering_wheel + 0.2 * column
  + 0.075 up): opening 0.37 x 0.18 m, flat face 0.07 m behind the cluster plane (two dials + warning lamps modelled there for other views).

## Interior (the driver sees it all run)
Moulded dash (lofted crash pad with a rolled lip + lower face), recessed instrument binnacle, centre stack, vents, defroster slots, speaker grilles,
glovebox with stickers, switch knobs, column shroud with stalks + key, pedals, shifter with boot, A-pillar trims, header trim, headliner, dome light,
sun visors (stuff tucked in), rear-view mirror, grab handles, door cards (painted metal top, pleated card, armrest, crank, handle, lock, speaker),
seats (lofted cushions/backs with pleats and piping), belts. Per tier:
* **T1 Rustbucket** - tan/saddle cracked-vinyl pad (crack texture), wood-grain strip, 80s AM/FM radio + heater sliders + ashtray, 2-spoke wheel with a
  suicide knob, 8-ball shifter, bench with a torn cushion (foam), duct-taped seat and a serape blanket, ribbed sagging headliner with a torn corner,
  photo + cigarettes on the visor, red fuzzy dice, skull bobblehead, compass, cassette, road map, loose wiring, "RIDE OR DIE" windshield sun strip.
* **T2 Hauler** - charcoal dash, brushed trim, 4-spoke truck wheel, 3-gauge A-pillar pod aimed at the driver, CB radio under the dash with mic on a hook +
  coiled cord, clipboard, compass, transfer-case lever, bench with fold-down armrest, grab handles, sun strip.
* **T3 Bruiser** - olive-drab painted steel, bolted + welded armour plates over the dash, military radio box, steel 3-spoke wheel with cloth-tape wrap,
  3 levers, bucket seats, ribbed painted roof, caged dome light, shotgun in a headliner rack, ammo can + handheld radio on the dash, armour door plates
  with nuts/stiffeners inside.
* **T4 Juggernaut** - carbon-fibre dash/door cards (carbon albedo + normal), suede dash pad (anti-glare), flat-bottom dished racing wheel with drilled
  spokes, orange 12 o'clock band and contrast stitching, round vents, GPS tablet on a ball mount, NOS push button, overhead aircraft-style NOS switch
  panel with flip covers, internal roll cage with pads, racing buckets with harnesses.

## Gunner's view
Light-bar backs with cooling fins + loom, spotlight backs, rear-window guards (T2 expanded-metal mesh, T3 welded rebar), friction-taped rails, first-aid box,
diamond-plate standing pads (T3/T4), shield/nest inner faces with stiffeners, grab bars, labels and an extinguisher (T4), T3 roof-plate hatch + weld beads
+ stencils, roof markings (T1 kill tally, T4 "RIDE OR DIE"), spent brass on the bed floor, khaki `canvas` sandbags.

## Lamps
Headlamps: bucket + chrome bezel (body), chrome parabolic reflector, emissive core, dark bulb shield and a fluted `glass_lens` lens (lamp node).
Tail lamps: ribbed red brake/tail lens, clear reverse lens over chrome, ribbed amber indicator, dividers. Spotlights: emissive core, lens, stone-guard
cross. Light bars: chrome cups, LED dots, dividers, glass cover. All emissive parts use `light_head` / `light_tail` / `light_amber` as before.

## Materials, textures
* Palette names only, plus: `decal` (sticker/label/gauge-face atlas `tex/decal_atlas.png`, also solid colour swatches for wires, buttons, dice, the
  serape...), `glass_lens` (palette name, lamp lenses), `canvas`, `brass` (no longer folded into fabric / metal_dark).
* `paint`/`paint2`: baseColorFactor = white, baseColorTexture = grayscale wear map - set `material.color` to tint (unchanged).
  Suggested tints: T1 `#7f9f9c` / `#8a4a3a`, T2 `#c39a2b` / `#5b6a3a`, T3 `#1b1c1e` / `#f2b705`, T4 `#15151a` / `#ff6a00`.
* NEW: tangent-space **normal maps** on the metals, paint, rust, armour, interior plastics, vinyl/leather, cloth, rubber and wood (tileable detail maps from
  `tex/`, JPEG, 512 px; they tile faster than the albedo through **KHR_texture_transform** on the normalTexture - one UV set only). T4's `interior` is carbon
  (albedo + normal share UV0). Cab materials carry **KHR_materials_specular** (low specular) - vertex AO cannot occlude three.js environment reflections,
  and full specular made dark dashes mirror the blue sky at grazing angles.
* Every mesh has `COLOR_0`: Cycles-baked AO + height dirt; inside the cab a softer AO curve plus convex-edge wear / top-face dust (cab albedos are stored
  1/0.8 brighter so edges can go lighter than the base).

## Notes / limits
* The lengths above are bbox lengths including bull bar/ram/plow, stacks, mirrors; the sheet-metal body of T3/T4 is ~5.5 / ~6.0 m.
* Tri counts grew from 58-75k to 82-104k for the full interior (one player truck on screen; wheels 3-3.5k each).
* Hinge pivots: hood at the cowl edge, doors at the front edge, tailgate at the bottom edge; all other panels use their centre.
