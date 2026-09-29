"""slib.py - RIDE OR DIE STRUCTURE builder (Blender 4.5 headless).

Author everything in GAME coordinates:  +X = lateral (left of driver), +Y = up, +Z = along the road (forward).
The lib converts to Blender (x, -z, y) so that the glTF export (+Y up) lands exactly on these coordinates.

    from slib import *
    p = Piece("jump_ramp", seed=3)
    p.bx("concrete", (-7, 7), (-1, 0), (0, 12), bevel=0.05)      # min/max box
    p.box("metal_dark", (0, 1, 2), (1, 1, 1), rot=(0, 30, 0))     # centre + size (+ rot pitch/yaw/roll, deg)
    p.tube("steel_beam", (0, 0, 0), (0, 5, 3), 0.1)               # cylinder between points
    p.beam("steel_beam", p0, p1, w, h)                            # rectangular beam between points
    p.extrude("concrete", [(x, y), ...], z0, z1)                  # prism from an XY profile along Z
    p.loft("rock_red", rings)                                     # rings of equal-length point lists
    p.surface("road_surface", "asphalt", xs, zs, lambda x, z: y)  # up-facing grid (road decks, ramps)
    p.cbx((x0, x1), (y0, y1), (z0, z1))                            # collision box
    p.socket("pier", (0, -1.8, 0))
    p.build()                                                     # AO + grime vertex colours + UV + export + meta

Vertex colours (COLOR_0, linear) carry grime / AO / streaks / strata; base colours live in the materials (MATDEFS).
UVs are per-face box projections in metres * 0.25 (tileable textures: 1 uv unit = 4 m) - so the game can swap textures by material name.
"""
import bpy
import bmesh
import math
import os
import sys
import json
import random
import numpy as np
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import rod_lib as R  # noqa: E402

OUT_DIR = os.path.join(R.PUBLIC, "models", "structures")
META_DIR = os.path.join(HERE, "meta")
D2R = math.pi / 180.0

# ------------------------------------------------------------------------------------------------ materials
# name: (sRGB hex base, metallic, roughness, emissive hex or None, emissive strength, alpha, double_sided)


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


MATDEFS = {
    "concrete":      ("#8d8474", 0.0, 0.92, None, 0, 1.0, False),
    "concrete_dark": ("#5f574b", 0.0, 0.92, None, 0, 1.0, False),
    "rebar":         ("#5a3b2a", 0.55, 0.65, None, 0, 1.0, False),
    "metal_dark":    ("#2c2e32", 0.75, 0.55, None, 0, 1.0, False),
    "metal_bare":    ("#82868a", 0.85, 0.42, None, 0, 1.0, False),
    "rust":          ("#8a4522", 0.45, 0.78, None, 0, 1.0, False),
    "steel_beam":    ("#606870", 0.8, 0.5, None, 0, 1.0, False),
    "asphalt":       ("#403c39", 0.0, 0.9, None, 0, 1.0, False),
    "glass":         ("#8db6c6", 0.0, 0.06, None, 0, 0.36, True),
    "brick":         ("#8c4633", 0.0, 0.92, None, 0, 1.0, False),
    "paint":         ("#c4beb0", 0.05, 0.6, None, 0, 1.0, False),
    "paint2":        ("#c4beb0", 0.05, 0.6, None, 0, 1.0, False),
    "hazard":        ("#bcb6a6", 0.0, 0.7, None, 0, 1.0, False),
    "wood":          ("#86653f", 0.0, 0.88, None, 0, 1.0, False),
    "canvas":        ("#9c9178", 0.0, 1.0, None, 0, 1.0, True),
    "rubber":        ("#1d1d1f", 0.0, 0.92, None, 0, 1.0, False),
    "spike":         ("#8f9297", 0.9, 0.4, None, 0, 1.0, False),
    "bone":          ("#dcd3bb", 0.0, 0.8, None, 0, 1.0, False),
    "rock_red":      ("#9e5433", 0.0, 0.96, None, 0, 1.0, False),
    "rock_grey":     ("#78746d", 0.0, 0.96, None, 0, 1.0, False),
    "sand":          ("#c9a874", 0.0, 1.0, None, 0, 1.0, False),
    "dirt_red":      ("#9a5a3a", 0.0, 1.0, None, 0, 1.0, False),
    "water_dark":    ("#1e5566", 0.0, 0.1, None, 0, 1.0, False),
    "light_amber":   ("#ff9a30", 0.0, 0.4, "#ff8a1a", 3.0, 1.0, False),
    "light_head":    ("#fff2d0", 0.0, 0.3, "#fff0c8", 3.5, 1.0, False),
    "light_tail":    ("#ff2a1a", 0.0, 0.4, "#ff2010", 3.0, 1.0, False),
    "light_green":   ("#40ff80", 0.0, 0.4, "#30ff70", 2.5, 1.0, False),
    "light_boost":   ("#20c8ff", 0.0, 0.4, "#10b8ff", 2.6, 1.0, False),
    "collision":     ("#ff00ff", 0.0, 1.0, None, 0, 0.0, True),
}
NO_WEAR = {"glass", "light_amber", "light_head", "light_tail", "light_green", "light_boost", "collision"}
NO_AO = {"collision"}
TINTABLE = {"paint", "paint2"}


ALBEDO_SCALE = 0.72   # viewer/game lighting is strong: keep albedos mid-value so lit faces do not clip to white


def get_mat(name):
    d = MATDEFS.get(name)
    if d is None:
        raise KeyError("unknown material " + name)
    hexc, metal, rough, emit, es, alpha, ds = d
    e = srgb(emit) if emit else None
    k = 1.0 if (emit or name in ("glass", "hazard", "collision")) else ALBEDO_SCALE
    m = R.mat(name, tuple(c * k for c in srgb(hexc)), metal=metal, rough=rough, emit=e, emit_strength=es, alpha=alpha, double_sided=ds)
    return m


# ------------------------------------------------------------------------------------------------ noise (numpy)
def _hash(ix, iy, iz, seed):
    n = (ix.astype(np.uint64) * np.uint64(374761393) + iy.astype(np.uint64) * np.uint64(668265263)
         + iz.astype(np.uint64) * np.uint64(2147483629) + np.uint64(seed * 1274126177 % 4294967296)) & np.uint64(0xFFFFFFFF)
    n = ((n ^ (n >> np.uint64(13))) * np.uint64(1274126177)) & np.uint64(0xFFFFFFFF)
    n = n ^ (n >> np.uint64(16))
    return (n & np.uint64(0xFFFF)).astype(np.float64) / 65535.0


def vnoise(P, seed=0):
    """Value noise 0..1 for an (N,3) array."""
    fl = np.floor(P)
    f = P - fl
    f = f * f * (3 - 2 * f)
    i = fl.astype(np.int64)
    ix, iy, iz = i[:, 0] & 0xFFFFF, i[:, 1] & 0xFFFFF, i[:, 2] & 0xFFFFF
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                h = _hash(ix + dx, iy + dy, iz + dz, seed)
                wx = f[:, 0] if dx else 1 - f[:, 0]
                wy = f[:, 1] if dy else 1 - f[:, 1]
                wz = f[:, 2] if dz else 1 - f[:, 2]
                out = out + h * wx * wy * wz
    return out


def fbm(P, seed=0, octaves=4, lac=2.03, gain=0.5):
    tot, amp, norm = 0, 1.0, 0
    for o in range(octaves):
        tot = tot + amp * vnoise(P * (lac ** o), seed + o * 17)
        norm += amp
        amp *= gain
    return tot / norm


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def noise3(x, y, z, seed=0, octaves=3, scale=1.0):
    """Scalar convenience (returns 0..1)."""
    return float(fbm(np.array([[x * scale, y * scale, z * scale]], dtype=np.float64), seed, octaves)[0])


# ------------------------------------------------------------------------------------------------ geometry helpers
def V(v):
    return Vector(v)


def look(direction, up=(0, 1, 0)):
    """Rotation matrix (3x3) with local +Z along `direction` and local +Y as close to `up` as possible."""
    z = Vector(direction).normalized()
    u = Vector(up)
    if abs(z.dot(u.normalized())) > 0.999:
        u = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 0, 1))
    x = u.cross(z).normalized()
    y = z.cross(x)
    return Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z)))


def xf(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """4x4 matrix in game space. rot = (pitch about X, yaw about Y, roll about Z) degrees, applied roll->pitch->yaw."""
    e = Euler((rot[0] * D2R, rot[1] * D2R, rot[2] * D2R), "YXZ")
    m = e.to_matrix().to_4x4()
    s = Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    t = Matrix.Translation(loc)
    return t @ m @ s


_BOX_F = {"px": (1, 3, 7, 5), "nx": (0, 4, 6, 2), "py": (2, 6, 7, 3), "ny": (0, 1, 5, 4), "pz": (4, 5, 7, 6), "nz": (0, 2, 3, 1)}


def _signed_volume(verts, faces):
    vol = 0.0
    for f in faces:
        a = verts[f[0]]
        for i in range(1, len(f) - 1):
            b, c = verts[f[i]], verts[f[i + 1]]
            vol += a.dot(b.cross(c)) / 6.0
    return vol


def fix_winding(verts, faces):
    if _signed_volume(verts, faces) < 0:
        return [tuple(reversed(f)) for f in faces]
    return faces


def _bevel_shell(verts, faces, width, segs):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    bm.normal_update()
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=width, offset_type="OFFSET", segments=segs, profile=0.5,
                    affect="EDGES", clamp_overlap=True)
    bm.verts.ensure_lookup_table()
    idx = {v: i for i, v in enumerate(bm.verts)}
    nv = [v.co.copy() for v in bm.verts]
    nf = [tuple(idx[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return nv, nf


def _grid_split(verts, faces, maxlen):
    """Split quads into a grid with cells <= maxlen (bilinear)."""
    nv, nf = list(verts), []
    for f in faces:
        if len(f) != 4:
            nf.append(f)
            continue
        a, b, c, d = [verts[i] for i in f]
        nu = max(1, int(math.ceil(max((b - a).length, (c - d).length) / maxlen)))
        nw = max(1, int(math.ceil(max((d - a).length, (c - b).length) / maxlen)))
        if nu == 1 and nw == 1:
            nf.append(f)
            continue
        base = len(nv)
        for j in range(nw + 1):
            t = j / nw
            for i in range(nu + 1):
                s = i / nu
                p0 = a.lerp(b, s)
                p1 = d.lerp(c, s)
                nv.append(p0.lerp(p1, t))
        for j in range(nw):
            for i in range(nu):
                i0 = base + j * (nu + 1) + i
                nf.append((i0, i0 + 1, i0 + nu + 2, i0 + nu + 1))
    return nv, nf


def _weld(verts, faces, tol=1e-4):
    m, out, idx = {}, [], []
    for v in verts:
        k = (round(v.x / tol), round(v.y / tol), round(v.z / tol))
        if k not in m:
            m[k] = len(out)
            out.append(v)
        idx.append(m[k])
    nf = []
    for f in faces:
        g = []
        for i in f:
            j = idx[i]
            if not g or g[-1] != j:
                g.append(j)
        if len(g) > 1 and g[0] == g[-1]:
            g.pop()
        if len(g) >= 3 and len(set(g)) == len(g):
            nf.append(tuple(g))
    return out, nf


class Acc:
    def __init__(self, node, mat):
        self.node, self.mat = node, mat
        self.v, self.f, self.sg, self.tint = [], [], [], []

    def tris(self):
        return sum(len(f) - 2 for f in self.f)


DEFAULT_STYLE = dict(
    ground_y=0.0, dirt_h=1.8, dirt_amt=0.55, noise_amt=0.3, noise_scale=0.35, streak_amt=0.3,
    dust_amt=0.12, under_amt=0.25, ao_dist=3.0, ao_amt=0.8, ao_rays=14, smooth_angle=34.0, uv_scale=0.25,
)


class Piece:
    def __init__(self, pid, seed=1, **style):
        R.reset()
        self.id = pid
        self.seed = seed
        self.rng = random.Random(seed)
        self.accs = {}
        self.cols = []
        self.sockets = []
        self.notes = {}
        self.style = dict(DEFAULT_STYLE)
        self.style.update(style)
        self.mat_style = {}   # per-material style overrides
        self.extra = {}

    # ---------------------------------------------------------------------------------- accumulation
    def acc(self, mat, node=None):
        node = node or mat
        k = (node, mat)
        if k not in self.accs:
            if mat not in MATDEFS:
                raise KeyError("unknown material " + mat)
            self.accs[k] = Acc(node, mat)
        return self.accs[k]

    def raw(self, mat, verts, faces, M=None, node=None, sg=0, tint=None, sub=0, bevel=0, bsegs=1, weld=True, autofix=False):
        vs = [Vector(v) for v in verts]
        fs = [tuple(f) for f in faces]
        if autofix:
            fs = fix_winding(vs, fs)
        if bevel > 0:
            vs, fs = _bevel_shell(vs, fs, bevel, bsegs)
        if M is not None:
            vs = [M @ v for v in vs]
        if sub and sub > 0:
            vs, fs = _grid_split(vs, fs, sub)
        if weld:
            vs, fs = _weld(vs, fs)
        a = self.acc(mat, node)
        base = len(a.v)
        a.v.extend(vs)
        for f in fs:
            a.f.append(tuple(i + base for i in f))
            a.sg.append(sg)
            a.tint.append(tint)
        return a

    _sgc = 0

    def _new_sg(self):
        Piece._sgc += 1
        return Piece._sgc

    # ---------------------------------------------------------------------------------- primitives
    def box(self, mat, c, s, rot=None, bevel=0, bsegs=1, skip=(), node=None, tint=None, sub=0, flat=False, M=None):
        sx, sy, sz = s[0] / 2, s[1] / 2, s[2] / 2
        verts = [((ix - .5) * 2 * sx, (iy - .5) * 2 * sy, (iz - .5) * 2 * sz) for iz in (0, 1) for iy in (0, 1) for ix in (0, 1)]
        faces = [f for k, f in _BOX_F.items() if k not in skip]
        if M is None:
            M = xf(c, rot or (0, 0, 0))
        return self.raw(mat, verts, faces, M, node, sg=-1 if flat else 0, tint=tint, sub=sub,
                        bevel=0 if skip else bevel, bsegs=bsegs)

    def bx(self, mat, xr, yr, zr, **kw):
        """Box from min/max ranges."""
        c = ((xr[0] + xr[1]) / 2, (yr[0] + yr[1]) / 2, (zr[0] + zr[1]) / 2)
        s = (abs(xr[1] - xr[0]), abs(yr[1] - yr[0]), abs(zr[1] - zr[0]))
        return self.box(mat, c, s, **kw)

    def beam(self, mat, p0, p1, w, h, up=(0, 1, 0), **kw):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        if L < 1e-6:
            return None
        rm = look(d, up).to_4x4()
        M = Matrix.Translation((p0 + p1) / 2) @ rm
        return self.box(mat, (0, 0, 0), (w, h, L), M=M, **kw)

    def cyl_pts(self, sides, r0, r1, length, caps=True, cap_a=True, cap_b=True):
        verts, faces = [], []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append((r0 * math.cos(a), r0 * math.sin(a), -length / 2))
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append((r1 * math.cos(a), r1 * math.sin(a), length / 2))
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((k, k2, sides + k2, sides + k))
        side_faces = len(faces)
        if caps and cap_a:
            faces.append(tuple(range(sides - 1, -1, -1)))
        if caps and cap_b:
            faces.append(tuple(range(sides, 2 * sides)))
        return verts, faces, side_faces

    def tube(self, mat, p0, p1, r, sides=8, r2=None, caps=True, node=None, tint=None, up=(0, 1, 0), smooth=True, bevel=0, sub=0):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        if L < 1e-6:
            return None
        verts, faces, ns = self.cyl_pts(sides, r, r if r2 is None else r2, L, caps)
        M = Matrix.Translation((p0 + p1) / 2) @ look(d, up).to_4x4()
        # smoothing group only on side faces: emit as two raw calls to keep sg semantic
        sg = self._new_sg() if smooth else 0
        side, caps_f = faces[:ns], faces[ns:]
        # weld would merge nothing across: side/caps share verts; keep both in one call w/ side sg via split
        vs = [Vector(v) for v in verts]
        vs = [M @ v for v in vs]
        a = self.acc(mat, node)
        base = len(a.v)
        a.v.extend(vs)
        for f in side:
            a.f.append(tuple(i + base for i in f)); a.sg.append(sg); a.tint.append(tint)
        for f in caps_f:
            a.f.append(tuple(i + base for i in f)); a.sg.append(0); a.tint.append(tint)
        return a

    def cyl(self, mat, c, r, h, axis="y", sides=12, r2=None, **kw):
        """Cylinder/cone centred at c, along axis x|y|z (r2 = radius at +axis end)."""
        c = Vector(c)
        d = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[axis]
        p0 = c - Vector(d) * (h / 2)
        p1 = c + Vector(d) * (h / 2)
        return self.tube(mat, p0, p1, r, sides=sides, r2=r2, **kw)

    def extrude(self, mat, profile, z0, z1, M=None, node=None, tint=None, bevel=0, bsegs=1, sub=0, flat=False, sg=None, caps=True):
        n = len(profile)
        verts = [(x, y, z0) for x, y in profile] + [(x, y, z1) for x, y in profile]
        faces = []
        for k in range(n):
            k2 = (k + 1) % n
            faces.append((k, k2, n + k2, n + k))
        if caps:
            faces.append(tuple(range(n - 1, -1, -1)))
            faces.append(tuple(range(n, 2 * n)))
        vs = [Vector(v) for v in verts]
        faces = fix_winding(vs, faces) if caps else faces
        return self.raw(mat, verts, faces, M, node, sg=-1 if flat else (0 if sg is None else sg), tint=tint, bevel=bevel, bsegs=bsegs, sub=sub)

    def extrude_x(self, mat, profile_zy, x0, x1, **kw):
        """Extrude a side profile [(z, y), ...] along X from x0 to x1."""
        M = xf((0, 0, 0), (0, -90, 0))
        return self.extrude(mat, profile_zy, -x1, -x0, M=M, **kw)

    def extrude_y(self, mat, profile_xz, y0, y1, **kw):
        """Extrude a plan profile [(x, z), ...] vertically from y0 to y1."""
        M = xf((0, 0, 0), (-90, 0, 0))
        return self.extrude(mat, [(x, -z) for x, z in profile_xz], y0, y1, M=M, **kw)

    def loft(self, mat, rings, closed=True, cap_a=True, cap_b=True, node=None, tint=None, flat=False, M=None, sub=0, sg=0, bevel=0):
        n = len(rings[0])
        verts, faces = [], []
        for r in rings:
            assert len(r) == n, "loft rings need equal counts"
            verts.extend(tuple(p) for p in r)
        for i in range(len(rings) - 1):
            for j in range(n):
                j2 = (j + 1) % n
                if not closed and j2 == 0:
                    continue
                faces.append((i * n + j, i * n + j2, (i + 1) * n + j2, (i + 1) * n + j))
        if closed and cap_a:
            faces.append(tuple(range(n - 1, -1, -1)))
        if closed and cap_b:
            faces.append(tuple((len(rings) - 1) * n + j for j in range(n)))
        vs = [Vector(v) for v in verts]
        if closed and cap_a and cap_b:
            faces = fix_winding(vs, faces)
        return self.raw(mat, verts, faces, M, node, sg=-1 if flat else sg, tint=tint, sub=sub, bevel=bevel)

    def quad(self, mat, a, b, c, d, node=None, tint=None, sub=0, flat=False):
        return self.raw(mat, [a, b, c, d], [(0, 1, 2, 3)], None, node, sg=-1 if flat else 0, tint=tint, sub=sub)

    def poly(self, mat, pts, node=None, tint=None, flat=True):
        return self.raw(mat, pts, [tuple(range(len(pts)))], None, node, sg=-1 if flat else 0, tint=tint)

    def surface(self, node, mat, xs, zs, yfn, tint=None, flat=False, flip=False):
        """Up-facing grid surface: xs, zs = coordinate lists; yfn(x, z) -> y (or (x, y, z))."""
        verts, faces = [], []
        nx = len(xs)
        for z in zs:
            for x in xs:
                r = yfn(x, z)
                verts.append((x, r, z) if not isinstance(r, tuple) else r)
        for j in range(len(zs) - 1):
            for i in range(nx - 1):
                a = j * nx + i
                f = (a, a + nx, a + nx + 1, a + 1)
                faces.append(tuple(reversed(f)) if flip else f)
        return self.raw(mat, verts, faces, None, node, sg=-1 if flat else 0, tint=tint, weld=False)

    def mesh_grid(self, mat, pts, nu, nv, closed_u=False, flip=False, node=None, tint=None, flat=False, M=None):
        """Generic (nu x nv) point grid -> quads; pts indexed [j*nu+i]."""
        faces = []
        for j in range(nv - 1):
            for i in range(nu if closed_u else nu - 1):
                i2 = (i + 1) % nu
                f = (j * nu + i, j * nu + i2, (j + 1) * nu + i2, (j + 1) * nu + i)
                faces.append(tuple(reversed(f)) if flip else f)
        return self.raw(mat, pts, faces, M, node, sg=-1 if flat else 0, tint=tint, weld=False)

    # ---------------------------------------------------------------------------------- collision + sockets
    def cbox(self, c, s, rot=None, M=None):
        sx, sy, sz = s[0] / 2, s[1] / 2, s[2] / 2
        verts = [((ix - .5) * 2 * sx, (iy - .5) * 2 * sy, (iz - .5) * 2 * sz) for iz in (0, 1) for iy in (0, 1) for ix in (0, 1)]
        M = M if M is not None else xf(c, rot or (0, 0, 0))
        self.cols.append(([M @ Vector(v) for v in verts], list(_BOX_F.values())))

    def cbx(self, xr, yr, zr, rot=None):
        c = ((xr[0] + xr[1]) / 2, (yr[0] + yr[1]) / 2, (zr[0] + zr[1]) / 2)
        s = (abs(xr[1] - xr[0]), abs(yr[1] - yr[0]), abs(zr[1] - zr[0]))
        self.cbox(c, s, rot)

    def cbeam(self, p0, p1, w, h, up=(0, 1, 0)):
        p0, p1 = Vector(p0), Vector(p1)
        L = (p1 - p0).length
        M = Matrix.Translation((p0 + p1) / 2) @ look(p1 - p0, up).to_4x4()
        self.cbox((0, 0, 0), (w, h, L), M=M)

    def chull(self, pts):
        """Convex hull collision volume from points."""
        bm = bmesh.new()
        for p in pts:
            bm.verts.new(p)
        bmesh.ops.convex_hull(bm, input=list(bm.verts), use_existing_faces=False)
        # remove loose interior verts
        bm.verts.ensure_lookup_table()
        used = [v for v in bm.verts if v.link_faces]
        idx = {v: i for i, v in enumerate(used)}
        verts = [v.co.copy() for v in used]
        faces = [tuple(idx[v] for v in f.verts) for f in bm.faces]
        bm.free()
        self.cols.append((verts, faces))

    def cextrude(self, profile, z0, z1):
        pts = [(x, y, z0) for x, y in profile] + [(x, y, z1) for x, y in profile]
        self.chull(pts)

    def socket(self, name, pos, yaw=0.0):
        self.sockets.append((name, tuple(pos), yaw))

    # ---------------------------------------------------------------------------------- shading / colours
    def _matcolor(self, mat, w, n1, n2, P, Nn):
        """Return (N,3) linear multiplier for material `mat`; w = grime multiplier, n1/n2 noise 0..1."""
        N = len(w)
        one = np.ones(N)
        if mat in TINTABLE:
            g = w * (0.9 + 0.15 * n2)
            return np.stack([g, g, g], 1)
        if mat == "rust" or mat == "rebar":
            t = smoothstep(0.25, 0.8, n1)
            g = w * (0.6 + 0.7 * t)
            return np.stack([g * (0.85 + 0.25 * t), g * (0.55 + 0.6 * t * n2), g * (0.4 + 0.5 * t * n2)], 1)
        if mat in ("metal_bare", "steel_beam", "metal_dark", "spike"):
            st = smoothstep(0.55, 0.82, n1) * (0.35 + 0.65 * smoothstep(0.3, 0.7, n2))
            g = w * (0.9 + 0.2 * n2)
            return np.stack([g * (1 - 0.0 * st), g * (1 - 0.22 * st), g * (1 - 0.45 * st)], 1)
        if mat in ("concrete", "concrete_dark"):
            stain = smoothstep(0.6, 0.85, n2)
            g = w * (0.93 + 0.14 * n1)
            return np.stack([g * (1.0 - 0.02 * stain), g * (0.985 - 0.06 * stain), g * (0.955 - 0.12 * stain)], 1)
        if mat in ("rock_red", "rock_grey", "sand", "dirt_red"):
            y = P[:, 1]
            sp = self.style.get("strata_period", 2.6)
            band = 0.5 + 0.5 * np.sin(y / sp * 2 * math.pi + n1 * 5.0)
            band2 = 0.5 + 0.5 * np.sin(y / (sp * 0.37) * 2 * math.pi + n2 * 4.0)
            g = w * (0.6 + 0.45 * band + 0.12 * band2)
            if mat == "rock_red":
                return np.stack([g * (1.0 + 0.08 * band), g * (0.84 + 0.14 * band - 0.08 * n2), g * (0.7 + 0.12 * band - 0.2 * n1)], 1)
            return np.stack([g, g * 0.985, g * 0.96], 1)
        if mat == "asphalt":
            x = P[:, 0]
            track = np.exp(-((np.abs(x) - 1.9) ** 2) / 0.5)
            patch = smoothstep(0.55, 0.75, n2)
            g = w * (0.8 + 0.4 * n1) * (1 - 0.3 * track) * (1 - 0.3 * patch)
            return np.stack([g * 1.02, g, g * 0.96], 1)
        if mat == "brick":
            g = w * (0.7 + 0.5 * n2)
            return np.stack([g, g * (0.95 + 0.1 * n1), g * (0.9 + 0.1 * n1)], 1)
        if mat == "wood":
            g = w * (0.7 + 0.5 * n2)
            return np.stack([g, g * 0.97, g * 0.94], 1)
        if mat == "canvas":
            g = w * (0.75 + 0.4 * n2)
            return np.stack([g, g * 0.97, g * 0.9], 1)
        g = w * (0.92 + 0.12 * n1)
        return np.stack([g, g * 0.985, g * 0.96], 1)

    def _corner_data(self, a):
        """Per-corner arrays for an Acc: P (N,3), Nn (N,3), face id list, and per-face normals."""
        P, Nn, T, fid = [], [], [], []
        for fi, f in enumerate(a.f):
            pts = [a.v[i] for i in f]
            n = Vector()
            for k in range(len(pts)):
                p, q = pts[k], pts[(k + 1) % len(pts)]
                n.x += (p.y - q.y) * (p.z + q.z)
                n.y += (p.z - q.z) * (p.x + q.x)
                n.z += (p.x - q.x) * (p.y + q.y)
            if n.length > 1e-12:
                n.normalize()
            else:
                n = Vector((0, 1, 0))
            t = a.tint[fi]
            if t is None:
                t = (1.0, 1.0, 1.0)
            elif isinstance(t, (int, float)):
                t = (t, t, t)
            jit = 1.0 + self.style.get("facejit", 0.05) * (((fi * 2654435761 + self.seed * 97) % 1000) / 500.0 - 1.0)
            t = (t[0] * jit, t[1] * jit, t[2] * jit)
            for p in pts:
                P.append((p.x, p.y, p.z))
                Nn.append((n.x, n.y, n.z))
                T.append(t)
                fid.append(fi)
        return np.array(P, dtype=np.float64).reshape(-1, 3), np.array(Nn, dtype=np.float64).reshape(-1, 3), np.array(T, dtype=np.float64).reshape(-1, 3)

    def _ao(self, bvh, P, Nn, dist, rays):
        """Ambient occlusion 0..1 (1 = open) per corner via BVH ray casting (cached by position+normal)."""
        # hemisphere directions (cosine-ish Fibonacci)
        dirs = []
        for i in range(rays):
            u = (i + 0.5) / rays
            r = math.sqrt(u)
            th = i * 2.399963
            dirs.append((r * math.cos(th), r * math.sin(th), math.sqrt(max(0.0, 1 - u))))
        cache, out = {}, np.ones(len(P))
        for i in range(len(P)):
            n = Nn[i]
            key = (round(P[i, 0], 2), round(P[i, 1], 2), round(P[i, 2], 2), round(n[0], 1), round(n[1], 1), round(n[2], 1))
            if key in cache:
                out[i] = cache[key]
                continue
            nv = Vector(n)
            rm = look(nv, (0, 1, 0) if abs(n[1]) < 0.95 else (1, 0, 0))
            o = Vector(P[i]) + nv * 0.04
            occ = 0.0
            for d in dirs:
                dv = rm @ Vector(d)
                hit = bvh.ray_cast(o, dv, dist)
                if hit[0] is not None:
                    occ += 1.0 - (hit[3] / dist) * 0.65
            val = 1.0 - occ / rays
            cache[key] = val
            out[i] = val
        return out

    # ---------------------------------------------------------------------------------- build
    def build(self, export=True, verbose=True):
        st = self.style
        vis = [a for a in self.accs.values() if a.mat not in NO_AO and a.f]
        # --- occluder BVH over everything visual except glass
        tv, tp = [], []
        for a in vis:
            if a.mat in ("glass",):
                continue
            off = len(tv)
            tv.extend((v.x, v.y, v.z) for v in a.v)
            for f in a.f:
                for i in range(1, len(f) - 1):
                    tp.append((off + f[0], off + f[i], off + f[i + 1]))
        bvh = BVHTree.FromPolygons(tv, tp, all_triangles=True) if tp else None

        objs = []
        total_tris = 0
        bbmin = Vector((1e9, 1e9, 1e9)); bbmax = Vector((-1e9, -1e9, -1e9))
        mat_names = set()
        node_info = {}
        for key, a in self.accs.items():
            if not a.f:
                continue
            P, Nn, T = self._corner_data(a)
            ms = dict(st)
            ms.update(self.mat_style.get(a.mat, {}))
            ms.update(self.mat_style.get(a.node, {}))
            if a.mat in NO_WEAR:
                cols = np.ones((len(P), 3))
                cols = cols * T
            else:
                seedv = self.seed * 13 + sum(ord(c) for c in a.mat) % 97
                w = np.ones(len(P))
                h = np.maximum(P[:, 1] - ms["ground_y"], 0)
                w *= 1 - ms["dirt_amt"] * np.exp(-h / ms["dirt_h"])
                n1 = fbm(P * ms["noise_scale"], seedv)
                n2 = fbm(P * (ms["noise_scale"] * 3.1) + 11.7, seedv + 5, 3)
                n1 = np.clip(0.5 + (n1 - 0.5) * 2.3, 0, 1)
                n2 = np.clip(0.5 + (n2 - 0.5) * 2.3, 0, 1)
                w *= 1 + ms["noise_amt"] * (n1 * 2 - 1)
                sn = fbm(np.stack([P[:, 0] * 2.3 + P[:, 2] * 1.9, P[:, 1] * 0.10, np.full(len(P), seedv * 0.37)], 1), seedv + 7, 2)
                vert = 1 - np.abs(Nn[:, 1])
                w *= 1 - ms["streak_amt"] * smoothstep(0.42, 0.7, sn) * vert
                w *= 1 + ms["dust_amt"] * np.maximum(Nn[:, 1], 0) - ms["under_amt"] * np.maximum(-Nn[:, 1], 0)
                if bvh is not None and ms["ao_amt"] > 0 and a.mat != "asphalt":
                    ao = self._ao(bvh, P, Nn, ms["ao_dist"], ms["ao_rays"])
                    w *= (1 - ms["ao_amt"]) + ms["ao_amt"] * ao
                cols = self._matcolor(a.mat, w, n1, n2, P, Nn) * T
            cols = np.clip(cols, 0.0, 2.0)

            # --- bmesh in Blender coords
            bm = bmesh.new()
            bv = [bm.verts.new((v.x, -v.z, v.y)) for v in a.v]
            uvl = bm.loops.layers.uv.new("UVMap")
            cl = bm.loops.layers.float_color.new("Col")
            corner = 0
            fmap = []
            for fi, f in enumerate(a.f):
                try:
                    face = bm.faces.new([bv[i] for i in f])
                except ValueError:
                    corner += len(f)
                    continue
                us = st["uv_scale"]
                nrm = Nn[corner]
                ax = int(np.argmax(np.abs(nrm)))
                for k, loop in enumerate(face.loops):
                    p = P[corner + k]
                    if ax == 1:
                        uv = (p[0], p[2])
                    elif ax == 0:
                        uv = (p[2], p[1])
                    else:
                        uv = (p[0], p[1])
                    loop[uvl].uv = (uv[0] * us, uv[1] * us)
                    c = cols[corner + k]
                    loop[cl] = (float(c[0]), float(c[1]), float(c[2]), 1.0)
                corner += len(f)
                fmap.append((face, a.sg[fi]))
            bm.faces.ensure_lookup_table()
            bm.faces.index_update()
            sgl = {f.index: sg for f, sg in fmap}
            bm.normal_update()
            thr = st["smooth_angle"] * D2R
            for face, sg in fmap:
                face.smooth = sg != -1
            for e in bm.edges:
                lf = e.link_faces
                if len(lf) == 2:
                    sa, sb = sgl.get(lf[0].index, 0), sgl.get(lf[1].index, 0)
                    if sa == -1 or sb == -1:
                        e.smooth = False
                    elif sa == sb and sa != 0:
                        e.smooth = True
                    else:
                        e.smooth = lf[0].normal.angle(lf[1].normal, 0.0) < thr
            me = bpy.data.meshes.new(a.node)
            bm.to_mesh(me)
            bm.free()
            try:
                me.color_attributes.active_color = me.color_attributes["Col"]
                me.color_attributes.render_color_index = me.color_attributes.find("Col")
            except Exception:
                pass
            o = bpy.data.objects.new(a.node, me)
            bpy.context.collection.objects.link(o)
            o.data.materials.append(get_mat(a.mat))
            objs.append(o)
            mat_names.add(a.mat)
            if a.mat != "collision":
                total_tris += a.tris()
                for v in a.v:
                    bbmin.x = min(bbmin.x, v.x); bbmin.y = min(bbmin.y, v.y); bbmin.z = min(bbmin.z, v.z)
                    bbmax.x = max(bbmax.x, v.x); bbmax.y = max(bbmax.y, v.y); bbmax.z = max(bbmax.z, v.z)
            node_info[a.node] = a.tris()

        # --- collision
        col_tris = 0
        if self.cols:
            verts, faces = [], []
            for vs, fs in self.cols:
                b = len(verts)
                verts.extend(vs)
                faces.extend(tuple(i + b for i in f) for f in fs)
            bm = bmesh.new()
            bv = [bm.verts.new((v.x, -v.z, v.y)) for v in verts]
            for f in faces:
                try:
                    bm.faces.new([bv[i] for i in f])
                except ValueError:
                    pass
            bm.normal_update()
            me = bpy.data.meshes.new("collision")
            bm.to_mesh(me)
            bm.free()
            o = bpy.data.objects.new("collision", me)
            o["role"] = "collision"
            bpy.context.collection.objects.link(o)
            o.data.materials.append(get_mat("collision"))
            objs.append(o)
            col_tris = sum(len(f) - 2 for f in faces)
        # --- sockets
        for name, pos, yaw in self.sockets:
            e = R.empty(name, (pos[0], -pos[2], pos[1]), (0, 0, yaw), size=0.5)
            objs.append(e)

        out = os.path.join(OUT_DIR, self.id + ".glb")
        info = {}
        if export:
            os.makedirs(OUT_DIR, exist_ok=True)
            bpy.ops.object.select_all(action="DESELECT")
            for o in objs:
                o.select_set(True)
            kw = dict(filepath=out, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
                      export_materials="EXPORT", export_cameras=False, export_lights=False, export_extras=True,
                      export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_texcoords=True,
                      export_normals=True, export_animations=False, export_skins=False)
            bpy.ops.export_scene.gltf(**kw)
            size_kb = os.path.getsize(out) / 1024
            info = dict(
                id=self.id, file="models/structures/%s.glb" % self.id, tris=total_tris, collision_tris=col_tris,
                size_kb=round(size_kb, 1),
                bbox_min=[round(bbmin.x, 2), round(bbmin.y, 2), round(bbmin.z, 2)],
                bbox_max=[round(bbmax.x, 2), round(bbmax.y, 2), round(bbmax.z, 2)],
                dims=[round(bbmax.x - bbmin.x, 2), round(bbmax.y - bbmin.y, 2), round(bbmax.z - bbmin.z, 2)],
                materials=sorted(mat_names), nodes=node_info,
                sockets={n: [round(x, 3) for x in p] for n, p, _ in self.sockets},
                notes=self.notes,
            )
            os.makedirs(META_DIR, exist_ok=True)
            with open(os.path.join(META_DIR, self.id + ".json"), "w") as fh:
                json.dump(info, fh, indent=1)
            if verbose:
                print("EXPORTED %s  tris=%d col=%d  %.0f KB  dims=%s" % (self.id, total_tris, col_tris, size_kb, info["dims"]))
        return info


# ------------------------------------------------------------------------------------------------ common parts
def ring_arch(hw, wall_h, crown_h, n=14):
    """Tunnel/arch profile points (x, y) from left base up over the crown to right base: straight walls to wall_h then elliptical arch."""
    pts = [(-hw, 0.0)]
    b = crown_h - wall_h
    for i in range(n + 1):
        a = math.pi - math.pi * i / n
        pts.append((hw * math.cos(a), wall_h + b * math.sin(a)))
    pts.append((hw, 0.0))
    return pts


def lerp(a, b, t):
    return a + (b - a) * t


def hazard_strip(p, xr, yr, zr, axis_z=True, n=None, size=0.7, mat="hazard", node=None, off=0.0, face="py"):
    """Yellow/black diagonal-ish hazard stripes on a flat face using alternating vertex-colour boxes (yellow / near-black)."""
    Y = (1.0, 0.74, 0.04)
    K = (0.035, 0.035, 0.04)
    if face == "py":
        x0, x1 = xr; z0, z1 = zr; y = yr[1]
        L = (x1 - x0)
        k = 0
        x = x0
        while x < x1 - 1e-6:
            xe = min(x + size, x1)
            p.quad(mat, (x, y, z0), (x, y, z1), (xe, y, z1), (xe, y, z0), node=node, tint=Y if k % 2 == 0 else K)
            x = xe
            k += 1


def lamp_post(p, x, z, side=1, h=8.0, arm=2.6, mat_pole="metal_dark", lit=True, y0=0.0, yaw_dir=None):
    """Street lamp: pole + curved arm over the road (arm points toward -side*x). side=+1 -> pole at +x, arm toward -x."""
    d = -side
    p.tube(mat_pole, (x, y0, z), (x, y0 + h, z), 0.09, sides=8, r2=0.06)
    p.cyl(mat_pole, (x, y0 + 0.4, z), 0.16, 0.8, "y", sides=8, r2=0.14)
    p.tube(mat_pole, (x, y0 + h, z), (x + d * arm * 0.55, y0 + h + 0.35, z), 0.05, sides=6)
    p.tube(mat_pole, (x + d * arm * 0.55, y0 + h + 0.35, z), (x + d * arm, y0 + h + 0.22, z), 0.045, sides=6)
    hx = x + d * arm
    p.box(mat_pole, (hx, y0 + h + 0.2, z), (0.9, 0.12, 0.34), bevel=0.03)
    if lit:
        p.box("light_amber", (hx, y0 + h + 0.12, z), (0.78, 0.04, 0.26))


def bolts_row(p, mat, pts, r=0.04, h=0.03, axis="z"):
    for c in pts:
        p.cyl(mat, c, r, h, axis, sides=6)


def lattice_tower(p, mat, cx, cz, y0, h, hw0, hw1, panels, leg=0.12, brace=0.05, horiz=True, diag=True, sides=4, stagger=False):
    """Square lattice tower (legs + X braces + horizontals). half-width hw0 at y0 tapering to hw1 at y0+h.
    Tris are dominated by braces: with sides=4 each member ~12 tris. Returns list of level y values."""
    levels = [y0 + h * i / panels for i in range(panels + 1)]
    hw = lambda y: hw0 + (hw1 - hw0) * (y - y0) / h
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    for c in corners:
        p.tube(mat, (cx + c[0] * hw0, y0, cz + c[1] * hw0), (cx + c[0] * hw1, y0 + h, cz + c[1] * hw1), leg, sides=max(4, sides + 2), smooth=False)
    for i in range(panels):
        ya, yb = levels[i], levels[i + 1]
        for k in range(4):
            c0, c1 = corners[k], corners[(k + 1) % 4]
            a0 = (cx + c0[0] * hw(ya), ya, cz + c0[1] * hw(ya))
            a1 = (cx + c1[0] * hw(ya), ya, cz + c1[1] * hw(ya))
            b0 = (cx + c0[0] * hw(yb), yb, cz + c0[1] * hw(yb))
            b1 = (cx + c1[0] * hw(yb), yb, cz + c1[1] * hw(yb))
            if diag:
                if stagger and (i % 2):
                    p.tube(mat, a1, b0, brace, sides=sides, smooth=False)
                else:
                    p.tube(mat, a0, b1, brace, sides=sides, smooth=False)
                    if not stagger:
                        p.tube(mat, a1, b0, brace, sides=sides, smooth=False)
            if horiz:
                p.tube(mat, a0, a1, brace, sides=sides, smooth=False)
    if horiz:
        yb = levels[-1]
        for k in range(4):
            c0, c1 = corners[k], corners[(k + 1) % 4]
            p.tube(mat, (cx + c0[0] * hw(yb), yb, cz + c0[1] * hw(yb)), (cx + c1[0] * hw(yb), yb, cz + c1[1] * hw(yb)), brace, sides=sides, smooth=False)
    return levels
