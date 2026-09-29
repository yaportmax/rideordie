"""Shared helpers for the roadside-outpost buildings (fork B1)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *

# `wood` reads almost black under the strong viewer/game lighting once grime is baked: brighten it for this fork's assets only.
WOOD_BOOST = 2.2
_orig_raw, _orig_tube = Piece.raw, Piece.tube


def _boost(t):
    if t is None:
        return (WOOD_BOOST, WOOD_BOOST, WOOD_BOOST)
    if isinstance(t, (int, float)):
        return (t * WOOD_BOOST,) * 3
    return tuple(x * WOOD_BOOST for x in t)


def _raw(self, mat, verts, faces, M=None, node=None, sg=0, tint=None, **kw):
    if mat == "wood":
        tint = _boost(tint)
    return _orig_raw(self, mat, verts, faces, M, node, sg, tint, **kw)


def _tube(self, mat, p0, p1, r, sides=8, r2=None, caps=True, node=None, tint=None, **kw):
    if mat == "wood":
        tint = _boost(tint)
    return _orig_tube(self, mat, p0, p1, r, sides, r2, caps, node, tint, **kw)


Piece.raw, Piece.tube = _raw, _tube

# ------------------------------------------------------------------------------------------------ block-letter font
_G = {
    "E": [(0, 0, 1, 5), (0, 4, 3, 5), (0, 2, 2, 3), (0, 0, 3, 1)],
    "A": [(0, 0, 1, 4), (2, 0, 3, 4), (0, 4, 3, 5), (0, 2, 3, 3)],
    "T": [(0, 4, 3, 5), (1, 0, 2, 4)],
    "D": [(0, 0, 1, 5), (0, 4, 2, 5), (0, 0, 2, 1), (2, 1, 3, 4)],
    "I": [(1, 0, 2, 5)],
    "N": [(0, 0, 0.95, 5), (2.05, 0, 3, 5), (0.35, 4.55, 2.65, 0.45, "d")],
    "R": [(0, 0, 1, 5), (0, 4, 3, 5), (2, 2.5, 3, 4), (0, 2, 3, 3), (2, 0, 3, 2)],
    "O": [(0, 0, 1, 5), (2, 0, 3, 5), (0, 4, 3, 5), (0, 0, 3, 1)],
    "S": [(0, 4, 3, 5), (0, 3, 1, 4), (0, 2, 3, 3), (2, 1, 3, 2), (0, 0, 3, 1)],
    "G": [(0, 0, 1, 5), (0, 4, 3, 5), (0, 0, 3, 1), (2, 0, 3, 2), (1.5, 2, 3, 3)],
    "F": [(0, 0, 1, 5), (0, 4, 3, 5), (0, 2, 2, 3)],
    "U": [(0, 0, 1, 5), (2, 0, 3, 5), (0, 0, 3, 1)],
    "L": [(0, 0, 1, 5), (0, 0, 3, 1)],
    "M": [(0, 0, 0.9, 5), (2.1, 0, 3, 5), (0.2, 4.7, 1.5, 2.4, "d"), (2.8, 4.7, 1.5, 2.4, "d")],
    "C": [(0, 0, 1, 5), (0, 4, 3, 5), (0, 0, 3, 1)],
    "P": [(0, 0, 1, 5), (0, 4, 3, 5), (2, 2, 3, 4), (0, 2, 3, 3)],
    "H": [(0, 0, 1, 5), (2, 0, 3, 5), (0, 2, 3, 3)],
    "B": [(0, 0, 1, 5), (0, 4, 2, 5), (0, 2, 2, 3), (0, 0, 2, 1), (2, 3, 3, 4), (2, 1, 3, 2)],
    "Y": [(0, 3, 1, 5), (2, 3, 3, 5), (1, 0, 2, 3), (0, 2.5, 3, 3.2)],
    "V": [(0, 1.5, 1, 5), (2, 1.5, 3, 5), (1, 0, 2, 1.5)],
    "K": [(0, 0, 1, 5), (1, 2, 2, 3), (2, 3, 3, 5), (2, 0, 3, 2)],
    "W": [(0, 0, 1, 5), (2, 0, 3, 5), (1, 0, 2, 2.5), (0, 0, 3, 0.9)],
    "Z": [(0, 4, 3, 5), (2, 3, 3, 4), (1, 2, 2, 3), (0, 1, 1, 2), (0, 0, 3, 1)],
    " ": [],
}
_SEG = {"a": (0, 4, 3, 5), "g": (0, 2, 3, 3), "d": (0, 0, 3, 1), "f": (0, 2, 1, 5), "b": (2, 2, 3, 5), "e": (0, 0, 1, 3), "c": (2, 0, 3, 3)}
_DIG = {"0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg"}


def _glyph_rects(ch):
    if ch in _G:
        return _G[ch], 3
    if ch in _DIG:
        return [_SEG[s] for s in _DIG[ch]], 3
    if ch == ".":
        return [(0, 0, 1, 1)], 1
    if ch == "$":
        return [(1, 0, 2, 5), (0, 3.4, 3, 4.2), (0, 1, 3, 1.8)], 3
    return [], 3


def letters(p, text, cx, y0, z, h, mat, face="pz", depth=0.07, gap=1.0, tint=None):
    """Block letters/digits (stroke font). Text reads correctly when seen from the face side.
    (cx, y0, z) = bottom-centre of the text on the sign plane z; face pz = seen from +Z, nz = seen from -Z."""
    u = h / 5.0
    widths = [_glyph_rects(c)[1] for c in text]
    W = (sum(widths) + gap * (len(text) - 1)) * u
    d = 1.0 if face == "pz" else -1.0
    x = -W / 2.0
    zc = z + d * depth / 2
    skip = ("nz",) if face == "pz" else ("pz",)
    for ch, w in zip(text, widths):
        rects, _ = _glyph_rects(ch)
        for rc in rects:
            if len(rc) == 5:   # diagonal stroke (x0,y0,x1,y1,'d')
                xa_, ya_, xb_, yb_ = rc[:4]
                pa = (cx + (x + xa_ * u) * d, y0 + ya_ * u, zc)
                pb = (cx + (x + xb_ * u) * d, y0 + yb_ * u, zc)
                p.beam(mat, pa, pb, u * 0.95, depth, up=(0, 0, 1), tint=tint)
                continue
            x0, yy0, x1, yy1 = rc
            xa, xb = x + x0 * u, x + x1 * u
            xm = (xa + xb) / 2 * d + cx
            p.box(mat, (xm, y0 + (yy0 + yy1) / 2 * u, zc), ((xb - xa), (yy1 - yy0) * u, depth), skip=skip, tint=tint)
        x += (w + gap) * u
    return W


# ------------------------------------------------------------------------------------------------ small props
def torus(p, mat, c, R=0.36, r=0.13, axis="y", seg=10, ring=6, rot=None, tint=None):
    verts, faces = [], []
    for j in range(seg + 1):
        a = 2 * math.pi * (j % seg) / seg
        ca, sa = math.cos(a), math.sin(a)
        for k in range(ring):
            b = 2 * math.pi * k / ring
            rr = R + r * math.cos(b)
            verts.append((rr * ca, rr * sa, r * math.sin(b)))
    for j in range(seg):
        for k in range(ring):
            k2 = (k + 1) % ring
            faces.append((j * ring + k, j * ring + k2, (j + 1) * ring + k2, (j + 1) * ring + k))
    vs = [Vector(v) for v in verts]
    faces = fix_winding(vs, faces)
    if rot is None:
        rot = {"y": (-90, 0, 0), "x": (0, 90, 0), "z": (0, 0, 0)}[axis]
    M = xf(c, rot)
    return p.raw(mat, verts, faces, M, sg=p._new_sg(), tint=tint)


def tyre(p, c, R=0.34, r=0.13, axis="y", rot=None, seg=8):
    return torus(p, "rubber", c, R, r, axis, seg=seg, ring=4, rot=rot)


def tyre_stack(p, x, z, n=3, y0=0.0, R=0.34, r=0.13, jit=0.05, seed=1):
    rr = random.Random(seed)
    for i in range(n):
        tyre(p, (x + rr.uniform(-jit, jit), y0 + r + i * 2 * r * 0.95, z + rr.uniform(-jit, jit)), R, r, "y")


def barrel(p, x, z, y0=0.0, r=0.29, h=0.88, mat="metal_dark", sides=8, lid_mat=None, tilt=None):
    if tilt:
        c = (x, y0 + r, z)
        p.cyl(mat, c, r, h, "z", sides=sides)
        return
    p.cyl(mat, (x, y0 + h / 2, z), r, h, "y", sides=sides)
    for t in (0.18, 0.82):
        p.cyl(mat, (x, y0 + h * t, z), r * 1.035, 0.045, "y", sides=sides)
    if lid_mat:
        p.cyl(lid_mat, (x, y0 + h + 0.01, z), r * 0.95, 0.03, "y", sides=sides)


def crate(p, x, z, y0=0.0, s=0.7, mat="wood", rot=0.0, h=None, tint=None):
    h = h or s
    p.box(mat, (x, y0 + h / 2, z), (s, h, s), rot=(0, rot, 0), tint=tint)
    # slats
    for dy in (-h * 0.3, 0, h * 0.3):
        p.box(mat, (x, y0 + h / 2 + dy, z), (s * 1.02, h * 0.08, s * 1.02), rot=(0, rot, 0), tint=(0.7, 0.7, 0.7))


def ac_unit(p, x, y, z, w=1.2, d=1.0, h=0.7, rot=0.0):
    p.box("metal_bare", (x, y + h / 2, z), (w, h, d), rot=(0, rot, 0))
    p.cyl("metal_dark", (x, y + h + 0.01, z), min(w, d) * 0.36, 0.05, "y", sides=10)


def corr_sheet(p, mat, p0, p1, height, pitch=0.22, depth=0.045, thick=0.02, tilt=None):
    """Not used for big panels (see corr_wall_*); a single corrugated sheet in a vertical plane between p0-p1 (xz), y up."""
    pass


def orient_cw(pts):
    """Return pts ordered clockwise in (u, v) plane (u right, v up)."""
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return list(reversed(pts)) if a > 0 else list(pts)


def orient_ccw(pts):
    return list(reversed(orient_cw(pts)))


def zigzag(t0, t1, pitch, depth, thick, shape="trap"):
    """Outline polygon of a corrugated strip along t in [t0,t1]: (t, off) closed polygon (off up to depth; back face at -thick).
    shape 'trap' = trapezoid ribs (4 pts/pitch), 'tri' = sawtooth (2 pts/pitch, cheaper)."""
    n = max(1, int(round((t1 - t0) / pitch)))
    step = (t1 - t0) / n
    top = []
    for i in range(n):
        ta = t0 + i * step
        if shape == "tri":
            top += [(ta, 0.0), (ta + step * 0.5, depth)]
        else:
            top += [(ta, 0.0), (ta + step * 0.25, depth), (ta + step * 0.5, depth), (ta + step * 0.75, 0.0)]
    top.append((t1, 0.0))
    poly = [(t, o) for t, o in top] + [(t1, -thick), (t0, -thick)]
    return poly


def corr_wall_x(p, mat, x, sgn, y0, y1, z0, z1, pitch=0.24, depth=0.05, thick=0.02, tint=None, shape="trap"):
    """Corrugated wall in the plane x=const (vertical ribs), bulging toward sgn*x. Open top/bottom."""
    poly = zigzag(z0, z1, pitch, depth, thick, shape)
    pts = [(x + sgn * o, t) for t, o in poly]          # (x, z)
    pts = orient_cw(pts)
    return p.extrude_y(mat, pts, y0, y1, caps=False, tint=tint)


def corr_wall_z(p, mat, z, sgn, y0, y1, x0, x1, pitch=0.24, depth=0.05, thick=0.02, tint=None, shape="trap"):
    """Corrugated wall in the plane z=const, bulging toward sgn*z."""
    poly = zigzag(x0, x1, pitch, depth, thick, shape)
    pts = [(t, z + sgn * o) for t, o in poly]          # (x, z)
    pts = orient_cw(pts)
    return p.extrude_y(mat, pts, y0, y1, caps=False, tint=tint)


def corr_roof(p, mat, x0, x1, z0, z1, y, pitch=0.24, depth=0.05, thick=0.03, tint=None):
    """Corrugated flat sheet (ribs along z): profile in (x,y) extruded along z. top surface at y."""
    poly = zigzag(x0, x1, pitch, depth, thick)
    pts = [(t, y + o) for t, o in poly]
    pts = orient_ccw(pts)
    return p.extrude(mat, pts, z0, z1, caps=False, tint=tint)


def wall_with_openings(p, mat, axis, c, thick, u0, u1, y0, y1, openings, tint=None, sub=2.0, bevel=0.0):
    """Solid wall (box pieces around openings). axis 'z': wall plane z=c spanning x in [u0,u1]; axis 'x': plane x=c spanning z.
    openings = [(ua, ub, ya, yb), ...] sorted by u. Wall thickness `thick` centred on c."""
    cur = u0
    def piece(a, b, ya, yb):
        if b - a < 1e-3 or yb - ya < 1e-3:
            return
        if axis == "z":
            p.bx(mat, (a, b), (ya, yb), (c - thick / 2, c + thick / 2), tint=tint, sub=sub, bevel=bevel)
        else:
            p.bx(mat, (c - thick / 2, c + thick / 2), (ya, yb), (a, b), tint=tint, sub=sub, bevel=bevel)
    for (ua, ub, ya, yb) in sorted(openings):
        piece(cur, ua, y0, y1)
        piece(ua, ub, y0, ya)
        piece(ua, ub, yb, y1)
        cur = ub
    piece(cur, u1, y0, y1)


def slat_glass(p, x0, x1, y0, y1, z, n=1, mull=0.05, mat_frame="metal_dark", broken=(), axis="z", depth=0.06, glass_z_off=0.0):
    """Glass pane(s) with a frame + mullions in an opening on plane z (axis 'z') or x (axis 'x'). broken = indices with no glass."""
    w = x1 - x0
    for i in range(n + 1):
        u = x0 + w * i / n
        if axis == "z":
            p.bx(mat_frame, (u - mull, u + mull), (y0, y1), (z - depth / 2, z + depth / 2))
        else:
            p.bx(mat_frame, (z - depth / 2, z + depth / 2), (y0, y1), (u - mull, u + mull))
    for yy in (y0, y1):
        if axis == "z":
            p.bx(mat_frame, (x0 - mull, x1 + mull), (yy - mull, yy + mull), (z - depth / 2, z + depth / 2))
        else:
            p.bx(mat_frame, (z - depth / 2, z + depth / 2), (yy - mull, yy + mull), (x0 - mull, x1 + mull))
    for i in range(n):
        if i in broken:
            continue
        a, b = x0 + w * i / n + mull, x0 + w * (i + 1) / n - mull
        if axis == "z":
            p.quad("glass", (a, y0 + mull, z + glass_z_off), (b, y0 + mull, z + glass_z_off), (b, y1 - mull, z + glass_z_off), (a, y1 - mull, z + glass_z_off))
        else:
            p.quad("glass", (z + glass_z_off, y0 + mull, b), (z + glass_z_off, y0 + mull, a), (z + glass_z_off, y1 - mull, a), (z + glass_z_off, y1 - mull, b))


def xform_block(p, M, fn):
    """Run fn() and transform (M, 4x4 game-space matrix) every vertex it added to p (all accumulators)."""
    before = {k: len(a.v) for k, a in p.accs.items()}
    nc = len(p.cols)
    fn()
    for k, a in p.accs.items():
        for i in range(before.get(k, 0), len(a.v)):
            a.v[i] = M @ a.v[i]
    for j in range(nc, len(p.cols)):
        vs, fs = p.cols[j]
        p.cols[j] = ([M @ v for v in vs], fs)


def striped(p, mat, plane, a0, a1, y0, y1, c, n, vertical=True, tints=((1.0, 1.0, 1.0), (0.78, 0.78, 0.78)), off=0.0):
    """Flat panel on plane z=c (plane 'z', spanning x a0..a1) or x=c (plane 'x', spanning z) made of n alternating-tint quads
    (cheap corrugation / slat look through vertex colours)."""
    for i in range(n):
        if vertical:
            u0, u1 = a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n
            v0, v1 = y0, y1
        else:
            u0, u1 = a0, a1
            v0, v1 = y0 + (y1 - y0) * i / n, y0 + (y1 - y0) * (i + 1) / n
        t = tints[i % 2]
        if plane == "z":
            p.quad(mat, (u0, v0, c), (u1, v0, c), (u1, v1, c), (u0, v1, c), tint=t)
        else:
            p.quad(mat, (c, v0, u1), (c, v0, u0), (c, v1, u0), (c, v1, u1), tint=t)


def blob_pad(p, mat, cx, cz, rx, rz, y0=-0.05, y1=0.05, n=18, seed=1, jit=0.12):
    """Irregular, soft-edged ground pad (ellipse with radial jitter) so scatter-placed sites do not sit on a hard rectangle."""
    rr = random.Random(seed)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1.0 + rr.uniform(-jit, jit)
        pts.append((cx + rx * k * math.cos(a), cz + rz * k * math.sin(a)))
    return p.extrude_y(mat, pts, y0, y1, flat=True)
