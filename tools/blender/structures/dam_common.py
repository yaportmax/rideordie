"""Shared helpers for the DAM set (raider fortification bits, cloth, tyres, skulls...). Own module; does not touch slib."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *


def add_tinted(p, mat, verts, faces, tints, node=None, sg=0):
    """Append raw geometry with a per-face tint list (no weld)."""
    a = p.acc(mat, node)
    base = len(a.v)
    a.v.extend(Vector(v) for v in verts)
    for f, t in zip(faces, tints):
        a.f.append(tuple(i + base for i in f))
        a.sg.append(sg)
        a.tint.append(t)
    return a


def ellipsoid(p, mat, c, r, seg=8, rings=5, M=None, tint=None, flat=False, node=None):
    """Ellipsoid with radii r=(rx,ry,rz), centre c (local if M given: M is applied to the whole thing)."""
    verts = [(0, r[1], 0)]
    for i in range(1, rings):
        lat = math.pi * i / rings
        rr = math.sin(lat)
        for k in range(seg):
            a = 2 * math.pi * k / seg
            verts.append((r[0] * rr * math.cos(a), r[1] * math.cos(lat), r[2] * rr * math.sin(a)))
    verts.append((0, -r[1], 0))
    faces = []
    for k in range(seg):
        faces.append((0, 1 + k, 1 + (k + 1) % seg))
    for i in range(rings - 2):
        for k in range(seg):
            k2 = (k + 1) % seg
            a, b = 1 + i * seg + k, 1 + i * seg + k2
            faces.append((a, a + seg, b + seg, b))
    last = len(verts) - 1
    base = 1 + (rings - 2) * seg
    for k in range(seg):
        faces.append((last, base + (k + 1) % seg, base + k))
    M0 = Matrix.Translation(c) if M is None else M @ Matrix.Translation(c)
    return p.raw(mat, verts, faces, M0, None if node is None else node, sg=-1 if flat else 0, tint=tint, autofix=True)


def skull(p, c, s=1.0, yaw=0.0, pitch=0.0, detail=1, tint=None):
    """Bone skull, width ~ s metres, face toward local +Z (rotated by yaw/pitch degrees). detail 0 (~60 tris) .. 2 (~330 tris)."""
    if tint is None:
        tint = (0.66, 0.58, 0.42)
    M = xf(c, (pitch, yaw, 0), (s, s, s))
    T = lambda lc: M @ Matrix.Translation(lc)
    ellipsoid(p, "bone", (0, 0.14, -0.03), (0.5, 0.47, 0.5), seg=8 if detail else 6, rings=5 if detail else 3, M=M, tint=tint)
    if detail:
        p.box("bone", (0, 0, 0), (0.64, 0.1, 0.24), M=T((0, 0.1, 0.36)), tint=tint)
        for sx in (-1, 1):
            p.box("bone", (0, 0, 0), (0.14, 0.13, 0.22), M=T((sx * 0.3, -0.13, 0.3)), tint=tint)
    p.box("bone", (0, 0, 0), (0.46, 0.22, 0.3), M=T((0, -0.32, 0.27)), tint=tint)
    p.box("bone", (0, 0, 0), (0.4, 0.15, 0.27), M=T((0, -0.55, 0.2)), tint=tint)
    for sx in (-1, 1):
        q = M @ Vector((sx * 0.2, 0.04, 0.41))
        rot = M.to_3x3().to_euler()
        # dark eye socket disc (protrudes slightly)
        p.tube("metal_dark", tuple(M @ Vector((sx * 0.2, 0.04, 0.32))), tuple(M @ Vector((sx * 0.2, 0.04, 0.53))), 0.125 * s, sides=8, smooth=False)
    p.tube("metal_dark", tuple(M @ Vector((0, -0.09, 0.52))), tuple(M @ Vector((0, -0.24, 0.52))), 0.05 * s, sides=3, smooth=False)
    if detail:
        p.box("metal_dark", (0, 0, 0), (0.44, 0.025, 0.3), M=T((0, -0.44, 0.27)))
        if detail > 1:
            for k in range(-2, 3):
                p.box("metal_dark", (0, 0, 0), (0.02, 0.09, 0.03), M=T((k * 0.075, -0.39, 0.425)))
                p.box("metal_dark", (0, 0, 0), (0.02, 0.07, 0.03), M=T((k * 0.075, -0.52, 0.34)))


def tyre(p, c, R=0.5, r=0.19, axis="y", seg=8, mseg=4, tint=None):
    """Torus tyre: axis = symmetry axis (x|y|z)."""
    verts, faces = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(mseg):
            b = 2 * math.pi * j / mseg
            rr = R + r * math.cos(b)
            # squash the section a little (sidewall/tread)
            verts.append((rr * math.cos(a), r * 1.15 * math.sin(b), rr * math.sin(a)))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(mseg):
            j2 = (j + 1) % mseg
            faces.append((i * mseg + j, i2 * mseg + j, i2 * mseg + j2, i * mseg + j2))
    rot = {"y": (0, 0, 0), "x": (0, 0, 90), "z": (90, 0, 0)}[axis]
    return p.raw("rubber", verts, faces, xf(c, rot), sg=1, tint=tint, autofix=True)


def tyre_stack(p, c, n, R=0.52, r=0.2, jitter=0.03, seed=0):
    rj = random.Random(seed)
    for i in range(n):
        tyre(p, (c[0] + rj.uniform(-jitter, jitter), c[1] + r * 1.15 + i * r * 2.2, c[2] + rj.uniform(-jitter, jitter)), R, r)


def cloth(p, mat, top_l, u_dir, v_down, w, h, nu=8, nv=8, amp=0.18, wl=2.6, phase=0.0, tatter=0.25, seed=1,
          tint_fn=None, out=(0, 0, 1), node=None):
    """Hanging cloth strip: origin top_l (top-left), across = u_dir, hanging down = v_down (unit vectors); wavy along `out`;
    bottom edge ragged by `tatter` (fraction of h)."""
    rj = random.Random(seed)
    u = Vector(u_dir).normalized()
    v = Vector(v_down).normalized()
    o = Vector(out).normalized()
    cut = [1.0 - tatter * rj.random() ** 1.6 for _ in range(nu + 1)]
    verts, faces, tints = [], [], []
    for j in range(nv + 1):
        for i in range(nu + 1):
            t = j / nv
            s = i / nu
            dy = t * h * cut[i]
            wave = amp * math.sin(s * w / wl * 2 * math.pi + phase + t * 1.3) * (0.25 + 0.75 * t)
            verts.append(tuple(Vector(top_l) + u * (s * w) + v * dy + o * wave))
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            faces.append((a, a + 1, a + nu + 2, a + nu + 1))
            tints.append(tint_fn((i + 0.5) / nu, (j + 0.5) / nv) if tint_fn else None)
    return add_tinted(p, mat, verts, faces, tints, node)


def spike(p, base, tip, r=0.05, mat="spike", sides=5, tint=None):
    return p.tube(mat, base, tip, r, sides=sides, r2=0.0, caps=True, smooth=False, tint=tint)


def plate(p, mat, c, size, rot=(0, 0, 0), tint=None, rivets=0, bevel=0.0):
    p.box(mat, c, size, rot=rot, tint=tint, bevel=bevel)
    if rivets:
        M = xf(c, rot)
        for i in range(rivets):
            sx = (i % 2) * 2 - 1
            lc = ((size[0] / 2 - 0.08) * sx, (size[1] / 2 - 0.08) * (1 if (i // 2) % 2 == 0 else -1), size[2] / 2 + 0.008)
            q = M @ Vector(lc)
            p.cyl("metal_bare", tuple(q), 0.03, 0.02, "z", sides=5)


def hazard_band(p, mat, p0, p1, width, height=0.0, size=0.6, up=(0, 1, 0), thick=0.02, seed=3):
    """Yellow/black hazard stripes along a line p0->p1 on a thin box (alternating vertex-colour blocks)."""
    rj = random.Random(seed)
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    n = max(1, int(round(L / size)))
    d = (p1 - p0) / n
    for i in range(n):
        a = p0 + d * i
        b = p0 + d * (i + 1)
        if i % 2 == 0:
            k = rj.uniform(0.6, 1.0)
            t = (0.95 * k, 0.5 * k, 0.02 * k)
        else:
            k = rj.uniform(0.6, 1.3)
            t = (0.035 * k, 0.035 * k, 0.04 * k)
        p.beam("hazard", a, b, width, thick, up=up, tint=t)


def yellow(rj):
    k = rj.uniform(0.6, 1.0)
    return (0.95 * k, 0.5 * k, 0.02 * k)


def black(rj):
    k = rj.uniform(0.6, 1.3)
    return (0.035 * k, 0.035 * k, 0.04 * k)


def flame(p, c, h=0.9, r=0.28, sides=6):
    """Stylised flame (emissive cone stack) - light_amber."""
    x, y, z = c
    p.tube("light_amber", (x, y, z), (x, y + h, z), r, sides=sides, r2=0.02, smooth=False)
    p.tube("light_amber", (x + r * 0.5, y, z + r * 0.3), (x + r * 0.7, y + h * 0.65, z + r * 0.3), r * 0.5, sides=5, r2=0.01, smooth=False)
    p.tube("light_amber", (x - r * 0.5, y, z - r * 0.3), (x - r * 0.4, y + h * 0.75, z - r * 0.2), r * 0.45, sides=5, r2=0.01, smooth=False)


def brazier(p, c, r=0.5, h=0.9, legs=True):
    x, y, z = c
    p.tube("rust", (x, y + 0.3, z), (x, y + h, z), r * 0.6, sides=8, r2=r)
    p.cyl("metal_dark", (x, y + h + 0.03, z), r * 1.02, 0.06, "y", sides=8)
    if legs:
        for k in range(3):
            a = k * 2 * math.pi / 3 + 0.4
            p.tube("metal_dark", (x, y + 0.45, z), (x + math.cos(a) * r * 0.9, y, z + math.sin(a) * r * 0.9), 0.04, sides=4, smooth=False)
    flame(p, (x, y + h, z), h=h * 1.1, r=r * 0.6)
