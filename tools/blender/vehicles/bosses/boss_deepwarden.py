"""Standalone Underground mining tractor, source-only WORK prototype.

Requires a ROOT execution lease. This file has not been parsed or executed.
Use Blender 4.5.11 with --repository <isolated checkout> --output-dir <WORK dir>.
No old enemy body scripts or runtime modules are imported. Generation never
writes public/src: the explicit output directory must stay below checkout/work.
"""
from pathlib import Path
import argparse
import json
import math
import sys


def arguments():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args(argv)
    repository = Path(args.repository).resolve()
    output = Path(args.output_dir).resolve()
    # Resolve first, including symlink/junction targets. No implicit production
    # destination and no --force escape hatch exist in this authoring prototype.
    work = (repository / "work").resolve()
    if repository.name != "rideordie-fast-opt" or work not in output.parents:
        raise RuntimeError("Deepwarden output must be a child of isolated checkout/work")
    if not (repository / "tools/blender/vehicles/enemy_b/vlib.py").is_file():
        raise RuntimeError("Expected project authoring library is missing")
    return repository, output


ROOT, OUTPUT = arguments()
sys.path.insert(0, str(ROOT / "tools/blender/vehicles/enemy_b"))
from parts2 import Model, wheel_set2, bucket_seat2, steering_wheel2
from vlib import bpy, export_glb, G2B

MODEL_ID = "boss_deepwarden"
DRIVER = (.46, 1.35, 2.02)
GUNNER = (0, 1.45, -.42)
ROOF = 2.64
HUBS = [(1.02, .66, 2.9), (-1.02, .66, 2.9),
        (1.02, .66, -1.1), (-1.02, .66, -1.1),
        (1.02, .66, -2.7), (-1.02, .66, -2.7)]
WHEEL_NAMES = ["wheel_FL", "wheel_FR", "wheel_ML", "wheel_MR", "wheel_RL", "wheel_RR"]
DRIVE_ZONE = {"c": [0, 1.16, 3.92], "h": [.28, .22, .32]}
# Authored hull boxes are metres in model ground frame. Front drum surfaces
# stay inside their corresponding boxes; the central exposed drive has no
# decorative cone or full-width hull box in front of it.
HULLS = [
    {"center": [0, .68, -.05], "half": [1.15, .12, 4.28]},
    {"center": [0, 1.89, 2.13], "half": [1.05, .79, 1.46]},
    {"center": [0, 1.75, -2.84], "half": [1.09, .54, 1.35]},
    {"center": [.90, 1.16, 4.03], "half": [.595, .595, .46]},
    {"center": [-.90, 1.16, 4.03], "half": [.595, .595, .46]},
]
m = Model(MODEL_ID, seed=117, bake=False)
m.dirt_h = 1.3
m.tile_scale = .82
m.split_single = r"^(panel_|part_|weak_|drill_)"
# Bound materials without borrowing a shell. Existing wear/AO textures remain.
m.alias.update({"chrome": "metal_bare", "spike": "metal_bare", "armor": "metal_dark",
                "plastic": "metal_dark", "rust": "metal_dark", "fabric": "leather"})


def box(material, size, at, rot=None, bevel=.009):
    m.box(material, size, at=at, rot=rot, bevel=bevel, seg=1)


def fasteners(points, material="metal_bare"):
    for x, y, z in points:
        m.cyl(material, (x, y, z), (x, y + .016, z), .014, seg=6)


def chassis_and_drive_train():
    m.use("body")
    m.section("mining-chassis")
    # Independent longitudinal rail frame and six suspension stations.
    for side in (1, -1):
        box("metal_dark", (.18, .22, 8.35), (side * .73, .65, -.03))
        for z in (2.9, -1.1, -2.7):
            m.cyl("metal_bare", (side * .59, .62, z), (side * 1.01, .62, z), .082, seg=10)
            m.beam("metal_dark", (side * .64, .96, z + .19), (side * .98, .64, z - .16), .085)
            m.cyl("metal_dark", (side * .68, 1.07, z - .23), (side * .97, .64, z - .23), .042, seg=8)
    for z in (-3.75, -2.0, -.3, 1.2, 3.75):
        box("metal_dark", (2.10, .10, .14), (0, .67, z))
    box("metal_dark", (2.22, .10, 7.93), (0, .73, -.05))
    for z in (-2.7, -1.1, 2.9):
        m.cyl("metal_dark", (-.88, .66, z), (.88, .66, z), .078, seg=10)
    m.cyl("metal_bare", (0, .61, -2.75), (0, .61, 2.87), .055, seg=10)
    # Mechanical backing under removable rear hatch, not a hollow box.
    box("metal_dark", (1.46, .70, 1.95), (0, 1.38, -2.95))
    for x in (-.49, 0, .49):
        box("metal_bare", (.21, .26, 1.49), (x, 1.79, -2.95))
    for side in (1, -1):
        m.tube("rubber", [(side * .54, 1.82, -2.06), (side * .76, 1.31, -1.67),
                           (side * .73, 1.02, 1.8), (side * .57, 1.04, 3.53)], .026, seg=7, bend=.08)


def low_wedge_cab():
    m.use("body")
    m.section("wedge-cab")
    box("interior", (1.98, .085, 2.71), (0, 1.24, 2.01))
    # A sloped armoured lower nose, cut glass/open window bays above it.
    box("paint", (2.06, .61, .23), (0, 1.56, 3.28), rot=(-18, 0, 0))
    box("paint2", (2.07, .07, 2.44), (0, ROOF, 1.99), bevel=.013)
    for side in (1, -1):
        x = side * 1.025
        box("paint", (.08, .51, 2.35), (x, 1.51, 2.05))
        for z in (.83, 2.01, 3.20):
            m.beam("paint2", (x, 1.76, z), (x, ROOF, z - .08), .065, bevel=.008)
        m.beam("paint2", (x, 2.15, 3.24), (x, 2.61, 2.99), .075)
        # Sparse cage behind panes; crew head is not hidden by a solid slab.
        m.beam("metal_dark", (side * .94, 1.27, 1.16), (side * .94, 2.58, 1.16), .047)
        box("glass", (.012, .49, .94), (x, 2.19, 2.66), bevel=0)
        box("glass", (.012, .54, .86), (x, 2.19, 1.40), bevel=0)
        m.panel("panel_door_L" if side > 0 else "panel_door_R", (x, 1.49, 2.10))
        box("paint", (.067, .45, 1.53), (x + side * .012, 1.54, 2.10))
        box("metal_bare", (.047, .035, .23), (x + side * .058, 1.72, 1.59))
        m.use("body")
    # Front windscreen is two modest transparent panes with a central seam.
    for x in (-.51, .51):
        box("glass", (.93, .51, .012), (x, 2.19, 3.20), rot=(-17, 0, 0), bevel=0)
    m.beam("paint2", (0, 1.86, 3.30), (0, 2.63, 3.08), .058)
    box("interior", (1.8, .11, .41), (0, 1.82, 2.78))
    box("metal_dark", (.40, .15, .04), (.46, 1.94, 2.68))
    for x in (.34, .49, .64):
        m.cyl("metal_bare", (x, 1.96, 2.65), (x, 1.96, 2.668), .035, seg=10)
    bucket_seat2(m, DRIVER, w=.49, back_h=.57, rake=11)
    steering_wheel2(m, (.46, 1.82, 2.49), tilt=23, r=.19)
    m.sock("seat_driver", DRIVER)
    m.sock("camera_hood", (.46, 1.70, 3.37))
    m.sock("roof_top", (0, ROOF, 1.94))


def gunner_station_and_power_pack():
    m.use("body")
    m.section("hydraulic-station")
    box("metal_dark", (2.17, .12, 2.19), (0, 1.39, -.43))
    # Driver roof ends ahead of the station. The gunner has open headroom.
    for side in (1, -1):
        for z in (-1.48, .54):
            m.cyl("metal_dark", (side * 1.01, 1.44, z), (side * 1.01, 2.17, z), .034, seg=8)
        m.beam("metal_dark", (side * 1.01, 2.17, -1.48), (side * 1.01, 2.17, .54), .038)
    # Rear shield only, below firing/eye height. No overhead cage or huge lip.
    box("paint2", (1.52, .45, .07), (0, 1.84, -1.51))
    m.sock("seat_gunner", GUNNER)
    m.sock("gun_mount", (0, 2.80, .03))
    for side in (1, -1):
        box("paint", (.09, .84, 2.54), (side * 1.02, 1.69, -2.89))
        for z in (-3.92, -2.02):
            box("paint2", (.052, .57, .075), (side * 1.08, 1.77, z))
        for z in (-3.70, -3.49, -3.28, -3.07, -2.86):
            box("metal_dark", (.016, .29, .10), (side * 1.08, 1.89, z), rot=(0, 0, 18))
    m.panel("panel_trunk", (0, 2.16, -2.93))
    box("paint", (2.05, .07, 2.59), (0, 2.16, -2.93), bevel=.012)
    fasteners([(x, 2.204, z) for x in (-.82, .82) for z in (-3.93, -2.01)])
    m.use("body")
    box("paint2", (2.13, .78, .08), (0, 1.72, -4.22))
    m.sock("fuel_cap", (-1.09, 1.79, -3.90))
    m.sock("smoke_engine", (0, 1.88, -2.85))
    for side in (1, -1):
        m.sock("nitro_L" if side > 0 else "nitro_R", (side * .67, 1.03, -4.34))
        m.sock("exhaust_L" if side > 0 else "exhaust_R", (side * .80, 1.22, -4.32))
        m.cyl("metal_dark", (side * .80, 1.22, -3.94), (side * .80, 1.22, -4.30), .055, seg=10)


def drills_and_exposed_drive():
    m.section("twin-boring-heads")
    for side, name in ((1, "drill_L"), (-1, "drill_R")):
        hub = (side * .90, 1.16, 4.03)
        m.obj(name, origin=hub)
        m.use(name)
        m.cyl("metal_dark", (hub[0], hub[1], 3.73), (hub[0], hub[1], 4.14), .38, seg=24)
        m.cyl("metal_bare", (hub[0], hub[1], 4.15), (hub[0], hub[1], 4.37), .47, seg=28)
        for i in range(12):
            angle = i * math.tau / 12
            x, y = hub[0] + math.cos(angle) * .48, hub[1] + math.sin(angle) * .48
            box("metal_bare", (.115, .115, .15), (x, y, 4.365), rot=(0, 0, math.degrees(angle)), bevel=.008)
        # This is an exposed flat cutter drum, not a cone over the weak drive.
        for i in range(8):
            angle = i * math.tau / 8
            x, y = hub[0] + math.cos(angle) * .28, hub[1] + math.sin(angle) * .28
            box("metal_dark", (.045, .045, .11), (x, y, 4.395), bevel=.005)
    m.use("body")
    for side in (1, -1):
        m.cyl("metal_dark", (side * .90, 1.16, 3.42), (side * .90, 1.16, 3.74), .26, seg=16)
        m.cyl("metal_bare", (side * .96, 1.23, 2.71), (side * .96, 1.23, 3.71), .05, seg=10)
        box("paint2", (.17, .10, 1.03), (side * .96, 1.41, 3.23))
    # Physical/readable vulnerable drive face spans the engine zone front.
    # Its shallow geometry is inside, not floating ahead of, that zone.
    m.obj("weak_drill_drive", origin=(0, 1.16, 4.21))
    m.use("weak_drill_drive")
    box("metal_bare", (.53, .41, .035), (0, 1.16, 4.212), bevel=.006)
    for x in (-.185, 0, .185):
        box("light_amber", (.065, .32, .015), (x, 1.16, 4.227), bevel=.003)
    m.sock("drill_drive", (0, 1.16, 4.23))
    m.use("body")
    for x in (-.34, .34):
        box("metal_dark", (.065, .57, .36), (x, 1.16, 4.01))


def external_panels_and_lamps():
    m.use("body")
    m.section("mining-armour-detail")
    for side in (1, -1):
        # Wheel arches follow each actual support station; no solid panel across
        # a tyre. The lower inner back plate remains after armour tears off.
        for z in (2.9, -1.1, -2.7):
            m.beam("metal_dark", (side * .84, 1.40, z - .49), (side * .84, 1.40, z + .49), .072)
        m.panel("panel_fender_L" if side > 0 else "panel_fender_R", (side * 1.02, 1.40, -1.12))
        for z in (2.9, -1.1, -2.7):
            box("paint", (.52, .075, 1.23), (side * 1.02, 1.43, z))
        m.use("body")
        for z in (-3.72, -3.22, -2.72):
            box("paint2", (.018, .22, .19), (side * 1.092, 1.39, z), rot=(0, 0, 32))
        # Amber work lamps are recessed and modest, never road-filling sprites.
        box("metal_dark", (.31, .16, .09), (side * .77, 2.51, 3.09))
        box("light_amber", (.20, .085, .019), (side * .77, 2.51, 3.146), bevel=.005)
        box("metal_dark", (.24, .17, .09), (side * .86, 1.01, -4.27))
        box("light_tail", (.17, .105, .022), (side * .86, 1.01, -4.327), bevel=.004)
        m.sock("light_head_L" if side > 0 else "light_head_R", (side * .77, 2.51, 3.146))
        m.sock("light_tail_L" if side > 0 else "light_tail_R", (side * .86, 1.01, -4.327))
    m.panel("panel_bumper_R", (0, .90, -4.39))
    box("paint2", (2.18, .16, .13), (0, .90, -4.39))
    m.use("body")
    # Bolts, protective hydraulic couplings and towing point are hand-authored.
    fasteners([(x, 1.475, z) for x in (-.93, .93) for z in (-3.75, -.45, 2.54)])
    m.cyl("metal_bare", (0, .80, -4.34), (0, .80, -4.45), .12, seg=12)


def extracted_metadata():
    bpy.context.view_layer.update()
    inverse = G2B.inverted()
    points, wheels, sockets, parts, groups = [], {}, {}, {}, {}
    triangles, primitives = 0, 0
    for obj in bpy.context.scene.objects:
        pivot = inverse @ obj.matrix_world.translation
        if obj.type == "EMPTY":
            sockets[obj.name] = [round(v, 6) for v in pivot]
            continue
        if obj.type != "MESH":
            continue
        verts = [inverse @ (obj.matrix_world @ v.co) for v in obj.data.vertices]
        if not verts:
            continue
        points.extend(verts)
        lo = [min(v[i] for v in verts) for i in range(3)]
        hi = [max(v[i] for v in verts) for i in range(3)]
        bounds = {"min": [round(v, 6) for v in lo], "max": [round(v, 6) for v in hi]}
        groups[obj.name] = {**bounds, "pivot": [round(v, 6) for v in pivot]}
        triangles += sum(len(face.vertices) - 2 for face in obj.data.polygons)
        primitives += len({face.material_index for face in obj.data.polygons})
        if obj.name.startswith("wheel_"):
            wheels[obj.name[6:]] = {"x": round(pivot.x, 6), "y": round(pivot.y, 6), "z": round(pivot.z, 6),
                                    "r": round((hi[1] - lo[1]) / 2, 6), "w": round(hi[0] - lo[0], 6)}
        if obj.name.startswith("panel_"):
            parts[obj.name] = bounds
    bbox = {"min": [round(min(v[i] for v in points), 6) for i in range(3)],
            "max": [round(max(v[i] for v in points), 6) for i in range(3)]}
    return {"id": MODEL_ID, "schema": 1, "encodedElite": 7, "baseSpec": "e_heavy",
            "bbox": bbox, "wheels": wheels, "sockets": sockets, "parts": parts, "groups": groups,
            "colliders": HULLS, "hitZones": {"engine": DRIVE_ZONE, "fuel": {"c": [0, 1.40, -3.16], "h": [.45, .27, .58]}},
            "crewModels": {"driver": "raider_driver2", "gunner": "raider_c2"},
            "spawnClearance": max(bbox["max"][1], GUNNER[1] + 1.85) + .25,
            "requiredNodes": ["body", *WHEEL_NAMES, "seat_driver", "seat_gunner", "gun_mount", "steering_wheel",
                              "drill_L", "drill_R", "weak_drill_drive", "drill_drive", "roof_top"],
            "budget": {"triangles": triangles, "primitives": primitives, "meshNodes": len(groups)},
            "provenance": {"author": "Ride or Die project procedural authoring", "source": "boss_deepwarden.py",
                           "bodySource": "independent geometry, no Hauler/Priest shell imports", "pipeline": "enemy_b Model/parts2/vmat", "seed": 117}}


wheel_set2(m, "deepwarden", .658, .465, HUBS, WHEEL_NAMES,
           lugs=15, tread_h=.04, style="mt", holes=8, nuts=8, seg=26, rim_ratio=.56)
chassis_and_drive_train()
low_wedge_cab()
gunner_station_and_power_pack()
drills_and_exposed_drive()
external_panels_and_lamps()
m.finish(export=False, ao_rays=4, ao_dist=.65)
# Actual generated counts, textures/materials, pivots and silhouettes must be
# reviewed after export. Do not copy metadata or GLB into production here.
info = extracted_metadata()
model_path = OUTPUT / "public/models/vehicles/boss_deepwarden.glb"
metadata_path = OUTPUT / "src/data/deepwarden_model_info.json"
model_path.parent.mkdir(parents=True, exist_ok=True)
metadata_path.parent.mkdir(parents=True, exist_ok=True)
export_glb(str(model_path), jpeg_q=82)
metadata_path.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
print("DEEPWARDEN_WORK_EXPORT", str(model_path), json.dumps(info["budget"]), flush=True)
