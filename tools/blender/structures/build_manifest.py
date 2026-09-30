"""Collects tools/blender/structures/meta/*.json (written by slib Piece.build) into
public/models/structures/manifest.json and public/models/structures/README.md.
Run with system python:  python tools/blender/structures/build_manifest.py"""
import json, os, glob, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "public", "models", "structures")
META = os.path.join(HERE, "meta")

GROUPS = [
    ("road", "Road-aligned pieces (origin = road centre at piece start z=0, extend toward +Z, road surface y=0)", [
        "jump_ramp", "jump_ramp_small", "speed_boost_pad", "bridge_span_20m", "bridge_span_20m_damaged", "bridge_pier", "bridge_arch", "overpass_concrete",
        "tunnel_portal_rock", "tunnel_mid_10m", "tunnel_exit", "tunnel_portal_concrete", "tunnel_exit_concrete", "tunnel_portal_rock_grey", "tunnel_exit_grey",
        "road_gate", "toll_booth_ruined", "roadblock_wreck_line"]),
    ("city", "Ruined city buildings (stand beside the road; origin = base centre; front faces +Z)", [
        "ruin_office_a", "ruin_office_b", "ruin_office_c", "ruin_apartment_a", "ruin_apartment_b",
        "ruin_lowrise_a", "ruin_lowrise_b", "ruin_lowrise_c"]),
    ("outpost", "Roadside / outpost / industrial (origin = base centre; front faces +Z)", [
        "warehouse", "gas_station", "diner", "motel", "water_tower", "silo_group", "shipping_container", "shipping_container_stack3",
        "radio_tower", "wind_turbine", "crane", "shanty_hut", "raider_camp_tent", "watchtower", "oil_derrick", "industrial_tanks",
        "cooling_tower", "barn_ruin"]),
    ("dam", "Boss arena: the dam", [
        "dam_road_10m", "dam_wall_backdrop", "dam_wall", "dam_control_tower", "dam_gate_big", "boss_arena_lights", "floodlight_tower",
        "banner_skull", "spike_wall", "spike_gate"]),
    ("coast", "Coastal set", ["lighthouse", "sea_stack_a", "sea_stack_b", "sea_stack_c", "wharf_ruin"]),
    ("canyon", "Canyon set", ["natural_arch", "hoodoo_a", "hoodoo_b", "mesa_a", "mesa_b"]),
    ("wrecks", "Vehicle wrecks + roadblock modules (origin ground centre, front +Z; rb_* modules keep visuals + collision inside |x| <= hw)", [
        "wreck_sedan", "wreck_sedan_b", "wreck_pickup", "wreck_van", "wreck_flipped", "wreck_bus", "rb_wreck_car", "rb_wreck_van", "rb_wreck_small", "rb_wreck_stack", "rb_container"]),
]

HEADER = """# Structures (public/models/structures)

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
"""


def main():
    metas = {}
    for f in glob.glob(os.path.join(META, "*.json")):
        with open(f) as fh:
            m = json.load(fh)
        if os.path.exists(os.path.join(OUT, m["id"] + ".glb")):
            metas[m["id"]] = m
    placed, entries = set(), []
    md = [HEADER]
    total_kb = 0.0
    for gid, gtitle, ids in GROUPS:
        present = [i for i in ids if i in metas]
        extra = []
        if gid == "outpost":   # any leftover ids from forks go to their nearest group
            pass
        if not present:
            continue
        md.append("\n## %s\n" % gtitle)
        md.append("| id | tris | size (x, y, z m) | file KB | materials |\n|---|---|---|---|---|")
        for i in present:
            m = metas[i]
            md.append("| `%s` | %d | %s | %d | %s |" % (i, m["tris"], " x ".join("%.1f" % d for d in m["dims"]), m["size_kb"], ", ".join(m["materials"])))
        md.append("")
        for i in present:
            m = metas[i]
            placed.add(i)
            total_kb += m["size_kb"]
            e = dict(id=i, group=gid, file=m["file"], tris=m["tris"], collision_tris=m["collision_tris"], size_kb=m["size_kb"],
                     bbox_min=m["bbox_min"], bbox_max=m["bbox_max"], dims=m["dims"], materials=m["materials"],
                     nodes=sorted(m["nodes"].keys()) + (["collision"] if m["collision_tris"] else []), sockets=m["sockets"], notes=m["notes"])
            entries.append(e)
            md.append("### `%s`" % i)
            n = m["notes"]
            if isinstance(n, dict):
                if "desc" in n:
                    md.append(n["desc"])
                other = {k: v for k, v in n.items() if k != "desc"}
                for k, v in other.items():
                    md.append("* %s: %s" % (k, v if not isinstance(v, (list, dict)) else json.dumps(v)))
            elif n:
                md.append(str(n))
            md.append("* bbox min %s max %s; %d tris (+%d collision tris)" % (m["bbox_min"], m["bbox_max"], m["tris"], m["collision_tris"]))
            if m["sockets"]:
                md.append("* sockets: " + ", ".join("`%s` %s" % (k, v) for k, v in m["sockets"].items()))
            md.append("* nodes: " + ", ".join("`%s`" % k for k in sorted(m["nodes"].keys())) + (", `collision`" if m["collision_tris"] else ""))
            md.append("")
    rest = [i for i in metas if i not in placed]
    if rest:
        md.append("\n## Other\n")
        for i in sorted(rest):
            m = metas[i]
            total_kb += m["size_kb"]
            entries.append(dict(id=i, group="other", file=m["file"], tris=m["tris"], collision_tris=m["collision_tris"], size_kb=m["size_kb"],
                                bbox_min=m["bbox_min"], bbox_max=m["bbox_max"], dims=m["dims"], materials=m["materials"],
                                nodes=sorted(m["nodes"].keys()) + (["collision"] if m["collision_tris"] else []), sockets=m["sockets"], notes=m["notes"]))
            md.append("### `%s`\n%s\n* %d tris, dims %s\n" % (i, (m["notes"].get("desc", "") if isinstance(m["notes"], dict) else m["notes"]), m["tris"], m["dims"]))
    manifest = dict(generated=datetime.datetime.now().isoformat(timespec="seconds"), count=len(entries), total_kb=round(total_kb),
                    conventions="see README.md", structures=entries)
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    with open(os.path.join(OUT, "README.md"), "w") as fh:
        fh.write("\n".join(md) + "\n")
    print("manifest: %d structures, %.1f MB" % (len(entries), total_kb / 1024))


if __name__ == "__main__":
    main()
