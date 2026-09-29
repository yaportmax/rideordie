"""Helpers for the industrial / tower structures (fork B2). Game coordinates, see slib."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *


def ring(cx, cz, y, r, n, rev=True, ph=0.0):
    """Ring of n points around (cx, cz) at height y. rev=True gives OUTWARD normals for a loft going up."""
    pts = []
    for k in range(n):
        a = ph + 2 * math.pi * k / n
        if rev:
            a = -a
        pts.append((cx + r * math.cos(a), y, cz + r * math.sin(a)))
    return pts


def revolve(p, mat, cx, cz, prof, n, sub=0, cap_bottom=False, cap_top=False, inward=False, ph=0.0, flat=False, node=None, tint=None):
    """Surface of revolution. prof = [(r, y), ...] traversed so that the outward normal is on the left when going
    bottom-centre -> outward -> up -> inward-top (outward normals). inward=True flips the orientation."""
    rings = [ring(cx, cz, y, r, n, rev=not inward, ph=ph) for r, y in prof]
    return p.loft(mat, rings, closed=True, cap_a=cap_bottom, cap_b=cap_top, sub=sub, flat=flat, node=node, tint=tint)


def shell_skip(p, mat, cx, cz, prof, n, skip=None, inward=False, ph=0.0, tint=None, node=None, sub=0):
    """Like revolve but faces (i, j) for which skip(i, j) is true are omitted (holes / broken edges)."""
    rings = [ring(cx, cz, y, r, n, rev=not inward, ph=ph) for r, y in prof]
    verts, faces = [], []
    for r in rings:
        verts.extend(r)
    for i in range(len(rings) - 1):
        for j in range(n):
            if skip and skip(i, j):
                continue
            j2 = (j + 1) % n
            faces.append((i * n + j, i * n + j2, (i + 1) * n + j2, (i + 1) * n + j))
    return p.raw(mat, verts, faces, None, node, tint=tint, sub=sub, weld=True)


def polar(cx, cz, r, a_deg):
    a = a_deg * D2R
    return (cx + r * math.cos(a), cz + r * math.sin(a))


def ladder(p, p0, p1, width=0.5, rung=0.36, rail_r=0.025, rung_r=0.016, mat="metal_dark", side=(1, 0, 0), standoff=None):
    """Vertical/inclined ladder between p0 (bottom) and p1 (top); `side` = horizontal direction across the ladder."""
    p0, p1 = Vector(p0), Vector(p1)
    s = Vector(side).normalized() * (width / 2)
    p.tube(mat, p0 + s, p1 + s, rail_r, sides=4, smooth=False, caps=False)
    p.tube(mat, p0 - s, p1 - s, rail_r, sides=4, smooth=False, caps=False)
    L = (p1 - p0).length
    n = max(1, int(L / rung))
    for k in range(1, n + 1):
        c = p0.lerp(p1, k / (n + 0.5))
        p.tube(mat, c - s, c + s, rung_r, sides=4, smooth=False, caps=False)


def railing(p, pts, h=1.1, post_r=0.03, rail_r=0.025, mat="metal_dark", closed=False, post_every=1.6, rails=2, skip=None):
    """Handrail along a polyline (points at floor level)."""
    pts = [Vector(q) for q in pts]
    m = len(pts)
    segs = m if closed else m - 1
    idx = 0
    for i in range(segs):
        a, b = pts[i], pts[(i + 1) % m]
        L = (b - a).length
        n = max(1, int(round(L / post_every)))
        for k in range(n):
            if skip and skip(idx):
                idx += 1
                continue
            q0 = a.lerp(b, k / n)
            q1 = a.lerp(b, (k + 1) / n)
            p.tube(mat, q0, q0 + Vector((0, h, 0)), post_r, sides=4, smooth=False, caps=False)
            for r_ in range(rails):
                yy = h * (r_ + 1) / rails
                p.tube(mat, q0 + Vector((0, yy, 0)), q1 + Vector((0, yy, 0)), rail_r, sides=4, smooth=False, caps=False)
            idx += 1
    if not closed:
        q = pts[-1]
        p.tube(mat, q, q + Vector((0, h, 0)), post_r, sides=4, smooth=False, caps=False)


def pipe(p, pts, r=0.2, mat="metal_dark", sides=8, collars=True):
    """Pipe run through points with a collar at each joint."""
    pts = [Vector(q) for q in pts]
    for a, b in zip(pts[:-1], pts[1:]):
        p.tube(mat, a, b, r, sides=sides)
    if collars:
        for q in pts[1:-1]:
            p.box(mat, tuple(q), (r * 2.5, r * 2.5, r * 2.5))


def lattice_sheared(p, mat, y0, h, hw0, hw1, panels, shear=None, leg=0.12, brace=0.05, sides=4, missing=None,
                    hang=None, horiz=True, x_brace=True, cx=0.0, cz=0.0):
    """Lattice tower with per-level lateral offset shear(y) -> (dx, dz), members skipped when missing(panel, face, kind)
    is true and drooping when hang(panel, face, kind) is true. Returns level info [(y, hw, dx, dz)]."""
    levels = [y0 + h * i / panels for i in range(panels + 1)]
    hwf = lambda y: hw0 + (hw1 - hw0) * (y - y0) / h
    sh = shear or (lambda y: (0.0, 0.0))
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]

    def pt(c, y):
        dx, dz = sh(y)
        return (cx + dx + c[0] * hwf(y), y, cz + dz + c[1] * hwf(y))
    for c in corners:
        for i in range(panels):
            p.tube(mat, pt(c, levels[i]), pt(c, levels[i + 1]), leg, sides=max(4, sides + 2), smooth=False)
    for i in range(panels):
        ya, yb = levels[i], levels[i + 1]
        for k in range(4):
            c0, c1 = corners[k], corners[(k + 1) % 4]
            a0, a1, b0, b1 = pt(c0, ya), pt(c1, ya), pt(c0, yb), pt(c1, yb)
            members = []
            if x_brace:
                members += [("d1", a0, b1), ("d2", a1, b0)]
            if horiz:
                members.append(("h", a0, a1))
            for kind, q0, q1 in members:
                if missing and missing(i, k, kind):
                    continue
                if hang and hang(i, k, kind):
                    q1 = tuple(Vector(q0).lerp(Vector(q1), 0.55) + Vector((0, -0.9, 0)))
                p.tube(mat, q0, q1, brace, sides=sides, smooth=False, caps=False)
    if horiz:
        yb = levels[-1]
        for k in range(4):
            c0, c1 = corners[k], corners[(k + 1) % 4]
            p.tube(mat, pt(c0, yb), pt(c1, yb), brace, sides=sides, smooth=False, caps=False)
    return [(y, hwf(y), *sh(y)) for y in levels]


def lattice_beam(p, mat, a, b, w, h, panels, chord=0.14, brace=0.06, sides=4, up=(0, 1, 0)):
    """Box lattice girder from a to b: 4 chords + zigzag (both side faces, top, bottom). w = width (local x), h = depth (local y)."""
    a, b = Vector(a), Vector(b)
    d = (b - a)
    rm = look(d, up)
    ex, ey = rm @ Vector((1, 0, 0)), rm @ Vector((0, 1, 0))
    cs = [(sx, sy) for sx in (-1, 1) for sy in (-1, 1)]
    off = lambda sx, sy: ex * (sx * w / 2) + ey * (sy * h / 2)
    for sx, sy in cs:
        p.tube(mat, a + off(sx, sy), b + off(sx, sy), chord, sides=sides, smooth=False, caps=False)
    for i in range(panels + 1):
        t = i / panels
        c = a.lerp(b, t)
        ring_ = [c + off(-1, -1), c + off(1, -1), c + off(1, 1), c + off(-1, 1)]
        for q in range(4):
            p.tube(mat, ring_[q], ring_[(q + 1) % 4], brace, sides=sides, smooth=False, caps=False)
    for i in range(panels):
        c0, c1 = a.lerp(b, i / panels), a.lerp(b, (i + 1) / panels)
        for (s0, s1) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            if i % 2 == 0:
                p.tube(mat, c0 + off(*s0), c1 + off(*s1), brace, sides=sides, smooth=False, caps=False)
            else:
                p.tube(mat, c0 + off(*s1), c1 + off(*s0), brace, sides=sides, smooth=False, caps=False)


def dish(p, c, direction, R=1.2, depth=0.4, mat="paint", back="metal_bare", n=14, rings=4, up=(0, 1, 0), tint=None):
    """Parabolic dish centred at c opening toward `direction`. Front shell in `mat`, back shell in `back`."""
    rm = look(direction, up).to_4x4()
    M = Matrix.Translation(c) @ rm
    prof = []
    for k in range(rings + 1):
        t = k / rings
        r = R * t
        prof.append((r, depth * t * t))
    # shells built in local frame (axis +Z), then transformed
    def build(mat_, flip, dz):
        rs = []
        for r, z in prof:
            pts = []
            for j in range(n):
                a = 2 * math.pi * j / n
                if flip:
                    a = -a
                pts.append((r * math.cos(a), r * math.sin(a), z + dz))
            rs.append(pts)
        p.loft(mat_, rs, closed=True, cap_a=False, cap_b=False, M=M, tint=tint)
    build(mat, False, 0.0)
    build(back, True, -0.03)
    # feed horn + arm
    p.tube("metal_dark", (0, 0, 0), (0, 0, depth * 1.9), 0.03, sides=4, smooth=False, caps=False) if False else None
    p.tube("metal_dark", M @ Vector((0, 0, -0.02)), M @ Vector((0, 0, depth + 0.55)), 0.03, sides=4, smooth=False, caps=False)
    p.box("metal_dark", tuple(M @ Vector((0, 0, depth + 0.55))), (0.12, 0.12, 0.16), M=Matrix.Translation(M @ Vector((0, 0, depth + 0.55))) @ rm)
