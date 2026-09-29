# RIDE OR DIE - environment textures

All PBR sets are `<name>/{albedo,normal,arm}.jpg`.  **albedo** = sRGB base colour, **normal** = tangent-space **OpenGL (+Y up)**, **arm** = linear packed **R = ambient occlusion, G = roughness, B = metallic** (load as linear/NoColorSpace; in three.js use it as `aoMap` (R), `roughnessMap` (G) and `metalnessMap` (B) - the three channels line up with the glTF ORM convention).
Every set tiles seamlessly in both directions (seam error ~1.0 measured on the wrap edge).  Photoscans are CC0 from Poly Haven (see CREDITS.md), regraded to the game palette, with procedural additions where noted.

## PBR tiles

| name | px | native metres / tile | suggested world size per tile (m) | source | recommended use |
|---|---|---|---|---|---|
| `asphalt` | 2048 | 2.0 | 6-8 | asphalt_pit_lane | Clean dark road surface: highway lanes in the desert/canyon/coast biomes; also city streets. Base layer under decals. |
| `asphalt_worn` | 2048 | 3.7 (one lane) | 3.7 | asphalt_01 (+procedural wear) | Lane-width tile: tyre-polished wheel tracks at u=0.26/0.74, dusty centre, oil drips, sealed transverse crack, chipped edges with a ghost edge-line at the wrap. Map U across one lane (repeat.x = 1 per lane), V along the road (3.7 m). Mirrors of asphalt_01 inside, so it has no visible repeat of grain. |
| `asphalt_cracked` | 2048 | 3.0 | 6 | asphalt_02 | Broken/aged asphalt with real cracks: ruined city, dam approach, shoulder patches, damaged road decals. |
| `sand` | 2048 | 2.5 | 5-8 | sandy_gravel_02 (+procedural wind ripples) | Desert dunes/flats. Contains procedural wind ripples (asymmetric, ~15 cm wavelength at 2.5 m/tile) baked into the normal + albedo. |
| `dirt_red` | 2048 | 1.5 | 4-6 | red_dirt_mud_01 | Red canyon floor, road shoulders, dirt tracks; rust-orange with gravel. |
| `dry_grass` | 2048 | 2.0 | 4-6 | withered_grass | Straw-golden dead grass for the desert-edge / mountain foothill terrain. |
| `gravel` | 2048 | 2.5 | 3-5 | gravel_floor_03 | Road shoulder, railway ballast, quarry floors; dark grey-brown crushed stone. |
| `rock_red` | 2048 | 1.8 | 3-4 | cliff_side | Layered canyon sandstone (strata run along image X = horizontal). Canyon walls, boulders, pillars. |
| `rock_grey` | 2048 | 2.7 | 4-6 | rock_face_03 (desaturated) | Cracked warm-grey mountain rock: pine-mountain slopes, rocks, tunnel portals. |
| `cliff` | 2048 | 2.0 | 4-6 | dry_riverbed_rock | Coastal / mountain cliff face with horizontal blocky strata; use on steep triplanar Y-axis projections. |
| `snow` | 2048 | 2.0 | 4-8 | snow_02 | Bright powder snow for the peaks (albedo lifted so dark pits don't read as dirt). Blend with rock_grey by slope/height. |
| `forest_floor` | 2048 | 1.5 | 3-5 | forest_leaves_04 | Dark pine-needle / leaf litter with twigs for the pine-mountain ground. |
| `grass_green` | 2048 | 2.0 | 4-6 | forrest_ground_01 | Coastal / lowland green grass (slightly cool, not neon). |
| `beach_sand` | 2048 | 3.0 | 4-6 | coast_sand_03 | Coastal coral-gravel beach sand with shells and pebbles. |
| `pebbles` | 1024 | 2.0 | 2-3 | dry_river_pebbles | Loose river/beach pebbles (1024); dry riverbeds, shoreline, drainage ditches. |
| `concrete` | 1024 | 2.5 | 3-5 | concrete_floor_03 (bleached) | Bleached broom-finish concrete: barriers, sidewalks, dam, buildings (1024). |
| `concrete_cracked` | 1024 | 2.0 | 3-4 | cracked_concrete (bleached) | Heavily cracked / spalled bleached concrete: ruined city roads, dam apron (1024). |
| `rust_metal` | 1024 | 2.2 | 2-3 | rust_coarse_01 | Corroded orange-brown steel plate: vehicles, containers, signs (1024). |
| `brick_ruin` | 1024 | 2.5 | 3-4 | red_bricks_02 | Broken weathered brick with lost mortar: ruined buildings (1024). |

**Tiling tips.** The native tile sizes are 1.5-3 m (real photoscan scale), so a 200 m road/terrain patch repeats visibly. Recommended: sample every terrain set twice - once at the suggested world size and once at ~x0.13 of the frequency (i.e. 8x bigger) - and multiply/overlay them, and/or offset+rotate the UV per 'macro cell' using `detail/macro_noise.png` (below). Blend terrain layers by slope/height/noise (triplanar for cliffs; cliff/rock_red strata are horizontal so project them on the world Y axis).

Other tileables: `detail/macro_noise.png` (512, RGBA, 4 independent tileable low-frequency noises, mean 0.5, use as brightness/blend breakup at 30-100 m per tile) and `detail/detail_normal.jpg` (512 OpenGL normal, fine sandy grain, use at 0.25-0.5 m per tile on top of any surface for close-up crispness).

## Particles / decals  (`particles/`, PNG RGBA, straight alpha, colour bled under transparent texels)

| file | size | layout | notes |
|---|---|---|---|
| `smoke_sheet.png` | 2048 | 4x4 of 512 | each ROW = one puff family (round / wide / tall / irregular); the 4 columns are that puff's life (young dense -> large thin). Neutral grey with baked light (top-left) - tint via vertex colour / material colour. Use as random frame OR as a 4-frame flipbook along a row. Alpha-blended (not additive). |
| `dust_puff.png` | 1024 | 4x4 of 256 | same structure as smoke, tan/dusty, lower opacity: tyre dust, impacts, landings. |
| `fire_sheet.png` | 2048 | 4x4 of 512, 16-frame LOOP | flame anchored at the bottom-centre of each cell (pivot at (0.5, 0.0)); additive or alpha; colours run white-yellow base -> orange -> red tips. Scrolls exactly one noise period over 16 frames, so it loops seamlessly at 12-24 fps. |
| `spark.png` | 256 | single | glowing dot with a 4-point star flare; additive. |
| `spark_streak.png` | 256x64 | single | velocity streak, bright head at the RIGHT end (+U), fading tail to the left; stretch along the velocity vector; additive. |
| `debris_sheet.png` | 1024 | 4x4 of 256 | cells 0-2 rock, 3-5 concrete, 6-8 dirt clods, 9-12 rusty metal shards, 13-15 wood splinters; lit, alpha-cut sprites, random rotation in-game. |
| `muzzle_flash_sheet.png` | 2048x1024 | 4x2 of 512 | row 0: star bursts (0,1), 4-spike (2), forward cone (3); row 1: cone+side flare (4), small cone (5), round burst (6), double-lobe shotgun (7). Cones point to +X (muzzle at the left-centre of the cell, x=-0.78 in cell coords). Additive-friendly: RGB fades to black, alpha follows intensity. |
| `bullet_hole_sheet.png` (+`_normal.png`) | 1024 | 2x2 of 512 | decals: 0 asphalt/concrete chip with cracks, 1 metal punch with petals, 2 dirt/sand pit with dust ring, 3 shotgun cluster. Normal sheet is tangent-space (OpenGL) for the same cells. |
| `scorch_sheet.png` | 1024 | 2x2 of 512 | soot blasts (cell 3 is elongated); soft alpha, near-black; multiply-ish decals under explosions. |
| `crack_sheet.png` | 1024 | 2x2 of 512 | branching fracture decals for asphalt/concrete/ground (dark with a chipped lip). |
| `skid_mark.png` | 256x1024 | 1 tile, repeats along V (image Y) | one tyre mark, centred, ragged streaky edges; place two per axle. ~0.45 m wide inside a 0.8 m x 3.2 m tile. |
| `shockwave.png` | 512 | single | thin ragged ring (radius 0.8 of the half-width), additive, scale up over 0.3 s. |
| `blast_flash.png` | 512 | single | hot core + rays for the first frames of an explosion; additive. |

## Road markings  (`road_markings/markings.png` + `markings.json`)

2048x2048 atlas, **128 px per metre**, transparent background, worn/chipped/speckled (never vector clean). White paint = off-white, yellow = dull thermoplastic yellow. **Forward direction of the road = image UP (+V).**  `markings.json` has, per item: pixel rect, uv rect `[u0,v0,u1,v1]` (three.js flipY convention), real size in metres, kind and colour. Draw them as alpha-blended decal quads slightly above the asphalt (polygonOffset) with `uv` mapped onto a `size_m` quad; several wear variants exist per line type so neighbouring segments don't repeat.

| item | size (m) | colour | notes |
|---|---|---|---|
| `dash_white_a` | 0.34 x 3.20 | white | 3.0 m dash; repeat every 12 m (9 m gap) |
| `dash_white_b` | 0.34 x 3.20 | white | 3.0 m dash; repeat every 12 m (9 m gap) |
| `dash_white_c` | 0.34 x 3.20 | white | 3.0 m dash; repeat every 12 m (9 m gap) |
| `dash_yellow_a` | 0.34 x 3.20 | yellow |  |
| `dash_yellow_b` | 0.34 x 3.20 | yellow |  |
| `edge_white_a` | 0.34 x 6.00 | white | solid line, 6 m; stack end to end (bottom of one = top of next) |
| `edge_white_b` | 0.34 x 6.00 | white | solid line, 6 m; stack end to end (bottom of one = top of next) |
| `edge_white_c` | 0.34 x 6.00 | white | solid line, 6 m; stack end to end (bottom of one = top of next) |
| `edge_white_faded` | 0.34 x 6.00 | white | almost gone |
| `double_yellow_a` | 0.62 x 6.00 | yellow | double solid yellow centre line, 6 m |
| `double_yellow_b` | 0.62 x 6.00 | yellow | double solid yellow centre line, 6 m |
| `double_yellow_c` | 0.62 x 6.00 | yellow | double solid yellow centre line, 6 m |
| `single_yellow_a` | 0.34 x 6.00 | yellow |  |
| `single_yellow_b` | 0.34 x 6.00 | yellow |  |
| `yellow_solid_dash` | 0.62 x 6.00 | yellow | passing zone: solid + dashed (1 m dash / 2 m gap) |
| `rumble_a` | 0.90 x 3.00 | dark | milled shoulder grooves, darkening decal |
| `rumble_b` | 0.90 x 3.00 | dark | worn / filled with dust |
| `chevron_white` | 3.00 x 2.20 | white | V pointing forward (up) |
| `chevron_yellow` | 3.00 x 2.20 | yellow |  |
| `hatch_white` | 2.00 x 4.00 | white | gore / painted island, diagonal stripes |
| `hatch_yellow` | 2.00 x 4.00 | yellow |  |
| `arrow_straight` | 1.00 x 4.00 | white |  |
| `arrow_left` | 1.80 x 4.00 | white |  |
| `arrow_right` | 1.80 x 4.00 | white |  |
| `crosswalk` | 4.00 x 3.00 | white | zebra bars run along the road; 4 m wide |
| `stop_line` | 3.60 x 0.50 | white |  |

Layout rules of thumb (US-style highway): lane 3.7 m; dashed lane line = 3 m paint / 9 m gap (`dash_white_*` every 12 m); edge lines 0.3 m inside the lane edge; double yellow centre line `double_yellow_*` (0.55 m wide); rumble strips on the shoulder (`rumble_*`, darkening decal); arrows every ~150 m before exits; `chevron_*`/`hatch_*` for gore areas and barricades.

## Rebuilding

`tools/env/tex_fetch.py` (downloads Poly Haven sources into `C:/Dev/art_cache/rideordie/env`), `tools/env/build_textures.py`, `build_particles.py`, `build_markings.py`, `build_readme.py` (this file), `prep_prop_textures.py` (512 px copies embedded in prop GLBs).
