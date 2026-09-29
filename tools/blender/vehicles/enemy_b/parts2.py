"""Second-generation detail parts for the enemy_b raiders (van / heavy / tanker).  Game space (+X left, +Y up, +Z forward).
The legacy parts.py is left untouched (the boss still builds from it)."""
import math
import random
from mathutils import Vector, Matrix
from vlib import *  # noqa
from parts import headlight, light_rect, spotlight, exhaust_stack, skull, add_proxies, railing, barrel  # noqa  (re-export)

PI = math.pi


def _frame(n, up=(0, 1, 0)):
    """unit vectors (u, v, n) for a plane facing n; v ~ up."""
    nn = V3(n).normalized()
    R = basis_from(nn, up)
    return (R @ Vector((1, 0, 0))), (R @ Vector((0, 1, 0))), nn


# ================================================================================================ wheels
def wheel2(m, meshname, R, W, side, rim_ratio=0.6, lugs=16, tread_h=0.035, style='mt', holes=6, nuts=6, beadlock=True, drum=True,
           seg=32, rim_mat='rim'):
    """Tyre + steel wheel as a hidden shared mesh centred on 0,0,0, axle = X, rim face toward +X*side.
    style 'mt': mud-terrain (staggered chevron lug blocks), 'hwy': ribbed highway tread (grooves only).
    Materials: rubber_tire (tyre), rim (wheel), metal_dark (brake drum)."""
    prev = m.cur
    m.obj(meshname, origin=(0, 0, 0), hidden=True).alias = {rim_mat: rim_mat, 'rubber_tire': 'rubber_tire', 'metal_dark': rim_mat}
    m.use(meshname)
    s = side
    hw = W / 2
    Rr = R * rim_ratio
    Rb = R - tread_h                      # tread base radius
    sw = Rb - Rr
    # ---- tyre carcass (revolve): bead -> sidewall bulge -> shoulder -> tread base -> other side
    if style == 'mt':
        prof = [(Rr + 0.01, 0.80 * hw), (Rr + 0.3 * sw, 1.0 * hw), (Rr + 0.72 * sw, 1.02 * hw), (Rb - 0.004, 0.93 * hw),
                (Rb, 0.7 * hw), (Rb, -0.7 * hw),
                (Rb - 0.004, -0.93 * hw), (Rr + 0.72 * sw, -1.02 * hw), (Rr + 0.3 * sw, -1.0 * hw), (Rr + 0.01, -0.80 * hw)]
        m.revolve('rubber_tire', prof, axis='x', seg=seg, closed=False)
        # ---- lug blocks: two staggered rows of chevron blocks + shoulder lugs reaching down the sidewall
        pitch = 2 * PI / lugs
        for i in range(lugs):
            for row in (1, -1):
                a = (i + (0.5 if row < 0 else 0.0)) * pitch
                ca, sa = math.cos(a), math.sin(a)
                rc = Rb + tread_h / 2 - 0.006
                L = 2 * PI * Rb / lugs * 0.7
                # staggered block reaching from the centre groove over the shoulder, slight chevron twist
                with m.xf((row * hw * 0.5, rc * sa, rc * ca), (90 - a / D2R, 0, 0)):
                    with m.xf((0, 0, 0), (0, 12 * row, 0)):
                        m.box('rubber_tire', (hw * 0.84, tread_h + 0.008, L), at=(0, 0, 0), bevel=0, seg=1)
                    if i % 2 == 0:                   # sidewall shoulder block on every other lug
                        m.box('rubber_tire', (hw * 0.12, tread_h * 1.7, L * 0.6), at=(row * hw * 0.46, -tread_h * 0.75, 0), bevel=0, seg=1)
    else:
        # highway rib tyre: three circumferential grooves in the profile
        g = tread_h
        prof = [(Rr + 0.01, 0.80 * hw), (Rr + 0.18 * sw, 0.97 * hw), (Rr + 0.5 * sw, 1.03 * hw), (Rr + 0.82 * sw, 1.0 * hw), (R - 0.012, 0.95 * hw),
                (R, 0.86 * hw), (R, 0.55 * hw), (R - g, 0.52 * hw), (R - g, 0.40 * hw), (R, 0.37 * hw), (R, 0.08 * hw), (R - g, 0.06 * hw), (R - g, -0.06 * hw),
                (R, -0.08 * hw), (R, -0.37 * hw), (R - g, -0.40 * hw), (R - g, -0.52 * hw), (R, -0.55 * hw), (R, -0.86 * hw),
                (R - 0.012, -0.95 * hw), (Rr + 0.82 * sw, -1.0 * hw), (Rr + 0.5 * sw, -1.03 * hw), (Rr + 0.18 * sw, -0.97 * hw), (Rr + 0.01, -0.80 * hw)]
        m.revolve('rubber_tire', prof, axis='x', seg=seg, closed=False)
    # sidewall lettering band (raised ring) on the outer side
    m.revolve('rubber_tire', [(Rr + 0.56 * sw, 1.04 * hw * s), (Rr + 0.72 * sw, 1.04 * hw * s)], axis='x', seg=seg, closed=False)
    # ---- steel wheel
    sc = R / 0.5
    lip = [(Rr + 0.028 * sc, 0.86 * hw * s), (Rr + 0.028 * sc, 0.97 * hw * s), (Rr - 0.012 * sc, 0.99 * hw * s), (Rr - 0.02 * sc, 0.8 * hw * s),
           (Rr * 0.9, 0.62 * hw * s)]
    m.revolve(rim_mat, lip, axis='x', seg=seg, closed=False)
    xd = 0.55 * hw * s                                             # dish plane
    # dish: annulus with round holes
    ro, ri = Rr * 0.9, Rr * 0.3
    outer = [(ro * math.cos(2 * PI * k / 24), ro * math.sin(2 * PI * k / 24)) for k in range(24)]
    hl = []
    for i in range(holes):
        a = 2 * PI * (i + 0.5) / holes
        rh, rr = Rr * 0.62, Rr * 0.16
        hl.append([(rh * math.cos(a) + rr * math.cos(2 * PI * k / 8), rh * math.sin(a) + rr * math.sin(2 * PI * k / 8)) for k in range(8)][::-1])
    inner = [(ri * math.cos(2 * PI * k / 12), ri * math.sin(2 * PI * k / 12)) for k in range(12)][::-1]
    m.plate(rim_mat, outer, 0.014 * sc, at=(xd, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0, seg=1, holes=hl + [inner])
    # hub: raised boss + cap + nuts
    m.revolve(rim_mat, [(ri * 1.05, 0.0), (ri * 1.0, 0.025 * sc), (ri * 0.55, 0.045 * sc), (0.0, 0.05 * sc)],
              at=(xd, 0, 0), axis=(s, 0, 0), seg=12, closed=False)
    for i in range(nuts):
        a = 2 * PI * i / nuts
        rn = ri * 0.8
        m.hexbolt(rim_mat, (xd + 0.022 * sc * s, rn * math.sin(a), rn * math.cos(a)), (s, 0, 0), r=0.018 * sc, h=0.02 * sc, seg=6)
    if beadlock:
        m.revolve(rim_mat, [(Rr + 0.036 * sc, 0.0), (Rr + 0.036 * sc, 0.012 * sc), (Rr - 0.006 * sc, 0.012 * sc)],
                  at=(0.97 * hw * s, 0, 0), axis=(s, 0, 0), seg=seg, closed=False)
        nb = 8
        for i in range(nb):
            a = 2 * PI * (i + 0.25) / nb
            rb = Rr + 0.016 * sc
            m.rivet(rim_mat, (0.97 * hw * s + 0.012 * sc * s, rb * math.sin(a), rb * math.cos(a)), (s, 0, 0), r=0.011 * sc, seg=5)
    if drum:
        xb = xd - 0.012 * sc * s
        m.revolve('metal_dark', [(0.0, 0.0), (Rr * 0.74, -0.01 * sc), (Rr * 0.74, -0.34 * hw), (Rr * 0.3, -0.36 * hw)],
                  at=(xb, 0, 0), axis=(s, 0, 0), seg=12, closed=False)
    m.use(prev)


def wheel_set2(m, tag, R, W, positions, names, **kw):
    wheel2(m, 'wm_%s_L' % tag, R, W, +1, **kw)
    wheel2(m, 'wm_%s_R' % tag, R, W, -1, **kw)
    for nm, p in zip(names, positions):
        m.inst(nm, 'wm_%s_%s' % (tag, 'L' if p[0] > 0 else 'R'), p)


# ================================================================================================ soft goods
def sandbag(m, c, L=0.5, D=0.3, H=0.16, yaw=0.0, mat='canvas', obj=None, sag=0.02, seed=None):
    """Filled sandbag: flattened pillow with pinched, tied ends.  c = centre of the bottom face."""
    rng = m.rng
    nu, nv = 6, 7
    rings = []
    tw = rng.uniform(-0.03, 0.03)
    for i in range(nu + 1):
        t = i / nu                              # 0..1 along length
        z = (t - 0.5) * L
        pinch = math.sin(PI * t) ** 0.35       # ends pinched
        w = D * 0.5 * (0.35 + 0.65 * pinch)
        h = H * (0.25 + 0.75 * pinch)
        bend = sag * math.sin(PI * t)
        ring = []
        for k in range(nv):
            a = 2 * PI * k / nv
            x = math.cos(a) * w
            yy = math.sin(a) * h * 0.5
            yy = max(yy, -h * 0.5 + 0.004)                     # flat bottom
            yy += h * 0.5 - bend * (1 if yy > 0 else 0.3)
            x += tw * (t - 0.5) * 2 * (0.5 + 0.5 * math.sin(a))
            ring.append((x, yy, z))
        rings.append(ring)
    M = xform(c, (0, yaw, 0))
    rings = [[tuple(M @ V3(p)) for p in r] for r in rings]
    m.sweep(mat, rings, caps=True, obj=obj)
    # tied ends (little tufts)
    for e in (-1, 1):
        p = M @ Vector((tw * e, H * 0.45, e * L * 0.5))
        q = M @ Vector((tw * e * 1.5, H * 0.5, e * (L * 0.5 + 0.045)))
        m.cyl(mat, tuple(p), tuple(q), 0.022, 0.012, seg=4, obj=obj)


def sandbag_ring(m, pts, y0, rows=2, L=0.5, D=0.3, H=0.16, mat='canvas', obj=None, closed=False):
    """Courses of sandbags laid along a polyline of (x, z) points (brick bond)."""
    segs = list(zip(pts[:-1], pts[1:])) + ([(pts[-1], pts[0])] if closed else [])
    for r in range(rows):
        for (a, b) in segs:
            ax, az = a; bx, bz = b
            dx, dz = bx - ax, bz - az
            Ls = math.hypot(dx, dz)
            n = max(int(round(Ls / (L * 0.92))), 1)
            yaw = math.degrees(math.atan2(dx, dz))
            off = 0.5 if r % 2 else 0.0
            for i in range(n):
                t = (i + 0.5 + off * (0.5 if n > 1 else 0)) / n
                t = min(t, 1 - 0.3 / n)
                cx, cz = ax + dx * t, az + dz * t
                m_ = m.rng
                sandbag(m, (cx + m_.uniform(-0.015, 0.015), y0 + r * H * 0.82, cz + m_.uniform(-0.015, 0.015)), L=L * m_.uniform(0.9, 1.05),
                        D=D * m_.uniform(0.92, 1.06), H=H * m_.uniform(0.9, 1.1), yaw=yaw + m_.uniform(-7, 7), mat=mat, obj=obj)


def tarp_roll(m, a, b, r=0.1, mat='canvas', strap='metal_dark', obj=None, seg=10):
    A, B = V3(a), V3(b)
    d = (B - A)
    L = d.length
    dn = d / L
    m.cyl(mat, tuple(A), tuple(B), r, seg=seg, obj=obj)
    for t in (0.2, 0.8):
        c = A + d * t
        m.cyl(strap, tuple(c - dn * 0.02), tuple(c + dn * 0.02), r * 1.06, seg=seg, obj=obj)
    for e, sgn in ((A, -1), (B, 1)):                     # frayed rolled ends
        m.cyl(mat, tuple(e), tuple(e + dn * 0.015 * sgn), r * 0.8, seg=seg, obj=obj)


# ================================================================================================ hardware / junk
def jerrycan2(m, at, yaw=0.0, mat='paint2', obj=None, lie=False):
    """NATO jerrycan 0.345 x 0.165 x 0.47 (standing) with X-stamping, triple handle, spout."""
    rot = (0, yaw, 90) if lie else (0, yaw, 0)
    with m.xf(at, rot):
        m.box(mat, (0.165, 0.43, 0.345), at=(0, 0, 0), bevel=0.02, seg=1, obj=obj)
        for sx in (1, -1):                               # X embossing
            for sgn in (1, -1):
                m.beam(mat, (sx * 0.084, -0.17, -0.13 * sgn), (sx * 0.084, 0.13, 0.12 * sgn), 0.03, 0.008, up=(sx, 0, 0), bevel=0, seg=1, obj=obj)
        m.box(mat, (0.17, 0.02, 0.35), at=(0, -0.01, 0), bevel=0, seg=1, obj=obj)     # weld seam
        for z in (-0.1, 0.0, 0.1):                       # handles
            m.beam('metal_dark', (0, 0.215, z - 0.03), (0, 0.26, z), 0.02, 0.012, bevel=0, obj=obj)
        m.beam('metal_dark', (0, 0.26, -0.13), (0, 0.26, 0.13), 0.025, 0.014, bevel=0, obj=obj)
        m.cyl('metal_dark', (0, 0.215, 0.12), (0, 0.255, 0.155), 0.028, seg=8, obj=obj)
        m.box('metal_dark', (0.03, 0.03, 0.05), at=(0, 0.26, 0.17), bevel=0.004, seg=1, obj=obj)


def ammo_can(m, at, yaw=0.0, mat='paint2', obj=None, size=(0.16, 0.19, 0.3)):
    w, h, l = size
    with m.xf(at, (0, yaw, 0)):
        m.box(mat, (w, h, l), at=(0, h / 2, 0), bevel=0.008, seg=1, obj=obj)
        m.box(mat, (w + 0.012, 0.035, l + 0.012), at=(0, h - 0.012, 0), bevel=0, seg=1, obj=obj)          # lid
        m.box('metal_dark', (0.012, 0.06, 0.05), at=(w / 2 + 0.006, h - 0.03, l * 0.3), bevel=0, seg=1, obj=obj)  # latch
        m.box('metal_dark', (0.014, 0.03, l * 0.45), at=(0, h + 0.02, 0), bevel=0, seg=1, obj=obj)                 # carry handle
        m.box('decal_yellow', (w + 0.002, 0.03, l * 0.5), at=(0, h * 0.45, 0), bevel=0, seg=1, obj=obj)


def crate(m, at, size=(0.6, 0.4, 0.5), yaw=0.0, obj=None, mat='wood', slats=True):
    """wooden crate: box + edge battens"""
    w, h, l = size
    with m.xf(at, (0, yaw, 0)):
        m.box(mat, (w, h, l), at=(0, h / 2, 0), bevel=0.01, seg=1, obj=obj)
        if slats:
            t = 0.022
            for sx in (1, -1):
                for sz in (1, -1):
                    m.box(mat, (0.07, h + 0.01, 0.07), at=(sx * (w / 2 - 0.03), h / 2, sz * (l / 2 - 0.03)), bevel=0, seg=1, obj=obj)
            for sz in (1, -1):
                m.box(mat, (w - 0.1, 0.06, t), at=(0, h * 0.5, sz * (l / 2 + t / 2 - 0.006)), bevel=0, seg=1, obj=obj)
            for sx in (1, -1):
                m.box(mat, (t, 0.06, l - 0.1), at=(sx * (w / 2 + t / 2 - 0.006), h * 0.5, 0), bevel=0, seg=1, obj=obj)
            m.box('metal_dark', (w + 0.012, 0.03, l + 0.012), at=(0, h * 0.82, 0), bevel=0, seg=1, obj=obj)


def tyre_flat(m, at, R=0.4, W=0.26, rim=True, obj=None, seg=20, tilt=(0, 0, 0)):
    """loose spare tyre lying flat (axis = local Y)"""
    Rr = R * 0.58
    prof = [(Rr, -W * 0.42), (Rr + 0.3 * (R - Rr), -W * 0.5), (R - 0.03, -W * 0.48), (R, -W * 0.3), (R, W * 0.3), (R - 0.03, W * 0.48),
            (Rr + 0.3 * (R - Rr), W * 0.5), (Rr, W * 0.42)]
    with m.xf(at, tilt):
        m.revolve('rubber_tire', prof, axis='y', seg=seg, closed=False, obj=obj)
        for i in range(seg):                            # tread blocks (cheap: thin boxes)
            if i % 3:
                continue
            a = 2 * PI * i / seg
            with m.xf((R * math.cos(a), 0, R * math.sin(a)), (0, -(a / D2R), 0)):
                m.box('rubber_tire', (0.02, W * 0.55, 2 * PI * R / seg * 0.8), at=(0.004, 0, 0), bevel=0, seg=1, obj=obj)
        if rim:
            m.revolve('rim', [(Rr * 1.02, W * 0.3), (Rr * 0.9, W * 0.2), (Rr * 0.3, W * 0.22), (0, W * 0.24)], axis='y', seg=seg, closed=False, obj=obj)


def spike2(m, base, tip, r, mat='spike', obj=None, seg=6, weld=True):
    """welded spike: cone + fillet weld ring at the base"""
    a, b = V3(base), V3(tip)
    d = (b - a).normalized()
    m.cyl(mat, tuple(a - d * 0.01), tuple(b), r, 0.0015, seg=seg, obj=obj)
    if weld:
        m.cyl(mat, tuple(a - d * 0.01), tuple(a + d * 0.012), r * 1.3, r * 1.05, seg=seg, obj=obj)


def chain(m, pts, link=0.055, wire=0.008, mat='metal_dark', obj=None, sag=0.0):
    """chain of alternating links along a polyline (optionally sagging)"""
    P = [V3(p) for p in pts]
    path = []
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        L = (b - a).length
        k = max(int(L / (link * 0.85)), 1)
        for j in range(k):
            t = j / k
            q = a + (b - a) * t
            q.y -= sag * math.sin(PI * t) if len(P) == 2 else 0.0
            path.append(q)
    path.append(P[-1])
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        c = (a + b) * 0.5
        d = (b - a).normalized()
        up = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
        side = d.cross(up).normalized()
        if i % 2:
            side = d.cross(side).normalized()
        L = link * 0.5
        wdt = link * 0.3
        ring = [c + d * L, c + side * wdt, c - d * L, c - side * wdt]
        m.tube(mat, ring + [ring[0]], wire, seg=3, obj=obj, caps=False)


def mesh_screen(m, c, u, v, w, h, pitch=0.06, r=0.005, mat='metal_dark', frame=0.02, obj=None, frame_mat=None):
    """welded wire mesh (square bars) + flat-bar frame; c = centre, u/v unit in-plane directions"""
    C, U, Vv = V3(c), V3(u).normalized(), V3(v).normalized()
    n = U.cross(Vv).normalized()
    nu = max(int(w / pitch), 1)
    nv = max(int(h / pitch), 1)
    for i in range(1, nu):
        x = -w / 2 + w * i / nu
        m.beam(mat, tuple(C + U * x - Vv * h / 2 + n * r), tuple(C + U * x + Vv * h / 2 + n * r), r * 2, r * 2, up=tuple(n), bevel=0, obj=obj)
    for j in range(1, nv):
        y = -h / 2 + h * j / nv
        m.beam(mat, tuple(C + Vv * y - U * w / 2 - n * r * 0.2), tuple(C + Vv * y + U * w / 2 - n * r * 0.2), r * 2, r * 2, up=tuple(n), bevel=0, obj=obj)
    if frame:
        fm = frame_mat or mat
        for sgn in (1, -1):
            m.beam(fm, tuple(C + Vv * (sgn * h / 2) - U * (w / 2 + frame / 2)), tuple(C + Vv * (sgn * h / 2) + U * (w / 2 + frame / 2)), frame, frame * 0.5,
                   up=tuple(n), bevel=0, seg=1, obj=obj)
            m.beam(fm, tuple(C + U * (sgn * w / 2) - Vv * h / 2), tuple(C + U * (sgn * w / 2) + Vv * h / 2), frame, frame * 0.5, up=tuple(n), bevel=0, seg=1, obj=obj)


def patch_plate(m, c, n, w, h, mat='armor', t=0.012, up=(0, 1, 0), obj=None, bolts=0, bead=True, cut=0.04, rot=0.0, bolt_mat=None):
    """scrap patch plate welded (and optionally bolted) onto a surface; c on the surface, n = outward normal"""
    U, Vv, N = _frame(n, up)
    if rot:
        ca, sa = math.cos(rot * D2R), math.sin(rot * D2R)
        U, Vv = U * ca + Vv * sa, Vv * ca - U * sa
    C = V3(c) + N * (t / 2)
    hw, hh = w / 2, h / 2
    poly = [(-hw + cut, -hh), (hw, -hh), (hw, hh - cut), (hw - cut, hh), (-hw, hh), (-hw, -hh + cut)]
    m.plate(mat, poly, t, at=tuple(C), u=tuple(U), v=tuple(Vv), bevel=0.003, seg=1, obj=obj)
    if bead:
        pts = [tuple(V3(c) + U * x + Vv * y + N * 0.001) for x, y in poly + [poly[0]]]
        m.bead(mat if mat != 'paint' and mat != 'paint2' else 'armor', pts, r=0.006, obj=obj, n=tuple(N), step=0.08, seg=3)
    if bolts:
        k = 0
        for x, y in ((-hw + 0.035, -hh + 0.035), (hw - 0.035, -hh + 0.035), (hw - 0.035, hh - 0.035), (-hw + 0.035, hh - 0.035)):
            if k >= bolts:
                break
            m.hexbolt(bolt_mat or 'metal_dark', tuple(C + U * x + Vv * y + N * (t / 2)), tuple(N), r=0.012, h=0.01, seg=6, obj=obj)
            k += 1


def cage_bars(m, c, n, w, h, nb=3, r=0.008, depth=0.05, mat='metal_dark', obj=None, up=(0, 1, 0), horiz=False):
    """guard bars over a lamp / window: nb bars across + two side straps bent back to the surface"""
    U, Vv, N = _frame(n, up)
    C = V3(c)
    if horiz:
        U, Vv = Vv, U
    for i in range(nb):
        x = -w / 2 + w * (i + 0.5) / nb
        m.tube(mat, [tuple(C + U * x - Vv * h / 2), tuple(C + U * x - Vv * h / 2 + N * depth), tuple(C + U * x + Vv * h / 2 + N * depth),
                     tuple(C + U * x + Vv * h / 2)], r, seg=4, obj=obj)
    for sgn in (1, -1):
        m.beam(mat, tuple(C + Vv * (sgn * h * 0.3) - U * w / 2 + N * depth), tuple(C + Vv * (sgn * h * 0.3) + U * w / 2 + N * depth), r * 2.2, r * 1.2,
               up=tuple(N), bevel=0, obj=obj)


def tape_x(m, c, n, w, h, mat='decal_white', obj=None, up=(0, 1, 0)):
    """duct tape X over a lens (blackout tape)"""
    U, Vv, N = _frame(n, up)
    C = V3(c) + N * 0.002
    for sgn in (1, -1):
        a = C + U * (-w / 2) + Vv * (-h / 2 * sgn)
        b = C + U * (w / 2) + Vv * (h / 2 * sgn)
        m.beam(mat, tuple(a), tuple(b), 0.03, 0.003, up=tuple(N), bevel=0, obj=obj)


def lamp_bucket(m, at, r, n=(0, 0, 1), obj='body', housing='armor', square=True, depth=0.16, cage=3, tape=False, up=(0, 1, 0)):
    """headlight in a welded square bucket with guard bars"""
    U, Vv, N = _frame(n, up)
    P = V3(at)
    s = r * 1.35
    if square:
        pts = []
        for d in (-depth, 0.015):
            for sx in (-1, 1):
                for sy in (-1, 1):
                    pts.append(tuple(P + U * (sx * s) + Vv * (sy * s) + N * d))
        m.hull(housing, pts, bevel=0.008, seg=1, obj=obj)
    headlight2(m, tuple(P + N * 0.035), r, n=tuple(N), obj=obj, seg=10)
    if cage:
        cage_bars(m, tuple(P + N * 0.02), tuple(N), s * 1.8, s * 1.9, nb=cage, r=0.007 * (r / 0.1), depth=0.05, obj=obj, up=up)
    if tape:
        tape_x(m, tuple(P + N * 0.075), tuple(N), r * 1.5, r * 1.5, obj=obj, up=up)


def taillight2(m, at, w, h, n=(0, 0, -1), mat='light_tail', obj='body', cage=True, up=(0, 1, 0), housing='metal_dark'):
    """rect tail lamp: deep housing, reflector cells behind a ribbed lens, bezel, guard bars"""
    U, Vv, N = _frame(n, up)
    P = V3(at)
    fr = 0.02

    def box(hw_, hh_, d0, d1, mat_):
        pts = [tuple(P + U * (sx * hw_) + Vv * (sy * hh_) + N * d) for d in (d0, d1) for sx in (-1, 1) for sy in (-1, 1)]
        m.hull(mat_, pts, bevel=0.0, seg=1, obj=obj)
    box(w / 2 + fr, h / 2 + fr, -0.08, 0.0, housing)
    box(w / 2 + fr, h / 2 + fr, 0.0, 0.012, 'chrome')                     # bezel ring (face)
    box(w / 2, h / 2, -0.01, 0.016, mat)                                   # lens
    nr = max(int(h / 0.07), 2)
    for i in range(nr):                                                     # lens ribs
        y = -h / 2 + h * (i + 0.5) / nr
        pts = [tuple(P + U * (sx * w / 2) + Vv * (y + sy * 0.005) + N * d) for d in (0.016, 0.022) for sx in (-1, 1) for sy in (-1, 1)]
        m.hull(mat, pts, bevel=0, obj=obj)
    if cage:
        cage_bars(m, tuple(P + N * 0.012), tuple(N), w + 0.04, h + 0.04, nb=2, r=0.006, depth=0.045, obj=obj, up=up, horiz=True)


def firing_port(m, c, n, w=0.34, h=0.09, mat='armor', obj=None, up=(0, 1, 0), open_=0.6):
    """gun slit: thick frame around a dark slot + a hinged cover flap swung up"""
    U, Vv, N = _frame(n, up)
    C = V3(c)
    t = 0.025
    m.plate(mat, [(-w / 2 - 0.05, -h / 2 - 0.045), (w / 2 + 0.05, -h / 2 - 0.045), (w / 2 + 0.05, h / 2 + 0.045), (-w / 2 - 0.05, h / 2 + 0.045)], t,
            at=tuple(C + N * (t / 2)), u=tuple(U), v=tuple(Vv), bevel=0.004, seg=1, obj=obj, holes=[[(-w / 2, -h / 2), (-w / 2, h / 2), (w / 2, h / 2), (w / 2, -h / 2)]])
    pts = [tuple(C + U * (sx * w / 2) + Vv * (sy * h / 2) + N * d) for d in (-0.03, 0.0) for sx in (-1, 1) for sy in (-1, 1)]
    m.hull('interior', pts, bevel=0, obj=obj)
    # flap hinged on the top edge, swung outward/up by open_ * 90 deg
    ang = open_ * PI / 2
    hinge = C + Vv * (h / 2 + 0.05) + N * t
    fd = (-Vv * math.cos(ang) + N * math.sin(ang)).normalized()
    fn = fd.cross(U).normalized()
    fc = hinge + fd * (h / 2 + 0.04) + fn * 0.005
    m.obox(mat, tuple(fc), tuple(U), tuple(fd), (w + 0.1, h + 0.08, 0.012), bevel=0.003, obj=obj)
    m.cyl('metal_dark', tuple(hinge - U * (w / 2)), tuple(hinge + U * (w / 2)), 0.012, seg=6, obj=obj)


def ladder(m, x0, x1, pts, rung=0.28, r=0.016, mat='metal_dark', obj=None):
    """two rails following the polyline pts (list of (y, z)) at x0 / x1, rungs every `rung` m"""
    for x in (x0, x1):
        m.tube(mat, [(x, y, z) for y, z in pts], r, seg=6, bend=0.05, obj=obj)
    for i in range(len(pts) - 1):
        (ya, za), (yb, zb) = pts[i], pts[i + 1]
        L = math.hypot(yb - ya, zb - za)
        k = max(int(L / rung), 1)
        for j in range(k):
            t = (j + 0.5) / k
            y, z = ya + (yb - ya) * t, za + (zb - za) * t
            m.cyl(mat, (x0, y, z), (x1, y, z), r * 0.75, seg=6, obj=obj)


# ================================================================================================ interior
def bucket_seat2(m, hip, w=0.52, obj='body', cover='leather', frame='metal_dark', back_h=0.62, rake=14, torn=True):
    """bolstered bucket seat; hip = hip point"""
    x, y, z = hip
    m.box(cover, (w, 0.12, 0.5), at=(x, y - 0.1, z + 0.03), bevel=0.035, seg=1, obj=obj)
    for sx in (1, -1):                                          # cushion bolsters
        m.box(cover, (0.09, 0.16, 0.48), at=(x + sx * (w / 2 - 0.045), y - 0.07, z + 0.03), bevel=0.03, seg=1, obj=obj)
    with m.xf((x, y - 0.1, z - 0.25), (-rake, 0, 0)):
        m.box(cover, (w, back_h, 0.12), at=(0, back_h / 2 + 0.03, 0), bevel=0.035, seg=1, obj=obj)
        for sx in (1, -1):
            m.box(cover, (0.09, back_h * 0.8, 0.16), at=(sx * (w / 2 - 0.04), back_h * 0.45, 0.03), bevel=0.03, seg=1, obj=obj)
        m.box(cover, (w * 0.55, 0.2, 0.1), at=(0, back_h + 0.13, 0.0), bevel=0.03, seg=1, obj=obj)            # headrest

        if torn:
            m.box('canvas', (w * 0.3, 0.14, 0.02), at=(w * 0.1, back_h * 0.55, 0.066), rot=(0, 0, 12), bevel=0.01, seg=1, obj=obj)
    m.box(frame, (w * 0.85, 0.08, 0.42), at=(x, y - 0.22, z + 0.02), bevel=0, seg=1, obj=obj)
    for sx in (1, -1):
        m.box(frame, (0.035, 0.035, 0.62), at=(x + sx * w * 0.38, y - 0.3, z + 0.02), bevel=0, seg=1, obj=obj)


def steering_wheel2(m, at, tilt, r=0.19, mat='leather', obj_name='steering_wheel_mesh', column=True, spokes=3):
    """Steering wheel as its own mesh node parented to the steering_wheel socket (origin = wheel centre, +Z along the column).
    Geometry is emitted in the socket's local frame via the transform stack; the column stays in body."""
    o = m.obj(obj_name, origin=at, parent='steering_wheel', prot=(tilt, 0, 0))
    o.alias = {'metal_dark': 'interior', 'decal_red': 'interior', 'decal_yellow': 'interior', 'chrome': 'interior', 'leather': 'interior'}
    prev = m.cur
    M = xform(at, (tilt, 0, 0))
    m.use(obj_name)
    with m.xf(at, (tilt, 0, 0)):
        m.revolve(mat, [(r, -0.017), (r + 0.022, 0.0), (r, 0.017), (r - 0.022, 0.0)], axis='z', seg=18)
        m.revolve('metal_dark', [(0.055, -0.03), (0.06, 0.0), (0.045, 0.035), (0.0, 0.045)], axis='z', seg=10, closed=False)
        angs = (90, 210, 330) if spokes == 3 else (0, 90, 180, 270)
        for a in angs:
            d = Vector((math.cos(a * D2R), math.sin(a * D2R), 0))
            m.beam('metal_dark', tuple(d * 0.05), tuple(d * (r - 0.012) + Vector((0, 0, -0.006))), 0.03, 0.01, up=(0, 0, 1), bevel=0, seg=1)
        m.box('decal_red', (0.05, 0.05, 0.012), at=(0, 0, 0.04), bevel=0.006, seg=1)          # horn button / gang badge
    m.use(prev)
    if column:
        ax = M.to_3x3() @ Vector((0, 0, 1))
        P = V3(at)
        m.cyl('metal_dark', tuple(P + ax * 0.04), tuple(P + ax * 0.5), 0.024, seg=8)
        m.cyl('interior', tuple(P + ax * 0.08), tuple(P + ax * 0.26), 0.05, 0.06, seg=10)            # column shroud
    m.sock('steering_wheel', at, rot=(tilt, 0, 0), size=0.15)


def gauge_cluster(m, c, n=(0, 0, -1), w=0.4, obj='body', count=3):
    """instrument pod: dark hood with round gauges (amber backlit faces + needles)"""
    U, Vv, N = _frame(n)
    C = V3(c)
    for i in range(count):
        x = -w / 2 + w * (i + 0.5) / count
        r = 0.045 if i == count // 2 else 0.035
        P = C + U * x
        m.revolve('chrome', [(r * 1.18, -0.01), (r * 1.18, 0.006), (r * 1.0, 0.008)], at=tuple(P), axis=tuple(N), seg=10, obj=obj, closed=False)
        m.revolve('light_amber', [(0.0, 0.0), (r, 0.0)], at=tuple(P), axis=tuple(N), seg=10, obj=obj, closed=False)
        m.beam('metal_dark', tuple(P + N * 0.003), tuple(P + N * 0.003 + (U * math.cos(0.8 + i) + Vv * math.sin(0.8 + i)) * r * 0.8), 0.004, 0.002,
               up=tuple(N), bevel=0, obj=obj)


def flag(m, top, length=0.34, height=0.18, direction=(0, 0, -1), mat='cloth_red', obj=None, wave=0.035, cols=7, tatter=True, t=0.006):
    """ragged flag hanging from a pole top, blowing along `direction` (thin double-sided strip)."""
    T = V3(top)
    d = V3(direction).normalized()
    side = d.cross(Vector((0, 1, 0))).normalized()
    rings = []
    for k in range(cols + 1):
        f = k / cols
        droop = 0.05 * f * f
        h = height * (1.0 - (0.35 * f if tatter else 0.0)) * (1.0 - (0.18 if (tatter and k % 2 and k > cols // 2) else 0.0))
        c = T + d * (length * f) + side * (wave * math.sin(f * 5.2) * f) - Vector((0, droop, 0))
        up = Vector((0, 1, 0))
        rings.append([tuple(c + side * t), tuple(c + side * t - up * h), tuple(c - side * t - up * h), tuple(c - side * t)])
    m.sweep(mat, rings, caps=True, obj=obj)


def headlight2(m, at, r, n=(0, 0, 1), obj='body', seg=12, housing='metal_dark'):
    """sealed-beam headlight: bezel ring, deep reflector bowl, domed lens, bulb (about 190 tris)"""
    P = V3(at); N = tuple(V3(n).normalized())
    m.revolve('chrome', [(r * 1.16, -0.02), (r * 1.16, 0.012), (r * 0.98, 0.028), (r * 0.9, 0.012)], at=tuple(P), axis=N, seg=seg, obj=obj, closed=False)
    m.revolve(housing, [(r * 1.1, -0.02), (r * 0.95, -0.12), (0.0, -0.13)], at=tuple(P), axis=N, seg=seg, obj=obj, closed=False)
    m.revolve('chrome', [(r * 0.9, 0.008), (r * 0.6, -0.04), (r * 0.2, -0.075), (0.0, -0.08)], at=tuple(P), axis=N, seg=seg, obj=obj, closed=False)
    m.revolve('light_head', [(r * 0.9, 0.006), (r * 0.6, 0.02), (0.0, 0.028)], at=tuple(P), axis=N, seg=seg, obj=obj, closed=False)
    m.revolve('light_head', [(r * 0.12, -0.06), (r * 0.1, -0.03), (0.0, -0.025)], at=tuple(P), axis=N, seg=6, obj=obj, closed=False)


def spot2(m, at, n=(0, 0, 1), r=0.09, obj='body', seg=10):
    """round work lamp on a U bracket (about 170 tris)"""
    P = V3(at); nn = V3(n).normalized()
    N = tuple(nn)
    m.revolve('metal_dark', [(0.0, -0.13), (r * 0.8, -0.13), (r * 1.02, -0.06), (r * 1.06, 0.004), (r * 0.95, 0.012)], at=tuple(P), axis=N, seg=seg, obj=obj, closed=False)
    m.revolve('chrome', [(r * 0.94, 0.0), (r * 0.5, -0.05), (0.0, -0.065)], at=tuple(P), axis=N, seg=seg, obj=obj, closed=False)
    m.revolve('light_head', [(r * 0.94, 0.004), (0.0, 0.016)], at=tuple(P), axis=N, seg=seg, obj=obj, closed=False)
    side = nn.cross(Vector((0, 1, 0))).normalized()
    for sgn in (1, -1):
        m.beam('metal_dark', tuple(P - nn * 0.06 + side * (r * 1.1 * sgn)), tuple(P - nn * 0.06 + side * (r * 1.1 * sgn) - Vector((0, r * 1.3, 0))), 0.014, 0.03,
               up=tuple(nn), bevel=0, obj=obj)
    m.beam('metal_dark', tuple(P - nn * 0.06 - side * (r * 1.1) - Vector((0, r * 1.3, 0))), tuple(P - nn * 0.06 + side * (r * 1.1) - Vector((0, r * 1.3, 0))),
           0.03, 0.014, up=(0, 1, 0), bevel=0, obj=obj)
