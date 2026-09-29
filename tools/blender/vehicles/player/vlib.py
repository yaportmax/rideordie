"""vlib - geometry kit for the RIDE OR DIE player trucks (headless Blender 4.5).

Truck code is written in GAME coordinates  (x, f, z):
    x = +LEFT (driver side), f = +FORWARD (nose), z = +UP,  origin on the ground under the vehicle centre.
`P(x, f, z)` converts to Blender coordinates (x, -f, z) - the exporter then gives +Z-forward glTF.
Rotations are (pitch, yaw, roll) in degrees: pitch + = nose up, yaw + = nose turns LEFT (+x), roll + = left side goes up.

A `Part` accumulates many primitives (boxes, cylinders, sweeps, lofts, curved CDT shells...) into one bmesh with a
material slot per palette name, and becomes one Blender object (= one glTF node) via Part.build().
"""
import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Vector, Matrix, Euler, geometry

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
import rod_lib  # noqa: E402
from rod_lib import ROOT, PUBLIC, D2R  # noqa: E402

SMOOTH_ANGLE = 48.0 * D2R
DENT_K = 1.0            # global dent amplitude multiplier (set per tier by build.py)


def P(x, f, z):
    return Vector((x, -f, z))


def PV(v):
    return Vector((v[0], -v[1], v[2]))


def G(v):
    return (v[0], -v[1], v[2])


def rotm(pitch=0.0, yaw=0.0, roll=0.0):
    return (Matrix.Rotation(yaw * D2R, 4, 'Z') @ Matrix.Rotation(-pitch * D2R, 4, 'X') @ Matrix.Rotation(-roll * D2R, 4, 'Y'))


AXES = {'x': Vector((1, 0, 0)), 'f': Vector((0, -1, 0)), 'z': Vector((0, 0, 1))}


def axis_matrix(axis):
    """Matrix taking +Z (cone axis) onto the requested game axis / vector (Blender coords)."""
    v = AXES[axis] if isinstance(axis, str) else Vector(axis).normalized()
    return Vector((0, 0, 1)).rotation_difference(v).to_matrix().to_4x4()


# ------------------------------------------------------------------------------------------------- materials
PAL = {
    # tintable: near-white base, grayscale wear comes from texture + vertex colours
    'paint': dict(base=(0.92, 0.92, 0.92), metal=0.0, rough=0.48, clearcoat=0.25),
    'paint2': dict(base=(0.92, 0.92, 0.92), metal=0.0, rough=0.5, clearcoat=0.2),
    'metal_dark': dict(base=(0.045, 0.045, 0.05), metal=0.7, rough=0.5),
    'metal_bare': dict(base=(0.42, 0.42, 0.44), metal=1.0, rough=0.5),
    'rust': dict(base=(0.30, 0.115, 0.045), metal=0.25, rough=0.88),
    'chrome': dict(base=(0.9, 0.9, 0.92), metal=1.0, rough=0.09),
    'rubber': dict(base=(0.028, 0.028, 0.03), metal=0.0, rough=0.85),
    'rubber_tire': dict(base=(0.022, 0.022, 0.022), metal=0.0, rough=0.93),
    'rim': dict(base=(0.34, 0.34, 0.36), metal=0.9, rough=0.42),
    'armor': dict(base=(0.085, 0.09, 0.09), metal=0.6, rough=0.58),
    'spike': dict(base=(0.5, 0.48, 0.45), metal=1.0, rough=0.32),
    'plastic': dict(base=(0.06, 0.06, 0.065), metal=0.0, rough=0.55),
    'interior': dict(base=(0.16, 0.145, 0.125), metal=0.0, rough=0.8),
    'fabric': dict(base=(0.30, 0.22, 0.14), metal=0.0, rough=0.96),
    'leather': dict(base=(0.11, 0.065, 0.04), metal=0.0, rough=0.5),
    'wood': dict(base=(0.28, 0.17, 0.085), metal=0.0, rough=0.85),
    'canvas': dict(base=(0.34, 0.29, 0.19), metal=0.0, rough=0.95),
    'brass': dict(base=(0.75, 0.55, 0.2), metal=1.0, rough=0.3),
    'glass': dict(base=(0.5, 0.6, 0.58), alpha=0.38, metal=0.0, rough=0.04, double_sided=True),
    'light_head': dict(base=(1.0, 0.95, 0.85), emit=(1.0, 0.93, 0.78), emit_strength=3.0, rough=0.2),
    'light_tail': dict(base=(0.6, 0.02, 0.01), emit=(1.0, 0.04, 0.02), emit_strength=2.5, rough=0.25),
    'light_amber': dict(base=(0.9, 0.45, 0.05), emit=(1.0, 0.5, 0.06), emit_strength=3.0, rough=0.25),
    'glass_lens': dict(base=(0.85, 0.9, 0.95), alpha=0.25, metal=0.0, rough=0.03, double_sided=True),
    'decal': dict(base=(1.0, 1.0, 1.0), metal=0.0, rough=0.55),
}
TEXTURED = {}      # material name -> bpy image (multiplied into base colour)
import copy as _copy
_PAL0 = _copy.deepcopy(PAL)


def M(name):
    """Palette material by name (created on first use)."""
    if name in rod_lib._MATS:
        return rod_lib._MATS[name]
    kw = dict(PAL[name])
    return rod_lib.mat(name, **kw)


def override_palette(**kw):
    """override_palette(paint=dict(rough=0.6), ...) before materials are created."""
    for k, v in kw.items():
        PAL[k] = {**PAL[k], **v}


# ------------------------------------------------------------------------------------------------- helpers
def _bevel(bm, w, segs=2, edges=None):
    if w <= 0:
        return
    geom_ = edges if edges is not None else list(bm.edges)
    if not geom_:
        return
    try:
        bmesh.ops.bevel(bm, geom=geom_, offset=w, offset_type='OFFSET', segments=segs, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    except Exception as e:  # noqa
        print("bevel failed", e)


def _cap_edges(bm):
    out = []
    for e in bm.edges:
        for f in e.link_faces:
            if len(f.verts) > 4:
                out.append(e)
                break
    return out


def fillet_path(pts, rad, k=5, closed=False):
    """Round the corners of a polyline with quadratic Bezier arcs (radius ~ rad)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    out = []
    rng = range(n) if closed else range(1, n - 1)
    if not closed:
        out.append(pts[0])
    for i in rng:
        p0, p1, p2 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n]
        d0, d1 = p0 - p1, p2 - p1
        l0, l1 = d0.length, d1.length
        r = min(rad, l0 * 0.48, l1 * 0.48)
        if r < 1e-5:
            out.append(p1)
            continue
        a, b = p1 + d0.normalized() * r, p1 + d1.normalized() * r
        for s in range(k + 1):
            t = s / k
            out.append(a * (1 - t) ** 2 + p1 * (2 * (1 - t) * t) + b * (t * t))
    if not closed:
        out.append(pts[-1])
    return out


def circle_prof(r, n=10, sx=1.0, sy=1.0):
    return [(r * sx * math.cos(2 * math.pi * i / n), r * sy * math.sin(2 * math.pi * i / n)) for i in range(n)]


def rrect_prof(w, h, r, k=2):
    """Rounded rectangle profile (a=right, b=up), CCW."""
    r = min(r, w / 2 - 1e-5, h / 2 - 1e-5)
    pts = []
    corners = [(w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)]
    for cx, cy, a0 in corners:
        if r < 1e-4:
            pts.append((cx, cy))
            continue
        for s in range(k + 1):
            a = (a0 + 90 * s / k) * D2R
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def pip(pt, poly):
    """point in polygon (2D)."""
    x, y = pt
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def seg_dist(p, a, b):
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0 if l2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def densify(poly, dens):
    out = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        k = max(1, int(math.ceil(L / dens)))
        for s in range(k):
            t = s / k
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def arc_pts(cx, cy, r, a0, a1, n):
    """points on an arc, angles in degrees (inclusive)."""
    return [(cx + r * math.cos((a0 + (a1 - a0) * i / n) * D2R), cy + r * math.sin((a0 + (a1 - a0) * i / n) * D2R)) for i in range(n + 1)]


def rrect_poly(u0, v0, u1, v1, r=0.0, k=4, r_tl=None, r_tr=None, r_bl=None, r_br=None):
    """rounded rect polygon CCW in (u,v). per-corner radii optional."""
    r_tl = r if r_tl is None else r_tl
    r_tr = r if r_tr is None else r_tr
    r_bl = r if r_bl is None else r_bl
    r_br = r if r_br is None else r_br
    pts = []

    def corner(cx, cy, rr, a0):
        if rr < 1e-4:
            pts.append((cx, cy))
        else:
            pts.extend(arc_pts(cx, cy, rr, a0, a0 + 90, k))
    corner(u1 - r_br, v0 + r_br, r_br, -90)
    corner(u1 - r_tr, v1 - r_tr, r_tr, 0)
    corner(u0 + r_tl, v1 - r_tl, r_tl, 90)
    corner(u0 + r_bl, v0 + r_bl, r_bl, 180)
    # dedupe
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) > 1e-6:
            out.append(p)
    return out


def arch_arc(fc, zc, r, zb, step=12.0):
    """Points (f,z) of a wheel-arch circle from its rear intersection with the line z=zb, over the top, to the front
    intersection (increasing f).  Returns [] if the circle does not reach zb."""
    dz = zb - zc
    if abs(dz) >= r:
        return []
    al = math.degrees(math.asin(dz / r))
    t0, t1 = 180.0 - al, al
    n = max(3, int(math.ceil((t0 - t1) / step)))
    return [(fc + r * math.cos((t0 + (t1 - t0) * i / n) * D2R), zc + r * math.sin((t0 + (t1 - t0) * i / n) * D2R)) for i in range(n + 1)]


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a + 1e-12)))
    return t * t * (3 - 2 * t)


def gauss(d, r):
    return math.exp(-(d / r) ** 2)


# ------------------------------------------------------------------------------------------------- Part
DECALS = []            # decal specs: dict(rect=(u0,v0,u1,v1), solid=bool, o=Vector, u=Vector, v=Vector, w=, h=)  (Blender coords); face attr 'decal' = index+1
_ATLAS = None


def atlas_rects():
    global _ATLAS
    if _ATLAS is None:
        import json
        with open(os.path.join(HERE, 'tex', 'decal_atlas.json')) as fh:
            _ATLAS = json.load(fh)
    return _ATLAS


def decal_spec(name, o=None, u=None, v=None, w=1.0, h=1.0, sub=None):
    """Register a decal (atlas rect `name`); solid swatches (name 'sw_*') need no frame. Returns its id (>0).
    sub=(a0,b0,a1,b1) picks a sub-rectangle of the atlas rect (0..1)."""
    r = list(atlas_rects()[name])
    if sub is not None:
        du, dv = r[2] - r[0], r[3] - r[1]
        r = [r[0] + du * sub[0], r[1] + dv * sub[1], r[0] + du * sub[2], r[1] + dv * sub[3]]
    DECALS.append(dict(rect=r, solid=o is None, o=o, u=u, v=v, w=w, h=h))
    return len(DECALS)


class Part:
    def __init__(self, name, origin=(0, 0, 0), parent=None, mesh_name=None):
        self.name = name
        self.origin = P(*origin)
        self.bm = bmesh.new()
        self.dl = self.bm.faces.layers.int.new('decal')
        self.cur_decal = 0
        self.mats = []
        self.parent = parent
        self.mesh_name = mesh_name or (name + "_mesh")
        self.obj = None

    # -- decals: faces added while a decal id is set carry it (UVs are assigned after box_uv, see post.decal_uv)
    def swatch(self, name):
        """set the solid-colour swatch (atlas 'sw_<name>') for following 'decal' geometry; None to clear"""
        self.cur_decal = 0 if name is None else decal_spec('sw_' + name)
        return self

    def sticker(self, name, c, nrm, up, w, h, lift=0.0015, sub=None, rot=0.0):
        """Flat quad sticker (atlas rect `name`) centred at c (game coords) on a surface with normal nrm, `up` = sticker up direction."""
        n = PV(nrm).normalized()
        upv = PV(up)
        upv = (upv - n * upv.dot(n)).normalized()
        rt = upv.cross(n).normalized()            # sticker +u (to the right when looking at it)
        if rot:
            q = Matrix.Rotation(rot * D2R, 3, n)
            rt, upv = q @ rt, q @ upv
        cc = P(*c) + n * lift
        did = decal_spec(name, o=cc, u=rt, v=upv, w=w, h=h, sub=sub)
        prev = self.cur_decal
        self.cur_decal = did
        vs = [cc - rt * w / 2 - upv * h / 2, cc + rt * w / 2 - upv * h / 2, cc + rt * w / 2 + upv * h / 2, cc - rt * w / 2 + upv * h / 2]
        bm = bmesh.new()
        bv = [bm.verts.new(v) for v in vs]
        bm.faces.new(bv)
        self.add_bm(bm, 'decal')
        self.cur_decal = prev

    # -- low level
    def slot(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def add_bm(self, src, m, xf=None, m2=None):
        """Copy bmesh `src` into the part.  Faces with material_index 1 use m2 (if given)."""
        bm = self.bm
        idx = [self.slot(m)]
        if m2 is not None:
            idx.append(self.slot(m2))
        vmap = {}
        for v in src.verts:
            vmap[v] = bm.verts.new(xf @ v.co if xf is not None else v.co)
        dl, cd = self.dl, self.cur_decal
        for f in src.faces:
            try:
                nf = bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = idx[min(f.material_index, len(idx) - 1)]
            if cd:
                nf[dl] = cd
        src.free()

    def raw(self, m, verts, faces, xf=None):
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in verts]
        for f in faces:
            try:
                bm.faces.new([vs[i] for i in f])
            except ValueError:
                pass
        self.add_bm(bm, m, xf)

    # -- primitives ---------------------------------------------------------------------------------
    def box(self, m, c, s, rot=None, bev=0.008, seg=1, taper=None, shear=None):
        """Box centred at c (x,f,z) of size s (sx,sf,sz).  taper=(kx,kf) scales the top; shear=(dx,df) shifts the top."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            top = v.co.z > 0
            x, y, z = v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]
            if top and taper:
                x *= taper[0]
                y *= taper[1]
            if top and shear:
                x += shear[0]
                y -= shear[1]
            v.co = Vector((x, y, z))
        _bevel(bm, min(bev, min(s) * 0.45), seg)
        xf = Matrix.Translation(P(*c)) @ (rotm(*rot) if rot else Matrix.Identity(4))
        self.add_bm(bm, m, xf)

    def cyl(self, m, c, r, h, axis='z', n=16, r2=None, bev=0.0, caps=True, rot=None, seg=1):
        """Cylinder / cone centred at c.  r at the -axis end, r2 at the +axis end."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=n, radius1=r, radius2=(r if r2 is None else r2), depth=h)
        if bev > 0:
            _bevel(bm, min(bev, r * 0.6), seg, _cap_edges(bm))
        xf = Matrix.Translation(P(*c)) @ (rotm(*rot) if rot else Matrix.Identity(4)) @ axis_matrix(axis)
        self.add_bm(bm, m, xf)

    def cyl2(self, m, a, b, r, r2=None, n=12, caps=True, bev=0.0):
        """Cylinder/cone between two game-space points."""
        A, B = P(*a), P(*b)
        d = B - A
        h = d.length
        if h < 1e-6:
            return
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=n, radius1=r, radius2=(r if r2 is None else r2), depth=h)
        if bev > 0:
            _bevel(bm, min(bev, r * 0.6), 2, _cap_edges(bm))
        xf = Matrix.Translation((A + B) / 2) @ axis_matrix(d)
        self.add_bm(bm, m, xf)

    def sph(self, m, c, r, n=12, sc=(1, 1, 1), rot=None):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=n, v_segments=max(4, n // 2 + 1), radius=r)
        for v in bm.verts:
            v.co = Vector((v.co.x * sc[0], v.co.y * sc[1], v.co.z * sc[2]))
        xf = Matrix.Translation(P(*c)) @ (rotm(*rot) if rot else Matrix.Identity(4))
        self.add_bm(bm, m, xf)

    def torus(self, m, c, R, r, axis='x', nR=24, nr=8, sc=1.0):
        """Torus about `axis` (ring lies perpendicular to axis)."""
        prof = circle_prof(r, nr)
        pts = [Vector((R * math.cos(2 * math.pi * i / nR), R * math.sin(2 * math.pi * i / nR), 0)) for i in range(nR)]
        bm = bmesh.new()
        rings = []
        for i in range(nR):
            a = 2 * math.pi * i / nR
            ca, sa = math.cos(a), math.sin(a)
            ring = []
            for (pa, pb) in prof:
                rr = R + pa
                ring.append(bm.verts.new(Vector((rr * ca, rr * sa, pb * sc))))
            rings.append(ring)
        for i in range(nR):
            for j in range(nr):
                try:
                    bm.faces.new((rings[i][j], rings[i][(j + 1) % nr], rings[(i + 1) % nR][(j + 1) % nr], rings[(i + 1) % nR][j]))
                except ValueError:
                    pass
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        xf = Matrix.Translation(P(*c)) @ axis_matrix(axis)
        self.add_bm(bm, m, xf)

    def sweep(self, m, path, prof, up=None, closed=False, caps=True, scale=None, twist=0.0, xf=None):
        """Sweep a closed 2D profile [(a,b)...] (a=right, b=up) along a game-space polyline.  `scale` = per-point list."""
        pts = [PV(p) for p in path]
        n = len(pts)
        if n < 2:
            return
        tans = []
        for i in range(n):
            if closed:
                t = (pts[(i + 1) % n] - pts[(i - 1) % n])
            else:
                t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
            tans.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))
        upv = PV(up) if up is not None else Vector((0, 0, 1))
        if abs(tans[0].dot(upv.normalized())) > 0.95:
            upv = Vector((1, 0, 0))
        nrm = (upv - tans[0] * upv.dot(tans[0])).normalized()
        frames = []
        for i in range(n):
            t = tans[i]
            if i > 0:
                nrm = (nrm - t * nrm.dot(t))
                if nrm.length < 1e-6:
                    nrm = t.orthogonal()
                nrm = nrm.normalized()
            right = t.cross(nrm).normalized()
            frames.append((right, nrm))
        bm = bmesh.new()
        rings = []
        for i in range(n):
            right, nu = frames[i]
            sc = scale[i] if scale else 1.0
            ang = twist * i * D2R
            ca, sa = math.cos(ang), math.sin(ang)
            ring = []
            for (a, b) in prof:
                a2, b2 = a * ca - b * sa, a * sa + b * ca
                ring.append(bm.verts.new(pts[i] + right * (a2 * sc) + nu * (b2 * sc)))
            rings.append(ring)
        k = len(prof)
        last = n if closed else n - 1
        for i in range(last):
            r0, r1 = rings[i], rings[(i + 1) % n]
            for j in range(k):
                try:
                    bm.faces.new((r0[j], r0[(j + 1) % k], r1[(j + 1) % k], r1[j]))
                except ValueError:
                    pass
        capf = []
        if not closed:
            try:
                capf.append(bm.faces.new(rings[0]))
                capf.append(bm.faces.new(rings[-1]))
            except ValueError:
                pass
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        if not caps and capf:
            bmesh.ops.delete(bm, geom=[f for f in capf if f.is_valid], context='FACES_ONLY')
        self.add_bm(bm, m, xf)

    def tube(self, m, path, r, n=8, rad=0.0, k=4, closed=False, caps=True, scale=None, sx=1.0, sy=1.0):
        pts = fillet_path(path, rad, k, closed) if rad > 0 else [Vector(p) for p in path]
        pts = [(p[0], p[1], p[2]) for p in pts]
        self.sweep(m, pts, circle_prof(r, n, sx, sy), closed=closed, caps=caps, scale=scale)

    def ribbon(self, m, path, w, t, up=None, closed=False, rad=0.0, k=4, bev=0.0):
        pts = fillet_path(path, rad, k, closed) if rad > 0 else [Vector(p) for p in path]
        self.sweep(m, [(p[0], p[1], p[2]) for p in pts], rrect_prof(w, t, min(bev, t * 0.45) if bev else 0.0, 1) if bev else [(w / 2, t / 2), (-w / 2, t / 2), (-w / 2, -t / 2), (w / 2, -t / 2)], up=up, closed=closed)

    def loft(self, m, rings, cap0=True, cap1=True, closed=True, xf=None, flip=False):
        """rings: list of lists of game-space points (equal counts)."""
        bm = bmesh.new()
        R = [[bm.verts.new(PV(p)) for p in ring] for ring in rings]
        k = len(R[0])
        for i in range(len(R) - 1):
            for j in range(k if closed else k - 1):
                try:
                    bm.faces.new((R[i][j], R[i][(j + 1) % k], R[i + 1][(j + 1) % k], R[i + 1][j]))
                except ValueError:
                    pass
        fc = []
        if closed:
            if cap0:
                try:
                    fc.append(bm.faces.new(R[0]))
                except ValueError:
                    pass
            if cap1:
                try:
                    fc.append(bm.faces.new(R[-1]))
                except ValueError:
                    pass
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        if flip:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        self.add_bm(bm, m, xf)


    def loft_grid(self, m, rings, cyc_u=True, cyc_v=False, cap=True, flip=False):
        """rings[i][j] game-space points. Ring points join cyclically when cyc_u; rings join cyclically when cyc_v (torus).
        Open (not cyclic in v) grids get n-gon caps when cap and cyc_u.  Normals are made consistent (outward for closed shapes)."""
        bm = bmesh.new()
        R = [[bm.verts.new(PV(p)) for p in ring] for ring in rings]
        nr, k = len(R), len(R[0])
        for i in range(nr if cyc_v else nr - 1):
            r0, r1 = R[i], R[(i + 1) % nr]
            for j in range(k if cyc_u else k - 1):
                try:
                    bm.faces.new((r0[j], r0[(j + 1) % k], r1[(j + 1) % k], r1[j]))
                except ValueError:
                    pass
        if cap and cyc_u and not cyc_v:
            for ring in (R[0], R[-1]):
                try:
                    bm.faces.new(ring)
                except ValueError:
                    pass
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        if flip:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        self.add_bm(bm, m)

    def lathe(self, m, prof, c, n=32, axis='x', fn=None, closed=False, flip=False, side=1.0, a0=0.0):
        """Revolve profile [(rad, ax)...] about an axis through c.  axis 'x' (wheel axle) only.  fn(i,j,rad,ax)->(rad,ax) tweaks
        each vertex (tread patterns).  side=-1 mirrors ax.  Faces run between consecutive profile points; closed joins the ends."""
        bm = bmesh.new()
        rings = []
        k = len(prof)
        cx, cf, cz = c
        for i in range(n):
            a = a0 * D2R + 2 * math.pi * i / n
            ca, sa = math.cos(a), math.sin(a)
            ring = []
            for j, (rad, ax) in enumerate(prof):
                if fn is not None:
                    rad, ax = fn(i, j, rad, ax)
                # game coords: axle x ; radial plane (f, z)
                ring.append(bm.verts.new(PV((cx + ax * side, cf + rad * ca, cz + rad * sa))))
            rings.append(ring)
        top = k if closed else k - 1
        for i in range(n):
            r0, r1 = rings[i], rings[(i + 1) % n]
            for j in range(top):
                try:
                    bm.faces.new((r0[j], r1[j], r1[(j + 1) % k], r0[(j + 1) % k]))
                except ValueError:
                    pass
        bm.normal_update()
        # orient: the faces at the largest radius must point away from the axle (or toward it when flip)
        best, bs = None, -1e9
        C = PV((cx, cf, cz))
        for f in bm.faces:
            cen = f.calc_center_median() - C
            rv = Vector((0, cen.y, cen.z))
            if rv.length > bs:
                bs, best = rv.length, (f, rv)
        if best is not None:
            outward = best[0].normal.dot(best[1]) > 0
            if outward == flip:
                bmesh.ops.reverse_faces(bm, faces=bm.faces)
        self.add_bm(bm, m)


    def graft(self, src, at=(0, 0, 0), rot=None, mat_map=None):
        """Copy another Part's geometry into this one, transformed by (at, rot).  Faces keep their material names."""
        xf = Matrix.Translation(P(*at)) @ (rotm(*rot) if rot else Matrix.Identity(4))
        bm = self.bm
        vmap = {v: bm.verts.new(xf @ v.co) for v in src.bm.verts}
        sdl = src.dl
        for f in src.bm.faces:
            mname = src.mats[f.material_index]
            idx = self.slot(mat_map.get(mname, mname) if mat_map else mname)
            try:
                nf = bm.faces.new([vmap[v] for v in f.verts])
                nf.material_index = idx
                if f[sdl]:
                    nf[self.dl] = f[sdl]
            except ValueError:
                pass

    # -- curved / flat thin shells --------------------------------------------------------------------
    def shell(self, m, poly, fn, out, thick=0.02, dens=0.06, holes=(), bev=0.005, dent=None, jitter=0.06, seed=1,
              keep_inner=False, edge_dens=None, flip=False, m2=None, back='flat'):
        """Thin curved panel. poly/holes: 2D (u,v) polygons; fn(u,v)->game-space (x,f,z); out=game-space outward hint vector.
        Triangulated (CDT) at density `dens`, thickened inward by `thick` and rim-bevelled by `bev`.
        dent: list of (u,v,radius,depth) gaussian dents applied along the surface normal."""
        rnd = random.Random(seed)
        poly = list(poly)
        bpoly = densify(poly, edge_dens or dens)
        hpolys = [densify(list(h), edge_dens or dens) for h in holes]
        us = [p[0] for p in poly]
        vs = [p[1] for p in poly]
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
        pts = list(bpoly)
        edges = [(i, (i + 1) % len(bpoly)) for i in range(len(bpoly))]
        base = len(pts)
        for h in hpolys:
            n0 = len(pts)
            pts.extend(h)
            edges.extend([(n0 + i, n0 + (i + 1) % len(h)) for i in range(len(h))])
        # interior points
        nu = max(1, int((u1 - u0) / dens))
        nv = max(1, int((v1 - v0) / dens))
        allb = [(bpoly, True)] + [(h, True) for h in hpolys]
        for iu in range(nu + 1):
            for iv in range(nv + 1):
                # hex-ish offset rows for nicer triangles
                u = u0 + (u1 - u0) * (iu + (0.5 if iv % 2 else 0.0)) / max(nu, 1) + rnd.uniform(-1, 1) * dens * jitter
                v = v0 + (v1 - v0) * iv / max(nv, 1) + rnd.uniform(-1, 1) * dens * jitter
                if not pip((u, v), bpoly):
                    continue
                if any(pip((u, v), h) for h in hpolys):
                    continue
                # keep clear of boundaries
                dmin = 1e9
                for pl in [bpoly] + hpolys:
                    for i in range(len(pl)):
                        d = seg_dist((u, v), pl[i], pl[(i + 1) % len(pl)])
                        if d < dmin:
                            dmin = d
                            if dmin < dens * 0.55:
                                break
                    if dmin < dens * 0.55:
                        break
                if dmin < dens * 0.55:
                    continue
                pts.append((u, v))
        vco = [Vector((p[0], p[1])) for p in pts]
        res = geometry.delaunay_2d_cdt(vco, edges, [], 0, 1e-6)
        rv, _, rf = res[0], res[1], res[2]
        bm = bmesh.new()
        pos = []
        for v in rv:
            g = fn(v.x, v.y)
            pos.append(PV(g))
        bv = [bm.verts.new(p) for p in pos]
        for tri in rf:
            a, b, c = tri
            cu = (rv[a].x + rv[b].x + rv[c].x) / 3
            cv = (rv[a].y + rv[b].y + rv[c].y) / 3
            if not pip((cu, cv), bpoly):
                continue
            if any(pip((cu, cv), h) for h in hpolys):
                continue
            try:
                bm.faces.new((bv[a], bv[b], bv[c]))
            except ValueError:
                pass
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        # orient towards the outward hint
        oh = PV(out)
        s = 0.0
        for f in bm.faces:
            s += f.normal.dot(oh)
        if (s < 0) != flip:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
            bm.normal_update()
        if dent:
            for v in bm.verts:
                uu = None
            # dents are given in (u,v); find nearest source by mapping back: recompute with the same arrays
            uvmap = {bv[i]: (rv[i].x, rv[i].y) for i in range(len(bv)) if bv[i].is_valid}
            for v, (uu, vv) in uvmap.items():
                if not v.is_valid:
                    continue
                d = 0.0
                for (du, dv, dr, dd) in dent:
                    d += dd * DENT_K * gauss(math.hypot(uu - du, vv - dv), dr)
                if d:
                    v.co -= v.normal * d
            bm.normal_update()
        if thick > 0:
            for f in bm.faces:
                f.material_index = 0
            if back == 'flat' and not holes:
                _thicken_flat(bm, thick, tag=1)
            else:
                _thicken(bm, thick, tag=1)
            bm.normal_update()
            if bev > 0:
                rim = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 1.0]
                _bevel(bm, min(bev, thick * 0.45), 1, rim)
        self.add_bm(bm, m, m2=m2)
        return None

    def plate(self, m, poly, frame, out, thick=0.01, bev=0.003, m2=None):
        """Flat/simple plate from a 2D polygon mapped by frame(u,v)->game pos (no interior tessellation)."""
        bm = bmesh.new()
        vs = [bm.verts.new(PV(frame(u, v))) for (u, v) in poly]
        try:
            f = bm.faces.new(vs)
        except ValueError:
            bm.free()
            return
        bm.normal_update()
        if f.normal.dot(PV(out)) < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
            bm.normal_update()
        for f_ in bm.faces:
            f_.material_index = 0
        _thicken(bm, thick, tag=1)
        bm.normal_update()
        if bev > 0:
            rim = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 1.0]
            _bevel(bm, min(bev, thick * 0.45), 1, rim)
        self.add_bm(bm, m, m2=m2)

    # -- finish ----------------------------------------------------------------------------------------
    def build(self, smooth_angle=SMOOTH_ANGLE):
        bm = self.bm
        bm.normal_update()
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) == 2:
                if e.calc_face_angle(0.0) > smooth_angle:
                    e.smooth = False
            else:
                e.smooth = True
        bmesh.ops.translate(bm, vec=-self.origin, verts=bm.verts)
        me = bpy.data.meshes.new(self.mesh_name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(M(m))
        o = bpy.data.objects.new(self.name, me)
        o.location = self.origin
        bpy.context.collection.objects.link(o)
        if self.parent is not None:
            o.parent = self.parent
            o.matrix_parent_inverse = self.parent.matrix_world.inverted()
        self.obj = o
        return o


def _thicken_flat(bm, t, tag=0):
    """Like _thicken but the inner side is ONE n-gon cap built from the offset boundary (cheap back faces)."""
    bm.normal_update()
    nxt = {}
    for f in bm.faces:
        for l in f.loops:
            if len(l.edge.link_faces) == 1:
                nxt[l.vert] = l.link_loop_next.vert
    seen = set()
    loops = []
    for v0 in list(nxt.keys()):
        if v0 in seen:
            continue
        loop = [v0]
        seen.add(v0)
        v = nxt.get(v0)
        guard = 0
        while v is not None and v != v0 and guard < 100000:
            loop.append(v)
            seen.add(v)
            v = nxt.get(v)
            guard += 1
        loops.append(loop)
    for loop in loops:
        if len(loop) < 3:
            continue
        inner = [bm.verts.new(v.co - v.normal * t) for v in loop]
        n = len(loop)
        for i in range(n):
            a, b_ = loop[i], loop[(i + 1) % n]
            ia, ib = inner[i], inner[(i + 1) % n]
            try:
                nf = bm.faces.new((b_, a, ia, ib))
                nf.material_index = tag
            except ValueError:
                pass
        try:
            nf = bm.faces.new(list(reversed(inner)))
            nf.material_index = tag
        except ValueError:
            pass


def _thicken(bm, t, tag=0):
    """Give an open surface thickness `t` inward (opposite the face normals). New faces get material_index=tag."""
    bm.normal_update()
    faces = list(bm.faces)
    verts = list(bm.verts)
    bl = []
    for f in faces:
        for l in f.loops:
            if len(l.edge.link_faces) == 1:
                bl.append((l.vert, l.link_loop_next.vert))
    inner = {}
    for v in verts:
        inner[v] = bm.verts.new(v.co - v.normal * t)
    for f in faces:
        try:
            nf = bm.faces.new([inner[v] for v in reversed(list(f.verts))])
            nf.material_index = tag
        except ValueError:
            pass
    for a, b in bl:
        try:
            nf = bm.faces.new((b, a, inner[a], inner[b]))
            nf.material_index = tag
        except ValueError:
            pass


# ------------------------------------------------------------------------------------------------- sockets
_SOCKETS = []


def socket(name, loc, rot=(0, 0, 0), size=0.08, parent=None):
    """Empty (plain axes). Identity rotation => +Z forward / +Y up in glTF. rot=(pitch,yaw,roll) degrees (game sense)."""
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = 'PLAIN_AXES'
    o.empty_display_size = size
    o.location = P(*loc)
    o.rotation_euler = rotm(*rot).to_euler()
    bpy.context.collection.objects.link(o)
    if parent is not None:
        o.parent = parent
    _SOCKETS.append(o)
    return o


def new_scene():
    rod_lib.reset()
    PAL.clear()
    PAL.update(_copy.deepcopy(_PAL0))
    _SOCKETS.clear()
    TEXTURED.clear()
    DECALS.clear()


def tweak_mat(name, **kw):
    """Adjust an already-created palette material: base=(r,g,b) rough= metal= clearcoat= emit_strength= ..."""
    m = M(name)
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    if 'base' in kw:
        b.inputs["Base Color"].default_value = (*kw['base'][:3], 1.0)
    if 'rough' in kw:
        b.inputs["Roughness"].default_value = kw['rough']
    if 'metal' in kw:
        b.inputs["Metallic"].default_value = kw['metal']
    if 'spec' in kw:
        b.inputs["Specular IOR Level"].default_value = kw['spec']
    if 'clearcoat' in kw and "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = kw['clearcoat']
    if 'emit_strength' in kw:
        b.inputs["Emission Strength"].default_value = kw['emit_strength']
    return m
