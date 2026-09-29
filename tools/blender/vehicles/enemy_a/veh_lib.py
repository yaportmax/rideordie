"""Vehicle-building helpers for the RIDE OR DIE enemy cars (enemy_a folder).

COORDINATES used by every helper in this file (they are converted to Blender axes inside):
    x = LEFT (+) / RIGHT (-)      f = FORWARD (+) / REAR (-)      z = UP
The exported glTF then has front on +Z, driver side (left) on +X.

Typical usage:
    from veh_lib import *
    V = Vehicle("e_sedan")
    bx("hood", (0, 1.5, 1.0), (1.6, 1.5, 0.05), "paint", g="panel_hood")
    ...
    V.finish(bake=True)
"""
import sys, os, math, random, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))          # tools/blender
from rod_lib import *                                         # bpy, bmesh, Vector, Matrix, Euler, mat, reset, ...
import rod_lib
from collections import defaultdict
from mathutils import bvhtree

OUT_DIR = os.path.join(PUBLIC, "models", "vehicles")
SCRATCH = os.path.join(ROOT, "shots", "enemy_a", "_bake")


def P(x, f, z):
    """(left, forward, up) -> Blender vector."""
    return Vector((x, -f, z))


def Pv(v):
    return P(v[0], v[1], v[2])


def _euler(pitch=0.0, yaw=0.0, roll=0.0):
    """pitch: nose-up positive; yaw: turn-left positive; roll: left-side-up positive (degrees)."""
    return Euler((-pitch * D2R, -roll * D2R, yaw * D2R), "XYZ")


# ------------------------------------------------------------------------------------------ registry
REG = defaultdict(list)     # group name -> [objects]     ('body', 'panel_hood', 'wheel_FL', ...)
SOCKETS = {}
PIVOTS = {}                 # panel group -> hinge/origin point (x,f,z)


def mark_flat(o):
    """Mark every face of o as 'flat-textured': it gets one uniform colour texel per material instead of its own UV island."""
    me = o.data
    a = me.attributes.get("flat") or me.attributes.new("flat", "INT", "FACE")
    a.data.foreach_set("value", [1] * len(me.polygons))


def reg(o, g):
    if g is not None:
        REG[g].append(o)
    try:
        vs = [v.co for v in o.data.vertices]
        if vs:
            dims = [max(v[i] for v in vs) - min(v[i] for v in vs) for i in range(3)]
            if max(dims) < 0.11:
                mark_flat(o)
    except Exception:
        pass
    return o


def pal():
    """Create the fixed material palette (names are the game contract).  Base colours are LINEAR."""
    M = {}
    M["paint"] = mat("paint", (0.80, 0.80, 0.80), metal=0.15, rough=0.5)
    M["paint2"] = mat("paint2", (0.80, 0.80, 0.80), metal=0.15, rough=0.5)
    M["metal_dark"] = mat("metal_dark", (0.045, 0.045, 0.05), metal=0.75, rough=0.55)
    M["metal_bare"] = mat("metal_bare", (0.42, 0.42, 0.44), metal=1.0, rough=0.42)
    M["rust"] = mat("rust", (0.30, 0.11, 0.045), metal=0.15, rough=0.9)
    M["chrome"] = mat("chrome", (0.85, 0.85, 0.88), metal=1.0, rough=0.14)
    M["rubber"] = mat("rubber", (0.02, 0.02, 0.02), metal=0.0, rough=0.85)
    M["rubber_tire"] = mat("rubber_tire", (0.018, 0.017, 0.016), metal=0.0, rough=0.92)
    M["rim"] = mat("rim", (0.30, 0.30, 0.31), metal=1.0, rough=0.5)
    M["armor"] = mat("armor", (0.11, 0.115, 0.105), metal=0.85, rough=0.6)
    M["spike"] = mat("spike", (0.30, 0.30, 0.32), metal=1.0, rough=0.35)
    M["plastic"] = mat("plastic", (0.035, 0.035, 0.037), metal=0.0, rough=0.6)
    M["interior"] = mat("interior", (0.07, 0.06, 0.05), metal=0.0, rough=0.9)
    M["fabric"] = mat("fabric", (0.14, 0.10, 0.075), metal=0.0, rough=0.95)
    M["leather"] = mat("leather", (0.10, 0.045, 0.02), metal=0.0, rough=0.7)
    M["wood"] = mat("wood", (0.20, 0.11, 0.05), metal=0.0, rough=0.8)
    M["canvas"] = mat("canvas", (0.36, 0.30, 0.20), metal=0.0, rough=0.95)
    M["brass"] = mat("brass", (0.55, 0.38, 0.10), metal=1.0, rough=0.35)
    M["glass"] = mat("glass", (0.055, 0.07, 0.065), metal=0.0, rough=0.06, alpha=0.40, double_sided=True)
    M["light_head"] = mat("light_head", (0.95, 0.90, 0.78), rough=0.12, emit=(1.0, 0.86, 0.58), emit_strength=3.0)
    M["light_tail"] = mat("light_tail", (0.30, 0.008, 0.006), rough=0.20, emit=(0.85, 0.03, 0.0), emit_strength=1.6)
    M["light_amber"] = mat("light_amber", (0.85, 0.34, 0.02), rough=0.18, emit=(1.0, 0.42, 0.03), emit_strength=2.5)
    M["cloth_red"] = mat("cloth_red", (0.32, 0.015, 0.01), metal=0.0, rough=0.95)
    M["cloth_dark"] = mat("cloth_dark", (0.04, 0.035, 0.03), metal=0.0, rough=0.95)
    M["cloth_tan"] = mat("cloth_tan", (0.30, 0.24, 0.15), metal=0.0, rough=0.95)
    M["gun_metal"] = mat("gun_metal", (0.09, 0.09, 0.10), metal=0.9, rough=0.4)
    M["gun_black"] = mat("gun_black", (0.02, 0.02, 0.022), metal=0.5, rough=0.5)
    M["gun_steel"] = mat("gun_steel", (0.30, 0.30, 0.32), metal=1.0, rough=0.35)
    M["polymer"] = mat("polymer", (0.03, 0.032, 0.03), metal=0.0, rough=0.6)
    return M


def _m(m):
    if isinstance(m, str):
        return rod_lib._MATS.get(m) or mat(m)
    return m


# ------------------------------------------------------------------------------------------ mesh objects
def _new_obj(name, bm, m=None, loc=None, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    if loc is not None:
        o.location = loc
    if parent is not None:
        o.parent = parent
    if m is not None:
        set_mat(o, _m(m))
    return o


def _finish(o, bevel=0.0, seg=2, angle=35.0):
    if bevel > 0:
        add_bevel(o, bevel, seg, angle)
        apply_modifiers(o)
    return o


def _fix_normals(bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def prism(name, pts, plane, lo, hi, m, bevel=0.0, seg=2, g=None, scale_hi=None):
    """Extrude a 2D polygon.  plane 'fz': pts=(f,z) extruded along x in [lo,hi]; 'xz': pts=(x,z) along f; 'xf': pts=(x,f) along z.
    scale_hi=(su,sv) optionally scales the polygon about its centroid on the hi side (tapered / wedge parts)."""
    def to3(u, v, w):
        if plane == "fz":
            return P(w, u, v)
        if plane == "xz":
            return P(u, w, v)
        return P(u, v, w)
    bm = bmesh.new()
    cu = sum(p[0] for p in pts) / len(pts)
    cv = sum(p[1] for p in pts) / len(pts)
    ring_lo = [bm.verts.new(to3(u, v, lo)) for u, v in pts]
    if scale_hi:
        ring_hi = [bm.verts.new(to3(cu + (u - cu) * scale_hi[0], cv + (v - cv) * scale_hi[1], hi)) for u, v in pts]
    else:
        ring_hi = [bm.verts.new(to3(u, v, hi)) for u, v in pts]
    n = len(pts)
    bm.faces.new(ring_lo)
    bm.faces.new(ring_hi[::-1])
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ring_lo[i], ring_lo[j], ring_hi[j], ring_hi[i]))
    _fix_normals(bm)
    o = _new_obj(name, bm, m)
    _finish(o, bevel, seg)
    return reg(o, g)


def hexa(name, c8, m, bevel=0.0, seg=2, g=None):
    """General hexahedron from 8 (x,f,z) corners: bottom 4 (ccw seen from above: rear-right, rear-left, front-left, front-right?) any order
    is fine as long as top corner i sits above bottom corner i.  Normals fixed automatically."""
    bm = bmesh.new()
    v = [bm.verts.new(Pv(c)) for c in c8]
    for f in [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]:
        bm.faces.new([v[i] for i in f])
    _fix_normals(bm)
    o = _new_obj(name, bm, m)
    _finish(o, bevel, seg)
    return reg(o, g)


def bx(name, c, s, m, bevel=0.0, seg=2, pitch=0.0, yaw=0.0, roll=0.0, g=None, taper=None):
    """Box centred at c=(x,f,z), size s=(sx,sf,sz).  taper=(kx,kz) scales the FRONT face (f+) cross-section by that factor (wedge/nose)."""
    sx, sf, sz = s[0] / 2, s[1] / 2, s[2] / 2
    bm = bmesh.new()
    kx, kz = taper if taper else (1.0, 1.0)
    pts = []
    for fs, k in ((-1, (1.0, 1.0)), (1, (kx, kz))):
        for zs in (-1, 1):
            for xs in (-1, 1):
                pts.append(bm.verts.new(P(xs * sx * k[0], fs * sf, zs * sz * k[1])))
    # index = f*4 + z*2 + x  (f: 0 rear, 1 front)
    F = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 2, 6, 4), (1, 5, 7, 3), (0, 4, 5, 1), (2, 3, 7, 6)]
    for f in F:
        bm.faces.new([pts[i] for i in f])
    _fix_normals(bm)
    o = _new_obj(name, bm, m)
    o.matrix_world = Matrix.Translation(P(*c)) @ _euler(pitch, yaw, roll).to_matrix().to_4x4()
    bpy.context.view_layer.update()
    _finish(o, bevel, seg)
    return reg(o, g)


def cyl(name, c, r, length, axis, m, sides=16, r2=None, bevel=0.0, caps=True, g=None, pitch=0.0, yaw=0.0, roll=0.0):
    """Cylinder/cone along axis 'x' | 'f' | 'z' centred on c.  r2 = radius at the +axis end (cone)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=sides, radius1=r, radius2=r if r2 is None else r2, depth=length)
    if axis == "x":
        bm.transform(Matrix.Rotation(math.pi / 2, 4, "Y"))
    elif axis == "f":
        bm.transform(Matrix.Rotation(-math.pi / 2, 4, "X"))    # +Z end -> forward (-Y)
    o = _new_obj(name, bm, m)
    o.matrix_world = Matrix.Translation(P(*c)) @ _euler(pitch, yaw, roll).to_matrix().to_4x4()
    bpy.context.view_layer.update()
    _finish(o, bevel, 2)
    return reg(o, g)


def ellipsoid(name, c, radii, m, seg=12, rings=8, g=None, pitch=0.0, yaw=0.0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    bm.transform(Matrix.Diagonal((radii[0], radii[1], radii[2], 1.0)))
    o = _new_obj(name, bm, m)
    o.matrix_world = Matrix.Translation(P(*c)) @ _euler(pitch, yaw, 0).to_matrix().to_4x4()
    bpy.context.view_layer.update()
    for p in o.data.polygons:
        p.use_smooth = True
    return reg(o, g)


def _catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return tuple(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
                 for a, b, c, d in zip(p0, p1, p2, p3))


def loft_f(name, stations, m, cap=True, subdiv=0, bevel=0.0, seg=2, g=None, smooth=False):
    """Loft closed cross-section rings along the forward axis.  stations = [(f, [(x,z), ...]), ...] (>=2, same ring length,
    ring points in a consistent winding).  subdiv=k inserts k Catmull-Rom interpolated stations between each pair."""
    st = sorted(stations, key=lambda s: s[0])
    n = len(st[0][1])
    for s in st:
        assert len(s[1]) == n, "ring size mismatch at f=%s (%d vs %d)" % (s[0], len(s[1]), n)
    if subdiv > 0:
        out = []
        for i in range(len(st) - 1):
            a, b = st[i], st[i + 1]
            pa = st[max(i - 1, 0)]
            pb = st[min(i + 2, len(st) - 1)]
            for k in range(subdiv + 1):
                t = k / (subdiv + 1)
                f = a[0] + (b[0] - a[0]) * t
                ring = []
                for j in range(n):
                    pt = _catmull(pa[1][j], a[1][j], b[1][j], pb[1][j], t)
                    ring.append(pt)
                out.append((f, ring))
        out.append(st[-1])
        st = out
    bm = bmesh.new()
    rings = []
    for f, ring in st:
        rings.append([bm.verts.new(P(x, f, z)) for x, z in ring])
    for i in range(len(rings) - 1):
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]))
    if cap:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    _fix_normals(bm)
    o = _new_obj(name, bm, m)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    _finish(o, bevel, seg)
    return reg(o, g)


def sym_ring(half):
    """half = [(x,z)...] listed from bottom-centre going up the +X side to the top-centre (x=0 entries at both ends). Returns closed ring."""
    right = [(-x, z) for x, z in half[1:-1]]
    return list(half) + right[::-1]


def rrect(w, h, r, n=4, cx=0.0, cy=0.0):
    """Rounded rectangle polygon (list of (u,v))."""
    r = min(r, w / 2, h / 2)
    pts = []
    for (sx, sy, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oy = cx + sx * (w / 2 - r), cy + sy * (h / 2 - r)
        for i in range(n + 1):
            a = (a0 + 90 * i / n) * D2R
            pts.append((ox + math.cos(a) * r, oy + math.sin(a) * r))
    return pts


def circle_pts(r, n=16, cx=0.0, cy=0.0, a0=0.0):
    return [(cx + math.cos(a0 * D2R + 2 * math.pi * i / n) * r, cy + math.sin(a0 * D2R + 2 * math.pi * i / n) * r) for i in range(n)]


# ------------------------------------------------------------------------------------------ tubes
def _fillet(pts, rad, n=4, closed=False):
    if len(pts) < 3 or rad <= 0:
        return pts
    out = []
    cnt = len(pts)
    for i in range(cnt):
        if not closed and (i == 0 or i == cnt - 1):
            out.append(pts[i])
            continue
        a, b, c = pts[(i - 1) % cnt], pts[i], pts[(i + 1) % cnt]
        d1, d2 = (a - b), (c - b)
        l1, l2 = d1.length, d2.length
        if l1 < 1e-6 or l2 < 1e-6:
            out.append(b)
            continue
        d1n, d2n = d1 / l1, d2 / l2
        ang = d1n.angle(d2n)
        if ang > math.pi - 0.02:
            out.append(b)
            continue
        t = min(rad / max(math.tan(ang / 2), 1e-4), l1 * 0.48, l2 * 0.48)
        p0, p1 = b + d1n * t, b + d2n * t
        for k in range(n + 1):
            s = k / n
            out.append(p0 * (1 - s) * (1 - s) + b * (2 * s * (1 - s)) + p1 * (s * s))
    return out


def tube(name, pts, r, m, fillet=0.0, closed=False, res=1, caps=True, g=None, fn=4, taper=None):
    """Round tube through (x,f,z) points with optional corner fillet radius.  res=1 -> 8-sided, 2 -> 12-sided."""
    P3 = [P(*p) for p in pts]
    if fillet > 0:
        P3 = _fillet(P3, fillet, fn, closed)
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(P3) - 1)
    for i, p in enumerate(P3):
        sp.points[i].co = (p.x, p.y, p.z, 1.0)
        if taper:
            sp.points[i].radius = taper[0] + (taper[1] - taper[0]) * i / max(len(P3) - 1, 1)
    sp.use_cyclic_u = closed
    cu.bevel_depth = r
    cu.bevel_resolution = res
    cu.use_fill_caps = caps and not closed
    co = bpy.data.objects.new(name + "_c", cu)
    bpy.context.collection.objects.link(co)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(co.evaluated_get(dg))
    bpy.data.objects.remove(co)
    bpy.data.curves.remove(cu)
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    set_mat(o, _m(m))
    for p in me.polygons:
        p.use_smooth = True
    if r <= 0.013:
        mark_flat(o)
    return reg(o, g)


def bolts(name, items, r, h, m, sides=6, g=None, cap_dome=False):
    """items = [((x,f,z), (nx,nf,nz)), ...] -> one mesh of small hex/round bolt heads sitting on a surface with outward normal n."""
    bm = bmesh.new()
    for c, n in items:
        nb = Pv(n).normalized()
        cb = Pv(c)
        q = Vector((0, 0, 1)).rotation_difference(nb)
        rm = q.to_matrix().to_4x4()
        top_r = r * (0.7 if cap_dome else 1.0)
        base = [bm.verts.new(cb + rm @ Vector((math.cos(a) * r, math.sin(a) * r, 0))) for a in [2 * math.pi * i / sides for i in range(sides)]]
        top = [bm.verts.new(cb + rm @ Vector((math.cos(a) * top_r, math.sin(a) * top_r, h))) for a in [2 * math.pi * i / sides for i in range(sides)]]
        bm.faces.new(top)
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((base[i], base[j], top[j], top[i]))
    _fix_normals(bm)
    o = _new_obj(name, bm, m)
    mark_flat(o)
    return reg(o, g)


# ------------------------------------------------------------------------------------------ booleans / transforms
def bool_op(target, cutter, op="DIFFERENCE", delete=True, solver="EXACT"):
    md = target.modifiers.new("bool", "BOOLEAN")
    md.operation = op
    md.object = cutter
    md.solver = solver
    if hasattr(md, "material_mode"):
        md.material_mode = "TRANSFER"
    apply_modifiers(target)
    if delete:
        remove(cutter)
    return target


def remove(o):
    if o.name in bpy.data.objects:
        me = o.data
        bpy.data.objects.remove(o)
        if me and me.users == 0:
            try:
                bpy.data.meshes.remove(me)
            except Exception:
                pass


def duplicate(o, name=None, mirror_x=False):
    n = o.copy()
    n.data = o.data.copy()
    if name:
        n.name = name
    bpy.context.collection.objects.link(n)
    if mirror_x:
        n.data.transform(Matrix.Diagonal((-1, 1, 1, 1)))
        n.data.flip_normals()
    return n


def mirror_obj(o, name=None, g=None):
    """Mirror across x=0 (left <-> right) and return a new object (normals fixed)."""
    n = o.copy()
    n.data = o.data.copy()
    n.name = name or (o.name + "_m")
    bpy.context.collection.objects.link(n)
    me = n.data
    M = Matrix.Diagonal((-1, 1, 1, 1))
    me.transform(M @ o.matrix_world)   # bake into data, object matrix reset below
    n.matrix_world = Matrix.Identity(4)
    me.flip_normals()
    return reg(n, g)


def bake_transform(o):
    """Apply the object's world transform into its mesh data (object -> identity)."""
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)


def set_origin(o, world_pt):
    bake_transform(o)
    o.data.transform(Matrix.Translation(-world_pt))
    o.location = world_pt


def merge(objs, name):
    for o in objs:
        if o.parent is not None or o.matrix_world != Matrix.Identity(4):
            pass
    if len(objs) == 1:
        objs[0].name = name
        objs[0].data.name = name
        return objs[0]
    for o in objs:
        bake_transform(o)
    return join(objs, name)


def sock(name, x, f, z, pitch=0.0, yaw=0.0, roll=0.0, size=0.12):
    if name in bpy.data.objects:                      # sockets own their contract names: rename any mesh part that took it
        bpy.data.objects[name].name = name + "_part"
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = "PLAIN_AXES"
    o.empty_display_size = size
    bpy.context.collection.objects.link(o)
    o.location = P(x, f, z)
    o.rotation_euler = _euler(pitch, yaw, roll)
    SOCKETS[name] = o
    return o


def lights_pair(name, c, kind="rect", size=(0.2, 0.12), mat_lens="light_head", depth=0.04, g="body", bezel="chrome", pitch=0.0):
    """One lamp at c=(x,f,z) facing forward (+f) [use pitch for tilt]; flips for rear lamps via size sign of depth not needed - see rear_lamp()."""
    pass


# ------------------------------------------------------------------------------------------ scattering helpers
def rrand(seed):
    return random.Random(seed)


def raycast_targets(objs):
    """Return a callable ray(origin, direction, dist) -> (hit_loc, normal) or None over the evaluated meshes of objs (world space)."""
    dg = bpy.context.evaluated_depsgraph_get()
    trees = []
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        trees.append(bvhtree.BVHTree.FromBMesh(bm))
        bm.free()

    def ray(origin, direction, dist=5.0):
        best = None
        for ti, t in enumerate(trees):
            h = t.ray_cast(origin, direction, dist)
            if h[0] is not None and (best is None or h[3] < best[3]):
                best = (h[0], h[1], h[2], h[3], ti)
        return None if best is None else (best[0], best[1], best[4])
    return ray


def decal_blob(name, ray, center, direction, radius, m, seed=0, n=11, offset=0.003, irregular=0.35, u_axis=None, g=None, grid=1):
    """Irregular flat blob (rust patch / grime) projected onto the target surfaces along `direction` (Blender-world vectors).
    center/direction are (x,f,z) tuples; returns object or None if the centre misses."""
    rnd = random.Random(seed)
    d = Pv(direction).normalized()
    c = Pv(center)
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((0, 1, 0))
    ux = d.cross(up).normalized()
    uy = d.cross(ux).normalized()
    origin_off = d * -0.6
    hits = []
    h0 = ray(c + origin_off, d, 1.5)
    if h0 is None:
        return None
    bm = bmesh.new()
    cv = bm.verts.new(h0[0] + h0[1] * offset)
    rim = []
    phase = rnd.random() * 6.28
    lobes = [rnd.uniform(-1, 1) for _ in range(4)]
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = radius * (1 + irregular * sum(l * math.sin((k + 2) * a + phase * (k + 1)) for k, l in enumerate(lobes)) / 2.2)
        rr = max(rr, radius * 0.35)
        for ring_i, kf in enumerate([1.0]):
            p = c + ux * (math.cos(a) * rr) + uy * (math.sin(a) * rr)
            h = ray(p + origin_off, d, 1.5)
            if h is None:
                # slide inwards until we hit
                for kk in (0.8, 0.6, 0.4):
                    p2 = c + ux * (math.cos(a) * rr * kk) + uy * (math.sin(a) * rr * kk)
                    h = ray(p2 + origin_off, d, 1.5)
                    if h is not None:
                        break
            if h is None:
                h = h0
            rim.append(bm.verts.new(h[0] + h[1] * offset))
    for i in range(n):
        bm.faces.new((cv, rim[i], rim[(i + 1) % n]))
    _fix_normals(bm)
    o = _new_obj(name, bm, m)
    o["hit"] = h0[2]
    # orient faces outward (against ray direction)
    for p in o.data.polygons:
        if p.normal.dot(d) > 0:
            o.data.flip_normals()
            break
    return reg(o, g)


# ------------------------------------------------------------------------------------------ more helpers
def quad_slab(name, q, t, m, out, g=None, bevel=0.0, seg=1):
    """Slab from an outer-face quad q=[(x,f,z)]*4 (any order around the quad), thickness t going against `out` (approx outward dir (x,f,z))."""
    pts = [Pv(p) for p in q]
    n = (pts[1] - pts[0]).cross(pts[3] - pts[0]).normalized()
    if n.dot(Pv(out)) < 0:
        n = -n
    bm = bmesh.new()
    a = [bm.verts.new(p) for p in pts]
    b = [bm.verts.new(p - n * t) for p in pts]
    bm.faces.new(a)
    bm.faces.new(b[::-1])
    for i in range(4):
        k = (i + 1) % 4
        bm.faces.new((a[i], a[k], b[k], b[i]))
    _fix_normals(bm)
    o = _new_obj(name, bm, m)
    _finish(o, bevel, seg)
    return reg(o, g)


def ring_pts(center, normal, r, n=16, up=(0, 0, 1), r2=None):
    """Points of a circle (radius r, optional ellipse r2 along `up`) centred at (x,f,z) with plane normal (x,f,z). Returns (x,f,z) tuples."""
    c = Pv(center)
    nb = Pv(normal).normalized()
    ub = Pv(up)
    ux = nb.cross(ub)
    if ux.length < 1e-6:
        ux = nb.cross(Vector((1, 0, 0)))
    ux.normalize()
    uy = nb.cross(ux).normalized()
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        p = c + ux * (math.cos(a) * r) + uy * (math.sin(a) * (r2 if r2 else r))
        out.append((p.x, -p.y, p.z))
    return out


def rect_rivets(center, axis, w, h, inset, spacing, sign=1.0):
    """Rivet positions around the perimeter of a rectangle on a plate.  axis 'x' (plate faces +-x, spans f and z), 'z' (faces up, spans x and f),
    'f' (faces forward/back, spans x and z).  center is the plate SURFACE centre (x,f,z)."""
    items = []
    cx, cf, cz = center
    hw, hh = w / 2 - inset, h / 2 - inset
    nx = max(int(2 * hw / spacing), 1)
    ny = max(int(2 * hh / spacing), 1)
    pos2 = []
    for i in range(nx + 1):
        u = -hw + 2 * hw * i / nx
        pos2 += [(u, -hh), (u, hh)]
    for j in range(1, ny):
        v = -hh + 2 * hh * j / ny
        pos2 += [(-hw, v), (hw, v)]
    for u, v in pos2:
        if axis == "x":
            items.append(((cx, cf + u, cz + v), (sign, 0, 0)))
        elif axis == "z":
            items.append(((cx + u, cf + v, cz), (0, 0, sign)))
        else:
            items.append(((cx + u, cf, cz + v), (0, sign, 0)))
    return items


def jag_poly(p0, p1, n, amp, seed=0):
    """Jagged line (list of 2D points) from p0 to p1 with n teeth (torch-cut / broken edges)."""
    r = random.Random(seed)
    out = [p0]
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy)
    nx, ny = -dy / L, dx / L
    for i in range(1, n):
        t = i / n
        a = r.uniform(-amp, amp)
        out.append((p0[0] + dx * t + nx * a, p0[1] + dy * t + ny * a))
    out.append(p1)
    return out


def deform_verts(o, fn):
    """Apply fn(Vector local co) -> Vector to every vertex of o's mesh (local space)."""
    for v in o.data.vertices:
        v.co = fn(v.co.copy())
    o.data.update()


def beam(name, p0, p1, wu, wv, m, u=(1, 0, 0), g=None, bevel=0.0, seg=1, taper=None):
    """Rectangular bar from p0 to p1 ((x,f,z) tuples).  Cross-section wu (along `u`, projected perpendicular to the bar) x wv."""
    a, b = Pv(p0), Pv(p1)
    d = (b - a)
    L = d.length
    d.normalize()
    ub = Pv(u)
    ub = (ub - d * ub.dot(d))
    if ub.length < 1e-5:
        ub = Vector((0, 0, 1)) - d * d.z
    ub.normalize()
    vb = d.cross(ub).normalized()
    k0, k1 = (taper if taper else (1.0, 1.0))
    bm = bmesh.new()
    ring0 = [bm.verts.new(a + ub * (sx * wu / 2 * k0) + vb * (sv * wv / 2 * k0)) for sx, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    ring1 = [bm.verts.new(b + ub * (sx * wu / 2 * k1) + vb * (sv * wv / 2 * k1)) for sx, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(ring0[::-1])
    bm.faces.new(ring1)
    for i in range(4):
        k = (i + 1) % 4
        bm.faces.new((ring0[i], ring0[k], ring1[k], ring1[i]))
    _fix_normals(bm)
    o = _new_obj(name, bm, m)
    _finish(o, bevel, seg)
    return reg(o, g)


def strip_wave(name, base, length, width, amp, waves, m, direction=(0, -1, 0), up=(0, 0, 1), nseg=8, thick=0.004, g=None, droop=0.0):
    """Cloth/rag strip: starts at `base` (x,f,z), extends along `direction` for `length`, `width` tall (along up), waves sideways. Thin solid."""
    bm = bmesh.new()
    b = Pv(base)
    d = Pv(direction).normalized()
    ub = Pv(up).normalized()
    sd = d.cross(ub).normalized()
    rows = []
    for i in range(nseg + 1):
        t = i / nseg
        off = sd * (math.sin(t * waves * math.pi) * amp * t) - ub * (droop * t * t)
        w = width * (1.0 - 0.25 * t)
        p0 = b + d * (length * t) + off
        rows.append((bm.verts.new(p0), bm.verts.new(p0 - ub * w)))
    for i in range(nseg):
        bm.faces.new((rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]))
    o = _new_obj(name, bm, m)
    md = o.modifiers.new("solid", "SOLIDIFY")
    md.thickness = thick
    md.offset = 0
    apply_modifiers(o)
    return reg(o, g)


def weld_line(name, p0, p1, seed=0, r=0.006, step=0.07, jitter=0.0025, m="metal_bare", g=None):
    """Bumpy weld bead between two (x,f,z) points."""
    rnd = random.Random(seed)
    a, b = Vector(p0), Vector(p1)
    n = max(int((b - a).length / step), 2)
    pts = []
    for i in range(n + 1):
        t = i / n
        q = a + (b - a) * t
        pts.append((q.x + rnd.uniform(-jitter, jitter), q.y + rnd.uniform(-jitter, jitter), q.z + rnd.uniform(-jitter, jitter)))
    return tube(name, pts, r, m, res=0, g=g)
