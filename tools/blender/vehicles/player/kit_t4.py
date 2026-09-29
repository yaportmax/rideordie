"""kit_t4 - Juggernaut: supercharger, spiked plow ram, spiked skirts, roof turret ring, armored gunner nest + shield, dual chrome stacks,
flame decals, nitro bottles, light bars."""
import math
from mathutils import Vector
from vlib import *  # noqa
from parts import *  # noqa
from kit_common import *  # noqa
from kit_common import _clip_poly
from truck_body import surf_normal


def _decal(pt, poly, fn, out, mat='paint2', lift=0.007, thick=0.005, dens=0.055):
    def fn2(u, v):
        p = Vector(fn(u, v))
        return tuple(p + surf_normal(fn, u, v, out) * lift)
    pt.shell(mat, poly, fn2, out, thick=thick, dens=dens, bev=0.0, edge_dens=0.04)


def flame(p0, ang, length, width, curl, phase=0.0, n=14):
    """Flame tongue polygon in a panel's (u,v) domain: base at p0, heading `ang` deg, curling by `curl` deg over its length."""
    cl, wd = [], []
    x, y = p0
    step = length / n
    for i in range(n + 1):
        t = i / n
        a = math.radians(ang + curl * t * t)
        cl.append((x, y, a))
        w = width * (1 - t) ** 0.85 * (0.78 + 0.22 * math.cos(4.2 * math.pi * t + phase)) * (1 - 0.15 * t)
        wd.append(w)
        x += math.cos(a) * step
        y += math.sin(a) * step
    L, R = [], []
    for (x, y, a), w in zip(cl, wd):
        nx, ny = -math.sin(a), math.cos(a)
        L.append((x + nx * w, y + ny * w))
        R.append((x - nx * w, y - ny * w))
    poly = L + R[::-1][1:]
    return poly


def kit(T):
    C, b, k = T.C, T.b, T.k
    zb = C.z_bed
    hwi = C.bed_hw - C.bed_wall_t
    fn_ = C.f_nose
    ws = T.ws
    # gloss paint + hot orange accents
    tweak_mat('paint', clearcoat=0.12, rough=0.46)
    tweak_mat('paint2', clearcoat=0.08, rough=0.5)

    # ================================================================== SUPERCHARGER through the hood
    fe = C.fa - 0.02 * k
    zh = T.hood_zs(0, 1.9)
    b.box('metal_dark', (0, 1.90, 1.115), (0.70, 0.92, 0.035), bev=0.0)
    b.box('chrome', (0, 1.90, 1.29), (0.50, 0.66, 0.30), bev=0.035, seg=2)
    b.cyl('chrome', (0, 1.90, 1.45), 0.165, 0.68, axis='f', n=20, bev=0.01)
    for sx in (-0.19, 0.19):
        b.cyl('chrome', (sx, 1.90, 1.32), 0.055, 0.74, axis='f', n=12)
    for i in range(7):
        b.box('metal_bare', (0, 1.58 + i * 0.105, 1.33), (0.53, 0.014, 0.22), bev=0.0)
    for sx in (-0.11, 0.11):
        for j in range(4):
            fs_ = 1.70 + j * 0.13
            b.cyl('chrome', (sx, fs_, 1.63), 0.030, 0.10, axis='z', n=8, bev=0.004)
            b.cyl('metal_dark', (sx, fs_, 1.69), 0.024, 0.02, axis='z', n=8)
    # intake scoop
    b.box('chrome', (0, 2.00, 1.69), (0.36, 0.46, 0.17), bev=0.02, rot=(6, 0, 0), taper=(0.94, 0.9))
    b.box('metal_dark', (0, 2.235, 1.66), (0.30, 0.02, 0.12), bev=0.0)
    for i in range(4):
        b.box('chrome', (-0.12 + i * 0.08, 2.24, 1.66), (0.008, 0.02, 0.12), bev=0.0)
    # belt drive on the nose of the blower
    b.cyl('chrome', (0, 2.27, 1.36), 0.15, 0.05, axis='f', n=20, bev=0.006)
    b.cyl('metal_dark', (0, 2.30, 1.36), 0.055, 0.03, axis='f', n=12)
    b.cyl('metal_dark', (0, 2.40, 0.92), 0.12, 0.05, axis='f', n=16)
    for sx in (-0.145, 0.145):
        b.cyl2('rubber', (sx, 2.335, 1.36), (sx * 0.8, 2.435, 0.92), 0.012, n=5)
    b.torus('rubber', (0, 2.27, 1.36), 0.152, 0.011, axis='f', nR=20, nr=5)
    # trim ring around the hood opening
    cut = C.hood_cutout
    ring = []
    for (u, v) in rrect_poly(cut[0] - 0.015, cut[1] - 0.015, cut[2] + 0.015, cut[3] + 0.015, 0.03, 3):
        ring.append((u, v, T.hood_zs(u, v) + 0.006))
    T.parts['panel_hood'].sweep('chrome', ring, rrect_prof(0.028, 0.014, 0.004, 1), closed=True, up=(0, 0, 1))
    # tuned engine dressing (valve covers, wiring, coil packs)
    for sg in (1, -1):
        b.box('paint2', (sg * 0.16 * k, fe + 0.02, 1.02), (0.13, 0.62, 0.05), bev=0.008)

    # ================================================================== SPIKED PLOW RAM (panel_bumper_F)
    bp = T.parts['panel_bumper_F']
    zbot, htop = 0.36, 0.52
    fp0 = fn_ + 0.36

    def plow(sg):
        def fnp(u, v):
            return (sg * u, fp0 - 0.55 * (u / 1.22) - 0.30 * (v / htop), zbot + v)
        return fnp
    for sg in (1, -1):
        fnp = plow(sg)
        poly = [(0.0, 0.0), (1.16, 0.0), (1.225, 0.06), (1.225, htop - 0.06), (1.17, htop), (0.0, htop)]
        bp.shell('armor', poly, fnp, out=(sg * 0.5, 1, 0.5), thick=0.04, dens=0.13, bev=0.008, m2='metal_dark', seed=31 + sg)
        for i in range(1, 6):
            u = 0.22 * i
            p0 = fnp(u, 0.03)
            p1 = fnp(u, htop - 0.03)
            bp.sweep('armor', [(p0[0], p0[1] + 0.028, p0[2]), (p1[0], p1[1] + 0.028, p1[2])], rrect_prof(0.055, 0.03, 0.006, 1), up=(0, 1, 0))
        # top beam + bottom scraper blade
        top = [fnp(u, htop) for u in (0.0, 0.6, 1.22)]
        bp.sweep('armor', [(p[0], p[1] + 0.02, p[2] + 0.02) for p in top], rrect_prof(0.10, 0.08, 0.012, 1), up=(0, 0, 1))
        bot = [fnp(u, 0.0) for u in (0.0, 0.6, 1.22)]
        bp.sweep('metal_bare', [(p[0], p[1] + 0.02, p[2] + 0.005) for p in bot], rrect_prof(0.06, 0.04, 0.008, 1), up=(0, 0, 1))
        # spikes along the top edge
        for i in range(9):
            u = 0.10 + i * 0.135
            p = fnp(u, htop)
            spike(bp, (p[0], p[1] + 0.05, p[2] + 0.04), (p[0], p[1] + 0.30, p[2] + 0.13), 0.03)
        # tusk
        p = fnp(1.14, htop - 0.08)
        spike(bp, (p[0], p[1] + 0.03, p[2]), (p[0] + sg * 0.22, p[1] + 0.46, p[2] + 0.14), 0.065)
        # rivets
        pts = edge_points([(u * 0.97, v + (0.04 if v < htop / 2 else -0.04)) for (u, v) in poly], lambda u, v, fnp=fnp: (lambda q: (q[0], q[1] + 0.026, q[2]))(fnp(u, v)), 0.2)
        rivets(bp, pts, 0.014, axis='f')
        # hydraulic rams
        bp.cyl2('metal_dark', (sg * 0.55, fn_ - 0.60, C.rail_z + 0.10), (sg * 0.55, fn_ - 0.05, 0.62), 0.05, n=10)
        bp.cyl2('chrome', (sg * 0.55, fn_ - 0.05, 0.62), (sg * 0.55, fn_ + 0.14, 0.75), 0.028, n=10)
        bp.box('metal_dark', (sg * 0.55, fn_ + 0.14, 0.76), (0.10, 0.08, 0.08), bev=0.006)
    # centre spine
    c0, c1 = plow(1)(0.0, 0.0), plow(1)(0.0, htop)
    bp.sweep('armor', [(0, c0[1] + 0.04, c0[2]), (0, c1[1] + 0.04, c1[2])], rrect_prof(0.10, 0.05, 0.01, 1), up=(1, 0, 0))
    bp.cyl2('metal_bare', (0, c0[1] + 0.06, c0[2] + 0.02), (0, c0[1] + 0.06 + 0.10, c0[2] + 0.02), 0.03, r2=0.006, n=6)
    for sg in (1, -1):
        bp.torus('metal_bare', (sg * 0.30, fn_ + 0.13, 0.60), 0.045, 0.011, axis='f', nR=12, nr=5)

    # ================================================================== SPIKED SIDE SKIRTS (detachable)
    for sg in (1, -1):
        nm = 'panel_armor_skirt_' + ('L' if sg > 0 else 'R')
        fm = (C.f_df + C.f_dr) / 2
        sk = T.part(nm, (sg * (C.door_hw + 0.11), fm, C.z_sill + 0.02))
        xs_ = sg * (C.door_hw + 0.11)
        ln = C.f_df - C.f_dr + 0.34
        sk.box('armor', (xs_, fm, C.z_sill + 0.10), (0.07, ln, 0.26), bev=0.012, seg=2)
        sk.box('armor', (xs_ - sg * 0.04, fm, C.z_sill + 0.235), (0.16, ln, 0.03), bev=0.006)
        for i in range(9):
            f = C.f_dr - 0.10 + i * (ln - 0.2) / 8
            spike(sk, (xs_ + sg * 0.035, f, C.z_sill + 0.06), (xs_ + sg * 0.20, f, C.z_sill - 0.05), 0.032)
            sk.cyl('metal_bare', (xs_ + sg * 0.037, f, C.z_sill + 0.19), 0.013, 0.008, axis='x', n=6)
        for i in range(4):
            sk.tube('metal_dark', [(xs_ - sg * 0.02, C.f_dr + 0.1 + i * 0.5, C.z_sill + 0.05), (sg * (C.rail_x + 0.05), C.f_dr + 0.1 + i * 0.5, C.rail_z + 0.05)], 0.02, n=6)

    # ================================================================== ROOF TURRET RING + light bar
    fc = (ws['ft'] + C.f_back) / 2 + 0.02
    zr0 = C.z_roof
    zR = zr0 + 0.30
    RR = 0.46
    pr = T.b
    pr.torus('armor', (0, fc, zR), RR, 0.034, axis='z', nR=32, nr=8)
    pr.torus('metal_bare', (0, fc, zR + 0.045), RR, 0.010, axis='z', nR=32, nr=5)
    for a in (45, 135, 225, 315):
        x, f = RR * 0.98 * math.cos(math.radians(a)), fc + RR * 0.98 * math.sin(math.radians(a))
        pr.tube('armor', [(x, f, zr0 + 0.01), (x * 0.98, f, zR - 0.02)], 0.036, n=8)
        gusset(pr, x, f, zr0 + 0.02, 0.10, 0.16, 'f')
        base_plate(pr, x, f, zr0 + 0.02, 0.14)
    pr.torus('armor', (0, fc, zr0 + 0.13), RR * 0.93, 0.03, axis='z', nR=28, nr=6)
    for a in (0, 90, 180, 270):
        pr.tube('armor', [(0.0, fc, zr0 + 0.16), (RR * 0.9 * math.cos(math.radians(a)), fc + RR * 0.9 * math.sin(math.radians(a)), zr0 + 0.13)], 0.024, n=6)
    pr.cyl('metal_dark', (0, fc, zr0 + 0.14), 0.085, 0.28, axis='z', n=14, bev=0.005)
    pr.cyl('armor', (0, fc, zR - 0.02), 0.16, 0.05, axis='z', n=20, bev=0.005)
    pr.cyl('metal_bare', (0, fc, zR + 0.03), 0.10, 0.02, axis='z', n=16)
    pr.box('metal_dark', (0, fc, zR + 0.10), (0.16, 0.20, 0.12), bev=0.012)
    pr.cyl('metal_bare', (0, fc + 0.08, zR + 0.13), 0.035, 0.12, axis='x', n=10)
    for i, a in enumerate(range(-68, 69, 17)):
        pass
    arc = [(RR * 1.10 * math.sin(math.radians(a)) * 1.0, fc + RR * 1.10 * math.cos(math.radians(a)), zR + 0.20) for a in range(-58, 59, 12)]
    pr.sweep('armor', arc, [(0.017, 0.17), (-0.017, 0.17), (-0.017, -0.17), (0.017, -0.17)], up=(0, 0, 1))
    pr.sweep('metal_bare', [(p[0], p[1], p[2] + 0.175) for p in arc], [(0.026, 0.008), (-0.026, 0.008), (-0.026, -0.008), (0.026, -0.008)], up=(0, 0, 1))
    for i in range(0, len(arc), 2):
        pr.cyl('metal_bare', (arc[i][0], arc[i][1] + 0.02, arc[i][2] - 0.08), 0.011, 0.01, axis='f', n=5)
        pr.cyl('metal_bare', (arc[i][0], arc[i][1] + 0.02, arc[i][2] + 0.08), 0.011, 0.01, axis='f', n=5)
    pr.box('metal_dark', (0.42, fc - 0.10, zR + 0.12), (0.22, 0.14, 0.16), bev=0.01)
    pr.box('paint2', (0.42, fc - 0.10, zR + 0.205), (0.23, 0.15, 0.012), bev=0.0)
    socket('gun_mount', (0, fc, zR + 0.14))
    light_bar(b, (0, ws['ft'] + 0.03, zr0 + 0.11), 1.5, h=0.085, n=14)
    for sx in (-0.95, 0.95):
        spotlight(b, (sx, ws['ft'] + 0.03, zr0 + 0.10), 0.065)

    # ================================================================== ARMORED GUNNER NEST + shield
    zt0 = C.bed_top - 0.04
    zt1 = zb + 1.02
    f_front = C.f_bf - 0.17
    f_rear = C.f_tail + 0.10
    T.gunner_f = (f_front + f_rear) / 2
    hw_n = hwi - 0.02
    for sg in (1, -1):
        poly = [(f_rear + 0.02, zt0), (f_front - 0.02, zt0), (f_front - 0.10, zt0 + 0.10), (f_front - 0.34, zt1), (f_rear + 0.34, zt1), (f_rear + 0.10, zt0 + 0.10)]
        span = zt1 - zt0

        def fns(u, v, sg=sg):
            return (sg * (hw_n + 0.02 + 0.10 * (v - zt0) / span), u, v)
        b.shell('armor', poly, fns, out=(sg, 0, 0.3), thick=0.032, dens=0.14, bev=0.008, m2='metal_dark', seed=41 + sg)
        top = [(sg * (hw_n + 0.02 + 0.10 + 0.0), f, zt1 + 0.02) for f in (f_front - 0.34, (f_front + f_rear) / 2, f_rear + 0.34)]
        b.tube('leather', top, 0.034, n=8)
        pts = edge_points([(p[0] + (0.035 if p[0] < (f_front + f_rear) / 2 else -0.035), p[1] + (0.04 if p[1] < zt0 + 0.3 else -0.04)) for p in poly], lambda u, v, fns=fns: (lambda q: (q[0] + sg * 0.03, q[1], q[2]))(fns(u, v)), 0.19)
        rivets(b, pts, 0.012, axis='x')
        hazard_stripes_x(b, f_rear + 0.06, f_front - 0.06, zt0 + 0.015, zt0 + 0.17, sg * (hw_n + 0.045), 12, facing=sg)
        b.box('armor', (sg * (hw_n + 0.04), (f_front + f_rear) / 2, zt0 + 0.30), (0.03, f_front - f_rear - 0.5, 0.05), bev=0.006)
    # rear plate
    rp = [(-hw_n + 0.05, zt0), (hw_n - 0.05, zt0), (hw_n - 0.30, zt1), (-hw_n + 0.30, zt1)]
    b.shell('armor', rp, lambda u, v: (u, f_rear - 0.03 - 0.09 * (v - zt0) / span, v), out=(0, -1, 0.2), thick=0.03, dens=0.15, bev=0.008, m2='metal_dark', seed=45)
    b.tube('leather', [(-hw_n + 0.30, f_rear - 0.12, zt1 + 0.02), (hw_n - 0.30, f_rear - 0.12, zt1 + 0.02)], 0.034, n=8)
    hazard_stripes(b, -hw_n + 0.10, hw_n - 0.10, zt0 + 0.015, zt0 + 0.16, f_rear - 0.036, 14, facing=-1)
    # front shield (sloped, gun notch, wings)
    zs0, zs1 = zb + 0.30, zb + 1.30
    xs_ = hw_n - 0.10
    sh = [(-xs_, zs0), (xs_, zs0), (xs_, zs1 - 0.12), (xs_ - 0.14, zs1), (0.32, zs1), (0.26, zs1 - 0.18), (-0.26, zs1 - 0.18), (-0.32, zs1), (-xs_ + 0.14, zs1), (-xs_, zs1 - 0.12)]

    def shf(u, v):
        t = (v - zs0) / (zs1 - zs0)
        return (u, f_front + 0.03 - 0.16 * t, v)
    b.shell('armor', sh, shf, out=(0, 1, 0.3), thick=0.035, dens=0.14, bev=0.009, m2='metal_dark', seed=51)
    sl_ang = math.degrees(math.atan2(0.16, zs1 - zs0))
    for sx in (-0.62, -0.20, 0.20, 0.62):
        b.box('armor', (sx, f_front + 0.03 - 0.16 * 0.42 + 0.028, (zs0 + zs1) / 2 - 0.10), (0.07, 0.035, zs1 - zs0 - 0.45), bev=0.007, rot=(sl_ang, 0, 0))
    b.box('armor', (0, f_front + 0.03 - 0.16 * 0.10 + 0.03, zs0 + 0.10), (2 * xs_ - 0.10, 0.035, 0.07), bev=0.007, rot=(sl_ang, 0, 0))
    rivets(b, [(x, f_front + 0.03 - 0.16 * ((z - zs0) / (zs1 - zs0)) + 0.030, z) for x in (-0.92, -0.72, -0.42, 0.42, 0.72, 0.92) for z in (zs0 + 0.07, zs0 + 0.36, zs0 + 0.66)], 0.013, axis='f')
    hazard_stripes(b, -xs_ + 0.03, xs_ - 0.03, zs0 + 0.09, zs0 + 0.20, f_front + 0.03 - 0.16 * 0.15 + 0.036, 14, facing=1)
    # shield wings
    for sg in (1, -1):
        wing = [(0.0, 0.0), (0.26, 0.10), (0.26, 0.85), (0.0, 0.92)]
        b.plate('armor', wing, lambda u, v, sg=sg: (sg * (xs_ - 0.02 + u * 0.55), f_front + 0.01 - u * 0.75 + 0.0, zs0 + v), out=(sg, 0.5, 0), thick=0.028, bev=0.005)
    # ammo boxes + nitro bottles ahead of the shield
    for sg in (1, -1):
        b.box('metal_dark', (sg * (hw_n - 0.22), f_rear + 0.30, zb + 0.11), (0.34, 0.44, 0.22), bev=0.012)
        b.box('paint2', (sg * (hw_n - 0.22), f_rear + 0.30, zb + 0.225), (0.30, 0.40, 0.012), bev=0.0)
        b.box('chrome', (sg * (hw_n - 0.22), f_rear + 0.30 + 0.225, zb + 0.14), (0.10, 0.012, 0.03), bev=0.004)
    fbt = C.f_bf - 0.10
    for i, x in enumerate((0.58, -0.58)):
        b.cyl('chrome', (x, fbt, zb + 0.11), 0.075, 0.86, axis='x', n=16)
        for sg in (-1, 1):
            b.sph('chrome', (x + sg * 0.43, fbt, zb + 0.11), 0.075, n=10, sc=(0.6, 1, 1))
        b.cyl('paint2', (x, fbt, zb + 0.11), 0.078, 0.14, axis='x', n=16)
        for dx in (-0.28, 0.28):
            b.torus('metal_dark', (x + dx, fbt, zb + 0.11), 0.077, 0.008, axis='x', nR=14, nr=4)
            b.box('metal_dark', (x + dx, fbt, zb + 0.03), (0.05, 0.16, 0.06), bev=0.004)
        b.cyl('metal_bare', (x + (0.36 if x > 0 else -0.36), fbt, zb + 0.20), 0.020, 0.06, axis='z', n=8)
    b.tube('metal_dark', [(0.36, fbt, zb + 0.24), (0.36, fbt - 0.10, zb + 0.34), (0.90, fbt - 0.10, zb + 0.34), (1.0, C.f_bf - 0.4, zb + 0.30)], 0.010, n=5, rad=0.05, k=2)

    # ================================================================== DUAL CHROME EXHAUST STACKS
    zt = 2.66
    tips = []
    for sg in (1, -1):
        for j, (dx, rr, hgt) in enumerate(((0.0, 0.075, zt), (0.17, 0.055, zt - 0.22))):
            x = sg * (C.bed_hw + 0.06 + dx)
            fs = C.f_bf + 0.02
            path = [(sg * (0.30 + dx * 0.4), C.fa - 0.75, C.rail_z - 0.03 + j * 0.10), (sg * (0.36 + dx * 0.4), C.f_bf + 0.6, C.rail_z - 0.05 + j * 0.10),
                    (sg * 0.80, C.f_bf + 0.30, C.rail_z - 0.05 + j * 0.10), (x, fs, C.rail_z + j * 0.10), (x, fs, hgt - 0.10)]
            b.tube('metal_dark', path, rr * 0.9, n=12, rad=0.24, k=5)
            b.tube('chrome', [(x, fs, 1.10), (x, fs, hgt - 0.05)], rr, n=16)
            for zc_ in (1.25, 1.65, 2.05, 2.40):
                b.torus('metal_dark', (x, fs, zc_ + 0.12 * j), rr + 0.006, 0.010, axis='z', nR=16, nr=4)
            b.cyl('chrome', (x, fs, hgt - 0.03), rr * 1.06, 0.14, axis='z', n=16, bev=0.006)
            b.cyl('metal_dark', (x, fs, hgt + 0.035), rr * 0.86, 0.006, axis='z', n=14)
            if j == 0:
                for zc_ in (1.0, 1.7, 2.3):
                    b.box('metal_dark', (sg * (C.bed_hw + 0.0), fs, zc_), (0.20, 0.07, 0.06), bev=0.0)
                tips.append((x, fs, hgt + 0.04))
    T.exh_tip = tips[1]

    # ================================================================== FLAME DECALS (paint2, orange): hood, doors, bed sides
    zs = T.hood_zs
    hood = T.parts['panel_hood']
    hfn = T.fns['hood']
    fr1 = C.f_grille + 0.035
    for sg in (1, -1):
        for i, (u0, ang, ln, wd, cu, ph) in enumerate(((0.40, -84, 0.95, 0.070, 22, 0.3), (0.58, -80, 0.75, 0.055, 30, 1.4), (0.24, -88, 0.55, 0.045, 12, 2.6))):
            poly = flame((sg * u0, fr1 - 0.10 - i * 0.03), ang if sg > 0 else -180 - ang, ln, wd, cu if sg > 0 else -cu, ph)
            _decal(hood, poly, hfn, (0, 0, 1), dens=0.05)
        # doors
        dp = T.parts['panel_door_' + ('L' if sg > 0 else 'R')]
        dfn = T.fns['door%+d' % sg]
        f_f = C.f_df - 0.006
        for i, (v0, ang, ln, wd, cu, ph) in enumerate(((C.z_db + 0.12, 176, 1.35, 0.085, -26, 0.5), (C.z_db + 0.30, 172, 1.10, 0.075, -34, 1.9), (C.z_db + 0.46, 170, 0.80, 0.060, -40, 3.1), (C.z_db + 0.62, 168, 0.55, 0.045, -45, 4.2))):
            poly = flame((f_f - 0.04, v0), ang, ln, wd, cu, ph)
            _decal(dp, poly, dfn, (sg, 0, 0), dens=0.06)
    # nitrous nozzles under the rear bumper
    for sg in (1, -1):
        b.cyl2('chrome', (sg * 0.42, C.f_tail - 0.10, C.rail_z - 0.04), (sg * 0.42, C.f_tail - 0.36, C.rail_z - 0.08), 0.035, r2=0.085, n=14)
        b.cyl('metal_dark', (sg * 0.42, C.f_tail - 0.365, C.rail_z - 0.08), 0.07, 0.01, axis='f', n=12)
