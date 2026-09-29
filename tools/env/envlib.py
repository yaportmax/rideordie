"""Environment-prop helper library for Blender 4.5 (headless).  Builds on tools/blender/rod_lib.py.

    "C:/Dev/tools/Blender-4.5.11-portable/blender.exe" -b --factory-startup -P tools/env/props/<script>.py -- [args]

    import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))   # tools/env
    from envlib import *

CONTRACT (see docs/ASSET_SPEC.md, ENVIRONMENT):  meters, Blender Z-up (exports Y-up), origin at BASE CENTRE (min z = 0),
named materials, few materials per prop, baked vertex-colour AO in COLOR_0, tris budgets in the task brief.

Typical script:

    new_scene()
    rock_mat = pmat("rock_grey", tex="rock_grey", uv_m=2.0)          # textured material (512px props textures, see prep_prop_textures.py)
    mb = MB()                                                          # geometry accumulator, one bmesh per material
    mb.rock(rock_mat, seed=3, size=(1.2, 1.0, 0.8))                    # ... or mb.cyl / mb.box / mb.lathe / mb.tube ...
    finish("rock_s1", mb, category="rock", notes="...", ao=dict(samples=24, dist=0.8))

`finish` bakes AO, sets origin/pivot, exports public/models/props/<name>.glb and writes tools/env/props_manifest/<name>.json.
"""
import bpy
import bmesh
import math
import os
import sys
import json
import random
from mathutils import Vector, Matrix, Euler, noise as mnoise
from mathutils.bvhtree import BVHTree

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "blender"))
import rod_lib                                                  # noqa: E402
from rod_lib import ROOT, PUBLIC, D2R, argv, tri_count            # noqa: E402

PROPS_DIR = os.path.join(PUBLIC, "models", "props")
FRAG_DIR = os.path.join(_HERE, "props_manifest")
PTEX = os.environ.get("ROD_PROP_TEX", "C:/Dev/art_cache/rideordie/props_tex")   # 512px texture sets for props (prep_prop_textures.py)
_PM = {}


# ------------------------------------------------------------------------------------------------ scene / materials
def new_scene():
    rod_lib.reset()
    _PM.clear()
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


def _img(path, colorspace):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = colorspace
    return im


def _ao_group():
    g = bpy.data.node_groups.get("glTF Material Output")
    if g is None:
        g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


def pmat(name, tex=None, color=(0.8, 0.8, 0.8), rough=0.8, metal=0.0, uv_m=2.0, alpha=None, double_sided=False,
         emit=None, emit_strength=0.0, normal_strength=1.0, albedo_file=None, tex_dir=None, alpha_cutoff=0.5, spec=0.5, glow=0.0):
    """Named PBR material (cached).
       tex       = name of a texture set in PTEX ('<tex>_albedo.jpg', '<tex>_normal.jpg', '<tex>_arm.jpg') -> textured; else flat `color`.
       uv_m      = metres per texture tile (used by MB.project_uv; stored as custom prop 'uv_m').
       albedo_file = absolute path of an RGBA png/jpg used as base colour (foliage cards); alpha='MASK' -> alphaMode MASK (cutoff .5), 'BLEND' -> BLEND.
       Vertex colour (COLOR_0, baked AO) multiplies the base colour in three.js."""
    if name in _PM:
        return _PM[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    b.inputs["Base Color"].default_value = (*color[:3], 1.0)
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = spec      # 0.5 = default dielectric F0 0.04; foliage uses ~0.1 (exported as KHR_materials_specular)
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit[:3], 1.0)
        b.inputs["Emission Strength"].default_value = emit_strength
    tdir = tex_dir or PTEX
    if tex or albedo_file:
        ta = nt.nodes.new("ShaderNodeTexImage")
        ta.image = _img(albedo_file or os.path.join(tdir, tex + "_albedo.jpg"), "sRGB")
        ta.location = (-700, 300)
        nt.links.new(ta.outputs["Color"], b.inputs["Base Color"])
        if glow > 0:          # fake ambient / translucency floor: emissive = albedo * glow (foliage in shade must not go black)
            nt.links.new(ta.outputs["Color"], b.inputs["Emission Color"])
            b.inputs["Emission Strength"].default_value = glow
        if alpha == "BLEND":
            nt.links.new(ta.outputs["Alpha"], b.inputs["Alpha"])
        elif alpha == "MASK":          # exporter detects  Alpha -> [Math: greater than cutoff] -> Alpha   as alphaMode MASK + alphaCutoff
            mt = nt.nodes.new("ShaderNodeMath")
            mt.operation = "GREATER_THAN"
            mt.inputs[1].default_value = alpha_cutoff
            mt.location = (-350, 300)
            nt.links.new(ta.outputs["Alpha"], mt.inputs[0])
            nt.links.new(mt.outputs["Value"], b.inputs["Alpha"])
    if tex:
        pn = os.path.join(tdir, tex + "_normal.jpg")
        pa = os.path.join(tdir, tex + "_arm.jpg")
        if os.path.exists(pn):
            tn = nt.nodes.new("ShaderNodeTexImage")
            tn.image = _img(pn, "Non-Color")
            tn.location = (-700, -50)
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = normal_strength
            nm.location = (-350, -50)
            nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
        if os.path.exists(pa):
            tr = nt.nodes.new("ShaderNodeTexImage")
            tr.image = _img(pa, "Non-Color")
            tr.location = (-900, -400)
            sp = nt.nodes.new("ShaderNodeSeparateColor")
            sp.location = (-600, -400)
            nt.links.new(tr.outputs["Color"], sp.inputs["Color"])
            nt.links.new(sp.outputs["Green"], b.inputs["Roughness"])
            nt.links.new(sp.outputs["Blue"], b.inputs["Metallic"])
            g = nt.nodes.new("ShaderNodeGroup")
            g.node_tree = _ao_group()
            g.location = (300, -300)
            nt.links.new(sp.outputs["Red"], g.inputs["Occlusion"])
    if alpha == "MASK":
        try:
            m.surface_render_method = "DITHERED"
        except Exception:
            pass
    elif alpha == "BLEND":
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
    m.use_backface_culling = not double_sided
    m.diffuse_color = (*color[:3], 1.0)
    m["uv_m"] = float(uv_m)
    _PM[name] = m
    return m


# ------------------------------------------------------------------------------------------------ geometry builder
def _frame(axis):
    """orthonormal frame (u, v, w=axis) for an axis vector"""
    w = Vector(axis).normalized()
    t = Vector((0, 0, 1)) if abs(w.z) < 0.95 else Vector((1, 0, 0))
    u = t.cross(w).normalized()
    v = w.cross(u).normalized()
    return u, v, w


class MB:
    """Geometry accumulator: one bmesh per material.  All primitives take a material (from pmat()) as first argument.
       Methods return the list of created bmesh verts so callers can post-process (e.g. displace)."""

    def __init__(self):
        self.bms = {}     # material name -> (material, bmesh)
        self.smooth_mats = set()
        self.pinned = []  # [(bmesh face, desired normal Vector)]: open sheets whose orientation recalc_face_normals cannot know (plates)

    def bm(self, m):
        if m.name not in self.bms:
            self.bms[m.name] = (m, bmesh.new())
        return self.bms[m.name][1]

    # ---- primitives -------------------------------------------------------------------------------------------
    def box(self, m, center=(0, 0, 0), size=(1, 1, 1), rot=(0, 0, 0), bevel=0.0, segs=1, taper=None):
        """box (size x,y,z; rot = euler degrees XYZ); bevel in metres.  taper=(sx, sy): scale of the TOP face relative to bottom."""
        bm = self.bm(m)
        res = bmesh.ops.create_cube(bm, size=1.0)
        vs = res["verts"]
        for v in vs:
            k = v.co.z + 0.5
            sx, sy = (1.0, 1.0) if taper is None else (1 + (taper[0] - 1) * k, 1 + (taper[1] - 1) * k)
            v.co = Vector((v.co.x * size[0] * sx, v.co.y * size[1] * sy, v.co.z * size[2]))
        if bevel > 0:
            edges = list({e for v in vs for e in v.link_edges})
            r = bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=segs, affect="EDGES", profile=0.5)
            vs = [v for v in (set(vs) | set(r["verts"])) if v.is_valid]
        M = Matrix.Translation(center) @ Euler([a * D2R for a in rot]).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=M, verts=[v for v in vs if v.is_valid])
        return vs

    def cyl(self, m, p0, p1, r0, r1=None, seg=8, caps=(True, True), rings=1, profile=None, twist=0.0, smooth=True):
        """(tapered) cylinder from p0 to p1.  rings = number of segments along the axis; profile(t)->radius multiplier."""
        bm = self.bm(m)
        p0, p1 = Vector(p0), Vector(p1)
        u, v, w = _frame(p1 - p0)
        L = (p1 - p0).length
        r1 = r0 if r1 is None else r1
        rows = []
        for i in range(rings + 1):
            t = i / rings
            r = (r0 + (r1 - r0) * t) * (profile(t) if profile else 1.0)
            ring = []
            for j in range(seg):
                a = 2 * math.pi * j / seg + twist * t
                ring.append(bm.verts.new(p0 + w * (L * t) + (u * math.cos(a) + v * math.sin(a)) * r))
            rows.append(ring)
        for i in range(rings):
            for j in range(seg):
                a, b = rows[i][j], rows[i][(j + 1) % seg]
                c, d = rows[i + 1][(j + 1) % seg], rows[i + 1][j]
                bm.faces.new((a, b, c, d))
        allv = [x for r in rows for x in r]
        if caps[0] and r0 > 0:
            bm.faces.new(list(reversed(rows[0])))
        if caps[1] and (r1 * (profile(1.0) if profile else 1.0)) > 0:
            bm.faces.new(rows[-1])
        return allv

    def tube(self, m, pts, radii, seg=6, cap_start=False, cap_end=True, u_len=None):
        """sweep a circle along a polyline (parallel-transport frames). radii: list per point or float."""
        bm = self.bm(m)
        pts = [Vector(p) for p in pts]
        n = len(pts)
        if not isinstance(radii, (list, tuple)):
            radii = [radii] * n
        rows = []
        prev_u = None
        for i, p in enumerate(pts):
            d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
            if d.length < 1e-6:
                d = Vector((0, 0, 1))
            u, v, w = _frame(d)
            if prev_u is not None:      # parallel transport: keep u close to the previous u
                u2 = prev_u - w * prev_u.dot(w)
                if u2.length > 1e-6:
                    u = u2.normalized()
                    v = w.cross(u).normalized()
            prev_u = u
            ring = []
            for j in range(seg):
                a = 2 * math.pi * j / seg
                ring.append(bm.verts.new(p + (u * math.cos(a) + v * math.sin(a)) * radii[i]))
            rows.append(ring)
        for i in range(n - 1):
            for j in range(seg):
                bm.faces.new((rows[i][j], rows[i][(j + 1) % seg], rows[i + 1][(j + 1) % seg], rows[i + 1][j]))
        if cap_start and radii[0] > 0:
            bm.faces.new(list(reversed(rows[0])))
        if cap_end and radii[-1] > 0:
            bm.faces.new(rows[-1])
        return [x for r in rows for x in r]

    def lathe(self, m, profile, seg=16, center=(0, 0, 0), close=True, rot=(0, 0, 0)):
        """revolve [(radius, z), ...] around Z.  radius 0 points collapse to a single vertex.  close=True caps first/last points to the axis."""
        bm = self.bm(m)
        rows = []
        for (r, z) in profile:
            if r <= 1e-6:
                rows.append([bm.verts.new((0, 0, z))])
            else:
                rows.append([bm.verts.new((r * math.cos(2 * math.pi * j / seg), r * math.sin(2 * math.pi * j / seg), z)) for j in range(seg)])
        for i in range(len(rows) - 1):
            a, b = rows[i], rows[i + 1]
            for j in range(seg):
                j2 = (j + 1) % seg
                if len(a) == 1 and len(b) == 1:
                    continue
                if len(a) == 1:
                    bm.faces.new((a[0], b[j2], b[j]))
                elif len(b) == 1:
                    bm.faces.new((a[j], a[j2], b[0]))
                else:
                    bm.faces.new((a[j], a[j2], b[j2], b[j]))
        if close:
            if len(rows[0]) > 1:
                bm.faces.new(list(reversed(rows[0])))
            if len(rows[-1]) > 1:
                bm.faces.new(rows[-1])
        vs = [v for r in rows for v in r]
        M = Matrix.Translation(center) @ Euler([a * D2R for a in rot]).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=M, verts=vs)
        return vs

    def extrude(self, m, profile, y0, y1, center=(0, 0, 0), rot=(0, 0, 0), caps=True):
        """extrude a closed 2D profile [(x, z), ...] (counter-clockwise seen from -Y) along Y from y0 to y1."""
        bm = self.bm(m)
        a = [bm.verts.new((x, y0, z)) for (x, z) in profile]
        b = [bm.verts.new((x, y1, z)) for (x, z) in profile]
        n = len(profile)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], b[i], b[j], a[j]))
        if caps:
            bm.faces.new(list(reversed(a)))
            bm.faces.new(b)
        vs = a + b
        M = Matrix.Translation(center) @ Euler([r * D2R for r in rot]).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=M, verts=vs)
        return vs

    def sphere(self, m, center=(0, 0, 0), radius=(1, 1, 1), subdiv=2, rot=(0, 0, 0)):
        bm = self.bm(m)
        r = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
        vs = r["verts"]
        R = radius if isinstance(radius, (tuple, list)) else (radius,) * 3
        M = Matrix.Translation(center) @ Euler([a * D2R for a in rot]).to_matrix().to_4x4() @ Matrix.Diagonal((R[0], R[1], R[2], 1))
        bmesh.ops.transform(bm, matrix=M, verts=vs)
        return vs

    def cone(self, m, base, tip, radius, seg=8, cap=True):
        return self.cyl(m, base, tip, radius, 0.0, seg=seg, caps=(cap, False))

    def quad(self, m, p0, p1, p2, p3, uv=((0, 0), (1, 0), (1, 1), (0, 1)), double=False):
        """single quad with explicit UVs (uv per corner).  double=True also adds the flipped copy (for alpha cards viewed from both sides
        prefer a double-sided material instead)."""
        bm = self.bm(m)
        vs = [bm.verts.new(p) for p in (p0, p1, p2, p3)]
        f = bm.faces.new(vs)
        uvl = bm.loops.layers.uv.verify()
        for lp, t in zip(f.loops, uv):
            lp[uvl].uv = t
        return vs

    def card(self, m, base, width, height, yaw=0.0, lean=0.0, uv=(0, 0, 1, 1), bend=0.0, seg_h=1, twist=0.0):
        """upright foliage card (double-sided material expected).  base = bottom centre; yaw degrees about Z; lean degrees (tilts top toward yaw dir);
        bend = extra horizontal displacement of the top (m); uv = (u0, v0, u1, v1)."""
        bm = self.bm(m)
        uvl = bm.loops.layers.uv.verify()
        yaw_r = yaw * D2R
        dx, dy = math.cos(yaw_r), math.sin(yaw_r)              # card width direction
        nx, ny = -dy, dx                                        # card normal direction (horizontal)
        lr = lean * D2R
        rows = []
        for i in range(seg_h + 1):
            t = i / seg_h
            off = (math.sin(lr) * height + bend) * t * t if seg_h > 1 else (math.sin(lr) * height + bend) * t
            z = math.cos(lr) * height * t if abs(lean) > 0 else height * t
            c = Vector(base) + Vector((nx * off, ny * off, z))
            w = width * 0.5 * (1.0)
            rows.append((bm.verts.new(c - Vector((dx, dy, 0)) * w), bm.verts.new(c + Vector((dx, dy, 0)) * w), t))
        u0, v0, u1, v1 = uv
        for i in range(seg_h):
            (a0, a1, t0), (b0, b1, t1) = rows[i], rows[i + 1]
            f = bm.faces.new((a0, a1, b1, b0))
            for lp, (uu, vv) in zip(f.loops, ((u0, v0 + (v1 - v0) * t0), (u1, v0 + (v1 - v0) * t0), (u1, v0 + (v1 - v0) * t1), (u0, v0 + (v1 - v0) * t1))):
                lp[uvl].uv = (uu, vv)
        return [x for r in rows for x in r[:2]]

    # ---- rocks --------------------------------------------------------------------------------------------------
    def rock(self, m, seed=0, size=(1, 1, 1), center=(0, 0, 0), subdiv=3, cuts=7, rough=0.16, bury=0.12, flat_bottom=True, strata=0.0,
             rot_z=None, cut_strength=0.85, roundness=0.0, ridge=0.10, stretch=None):
        """angular rock: displaced icosphere + random planar cuts + fine noise.  size = full bbox extents (x,y,z); base sits at z=0 (buried by `bury`).
           strata > 0 adds horizontal layering steps (canyon sandstone).  roundness 0..1 softens the cuts (weathered boulders)."""
        bm = self.bm(m)
        rnd = random.Random(seed)
        r = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
        vs = r["verts"]
        off = Vector((rnd.uniform(-50, 50), rnd.uniform(-50, 50), rnd.uniform(-50, 50)))
        planes = []
        for _ in range(cuts):
            n = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0.25, 0.7))).normalized()
            planes.append((n, rnd.uniform(0.70, 0.90)))
        st = stretch or (1.0, 1.0, 1.0)
        for v in vs:
            p = v.co.copy()
            n1 = mnoise.fractal(p * 1.15 + off, 0.55, 2.0, 3)
            d = 1.0 + n1 * 0.42
            rd = 1.0 - abs(mnoise.noise(p * 2.3 + off * 1.3)) * 2.0
            d += ridge * rd
            p = p * d
            p = Vector((p.x * st[0], p.y * st[1], p.z * st[2]))
            for (n, dist) in planes:
                ex = p.dot(n) - dist
                if ex > 0:
                    p -= n * ex * cut_strength * (1.0 - 0.6 * roundness)
            u = p.normalized()
            p += u * (mnoise.fractal(p * 3.4 + off * 1.7, 0.6, 2.0, 3) * rough * 0.55 + mnoise.noise(p * 8.0 + off * 2.3) * rough * 0.12)
            if strata > 0:
                z = p.z * 3.0
                p.z += (z - math.floor(z) - 0.5) * strata * 0.06
                k = 0.5 + 0.5 * math.sin(z * 6.283)
                p.x *= 1 + strata * 0.04 * k
                p.y *= 1 + strata * 0.04 * k
            v.co = p
        mn = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs)))
        mx = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
        ext = mx - mn
        ang = (rnd.uniform(0, 2 * math.pi) if rot_z is None else rot_z * D2R)
        Rz = Matrix.Rotation(ang, 3, "Z")
        for v in vs:
            q = Vector(((v.co.x - (mn.x + mx.x) / 2) / ext.x * size[0], (v.co.y - (mn.y + mx.y) / 2) / ext.y * size[1], (v.co.z - mn.z) / ext.z * size[2]))
            q.z -= size[2] * bury
            if flat_bottom:
                q.z = max(q.z, 0.0)
            q = Rz @ q
            v.co = q + Vector(center)
        return vs

    # ---- finalize -----------------------------------------------------------------------------------------------
    def to_objects(self, name="prop", smooth_angle=35.0, shade_smooth=True):
        objs = []
        for mname, (m, bm) in self.bms.items():
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.normal_update()
            for (pf, pn) in self.pinned:
                if pf.is_valid and pf.normal.dot(pn) < 0:
                    pf.normal_flip()
            me = bpy.data.meshes.new(f"{name}_{mname}")
            bm.to_mesh(me)
            bm.free()
            me.materials.append(m)
            o = bpy.data.objects.new(f"{name}_{mname}" if len(self.bms) > 1 else name, me)
            bpy.context.collection.objects.link(o)
            objs.append(o)
        self.bms = {}
        if shade_smooth:
            for o in objs:
                for p in o.data.polygons:
                    p.use_smooth = True
                try:
                    bpy.context.view_layer.objects.active = o
                    for x in bpy.context.selected_objects:
                        x.select_set(False)
                    o.select_set(True)
                    bpy.ops.object.shade_smooth_by_angle(angle=smooth_angle * D2R)
                except Exception:
                    pass
        return objs


# ------------------------------------------------------------------------------------------------ UV / AO / LOD
def project_uv(obj, tile_m=None, scale=1.0):
    """triplanar-style UV in METRES / tile_m (per-face dominant axis). tile_m defaults to the material's custom prop 'uv_m'."""
    me = obj.data
    if tile_m is None:
        mm = me.materials[0] if me.materials else None
        tile_m = float(mm["uv_m"]) if mm is not None and "uv_m" in mm else 2.0
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.verify()
    W = obj.matrix_world
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            p = W @ lp.vert.co
            if ax == 0:
                uv = (p.y, p.z)
            elif ax == 1:
                uv = (p.x, p.z)
            else:
                uv = (p.x, p.y)
            lp[uvl].uv = (uv[0] / tile_m * scale, uv[1] / tile_m * scale)
    bm.to_mesh(me)
    bm.free()


def bake_ao(obj, samples=24, dist=1.0, strength=0.85, ground=True, gradient=0.25, tint=(1.0, 0.96, 0.9), seed=1, floor=0.25, others=None):
    """per-vertex ambient occlusion into a COLOR_0 attribute ('Col').  Rays are cast against the object itself (+ `others` objects, + the ground
       plane z=0 if ground).  gradient darkens vertices near the ground (0..1).  tint = colour of the fully occluded regions' multiplier bias."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    tree_bm = bmesh.new()
    tree_bm.from_mesh(me)
    W = obj.matrix_world
    tree_bm.transform(W)
    trees = [BVHTree.FromBMesh(tree_bm)]
    extra_bms = []
    for ob in others or []:
        b2 = bmesh.new()
        b2.from_mesh(ob.data)
        b2.transform(ob.matrix_world)
        extra_bms.append(b2)
        trees.append(BVHTree.FromBMesh(b2))
    rnd = random.Random(seed)
    dirs = []
    for i in range(samples):        # cosine-weighted hemisphere (z up), fixed set
        u1, u2 = (i + 0.5) / samples, (i * 0.61803398875) % 1.0
        r = math.sqrt(u1)
        th = 2 * math.pi * u2
        dirs.append(Vector((r * math.cos(th), r * math.sin(th), math.sqrt(max(0.0, 1 - u1)))))
    ao = []
    zmax = max((W @ v.co).z for v in bm.verts) or 1.0
    for v in bm.verts:
        p = W @ v.co
        n = (W.to_3x3() @ v.normal).normalized()
        u, w2, _n = _frame(n)
        occ = 0.0
        for d in dirs:
            dd = (u * d.x + w2 * d.y + n * d.z)
            o = p + n * 0.004
            hit = None
            for t in trees:
                h = t.ray_cast(o, dd, dist)
                if h[0] is not None and (hit is None or h[3] < hit):
                    hit = h[3]
            if ground and dd.z < -1e-4 and o.z > 0:
                tg = -o.z / dd.z
                if 0 < tg < dist and (hit is None or tg < hit):
                    hit = tg
            if hit is not None:
                occ += 1.0 - (hit / dist) ** 1.0 * 0.6
        occ /= samples
        a = 1.0 - strength * occ
        if gradient > 0 and ground:
            a *= 1.0 - gradient * max(0.0, 1.0 - p.z / max(0.6, zmax * 0.5)) * 0.6
        a = max(floor, min(1.0, a))
        ao.append(a)
    name = "Col"
    if name in me.color_attributes:
        me.color_attributes.remove(me.color_attributes[name])
    ca = me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    for i, a in enumerate(ao):
        t = 1.0 - a
        ca.data[i].color = (a * (1 - t * (1 - tint[0]) * 0.5), a * (1 - t * (1 - tint[1]) * 0.5), a * (1 - t * (1 - tint[2]) * 0.5), 1.0)
    me.color_attributes.active_color = ca
    try:
        me.color_attributes.render_color_index = list(me.color_attributes).index(ca)
    except Exception:
        pass
    bm.free()
    tree_bm.free()
    for b2 in extra_bms:
        b2.free()


def set_vertex_color(obj, rgb=(1, 1, 1), fn=None):
    """flat (or fn(world_pos, normal)->rgb) vertex colour, useful for foliage tinting / gradients"""
    me = obj.data
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    W = obj.matrix_world
    for i, v in enumerate(me.vertices):
        c = fn(W @ v.co, v.normal) if fn else rgb
        ca.data[i].color = (c[0], c[1], c[2], 1.0)
    me.color_attributes.active_color = ca


def decimate(obj, target_tris=None, ratio=None):
    """in-place decimate (collapse) to a triangle budget or ratio; applies the modifier."""
    me = obj.data
    me.calc_loop_triangles()
    cur = len(me.loop_triangles)
    r = ratio if ratio is not None else min(1.0, target_tris / max(1, cur))
    md = obj.modifiers.new("Dec", "DECIMATE")
    md.ratio = r
    bpy.context.view_layer.objects.active = obj
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    new = bpy.data.meshes.new_from_object(ev)
    obj.modifiers.remove(md)
    old = obj.data
    obj.data = new
    bpy.data.meshes.remove(old)


def duplicate(obj, name):
    o = obj.copy()
    o.data = obj.data.copy()
    o.name = name
    bpy.context.collection.objects.link(o)
    return o


# ------------------------------------------------------------------------------------------------ finish / export
def bounds(objs):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], p[i])
                mx[i] = max(mx[i], p[i])
    return mn, mx


def ground_and_center(objs, center_xy=True, min_z=0.0):
    """translate so bbox centre (XY) is at the origin and lowest point sits at z = min_z"""
    mn, mx = bounds(objs)
    d = Vector((-(mn.x + mx.x) / 2 if center_xy else 0.0, -(mn.y + mx.y) / 2 if center_xy else 0.0, min_z - mn.z))
    for o in objs:
        if o.parent is None:
            o.location += d
    bpy.context.view_layer.update()
    for o in objs:                     # bake the transform into vertices so that node origin = base centre
        me = o.data
        me.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)


def finish(name, mb_or_objs, category, notes="", ao=None, uv=True, center_xy=True, smooth_angle=35.0, export=True, extra=None,
           shade_smooth=True, keep_scene=False, lod_of=None, post=None, keep_origin=False, uv_m=None):
    """Turn an MB (or a list of objects) into the final prop: UV project (textured materials), centre on base, bake AO, export GLB, write manifest fragment.
       ao: dict for bake_ao (None = skip, {} = defaults).  post = optional callable(objs) run after AO (grime).  keep_origin = skip base-centre grounding.
       Returns list of objects."""
    if isinstance(mb_or_objs, MB):
        objs = mb_or_objs.to_objects(name, smooth_angle, shade_smooth)
    else:
        objs = list(mb_or_objs)
    if keep_origin:                    # keep authored coordinates (e.g. wire_span whose end points must stay at their attach heights)
        bpy.context.view_layer.update()
        for o in objs:
            o.data.transform(o.matrix_world)
            o.matrix_world = Matrix.Identity(4)
    else:
        ground_and_center(objs, center_xy=center_xy)
    if uv:
        for o in objs:
            m = o.data.materials[0] if o.data.materials else None
            if m is not None and any(n.type == "TEX_IMAGE" for n in m.node_tree.nodes) and not o.data.uv_layers:
                project_uv(o, tile_m=uv_m)
    if ao is not None:
        for o in objs:
            others = [x for x in objs if x is not o]
            bake_ao(o, others=others, **ao)
    elif not any(o.data.color_attributes for o in objs):
        for o in objs:
            set_vertex_color(o, (1, 1, 1))
    if post is not None:               # post(objs): e.g. multiply grime into the baked vertex colours before export
        post(objs)
    mn, mx = bounds(objs)
    tris = tri_count(objs)
    info = dict(name=name, file=f"{name}.glb", category=category, height=round(mx.z - mn.z, 3),
                radius=round(max(max(abs(mn.x), abs(mx.x)), max(abs(mn.y), abs(mx.y))), 3),
                size=[round(mx.x - mn.x, 3), round(mx.z - mn.z, 3), round(mx.y - mn.y, 3)],       # x, y(up), z as seen in three.js
                tris=tris, materials=sorted({m.name for o in objs for m in o.data.materials}), notes=notes)
    if extra:
        info.update(extra)
    if export:
        os.makedirs(FRAG_DIR, exist_ok=True)
        path = rod_lib.export_glb(os.path.join(PROPS_DIR, f"{name}.glb"), objs)
        info["kb"] = round(os.path.getsize(path) / 1024, 1)
        with open(os.path.join(FRAG_DIR, f"{name}.json"), "w") as f:
            json.dump(info, f, indent=1)
    print("PROP %-22s tris=%-6d h=%.2f r=%.2f  %s" % (name, tris, info["height"], info["radius"], info.get("kb", "")))
    if not keep_scene:
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
    return objs
