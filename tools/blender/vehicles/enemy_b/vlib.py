"""enemy_b vehicle toolkit.  ALL coordinates given to Model methods are GAME space (glTF): +X = left, +Y = up, +Z = forward,
origin on the ground under the vehicle centre.  Geometry is accumulated as plain arrays per (object, material), then at
finish(): weighted smooth normals, world-scale box UVs, Blender objects, GLB export, and either
  - legacy path (Model(bake=False), the boss): baked vertex-colour AO/grime + tiling textures, or
  - bake path (Model(bake=True), the v2 raiders): unique per-material wear atlases on UV1 (see vbake.py), no vertex colours.
Every primitive records a primitive id + tag (m.tag(...)) + shape + 'look' (the material it asked for before aliasing) for the bake.
"""
import bpy
import bmesh
import math
import os
import sys
import time
import zlib
import random
import re
import numpy as np
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vmat  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
OUTDIR = os.path.join(ROOT, "public", "models", "vehicles")
D2R = math.pi / 180.0
G2B = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))          # game (x,y,z) -> blender (x,-z,y)
G2B_np = np.array(G2B, dtype=np.float64)
Y = Vector((0, 1, 0))


def V3(p):
    return Vector((p[0], p[1], p[2]))


def xform(at=(0, 0, 0), rot=None):
    m = Matrix.Translation(V3(at))
    if rot is not None:
        m = m @ Euler((rot[0] * D2R, rot[1] * D2R, rot[2] * D2R), 'XYZ').to_matrix().to_4x4()
    return m


def basis_from(d, up=(0, 1, 0)):
    """Rotation matrix (4x4) whose local +Z = d and local +Y ~ up."""
    z = V3(d).normalized()
    u = V3(up)
    if abs(z.dot(u.normalized())) > 0.98:
        u = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 0, 1))
    x = u.cross(z).normalized()
    yv = z.cross(x).normalized()
    m = Matrix(((x.x, yv.x, z.x, 0), (x.y, yv.y, z.y, 0), (x.z, yv.z, z.z, 0), (0, 0, 0, 1)))
    return m


def axis_matrix(axis):
    """local Z of a primitive -> given axis ('x','y','z' or vector). Returns 4x4 rotation."""
    if isinstance(axis, Matrix):
        return axis if len(axis) == 4 else axis.to_4x4()
    if isinstance(axis, str):
        axis = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1), '-x': (-1, 0, 0), '-y': (0, -1, 0), '-z': (0, 0, -1)}[axis]
    return Vector((0, 0, 1)).rotation_difference(V3(axis).normalized()).to_matrix().to_4x4()


class Obj:
    def __init__(self, name, origin=(0, 0, 0), share=None, hidden=False, ao=True, parent=None, prot=None):
        self.name = name
        self.origin = np.array(origin, dtype=np.float64)
        self.share = share          # name of another Obj whose mesh datablock this one reuses
        self.hidden = hidden        # mesh source only (no scene object)
        self.ao = ao
        self.alias = {}
        self.b = {}                 # mat -> ([verts], [faces])
        self.p = {}                 # mat -> [primitive id per face]   (used by the wear bake)
        self.seg = 0
        self.parent = parent        # name of a socket (empty) this mesh node is parented to (bake-mode models only)
        self.prot = prot            # rotation (deg, game XYZ) of that socket: geometry is stored in its local frame


class _Tag:
    def __init__(self, m, kind):
        self.m, self.kind = m, kind

    def __enter__(self):
        self.m._kinds.append(self.kind)
        return self.m

    def __exit__(self, *a):
        self.m._kinds.pop()


class _XF:
    def __init__(self, m, M):
        self.m, self.M = m, M

    def __enter__(self):
        self.prev = self.m.T
        self.m.T = self.M if self.prev is None else (self.prev @ self.M)
        return self.m

    def __exit__(self, *a):
        self.m.T = self.prev


class Model:
    def __init__(self, ident, seed=1, bake=False):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        vmat.reset()
        self.id = ident
        self.rng = random.Random(seed)
        self.objs = {}
        self.order = []
        self.socks = []
        self.alias = {}          # global material aliasing (merge materials to save draw calls)
        self.tile_scale = 1.0    # scales world-scale texture tiling (big vehicles)
        self.T = None            # current transform stack top (Matrix or None)
        self._stack = []
        self.cur = 'body'
        # ---- wear-bake bookkeeping (only consumed when bake=True; the legacy path ignores it)
        self.bake = bake
        self.bake_opts = {}      # see vbake.DEFAULTS
        self.pkind = []          # primitive id -> tag ('part', 'rivet', 'weld', 'under', 'inner', ...)
        self._kinds = ['part']
        self._shape = 'hard'
        self._look = None
        self.section_name = 'misc'
        self.sec_tris = {}
        self.line_tris = {}
        self.rivets = []         # (pos, normal, r) world game space   -> rust streak sources
        self.welds = []          # (p0, p1, r)                         -> heat tint / weld bead ripples
        self.obj('body')
        self.t0 = time.time()

    # ------------------------------------------------------------------ objects
    def obj(self, name, origin=(0, 0, 0), share=None, hidden=False, ao=True, parent=None, prot=None):
        if name not in self.objs:
            self.objs[name] = Obj(name, origin, share, hidden, ao, parent, prot)
            self.order.append(name)
        return self.objs[name]

    def tag(self, kind):
        """Context manager: primitives emitted inside carry this tag for the wear bake."""
        return _Tag(self, kind)

    def _pid(self, ntris=0):
        self.pkind.append((self._kinds[-1], self._shape, self._look))
        self.sec_tris[self.section_name] = self.sec_tris.get(self.section_name, 0) + ntris
        if self.bake and ntris:
            f = sys._getframe(1)
            while f is not None and not f.f_code.co_filename.endswith(self.id + '.py'):
                f = f.f_back
            if f is not None:
                k = f.f_lineno
                self.line_tris[k] = self.line_tris.get(k, 0) + ntris
        return len(self.pkind) - 1

    def section(self, name):
        """triangle accounting label for everything emitted next (report only)"""
        self.section_name = name

    def use(self, name):
        self.cur = name
        return self

    def xf(self, at=(0, 0, 0), rot=None, mirror=False):
        """Context manager: everything emitted inside is transformed by translate(at) @ rotate(rot) (@ mirror X)."""
        M = xform(at, rot)
        if mirror:
            M = M @ Matrix.Scale(-1, 4, (1, 0, 0))
        return _XF(self, M)

    def _tp(self, v):
        v = V3(v)
        return (self.T @ v) if self.T is not None else v

    def _tn(self, v):
        v = V3(v)
        return (self.T.to_3x3() @ v) if self.T is not None else v

    def panel(self, name, origin, **alias):
        """Detachable part with its own pivot; alias=dict of material merges local to this object."""
        o = self.obj(name, origin)
        o.alias = dict(alias)
        self.cur = name
        return o

    def inst(self, name, src, loc):
        """Object `name` at `loc` sharing the mesh of `src` (built in local coordinates around 0,0,0)."""
        self.obj(name, origin=loc, share=src)

    def sock(self, name, pos, rot=None, size=0.12):
        self.socks.append((name, tuple(pos), rot, size))

    # ------------------------------------------------------------------ low-level emit
    def _res(self, mat, o):
        r = o.alias.get(mat) or self.alias.get(mat) or mat
        if self.bake:                       # bake models follow alias chains (chrome -> metal_dark -> armor)
            for _ in range(4):
                r2 = o.alias.get(r) or self.alias.get(r) or r
                if r2 == r:
                    break
                r = r2
        return r

    def _put(self, bm, mat, M=None, obj=None):
        o = self.objs[obj or self.cur]
        mat0 = mat
        mat = self._res(mat, o)
        self._look = mat0 if mat0 != mat else None      # aliased material keeps its own baked look
        Vv, Ff = o.b.setdefault(mat, ([], []))
        base = len(Vv)
        bm.verts.index_update()
        Mt = M
        if self.T is not None:
            Mt = self.T if M is None else (self.T @ M)
        if Mt is not None:
            Vv.extend([tuple(Mt @ v.co) for v in bm.verts])
        else:
            Vv.extend([tuple(v.co) for v in bm.verts])
        flip = Mt is not None and Mt.determinant() < 0
        if flip:
            Ff.extend([tuple(v.index + base for v in reversed(f.verts)) for f in bm.faces])
        else:
            Ff.extend([tuple(v.index + base for v in f.verts) for f in bm.faces])
        o.p.setdefault(mat, []).extend([self._pid(sum(len(f.verts) - 2 for f in bm.faces))] * len(bm.faces))

    def _finish_bm(self, bm, mat, M, bevel, seg, min_angle, obj, recalc=True, deform=None):
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        if bevel and bevel > 0:
            ang = min_angle * D2R
            edges = [e for e in bm.edges if e.is_manifold and e.calc_face_angle(0.0) > ang]
            if edges:
                try:
                    bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type='OFFSET', segments=seg, profile=0.5,
                                    affect='EDGES', clamp_overlap=True, loop_slide=True)
                except Exception as ex:
                    print("bevel fail", ex)
        if deform is not None:
            for v in bm.verts:
                v.co = deform(v.co)
        self._put(bm, mat, M, obj)
        bm.free()

    # ------------------------------------------------------------------ primitives
    def box(self, mat, size, at=(0, 0, 0), rot=None, bevel=0.012, seg=2, top=None, bot=None, obj=None, min_angle=25, deform=None,
            subdiv=None):
        """size=(sx,sy,sz) game axes.  top/bot=(kx,kz,dz): scale/shift of the +Y / -Y face (tapered boxes)."""
        sx, sy, sz = size
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            x, y, z = v.co.x * sx, v.co.y * sy, v.co.z * sz
            t = top if y > 0 else bot
            if t is not None:
                x *= t[0]; z = z * t[1] + (t[2] if len(t) > 2 else 0)
            v.co = Vector((x, y, z))
        if subdiv:
            bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=subdiv, use_grid_fill=True)
        self._finish_bm(bm, mat, xform(at, rot), bevel, seg, min_angle, obj, deform=deform)

    def hull(self, mat, pts, bevel=0.012, seg=2, obj=None, min_angle=25, rot=None, at=(0, 0, 0), deform=None):
        bm = bmesh.new()
        for p in pts:
            bm.verts.new(V3(p))
        res = bmesh.ops.convex_hull(bm, input=bm.verts[:], use_existing_faces=False)
        dead = res.get('geom_interior', []) + res.get('geom_unused', [])
        dead = [g for g in dead if isinstance(g, bmesh.types.BMVert)]
        if dead:
            bmesh.ops.delete(bm, geom=dead, context='VERTS')
        bmesh.ops.dissolve_limit(bm, angle_limit=1.5 * D2R, verts=bm.verts[:], edges=bm.edges[:])
        self._finish_bm(bm, mat, xform(at, rot), bevel, seg, min_angle, obj, deform=deform)

    def beam(self, mat, p0, p1, w, h=None, up=(0, 1, 0), bevel=0.006, seg=1, obj=None, ext=0.0, min_angle=25):
        """Square/rect bar from p0 to p1 (w across, h along `up`-ish)."""
        h = w if h is None else h
        a, b = V3(p0), V3(p1)
        d = b - a
        L = d.length
        if L < 1e-5:
            return
        dn = d / L
        M = Matrix.Translation((a + b) / 2) @ basis_from(dn, up)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * w, v.co.y * h, v.co.z * (L + 2 * ext)))
        self._finish_bm(bm, mat, M, bevel, seg, min_angle, obj)

    def obox(self, mat, c, xd, yd, size, bevel=0.02, seg=1, obj=None, min_angle=25, top=None):
        """Oriented box centred c with local X along xd, local Y along yd (game-space unit vectors); size=(sx,sy,sz)."""
        x = V3(xd).normalized(); yv = V3(yd).normalized()
        z = x.cross(yv).normalized(); yv = z.cross(x).normalized()
        M = Matrix(((x.x, yv.x, z.x, c[0]), (x.y, yv.y, z.y, c[1]), (x.z, yv.z, z.z, c[2]), (0, 0, 0, 1)))
        sx, sy, sz = size
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            xx, yy, zz = v.co.x * sx, v.co.y * sy, v.co.z * sz
            if top is not None and yy > 0:
                xx *= top[0]; zz *= top[1]
            v.co = Vector((xx, yy, zz))
        self._finish_bm(bm, mat, M, bevel, seg, min_angle, obj)

    def cyl(self, mat, p0, p1, r0, r1=None, seg=12, caps=True, bevel=0.0, bseg=1, obj=None, min_angle=30):
        a, b = V3(p0), V3(p1)
        d = b - a
        L = d.length
        if L < 1e-6:
            return
        r1 = r0 if r1 is None else r1
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r0, radius2=max(r1, 1e-4), depth=L)
        M = Matrix.Translation((a + b) / 2) @ basis_from(d / L, (0, 1, 0))
        # cone axis is local Z, radius1 at -Z (= p0)
        self._shape = 'round'
        self._finish_bm(bm, mat, M, bevel, bseg, min_angle, obj)
        self._shape = 'hard'

    def cone(self, mat, base, tip, r, seg=6, obj=None):
        self.cyl(mat, base, tip, r, 0.0015, seg=seg, caps=True, obj=obj)

    def revolve(self, mat, prof, at=(0, 0, 0), axis='x', seg=32, rot=None, obj=None, bevel=0.0, bseg=1, closed=True,
                deform=None, phase=0.0, min_angle=30, sx=1.0, sy=1.0):
        """Surface of revolution.  prof = [(r, t), ...] around local axis; consecutive points connected, last->first if closed.
        Points with r == 0 collapse to a single vertex on the axis.  sx/sy squash the ring (elliptical sections)."""
        bm = bmesh.new()
        rows = []
        for (r, t) in prof:
            if abs(r) < 1e-6:
                rows.append([bm.verts.new((0, 0, t))])
            else:
                rows.append([bm.verts.new((r * sx * math.cos(phase + 2 * math.pi * i / seg), r * sy * math.sin(phase + 2 * math.pi * i / seg), t))
                             for i in range(seg)])
        n = len(rows)
        rng_ = range(n) if closed else range(n - 1)
        for k in rng_:
            A, B = rows[k], rows[(k + 1) % n]
            if len(A) == 1 and len(B) == 1:
                continue
            for i in range(seg):
                j = (i + 1) % seg
                try:
                    if len(A) == 1:
                        bm.faces.new((A[0], B[j], B[i]))
                    elif len(B) == 1:
                        bm.faces.new((A[i], A[j], B[0]))
                    else:
                        bm.faces.new((A[i], A[j], B[j], B[i]))
                except ValueError:
                    pass
        M = xform(at, rot) @ axis_matrix(axis)
        self._shape = 'round'
        self._finish_bm(bm, mat, M, bevel, bseg, min_angle, obj, deform=deform)
        self._shape = 'hard'

    def sweep(self, mat, rings, caps=True, obj=None, bevel=0.0, seg=1, closed_ring=True, min_angle=30, deform=None, wrap=False):
        """Loft equal-length rings of 3D points (list of list of points)."""
        bm = bmesh.new()
        R = [[bm.verts.new(V3(p)) for p in ring] for ring in rings]
        n = len(R[0])
        for k in range(len(R) - (0 if wrap else 1)):
            k2 = (k + 1) % len(R)
            for i in range(n if closed_ring else n - 1):
                j = (i + 1) % n
                try:
                    bm.faces.new((R[k][i], R[k][j], R[k2][j], R[k2][i]))
                except ValueError:
                    pass
        if caps and closed_ring:
            try:
                bm.faces.new(R[0][::-1]); bm.faces.new(R[-1])
            except ValueError:
                pass
        self._finish_bm(bm, mat, None, bevel, seg, min_angle, obj, deform=deform)

    def tube(self, mat, pts, r, seg=8, bend=0.0, bsteps=3, caps=True, obj=None, r_end=None, bevel=0.0):
        """Round pipe along a polyline with optional rounded bends."""
        pts = [V3(p) for p in pts]
        if bend > 0 and len(pts) > 2:
            path = [pts[0]]
            for i in range(1, len(pts) - 1):
                P, A, B = pts[i], pts[i - 1], pts[i + 1]
                d1, d2 = (A - P), (B - P)
                t = min(bend, d1.length * 0.5, d2.length * 0.5)
                pin, pout = P + d1.normalized() * t, P + d2.normalized() * t
                for k in range(bsteps + 1):
                    s = k / bsteps
                    path.append((1 - s) ** 2 * pin + 2 * s * (1 - s) * P + s * s * pout)
            path.append(pts[-1])
        else:
            path = pts
        n = len(path)
        tang = []
        for i in range(n):
            a = path[max(i - 1, 0)]; b = path[min(i + 1, n - 1)]
            tang.append((b - a).normalized())
        N = tang[0].orthogonal().normalized()
        rings = []
        for i in range(n):
            T = tang[i]
            N = (N - T * N.dot(T)).normalized()
            Bn = T.cross(N)
            rr = r if r_end is None else r + (r_end - r) * i / max(n - 1, 1)
            rings.append([path[i] + (N * math.cos(2 * math.pi * k / seg) + Bn * math.sin(2 * math.pi * k / seg)) * rr for k in range(seg)])
        self._shape = 'round'
        self.sweep(mat, rings, caps=caps, obj=obj, bevel=bevel)
        self._shape = 'hard'

    def plate(self, mat, poly, thick, at=(0, 0, 0), u=(1, 0, 0), v=(0, 1, 0), bevel=0.01, seg=1, obj=None, min_angle=25, deform=None,
              holes=None):
        """Extruded polygon (2D coords in the u/v plane, optional holes), centred on its plane (+-thick/2 along u x v)."""
        uu, vv = V3(u).normalized(), V3(v).normalized()
        nn = uu.cross(vv).normalized()
        loops = [list(poly)] + [list(h) for h in (holes or [])]
        bm = bmesh.new()
        lo_l, hi_l = [], []
        for lp in loops:
            lo_l.append([bm.verts.new(uu * a + vv * b - nn * thick / 2) for a, b in lp])
            hi_l.append([bm.verts.new(uu * a + vv * b + nn * thick / 2) for a, b in lp])
        for lo, hi in zip(lo_l, hi_l):
            n = len(lo)
            for i in range(n):
                j = (i + 1) % n
                try:
                    bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
                except ValueError:
                    pass
        if len(loops) == 1:
            bm.faces.new(lo_l[0][::-1]); bm.faces.new(hi_l[0])
        else:
            from mathutils.geometry import tessellate_polygon
            tris = tessellate_polygon([[Vector((a, b, 0)) for a, b in lp] for lp in loops])
            flo = [v for l in lo_l for v in l]; fhi = [v for l in hi_l for v in l]
            for t in tris:
                try:
                    bm.faces.new((fhi[t[0]], fhi[t[1]], fhi[t[2]]))
                    bm.faces.new((flo[t[2]], flo[t[1]], flo[t[0]]))
                except ValueError:
                    pass
        self._finish_bm(bm, mat, Matrix.Translation(V3(at)), bevel, seg, min_angle, obj, deform=deform)

    def raw(self, mat, verts, faces, obj=None):
        bm = bmesh.new()
        vs = [bm.verts.new(V3(p)) for p in verts]
        for f in faces:
            try:
                bm.faces.new([vs[i] for i in f])
            except ValueError:
                pass
        self._finish_bm(bm, mat, None, 0, 1, 30, obj, recalc=False)

    def text(self, mat, s, at, u=(1, 0, 0), v=(0, 1, 0), size=0.3, depth=0.008, obj=None, wrap=None, spacing=1.0, bold=0.0, res=3):
        cu = bpy.data.curves.new('tx', 'FONT')
        cu.body = s; cu.size = size; cu.extrude = depth * 0.5; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
        cu.resolution_u = res
        cu.space_character = spacing; cu.offset = bold * size * 0.02 if bold else 0.0
        if bold:
            cu.offset = bold
        ob = bpy.data.objects.new('tx', cu)
        bpy.context.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        uu, vv = V3(u).normalized(), V3(v).normalized()
        ww = uu.cross(vv).normalized()
        verts = []
        for p in me.vertices:
            w = uu * p.co.x + vv * p.co.y + ww * p.co.z + V3(at)
            verts.append(wrap(w) if wrap else w)
        faces = [tuple(p.vertices) for p in me.polygons]
        bm = bmesh.new()
        vs = [bm.verts.new(c) for c in verts]
        for f in faces:
            try:
                bm.faces.new([vs[i] for i in f])
            except ValueError:
                pass
        bpy.data.objects.remove(ob); bpy.data.curves.remove(cu); bpy.data.meshes.remove(me)
        self._finish_bm(bm, mat, None, 0, 1, 30, obj, recalc=False)

    # ------------------------------------------------------------------ small detail helpers
    def rivet(self, mat, p, n, r=0.012, seg=5, h=None, obj=None):
        """Domed rivet/bolt head (pyramid-dome, seg triangles) at p pointing along normal n."""
        h = r * 0.75 if h is None else h
        nn = V3(n).normalized()
        R = basis_from(nn)
        xa = R @ Vector((1, 0, 0)); ya = R @ Vector((0, 1, 0))
        P = V3(p)
        ring = [tuple(self._tp(P + (xa * math.cos(2 * math.pi * i / seg) + ya * math.sin(2 * math.pi * i / seg)) * r - nn * 0.002)) for i in range(seg)]
        apex = tuple(self._tp(P + nn * h))
        o = self.objs[obj or self.cur]
        mat0 = mat
        mat = self._res(mat, o)
        self._look = mat0 if mat0 != mat else None
        Vv, Ff = o.b.setdefault(mat, ([], []))
        b0 = len(Vv)
        Vv.extend(ring); Vv.append(apex)
        fl = self.T is not None and self.T.determinant() < 0
        Ff.extend([((b0 + (i + 1) % seg, b0 + i, b0 + seg) if fl else (b0 + i, b0 + (i + 1) % seg, b0 + seg)) for i in range(seg)])
        self._kinds.append('rivet')
        o.p.setdefault(mat, []).extend([self._pid(seg)] * seg)
        self._kinds.pop()
        self.rivets.append((tuple(self._tp(P)), tuple(self._tn(nn)), r))

    def hexbolt(self, mat, p, n, r=0.02, h=0.015, obj=None, seg=6):
        """Bolt head: prism with top cap only (no hidden bottom)."""
        nn = V3(n).normalized()
        R = basis_from(nn)
        xa = R @ Vector((1, 0, 0)); ya = R @ Vector((0, 1, 0))
        P = V3(p)
        lo = [tuple(self._tp(P + (xa * math.cos(2 * math.pi * i / seg) + ya * math.sin(2 * math.pi * i / seg)) * r)) for i in range(seg)]
        hi = [tuple(self._tp(P + nn * h + (xa * math.cos(2 * math.pi * i / seg) + ya * math.sin(2 * math.pi * i / seg)) * r * 0.9)) for i in range(seg)]
        o = self.objs[obj or self.cur]
        mat0 = mat
        mat = self._res(mat, o)
        self._look = mat0 if mat0 != mat else None
        Vv, Ff = o.b.setdefault(mat, ([], []))
        b0 = len(Vv)
        Vv.extend(lo); Vv.extend(hi)
        fl = self.T is not None and self.T.determinant() < 0
        for i in range(seg):
            j = (i + 1) % seg
            f = (b0 + i, b0 + j, b0 + seg + j, b0 + seg + i)
            Ff.append(tuple(reversed(f)) if fl else f)
        f = tuple(b0 + seg + i for i in range(seg))
        Ff.append(tuple(reversed(f)) if fl else f)
        self._kinds.append('rivet')
        o.p.setdefault(mat, []).extend([self._pid(seg * 2 + seg - 2)] * (seg + 1))
        self._kinds.pop()
        self.rivets.append((tuple(self._tp(P)), tuple(self._tn(nn)), r))

    def rivet_line(self, mat, p0, p1, n, step=0.12, r=0.011, obj=None, inset=0.0, seg=5):
        a, b = V3(p0), V3(p1)
        L = (b - a).length
        k = max(int(L / step), 1)
        for i in range(k + 1):
            self.rivet(mat, a + (b - a) * (i / k), n, r, seg=seg, obj=obj)

    def rivet_rect(self, mat, c, w, h, n, u=(1, 0, 0), v=(0, 1, 0), step=0.14, r=0.011, obj=None, inset=0.03, seg=5):
        """Rivets around the perimeter of a w x h rectangle centred c, in the u/v plane, facing n."""
        c, uu, vv = V3(c), V3(u).normalized(), V3(v).normalized()
        hw, hh = w / 2 - inset, h / 2 - inset
        corners = [c + uu * hw + vv * hh, c - uu * hw + vv * hh, c - uu * hw - vv * hh, c + uu * hw - vv * hh]
        for i in range(4):
            a, b = corners[i], corners[(i + 1) % 4]
            L = (b - a).length
            k = max(int(round(L / step)), 1)
            for j in range(k):
                self.rivet(mat, a + (b - a) * (j / k), n, r, seg=seg, obj=obj)

    def weld(self, mat, p0, p1, r=0.008, obj=None, wobble=0.0):
        a, b = V3(p0), V3(p1)
        L = (b - a).length
        k = max(int(L / 0.1), 1)
        d = (b - a) / max(L, 1e-6)
        self.welds.append((tuple(self._tp(a)), tuple(self._tp(b)), r))
        self._kinds.append('weld')
        for i in range(k):
            s = (i + 0.5) / k
            c = a + (b - a) * s
            self.cyl(mat, c - d * (L / k * 0.62), c + d * (L / k * 0.62), r * (0.85 + 0.3 * self.rng.random()), seg=4, caps=False, obj=obj)
        self._kinds.pop()

    def bead(self, mat, pts, r=0.009, obj=None, n=None, step=0.06, seg=4):
        """Weld bead (bake models): lumpy flattened tube along a polyline, ripples every `step` m, lying on a surface with normal n.
        Records the seam for the heat-tint / ripple bake."""
        P = [V3(p) for p in pts]
        path = []
        for i in range(len(P) - 1):
            a, b = P[i], P[i + 1]
            L = (b - a).length
            k = max(int(L / step), 1)
            for j in range(k + (1 if i == len(P) - 2 else 0)):
                path.append(a + (b - a) * (j / k))
        for i in range(len(P) - 1):
            self.welds.append((tuple(self._tp(P[i])), tuple(self._tp(P[i + 1])), r))
        nn = V3(n).normalized() if n is not None else None
        rings = []
        cnt = len(path)
        for i, c in enumerate(path):
            t = (path[min(i + 1, cnt - 1)] - path[max(i - 1, 0)]).normalized()
            up = nn if nn is not None else (t.orthogonal().normalized())
            up = (up - t * up.dot(t)).normalized()
            side = t.cross(up).normalized()
            lump = 1.0 + (0.22 if i % 2 == 0 else -0.05) + 0.12 * (self.rng.random() - 0.5)
            end = 1.0 if 0 < i < cnt - 1 else 0.35
            ring = []
            for k in range(seg):
                a = math.pi * k / (seg - 1)        # half-round profile from one toe to the other
                ring.append(c + side * (math.cos(a) * r * 1.25 * end) + up * (math.sin(a) * r * 0.75 * lump * end - r * 0.18))
            rings.append(ring)
        self._kinds.append('weld')
        self.sweep(mat, rings, caps=False, obj=obj, closed_ring=False)
        self._kinds.pop()

    def spike(self, mat, base, tip, r, seg=6, obj=None, collar=True):
        a, b = V3(base), V3(tip)
        self.cone(mat, a, b, r, seg=seg, obj=obj)
        if collar:
            d = (b - a).normalized()
            self.cyl(mat, a - d * 0.015, a + d * 0.02, r * 1.25, seg=seg, obj=obj)

    def jitter(self, a, b):
        return a + (b - a) * self.rng.random()

    # ------------------------------------------------------------------ build / export
    def count(self):
        tris = 0; prims = 0; meshes = 0
        for n in self.order:
            o = self.objs[n]
            if o.hidden:
                continue
            src = self.objs[o.share] if o.share else o
            if src.b:
                meshes += 1
            for m, (Vv, Ff) in src.b.items():
                prims += 1
                tris += sum(len(f) - 2 for f in Ff)
        return tris, meshes, prims

    def below_ground(self, thr=-0.04):
        for n in self.order:
            o = self.objs[n]
            if o.hidden:
                continue
            src = self.objs[o.share] if o.share else o
            for mt, (Vv, Ff) in src.b.items():
                ys = [v[1] + (o.origin[1] if o.share else 0) for v in Vv]
                if ys and min(ys) < thr:
                    k = ys.index(min(ys))
                    print('   BELOW GROUND %s/%s min y %.3f at %s' % (n, mt, min(ys), tuple(round(c, 2) for c in Vv[k])))

    def report(self, top=25):
        self.below_ground()
        rows = []
        for n in self.order:
            o = self.objs[n]
            if o.hidden or o.share:
                continue
            for mt, (Vv, Ff) in o.b.items():
                rows.append((sum(len(f) - 2 for f in Ff), n, mt))
        for n in self.order:
            o = self.objs[n]
            if o.share:
                src = self.objs[o.share]
                for mt, (Vv, Ff) in src.b.items():
                    rows.append((sum(len(f) - 2 for f in Ff), n, mt))
        rows.sort(reverse=True)
        for r in rows[:top]:
            print("   %6d  %-18s %s" % r)

    def finish(self, export=True, seed_ao=1, ao_rays=10, ao_dist=1.1, name=None):
        t = time.time()
        build_scene(self, ao_rays, ao_dist)
        print("[%s] scene built in %.1fs" % (self.id, time.time() - t))
        tris, meshes, prims = self.count()
        self.report()
        print('   prims/object:', {n: sorted((self.objs[self.objs[n].share] if self.objs[n].share else self.objs[n]).b.keys()) for n in self.order if not self.objs[n].hidden and not self.objs[n].share and n != 'body'}, 'BODY', sorted(self.objs['body'].b.keys()))
        if self.bake:
            tot = sum(self.sec_tris.values()) or 1
            print('   sections (tris, shared meshes counted once): ' + ', '.join('%s %d' % kv for kv in sorted(self.sec_tris.items(), key=lambda kv: -kv[1])))
            if os.environ.get('TRI_LINES'):
                print('   top script lines: ' + ', '.join('L%d %d' % kv for kv in sorted(self.line_tris.items(), key=lambda kv: -kv[1])[:40]))
        print("[%s] TRIS %d  mesh-nodes %d  primitives %d  (total %.1fs)" % (self.id, tris, meshes, prims, time.time() - self.t0))
        if export:
            out = os.environ.get('VEH_OUT') or OUTDIR          # test builds: VEH_OUT=shots/enemy_b/test
            if not os.path.isabs(out):
                out = os.path.join(ROOT, out)
            export_glb(os.path.join(out, (name or self.id) + ".glb"), jpeg_q=getattr(self, 'jpeg_q', 82))
        return tris


# ====================================================================================== post-processing
def _newell(V, F_flat, lens):
    """per-face normals (unit) and areas; corner arrays. V (n,3) game space."""
    C = len(F_flat)
    starts = np.cumsum(lens) - lens
    fidx = np.repeat(np.arange(len(lens)), lens)
    k = np.arange(C) - starts[fidx]
    nxt = starts[fidx] + (k + 1) % lens[fidx]
    a = V[F_flat]; b = V[F_flat[nxt]]
    cr = np.cross(a, b)
    Nf = np.zeros((len(lens), 3))
    for c in range(3):
        Nf[:, c] = np.bincount(fidx, weights=cr[:, c], minlength=len(lens))
    area = np.linalg.norm(Nf, axis=1) * 0.5
    nrm = Nf / np.maximum(np.linalg.norm(Nf, axis=1, keepdims=True), 1e-12)
    return nrm, area, fidx


def smooth_corner_normals(V, F_flat, lens, thr_deg=36.0):
    nf, area, cf = _newell(V, F_flat, lens)
    C = len(F_flat)
    cosT = math.cos(thr_deg * D2R)
    order = np.argsort(F_flat, kind='stable')
    cvs = F_flat[order]
    uniq, start, cnt = np.unique(cvs, return_index=True, return_counts=True)
    seg_start = np.repeat(start, cnt)
    deg = np.repeat(cnt, cnt)
    out = np.zeros((C, 3))
    # process in chunks of corners to bound memory
    CH = 200000
    pos = 0
    while pos < C:
        hi = min(C, pos + CH)
        # extend chunk so that we finish at a whole number of corners (corners independent -> any split ok)
        d = deg[pos:hi]
        tot = int(d.sum())
        i_local = np.repeat(np.arange(pos, hi), d)
        off = np.arange(tot) - np.repeat(np.cumsum(d) - d, d)
        j_sorted = seg_start[i_local] + off
        ci = order[i_local]; cj = order[j_sorted]
        fi = cf[ci]; fj = cf[cj]
        dots = np.einsum('ij,ij->i', nf[fi], nf[fj])
        w = np.where(dots > cosT, area[fj], 0.0)
        for c in range(3):
            out[:, c] += np.bincount(ci, weights=w * nf[fj][:, c], minlength=C)
        pos = hi
    ln = np.linalg.norm(out, axis=1, keepdims=True)
    fallback = nf[cf]
    out = np.where(ln > 1e-9, out / np.maximum(ln, 1e-12), fallback)
    return out, nf, area, cf


def _vnoise3(P, freq, seed):
    """cheap 3D value noise in [0,1] for Nx3 points"""
    p = P * freq
    i = np.floor(p).astype(np.int64)
    f = p - i
    f = f * f * (3 - 2 * f)

    def h(ix, iy, iz):
        n = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
        n = (n ^ (n >> 13)) * 1274126177
        n = n ^ (n >> 16)
        return (n & 0xFFFF).astype(np.float64) / 65535.0
    c = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                c = c + w * h(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz)
    return c


def hemisphere_dirs(k):
    """k cosine-weighted-ish directions (z-up hemisphere), deterministic."""
    out = []
    for i in range(k):
        u = (i + 0.5) / k
        phi = i * 2.399963
        r = math.sqrt(u)
        out.append((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0, 1 - u))))
    return np.array(out)


def compute_ao(bvh, P, N, rays, maxd, seed=0):
    """P,N: (n,3) game space.  returns occlusion in [0,1] (1 = fully occluded)."""
    n = len(P)
    dirs = hemisphere_dirs(rays)
    rng = np.random.default_rng(seed)
    ref = np.where(np.abs(N[:, 1:2]) < 0.9, np.array([[0, 1, 0]]), np.array([[1, 0, 0]]))
    T = np.cross(ref, N); T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    Bv = np.cross(N, T)
    ang = rng.random(n) * 2 * math.pi
    ca, sa = np.cos(ang)[:, None], np.sin(ang)[:, None]
    T2 = T * ca + Bv * sa; B2 = -T * sa + Bv * ca
    occ = np.zeros(n)
    orig = P + N * 0.02
    ray = bvh.ray_cast
    for k in range(rays):
        d = T2 * dirs[k, 0] + B2 * dirs[k, 1] + N * dirs[k, 2]
        ol = orig.tolist(); dl = d.tolist()
        for i in range(n):
            r = ray(ol[i], dl[i], maxd)
            if r[0] is not None:
                occ[i] += 1.0 - r[3] / maxd
    return occ / rays


def build_scene(m, ao_rays=10, ao_dist=1.1):
    """Turn accumulated arrays into Blender objects with normals/UVs/vertex colours."""
    # ---- gather per object arrays
    data = {}
    for name in m.order:
        o = m.objs[name]
        if o.share:
            continue
        mats = list(o.b.keys())
        if not mats:
            continue
        Vs, Fs, MI, PI = [], [], [], []
        base = 0
        for mi, mt in enumerate(mats):
            Vv, Ff = o.b[mt]
            Vs.append(np.array(Vv, dtype=np.float64).reshape(-1, 3))
            Fs.extend([tuple(i + base for i in f) for f in Ff])
            MI.extend([mi] * len(Ff))
            pl = o.p.get(mt, [])
            PI.extend(pl if len(pl) == len(Ff) else [-1] * len(Ff))
            base += len(Vv)
        V = np.concatenate(Vs)
        lens = np.array([len(f) for f in Fs])
        Fflat = np.array([i for f in Fs for i in f], dtype=np.int64)
        data[name] = dict(mats=mats, V=V, F=Fs, lens=lens, Fflat=Fflat, MI=np.array(MI), PI=np.array(PI, dtype=np.int64), obj=o,
                          vm=[len(x[0]) for x in [o.b[k] for k in mats]], shared=any(x.share == name for x in m.objs.values()))
    # ---- normals
    for name, d in data.items():
        d['cn'], d['nf'], d['area'], d['cf'] = smooth_corner_normals(d['V'], d['Fflat'], d['lens'])
    # ---- world BVH (game space) of everything + ground
    WV, WF = [], []
    base = 0
    for name in m.order:
        o = m.objs[name]
        if o.hidden:
            continue
        src = m.objs[o.share] if o.share else o
        if src.name not in data:
            continue
        d = data[src.name]
        Vw = d['V'] + o.origin if o.share else d['V']
        WV.append(Vw)
        WF.extend([tuple(i + base for i in f) for f in d['F']])
        base += len(Vw)
    g = 80.0
    WV.append(np.array([[-g, 0, -g], [g, 0, -g], [g, 0, g], [-g, 0, g]], dtype=np.float64))
    WF.append((base + 3, base + 2, base + 1, base + 0))
    bvh_world = BVHTree.FromPolygons(np.concatenate(WV).tolist(), WF, epsilon=0.0)
    # ---- per object: vertex normals, AO, colours, UVs
    for name, d in data.items():
        o = d['obj']
        V = d['V']; nv = len(V)
        shared_src = d['shared']       # shared (wheel) meshes are lit in isolation (they spin)
        if m.bake:
            d['col'] = None
        else:
            vn = np.zeros((nv, 3))
            for c in range(3):
                vn[:, c] = np.bincount(d['Fflat'], weights=d['cn'][:, c], minlength=nv)
            vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)
            if shared_src:
                bvh = BVHTree.FromPolygons(V.tolist(), d['F'], epsilon=0.0)
                occ = compute_ao(bvh, V, vn, ao_rays, 0.5, seed=zlib.crc32(name.encode()) & 0xffff)
                Pw = V
            else:
                occ = compute_ao(bvh_world, V, vn, ao_rays, ao_dist, seed=len(name))
                Pw = V
            # per-vertex material of origin
            vmat_of = np.zeros(nv, dtype=np.int64)
            off = 0
            for mi, cnt in enumerate(d['vm']):
                vmat_of[off:off + cnt] = mi; off += cnt
            ao = np.clip(1.0 - 1.35 * occ, 0.12, 1.0)
            h = Pw[:, 1] if not shared_src else np.zeros(nv)
            dirt = np.clip(1 - h / getattr(m, 'dirt_h', 1.25), 0, 1) ** 1.6 if not shared_src else 0.35 * np.ones(nv)
            nf_ = getattr(m, 'noise_f', 1.0)
            noise = _vnoise3(Pw, 0.7 * nf_, 3) * 0.6 + _vnoise3(Pw, 2.3 * nf_, 9) * 0.4
            tone = ao ** 1.1 * (1 - 0.34 * dirt) * (0.84 + 0.30 * noise)
            rgb = np.stack([tone, tone * (1 - 0.035 * dirt), tone * (1 - 0.10 * dirt)], -1)
            for mi, mt in enumerate(d['mats']):
                if mt in vmat.NO_GRIME:
                    rgb[vmat_of == mi] = 1.0
            d['col'] = np.clip(rgb, 0, 1)
        # UVs (world-scale box projection), per corner
        cf = d['cf']; nf = d['nf']
        axis = np.argmax(np.abs(nf), axis=1)
        if m.bake:
            tile = np.array([vmat.uv0_tile(mt) * m.tile_scale for mt in d['mats']])
        else:
            tile = np.array([(vmat.TILE.get(vmat.PAL[mt].get('tex'), 1.0) if 'tex' in vmat.PAL[mt] else 1.0) * m.tile_scale for mt in d['mats']])
        tface = tile[d['MI']]
        Pc = V[d['Fflat']]
        ac = axis[cf]
        u = np.where(ac == 0, Pc[:, 2], np.where(ac == 1, Pc[:, 0], Pc[:, 0]))
        w = np.where(ac == 0, Pc[:, 1], np.where(ac == 1, Pc[:, 2], Pc[:, 1]))
        rs = np.random.default_rng(zlib.crc32(name.encode()))
        offs = rs.random(2)
        d['uv'] = np.stack([u / tface[cf] + offs[0], w / tface[cf] + offs[1]], -1)
    # ---- unique wear atlases (UV1): charts + packing now, bakes/recipes once the objects exist
    if m.bake:
        import vbake
        vbake.prepare(m, data, bvh_world)
    # ---- create bpy objects
    scene_meshes = {}
    objs = {}
    for name in m.order:
        o = m.objs[name]
        src = m.objs[o.share] if o.share else o
        if src.name not in data:
            continue
        d = data[src.name]
        if src.name not in scene_meshes:
            me = bpy.data.meshes.new(src.name)
            Vl = d['V'] - src.origin
            cnl = d['cn']
            if src.parent and src.prot is not None:          # geometry lives in the (rotated) socket frame
                Rg = np.array(Euler([a * D2R for a in src.prot], 'XYZ').to_matrix(), dtype=np.float64)
                Vl = Vl @ Rg
                cnl = cnl @ Rg
            Vb = Vl @ G2B_np.T
            me.from_pydata(Vb.tolist(), [], [tuple(int(i) for i in f) for f in d['F']])
            for mt in d['mats']:
                me.materials.append(vmat.get(mt))
            MIx = d['MI'].astype(np.int32)
            ss_re = getattr(m, 'split_single', None)
            if ss_re and len(d['mats']) == 1 and not d['shared'] and len(MIx) > 1 and re.match(ss_re, src.name):
                # a detachable node that is ONE glTF primitive loads as a bare Mesh, and the game's load-time mergeRigid() then folds it
                # into the body (it can no longer fly off / hide).  Two primitives with the same material load as a Group (merged back
                # into one draw call inside that group), so the node survives.
                me.materials.append(vmat.get(d['mats'][0]))
                MIx = MIx.copy(); MIx[len(MIx) // 2:] = 1
            me.polygons.foreach_set('material_index', MIx)
            me.polygons.foreach_set('use_smooth', np.ones(len(d['F']), dtype=bool))
            cnb = (cnl @ G2B_np.T)
            try:
                me.normals_split_custom_set(cnb.tolist())
            except Exception as ex:
                print("custom normals failed", ex)
            uv = me.uv_layers.new(name='UVMap')
            uv.data.foreach_set('uv', d['uv'].astype(np.float32).ravel())
            if d.get('uv1') is not None:
                uv1 = me.uv_layers.new(name='UV1')
                uv1.data.foreach_set('uv', d['uv1'].astype(np.float32).ravel())
            if d['col'] is not None:
                ca = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
                rgba = np.ones((len(Vb), 4), np.float32); rgba[:, :3] = d['col']
                ca.data.foreach_set('color', rgba.ravel())
                me.color_attributes.active_color = ca
            me.update()
            scene_meshes[src.name] = me
        if o.hidden:
            continue
        ob = bpy.data.objects.new(name, scene_meshes[src.name])
        bpy.context.collection.objects.link(ob)
        ob.location = G2B @ Vector(o.origin)
        objs[name] = ob
    # hidden-source objects that are referenced only via instances need no object
    empties = {}
    for (nm, pos, rot, size) in m.socks:
        e = bpy.data.objects.new(nm, None)
        e.empty_display_type = 'PLAIN_AXES'; e.empty_display_size = size
        bpy.context.collection.objects.link(e)
        e.location = G2B @ V3(pos)
        if rot is not None:
            Rg = Euler((rot[0] * D2R, rot[1] * D2R, rot[2] * D2R), 'XYZ').to_matrix()
            Rb = G2B.to_3x3() @ Rg @ G2B.to_3x3().transposed()
            e.rotation_euler = Rb.to_euler()
        empties[nm] = e
    # mesh nodes parented to sockets (e.g. steering_wheel_mesh under the steering_wheel socket)
    for name, ob in objs.items():
        o = m.objs[name]
        if o.parent and o.parent in empties:
            ob.parent = empties[o.parent]
            ob.matrix_parent_inverse.identity()
            ob.location = (0, 0, 0)
    if m.bake:
        vbake.finish(m, data, objs)


def export_glb(path, jpeg_q=82):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        o.select_set(True)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
              export_materials='EXPORT', export_cameras=False, export_lights=False, export_extras=False,
              export_image_format='JPEG', export_jpeg_quality=jpeg_q, export_texcoords=True, export_normals=True,
              export_tangents=False, export_vertex_color='ACTIVE', export_animations=False, export_skins=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as ex:
        print("export kw retry:", ex)
        for k in ('export_vertex_color', 'export_jpeg_quality'):
            kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)
    print("EXPORTED", path, "%.0f KB" % (os.path.getsize(path) / 1024))
