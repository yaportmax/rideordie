"""Distinct city raider double-decker, metres/+X left/+Y up/+Z forward.

Reuses the existing enemy_b geometry/texture/export toolchain without invoking
its shell wrappers, Cycles, a renderer or the original Claude checkout.
Run only with the root CPU asset-export lease:
  C:/Dev/tools/Blender-4.5.11-portable/blender.exe -b --factory-startup -P tools/blender/vehicles/city/e_double_bus.py
"""
from pathlib import Path
import json
import math
import struct
import sys

ROOT = Path(__file__).resolve().parents[4]
SOURCE = ROOT / "tools/blender/vehicles/enemy_b"
sys.path.insert(0, str(SOURCE))
from parts2 import Model, wheel_set2, bucket_seat2, steering_wheel2
from vlib import bpy, export_glb, G2B, Vector

OUT = ROOT / "public/models/vehicles/e_double_bus.glb"
META = ROOT / "src/data/city_bus_model_info.json"
if ROOT.name != "rideordie-fast-opt" or OUT.parent != ROOT / "public/models/vehicles":
    raise RuntimeError("Bus authoring must remain in the isolated optimization checkout")

DRIVER = (.68, .98, 3.46)
GUNNERS = ((.68, 2.45, 2.22), (-.68, 2.45, -1.85))
ZF, ZR, TRACK, RADIUS = 2.85, -2.90, 1.07, .50
ROOF = 4.20
m = Model("e_double_bus", seed=73, bake=False)
m.dirt_h = 1.45
m.tile_scale = .85


def box(material, size, at, bevel=.008):
    m.box(material, size, at=at, bevel=bevel, seg=1)


def shell():
    m.use("body")
    m.section("double-deck-shell")
    # Two real floor slabs, a long cab-over front and independently authored
    # window frames. There is no sedan/truck chassis underneath this shell.
    box("metal_dark", (2.30, .15, 9.22), (0, .66, 0))
    box("interior", (2.28, .12, 9.12), (0, 2.37, 0))
    for side in (1, -1):
        x = side * 1.22
        # Lower skirts leave actual arched wheel openings, rather than tyres
        # intersecting a giant flat box. Top strip supports the window band.
        for a, b in ((-4.58, ZR - .61), (ZR + .61, ZF - .61), (ZF + .61, 4.58)):
            box("paint", (.075, .53, b - a), (x, .89, (a + b) / 2))
        for z in (ZF, ZR):
            # Faceted rolled wheel-arch lip, half ring above the hub.
            for i in range(9):
                a0, a1 = math.pi * i / 9, math.pi * (i + 1) / 9
                p0 = (x, RADIUS + .61 * math.sin(a0), z + .61 * math.cos(a0))
                p1 = (x, RADIUS + .61 * math.sin(a1), z + .61 * math.cos(a1))
                m.beam("metal_dark", p0, p1, .11, .055, up=(side, 0, 0), bevel=0, seg=1)
        box("paint", (.075, .18, 9.20), (x, 1.20, 0))
        box("paint2", (.09, .26, 9.20), (x, 2.27, 0))
        box("paint", (.075, .17, 9.20), (x, 2.55, 0))
        box("paint2", (.09, .17, 9.20), (x, 4.08, 0))
        # Open, broken window apertures are modeled as gaps. No opaque glass
        # rectangle lies across either gunner's eye or firing height.
        for z in (-4.51, -3.25, -1.99, -.73, .53, 1.79, 3.05, 4.51):
            for y, h in ((1.70, .91), (3.32, 1.39)):
                box("paint", (.085, h, .075), (x, y, z))
        for y in (1.32, 2.09, 2.67, 3.98):
            box("metal_dark", (.095, .035, 9.16), (side * 1.235, y, 0), bevel=0)
        # Thin rub rail, side number plate, hinges and obvious patched sheet.
        box("metal_dark", (.045, .055, 9.06), (side * 1.266, 1.03, 0), bevel=0)
        box("paint2", (.024, .44, .95), (side * 1.27, .88, .30))
        for z in (-3.9, -1.2, 1.2, 3.75):
            box("rust", (.028, .11, .28), (side * 1.27, 1.11, z), bevel=0)
    # Front and rear caps keep their two-storey outline without filling glass
    # openings. Double horizontal bands make the silhouette read as a bus.
    for z in (-4.60, 4.60):
        for y, h, material in ((.86, .55, "paint"), (1.17, .13, "paint"), (2.27, .26, "paint2"), (2.55, .17, "paint"), (4.08, .17, "paint2")):
            box(material, (2.45, h, .075), (0, y, z))
        for x in (-1.19, 0, 1.19):
            box("paint", (.075, 1.02, .075), (x, 1.72, z))
            box("paint", (.075, 1.40, .075), (x, 3.32, z))
    # Cab front guard stays below the driver's head and the upper gun ports.
    box("metal_dark", (2.48, .22, .13), (0, .58, 4.68))
    for x in (-.95, -.60, -.25, .25, .60, .95):
        box("metal_dark", (.052, .32, .08), (x, .80, 4.69), bevel=0)
    box("metal_dark", (2.45, .17, .12), (0, .57, -4.68))


def roof_and_ports():
    m.section("roof-hatches-and-upper-ports")
    m.use("body")
    # Two proper cut roof openings around the standing stations. The center
    # spine, outer gutters and roof patches remain supported and opaque.
    box("paint2", (.42, .085, 9.24), (0, ROOF - .05, 0))
    for side, holeZ in ((1, GUNNERS[0][2]), (-1, GUNNERS[1][2])):
        box("paint", (.20, .085, 9.24), (side * 1.14, ROOF - .05, 0))
        for lo, hi in ((-4.62, holeZ - .68), (holeZ + .68, 4.62)):
            box("paint", (.83, .085, hi - lo), (side * .68, ROOF - .05, (lo + hi) / 2))
        for z in (holeZ - .70, holeZ + .70):
            box("metal_dark", (1.04, .075, .065), (side * .68, ROOF, z), bevel=0)
        for x in (side * .23, side * 1.12):
            box("metal_dark", (.065, .075, 1.45), (x, ROOF, holeZ), bevel=0)
    for index, (x, floor, z) in enumerate(GUNNERS):
        box("metal_dark", (.65, .04, .80), (x, floor - .02, z))
        # Waist-height gun pedestal and short armor lips do not cover the
        # human head zone or the muzzle at floor +1.35m.
        box("metal_dark", (.09, .76, .09), (x, floor + .38, z + .39))
        box("paint2", (.42, .035, .20), (x, floor + .78, z + .39))
        for sx in (-1, 1):
            m.cyl("metal_dark", (x + sx * .31, floor, z + .35), (x + sx * .31, floor + .86, z + .35), .018, seg=6)
        m.sock("seat_gunner" if index == 0 else "seat_gunner2", (x, floor, z))
        m.sock("gun_mount" if index == 0 else "gun_mount2", (x, floor + 1.35, z + .39))
    # Stair details/handrails communicate an actual second passenger deck.
    for i in range(8):
        box("interior", (.54, .11, .21), (-.58, .82 + i * .20, -3.72 + i * .18))
    m.cyl("metal_dark", (-.89, 1.08, -3.88), (-.89, 2.87, -2.53), .019, seg=6)
    for y in (1.41, 1.86, 2.31):
        m.cyl("metal_dark", (-.90, y - .24, -3.76), (-.90, y + .24, -3.38), .017, seg=6)


def interior_and_underbody():
    m.section("human-scale-cab-and-running-gear")
    m.use("body")
    box("interior", (2.20, .17, .56), (0, 1.22, 4.19))
    bucket_seat2(m, DRIVER, w=.48, back_h=.58, rake=10, torn=False)
    steering_wheel2(m, (.68, 1.34, 3.91), tilt=20, r=.18)
    m.sock("seat_driver", DRIVER)
    for y in (.92, 2.68):
        for z in (-2.50, -.90, .72):
            for side in (-1, 1):
                box("interior", (.45, .11, .40), (side * .68, y, z))
                box("interior", (.45, .47, .085), (side * .68, y + .25, z - .19))
    # Window guards and floor structure are all part of the same shell batch.
    for side in (-1, 1):
        box("metal_dark", (.14, .18, 8.60), (side * .72, .43, -.10))
        for z in (ZF, ZR):
            m.cyl("metal_dark", (-1.05, .50, z), (1.05, .50, z), .095, seg=8)
            box("metal_dark", (.11, .045, 1.15), (side * .77, .57, z))
            m.cyl("metal_dark", (side * .87, .80, z + .12), (side * 1.02, .53, z + .12), .035, seg=8)
    # Rear power pack and an actual side-mounted fuel tank/colored service cap.
    box("metal_dark", (1.70, .65, .88), (0, 1.05, -4.16))
    box("metal_dark", (.62, .42, 1.25), (-.78, .76, -2.15))
    for z in (-2.52, -1.78):
        box("metal_dark", (.66, .07, .065), (-.78, .75, z))
    m.cyl("decal_yellow", (-1.24, .86, -2.12), (-1.29, .86, -2.12), .075, seg=10)
    m.cyl("metal_dark", (.64, .41, -4.40), (.64, .41, -4.80), .062, seg=10)
    m.sock("fuel_cap", (-1.29, .86, -2.12))
    m.sock("weak_fuel", (-.78, .76, -2.15))
    m.sock("weak_engine", (0, 1.05, -4.18))
    m.sock("exhaust_R", (.64, .41, -4.80), rot=(0, 180, 0))
    m.sock("smoke_engine", (0, 1.30, -4.47))
    m.sock("roof_top", (0, ROOF, 0))
    m.sock("camera_hood", (0, 1.25, 4.1))


def service_panel_and_lamps():
    m.section("rear-weakpoint-service-hatch")
    m.panel("panel_trunk", (0, 1.43, -4.64))
    box("paint", (1.78, .69, .065), (0, 1.05, -4.65))
    for x in (-.74, -.53, -.32, -.11, .11, .32, .53, .74):
        box("metal_dark", (.10, .44, .035), (x, 1.04, -4.70), bevel=0)
    box("decal_yellow", (.44, .16, .026), (0, 1.33, -4.69), bevel=0)
    m.use("body")
    m.section("lamps-and-mirrors")
    for side in (-1, 1):
        box("metal_dark", (.36, .19, .10), (side * .90, 1.00, 4.65))
        box("light_head", (.28, .13, .020), (side * .90, 1.00, 4.716))
        box("decal_red", (.15, .25, .055), (side * 1.06, .93, -4.67))
        # Mirrors are ordinary-scale bus mirrors, not scaled crew equipment.
        m.cyl("metal_dark", (side * 1.20, 1.90, 4.28), (side * 1.38, 1.90, 4.26), .016, seg=6)
        box("metal_dark", (.075, .25, .15), (side * 1.39, 1.86, 4.25))
        m.sock("light_head_L" if side > 0 else "light_head_R", (side * .90, 1.00, 4.73))
        m.sock("light_tail_L" if side > 0 else "light_tail_R", (side * 1.06, .93, -4.71))
    # Physical destination-board bezel, without external branded artwork.
    box("metal_dark", (1.76, .23, .045), (0, 4.01, 4.66))
    box("paint2", (1.56, .095, .012), (0, 4.03, 4.689), bevel=0)


def consolidate_shell_materials():
    """Bound shell draws without destroying the unique bus model or pivots.

    Body has red PBR, cream PBR and headlamp primitives; rear hatch has one.
    Tire/rim materials remain on moving wheel instances; steering is separate.
    Existing texture wear/AO survives. Dark hardware is a vertex mask on red.
    """
    red = bpy.data.materials["paint"].copy()
    red.name = "city_bus_red"
    cream = bpy.data.materials["paint2"].copy()
    cream.name = "city_bus_cream"
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH" or ob.name.startswith("wheel_"):
            continue
        me = ob.data
        old = list(me.materials)
        old_indices = [p.material_index for p in me.polygons]
        ca = me.color_attributes.get("Col")
        targets, by_name = [], {}
        for index, material in enumerate(old):
            name = material.name
            target = material if name == "light_head" else cream if name in ("paint2", "decal_white") and ob.name == "body" else red
            if target.name not in by_name:
                by_name[target.name] = len(targets)
                targets.append(target)
            dark = name in ("metal_dark", "interior", "rubber", "leather", "fabric", "armor", "chrome", "rim", "plastic")
            if ca and dark:
                used = {vertex for poly, mi in zip(me.polygons, old_indices) if mi == index for vertex in poly.vertices}
                for vertex in used:
                    color = ca.data[vertex].color
                    ca.data[vertex].color = (color[0] * .042, color[1] * .042, color[2] * .045, color[3])
        me.materials.clear()
        for material in targets:
            me.materials.append(material)
        for poly, mi in zip(me.polygons, old_indices):
            name = old[mi].name
            target = old[mi] if name == "light_head" else cream if name in ("paint2", "decal_white") and ob.name == "body" else red
            poly.material_index = by_name[target.name]
        if ob.name == "panel_trunk":
            # Preserve the detachable node through GLTFLoader+mergeRigid:
            # two equal material slots produce a Group, merged to one draw.
            me.materials.append(red)
            for poly in list(me.polygons)[len(me.polygons) // 2:]:
                poly.material_index = 1


def metadata():
    bpy.context.view_layer.update()
    inv = G2B.inverted()
    points = []
    sockets, wheels, parts = {}, {}, {}
    for ob in bpy.context.scene.objects:
        point = inv @ ob.matrix_world.translation
        if ob.type == "EMPTY":
            sockets[ob.name] = [round(v, 6) for v in point]
        if ob.type != "MESH":
            continue
        ps = [inv @ (ob.matrix_world @ v.co) for v in ob.data.vertices]
        points.extend(ps)
        lo = [min(p[i] for p in ps) for i in range(3)]
        hi = [max(p[i] for p in ps) for i in range(3)]
        if ob.name.startswith("wheel_"):
            wheels[ob.name[6:]] = {"x": round(point.x, 6), "y": round(point.y, 6), "z": round(point.z, 6), "r": round((hi[1] - lo[1]) / 2, 6), "w": round(hi[0] - lo[0], 6)}
        if ob.name.startswith("panel_"):
            parts[ob.name] = {"min": [round(v, 6) for v in lo], "max": [round(v, 6) for v in hi]}
    return {"id": "e_double_bus", "wheels": wheels, "sockets": sockets, "parts": parts,
            "bbox": {"min": [round(min(p[i] for p in points), 6) for i in range(3)], "max": [round(max(p[i] for p in points), 6) for i in range(3)]},
            "bodyWidth": 2.50, "roofHeight": ROOF, "upperDeckFloor": 2.45, "staticPrimitiveBudget": 4,
            "authoring": "Distinct two-deck cab-over bus, open shattered windows, two roof gun apertures. No GPU/Cycles bake."}


def fixed_colors(path):
    """Set fixed bus colors on existing grayscale wear textures while keeping
    all primitive/node identities intact. Lossless pruning is a separate step.
    """
    raw = path.read_bytes()
    jl = struct.unpack_from("<I", raw, 12)[0]
    data = json.loads(raw[20:20 + jl])
    factors = {"city_bus_red": (.48, .033, .018, 1), "city_bus_cream": (.64, .59, .44, 1)}
    for material in data.get("materials", []):
        if material.get("name") in factors:
            material.setdefault("pbrMetallicRoughness", {})["baseColorFactor"] = factors[material["name"]]
    binary = raw[20 + jl:]
    encoded = json.dumps(data, separators=(",", ":")).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    path.write_bytes(struct.pack("<III", 0x46546C67, 2, 20 + len(encoded) + len(binary)) + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + binary)


wheel_set2(m, "city_bus", RADIUS, .34,
           [(TRACK, RADIUS, ZF), (-TRACK, RADIUS, ZF), (TRACK, RADIUS, ZR), (-TRACK, RADIUS, ZR)],
           ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"],
           lugs=10, tread_h=.02, style="mt", holes=6, nuts=6, seg=24, rim_ratio=.59, drum=True)
shell()
roof_and_ports()
interior_and_underbody()
service_panel_and_lamps()
m.finish(export=False, ao_rays=4, ao_dist=.65)
consolidate_shell_materials()
info = metadata()
OUT.parent.mkdir(parents=True, exist_ok=True)
export_glb(str(OUT), jpeg_q=82)
fixed_colors(OUT)
META.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
print("CITY_BUS_METADATA", META, json.dumps(info["bbox"]), flush=True)
