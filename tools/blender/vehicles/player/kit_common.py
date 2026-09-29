"""kit_common - helpers shared by the tier kits (game coords: x left+, f forward+, z up)."""
import math
from mathutils import Vector
import vlib
from vlib import *  # noqa
from parts import *  # noqa


def mirror_pts(pts):
    return [(-p[0], p[1], p[2]) for p in pts]


def light_bar(pt, c, w, h=0.075, d=0.06, n=10, facing=1, m_body='metal_dark'):
    """LED light bar centred at c: housing, chrome reflector cups with emissive LEDs, dark dividers and a glass cover (+f side if facing=1)."""
    x, f, z = c
    pt.box(m_body, c, (w, d, h), bev=0.01)
    seg = (w - 0.06) / n
    for i in range(n):
        xx = x - w / 2 + 0.03 + seg * (i + 0.5)
        pt.box('chrome', (xx, f + facing * (d / 2 - 0.004), z), (seg * 0.9, 0.008, h * 0.8), bev=0.003, taper=(0.8, 1.0))
        for sz in (-0.2, 0.2):
            pt.cyl('light_head', (xx, f + facing * (d / 2 + 0.001), z + sz * h), seg * 0.2, 0.006, axis='f', n=10)
        pt.box('metal_dark', (x - w / 2 + 0.03 + seg * i, f + facing * (d / 2 + 0.002), z), (0.004, 0.01, h * 0.84), bev=0.0)
    pt.box('glass_lens', (x, f + facing * (d / 2 + 0.008), z), (w - 0.04, 0.006, h * 0.86), bev=0.003)
    for sx in (-1, 1):
        pt.box('metal_dark', (x + sx * (w / 2 - 0.01), f - facing * 0.03, z - h * 0.5 - 0.03), (0.04, 0.05, 0.06), bev=0.004)


def spotlight(pt, c, r, facing=1, yoke=True):
    """round off-road spot: bucket, chrome bezel, reflector, emissive core, glass lens and a stone-guard cross"""
    x, f, z = c
    pt.cyl('metal_dark', (x, f - facing * 0.035, z), r, 0.09, axis='f', n=18, bev=0.006)
    pt.torus('chrome', (x, f + facing * 0.014, z), r * 0.94, r * 0.09, axis='f', nR=20, nr=6)
    pt.cyl('light_head', (x, f + facing * 0.014, z), r * 0.82, 0.004, axis='f', n=18)
    pt.sph('metal_dark', (x, f + facing * 0.018, z), r * 0.18, n=10, sc=(1, 0.5, 1))
    pt.sph('glass_lens', (x, f + facing * 0.02, z), r * 0.88, n=16, sc=(1, 0.2, 1))
    for a in (45, -45):
        pt.box('metal_dark', (x, f + facing * 0.032, z), (r * 2.0, 0.006, 0.008), bev=0.0, rot=(0, 0, a))
    pt.torus('metal_dark', (x, f + facing * 0.03, z), r * 0.92, 0.004, axis='f', nR=18, nr=4)
    if yoke:
        pt.box('metal_dark', (x, f - facing * 0.03, z - r - 0.018), (0.06, 0.07, 0.03), bev=0.004)
        pt.tube('metal_dark', [(x - r - 0.012, f - facing * 0.03, z), (x - r - 0.012, f - facing * 0.03, z - r - 0.01), (x + r + 0.012, f - facing * 0.03, z - r - 0.01), (x + r + 0.012, f - facing * 0.03, z)], 0.006, n=6, rad=0.02, k=2)


def spike(pt, base, tip, r=0.02, m='spike', n=6):
    pt.cyl2(m, base, tip, r, r2=0.002, n=n)


def strap(pt, pts, w=0.045, t=0.006, m='fabric'):
    pt.ribbon(m, pts, w, t, up=(0, 0, 1), rad=0.02, k=2)


def base_plate(pt, x, f, z, size=0.11, bolts=True, m='metal_dark'):
    pt.box(m, (x, f, z + 0.006), (size, size, 0.012), bev=0.0)
    if bolts:
        for sx in (-1, 1):
            for sf in (-1, 1):
                pt.cyl('metal_bare', (x + sx * size * 0.34, f + sf * size * 0.34, z + 0.015), 0.0065, 0.007, axis='z', n=5)


def gusset(pt, x, f, z, w=0.07, h=0.09, axis='f', m='metal_dark'):
    """small triangular gusset plate (vertical), thickness along x"""
    poly = [(0, 0), (w, 0), (0, h)]
    if axis == 'f':
        pt.plate(m, poly, lambda u, v: (x, f + u, z + v), out=(1, 0, 0), thick=0.008, bev=0.0)
    else:
        pt.plate(m, poly, lambda u, v: (x + u, f, z + v), out=(0, 1, 0), thick=0.008, bev=0.0)


def spare_wheel(T, pt, at, rot=None, seg=40):
    """Build a spare tyre+rim using the truck's own wheel spec and graft it (rot=(p,y,r) degrees) into pt."""
    C = T.C
    tmp = Part('tmp_spare')
    build_wheel(tmp, (0, 0, 0), +1, C.R, C.tw, C.rimR, style=C.wheel_style, tread=C.tread, seg=seg, lug_pitch=C.lug_pitch,
                lug_depth=C.lug_depth, beadlock=C.beadlock, rust=0.3 if C.tier == 1 else 0.05, seed=7)
    pt.graft(tmp, at=at, rot=rot, mat_map={'chrome': 'rim', 'metal_bare': 'rim', 'rust': 'metal_dark'})
    tmp.bm.free()


def hazard_stripes(pt, x0, x1, z0, z1, f, n, m_yellow='paint2', facing=1, slant=0.6, thick=0.006, off=0.007):
    """Diagonal hazard chevrons (yellow bars) on a vertical plane at forward position f, spanning x0..x1, z0..z1.
    Bars are slanted parallelograms clipped to the rectangle."""
    w = (x1 - x0) / n
    hgt = z1 - z0
    sl = hgt * slant
    for i in range(n):
        if i % 2:
            continue
        xa = x0 + i * w
        pts = [(xa, z0), (xa + w, z0), (xa + w + sl, z1), (xa + sl, z1)]
        # clip against x range
        out = []
        for (u, v) in pts:
            out.append((u, v))
        # shear clip: shift into the rectangle
        clipped = _clip_poly(out, x0, x1)
        if len(clipped) >= 3:
            pt.plate(m_yellow, clipped, lambda u, v, f=f, facing=facing: (u, f + facing * off, v), out=(0, facing, 0), thick=thick, bev=0.0)


def _clip_poly(poly, xmin, xmax):
    def clip(pl, inside, inter):
        out = []
        for i in range(len(pl)):
            a, b = pl[i], pl[(i + 1) % len(pl)]
            ia, ib = inside(a), inside(b)
            if ia and ib:
                out.append(b)
            elif ia and not ib:
                out.append(inter(a, b))
            elif not ia and ib:
                out.append(inter(a, b))
                out.append(b)
        return out
    pl = clip(poly, lambda p: p[0] >= xmin, lambda a, b: (xmin, a[1] + (b[1] - a[1]) * (xmin - a[0]) / (b[0] - a[0])))
    if not pl:
        return []
    pl = clip(pl, lambda p: p[0] <= xmax, lambda a, b: (xmax, a[1] + (b[1] - a[1]) * (xmax - a[0]) / (b[0] - a[0])))
    return pl


def hazard_stripes_x(pt, f0, f1, z0, z1, x, n, facing=1, slant=0.6, thick=0.006, off=0.007, m_yellow='paint2'):
    """Diagonal hazard bars on a side plane (normal along x) at lateral position x, spanning f0..f1, z0..z1."""
    w = (f1 - f0) / n
    sl = (z1 - z0) * slant
    for i in range(n):
        if i % 2:
            continue
        fa = f0 + i * w
        poly = _clip_poly([(fa, z0), (fa + w, z0), (fa + w + sl, z1), (fa + sl, z1)], f0, f1)
        if len(poly) >= 3:
            pt.plate(m_yellow, poly, lambda u, v, x=x, facing=facing: (x + facing * off, u, v), out=(facing, 0, 0), thick=thick, bev=0.0)


def twisted_bar(pt, path, r=0.016, m='metal_dark', twist=95.0, n=6):
    """Rebar look: a 3-lobed star profile swept with twist along the path (path points every ~0.1 m)."""
    prof = []
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = r if i % 2 == 0 else r * 0.68
        prof.append((rr * math.cos(a), rr * math.sin(a)))
    pt.sweep(m, path, prof, twist=twist)


def chainlink(pt, x, f0, f1, z0, z1, spacing=0.11, r=0.0042, m='metal_bare', side=True):
    """Chain-link panel made from two families of thin diagonal wires on the plane x=const (side=True) or f=const (x plays the role of f range)."""
    L, H = f1 - f0, z1 - z0
    n = int((L + H) / spacing) + 1
    for i in range(n):
        c = -H + i * spacing
        # family A: f - f0 = (z - z0) + c
        za, zb_ = max(z0, z0 - c), min(z1, z0 + L - c)
        if zb_ - za > 0.05:
            pa = (f0 + (za - z0) + c, za)
            pb = (f0 + (zb_ - z0) + c, zb_)
            (pt.cyl2(m, (x, pa[0], pa[1]), (x, pb[0], pb[1]), r, n=4) if side else pt.cyl2(m, (pa[0], x, pa[1]), (pb[0], x, pb[1]), r, n=4))
        # family B: f - f0 = L - ((z - z0) + c)
        za, zb_ = max(z0, z0 - c), min(z1, z0 + L - c)
        if zb_ - za > 0.05:
            pa = (f0 + L - ((za - z0) + c), za)
            pb = (f0 + L - ((zb_ - z0) + c), zb_)
            (pt.cyl2(m, (x, pa[0], pa[1]), (x, pb[0], pb[1]), r, n=4) if side else pt.cyl2(m, (pa[0], x, pa[1]), (pb[0], x, pb[1]), r, n=4))


def rivets(pt, pts, r=0.011, m='metal_bare', axis='x', n=5):
    for p in pts:
        pt.cyl(m, p, r, r * 0.8, axis=axis, n=n)


def edge_points(poly_uv, frame, step):
    """points along a polygon boundary every `step` metres mapped through frame(u,v)->game pos"""
    out = []
    m = len(poly_uv)
    for i in range(m):
        a, b = poly_uv[i], poly_uv[(i + 1) % m]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        k = max(1, int(L / step))
        for j in range(k):
            t = j / k
            out.append(frame(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out
