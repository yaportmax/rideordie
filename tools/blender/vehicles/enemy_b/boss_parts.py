"""Large-scale modules for the Leviathan (boss_warrig).  Game-space coordinates; local modules use m.xf()."""
import math
from mathutils import Vector, Matrix
from parts import *  # noqa


# ------------------------------------------------------------------------------------------------ plating
def wall(m, mat, c, u, v, w, h, nu, nv, t=0.12, gap=0.05, obj=None, rmat=None, rr=0.03, jit=0.02, bevel=0.035, mats=None, rivets=True,
         rseg=5, corner_cut=0.0):
    """Riveted plate wall centred c spanning unit vectors u (width w) and v (height h); outward normal = u x v."""
    uu, vv = V3(u).normalized(), V3(v).normalized()
    nn = uu.cross(vv).normalized()
    cw, ch = w / nu, h / nv
    cc = V3(c)
    for i in range(nu):
        for j in range(nv):
            pc = cc + uu * ((i + 0.5) * cw - w / 2) + vv * ((j + 0.5) * ch - h / 2)
            tt = t * (0.8 + 0.5 * m.rng.random())
            pcc = pc + nn * (tt / 2)
            mt = mats[m.rng.randrange(len(mats))] if mats else mat
            m.obox(mt, tuple(pcc), tuple(uu), tuple(vv), (cw - gap, ch - gap, tt), bevel=bevel, seg=1, obj=obj)
            if rivets:
                ox, oy = cw / 2 - gap - rr * 2.2, ch / 2 - gap - rr * 2.2
                for (a, b) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    m.rivet(rmat or mt, tuple(pc + uu * (a * ox) + vv * (b * oy) + nn * tt), tuple(nn), r=rr, seg=rseg, obj=obj)
                if cw > 1.4:
                    for a in (-1, 1):
                        m.rivet(rmat or mt, tuple(pc + vv * (a * oy) + nn * tt), tuple(nn), r=rr, seg=rseg, obj=obj)


def spike_row(m, mat, p0, p1, n, length, r, direction, obj=None, jitter=0.15, seg=6):
    a, b = V3(p0), V3(p1)
    d = V3(direction).normalized()
    for i in range(n):
        s = (i + 0.5) / n
        base = a + (b - a) * s
        L = length * (1 + m.jitter(-jitter, jitter))
        m.spike(mat, tuple(base), tuple(base + d * L), r, seg=seg, obj=obj)


def chain(m, p0, p1, sag=0.5, link=0.2, r=0.035, mat='metal_dark', obj=None, seg=6):
    a, b = V3(p0), V3(p1)
    L = (b - a).length
    n = max(int(L / link), 2)
    pts = [a + (b - a) * (i / n) + Vector((0, -sag * 4 * (i / n) * (1 - i / n), 0)) for i in range(n + 1)]
    for i in range(n):
        c = (pts[i] + pts[i + 1]) / 2
        t = (pts[i + 1] - pts[i])
        if t.length < 1e-6:
            continue
        t.normalize()
        ax1 = Vector((0, 1, 0)).cross(t)
        if ax1.length < 1e-3:
            ax1 = Vector((1, 0, 0))
        ax1.normalize()
        ax2 = t.cross(ax1).normalized()
        axn = ax1 if i % 2 == 0 else ax2
        yv = t.cross(axn).normalized() if False else None
        # local: z = ring axis, x = along chain
        x = t
        z = axn
        y = z.cross(x).normalized()
        M = Matrix(((x.x, y.x, z.x, 0), (x.y, y.y, z.y, 0), (x.z, y.z, z.z, 0), (0, 0, 0, 1)))
        R0 = link * 0.55
        prof = [(R0 + r * math.cos(k * math.pi / 3), r * math.sin(k * math.pi / 3)) for k in range(6)]
        m.revolve(mat, prof, at=tuple(c), axis=M, seg=8, obj=obj, sx=1.0, sy=0.55)


def catwalk(m, p0, p1, width=1.0, mat='armor', obj=None, rail=True, rail_h=1.05, post_step=1.2, grate=True):
    """Straight catwalk from p0 to p1 (deck level), rails on both sides."""
    a, b = V3(p0), V3(p1)
    d = b - a
    L = d.length
    dn = d / L
    side = Vector((0, 1, 0)).cross(dn).normalized()
    ctr = (a + b) / 2
    m.obox(mat, tuple(ctr), tuple(side), (0, 1, 0), (width, 0.08, L), bevel=0.01, seg=1, obj=obj) if False else None
    m.beam(mat, tuple(a), tuple(b), width, 0.08, up=(0, 1, 0), bevel=0.012, seg=1, obj=obj)
    for sgn in (-1, 1):
        for s in range(-1, 2, 2):
            pass
    for sgn in (-1, 1):
        o = side * (width / 2 * sgn)
        m.beam('metal_dark', tuple(a + o - Vector((0, 0.1, 0))), tuple(b + o - Vector((0, 0.1, 0))), 0.06, 0.16, up=(0, 1, 0), bevel=0, obj=obj)
        if rail:
            k = max(int(L / post_step), 1)
            for i in range(k + 1):
                p = a + o + dn * (L * i / k)
                m.cyl('metal_dark', tuple(p), tuple(p + Vector((0, rail_h, 0))), 0.028, seg=6, obj=obj)
            m.cyl('metal_dark', tuple(a + o + Vector((0, rail_h, 0))), tuple(b + o + Vector((0, rail_h, 0))), 0.026, seg=6, obj=obj)
            m.cyl('metal_dark', tuple(a + o + Vector((0, rail_h * 0.5, 0))), tuple(b + o + Vector((0, rail_h * 0.5, 0))), 0.022, seg=6, obj=obj)


def ladder(m, base, top, width=0.6, rung=0.32, mat='metal_dark', obj=None, side=(1, 0, 0)):
    a, b = V3(base), V3(top)
    sd = V3(side).normalized()
    for sgn in (-1, 1):
        m.cyl(mat, tuple(a + sd * (width / 2 * sgn)), tuple(b + sd * (width / 2 * sgn)), 0.03, seg=6, obj=obj)
    L = (b - a).length
    n = max(int(L / rung), 1)
    for i in range(1, n + 1):
        p = a + (b - a) * (i / (n + 1))
        m.cyl(mat, tuple(p - sd * width / 2), tuple(p + sd * width / 2), 0.02, seg=5, obj=obj)


def banner(m, at, height=4.0, w=1.3, h=2.0, facing=(1, 0, 0), obj='body', skull_top=True, mat='cloth_red'):
    """Tall pole with a tattered war banner hanging from a cross-arm and (optionally) a skull on top."""
    x, y, z = at
    m.cyl('metal_dark', (x, y, z), (x, y + height, z), 0.06, seg=7, obj=obj)
    fd = V3(facing).normalized()
    m.cyl('metal_dark', (x - fd.x * 0.06, y + height - 0.3, z - fd.z * 0.06), (x + fd.x * (w + 0.1), y + height - 0.3, z + fd.z * (w + 0.1)), 0.035, seg=6, obj=obj)
    cx = V3((x, y + height - 0.32 - h / 2, z)) + fd * (w / 2 + 0.02)
    m.obox(mat, tuple(cx), tuple(fd), (0, 1, 0), (w, h, 0.025), bevel=0, seg=1, obj=obj)
    # ragged tail: 3 strips of decreasing length
    for i in range(4):
        sx = -w / 2 + w * (i + 0.5) / 4
        ln = h * (0.25 + 0.2 * m.rng.random())
        cc = cx + fd * sx - Vector((0, h / 2 + ln / 2 - 0.02, 0))
        m.obox(mat, tuple(cc), tuple(fd), (0, 1, 0), (w / 4 - 0.03, ln, 0.025), bevel=0, seg=1, obj=obj)
    if skull_top:
        skull(m, (x, y + height + 0.18, z), s=1.6, n=facing, obj=obj, horns=True)


def floodlight(m, at, n=(0, 0, 1), r=0.28, obj='body'):
    spotlight(m, at, n=n, r=r, obj=obj)


def barrel_stack(m, at, n=(3, 2), r=0.34, h=1.0, mats=('paint2', 'rust', 'armor'), obj='body', tilt=True):
    x0, y0, z0 = at
    for j in range(n[1]):
        for i in range(n[0]):
            mt = mats[m.rng.randrange(len(mats))]
            xx = x0 + (i - (n[0] - 1) / 2) * (2 * r + 0.03) + (0.5 * r if j % 2 else 0)
            barrel(m, (xx, y0 + h / 2 + j * (h + 0.02), z0 + m.jitter(-0.05, 0.05)), r=r, h=h, mat=mt, obj=obj, seg=12, rings=2)


def crate(m, at, size=(1.0, 0.8, 1.0), rot=(0, 0, 0), obj='body', mat='wood'):
    x, y, z = at
    m.box(mat, size, at=at, rot=rot, bevel=0.03, seg=1, obj=obj)
    m.box('metal_dark', (size[0] + 0.03, 0.07, size[2] + 0.03), at=(x, y + size[1] * 0.3, z), rot=rot, bevel=0, obj=obj)
    m.box('metal_dark', (size[0] + 0.03, 0.07, size[2] + 0.03), at=(x, y - size[1] * 0.3, z), rot=rot, bevel=0, obj=obj)


def tyre_pile(m, at, n=3, R=0.7, W=0.4, obj='body'):
    x, y, z = at
    for i in range(n):
        m.revolve('rubber_tire', [(R * 0.5, -W / 2), (R * 0.95, -W / 2), (R, -W * 0.3), (R, W * 0.3), (R * 0.95, W / 2), (R * 0.5, W / 2)],
                  at=(x + m.jitter(-0.08, 0.08), y + W / 2 + i * W, z + m.jitter(-0.08, 0.08)), axis='y', seg=16, obj=obj)


# ------------------------------------------------------------------------------------------------ gun turret (placeholder mounted guns)
def gun_turret(m, name, at, s=1.0, mat='armor'):
    """part_<name> with pivot at `at` (socket <name> added).  Twin heavy machine-guns behind a slanted shield; +Z forward."""
    pn = 'part_' + name
    m.panel(pn, at, metal_dark=mat, chrome=mat, metal_bare=mat, gun_metal=mat, gun_black=mat, spike=mat, rust=mat, paint=mat, paint2=mat)
    with m.xf(at):
        o = pn
        m.revolve(mat, [(0.0, 0.0), (0.95 * s, 0.0), (1.0 * s, 0.05 * s), (1.0 * s, 0.22 * s), (0.85 * s, 0.3 * s), (0, 0.3 * s)], axis='y', seg=20, obj=o, bevel=0.01)
        # gun housing
        m.hull(mat, [(-0.62 * s, 0.3 * s, -0.55 * s), (0.62 * s, 0.3 * s, -0.55 * s), (-0.7 * s, 0.9 * s, -0.4 * s), (0.7 * s, 0.9 * s, -0.4 * s),
                     (-0.62 * s, 0.3 * s, 0.45 * s), (0.62 * s, 0.3 * s, 0.45 * s), (-0.55 * s, 0.85 * s, 0.35 * s), (0.55 * s, 0.85 * s, 0.35 * s)], bevel=0.05 * s, seg=2, obj=o)
        # slanted shield
        m.hull(mat, [(-0.95 * s, 0.35 * s, 0.55 * s), (0.95 * s, 0.35 * s, 0.55 * s), (-0.85 * s, 1.45 * s, 0.35 * s), (0.85 * s, 1.45 * s, 0.35 * s),
                     (-0.95 * s, 0.35 * s, 0.68 * s), (0.95 * s, 0.35 * s, 0.68 * s), (-0.85 * s, 1.45 * s, 0.47 * s), (0.85 * s, 1.45 * s, 0.47 * s)], bevel=0.035 * s, seg=2, obj=o)
        m.rivet_rect(mat, (0, 0.9 * s, 0.68 * s), 1.8 * s, 1.0 * s, (0, 0.3, 1), u=(1, 0, 0), v=(0, 1, -0.2), step=0.2 * s, r=0.03 * s, inset=0.08, obj=o) if False else None
        for sx in (-1, 1):
            xg = 0.28 * s * sx
            m.cyl(mat, (xg, 0.95 * s, 0.3 * s), (xg, 0.95 * s, 2.6 * s), 0.085 * s, seg=10, obj=o)
            m.cyl(mat, (xg, 0.95 * s, 0.5 * s), (xg, 0.95 * s, 1.5 * s), 0.14 * s, seg=10, obj=o)
            for k in range(6):
                m.cyl(mat, (xg, 0.95 * s, 0.55 * s + k * 0.16 * s), (xg, 0.95 * s, 0.6 * s + k * 0.16 * s), 0.16 * s, seg=10, obj=o)
            m.cyl(mat, (xg, 0.95 * s, 2.45 * s), (xg, 0.95 * s, 2.8 * s), 0.13 * s, 0.09 * s, seg=8, obj=o)
            m.box(mat, (0.5 * s, 0.4 * s, 0.6 * s), at=(0.9 * s * sx, 0.55 * s, -0.1 * s), bevel=0.03, seg=1, obj=o)            # ammo box
            m.tube(mat, [(0.7 * s * sx, 0.6 * s, -0.1 * s), (0.5 * s * sx, 0.85 * s, 0.05 * s), (xg, 0.95 * s, 0.1 * s)], 0.04 * s, seg=6, bend=0.05, obj=o)
        m.box(mat, (0.16 * s, 0.5 * s, 0.16 * s), at=(0, 1.15 * s, -0.5 * s), bevel=0.02, seg=1, obj=o)
        m.tube(mat, [(-0.3 * s, 1.0 * s, -0.55 * s), (-0.3 * s, 1.25 * s, -0.75 * s), (0.3 * s, 1.25 * s, -0.75 * s), (0.3 * s, 1.0 * s, -0.55 * s)], 0.03 * s, seg=6, bend=0.05, obj=o)  # spade grips
        for sx in (-1, 1):
            m.spike(mat, (0.8 * s * sx, 1.45 * s, 0.4 * s), (0.9 * s * sx, 1.9 * s, 0.45 * s), 0.05 * s, seg=6, obj=o)
    m.use('body')
    m.sock(name, at, size=0.4)


def cannon_turret(m, name, at, s=1.0, mat='armor'):
    pn = 'part_' + name
    m.panel(pn, at, metal_dark=mat, chrome=mat, metal_bare=mat, gun_metal=mat, gun_black=mat, spike=mat, rust=mat, paint=mat, paint2=mat)
    with m.xf(at):
        o = pn
        r = 2.0 * s
        m.revolve(mat, [(0, 0), (r * 0.95, 0), (r, 0.08 * s), (r, 0.35 * s), (r * 0.9, 0.42 * s), (0, 0.42 * s)], axis='y', seg=28, obj=o, bevel=0.02)
        # faceted turret body (octagonal hull)
        ring0 = [(r * 0.92 * math.cos(a * D2R + 0.39), 0.42 * s, r * 0.92 * math.sin(a * D2R + 0.39)) for a in range(0, 360, 45)]
        ring1 = [(r * 0.8 * math.cos(a * D2R + 0.39), 1.55 * s, r * 0.8 * math.sin(a * D2R + 0.39)) for a in range(0, 360, 45)]
        ring2 = [(r * 0.5 * math.cos(a * D2R + 0.39), 2.05 * s, r * 0.5 * math.sin(a * D2R + 0.39)) for a in range(0, 360, 45)]
        m.hull(mat, ring0 + ring1, bevel=0.08 * s, seg=2, obj=o)
        m.hull(mat, ring1 + ring2, bevel=0.06 * s, seg=2, obj=o)
        # side skirts armor
        for sx in (-1, 1):
            m.hull(mat, [(sx * 1.6 * s, 0.6 * s, -1.3 * s), (sx * 1.85 * s, 0.6 * s, 0.4 * s), (sx * 1.6 * s, 1.4 * s, -1.1 * s), (sx * 1.7 * s, 1.4 * s, 0.4 * s),
                         (sx * 1.85 * s, 0.6 * s, -1.3 * s), (sx * 1.85 * s, 1.4 * s, -1.2 * s)], bevel=0.04 * s, seg=1, obj=o)
        # mantlet + barrel
        m.hull(mat, [(-0.65 * s, 0.75 * s, 1.35 * s), (0.65 * s, 0.75 * s, 1.35 * s), (-0.55 * s, 1.75 * s, 1.3 * s), (0.55 * s, 1.75 * s, 1.3 * s),
                     (-0.5 * s, 0.85 * s, 1.85 * s), (0.5 * s, 0.85 * s, 1.85 * s), (-0.42 * s, 1.6 * s, 1.8 * s), (0.42 * s, 1.6 * s, 1.8 * s)], bevel=0.06 * s, seg=2, obj=o)
        by = 1.2 * s
        m.cyl(mat, (0, by, 1.7 * s), (0, by, 8.6 * s), 0.27 * s, seg=16, obj=o)
        m.cyl(mat, (0, by, 1.8 * s), (0, by, 3.6 * s), 0.42 * s, 0.32 * s, seg=16, obj=o)                # breech-end thick
        m.cyl(mat, (0, by, 5.3 * s), (0, by, 6.2 * s), 0.36 * s, seg=16, obj=o)                           # bore evacuator bulge
        for k in range(8):
            m.cyl(mat, (0, by, 3.8 * s + k * 0.55 * s), (0, by, 3.86 * s + k * 0.55 * s), 0.31 * s, seg=16, obj=o)   # heat rings
        m.cyl(mat, (0, by, 8.4 * s), (0, by, 9.3 * s), 0.46 * s, seg=14, obj=o)                           # muzzle brake
        for k in range(4):
            m.cyl(mat, (0, by, 8.5 * s + k * 0.22 * s), (0, by, 8.56 * s + k * 0.22 * s), 0.5 * s, seg=14, obj=o)
        for sx in (-1, 1):
            m.cyl(mat, (0.45 * s * sx, by + 0.28 * s, 1.9 * s), (0.45 * s * sx, by + 0.28 * s, 4.6 * s), 0.09 * s, seg=8, obj=o)    # recoil cyl
            m.cyl(mat, (0.7 * s * sx, by - 0.2 * s, 1.9 * s), (0.7 * s * sx, by - 0.2 * s, 4.0 * s), 0.07 * s, seg=8, obj=o)
        # rear bustle with shell racks + hatch + spikes + skull
        m.hull(mat, [(-1.1 * s, 0.6 * s, -1.6 * s), (1.1 * s, 0.6 * s, -1.6 * s), (-1.0 * s, 1.7 * s, -1.4 * s), (1.0 * s, 1.7 * s, -1.4 * s),
                     (-1.2 * s, 0.6 * s, -2.5 * s), (1.2 * s, 0.6 * s, -2.5 * s), (-1.05 * s, 1.5 * s, -2.4 * s), (1.05 * s, 1.5 * s, -2.4 * s)], bevel=0.07 * s, seg=2, obj=o)
        for i in range(4):
            for j in range(2):
                m.cyl(mat, (-0.75 * s + i * 0.5 * s, 0.85 * s + j * 0.55 * s, -2.55 * s), (-0.75 * s + i * 0.5 * s, 0.85 * s + j * 0.55 * s, -2.9 * s), 0.17 * s, seg=8, obj=o)
        m.revolve(mat, [(0, 0), (0.55 * s, 0), (0.6 * s, 0.1 * s), (0.5 * s, 0.22 * s), (0, 0.25 * s)], at=(0.6 * s, 2.03 * s, -0.4 * s), axis='y', seg=12, obj=o)
        for a in range(0, 360, 60):
            m.hexbolt(mat, (0.6 * s + 0.5 * s * math.cos(a * D2R), 2.05 * s, -0.4 * s + 0.5 * s * math.sin(a * D2R)), (0, 1, 0), r=0.05 * s, h=0.05 * s, obj=o)
        for i in range(6):
            a = i * 60 * D2R
            m.spike(mat, (r * 0.8 * math.cos(a), 1.5 * s, r * 0.8 * math.sin(a)), (r * 0.86 * math.cos(a), 2.2 * s, r * 0.86 * math.sin(a)), 0.09 * s, seg=6, obj=o)
        m.rivet_rect(mat, (0, 1.0 * s, r * 0.9 + 0.02), 2.4 * s, 0.9 * s, (0, 0, 1), u=(1, 0, 0), v=(0, 1, 0), step=0.24 * s, r=0.035 * s, obj=o) if False else None
    m.use('body')
    m.sock(name, at, size=0.6)
    m.sock('muzzle_main', (at[0], at[1] + 1.2 * s, at[2] + 9.3 * s), size=0.4)


# ------------------------------------------------------------------------------------------------ missile pod
def rocket_pod(m, name, sock, at, elev=24, rows=3, cols=3, length=2.8, tube_r=0.3, mat='armor'):
    """part_<name> (pod frame + rockets), socket <sock> at the launcher muzzle centre.  +Z along tubes, elevated by `elev` deg."""
    pn = 'part_' + name
    m.panel(pn, at, metal_dark=mat, chrome=mat, metal_bare=mat, spike=mat, rust=mat, paint=mat, gun_metal=mat, paint2='paint2', decal_red='paint2')
    sp = tube_r * 2.35
    w = cols * sp
    h = rows * sp
    with m.xf(at, rot=(-elev, 0, 0)):
        o = pn
        m.box(mat, (w + 0.2, h + 0.2, 0.25), at=(0, 0, -0.1), bevel=0.04, seg=1, obj=o)                               # back plate
        fl = length * 0.55                                                                                             # side frame covers the rear part only
        for sx in (-1, 1):
            m.box(mat, (0.12, h + 0.24, fl), at=(sx * (w / 2 + 0.06), 0, fl / 2 - 0.05), bevel=0.03, seg=1, obj=o)
        m.box(mat, (w + 0.24, 0.12, fl), at=(0, h / 2 + 0.06, fl / 2 - 0.05), bevel=0.03, seg=1, obj=o)
        m.box(mat, (w + 0.24, 0.12, fl), at=(0, -h / 2 - 0.06, fl / 2 - 0.05), bevel=0.03, seg=1, obj=o)
        for k in range(rows + 1):                                                                                      # front grid frame
            m.box(mat, (w + 0.24, 0.1, 0.16), at=(0, (k - rows / 2) * sp, length - 0.25), bevel=0.02, seg=1, obj=o)
        for k in range(cols + 1):
            m.box(mat, (0.1, h + 0.24, 0.16), at=((k - cols / 2) * sp, 0, length - 0.25), bevel=0.02, seg=1, obj=o)
        for j in range(rows):
            for i in range(cols):
                x = (i - (cols - 1) / 2) * sp
                y = (j - (rows - 1) / 2) * sp
                m.revolve(mat, [(tube_r, 0.0), (tube_r, length - 0.1), (tube_r * 0.82, length - 0.1), (tube_r * 0.82, 0.0)], at=(x, y, 0.0), axis='z', seg=10, obj=o)
                m.cone('paint2', (x, y, length - 0.3), (x, y, length + 0.32), tube_r * 0.74, seg=8, obj=o)         # warhead
                m.cyl(mat, (x, y, length - 0.3), (x, y, length - 0.12), tube_r * 0.7, seg=8, obj=o)
        for a in (0.35, 0.8):
            m.box('paint2', (w + 0.26, h + 0.26, 0.09), at=(0, 0, length * a), bevel=0.02, seg=1, obj=o)            # hazard bands
        m.box(mat, (0.7, 0.55, 0.5), at=(0, -h / 2 - 0.45, -0.1), bevel=0.04, seg=1, obj=o)                         # trunnion block
        m.rivet_rect(mat, (0, 0, -0.24), w + 0.2, h + 0.2, (0, 0, -1), u=(1, 0, 0), v=(0, 1, 0), step=0.25, r=0.03, obj=o)
    m.use('body')
    p = V3(at) + (xform((0, 0, 0), (-elev, 0, 0)).to_3x3() @ Vector((0, 0, length + 0.3)))
    m.sock(sock, tuple(p), rot=(-elev, 0, 0), size=0.5)


# ------------------------------------------------------------------------------------------------ fuel tank
def fuel_tank(m, name, at, r=0.85, L=5.0, mat_shell='chrome', mat_band='paint2', fuel_socket=False, side=1):
    pn = 'part_' + name
    m.panel(pn, at, metal_dark='armor', armor='armor', metal_bare='armor', spike='armor', decal_red='paint2', plastic='plastic', rust='armor',
            paint='paint2')
    d = r * 0.42
    prof = [(0, -L / 2 - d), (r * 0.45, -L / 2 - d * 0.93), (r * 0.8, -L / 2 - d * 0.6), (r * 0.97, -L / 2 - d * 0.2), (r, -L / 2)]
    nseg = 12
    prof += [(r, -L / 2 + L * i / nseg) for i in range(1, nseg)]
    prof += [(r, L / 2), (r * 0.97, L / 2 + d * 0.2), (r * 0.8, L / 2 + d * 0.6), (r * 0.45, L / 2 + d * 0.93), (0, L / 2 + d)]
    dents = [(0.5, 1.2, 0.5, 0.06), (2.4, -1.4, 0.55, 0.07), (4.0, 0.3, 0.5, 0.05), (5.3, -0.4, 0.45, 0.06)]

    def deform(p):
        a = math.atan2(p.y, p.x)
        k = 0.0
        for (ta, zc, rr, dp) in dents:
            da = math.atan2(math.sin(a - ta), math.cos(a - ta))
            k += dp * math.exp(-((da * r) ** 2 + (p.z - zc) ** 2) / (2 * (rr / 2) ** 2))
        rad = math.hypot(p.x, p.y)
        if rad < 1e-4:
            return p
        f = (rad - k) / rad
        return Vector((p.x * f, p.y * f, p.z))
    with m.xf(at):
        o = pn
        m.revolve(mat_shell, prof, axis='z', seg=28, obj=o, deform=deform)
        for zc in (-L / 2 + 0.15, -L * 0.17, L * 0.17, L / 2 - 0.15):
            m.revolve(mat_band, [(r + 0.05, zc - 0.13), (r + 0.06, zc - 0.11), (r + 0.06, zc + 0.11), (r + 0.05, zc + 0.13), (r - 0.02, zc + 0.13), (r - 0.02, zc - 0.13)], axis='z', seg=28, obj=o, bevel=0.008)
            for k in range(20):
                a = 2 * math.pi * (k + 0.5) / 20
                for sgn in (-1, 1):
                    m.rivet('armor', (r * 1.03 * math.cos(a), r * 1.03 * math.sin(a), zc + sgn * 0.09), (math.cos(a), math.sin(a), 0), r=0.024, obj=o)
        # saddles + straps
        for zc in (-L * 0.32, L * 0.32):
            m.box('armor', (r * 1.5, 0.2, 0.35), at=(0, -r - 0.05, zc), bevel=0.02, seg=1, obj=o)
        # hazard diamonds + text
        for sx in (1, -1):
            s_ = 0.34
            m.plate('plastic', [(0, s_), (s_, 0), (0, -s_), (-s_, 0)], 0.02, at=(sx * (r + 0.02), 0.0, L * 0.02), u=(0, 0, -sx), v=(0, 1, 0), bevel=0.005, seg=1, obj=o)
            m.plate('decal_red', [(0, s_ * 0.85), (s_ * 0.85, 0), (0, -s_ * 0.85), (-s_ * 0.85, 0)], 0.024, at=(sx * (r + 0.024), 0.0, L * 0.02), u=(0, 0, -sx), v=(0, 1, 0), bevel=0.003, seg=1, obj=o)
            m.plate('plastic', [(0, 0.22), (0.1, 0.02), (0.07, -0.13), (0, -0.18), (-0.07, -0.13), (-0.1, 0.02), (-0.03, 0.1)], 0.028, at=(sx * (r + 0.03), -0.02, L * 0.02), u=(0, 0, -sx), v=(0, 1, 0), bevel=0, seg=1, obj=o)
        # filler dome + valve + vents on top
        for zc in (-L * 0.28, L * 0.28):
            m.revolve('armor', [(0, r - 0.03), (0.3, r - 0.03), (0.32, r + 0.04), (0.26, r + 0.1), (0, r + 0.1)], at=(0, 0, zc), axis=Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1))), seg=12, obj=o)
        m.revolve('chrome', [(0, r + 0.1), (0.22, r + 0.1), (0.2, r + 0.22), (0, r + 0.24)], at=(0, 0, -L * 0.28), axis=Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1))), seg=10, obj=o)
        # end fittings
        m.cyl('armor', (0, 0, L / 2 + d), (0, 0, L / 2 + d + 0.18), 0.16, seg=8, obj=o)
        m.revolve('decal_red', [(0.18, -0.02), (0.18, 0.02), (0.02, 0.02), (0.02, -0.02)], at=(0, 0, L / 2 + d + 0.2), axis='z', seg=10, obj=o)
    m.use('body')
    if fuel_socket:
        m.sock('fuel_cap', (at[0], at[1] + r + 0.24, at[2] - L * 0.28), size=0.3)


# ------------------------------------------------------------------------------------------------ reactor core (weak point)
def reactor(m, at, s=1.0, name='part_engine'):
    m.panel(name, at, chrome='metal_dark', metal_bare='armor', rust='armor')
    with m.xf(at):
        o = name
        h = 2.6 * s
        # frame
        for sx in (-1, 1):
            for sz in (-1, 1):
                m.box('armor', (0.22 * s, h, 0.22 * s), at=(sx * 1.45 * s, 0, sz * 0.7 * s), bevel=0.02, seg=1, obj=o)
        for y in (-h / 2, h / 2):
            m.box('armor', (3.2 * s, 0.25 * s, 1.7 * s), at=(0, y, 0), bevel=0.03, seg=1, obj=o)
        # core drum with glowing rods
        m.revolve('metal_dark', [(0, -h / 2), (0.95 * s, -h / 2), (1.0 * s, -h / 2 + 0.1), (1.0 * s, h / 2 - 0.1), (0.95 * s, h / 2), (0, h / 2)], axis='y', seg=20, obj=o, sx=1.25, sy=0.7)
        for k in range(10):
            a = 2 * math.pi * k / 10
            x, z = 1.0 * s * 1.25 * math.cos(a) * 0.95, 1.0 * s * 0.7 * math.sin(a) * 0.95
            m.cyl('light_amber', (x, -h / 2 + 0.25 * s, z + 0.0), (x, h / 2 - 0.25 * s, z), 0.11 * s, seg=6, obj=o)
        m.cyl('light_amber', (0, -h / 2 + 0.2 * s, 0), (0, h / 2 - 0.2 * s, 0), 0.28 * s, seg=10, obj=o)
        for y in (-0.7 * s, 0.0, 0.7 * s):
            m.revolve('armor', [(1.05 * s, y - 0.09 * s), (1.12 * s, y - 0.06 * s), (1.12 * s, y + 0.06 * s), (1.05 * s, y + 0.09 * s)], axis='y', seg=20, obj=o, sx=1.25, sy=0.7)
        for k in range(14):
            a = 2 * math.pi * k / 14
            m.box('metal_dark', (0.06 * s, h - 0.5 * s, 0.4 * s), at=(1.5 * s * math.cos(a), 0, 0.9 * s * math.sin(a)), rot=(0, -a / D2R, 0), bevel=0, obj=o) if abs(math.sin(a)) > 0.3 else None
        m.tube('metal_dark', [(0.5 * s, h / 2, 0.2 * s), (0.5 * s, h / 2 + 0.6 * s, 0.3 * s), (1.4 * s, h / 2 + 0.7 * s, 0.2 * s), (1.5 * s, h / 2 - 0.2 * s, 0.6 * s)], 0.11 * s, seg=8, bend=0.3, obj=o)
        m.tube('metal_dark', [(-0.5 * s, h / 2, 0.2 * s), (-0.5 * s, h / 2 + 0.6 * s, 0.3 * s), (-1.4 * s, h / 2 + 0.7 * s, 0.2 * s), (-1.5 * s, h / 2 - 0.2 * s, 0.6 * s)], 0.11 * s, seg=8, bend=0.3, obj=o)
        for x in (-0.8, 0.0, 0.8):
            m.revolve('light_head', [(0, 0.02), (0.1 * s, 0.015), (0.12 * s, 0), (0, 0)], at=(x * s, h / 2 - 0.05, -0.86 * s), axis='-z', seg=10, obj=o) if False else None
        for x in (-1.0, 0.0, 1.0):                                          # gauges
            m.revolve('light_head', [(0, 0.03), (0.16 * s, 0.02), (0.16 * s, 0), (0, 0)], at=(x * s, -h / 2 + 0.55 * s, -0.86 * s), axis='-z', seg=12, obj=o)
            m.revolve('metal_dark', [(0.2 * s, 0.0), (0.2 * s, 0.04), (0.15 * s, 0.05), (0.15 * s, 0.0)], at=(x * s, -h / 2 + 0.55 * s, -0.86 * s), axis='-z', seg=12, obj=o)
    m.use('body')
    m.sock('weak_engine', at, size=0.6)
