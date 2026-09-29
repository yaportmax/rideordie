"""Generate public/textures/README.md from tools/env/textures_meta.json + markings.json (run after the texture builders)."""
import json, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
T = os.path.join(ROOT, "public", "textures")
meta = json.load(open(os.path.join(ROOT, "tools", "env", "textures_meta.json")))
mk = json.load(open(os.path.join(T, "road_markings", "markings.json")))

USE = {
    "asphalt": ("2.0", "6-8", "Clean dark road surface: highway lanes in the desert/canyon/coast biomes; also city streets. Base layer under decals."),
    "asphalt_worn": ("3.7 (one lane)", "3.7", "Lane-width tile: tyre-polished wheel tracks at u=0.26/0.74, dusty centre, oil drips, sealed transverse crack, chipped edges with a ghost edge-line at the wrap. Map U across one lane (repeat.x = 1 per lane), V along the road (3.7 m). Mirrors of asphalt_01 inside, so it has no visible repeat of grain."),
    "asphalt_cracked": ("3.0", "6", "Broken/aged asphalt with real cracks: ruined city, dam approach, shoulder patches, damaged road decals."),
    "sand": ("2.5", "5-8", "Desert dunes/flats. Contains procedural wind ripples (asymmetric, ~15 cm wavelength at 2.5 m/tile) baked into the normal + albedo."),
    "dirt_red": ("1.5", "4-6", "Red canyon floor, road shoulders, dirt tracks; rust-orange with gravel."),
    "dry_grass": ("2.0", "4-6", "Straw-golden dead grass for the desert-edge / mountain foothill terrain."),
    "gravel": ("2.5", "3-5", "Road shoulder, railway ballast, quarry floors; dark grey-brown crushed stone."),
    "rock_red": ("1.8", "3-4", "Layered canyon sandstone (strata run along image X = horizontal). Canyon walls, boulders, pillars."),
    "rock_grey": ("2.7", "4-6", "Cracked warm-grey mountain rock: pine-mountain slopes, rocks, tunnel portals."),
    "cliff": ("1.8", "6-10", "Coastal / mountain cliff face: warm grey-tan layered sediment with horizontal strata (same scan as rock_red, different grade). Use on steep faces with world-Y-projected UVs; looks best at 6-10 m per tile."),
    "snow": ("2.0", "4-8", "Bright powder snow for the peaks (albedo lifted so dark pits don't read as dirt). Blend with rock_grey by slope/height."),
    "forest_floor": ("1.5", "3-5", "Dark pine-needle / leaf litter with twigs for the pine-mountain ground."),
    "grass_green": ("2.0", "4-6", "Coastal / lowland green grass (slightly cool, not neon)."),
    "beach_sand": ("3.0", "4-6", "Coastal coral-gravel beach sand with shells and pebbles."),
    "pebbles": ("2.0", "2-3", "Loose river/beach pebbles (1024); dry riverbeds, shoreline, drainage ditches."),
    "concrete": ("2.5", "3-5", "Bleached broom-finish concrete: barriers, sidewalks, dam, buildings (1024)."),
    "concrete_cracked": ("2.0", "3-4", "Heavily cracked / spalled bleached concrete: ruined city roads, dam apron (1024)."),
    "rust_metal": ("2.2", "2-3", "Corroded orange-brown steel plate: vehicles, containers, signs (1024)."),
    "brick_ruin": ("2.5", "3-4", "Broken weathered brick with lost mortar: ruined buildings (1024)."),
}

L = []
L.append("# RIDE OR DIE - environment textures\n")
L.append("All PBR sets are `<name>/{albedo,normal,arm}.jpg`.  **albedo** = sRGB base colour, **normal** = tangent-space **OpenGL (+Y up)**, "
         "**arm** = linear packed **R = ambient occlusion, G = roughness, B = metallic** (load as linear/NoColorSpace; in three.js use it as "
         "`aoMap` (R), `roughnessMap` (G) and `metalnessMap` (B) - the three channels line up with the glTF ORM convention).\n"
         "Every set tiles seamlessly in both directions (seam error ~1.0 measured on the wrap edge).  Photoscans are CC0 from Poly Haven (see CREDITS.md), regraded to the game palette, "
         "with procedural additions where noted.\n")
L.append("## PBR tiles\n")
L.append("| name | px | native metres / tile | suggested world size per tile (m) | source | recommended use |")
L.append("|---|---|---|---|---|---|")
order = ["asphalt", "asphalt_worn", "asphalt_cracked", "sand", "dirt_red", "dry_grass", "gravel", "rock_red", "rock_grey", "cliff", "snow", "forest_floor",
         "grass_green", "beach_sand", "pebbles", "concrete", "concrete_cracked", "rust_metal", "brick_ruin"]
for n in order:
    m = meta.get(n, {})
    u = USE[n]
    L.append("| `%s` | %d | %s | %s | %s | %s |" % (n, m.get("size", 0), u[0] if "lane" in u[0] else "%.1f" % m.get("tile", 0), u[1], m.get("source", ""), u[2]))
L.append("")
L.append("**Tiling tips.** The native tile sizes are 1.5-3 m (real photoscan scale), so a 200 m road/terrain patch repeats visibly. Recommended: sample every terrain set twice - "
         "once at the suggested world size and once at ~x0.13 of the frequency (i.e. 8x bigger) - and multiply/overlay them, and/or offset+rotate the UV per 'macro cell' using "
         "`detail/macro_noise.png` (below). Blend terrain layers by slope/height/noise (triplanar for cliffs; cliff/rock_red strata are horizontal so project them on the world Y axis).\n")
L.append("Other tileables: `detail/macro_noise.png` (512, RGBA, 4 independent tileable low-frequency noises, mean 0.5, use as brightness/blend breakup at 30-100 m per tile) and "
         "`detail/detail_normal.jpg` (512 OpenGL normal, fine sandy grain, use at 0.25-0.5 m per tile on top of any surface for close-up crispness).\n")
L.append("## Particles / decals  (`particles/`, PNG RGBA, straight alpha, colour bled under transparent texels)\n")
L.append("| file | size | layout | notes |")
L.append("|---|---|---|---|")
L.append("| `smoke_sheet.png` | 2048 | 4x4 of 512 | each ROW = one puff family (round / wide / tall / irregular); the 4 columns are that puff's life (young dense -> large thin). Neutral grey with baked light (top-left) - tint via vertex colour / material colour. Use as random frame OR as a 4-frame flipbook along a row. Alpha-blended (not additive). |")
L.append("| `dust_puff.png` | 1024 | 4x4 of 256 | same structure as smoke, tan/dusty, lower opacity: tyre dust, impacts, landings. |")
L.append("| `fire_sheet.png` | 2048 | 4x4 of 512, 16-frame LOOP | flame anchored at the bottom-centre of each cell (pivot at (0.5, 0.0)); additive or alpha; colours run white-yellow base -> orange -> red tips. Scrolls exactly one noise period over 16 frames, so it loops seamlessly at 12-24 fps. |")
L.append("| `spark.png` | 256 | single | glowing dot with a 4-point star flare; additive. |")
L.append("| `spark_streak.png` | 256x64 | single | velocity streak, bright head at the RIGHT end (+U), fading tail to the left; stretch along the velocity vector; additive. |")
L.append("| `debris_sheet.png` | 1024 | 4x4 of 256 | cells 0-2 rock, 3-5 concrete, 6-8 dirt clods, 9-12 rusty metal shards, 13-15 wood splinters; lit, alpha-cut sprites, random rotation in-game. |")
L.append("| `muzzle_flash_sheet.png` | 2048x1024 | 4x2 of 512 | row 0: star bursts (0,1), 4-spike (2), forward cone (3); row 1: cone+side flare (4), small cone (5), round burst (6), double-lobe shotgun (7). Cones point to +X (muzzle at the left-centre of the cell, x=-0.78 in cell coords). Additive-friendly: RGB fades to black, alpha follows intensity. |")
L.append("| `bullet_hole_sheet.png` (+`_normal.png`) | 1024 | 2x2 of 512 | decals: 0 asphalt/concrete chip with cracks, 1 metal punch with petals, 2 dirt/sand pit with dust ring, 3 shotgun cluster. Normal sheet is tangent-space (OpenGL) for the same cells. |")
L.append("| `scorch_sheet.png` | 1024 | 2x2 of 512 | soot blasts (cell 3 is elongated); soft alpha, near-black; multiply-ish decals under explosions. |")
L.append("| `crack_sheet.png` | 1024 | 2x2 of 512 | branching fracture decals for asphalt/concrete/ground (dark with a chipped lip). |")
L.append("| `skid_mark.png` | 256x1024 | 1 tile, repeats along V (image Y) | one tyre mark, centred, ragged streaky edges; place two per axle. ~0.45 m wide inside a 0.8 m x 3.2 m tile. |")
L.append("| `shockwave.png` | 512 | single | thin ragged ring (radius 0.8 of the half-width), additive, scale up over 0.3 s. |")
L.append("| `blast_flash.png` | 512 | single | hot core + rays for the first frames of an explosion; additive. |")
L.append("")
L.append("## Road markings  (`road_markings/markings.png` + `markings.json`)\n")
L.append("2048x2048 atlas, **%d px per metre**, transparent background, worn/chipped/speckled (never vector clean). White paint = off-white, yellow = dull thermoplastic yellow. "
         "**Forward direction of the road = image UP (+V).**  `markings.json` has, per item: pixel rect, uv rect `[u0,v0,u1,v1]` (three.js flipY convention), real size in metres, kind and colour. "
         "Draw them as alpha-blended decal quads slightly above the asphalt (polygonOffset) with `uv` mapped onto a `size_m` quad; several wear variants exist per line type so neighbouring segments don't repeat.\n" % mk["px_per_m"])
L.append("| item | size (m) | colour | notes |")
L.append("|---|---|---|---|")
for k, v in mk["items"].items():
    L.append("| `%s` | %.2f x %.2f | %s | %s |" % (k, v["size_m"][0], v["size_m"][1], v["color"], v["note"]))
L.append("")
L.append("Layout rules of thumb (US-style highway): lane 3.7 m; dashed lane line = 3 m paint / 9 m gap (`dash_white_*` every 12 m); edge lines 0.3 m inside the lane edge; double yellow centre line "
         "`double_yellow_*` (0.55 m wide); rumble strips on the shoulder (`rumble_*`, darkening decal); arrows every ~150 m before exits; `chevron_*`/`hatch_*` for gore areas and barricades.\n")
L.append("## Names in docs/ASSET_SPEC.md -> actual files\n")
L.append("`paint_road` = `road_markings/markings.png` (+ `markings.json`), `smoke_particle` = `particles/smoke_sheet.png`, `dust_particle` = `particles/dust_puff.png`. "
         "(No duplicate copies are shipped, to save bandwidth.)\n")
L.append("## Ground-pass derived textures (built from the sets above)\n\n| file | size | built by | used by |\n|---|---|---|---|\n| `road_markings/lines.png` | 576x768, opaque | `tools/env/build_road_lines.py` | road shader (`src/world/terrain_material.js`): 9 columns of 64x768 px (0.5 m x 6 m, 128 px/m) -> one DataArrayTexture layer each: 0-3 `edge_white_a/b/c/faded`, 4-6 `dash_white_a/b/c` (3.2 m at the top), 7-8 `rumble_a/b`. R = paint brightness (bled under the gaps), G = coverage. |\n| `cover/cover_atlas.png` | 1024, RGBA | `tools/env/build_cover_atlas.py` | ground cover cards (`src/world/dressing/groundcover.js`): 2x2 cells of 512: dry grass, green grass, dry seed stalks, scrub bush; base of each clump on the cell's bottom edge, colour bled under alpha 0. |\n\nThe terrain/road array texture also carries `asphalt_worn`, `asphalt` and `asphalt_cracked` as layers 12-14 (after the 12 terrain layers).\n")
L.append("## Rebuilding\n")
L.append("`tools/env/tex_fetch.py` (downloads Poly Haven sources into `C:/Dev/art_cache/rideordie/env`), `tools/env/build_textures.py`, `build_particles.py`, `build_markings.py`, `build_readme.py` "
         "(this file), `prep_prop_textures.py` (512 px copies embedded in prop GLBs), `build_road_lines.py`, `build_cover_atlas.py`.\n")
open(os.path.join(T, "README.md"), "w").write("\n".join(L))
print("README written", len("\n".join(L)))
