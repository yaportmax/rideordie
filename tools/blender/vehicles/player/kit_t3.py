"""kit_t3 - Bruiser: armor plates (doors / windshield slit / roof), spiked armored grille, ram bumper, rebar + chain-link gunner cage with shield,
exhaust stacks, hazard stripes."""
import math
from mathutils import Vector
from vlib import *  # noqa
from parts import *  # noqa
from kit_common import *  # noqa
from kit_common import _clip_poly


def _hazard_h(pt, x0, x1, f0, f1, z, n, off=0.007, m='paint2'):
    """hazard bars on a horizontal plane z (u=x, v=f)"""
    w = (x1 - x0) / n
    sl = (f1 - f0) * 0.6
    for i in range(n):
        if i % 2:
            continue
        xa = x0 + i * w
        poly = _clip_poly([(xa, f0), (xa + w, f0), (xa + w + sl, f1), (xa + sl, f1)], x0, x1)
        if len(poly) >= 3:
            pt.plate(m, poly, lambda u, v: (u, v, z + off), out=(0, 0, 1), thick=0.006, bev=0.0)


def kit(T):
    C, b, k = T.C, T.b, T.k
    zb = C.z_bed
    hwi = C.bed_hw - C.bed_wall_t
    fn_ = C.f_nose
    ws = T.ws

    # ================================================================== DOOR ARMOR PLATES (detachable) with window slits
    z_low, z_hi = C.z_db + 0.01, C.z_roof - 0.10
    f_r, f_f = C.f_dr - 0.03, C.f_df - 0.03
    fwt = ws['ft'] + 0.05
    for sg in (1, -1):
        nm = 'panel_armor_' + ('L' if sg > 0 else 'R')
        pt = T.part(nm, (sg * C.door_hw, C.f_df, (z_low + z_hi) / 2))
        xp = C.door_hw + 0.042
        poly = [(f_r + 0.08, z_low), (f_f - 0.08, z_low), (f_f, z_low + 0.08), (f_f, C.z_belt + 0.06), (fwt + 0.02, z_hi), (f_r + 0.06, z_hi), (f_r, z_hi - 0.06), (f_r, z_low + 0.08)]
        slit = rrect_poly(-0.30, 1.37, 0.70, 1.53, 0.035, 3)
        fr = lambda u, v, sg=sg, xp=xp: (sg * xp, u, v)
        pt.shell('armor', poly, fr, out=(sg, 0, 0), thick=0.032, dens=0.13, holes=[slit], bev=0.007, m2='metal_dark', seed=3 + sg)
        # slit frame (thick lips) + inner lip so it reads as armored glass
        lip = [(f, z) for (f, z) in slit]
        pt.sweep('armor', [(sg * (xp + 0.012), f, z) for (f, z) in lip], rrect_prof(0.028, 0.02, 0.005, 1), closed=True, up=(sg, 0, 0))
        # panel seams / stiffeners
        for zs_, wsm in ((1.02, 0.008), (1.24, 0.008)):
            pt.box('metal_dark', (sg * (xp + 0.002), (f_r + f_f) / 2, zs_), (0.004, f_f - f_r - 0.05, wsm), bev=0.0)
            weld_seam(pt, (sg * (xp + 0.006), f_r + 0.08, zs_ + 0.012), (sg * (xp + 0.006), f_f - 0.08, zs_ + 0.012), r=0.0055)
        for fb_ in (-0.22, 0.30, 0.82):
            pt.box('armor', (sg * (xp + 0.02), fb_, (z_low + 1.30) / 2 + 0.02), (0.04, 0.05, 1.30 - z_low - 0.06), bev=0.006)
        pt.box('armor', (sg * (xp + 0.02), 0.20, 1.61 + 0.04), (0.04, 1.0, 0.04), bev=0.006)
        # rivets along the outline
        pts = edge_points([(f + (0.03 if f < 0.2 else -0.03), z + (0.03 if z < 1.2 else -0.03)) for f, z in poly], lambda u, v: (sg * (xp + 0.02), u, v), 0.20)
        rivets(pt, pts, 0.011, axis='x')
        # hazard band low on the plate
        hazard_stripes_x(pt, f_r + 0.05, f_f - 0.05, z_low + 0.03, z_low + 0.20, sg * xp, 9, facing=sg)
        # handle recess + mirror
        pt.box('metal_dark', (sg * (xp + 0.004), f_r + 0.24, C.z_belt - 0.10), (0.01, 0.20, 0.06), bev=0.0)
        pt.box('chrome', (sg * (xp + 0.012), f_r + 0.24, C.z_belt - 0.10), (0.014, 0.15, 0.024), bev=0.004)
        mirror(pt, (sg * (xp + 0.01), f_f - 0.10, C.z_belt + 0.18), sg, arm=0.17, size=(0.035, 0.11, 0.15), m='armor')

    # ================================================================== WINDSHIELD ARMOR (slit visor, detachable)
    pw = T.part('panel_armor_windshield', (0, ws['fb'], ws['zb']))
    hw0, slope = ws['hw0'], ws['slope']
    poly = rrect_poly(-hw0 + 0.03, 0.03, hw0 - 0.03, slope - 0.01, 0.03, 2)
    s_lo = slope * 0.40
    slit = rrect_poly(-hw0 + 0.16, s_lo, hw0 - 0.16, s_lo + 0.15, 0.03, 3)
    off = 0.045
    pw.shell('armor', poly, lambda u, s: T.wpos(u, s, off), out=(0, 0.5, 0.9), thick=0.03, dens=0.15, holes=[slit], bev=0.006, m2='metal_dark', seed=5)
    pw.sweep('armor', [T.wpos(u, s, off + 0.012) for (u, s) in slit], rrect_prof(0.028, 0.02, 0.005, 1), closed=True, up=(0, 0.4, 1))
    for u in (-0.55, 0.0, 0.55):
        p0, p1 = T.wpos(u, 0.06, off + 0.02), T.wpos(u, s_lo - 0.02, off + 0.02)
        pw.sweep('armor', [p0, p1], rrect_prof(0.045, 0.03, 0.005, 1), up=(0, 0.4, 1))
        p0, p1 = T.wpos(u, s_lo + 0.17, off + 0.02), T.wpos(u, slope - 0.05, off + 0.02)
        pw.sweep('armor', [p0, p1], rrect_prof(0.045, 0.03, 0.005, 1), up=(0, 0.4, 1))
    rp_ = [T.wpos(u, s, off + 0.03) for (u, s) in edge_points([(p[0] * 0.94, p[1] + (0.03 if p[1] < 0.3 else -0.03)) for p in poly], lambda u, v: (u, v), 0.22)]
    for p in rp_:
        pw.cyl('metal_bare', p, 0.011, 0.01, axis=(0, 0.4, 1), n=5)

    # ================================================================== ROOF ARMOR PLATE (detachable)
    pr = T.part('panel_armor_roof', (0, (ws['ft'] + C.f_back) / 2, C.z_roof))
    xr = C.cab_hw - 0.06
    f0, f1 = C.f_back + 0.03, ws['ft'] + 0.01
    poly = rrect_poly(-xr, f0, xr, f1, 0.05, 2, r_tl=0.10, r_tr=0.10)
    pr.shell('armor', poly, lambda u, v: (u, v, T.roof_z(u, v) + 0.048), out=(0, 0, 1), thick=0.03, dens=0.16, bev=0.007, m2='metal_dark', seed=9)
    for sx in (-0.42, 0.0, 0.42):
        zz = T.roof_z(sx, (f0 + f1) / 2)
        pr.box('armor', (sx, (f0 + f1) / 2, zz + 0.07), (0.05, f1 - f0 - 0.16, 0.035), bev=0.006)
    pr.box('armor', (0, (f0 + f1) / 2 + 0.15, T.roof_z(0, 0.1) + 0.07), (2 * xr - 0.16, 0.05, 0.035), bev=0.006)
    _hazard_h(pr, -xr + 0.05, xr - 0.05, f1 - 0.20, f1 - 0.03, T.roof_z(0, f1) + 0.048 - 0.03 + 0.0 + 0.03, 12)
    rivets(pr, [(x, f, T.roof_z(x, f) + 0.062) for x in (-xr + 0.06, xr - 0.06) for f in [f0 + 0.08 + i * (f1 - f0 - 0.16) / 7 for i in range(8)]], 0.011, axis='z')
    for sx in (-0.55, 0.55):
        spotlight(pr, (sx, f1 - 0.02, T.roof_z(sx, f1) + 0.12), 0.055)

    # ================================================================== SPIKED ARMORED GRILLE + headlamp cages (fixed to the body)
    fg = C.f_grille
    hx = C.hood_hw - 0.03
    zl = C.z_hood_f - 0.19 * k
    gwh = (hx - 0.25 * k) * 0.98
    gh = 0.30 * k
    ztg, zbg = zl - 0.02 + gh / 2 + 0.05, zl - 0.02 - gh / 2 - 0.05
    for zz in [zbg + i * (ztg - zbg) / 4 for i in range(5)]:
        b.box('armor', (0, fg + 0.075, zz), (2 * gwh + 0.16, 0.05, 0.05), bev=0.008)
    for sg in (1, -1):
        b.box('armor', (sg * (gwh + 0.06), fg + 0.075, (ztg + zbg) / 2), (0.06, 0.05, ztg - zbg + 0.05), bev=0.008)
    b.box('armor', (0, fg + 0.075, (ztg + zbg) / 2), (0.06, 0.05, ztg - zbg), bev=0.008)
    for i, zz in enumerate([zbg + j * (ztg - zbg) / 4 for j in range(5)]):
        nsp = 7 if i in (0, 4) else 6
        for j in range(nsp):
            xx = -gwh + 0.02 + j * (2 * gwh - 0.04) / (nsp - 1)
            spike(b, (xx, fg + 0.10, zz), (xx, fg + 0.10 + (0.16 if i in (0, 4) else 0.11), zz + (0.02 if i == 4 else 0)), 0.016)
    # headlamp cages + brow visor
    for sg in (1, -1):
        lx = sg * (hx - 0.10 * k)
        for j in range(5):
            xx = lx - 0.11 * k + j * 0.055 * k
            b.tube('armor', [(xx, fg + 0.05, zl - 0.15 * k), (xx, fg + 0.12, zl - 0.06 * k), (xx, fg + 0.12, zl + 0.06 * k), (xx, fg + 0.05, zl + 0.15 * k)], 0.010, n=5, rad=0.03, k=2)
        b.box('armor', (lx, fg + 0.12, zl + 0.16 * k), (0.30 * k, 0.05, 0.03), bev=0.006)
        b.box('armor', (lx, fg + 0.12, zl - 0.16 * k), (0.30 * k, 0.05, 0.03), bev=0.006)
    b.box('armor', (0, fg + 0.09, zl + 0.30 * k), (2 * (C.hood_hw - 0.02), 0.20, 0.03), bev=0.008, rot=(-14, 0, 0))
    for j in range(9):
        xx = -0.62 + j * 0.155
        spike(b, (xx, fg + 0.185, zl + 0.30 * k - 0.05), (xx, fg + 0.30, zl + 0.30 * k - 0.11), 0.017)

    # ================================================================== RAM BUMPER (panel_bumper_F)
    bp = T.parts['panel_bumper_F']
    hw0_ = C.fender_hw - 0.01
    z0, z1 = C.rail_z - 0.06, C.rail_z + 0.36
    fb_, ft_ = fn_ + 0.22, fn_ + 0.08          # bottom / top forward position of the ram face

    def ramf(u, v):
        t = (v - z0) / (z1 - z0)
        return (u, fb_ + (ft_ - fb_) * t, v)
    poly = [(-hw0_ + 0.16, z0), (hw0_ - 0.16, z0), (hw0_, z0 + 0.16), (hw0_, z1 - 0.10), (hw0_ - 0.10, z1), (-hw0_ + 0.10, z1), (-hw0_, z1 - 0.10), (-hw0_, z0 + 0.16)]
    bp.shell('armor', poly, ramf, out=(0, 1, 0.2), thick=0.05, dens=0.13, bev=0.009, m2='metal_dark', seed=13)
    ang = math.degrees(math.atan2(fb_ - ft_, z1 - z0))
    for i in range(7):
        x = -0.90 + i * 0.30
        bp.box('armor', (x, (fb_ + ft_) / 2 + 0.024, (z0 + z1) / 2), (0.07, 0.03, z1 - z0 - 0.10), bev=0.007, rot=(ang, 0, 0))
    for zz in (z0 + 0.10, z1 - 0.10):
        bp.box('metal_dark', (0, fb_ + (ft_ - fb_) * (zz - z0) / (z1 - z0) + 0.006, zz), (2 * hw0_ - 0.4, 0.012, 0.02), bev=0.0, rot=(ang, 0, 0))
    # top cap + hazard, wings, skid plate
    capz = z1 + 0.004
    bp.shell('armor', [(-hw0_ + 0.08, ft_ + 0.02), (hw0_ - 0.08, ft_ + 0.02), (hw0_ - 0.02, ft_ - 0.05), (hw0_ - 0.02, fn_ - 0.30), (-hw0_ + 0.02, fn_ - 0.30), (-hw0_ + 0.02, ft_ - 0.05)],
             lambda u, v: (u, v, capz + 0.0), out=(0, 0, 1), thick=0.03, dens=0.16, bev=0.006, m2='metal_dark', seed=14)
    _hazard_h(bp, -hw0_ + 0.06, hw0_ - 0.06, ft_ - 0.16, ft_ + 0.0, capz, 14)
    for sg in (1, -1):
        wing = [(fb_ - 0.02, z0 + 0.10), (fn_ - 0.32, z0 + 0.02), (fn_ - 0.32, z1), (ft_ + 0.0, z1)]
        bp.plate('armor', wing, lambda u, v, sg=sg: (sg * (hw0_ - 0.01), u, v), out=(sg, 0, 0), thick=0.03, bev=0.005)
        # tusk spikes
        spike(bp, (sg * (hw0_ - 0.12), fn_ + 0.12, z1 - 0.06), (sg * (hw0_ + 0.10), fn_ + 0.46, z1 + 0.06), 0.045)
        bp.torus('metal_bare', (sg * 0.55, fb_ - 0.01, z0 + 0.12), 0.05, 0.011, axis='f', nR=12, nr=5)
    bp.shell('armor', [(-hw0_ + 0.20, 0.0), (hw0_ - 0.20, 0.0), (hw0_ - 0.06, 0.12), (-hw0_ + 0.06, 0.12)],
             lambda u, v: (u, fb_ - 0.02 - 0.16 * (v / 0.12) * 0.7, z0 + 0.02 - 0.12 * v / 0.12), out=(0, 1, -0.5), thick=0.03, dens=0.16, bev=0.005, seed=15)
    pts = edge_points([(p[0] * 0.95, p[1] + (0.035 if p[1] < (z0 + z1) / 2 else -0.035)) for p in poly], lambda u, v: (u, ramf(u, v)[1] + 0.03, v), 0.18)
    rivets(bp, pts, 0.012, axis='f')
    # small spikes along the top edge
    for j in range(9):
        xx = -0.72 + j * 0.18
        spike(bp, (xx, ft_ + 0.02, z1 - 0.02), (xx, ft_ + 0.16, z1 + 0.09), 0.02)

    # ================================================================== SIDE SKIRTS
    for sg in (1, -1):
        zs_ = C.z_sill - 0.03
        b.box('armor', (sg * (C.door_hw + 0.075), (C.f_df + C.f_dr) / 2 - 0.02, zs_ + 0.09), (0.05, C.f_df - C.f_dr + 0.15, 0.20), bev=0.008)
        hazard_stripes_x(b, C.f_dr - 0.04, C.f_df + 0.02, zs_ + 0.02, zs_ + 0.17, sg * (C.door_hw + 0.10), 12, facing=sg)
        rivets(b, [(sg * (C.door_hw + 0.104), C.f_dr - 0.02 + i * 0.26, zs_ + 0.09) for i in range(7)], 0.011, axis='x')

    # ================================================================== GUNNER CAGE: twisted rebar posts + chain link + sloped shield
    zr = zb + 1.05
    xr_ = hwi - 0.07
    f_front = C.f_bf - 0.23
    f_rear = C.f_tail + 0.09
    f_mid = (f_front + f_rear) / 2
    T.gunner_f = f_mid + 0.02
    for sg in (1, -1):
        for pf in (f_front, f_mid, f_rear):
            path = [(sg * xr_, pf, zb + i * (zr - zb) / 10) for i in range(11)]
            twisted_bar(b, path, r=0.02, m='metal_dark', twist=70)
            base_plate(b, sg * xr_, pf, zb, 0.13)
            gusset(b, sg * (xr_ - 0.01), pf + 0.0, zb + 0.012, 0.09, 0.14, 'f')
        b.tube('metal_dark', [(sg * xr_, f_front, zr), (sg * xr_, f_rear, zr)], 0.024, n=8)
        b.tube('metal_dark', [(sg * xr_, f_front, zb + 0.48), (sg * xr_, f_rear, zb + 0.48)], 0.018, n=8)
        chainlink(b, sg * xr_, f_front + 0.03, f_mid - 0.03, zb + 0.52, zr - 0.04, 0.115)
        chainlink(b, sg * xr_, f_mid + 0.03, f_rear - 0.03, zb + 0.52, zr - 0.04, 0.115)
    b.tube('metal_dark', [(xr_, f_rear, zr), (-xr_, f_rear, zr)], 0.024, n=8)
    b.tube('metal_dark', [(xr_, f_rear, zb + 0.48), (-xr_, f_rear, zb + 0.48)], 0.018, n=8)
    chainlink(b, f_rear, -xr_ + 0.03, -0.03, zb + 0.52, zr - 0.04, 0.115, side=False)
    chainlink(b, f_rear, 0.03, xr_ - 0.03, zb + 0.52, zr - 0.04, 0.115, side=False)
    b.tube('metal_dark', [(0.0, f_rear, zb), (0.0, f_rear, zr)], 0.018, n=8)
    # sloped front shield with a gun notch
    zs0, zs1 = zb + 0.32, zb + 1.16
    sh = [(-xr_ + 0.02, zs0), (xr_ - 0.02, zs0), (xr_ - 0.02, zs1 - 0.06), (xr_ - 0.10, zs1), (0.30, zs1), (0.24, zs1 - 0.16), (-0.24, zs1 - 0.16), (-0.30, zs1), (-xr_ + 0.10, zs1), (-xr_ + 0.02, zs1 - 0.06)]

    def shf(u, v):
        t = (v - zs0) / (zs1 - zs0)
        return (u, f_front + 0.05 - 0.11 * t, v)
    b.shell('armor', sh, shf, out=(0, 1, 0.2), thick=0.03, dens=0.14, bev=0.007, m2='metal_dark', seed=21)
    for sx in (-0.45, 0.45):
        b.box('armor', (sx, f_front + 0.05 - 0.11 * 0.4 + 0.02, (zs0 + zs1) / 2 - 0.1), (0.055, 0.03, zs1 - zs0 - 0.30), bev=0.006, rot=(math.degrees(math.atan2(0.11, zs1 - zs0)), 0, 0))
    b.box('armor', (0, f_front + 0.05 - 0.11 * 0.2 + 0.02, zs0 + 0.16), (2 * xr_ - 0.1, 0.03, 0.05), bev=0.006, rot=(math.degrees(math.atan2(0.11, zs1 - zs0)), 0, 0))
    rivets(b, [(x, f_front + 0.05 - 0.11 * ((z - zs0) / (zs1 - zs0)) + 0.025, z) for x in (-0.8, -0.55, 0.55, 0.8) for z in (zs0 + 0.06, zs0 + 0.30, zs0 + 0.55)], 0.012, axis='f')
    _hz = [(-xr_ + 0.04 + i * 0.25, zs0 + 0.02) for i in range(0)]
    hazard_stripes(b, -xr_ + 0.03, xr_ - 0.03, zs0 + 0.01, zs0 + 0.13, f_front + 0.05 - 0.11 * 0.08 + 0.03, 12, facing=1)
    socket('gun_mount', (0, f_front - 0.10, zr + 0.02))

    # ================================================================== EXHAUST STACKS (behind the cab, outside the bed)
    zt = 2.32
    tips = []
    for sg in (1, -1):
        x = sg * (C.bed_hw + 0.06)
        fs = C.f_bf - 0.10
        path = [(sg * 0.30, C.fa - 0.55, C.rail_z - 0.03), (sg * 0.34, C.f_bf + 0.55, C.rail_z - 0.05), (sg * 0.70, C.f_bf + 0.25, C.rail_z - 0.06), (x, fs, C.rail_z - 0.02), (x, fs, zt - 0.10)]
        b.tube('metal_dark', path, 0.055, n=12, rad=0.22, k=5)
        # chrome heat shield sleeve + clamps
        b.tube('metal_bare', [(x, fs, 1.05), (x, fs, 1.95)], 0.064, n=14)
        for zc_ in (1.10, 1.40, 1.70, 1.92):
            b.torus('metal_dark', (x, fs, zc_), 0.066, 0.0085, axis='z', nR=14, nr=4)
        for zc_ in (0.95, 1.40, 1.85):
            b.box('metal_dark', (sg * (C.bed_hw + 0.0), fs, zc_), (0.13, 0.06, 0.05), bev=0.0)
        # cut top with rain cap
        b.cyl('metal_dark', (x, fs, zt - 0.03), 0.058, 0.12, axis='z', n=12, bev=0.004)
        b.cyl('rust', (x, fs, zt + 0.031), 0.052, 0.006, axis='z', n=12)
        b.cyl('metal_dark', (x, fs - 0.05, zt + 0.06), 0.008, 0.06, axis='z', n=5)
        b.box('metal_dark', (x, fs - 0.05, zt + 0.09), (0.09, 0.09, 0.008), bev=0.0, rot=(-12, 0, 0))
        tips.append((x, fs, zt + 0.04))
    T.exh_tip = tips[1]
