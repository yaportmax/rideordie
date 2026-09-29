# Structures (public/models/structures)

Modular environment structures for RIDE OR DIE. Built with headless Blender (`tools/blender/structures/*.py`, library `slib.py`),
exported as GLB. `manifest.json` lists every file (tris, dimensions, materials, nodes, sockets, notes). QA contact sheets: `shots/structures/`.

## Conventions (contract)
* Units metres. glTF / Three.js axes: **+Y up, road runs along +Z**. +X = left of the driver (driver looks along +Z).
* **Road-aligned pieces**: origin = road centre at the piece START (z=0), piece extends toward +Z. Road surface is y=0 at the
  centre line; road width 14 m (x -7..+7) unless stated. Chain pieces by translating `z += length`.
* **Buildings / freestanding**: origin = base centre, y=0 ground, model FRONT (entrance / street side) faces +Z; the game rotates yaw
  to face the road. Freestanding pieces have no road assumption.
* Node `road_surface` (material `asphalt`): the drivable top of decks / ramps / tunnel floors. Game swaps its own asphalt material and
  builds collision from it. UVs are box-projected metres*0.25 (1 uv unit = 4 m), so a tiling texture works directly.
* Node `collision`: low-poly invisible helper (boxes / convex hulls: walls, pillars, rails, embankments; NOT the drivable surface).
  Its material is `collision` with alpha 0 (glTF `alphaMode: MASK`, never visible) and the node carries extras `{"role":"collision"}`.
  The game should read it as static collision and set `visible = false` (it still casts a shadow if left visible).
* Sockets are empties (Object3D nodes, +Z forward, +Y up): `pier`, `deck_socket`, `lamp_*`, `flood_*`, `banner_*`, `gap_center`, ... - see per piece.
* Meshes are merged per material (one mesh node per material name, plus `road_surface`, `collision`) -> few draw calls, instancing friendly.
* Materials by name (game may swap textures by name): `concrete`, `concrete_dark`, `rebar`, `metal_dark`, `metal_bare`, `rust`, `steel_beam`,
  `asphalt`, `glass` (alpha 0.36), `brick`, `paint` / `paint2` (tintable faded neutral base; where a piece is painted a colour - bridge_arch truss, road_gate sign, wrecks - the hue is baked into vertex colours, so `material.color` multiplies with it),
  `hazard` (yellow/black stripes baked into vertex colours), `wood`, `canvas` (double sided), `rubber`, `spike`, `bone`, `rock_red`, `rock_grey`,
  `sand`, `dirt_red`, `water_dark`, emissive `light_amber`, `light_head`, `light_tail`, `light_green`, `light_boost` (emission strength 2.6-3.5, wants bloom).
* Wear: every mesh carries COLOR_0 (linear) baked from ambient occlusion (ray cast), ground dirt, rain streaks, dust on top faces, underside grime,
  strata (rock). It multiplies the material base colour: if you swap a texture in, keep `vertexColors = true` to keep the grime, or disable it for a clean look.
* Bevels / smooth-by-angle normals are baked in geometry. Triangle budgets: big pieces <= 10k, buildings <= 6k.

## Placement cheat-sheet
* **Bridge**: put `bridge_span_20m` (or `_damaged`) every 20 m along +Z at road height (y=0). Under each joint place `bridge_pier` at x=0 with its
  origin at `y = -1.92 - 12 = -13.92` (its `deck_socket` top at y=12 meets the span socket `pier` at y=-1.92) - or sink the footing into terrain and align the socket.
  `bridge_arch` is a single 40 m span (deck underside y=-1.4, arch crown y=17.6, bracing >= 7.5 m).
* **Tunnel**: `tunnel_portal_rock` (tube z 0..12, face at z=0 looking -Z) + N x `tunnel_mid_10m` at z = 12 + 10k + `tunnel_exit` at z = 12 + 10N (its tube z 0..12, face at z=12 looking +Z).
  Rib spacing (2.5 m) is continuous across the joints. `_grey` variants swap rock_red for rock_grey; `_concrete` variants are the modern concrete portals. Bury the rock mass in a hill; interiors are lit by `light_amber` strips.
* **Overpass**: crosses the road at 90 deg; origin at road centre on the near edge of the deck (deck spans z 0..12, x -20..20, clearance 6.5 m).
* **Jump ramps**: drive +Z, lip socket at the top edge; `speed_boost_pad` is a 14 x 4 m trigger strip (`trigger` socket).
* **roadblock_wreck_line**: gap x in [0.4, 4.8] (socket `gap_center`); mirror with scale.x=-1 for the other side.
* **Dam** (boss arena): see `dam_wall_backdrop` / `dam_road_10m` notes (crest road at y=80, yaw +90 modules); `dam_gate_big`, `spike_wall` (x=+-3.5 to block), `spike_gate`, `boss_arena_lights` (4 towers at (+-20, +-30)).
* **Buildings / rocks / coast / canyon**: origin at base centre, front faces +Z; rotate yaw to face the road. `natural_arch` is road-aligned (legs at x=+-15).

## Known limitations
* No image textures are embedded (colour via material + baked COLOR_0, UV boxes ready for tiling textures by material name); concrete/rock read a bit clean and faceted in the QA viewer.
* `collision` meshes are unlit-invisible via alpha 0 but still cast shadows in the stock viewer.html; hide them in game (`extras.role === 'collision'`).
* Tri counts: `bridge_arch` 10.0k and `dam_gate_big` 9.6k sit at the top of the budget.
* Lighting: albedos are kept mid-value (global x0.72) because the viewer/game sun clips light materials to white.


## Road-aligned pieces (origin = road centre at piece start z=0, extend toward +Z, road surface y=0)

| id | tris | size (x, y, z m) | file KB | materials |
|---|---|---|---|---|
| `jump_ramp` | 6574 | 14.9 x 3.7 x 12.8 | 583 | asphalt, concrete, concrete_dark, hazard, light_amber, metal_bare, metal_dark, rebar, steel_beam |
| `jump_ramp_small` | 3934 | 6.5 x 2.7 x 8.3 | 356 | asphalt, concrete, concrete_dark, hazard, light_amber, metal_bare, metal_dark, rebar, steel_beam |
| `speed_boost_pad` | 2656 | 14.0 x 0.1 x 4.0 | 224 | light_boost, metal_bare, metal_dark |
| `bridge_span_20m` | 7612 | 16.0 x 10.8 x 20.0 | 663 | asphalt, concrete, concrete_dark, light_amber, metal_bare, metal_dark, steel_beam |
| `bridge_span_20m_damaged` | 8124 | 16.3 x 10.8 x 20.0 | 709 | asphalt, concrete, concrete_dark, light_amber, metal_bare, metal_dark, rebar, steel_beam |
| `bridge_pier` | 1644 | 16.8 x 12.4 x 4.8 | 144 | concrete, concrete_dark, metal_dark, rebar, rubber |
| `bridge_arch` | 10044 | 18.6 x 22.3 x 43.2 | 878 | asphalt, concrete, concrete_dark, light_amber, light_head, light_tail, metal_bare, metal_dark, paint |
| `overpass_concrete` | 9116 | 40.0 x 9.9 x 12.8 | 758 | asphalt, concrete, concrete_dark, light_head, metal_dark, rebar, rubber |
| `tunnel_portal_rock` | 5781 | 68.0 x 27.7 x 24.5 | 508 | asphalt, concrete, concrete_dark, light_amber, light_green, light_head, light_tail, metal_bare, metal_dark, rock_red, rust |
| `tunnel_mid_10m` | 2780 | 16.2 x 8.7 x 10.0 | 240 | asphalt, concrete, concrete_dark, light_amber, light_green, light_tail, metal_bare, metal_dark, rust |
| `tunnel_exit` | 5529 | 68.0 x 27.9 x 24.6 | 489 | asphalt, concrete, concrete_dark, light_amber, light_green, light_head, light_tail, metal_bare, metal_dark, rock_red, rust |
| `tunnel_portal_concrete` | 5868 | 41.7 x 14.3 x 27.4 | 506 | asphalt, concrete, concrete_dark, hazard, light_amber, light_green, light_head, light_tail, metal_bare, metal_dark, paint2, rebar, rust |
| `tunnel_exit_concrete` | 5584 | 41.7 x 14.3 x 27.4 | 484 | asphalt, concrete, concrete_dark, hazard, light_amber, light_green, light_head, light_tail, metal_bare, metal_dark, paint2, rebar, rust |
| `tunnel_portal_rock_grey` | 5773 | 68.0 x 26.8 x 23.7 | 507 | asphalt, concrete, concrete_dark, light_amber, light_green, light_head, light_tail, metal_bare, metal_dark, rock_grey, rust |
| `tunnel_exit_grey` | 5513 | 68.0 x 28.9 x 24.5 | 488 | asphalt, concrete, concrete_dark, light_amber, light_green, light_head, light_tail, metal_bare, metal_dark, rock_grey, rust |
| `road_gate` | 9300 | 20.8 x 16.4 x 9.2 | 796 | bone, canvas, concrete, concrete_dark, hazard, light_amber, light_head, metal_dark, paint, paint2, rubber, spike, steel_beam |
| `toll_booth_ruined` | 6612 | 18.2 x 6.7 x 12.0 | 596 | concrete, concrete_dark, glass, hazard, light_green, light_tail, metal_dark, paint, paint2, rebar, steel_beam |
| `roadblock_wreck_line` | 5318 | 16.4 x 5.4 x 9.5 | 447 | canvas, concrete, hazard, metal_dark, paint, rubber, rust, spike |

### `jump_ramp`
Kicker ramp spanning the road. Drive +Z. Surface curve y = H*(z/L)^1.45 (flush at z=0, lip at z=L).
* lip_height: 2.2
* length: 12.0
* width: 14.0
* launch_angle_deg: 14.9
* bbox min [-7.45, -0.35, -0.0] max [7.45, 3.36, 12.85]; 6574 tris (+36 collision tris)
* sockets: `lip` [0, 2.2, 12.0]
* nodes: `concrete`, `concrete_dark`, `hazard`, `light_amber`, `metal_bare`, `metal_dark`, `rebar`, `road_surface`, `steel_beam`, `collision`

### `jump_ramp_small`
Kicker ramp spanning the road. Drive +Z. Surface curve y = H*(z/L)^1.35 (flush at z=0, lip at z=L).
* lip_height: 1.15
* length: 7.5
* width: 5.6
* launch_angle_deg: 11.7
* bbox min [-3.25, -0.35, -0.0] max [3.25, 2.31, 8.35]; 3934 tris (+36 collision tris)
* sockets: `lip` [0, 1.15, 7.5]
* nodes: `concrete`, `concrete_dark`, `hazard`, `light_amber`, `metal_bare`, `metal_dark`, `rebar`, `road_surface`, `steel_beam`, `collision`

### `speed_boost_pad`
Flat boost pad 14 x 4 m, drive-over (trigger volume = bbox). Emissive chevrons point +Z (light_boost, cyan).
* trigger_size: [14, 0.3, 4]
* bbox min [-7.0, -0.02, -0.0] max [7.0, 0.08, 4.0]; 2656 tris (+12 collision tris)
* sockets: `trigger` [0, 0.06, 2.0]
* nodes: `light_boost`, `metal_bare`, `metal_dark`, `collision`

### `bridge_span_20m`
Steel plate-girder + concrete deck bridge span, road along +Z from z=0 to z=20. Chain spans end to end.
* road_width: 14
* deck_underside_y: -1.92
* deck_width: 15.9
* pier_sockets: pier at z=0 (start joint), pier_end at z=20
* lamps: lamp_0 (+X side, z=5), lamp_1 (-X side, z=15) sockets at the light heads
* bbox min [-8.0, -1.92, 0.0] max [8.0, 8.92, 20.0]; 7612 tris (+60 collision tris)
* sockets: `lamp_0` [4.97, 8.63, 5.0], `lamp_1` [-4.97, 8.63, 15.0], `pier` [0, -1.92, 0], `pier_end` [0, -1.92, 20.0]
* nodes: `concrete`, `concrete_dark`, `light_amber`, `metal_bare`, `metal_dark`, `road_surface`, `steel_beam`, `collision`

### `bridge_span_20m_damaged`
Steel plate-girder + concrete deck bridge span, road along +Z from z=0 to z=20. Chain spans end to end. DAMAGED variant: parapet panel missing on the +X side at z 5-10 with hanging rails/rebar and debris on the deck.
* road_width: 14
* deck_underside_y: -1.92
* deck_width: 15.9
* pier_sockets: pier at z=0 (start joint), pier_end at z=20
* lamps: lamp_0 (+X side, z=5), lamp_1 (-X side, z=15) sockets at the light heads
* bbox min [-8.0, -1.92, 0.0] max [8.26, 8.92, 20.0]; 8124 tris (+60 collision tris)
* sockets: `lamp_0` [4.97, 8.63, 5.0], `lamp_1` [-4.97, 8.63, 15.0], `pier` [0, -1.92, 0], `pier_end` [0, -1.92, 20.0]
* nodes: `concrete`, `concrete_dark`, `light_amber`, `metal_bare`, `metal_dark`, `rebar`, `road_surface`, `steel_beam`, `collision`

### `bridge_pier`
Hammerhead concrete pier, origin = base centre (y=0 at footing bottom). Top of bearing pads at y=12 = deck underside: align `deck_socket` to the deck underside (bridge_span_20m socket `pier`). Sink the footing into terrain as needed.
* height: 12.0
* cap_width: 16.8
* footing: [6.8, 1.4, 4.8]
* repeat: place one at each span joint (every 20 m) under x=0
* bbox min [-8.4, 0.0, -2.4] max [8.4, 12.42, 2.4]; 1644 tris (+36 collision tris)
* sockets: `deck_socket` [0, 12.0, 0]
* nodes: `concrete`, `concrete_dark`, `metal_dark`, `rebar`, `rubber`, `collision`

### `bridge_arch`
Steel through-arch bridge, 40 m, road along +Z (z=0..40). Twin truss arch ribs at x=+-8.3, crown y=17.6 at z=20, bracing above y=7.5 (clear of vehicles).
* clearance_under_bracing: 7.5
* deck_underside_y: -1.3
* beacon: light_tail red beacons on the crown; crown socket `arch_crown`
* bbox min [-9.3, -3.2, -1.6] max [9.3, 19.1, 41.6]; 10044 tris (+468 collision tris)
* sockets: `arch_crown` [0, 17.6, 20]
* nodes: `concrete`, `concrete_dark`, `light_amber`, `light_head`, `light_tail`, `metal_bare`, `metal_dark`, `paint`, `road_surface`, `collision`

### `overpass_concrete`
Concrete highway overpass crossing OVER the road at 90 deg. Deck runs along X (x -20..20), spans z 0..12; the road (x -7..7) passes underneath along +Z. Clearance 6.5 m under girders. Pier bents beside the road at x=+-9.6; end spans sit on sloped embankment abutments (x +-10.5..20). Deck top road surface at y=8.0 (node road_surface).
* clearance: 6.5
* deck_top_y: 8.0
* deck_size: [40.0, 12.0]
* damage: one parapet section collapsed at +X/+Z corner with hanging rebar
* bbox min [-20.0, -0.5, 0.0] max [20.0, 9.38, 12.81]; 9116 tris (+168 collision tris)
* sockets: `deck_top` [0, 8.0, 6.0]
* nodes: `concrete`, `concrete_dark`, `light_head`, `metal_dark`, `rebar`, `road_surface`, `rubber`, `collision`

### `tunnel_portal_rock`
Rock tunnel portal in a hillside: rock mass with arched opening, concrete portal ring, 12 m of tube. Entrance: face at z=0 facing -Z, tube z 0..12, rock mass extends to z=17 behind. Rock is `rock_red` (swap material to rock_grey for pine mountains).
* opening: [14.8, 7.4]
* rock_height: 24
* bbox min [-34.0, -2.5, -7.51] max [34.0, 25.19, 17.0]; 5781 tris (+192 collision tris)
* sockets: `entrance` [0, 0, 0], `tube_end` [0, 0, 12]
* nodes: `concrete`, `concrete_dark`, `light_amber`, `light_green`, `light_head`, `light_tail`, `metal_bare`, `metal_dark`, `road_surface`, `rock_red`, `rust`, `collision`

### `tunnel_mid_10m`
Repeatable 10 m tunnel tube segment (z 0..10). Interior half-width 7.4 (14.8 m), walls to y=3.8, crown y=7.4. Ribs every 2.5 m (phase 1.5 + 2.5k) so it chains seamlessly with portals (12 m tube) and itself. Floor = road_surface (x -7..7). Interior only: bury it in terrain.
* length: 10.0
* interior_half_width: 7.4
* crown: 7.4
* lights: light_amber strips at crown x=+-2.7 (some dark), jet fans, cable trays
* bbox min [-8.1, -0.6, 0.0] max [8.1, 8.1, 10.0]; 2780 tris (+192 collision tris)
* sockets: `end` [0, 0, 10]
* nodes: `concrete`, `concrete_dark`, `light_amber`, `light_green`, `light_tail`, `metal_bare`, `metal_dark`, `road_surface`, `rust`, `collision`

### `tunnel_exit`
Rock tunnel EXIT: tube z 0..12 then the portal face at z=12 facing +Z (leaving the tunnel). Chains after tunnel_mid_10m. Rock mass extends back over the tube (to z=-5).
* opening: [14.8, 7.4]
* rock_height: 24
* bbox min [-34.0, -2.5, -5.0] max [34.0, 25.43, 19.57]; 5529 tris (+192 collision tris)
* sockets: `exit` [0, 0, 12], `tube_start` [0, 0, 0]
* nodes: `concrete`, `concrete_dark`, `light_amber`, `light_green`, `light_head`, `light_tail`, `metal_bare`, `metal_dark`, `road_surface`, `rock_red`, `rust`, `collision`

### `tunnel_portal_concrete`
Concrete tunnel portal: headwall at z=0 facing -Z, 12 m of tube (z 0..12), splayed wing walls. Headwall 27 m wide, 11.5 m high + cornice. Opening 14.8 m wide, crown 7.4 m. Meant to be embedded in a hillside.
* opening: [14.8, 7.4]
* bbox min [-20.85, -0.6, -15.45] max [20.85, 13.72, 12.0]; 5868 tris (+228 collision tris)
* sockets: `entrance` [0, 0, 0], `tube_end` [0, 0, 12]
* nodes: `concrete`, `concrete_dark`, `hazard`, `light_amber`, `light_green`, `light_head`, `light_tail`, `metal_bare`, `metal_dark`, `paint2`, `rebar`, `road_surface`, `rust`, `collision`

### `tunnel_exit_concrete`
Concrete tunnel EXIT: tube z 0..12 then portal face at z=12 facing +Z. Chains after tunnel_mid_10m.
* opening: [14.8, 7.4]
* bbox min [-20.85, -0.6, 0.0] max [20.85, 13.72, 27.45]; 5584 tris (+228 collision tris)
* sockets: `exit` [0, 0, 12], `tube_start` [0, 0, 0]
* nodes: `concrete`, `concrete_dark`, `hazard`, `light_amber`, `light_green`, `light_head`, `light_tail`, `metal_bare`, `metal_dark`, `paint2`, `rebar`, `road_surface`, `rust`, `collision`

### `tunnel_portal_rock_grey`
Grey-rock variant of tunnel_portal_rock (pine mountains): face at z=0 facing -Z, 12 m of tube.
* opening: [14.8, 7.4]
* rock_height: 24
* bbox min [-34.0, -2.5, -6.72] max [34.0, 24.32, 17.0]; 5773 tris (+192 collision tris)
* sockets: `entrance` [0, 0, 0], `tube_end` [0, 0, 12]
* nodes: `concrete`, `concrete_dark`, `light_amber`, `light_green`, `light_head`, `light_tail`, `metal_bare`, `metal_dark`, `road_surface`, `rock_grey`, `rust`, `collision`

### `tunnel_exit_grey`
Grey-rock variant of tunnel_exit (pine mountains): tube z 0..12 then the portal face at z=12 facing +Z.
* opening: [14.8, 7.4]
* rock_height: 24
* bbox min [-34.0, -2.5, -5.0] max [34.0, 26.4, 19.49]; 5513 tris (+192 collision tris)
* sockets: `exit` [0, 0, 12], `tube_start` [0, 0, 0]
* nodes: `concrete`, `concrete_dark`, `light_amber`, `light_green`, `light_head`, `light_tail`, `metal_bare`, `metal_dark`, `road_surface`, `rock_grey`, `rust`, `collision`

### `road_gate`
Raider checkpoint arch across the road (origin road centre, depth ~3.4 m along z). Lattice towers at x=+-8.6, truss gantry at y 8.0-9.6 (clear height 8.0 m), big sign board on top, banner poles, floodlights, raised boom barriers. Road (x -7..7) is fully clear.
* clear_height: 8.0
* banner_sockets: banner_L, banner_R
* light_sockets: flood_0..3
* bbox min [-10.42, 0.0, -4.6] max [10.42, 16.4, 4.6]; 9300 tris (+120 collision tris)
* sockets: `banner_R` [-8.6, 13.8, -1.6], `banner_L` [8.6, 13.8, -1.6], `flood_0` [-6.5, 12.4, -1.15], `flood_1` [-2.2, 12.4, -1.15], `flood_2` [2.2, 12.4, -1.15], `flood_3` [6.5, 12.4, -1.15]
* nodes: `bone`, `canvas`, `concrete`, `concrete_dark`, `hazard`, `light_amber`, `light_head`, `metal_dark`, `paint`, `paint2`, `rubber`, `spike`, `steel_beam`, `collision`

### `toll_booth_ruined`
Ruined toll plaza: canopy over the road (z 1..13, clear height 5.1 m), two islands with booths at x=+-3.3; -X outer lane and the centre lane are open, +X outer lane is blocked by the collapsed canopy corner. Origin = road centre at the start of the piece.
* open_lanes: centre x -2.4..2.4 (4.8 m) and -X lane x -7..-4.1
* blocked_lane: +X lane x 4.1..7 under the collapsed canopy
* clear_height: 5.1
* bbox min [-9.0, -0.11, 0.99] max [9.24, 6.6, 13.0]; 6612 tris (+156 collision tris)
* nodes: `concrete`, `concrete_dark`, `glass`, `hazard`, `light_green`, `light_tail`, `metal_dark`, `paint`, `paint2`, `rebar`, `steel_beam`, `collision`

### `roadblock_wreck_line`
Raider roadblock: a line of wrecked cars, jersey barriers, sandbags, tyres and drums across the road (x -7..7, depth ~8 m, z 0..8) with a gap. The gap is x in [0.4, 4.8] (4.4 m wide, centre x=2.6); mirror with scale.x=-1 for a gap on the other side (or rotate 180 deg about Y). Socket `gap_center`.
* gap: [0.4, 4.8]
* gap_center: [2.6, 0, 4]
* bbox min [-8.12, -1.77, -0.31] max [8.33, 3.65, 9.22]; 5318 tris (+228 collision tris)
* sockets: `gap_center` [2.6, 0.0, 4.0]
* nodes: `canvas`, `concrete`, `hazard`, `metal_dark`, `paint`, `rubber`, `rust`, `spike`, `collision`


## Ruined city buildings (stand beside the road; origin = base centre; front faces +Z)

| id | tris | size (x, y, z m) | file KB | materials |
|---|---|---|---|---|
| `ruin_office_a` | 5799 | 34.4 x 55.9 x 29.9 | 509 | brick, canvas, concrete, concrete_dark, glass, metal_bare, metal_dark, rebar, wood |
| `ruin_office_b` | 5367 | 43.5 x 65.3 x 42.5 | 470 | brick, canvas, concrete, concrete_dark, glass, metal_bare, metal_dark, rebar, steel_beam, wood |
| `ruin_office_c` | 5965 | 45.8 x 60.6 x 25.2 | 519 | brick, canvas, concrete, concrete_dark, glass, metal_bare, metal_dark, rebar, wood |
| `ruin_apartment_a` | 5569 | 42.2 x 28.8 x 23.5 | 484 | brick, canvas, concrete, concrete_dark, glass, metal_bare, metal_dark, rebar, wood |
| `ruin_apartment_b` | 4418 | 29.9 x 24.8 x 36.7 | 388 | brick, canvas, concrete, concrete_dark, glass, metal_bare, metal_dark, rebar, wood |
| `ruin_lowrise_a` | 1613 | 22.1 x 15.6 x 18.2 | 147 | brick, canvas, concrete, concrete_dark, glass, metal_bare, metal_dark, paint, rebar, wood |
| `ruin_lowrise_b` | 1843 | 41.1 x 12.3 x 20.0 | 169 | brick, concrete, concrete_dark, glass, metal_bare, metal_dark, paint, paint2, rebar, wood |
| `ruin_lowrise_c` | 2053 | 28.6 x 12.3 x 28.2 | 182 | brick, canvas, concrete, concrete_dark, glass, metal_bare, metal_dark, rebar |

### `ruin_office_a`
Ruined 14-floor concrete office tower, big corner bite at the top, blast hole in the front facade. Front faces +Z; origin base centre.
* height: 50.4
* footprint: [30.0, 20.0]
* front: +Z
* lean_deg: 3.2
* bbox min [-15.15, -0.36, -10.35] max [19.25, 55.5, 19.56]; 5799 tris (+228 collision tris)
* nodes: `brick`, `canvas`, `concrete`, `concrete_dark`, `glass`, `metal_bare`, `metal_dark`, `rebar`, `wood`, `collision`

### `ruin_office_b`
Ruined 3-storey podium + 13-storey dark steel/glass tower with a slanted collapsed crown and a gaping wound; leaning slightly. Front +Z, origin base centre.
* height: 61.3
* footprint: [40, 28]
* front: +Z
* lean_deg: -2.0
* bbox min [-20.79, -0.4, -14.2] max [22.76, 64.9, 28.29]; 5367 tris (+156 collision tris)
* nodes: `brick`, `canvas`, `concrete`, `concrete_dark`, `glass`, `metal_bare`, `metal_dark`, `rebar`, `steel_beam`, `wood`, `collision`

### `ruin_office_c`
Ruined slim 16-floor tower with heavy concrete fins + a long 9-floor wing; both broken, whole complex leans hard. Front +Z, origin base centre.
* height: 56.0
* footprint: [41, 14]
* front: +Z
* lean_deg: 4.5
* bbox min [-24.65, -0.56, -7.65] max [21.16, 60.0, 17.6]; 5965 tris (+156 collision tris)
* nodes: `brick`, `canvas`, `concrete`, `concrete_dark`, `glass`, `metal_bare`, `metal_dark`, `rebar`, `wood`, `collision`

### `ruin_apartment_a`
Ruined 8-floor brick apartment slab with balconies, stair tower at the -X end, collapsed +X end and a blast hole. Front +Z, origin base centre.
* height: 24.0
* footprint: [37, 13]
* front: +Z
* lean_deg: 1.2
* bbox min [-20.8, -0.4, -7.7] max [21.36, 28.4, 15.77]; 5569 tris (+168 collision tris)
* nodes: `brick`, `canvas`, `concrete`, `concrete_dark`, `glass`, `metal_bare`, `metal_dark`, `rebar`, `wood`, `collision`

### `ruin_apartment_b`
Ruined 7-floor concrete apartment complex, L-plan (long block + front wing) with access galleries, collapsed slanted roof-lines. Front +Z, origin base centre.
* height: 21.7
* footprint: [24, 27.5]
* front: +Z
* lean_deg: 1.5
* bbox min [-16.73, -0.26, -6.05] max [13.21, 24.5, 30.61]; 4418 tris (+156 collision tris)
* nodes: `brick`, `canvas`, `concrete`, `concrete_dark`, `glass`, `metal_bare`, `metal_dark`, `rebar`, `wood`, `collision`

### `ruin_lowrise_a`
Ruined 3-floor corner shop: storefront with torn striped awning, blank sign panel, roof billboard, collapsed +X roof corner. Front +Z, origin base centre.
* height: 10.8
* footprint: [17, 13]
* front: +Z
* lean_deg: 0.0
* bbox min [-9.15, -0.27, -7.05] max [13.01, 15.36, 11.15]; 1613 tris (+36 collision tris)
* nodes: `brick`, `canvas`, `concrete`, `concrete_dark`, `glass`, `metal_bare`, `metal_dark`, `paint`, `rebar`, `wood`, `collision`

### `ruin_lowrise_b`
Ruined 2-floor strip mall with colonnade canopy, pylon sign, one end collapsed to rubble. Front +Z, origin base centre. Pylon sign stands at x=20 (outside the 32 m body).
* height: 8.4
* footprint: [32, 10]
* front: +Z
* bbox min [-20.74, -0.37, -5.54] max [20.4, 11.9, 14.49]; 1843 tris (+84 collision tris)
* nodes: `brick`, `concrete`, `concrete_dark`, `glass`, `metal_bare`, `metal_dark`, `paint`, `paint2`, `rebar`, `wood`, `collision`

### `ruin_lowrise_c`
Ruined 3-floor brick block with a round corner turret (jagged broken top) at the front-right corner and a slanted collapsed roof. Front +Z, origin base centre.
* height: 11.1
* footprint: [16, 14]
* front: +Z
* bbox min [-13.93, -0.32, -12.53] max [14.65, 12.0, 15.72]; 2053 tris (+48 collision tris)
* nodes: `brick`, `canvas`, `concrete`, `concrete_dark`, `glass`, `metal_bare`, `metal_dark`, `rebar`, `collision`


## Roadside / outpost / industrial (origin = base centre; front faces +Z)

| id | tris | size (x, y, z m) | file KB | materials |
|---|---|---|---|---|
| `warehouse` | 4928 | 37.0 x 8.6 x 27.0 | 426 | asphalt, concrete, concrete_dark, glass, light_head, metal_bare, metal_dark, paint, paint2, rubber, rust, sand, steel_beam, wood |
| `gas_station` | 5868 | 26.4 x 10.2 x 22.0 | 505 | asphalt, concrete, concrete_dark, glass, light_amber, light_head, metal_bare, metal_dark, paint, paint2, rebar, rubber, rust, steel_beam, wood |
| `diner` | 4255 | 26.0 x 11.3 x 19.0 | 366 | asphalt, concrete, concrete_dark, glass, light_amber, light_boost, light_tail, metal_bare, metal_dark, paint, paint2, rubber, rust, sand, steel_beam, wood |
| `motel` | 5834 | 32.0 x 11.4 x 26.2 | 505 | asphalt, concrete, concrete_dark, glass, light_green, light_tail, metal_bare, metal_dark, paint, paint2, rebar, rubber, sand, water_dark, wood |
| `water_tower` | 5866 | 14.1 x 30.2 x 14.1 | 510 | concrete_dark, light_tail, metal_dark, paint, rebar, rubber, rust, steel_beam |
| `silo_group` | 5702 | 48.0 x 45.6 x 31.0 | 495 | concrete, concrete_dark, metal_bare, metal_dark, paint2, rebar, rust, steel_beam |
| `shipping_container` | 1488 | 2.5 x 2.6 x 6.1 | 132 | metal_bare, metal_dark, paint, paint2, rust, wood |
| `shipping_container_stack3` | 4040 | 5.2 x 7.9 x 8.4 | 345 | metal_bare, metal_dark, paint, paint2, rubber, rust, wood |
| `radio_tower` | 7004 | 9.0 x 63.7 x 13.8 | 594 | concrete_dark, light_tail, metal_bare, metal_dark, paint, rust, steel_beam |
| `wind_turbine` | 3178 | 44.2 x 95.1 x 13.9 | 271 | concrete_dark, light_tail, metal_bare, metal_dark, paint, steel_beam |
| `crane` | 3312 | 38.0 x 41.8 x 41.0 | 290 | concrete_dark, glass, light_head, light_tail, metal_bare, metal_dark, paint, paint2, rust, steel_beam |
| `shanty_hut` | 2488 | 8.7 x 4.6 x 7.2 | 216 | bone, canvas, metal_bare, metal_dark, paint, rubber, rust, wood |
| `raider_camp_tent` | 3070 | 19.4 x 6.3 x 17.0 | 271 | bone, canvas, concrete_dark, dirt_red, light_amber, metal_bare, metal_dark, rock_grey, rubber, rust, spike, wood |
| `watchtower` | 3780 | 10.1 x 15.6 x 8.3 | 335 | bone, canvas, concrete_dark, light_head, metal_bare, metal_dark, rubber, rust, sand, spike, wood |
| `oil_derrick` | 4518 | 43.0 x 24.2 x 25.0 | 384 | concrete_dark, dirt_red, light_tail, metal_bare, metal_dark, paint, paint2, rubber, rust, steel_beam |
| `industrial_tanks` | 6772 | 51.6 x 17.4 x 31.1 | 581 | concrete, concrete_dark, metal_bare, metal_dark, paint, paint2, rebar, rust, steel_beam |
| `cooling_tower` | 3756 | 49.2 x 52.0 x 53.0 | 339 | concrete, concrete_dark, metal_dark, rebar |
| `barn_ruin` | 3334 | 25.5 x 10.3 x 21.8 | 288 | concrete_dark, dirt_red, metal_dark, rubber, rust, sand, wood |

### `warehouse`
Steel-frame corrugated warehouse 30 x 18 m, eaves 6.5 m / ridge 8.3 m. Front (3 roll-up doors + pedestrian door) faces +Z; ruined: torn front-left corner, missing roof sheets, collapsed door. Cladding = `paint` (tintable), roof = metal_bare, rust patches. Yard clutter around.
* footprint: [34, 24]
* front: +Z
* eave: 6.5
* ridge: 8.3
* bbox min [-19.0, -0.05, -11.5] max [18.0, 8.51, 15.5]; 4928 tris (+36 collision tris)
* sockets: `yard_lamp` [12.1, 7.9, 13.0]
* nodes: `asphalt`, `concrete`, `concrete_dark`, `glass`, `light_head`, `metal_bare`, `metal_dark`, `paint`, `paint2`, `rubber`, `rust`, `sand`, `steel_beam`, `wood`, `collision`

### `gas_station`
Roadside gas station: convenience shop + garage bay (back, x<0), pump canopy (front, z>0) with 2 islands x 2 double-sided pumps, price sign pole. Front faces +Z; footprint 26 x 22 m; canopy underside y=5.0.
* footprint: [26, 22]
* front: +Z
* canopy_clearance: 5.0
* bbox min [-13.0, 0.0, -7.5] max [13.38, 10.16, 14.5]; 5868 tris (+132 collision tris)
* sockets: `sign_light` [11.6, 9.0, 13.3], `pump_0` [0.5, 0.33, 6.6], `pump_1` [0.5, 0.33, 8.6], `pump_2` [4.5, 0.33, 6.6], `pump_3` [4.5, 0.33, 8.6]
* nodes: `asphalt`, `concrete`, `concrete_dark`, `glass`, `light_amber`, `light_head`, `metal_bare`, `metal_dark`, `paint`, `paint2`, `rebar`, `rubber`, `rust`, `steel_beam`, `wood`, `collision`

### `diner`
Roadside railcar-style diner: stainless lower band, glass window strip (some panes gone), barrel roof, entrance vestibule at +X end, rooftop DINER sign + tall pole 'EAT' neon sign. Front faces +Z; footprint ~26 x 20 m (incl. apron). paint2 = red trim band (tintable), paint = sign board.
* footprint: [26, 20]
* front: +Z
* sockets: sign_neon (pole sign), roof_sign
* bbox min [-13.0, -0.05, -6.0] max [13.0, 11.3, 13.0]; 4255 tris (+60 collision tris)
* sockets: `sign_neon` [-11.0, 9.0, 9.0], `roof_sign` [0, 5.5, 2.8]
* nodes: `asphalt`, `concrete`, `concrete_dark`, `glass`, `light_amber`, `light_boost`, `light_tail`, `metal_bare`, `metal_dark`, `paint`, `paint2`, `rubber`, `rust`, `sand`, `steel_beam`, `wood`, `collision`

### `motel`
L-shaped single-storey motel: wing A (rooms, doors face +Z into the courtyard) + wing B (office + rooms, doors face -X), walkway canopies, empty pool with fence, pole sign MOTEL/VACANCY. Wing B has a collapsed roof section. Front faces +Z, courtyard opens toward +Z/-X. Footprint ~31 x 23 m. paint = doors (tint), paint2 = fascia/trim (tint).
* footprint: [31, 23]
* front: +Z
* bbox min [-15.0, -1.8, -9.2] max [17.0, 9.6, 17.0]; 5834 tris (+48 collision tris)
* sockets: `sign_neon` [-12.0, 8.6, 13.0]
* nodes: `asphalt`, `concrete`, `concrete_dark`, `glass`, `light_green`, `light_tail`, `metal_bare`, `metal_dark`, `paint`, `paint2`, `rebar`, `rubber`, `sand`, `water_dark`, `wood`, `collision`

### `water_tower`
Elevated steel water tank on 8 braced legs, ~27 m. Rusty red-brown tank with a pale band, gash in the tank wall, cone roof, gallery, ladder on +Z side.
* height: 27.6
* footprint_radius: 7.2
* tank_radius: 4.2
* gallery_y: 19.0
* ladder: +Z panel, ground to gallery
* bbox min [-7.06, 0.0, -7.06] max [7.06, 30.19, 7.06]; 5866 tris (+198 collision tris)
* sockets: `beacon` [0, 30.2, 0], `gallery` [0, 18.95, 5.0]
* nodes: `concrete_dark`, `light_tail`, `metal_dark`, `paint`, `rebar`, `rubber`, `rust`, `steel_beam`, `collision`

### `silo_group`
Grain elevator complex: 4 concrete silos (one with a collapsed top), central-rear elevator tower with head house, enclosed conveyor gantry over the silo tops, steel shed and two corrugated bins.
* footprint: [42, 34]
* silo_height: 26
* tower_height: 37
* front: +Z
* bbox min [-27.0, 0.0, -17.0] max [21.0, 45.6, 14.0]; 5702 tris (+256 collision tris)
* sockets: `front` [0, 0, 10]
* nodes: `concrete`, `concrete_dark`, `metal_bare`, `metal_dark`, `paint2`, `rebar`, `rust`, `steel_beam`, `collision`

### `shipping_container`
20 ft ISO container 6.06 x 2.44 x 2.59 m, doors at +Z. `paint` = whole shell (grayscale wear, game tints it); `paint2` = stencil marks; rust patches.
* dims: [2.44, 2.59, 6.06]
* front: +Z (doors)
* stack_height: 2.59
* bbox min [-1.23, 0.0, -3.04] max [1.23, 2.59, 3.09]; 1488 tris (+12 collision tris)
* nodes: `metal_bare`, `metal_dark`, `paint`, `paint2`, `rust`, `wood`, `collision`

### `shipping_container_stack3`
3 ISO containers stacked untidily: middle shifted/yawed with a door ajar, top one slid off, rolled ~3 deg and propped on junk. Shell = `paint` (tint). Front +Z (doors).
* footprint: [3.6, 6.4]
* height: 7.9
* front: +Z
* bbox min [-2.27, -0.0, -3.82] max [2.9, 7.91, 4.6]; 4040 tris (+36 collision tris)
* nodes: `metal_bare`, `metal_dark`, `paint`, `paint2`, `rubber`, `rust`, `wood`, `collision`

### `radio_tower`
60 m self-supporting steel lattice radio tower: 3 platforms with dishes and panel antennas, red beacons, bent upper section with a hanging dish, equipment shed at the base (+Z).
* height: 63.0
* base_half_width: 3.4
* top_half_width: 0.9
* beacons: sockets beacon_0..2
* bbox min [-4.15, -0.04, -4.15] max [4.82, 63.65, 9.7]; 7004 tris (+36 collision tris)
* sockets: `beacon_0` [2.565, 20.3, 2.565], `beacon_1` [1.729, 39.3, 1.729], `beacon_2` [0.0, 63.7, 6.154]
* nodes: `concrete_dark`, `light_tail`, `metal_bare`, `metal_dark`, `paint`, `rust`, `steel_beam`, `collision`

### `wind_turbine`
Dead wind turbine: 60 m tapered tower, nacelle facing +Z, 3 blades frozen (one snapped and hanging). Origin = tower base centre.
* hub_height: 60
* rotor_radius: 33.5
* total_height: 94
* blade_angles_deg: [95, 215, 335]
* rotor_axis: +Z
* bbox min [-27.6, 0.0, -5.85] max [16.56, 95.1, 8.1]; 3178 tris (+116 collision tris)
* sockets: `hub` [0.0, 61.7, 4.6], `beacon` [1.0, 65.5, -4.6]
* nodes: `concrete_dark`, `light_tail`, `metal_bare`, `metal_dark`, `paint`, `steel_beam`, `collision`

### `crane`
Dock ship-to-shore gantry crane, ~41 m tall. Travels along X on rails; boom (raised ~55 deg) points +Z (sea side). Portal legs at z=+-6.5, x=+-8, machinery house on top, hanging spreader + rusty container from the boom tip.
* height: 41.5
* rails: along X at z=-6.5 and z=+6.5 (y=0.3)
* footprint: [36, 40]
* boom_tip: [0, 40.5, 21.5]
* bbox min [-19.0, 0.0, -15.5] max [19.0, 41.82, 25.51]; 3312 tris (+72 collision tris)
* sockets: `beacon_boom` [0.0, 41.898, 22.113], `beacon_mast` [0.0, 35.3, -5.5]
* nodes: `concrete_dark`, `glass`, `light_head`, `light_tail`, `metal_bare`, `metal_dark`, `paint`, `paint2`, `rust`, `steel_beam`, `collision`

### `shanty_hut`
Raider scrap shack ~5.2 x 4.4 m, 3.2 m tall: patchwork of plywood/corrugated sheets/car door, tyre-weighted roof, stovepipe, tarp lean-to on the side. Front (door) faces +Z.
* footprint: [7, 6]
* front: +Z
* height: 3.6
* bbox min [-4.46, -0.17, -3.05] max [4.2, 4.43, 4.13]; 2488 tris (+24 collision tris)
* nodes: `bone`, `canvas`, `metal_bare`, `metal_dark`, `paint`, `rubber`, `rust`, `wood`, `collision`

### `raider_camp_tent`
Raider camp: large conical war tent (patched canvas, skull totem on top), 2 A-frame tents, fire pit ring with logs + emissive flames, skull-and-banner totem pole, weapon rack, crates/barrels/bones. Front (war-tent door) faces +Z. Footprint ~16 x 14 m.
* footprint: [16, 14]
* front: +Z
* sockets: fire (flame origin), totem (skull totem), tent_door
* bbox min [-9.87, -0.05, -8.43] max [9.58, 6.3, 8.6]; 3070 tris (+48 collision tris)
* sockets: `fire` [1.2, 0.4, 3.6], `totem` [6.2, 5.5, 3.4]
* nodes: `bone`, `canvas`, `concrete_dark`, `dirt_red`, `light_amber`, `metal_bare`, `metal_dark`, `rock_grey`, `rubber`, `rust`, `spike`, `wood`, `collision`

### `watchtower`
Raider watchtower ~13 m: timber legs + X bracing, scrap-plate platform at y=9 with ladder on the +Z face, corrugated roof, searchlight, skull banner pole. Front (ladder) faces +Z. Sandbag/tyre nest at the base.
* footprint: [7, 7]
* height: 13.2
* platform_y: 9.0
* front: +Z
* sockets: searchlight (aim +Z), platform (gunner stand)
* bbox min [-3.6, -0.05, -4.5] max [6.5, 15.52, 3.82]; 3780 tris (+48 collision tris)
* sockets: `searchlight` [-1.85, 10.7, 2.55], `platform` [0, 9.12, 0]
* nodes: `bone`, `canvas`, `concrete_dark`, `light_head`, `metal_bare`, `metal_dark`, `rubber`, `rust`, `sand`, `spike`, `wood`, `collision`

### `oil_derrick`
Oil lease: nodding-donkey pumpjack (horsehead toward +Z), 22 m lattice derrick with crown block, two small storage tanks, wellhead + flow lines on an oil-stained pad.
* height: 22.8
* footprint: [40, 24]
* wellhead: [0, 1.0, 4.4]
* bbox min [-21.46, -0.25, -12.8] max [21.51, 24.0, 12.17]; 4518 tris (+116 collision tris)
* sockets: `wellhead` [0.0, 1.2, 4.638], `beacon` [-13.5, 24.0, -3.0]
* nodes: `concrete_dark`, `dirt_red`, `light_tail`, `metal_bare`, `metal_dark`, `paint`, `paint2`, `rubber`, `rust`, `steel_beam`, `collision`

### `industrial_tanks`
Tank farm: 3 big tanks (cone roof, floating roof, dome roof) on a concrete pad with a cracked bund wall, elevated pipe rack along the +Z front, spiral stairs, roof catwalk bridge.
* footprint: [52, 34]
* max_height: 15.0
* pipe_rack: along +X at z=12.5, y=5.8
* bund_gap: +Z front, x in [-3, 3]
* bbox min [-25.55, 0.0, -14.55] max [26.05, 17.36, 16.5]; 6772 tris (+336 collision tris)
* sockets: `gate` [0, 0, 16.0]
* nodes: `concrete`, `concrete_dark`, `metal_bare`, `metal_dark`, `paint`, `paint2`, `rebar`, `rust`, `steel_beam`, `collision`

### `cooling_tower`
Ruined hyperbolic concrete cooling tower, 50 m, big bite out of the +Z rim (down to y~33), exposed rebar, open V-column base with dark interior and dry basin.
* height: 50.0
* base_radius: 24.0
* throat_radius: 13.5
* bite: front (+Z) rim
* bbox min [-24.6, -0.37, -24.6] max [24.6, 51.58, 28.42]; 3756 tris (+288 collision tris)
* sockets: `bite_center` [0, 40.0, 13.639]
* nodes: `concrete`, `concrete_dark`, `metal_dark`, `rebar`, `collision`

### `barn_ruin`
Weathered timber barn 15 x 10 m, eaves 5 m / ridge 8.5 m, half collapsed (rear-left roof and walls gone), tin roof with holes, hanging sliding door, hay bales, broken fence. Front (big door) faces +Z. Footprint ~20 x 16 m.
* footprint: [20, 16]
* front: +Z
* eave: 5.0
* ridge: 8.5
* bbox min [-13.42, -0.21, -10.81] max [12.12, 10.1, 11.0]; 3334 tris (+24 collision tris)
* nodes: `concrete_dark`, `dirt_red`, `metal_dark`, `rubber`, `rust`, `sand`, `wood`, `collision`


## Boss arena: the dam

| id | tris | size (x, y, z m) | file KB | materials |
|---|---|---|---|---|
| `dam_road_10m` | 3568 | 19.3 x 13.4 x 10.1 | 315 | asphalt, concrete, concrete_dark, hazard, light_amber, metal_bare, metal_dark, rust |
| `dam_wall_backdrop` | 9702 | 440.0 x 160.6 x 418.2 | 815 | concrete, concrete_dark, glass, light_tail, metal_dark, rock_grey, rust, steel_beam, water_dark |
| `dam_wall` | 7948 | 118.4 x 54.4 x 110.0 | 691 | asphalt, concrete, concrete_dark, light_amber, metal_bare, metal_dark, steel_beam, water_dark |
| `dam_control_tower` | 5894 | 21.8 x 37.3 x 16.5 | 511 | bone, canvas, concrete, concrete_dark, glass, hazard, light_amber, light_green, light_head, light_tail, metal_bare, metal_dark, rust, spike, steel_beam |
| `dam_gate_big` | 9552 | 32.5 x 26.8 x 11.4 | 803 | bone, canvas, concrete, concrete_dark, hazard, light_amber, light_head, light_tail, metal_bare, metal_dark, rubber, rust, spike, steel_beam |
| `boss_arena_lights` | 8320 | 48.3 x 29.6 x 65.4 | 718 | concrete_dark, hazard, light_amber, light_head, light_tail, metal_dark, rubber, steel_beam |
| `floodlight_tower` | 2080 | 8.8 x 29.6 x 5.4 | 187 | concrete_dark, hazard, light_amber, light_head, light_tail, metal_dark, rubber, steel_beam |
| `banner_skull` | 1588 | 3.5 x 8.3 x 3.1 | 141 | bone, canvas, concrete_dark, light_amber, metal_dark, rubber, rust, spike |
| `spike_wall` | 2236 | 7.4 x 5.1 x 3.7 | 195 | bone, concrete_dark, hazard, metal_bare, metal_dark, rubber, rust, spike, steel_beam |
| `spike_gate` | 4756 | 14.4 x 7.1 x 4.1 | 405 | bone, canvas, concrete_dark, hazard, light_amber, metal_bare, metal_dark, rubber, rust, spike, steel_beam |

### `dam_road_10m`
Modular 10 m crest-road segment for the dam. Origin road centre at z=0, extends +Z, road_surface y=0 (x -7..7). Chains seamlessly every 10 m.
* sides: Reservoir side = -X (right of driver), downstream drop = +X (left). Rotate yaw to suit; crest width 18 m (x -9.4..9.5).
* body: crest body extends to y=-4 (fill below with dam_wall_backdrop or terrain)
* lamps: sockets lamp_0 (+X, z=2.5), lamp_1 (-X, z=7.5)
* bbox min [-9.35, -4.0, 0.0] max [9.98, 9.39, 10.07]; 3568 tris (+36 collision tris)
* sockets: `lamp_0` [5.1, 9.1, 2.5], `lamp_1` [-5.1, 9.1, 7.5]
* nodes: `concrete`, `concrete_dark`, `hazard`, `light_amber`, `metal_bare`, `metal_dark`, `road_surface`, `rust`, `collision`

### `dam_wall_backdrop`
Concrete dam wall backdrop, 200 m wide x 79.4 m tall (crest deck y=79.4; road level y=80 for dam_road_10m modules). Wall runs along X (x -100..100); DOWNSTREAM face (the one the player sees) faces -Z with base toe at z~0, y=0; reservoir (water_dark, y=76) is at +Z. Straight crest at z=24..42 (centre z=33). Central spillway: 5 radial-gate bays (x=-40..40, 16 m clear, gates y 62..78) with stepped chutes down the face; 2 intake towers on the crest (x=+-68, top y=106); 2 powerhouses + penstocks at the toe (x=+-75); grey rock abutments beyond x=+-100. To use as a side backdrop rotate yaw 90 deg. Ground/terrain is NOT included (place terrain at y=0 in front, z<0).
* crest_road: place dam_road_10m modules along X at y=80, z=33 with yaw +90 (module +Z -> +X): sockets crest_start (x=-100) crest_end (x=100)
* arena: socket arena_center (0,0,-70): open flat ground area expected in front of the wall
* bbox min [-220.0, -0.6, -80.0] max [220.0, 160.04, 338.17]; 9702 tris (+60 collision tris)
* sockets: `intake_beacon_L` [-68.0, 119.8, 37.0], `intake_beacon_R` [68.0, 119.8, 37.0], `crest_start` [-100, 80.0, 33.0], `crest_end` [100, 80.0, 33.0], `arena_center` [0, 0, -70], `spillway_center` [0, 62, 17.4]
* nodes: `concrete`, `concrete_dark`, `glass`, `light_tail`, `metal_dark`, `rock_grey`, `rust`, `steel_beam`, `water_dark`, `collision`

### `dam_wall`
60 m hero section of the dam crest. Road along +Z (z 0..60) at y=0 (road_surface, x -7..7), balustrades, lamps, expansion joints; reservoir on -X (water_dark at y=-4), gravity-dam body drops 45 m on the downstream +X side (sloped face, base at y=-45), one spillway bay (z 22..38, 16 m) with a steel radial gate and a stepped chute; road crosses the bay on a girder deck over the piers (z 18..22, 38..42). Chain more `dam_road_10m` beyond z=0 / z=60 (same crest width). No terrain included: place terrain at y=-45 on the +X side.
* crest_width: 18.0
* base_y: -45.0
* bbox min [-75.0, -45.0, -25.0] max [43.4, 9.39, 85.0]; 7948 tris (+156 collision tris)
* sockets: `lampA_0` [5.1, 9.1, 6.0], `lampA_1` [-5.1, 9.1, 16.0], `lampB_0` [5.1, 9.1, 30.0], `lampC_0` [5.1, 9.1, 44.0], `lampC_1` [-5.1, 9.1, 54.0], `crest_start` [0, 0, 0], `crest_end` [0, 0, 60], `spillway_center` [0, -14, 30]
* nodes: `concrete`, `concrete_dark`, `light_amber`, `metal_bare`, `metal_dark`, `road_surface`, `steel_beam`, `water_dark`, `collision`

### `dam_control_tower`
Concrete dam control tower / gatehouse, 28 m + antenna (top ~36 m). Origin base centre on the crest, front (entrance, exterior stair, banner) faces +Z. Footprint podium 15 x 11 m. Half the cab glass is smashed; raider banner + spikes on the roof.
* height: 36.0
* footprint: [15.0, 11.0]
* sockets: searchlight (beam origin), roof_beacon, door (entrance, +Z)
* bbox min [-12.7, -0.12, -7.3] max [9.13, 37.15, 9.22]; 5894 tris (+36 collision tris)
* sockets: `roof_beacon` [4.4, 37.1, -2.6], `searchlight` [5.5, 28.8, 4.1], `door` [0, 0, 5.6]
* nodes: `bone`, `canvas`, `concrete`, `concrete_dark`, `glass`, `hazard`, `light_amber`, `light_green`, `light_head`, `light_tail`, `metal_bare`, `metal_dark`, `rust`, `spike`, `steel_beam`, `collision`

### `dam_gate_big`
Raider fortress blast gate spanning the road (boss spawn). Road along +Z, origin road centre, gate front faces -Z (toward the player), depth z 0..8. Road clear width 14 (x +-7), clearance 11 m to the portcullis spikes. Two 26 m towers with scrap plating, braziers, searchlights, skulls; lintel gatehouse with big horned skull emblem; banners.
* clearance: 11.0
* road_clear: 14.0
* tower_height: 27.0
* spawn: sockets spawn_center (0,0,6), spawn_L (-3.5,0,6), spawn_R (3.5,0,6): boss/escort spawn points inside the gate; flame_* = brazier fire positions, light_* = searchlight positions
* banners_hang_min_y: 7.3
* bbox min [-16.22, -0.03, -2.91] max [16.22, 26.81, 8.5]; 9552 tris (+36 collision tris)
* sockets: `spawn_center` [0, 0, 6.0], `spawn_L` [3.5, 0, 6.0], `spawn_R` [-3.5, 0, 6.0], `flame_R` [-8.6, 1.2, -2.4], `light_R` [-8.8, 24.7, 1.4], `flame_L` [8.6, 1.2, -2.4], `light_L` [8.8, 24.7, 1.4]
* nodes: `bone`, `canvas`, `concrete`, `concrete_dark`, `hazard`, `light_amber`, `light_head`, `light_tail`, `metal_bare`, `metal_dark`, `rubber`, `rust`, `spike`, `steel_beam`, `collision`

### `boss_arena_lights`
Four 26 m floodlight towers at the corners of a 40 (X) x 60 (Z) m rectangle centred on the origin, each lamp bank aimed at the centre. Same tower as `floodlight_tower`. Origin = arena centre at ground level.
* rect: [40, 60]
* corners: (+-20, +-30)
* sockets: lamp_0..3 (spot light sources, aimed at arena_center), beacon_0..3, arena_center
* bbox min [-23.0, 0.0, -32.7] max [25.33, 29.55, 32.7]; 8320 tris (+144 collision tris)
* sockets: `lamp_0` [-19.445, 26.623, -28.891], `beacon_0` [-20.0, 29.6, -30.0], `lamp_1` [-19.445, 27.246, 29.566], `beacon_1` [-20.0, 29.6, 30.0], `lamp_2` [19.445, 26.623, -28.891], `beacon_2` [20.0, 29.6, -30.0], `lamp_3` [19.445, 27.246, 29.566], `beacon_3` [20.0, 29.6, 30.0], `arena_center` [0, 0, 0]
* nodes: `concrete_dark`, `hazard`, `light_amber`, `light_head`, `light_tail`, `metal_dark`, `rubber`, `steel_beam`, `collision`

### `floodlight_tower`
26 m lattice floodlight tower, origin at base centre, lamp bank (8 emissive lamps) faces +Z, tilted 22 deg down. Rotate yaw to aim at the arena.
* height: 30.5
* base: [4.2, 4.2]
* sockets: lamp_0 = light source centre (+Z aim), beacon_0 = red aircraft beacon
* bbox min [-3.45, 0.0, -2.7] max [5.33, 29.55, 2.7]; 2080 tris (+36 collision tris)
* sockets: `lamp_0` [0.0, 26.56, 1.264], `beacon_0` [0.0, 29.6, 0.0]
* nodes: `concrete_dark`, `hazard`, `light_amber`, `light_head`, `light_tail`, `metal_dark`, `rubber`, `steel_beam`, `collision`

### `banner_skull`
Raider banner pole (7.4 m): tilted steel pole on a tyre + concrete cairn base, crossbar with skull finials, tattered red banner with skull emblem on both faces (front faces -Z), brazier fire on top (light_amber), chains, skull string. Origin base centre.
* height: 8.4
* sockets: flame = brazier fire position
* bbox min [-1.65, 0.0, -1.32] max [1.85, 8.35, 1.8]; 1588 tris (+24 collision tris)
* sockets: `flame` [0.12, 7.6, 0.0]
* nodes: `bone`, `canvas`, `concrete_dark`, `light_amber`, `metal_dark`, `rubber`, `rust`, `spike`, `collision`

### `spike_wall`
Raider spiked barricade segment, 7 m wide (x -3.5..3.5), origin at road centre/segment centre on the ground. Front (spikes) faces -Z toward the approaching player, depth ~2 m to the spike tips (z -2.0..0.5). Chain two segments (x=+-3.5) to block the 14 m road.
* width: 7.0
* height: 3.6
* spike_tip_height: 4.6
* chain: x = -3.5 and +3.5
* bbox min [-3.67, 0.0, -2.15] max [3.69, 5.09, 1.56]; 2236 tris (+12 collision tris)
* nodes: `bone`, `concrete_dark`, `hazard`, `metal_bare`, `metal_dark`, `rubber`, `rust`, `spike`, `steel_beam`, `collision`

### `spike_gate`
Raider spiked road gate: 14 m wide (x -7..7) with a 5 m gap (x -2.5..2.5) between two gate posts with braziers and skulls; open gate leaves folded against the posts; lintel banner at y=5.2 (clearance 5 m). Front faces -Z. Origin road centre, ground level.
* gap: [-2.5, 2.5]
* clearance: 5.0
* bbox min [-7.19, 0.0, -2.13] max [7.19, 7.06, 1.96]; 4756 tris (+48 collision tris)
* sockets: `gap_center` [0, 0, 0]
* nodes: `bone`, `canvas`, `concrete_dark`, `hazard`, `light_amber`, `metal_bare`, `metal_dark`, `rubber`, `rust`, `spike`, `steel_beam`, `collision`


## Coastal set

| id | tris | size (x, y, z m) | file KB | materials |
|---|---|---|---|---|
| `lighthouse` | 5242 | 72.7 x 31.3 x 51.6 | 459 | brick, concrete, concrete_dark, glass, light_head, metal_bare, metal_dark, paint, paint2, rock_grey, rust, wood |
| `sea_stack_a` | 1680 | 35.9 x 38.0 x 33.0 | 154 | dirt_red, rock_grey, sand |
| `sea_stack_b` | 1776 | 41.0 x 26.4 x 41.3 | 164 | dirt_red, rock_red, sand |
| `sea_stack_c` | 2552 | 46.0 x 39.0 x 36.9 | 234 | dirt_red, rock_grey, sand |
| `wharf_ruin` | 5804 | 19.0 x 19.2 x 42.8 | 486 | concrete, concrete_dark, glass, metal_dark, rust, wood |

### `lighthouse`
Ruined lighthouse on a rock outcrop: 28 m tapered tower (brick base, white/red paint bands) + gallery + lantern (emissive light_head) + half-collapsed keeper cottage at +X. Tower at (0,0); ground y=0 = sea level, island top y=2. Door faces +Z.
* height: 29.2
* sockets: light = lantern lamp position (add a real point light there)
* tint: paint bands = white, paint2 bands = red (base colours already set; game may tint)
* bbox min [-32.66, -2.0, -24.86] max [40.06, 29.3, 26.76]; 5242 tris (+122 collision tris)
* sockets: `light` [0, 24.35, 0]
* nodes: `brick`, `concrete`, `concrete_dark`, `glass`, `light_head`, `metal_bare`, `metal_dark`, `paint`, `paint2`, `rock_grey`, `rust`, `wood`, `collision`

### `sea_stack_a`
Tall leaning sea stack (limestone, banded), origin at waterline centre; base talus + boulders. Undercut waist at y~2.
* height: 35.0
* radius_base: 15.5
* placement: stand in the sea beside coastal road, any yaw
* bbox min [-18.58, -1.5, -16.22] max [17.3, 36.5, 16.82]; 1680 tris (+42 collision tris)
* nodes: `dirt_red`, `rock_grey`, `sand`, `collision`

### `sea_stack_b`
Wide table-top sea stack, sandstone, sheer cliffs, flat rough top. Origin at waterline centre.
* height: 24.0
* radius_base: 21
* bbox min [-19.97, -1.5, -21.9] max [21.0, 24.91, 19.4]; 1776 tris (+60 collision tris)
* nodes: `dirt_red`, `rock_red`, `sand`, `collision`

### `sea_stack_c`
Twin-spire sea stack (34 m + 23 m) joined by a saddle. Origin at waterline centre between the spires.
* height: 34
* bbox min [-22.43, -1.5, -18.47] max [23.56, 37.5, 18.44]; 2552 tris (+108 collision tris)
* nodes: `dirt_red`, `rock_grey`, `sand`, `collision`

### `wharf_ruin`
Ruined wharf: concrete quay head + 38 m timber pier along +Z with missing/broken planks and piles, rusty crane stump (z=17, x=-2.2), half-sunk boat hull at (9.5,-0.9,20). Pier deck top y=3.15, sea level y=0 (piles go to y=-3.6). Origin = pier centre at the quay edge (z=0).
* length: 38
* deck_y: 3.15
* placement: sea level = y 0; quay head sits on the shore, pier runs out to sea along +Z
* bbox min [-6.05, -3.61, -5.05] max [12.98, 15.56, 37.77]; 5804 tris (+68 collision tris)
* nodes: `concrete`, `concrete_dark`, `glass`, `metal_dark`, `rust`, `wood`, `collision`


## Canyon set

| id | tris | size (x, y, z m) | file KB | materials |
|---|---|---|---|---|
| `natural_arch` | 5236 | 56.0 x 29.2 x 16.6 | 463 | dirt_red, rock_red, sand |
| `hoodoo_a` | 1246 | 21.9 x 38.7 x 19.9 | 127 | dirt_red, rock_red, sand |
| `hoodoo_b` | 1668 | 37.0 x 31.3 x 24.4 | 168 | dirt_red, rock_red, sand |
| `mesa_a` | 3948 | 203.8 x 102.7 x 103.1 | 362 | dirt_red, rock_red, sand |
| `mesa_b` | 4552 | 156.3 x 113.8 x 99.9 | 415 | dirt_red, rock_red, sand |

### `natural_arch`
Natural rock arch over the road, road-aligned (+Z), z=0..14. Inner clear opening: 26.8 m wide at the ground (x +-13.4), 17.6 m crown; >=15 m over the driving lane x in [-7,7]. Legs beyond |x|=13.4 out to |x|~24.
* clear_span: 26.8
* crown_y: 17.6
* depth: 14.0
* collision: legs only (2 hulls)
* placement: road passes through at x=0; terrain should rise at the legs
* bbox min [-27.17, -1.5, -1.19] max [28.84, 27.73, 15.45]; 5236 tris (+98 collision tris)
* sockets: `arch_crown` [0, 17.6, 7.0]
* nodes: `dirt_red`, `rock_red`, `sand`, `collision`

### `hoodoo_a`
Tall eroded hoodoo (36 m): soft red sandstone shaft, hard dark caprock flares, balanced boulder on top. Origin at base centre.
* height: 33.0
* radius_base: 12.5
* bbox min [-10.64, -1.5, -10.11] max [11.26, 37.22, 9.81]; 1246 tris (+164 collision tris)
* nodes: `dirt_red`, `rock_red`, `sand`, `collision`

### `hoodoo_b`
Squat eroded hoodoo (27 m) with a wide mushroom cap and a smaller companion pillar (15 m). Origin between the pillars.
* height: 27.0
* bbox min [-16.16, -1.5, -8.85] max [20.83, 29.81, 15.49]; 1668 tris (+240 collision tris)
* nodes: `dirt_red`, `rock_red`, `sand`, `collision`

### `mesa_a`
Flat-top mesa backdrop, 144 x ~72 m footprint (~190 m with talus), 95 m tall, red banded cliffs + talus apron. Origin at base centre; low detail (backdrop, place 60-400 m off the road).
* width: 140
* height: 95.0
* placement: far backdrop; yaw freely; long axis = x
* bbox min [-104.78, -3.0, -51.69] max [99.02, 99.71, 51.37]; 3948 tris (+108 collision tris)
* nodes: `dirt_red`, `rock_red`, `sand`, `collision`

### `mesa_b`
Two-tier butte/mesa backdrop, ~112 m wide lower tier (62 m) + 48 m upper butte offset to +X, total ~110 m tall, red banded cliffs. Origin at base centre; backdrop only.
* width: 112
* height: 110.0
* placement: far backdrop, 60-400 m from the road
* bbox min [-81.89, -3.0, -48.39] max [74.4, 110.75, 51.47]; 4552 tris (+166 collision tris)
* nodes: `dirt_red`, `rock_red`, `sand`, `collision`

