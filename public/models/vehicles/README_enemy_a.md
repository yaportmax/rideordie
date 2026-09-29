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

TABLE_PLACEHOLDER
