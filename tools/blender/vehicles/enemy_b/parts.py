"""Reusable vehicle parts for enemy_b (game-space coordinates, see vlib)."""
import math
from mathutils import Vector
from vlib import *  # noqa


# ------------------------------------------------------------------------------------------------ wheels
def wheel_mesh(m, meshname, R, W, side, rim_ratio=0.56, lugs=18, spl=3, tread_h=0.03, nuts=8, lug_skew=1.4,
               dish=0.5, ribs=6, hub_r=0.3, big_lip=0.03):
    """Tyre + steel rim as a hidden source mesh centred on 0,0,0.  axle = X.  side=+1 -> rim face toward +X.
    materials: rubber_tire (tyre), rim (rim/hub/nuts)."""
    prev = m.cur
    m.obj(meshname, origin=(0, 0, 0), hidden=True).alias = {'rim': 'rim', 'rubber_tire': 'rubber_tire'}
    m.use(meshname)
    Rr = R * rim_ratio
    hw = W / 2
    S = lugs * spl
    tw = 0.80 * hw
    prof = []   # (x, r, lug_factor, shift)
    sw = R - Rr
    prof += [(0.90 * hw, Rr * 1.02, 0, 0), (1.0 * hw, Rr + 0.16 * sw, 0, 0), (1.035 * hw, Rr + 0.45 * sw, 0, 0),
             (1.0 * hw, Rr + 0.75 * sw, 0, 0), (0.92 * hw, R - 0.035, 0.55, lug_skew * 1.2)]
    nt = 7
    for k in range(nt):
        f = k / (nt - 1) * 2 - 1          # -1..1 (outer side = +)
        prof.append((tw * (1 - 2 * k / (nt - 1)), R - 0.02 * f * f, 1.0, lug_skew * abs(f)))
    prof += [(-0.92 * hw, R - 0.035, 0.55, lug_skew * 1.2), (-1.0 * hw, Rr + 0.75 * sw, 0, 0), (-1.035 * hw, Rr + 0.45 * sw, 0, 0),
             (-1.0 * hw, Rr + 0.16 * sw, 0, 0), (-0.90 * hw, Rr * 1.02, 0, 0), (-0.8 * hw, Rr * 0.96, 0, 0), (0.8 * hw, Rr * 0.96, 0, 0)]
    rings = []
    for (x, r, lf, sh) in prof:
        ring = []
        for j in range(S):
            ph = ((j) % spl)
            blk = 1.0 if ph < spl - 1 else 0.0          # (spl-1)/spl of the circumference is block
            # soften: first/last step of a block is a ramp
            rr = r + tread_h * lf * blk
            th = (j + sh * (1 if x >= 0 else 1)) * 2 * math.pi / S
            ring.append((x * side, rr * math.sin(th), rr * math.cos(th)))
        rings.append(ring)
    m.sweep('rubber_tire', rings, caps=False, closed_ring=True, wrap=True, min_angle=30)
    # ---- rim (face toward +x*side)
    sc = R / 0.55
    s = side
    lip = [(Rr + big_lip * sc, 0.98 * hw), (Rr + big_lip * sc, 0.80 * hw), (Rr - 0.03 * sc, 0.80 * hw), (Rr - 0.03 * sc, 0.98 * hw)]
    m.revolve('rim', [(r, t * s) for r, t in lip], axis='x', seg=max(S // 2, 24))
    dishp = [(Rr - 0.03 * sc, 0.80 * hw), (Rr - 0.03 * sc, 0.72 * hw), (Rr * 0.66, dish * hw), (Rr * hub_r * 1.4, dish * hw), (Rr * hub_r * 1.4, 0.62 * hw),
             (Rr * hub_r, 0.66 * hw), (Rr * hub_r * 0.55, 0.72 * hw), (0, 0.73 * hw), (0, 0.2 * hw), (Rr - 0.03 * sc, 0.2 * hw)]
    m.revolve('rim', [(r, t * s) for r, t in dishp], axis='x', seg=max(S // 2, 24))
    # radial ribs + lug nuts
    for i in range(ribs):
        a = 2 * math.pi * (i + 0.5) / ribs
        c, sn = math.cos(a), math.sin(a)
        r0, r1 = Rr * 0.44, Rr * 0.9
        m.beam('rim', (dish * hw * s + 0.008 * sc * s, r0 * sn, r0 * c), (dish * hw * s + 0.008 * sc * s, r1 * sn, r1 * c), 0.03 * sc, 0.02 * sc, up=(1, 0, 0), bevel=0)
    for i in range(nuts):
        a = 2 * math.pi * i / nuts
        rn = Rr * hub_r * 2.0
        m.hexbolt('rim', (dish * hw * s, rn * math.sin(a), rn * math.cos(a)), (s, 0, 0), r=0.026 * sc, h=0.032 * sc, seg=6)
    m.use(prev)


def wheel_set(m, tag, R, W, positions, names, **kw):
    """positions: list of (x,y,z) hub centres; names: matching node names (side decided by sign of x)."""
    wheel_mesh(m, 'wm_%s_L' % tag, R, W, +1, **kw)
    wheel_mesh(m, 'wm_%s_R' % tag, R, W, -1, **kw)
    for nm, p in zip(names, positions):
        m.inst(nm, 'wm_%s_%s' % (tag, 'L' if p[0] > 0 else 'R'), p)


# ------------------------------------------------------------------------------------------------ lights
def headlight(m, at, r, n=(0, 0, 1), obj='body', housing='metal_dark', bezel='chrome', seg=14):
    n = V3(n).normalized()
    P = V3(at)
    m.revolve(bezel, [(r * 1.15, -0.03), (r * 1.15, 0.02), (r * 0.98, 0.04), (r * 0.88, 0.02), (r * 0.88, -0.03)], at=P, axis=tuple(n), seg=seg, obj=obj, bevel=0.004)
    m.revolve(housing, [(r * 1.0, -0.12), (r * 0.9, -0.03), (r * 0.5, -0.02), (0, -0.02), (0, -0.14)], at=P, axis=tuple(n), seg=seg, obj=obj)
    m.revolve('chrome', [(r * 0.86, 0.0), (r * 0.55, -0.045), (r * 0.2, -0.085), (0, -0.09), (0, -0.07), (r * 0.18, -0.07), (r * 0.5, -0.03), (r * 0.84, 0.01)], at=P, axis=tuple(n), seg=seg, obj=obj)
    m.revolve('light_head', [(0, 0.03), (r * 0.5, 0.026), (r * 0.86, 0.012), (r * 0.86, -0.01), (0, -0.01)], at=P, axis=tuple(n), seg=seg, obj=obj)
    m.revolve('light_head', [(r * 0.1, -0.05), (r * 0.1, -0.02), (0, -0.02), (0, -0.05)], at=P + n * 0.0, axis=tuple(n), seg=8, obj=obj)


def light_rect(m, at, size, mat, n=(0, 0, -1), obj='body', housing='metal_dark', frame=0.018, ribs=0, depth=0.05):
    """Rect light: dark housing + emissive lens box slightly proud; n = facing direction."""
    w, h = size
    P = V3(at)
    nn = V3(n).normalized()
    R = basis_from(nn)
    x_ax = R @ Vector((1, 0, 0)); y_ax = R @ Vector((0, 1, 0))
    # housing and lens as oriented boxes via basis (use hull of corners for arbitrary orientation)
    def corners(hw, hh, d0, d1):
        pts = []
        for d in (d0, d1):
            for sx in (-1, 1):
                for sy in (-1, 1):
                    pts.append(P + x_ax * (sx * hw) + y_ax * (sy * hh) + nn * d)
        return pts
    m.hull(housing, corners((w + frame * 2) / 2, (h + frame * 2) / 2, -depth, 0.0), bevel=0.006, seg=1, obj=obj)
    m.hull(mat, corners(w / 2, h / 2, -0.01, 0.014), bevel=0.004, seg=1, obj=obj)
    for i in range(ribs):
        f = (i + 1) / (ribs + 1) * 2 - 1
        m.hull(housing, [P + x_ax * (f * w / 2 + dx) + y_ax * (sy * h / 2) + nn * d for dx in (-0.005, 0.005) for sy in (-1, 1) for d in (0.008, 0.02)], bevel=0, obj=obj)


# ------------------------------------------------------------------------------------------------ interior
def steering_wheel(m, at, tilt=22, r=0.19, obj='body', mat='interior'):
    """Wheel centred at `at`, column axis (+Z of socket) pitched down by `tilt` deg.  Adds the socket too."""
    P = V3(at)
    M = xform(at, (tilt, 0, 0))
    ax = M.to_3x3() @ Vector((0, 0, 1))
    m.revolve(mat, [(r, -0.014), (r + 0.026, 0), (r, 0.014), (r - 0.026, 0)], at=at, axis=tuple(ax), seg=20, obj=obj)
    m.revolve(mat, [(0.045, -0.02), (0.05, 0.03), (0.0, 0.05), (0.0, -0.02)], at=at, axis=tuple(ax), seg=10, obj=obj)
    ux = M.to_3x3() @ Vector((1, 0, 0)); uy = M.to_3x3() @ Vector((0, 1, 0))
    for a in (90, 210, 330):
        d = ux * math.cos(a * D2R) + uy * math.sin(a * D2R)
        m.beam(mat, P + d * 0.04, P + d * (r - 0.01), 0.026, 0.014, up=tuple(ax), bevel=0.003, seg=1, obj=obj)
    m.cyl('metal_dark', P, P + ax * 0.5, 0.022, seg=8, obj=obj)
    m.sock('steering_wheel', at, rot=(tilt, 0, 0), size=0.15)


def bucket_seat(m, at, w=0.5, facing=1, obj='body', cover='fabric', frame='metal_dark', back_h=0.62, rake=12):
    """Seat with hip point above cushion centre `at` (at = hip point).  facing +Z (front)."""
    x, y, z = at
    m.box(cover, (w, 0.11, 0.5), at=(x, y - 0.1, z - 0.05), bevel=0.03, seg=2, obj=obj)
    m.box(cover, (w, back_h, 0.11), at=(x, y - 0.05 + back_h / 2 - 0.05, z - 0.3 - 0.03), rot=(-rake, 0, 0), bevel=0.03, seg=2, obj=obj)
    m.box(cover, (w * 0.5, 0.2, 0.09), at=(x, y + back_h - 0.02, z - 0.3 - 0.09), rot=(-rake, 0, 0), bevel=0.03, seg=2, obj=obj)
    m.box(frame, (w * 0.9, 0.09, 0.4), at=(x, y - 0.24, z - 0.04), bevel=0.01, seg=1, obj=obj)
    for sx in (-1, 1):
        m.box(frame, (0.03, 0.05, 0.6), at=(x + sx * w * 0.42, y - 0.29, z - 0.04), bevel=0.006, seg=1, obj=obj)


# ------------------------------------------------------------------------------------------------ props
def jerrycan(m, at, rot=None, mat='paint2', obj='body', s=1.0):
    x, y, z = at
    m.box(mat, (0.16 * s, 0.34 * s, 0.34 * s), at=at, rot=rot, bevel=0.02, seg=2, obj=obj)
    m.box('metal_dark', (0.06 * s, 0.05 * s, 0.1 * s), at=(x, y + 0.19 * s, z + 0.1 * s), rot=rot, bevel=0.008, seg=1, obj=obj)
    m.box('metal_dark', (0.14 * s, 0.03 * s, 0.05 * s), at=(x, y + 0.19 * s, z - 0.06 * s), rot=rot, bevel=0.006, seg=1, obj=obj)


def barrel(m, at, r=0.29, h=0.86, axis='y', mat='paint2', obj='body', seg=20, rings=3):
    prof = [(0, -h / 2), (r * 0.94, -h / 2), (r, -h / 2 + 0.02), (r, h / 2 - 0.02), (r * 0.94, h / 2), (0, h / 2)]
    m.revolve(mat, prof, at=at, axis=axis, seg=seg, obj=obj, bevel=0.004)
    for i in range(rings):
        t = -h / 2 + h * (i + 1) / (rings + 1)
        m.revolve(mat, [(r * 1.0, t - 0.018), (r * 1.028, t - 0.008), (r * 1.028, t + 0.008), (r, t + 0.018)], at=at, axis=axis, seg=seg, obj=obj)
    m.revolve('metal_dark', [(0, h / 2 + 0.012), (r * 0.94, h / 2 + 0.003), (r * 0.94, h / 2 - 0.005), (0, h / 2 - 0.005)], at=at, axis=axis, seg=seg, obj=obj)


def sandbag_wall(m, p0, p1, rows, y0, depth=0.42, bag_h=0.19, bag_l=0.46, obj='body', jitter=0.02, gap_at=None, mat='canvas'):
    """Row of sandbags from p0 to p1 (XZ plane, y0 = floor), `rows` courses, brick-bonded."""
    a, b = Vector((p0[0], 0, p0[1])), Vector((p1[0], 0, p1[1]))
    d = b - a
    L = d.length
    dn = d / L
    ang = math.degrees(math.atan2(dn.x, dn.z))
    for r in range(rows):
        n = max(int(L / bag_l + 0.5), 1)
        off = 0.5 if r % 2 else 0.0
        k = n + (1 if r % 2 else 0)
        for i in range(k):
            s = (i + 0.5 - off) / n
            s = min(max(s, 0.02), 0.98) if False else s
            if s < -0.02 or s > 1.02:
                continue
            c = a + d * s
            y = y0 + bag_h * (r + 0.5) - r * 0.02
            bl = bag_l * (0.92 + 0.14 * m.rng.random())
            m.box(mat, (depth * (0.92 + 0.14 * m.rng.random()), bag_h * (0.9 + 0.2 * m.rng.random()), bl), at=(c.x + m.jitter(-jitter, jitter), y, c.z + m.jitter(-jitter, jitter)),
                  rot=(m.jitter(-4, 4), ang + m.jitter(-6, 6), m.jitter(-4, 4)), bevel=0.05, seg=1, obj=obj, min_angle=20)


def railing(m, pts, h=0.95, r=0.022, post_step=1.0, mat='metal_dark', obj='body', rails=(0.45, 0.95), close=False):
    """Pipe railing following a polyline of (x, z) points at ground height gy given as (x,y,z) triples; posts every step."""
    P = [V3(p) for p in pts]
    for i in range(len(P) - 1 + (1 if close else 0)):
        a, b = P[i], P[(i + 1) % len(P)]
        L = (b - a).length
        k = max(int(round(L / post_step)), 1)
        for j in range(k + 1 if not close else k):
            c = a + (b - a) * (j / k)
            m.cyl(mat, c, c + Vector((0, h, 0)), r, seg=7, obj=obj)
        for rh in rails:
            m.cyl(mat, a + Vector((0, rh, 0)), b + Vector((0, rh, 0)), r * 0.9, seg=7, obj=obj)


def spotlight(m, at, n=(0, 0, 1), r=0.11, obj='body', mount=0.18):
    """Round work-light with bracket, pointing along n."""
    P = V3(at); nn = V3(n).normalized()
    m.revolve('metal_dark', [(r, -0.14), (r * 1.05, -0.02), (r * 1.05, 0.0), (r * 0.98, 0.0), (r * 0.98, -0.14), (0, -0.14)], at=at, axis=tuple(nn), seg=10, obj=obj, bevel=0.004)
    m.revolve('chrome', [(r * 0.92, -0.005), (r * 0.5, -0.06), (0, -0.075), (0, -0.05), (r * 0.5, -0.04), (r * 0.9, 0.005)], at=at, axis=tuple(nn), seg=10, obj=obj)
    m.revolve('light_head', [(0, 0.02), (r * 0.72, 0.014), (r * 0.9, 0.0), (r * 0.9, -0.01), (0, -0.01)], at=tuple(P + nn * 0.005), axis=tuple(nn), seg=10, obj=obj)
    m.cyl('metal_dark', P - nn * 0.07 + Vector((0, -0.1, 0)), P - nn * 0.07, 0.03, seg=6, obj=obj)
    m.box('metal_dark', (r * 2.5, 0.03, 0.05), at=tuple(P - nn * 0.07 + Vector((0, -0.11, 0))), bevel=0.006, seg=1, obj=obj)


def exhaust_stack(m, base, top, r=0.08, obj='body', mat='chrome', cap='metal_dark', bend=0.0, shroud=True):
    """Vertical stack pipe from base to top with rolled rim, heat shield."""
    b, t = V3(base), V3(top)
    m.cyl(mat, b, t, r, seg=10, obj=obj)
    d = (t - b).normalized()
    m.revolve(cap, [(r * 1.12, -0.03), (r * 1.12, 0.0), (r * 0.8, 0.01), (r * 0.8, -0.03)], at=tuple(t), axis=tuple(d), seg=10, obj=obj)
    m.revolve('metal_dark', [(0.0, 0.0), (r * 0.82, 0.0), (r * 0.82, -0.005), (0, -0.005)], at=tuple(t), axis=tuple(d), seg=10, obj=obj)
    for f in (0.25, 0.6):
        c = b + (t - b) * f
        m.cyl('metal_bare', c - d * 0.018, c + d * 0.018, r * 1.16, seg=10, obj=obj)
    if shroud:
        c0, c1 = b + (t - b) * 0.08, b + (t - b) * 0.45
        m.cyl('metal_bare', c0, c1, r * 1.35, seg=10, obj=obj)
        for i in range(4):
            c = c0 + (c1 - c0) * (i + 0.5) / 4
            m.cyl('metal_dark', c - d * 0.012, c + d * 0.012, r * 1.4, seg=10, obj=obj)


def skull(m, at, s=1.0, n=(0, 0, 1), obj='body', horns=True, mat='plastic'):
    """Stylised skull facing n."""
    P = V3(at); nn = V3(n).normalized()
    R = basis_from(nn)
    xa = R @ Vector((1, 0, 0)); ya = R @ Vector((0, 1, 0))

    def L(x, y, z):
        return tuple(P + (xa * x + ya * y + nn * z) * s)
    # cranium (ellipsoid via revolve about y)
    m.revolve(mat, [(0, 0.16), (0.10, 0.145), (0.15, 0.09), (0.16, 0.02), (0.14, -0.04), (0.10, -0.075), (0, -0.09)], at=L(0, 0.05, -0.02), axis=tuple(ya), seg=14, obj=obj)
    # cheekbones / jaw
    m.hull(mat, [L(-0.10, -0.03, 0.10), L(0.10, -0.03, 0.10), L(-0.12, -0.02, 0.0), L(0.12, -0.02, 0.0), L(-0.08, -0.16, 0.08), L(0.08, -0.16, 0.08), L(-0.07, -0.15, 0.0), L(0.07, -0.15, 0.0)], bevel=0.008, seg=1, obj=obj)
    # eye sockets + nose
    for sx in (-1, 1):
        m.revolve('metal_dark', [(0, 0.02), (0.045, 0.0), (0.045, -0.03), (0, -0.03)], at=L(sx * 0.065, 0.02, 0.105), axis=tuple(nn), seg=10, obj=obj)
    m.hull('metal_dark', [L(0, -0.04, 0.115), L(-0.022, -0.09, 0.11), L(0.022, -0.09, 0.11), L(0, -0.045, 0.09)], bevel=0, obj=obj)
    # teeth
    for i in range(6):
        x = -0.05 + i * 0.02
        m.box(mat, (0.014, 0.05, 0.02), at=L(x, -0.15, 0.09), bevel=0.003, seg=1, obj=obj)
    m.box('metal_dark', (0.11, 0.008, 0.02), at=L(0, -0.125, 0.092), bevel=0, seg=1, obj=obj)
    if horns:
        for sx in (-1, 1):
            m.tube('metal_bare', [L(sx * 0.14, 0.12, -0.02), L(sx * 0.24, 0.16, -0.02), L(sx * 0.32, 0.27, 0.0), L(sx * 0.33, 0.4, 0.03)], 0.026 * s, seg=7, bend=0.08, r_end=0.004, obj=obj)
