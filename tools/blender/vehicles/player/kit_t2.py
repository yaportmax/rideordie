"""kit_t2 - Hauler: roll bar + light bar, bull bar + winch, roof rack with spare, sandbags/planks, tube gunner frame, dual exhaust."""
import math
from mathutils import Vector
from vlib import *  # noqa
from parts import *  # noqa
from kit_common import *  # noqa


def kit(T):
    C, b, k = T.C, T.b, T.k
    zb = C.z_bed
    hwi = C.bed_hw - C.bed_wall_t
    rp = 0.030            # roll bar tube radius
    fp = 0.024            # frame tube radius

    # ------------------------------------------------------------------ roll bar (behind the cab) + light bar
    fh = C.f_bf - 0.14
    xh = hwi - 0.06
    ztop = 2.42
    zr = zb + 0.95
    b.tube('metal_dark', [(xh, fh, zb), (xh, fh, ztop - 0.10), (xh - 0.10, fh, ztop), (-xh + 0.10, fh, ztop), (-xh, fh, ztop - 0.10), (-xh, fh, zb)], rp, n=10, rad=0.10, k=4)
    b.tube('metal_dark', [(xh, fh, zr), (-xh, fh, zr)], rp * 0.9, n=8)
    b.tube('metal_dark', [(-xh, fh, zr), (xh, fh, ztop - 0.10)], rp * 0.7, n=8)         # diagonal brace
    for sg in (1, -1):
        base_plate(b, sg * xh, fh, zb, 0.16)
        # rear stays down to the bed rails
        b.tube('metal_dark', [(sg * xh, fh, ztop - 0.12), (sg * (hwi + 0.01), fh - 0.95, C.bed_top + 0.02)], rp * 0.85, n=8)
        b.box('metal_dark', (sg * (hwi + 0.01), fh - 0.95, C.bed_top + 0.014), (0.10, 0.10, 0.016), bev=0.0)
        gusset(b, sg * (xh - 0.02), fh + 0.0, zr, 0.10, 0.10, 'f')
        # welds
        weld_seam(b, (sg * xh - 0.03, fh, zr), (sg * xh + 0.03, fh, zr), r=0.007)
    # padded cross bar (leather sleeves)
    b.tube('leather', [(0.62, fh, zr), (-0.62, fh, zr)], rp * 1.35, n=10)
    # LED light bar + two spots
    light_bar(b, (0, fh + 0.05, ztop + 0.075), 1.30, h=0.08, n=12)
    for sx in (-0.78, 0.78):
        spotlight(b, (sx, fh + 0.06, ztop + 0.065), 0.06)
    b.box('metal_dark', (0, fh, ztop + 0.02), (1.30, 0.05, 0.03), bev=0.0)

    # ------------------------------------------------------------------ tube gunner frame (waist high, ties into the roll bar)
    f_rear = C.f_tail + 0.10
    f_mid = (fh + f_rear) / 2
    xf = hwi - 0.05
    for sg in (1, -1):
        b.tube('metal_dark', [(sg * xf, fh, zr), (sg * xf, f_rear + 0.14, zr), (sg * (xf - 0.14), f_rear, zr)], fp, n=8, rad=0.12, k=3)
        b.tube('metal_dark', [(sg * xf, fh, zb + 0.52), (sg * xf, f_rear + 0.14, zb + 0.52), (sg * (xf - 0.14), f_rear, zb + 0.52)], fp * 0.85, n=8, rad=0.12, k=3)
        for pf in (f_mid, f_rear + 0.14):
            b.tube('metal_dark', [(sg * xf, pf, zb), (sg * xf, pf, zr)], fp, n=8)
            base_plate(b, sg * xf, pf, zb, 0.12)
        # padded side rails at the front section
        b.tube('leather', [(sg * xf, fh - 0.05, zr), (sg * xf, fh - 0.55, zr)], fp * 1.4, n=8)
    b.tube('metal_dark', [(xf - 0.14, f_rear, zr), (-xf + 0.14, f_rear, zr)], fp, n=8)
    b.tube('metal_dark', [(xf - 0.14, f_rear, zb + 0.52), (-xf + 0.14, f_rear, zb + 0.52)], fp * 0.85, n=8)
    b.tube('metal_dark', [(xf - 0.14, f_rear, zb), (xf - 0.14, f_rear, zr)], fp, n=8)
    b.tube('metal_dark', [(-xf + 0.14, f_rear, zb), (-xf + 0.14, f_rear, zr)], fp, n=8)
    for sg in (1, -1):
        base_plate(b, sg * (xf - 0.14), f_rear, zb, 0.12)
        weld_seam(b, (sg * (xf - 0.14) - 0.02, f_rear, zr - 0.01), (sg * (xf - 0.14) + 0.02, f_rear, zr - 0.01), r=0.006)
    T.gunner_f = f_mid - 0.02

    # ------------------------------------------------------------------ bull bar + winch
    fn = C.f_nose
    bp = T.parts['panel_bumper_F']
    zbm = C.rail_z + 0.13 * k + 0.10 * k       # bumper top
    r_bb = 0.034
    hoop = [(0.60, fn - 0.02, zbm), (0.64, fn + 0.04, zbm + 0.36), (0.52, fn + 0.09, zbm + 0.60), (0.0, fn + 0.10, zbm + 0.62)]
    path = hoop + mirror_pts(hoop[::-1])[1:]
    b.tube('metal_dark', path, r_bb, n=10, rad=0.16, k=4)
    for sx in (0.26, -0.26):
        b.tube('metal_dark', [(sx, fn - 0.02, zbm), (sx, fn + 0.09, zbm + 0.30), (sx, fn + 0.10, zbm + 0.62)], r_bb * 0.85, n=8, rad=0.10, k=3)
    b.tube('metal_dark', [(0.26, fn + 0.09, zbm + 0.30), (-0.26, fn + 0.09, zbm + 0.30)], r_bb * 0.85, n=8)
    for sg in (1, -1):
        b.tube('metal_dark', [(sg * 0.60, fn - 0.02, zbm - 0.04), (sg * 0.50, fn - 0.55, C.rail_z + 0.12)], r_bb * 0.85, n=8)
        base_plate(b, sg * 0.50, fn - 0.55, C.rail_z + 0.10, 0.12)
        spotlight(b, (sg * 0.38, fn + 0.11, zbm + 0.71), 0.06)
        weld_seam(b, (sg * 0.60 - 0.03, fn - 0.02, zbm), (sg * 0.60 + 0.03, fn - 0.02, zbm), r=0.008)
    # winch on the bumper (moves with it)
    wz = zbm + 0.085
    bp.box('metal_dark', (0, fn - 0.02, zbm + 0.012), (0.62, 0.20, 0.024), bev=0.004)
    bp.cyl('metal_dark', (0.0, fn - 0.02, wz), 0.075, 0.30, axis='x', n=16)
    bp.cyl('metal_bare', (0.0, fn - 0.02, wz), 0.06, 0.24, axis='x', n=14)
    for sx in (-0.15, 0.15):
        bp.cyl('metal_dark', (sx, fn - 0.02, wz), 0.095, 0.02, axis='x', n=16)
    bp.cyl('metal_dark', (0.24, fn - 0.02, wz), 0.06, 0.20, axis='x', n=12, bev=0.004)
    bp.box('metal_dark', (-0.24, fn - 0.02, wz), (0.14, 0.14, 0.14), bev=0.012)
    bp.cyl('chrome', (0.37, fn - 0.02, wz), 0.02, 0.03, axis='x', n=8)
    # fairlead (roller) + cable + hook
    bp.box('metal_dark', (0, fn + 0.10, zbm + 0.09), (0.34, 0.05, 0.10), bev=0.005)
    for sx in (-0.13, 0.13):
        bp.cyl('metal_bare', (sx, fn + 0.125, zbm + 0.09), 0.02, 0.10, axis='z', n=8)
    bp.cyl('metal_bare', (0, fn + 0.125, zbm + 0.09), 0.02, 0.24, axis='x', n=8)
    bp.tube('metal_bare', [(0, fn - 0.02, wz + 0.06), (0, fn + 0.06, zbm + 0.11), (0, fn + 0.13, zbm + 0.05), (0, fn + 0.14, zbm - 0.12)], 0.007, n=6, rad=0.03, k=2)
    bp.tube('chrome', [(0, fn + 0.14, zbm - 0.12), (0.0, fn + 0.14, zbm - 0.18), (0.03, fn + 0.14, zbm - 0.23), (0.05, fn + 0.14, zbm - 0.19)], 0.012, n=6, rad=0.03, k=2)
    # D-ring shackles on the bumper
    for sx in (-0.62, 0.62):
        bp.torus('metal_bare', (sx, fn + 0.02, zbm - 0.10), 0.03, 0.007, axis='f', nR=10, nr=4)
        bp.box('metal_dark', (sx, fn + 0.02, zbm - 0.06), (0.05, 0.03, 0.03), bev=0.0)

    # ------------------------------------------------------------------ roof rack + spare wheel
    zr0 = C.z_roof
    rf0, rf1 = -0.42, 0.50
    rx = 0.66
    for sg in (1, -1):
        b.tube('metal_dark', [(sg * rx, rf0, zr0 + 0.085), (sg * rx, rf1, zr0 + 0.085)], 0.017, n=8)
        for pf in (rf0, 0.05, rf1):
            b.box('metal_dark', (sg * rx, pf, zr0 + 0.04), (0.04, 0.05, 0.085), bev=0.0)
    for i in range(6):
        pf = rf0 + i * (rf1 - rf0) / 5
        b.tube('metal_dark', [(rx, pf, zr0 + 0.085), (-rx, pf, zr0 + 0.085)], 0.014, n=6)
    spare_wheel(T, b, (0.0, 0.05, zr0 + 0.085 + 0.14 + 0.012), rot=(0, 0, 90), seg=36)
    for sf in (-0.16, 0.26):
        strap(b, [(0.36, 0.05 + sf, zr0 + 0.10), (0.36, 0.05 + sf, zr0 + 0.30), (-0.36, 0.05 + sf, zr0 + 0.30), (-0.36, 0.05 + sf, zr0 + 0.10)], m='fabric')
    # roof marker lights (front header)
    for i in range(5):
        mx_ = (i - 2) * 0.16
        b.box('metal_dark', (mx_, T.ws['ft'] + 0.02, C.z_roof - 0.058), (0.095, 0.04, 0.046), bev=0.008)
        b.box('light_amber', (mx_, T.ws['ft'] + 0.045, C.z_roof - 0.06), (0.085, 0.014, 0.038), bev=0.006, seg=2)
        b.box('light_amber', (mx_, T.ws['ft'] + 0.052, C.z_roof - 0.06), (0.06, 0.004, 0.012), bev=0.0015)
    # ------------------------------------------------------------------ bed contents: sandbags + planks + toolbox
    fsb = C.f_bf - 0.16
    for row, (n, z0_, off) in enumerate(((5, zb + 0.075, 0.0), (4, zb + 0.20, 0.5))):
        for i in range(n):
            x = -0.72 + i * 0.36 + off * 0.36 * 0.5 + (0.0 if row == 0 else 0.0)
            if abs(x) > 0.84:
                continue
            sandbag(b, (x, fsb + 0.01 * row, z0_), rot=(0, 3 * ((i * 7) % 5 - 2), 4 * ((i * 3) % 3 - 1)), size=(0.40, 0.24, 0.14))
    # sandbag wall along the left bedside, ahead of the arch
    for i in range(3):
        sandbag(b, (hwi - 0.15, C.f_bf - 0.55 - i * 0.28, zb + 0.075), rot=(0, 90, 0), size=(0.40, 0.24, 0.14))
    # plank bundle on the right, strapped
    for i in range(4):
        b.box('wood', (-hwi + 0.14 + (i % 2) * 0.16, C.f_tail + 1.05, zb + 0.03 + (i // 2) * 0.032 + 0.0), (0.145, 1.6, 0.03), bev=0.004, rot=(0, 1.2 * (i - 1.5), 0))
    for pf in (C.f_tail + 0.5, C.f_tail + 1.5):
        strap(b, [(-hwi + 0.05, pf, zb + 0.005), (-hwi + 0.05, pf, zb + 0.10), (-hwi + 0.36, pf, zb + 0.10), (-hwi + 0.36, pf, zb + 0.005)], w=0.04)
    # toolbox behind the cab on the left
    b.box('metal_dark', (-0.15, fsb - 0.28, zb + 0.13), (0.62, 0.28, 0.26), bev=0.012)
    b.box('metal_bare', (-0.15, fsb - 0.28, zb + 0.263), (0.64, 0.30, 0.012), bev=0.004)
    b.box('chrome', (-0.15, fsb - 0.43, zb + 0.16), (0.10, 0.016, 0.03), bev=0.004)

    # ------------------------------------------------------------------ side step bars + rear mud flaps
    for sg in (1, -1):
        zs_ = C.z_sill - 0.02
        xs_ = C.door_hw + 0.055
        b.tube('metal_dark', [(sg * xs_, C.f_df + 0.05, zs_), (sg * xs_, C.f_dr - 0.15, zs_)], 0.03, n=10)
        for pf in (C.f_df - 0.05, (C.f_df + C.f_dr) / 2, C.f_dr - 0.08):
            b.tube('metal_dark', [(sg * xs_, pf, zs_), (sg * (C.rail_x + 0.05), pf, C.rail_z + 0.02)], 0.016, n=6)
        b.box('metal_dark', (sg * (xs_ - 0.03), (C.f_df + C.f_dr) / 2 - 0.06, zs_ + 0.03), (0.14, C.f_df - C.f_dr - 0.5, 0.012), bev=0.003)
        for i in range(7):
            b.box('metal_bare', (sg * (xs_ - 0.03), C.f_dr + 0.20 + i * 0.16, zs_ + 0.04), (0.11, 0.02, 0.006), bev=0.0)
        b.box('rubber', (sg * (C.bed_hw - 0.10), C.ra - C.arch_R - 0.03, C.z_sill - 0.02), (0.30, 0.014, 0.28), bev=0.003)
    # ------------------------------------------------------------------ dual exhaust (rear-exit, chrome tips)
    zx = C.rail_z - 0.09
    tips = []
    for sg in (1, -1):
        x = sg * 0.30
        path = [(sg * 0.24, C.fa + 0.05, C.rail_z + 0.30), (x, C.fa - 0.10, zx), (x, C.ra + 1.10, zx)]
        b.tube('metal_dark', path, 0.034, n=10, rad=0.12, k=4)
        b.cyl('metal_dark', (x, C.ra + 0.62, zx), 0.085, 0.75, axis='f', n=16, bev=0.008)
        b.cyl('metal_bare', (x, C.ra + 0.62, zx), 0.0865, 0.05, axis='f', n=16)
        tail = [(x, C.ra + 0.24, zx), (x, C.ra - 0.30, zx), (sg * 0.42, C.f_tail + 0.12, zx + 0.06), (sg * 0.42, C.f_tail - 0.10, zx + 0.10)]
        b.tube('metal_dark', tail, 0.030, n=10, rad=0.16, k=4)
        b.cyl('chrome', (sg * 0.42, C.f_tail - 0.11, zx + 0.10), 0.043, 0.09, axis='f', n=14, bev=0.004)
        b.cyl('metal_dark', (sg * 0.42, C.f_tail - 0.155, zx + 0.10), 0.032, 0.01, axis='f', n=12)
        tips.append((sg * 0.42, C.f_tail - 0.16, zx + 0.10))
        for pf in (C.ra + 0.30, C.ra + 0.95):
            b.box('metal_bare', (x, pf, zx + 0.095), (0.03, 0.02, 0.05), bev=0.0)
    T.exh_tip = tips[1]        # right (-x); sockets() mirrors it for the left one
