"""truck_cab - greenhouse, roof, doors, dash, seats, steering."""
import math
import random
from mathutils import Vector
import vlib
from vlib import *  # noqa
from parts import *  # noqa


class CabMixin:
    # ------------------------------------------------------------------------------------------- windshield
    def windshield(self):
        C, b, k = self.C, self.b, self.k
        hw0 = C.cab_hw - 0.05
        hw1 = hw0 - 0.07
        zb, zt = C.z_ws_base + 0.012, C.z_roof - 0.055
        fb, ft = C.f_cowl - 0.012, C.f_cowl - C.ws_run
        slope = math.hypot(fb - ft, zt - zb)
        bow = 0.028 * k
        self.ws = dict(hw0=hw0, hw1=hw1, zb=zb, zt=zt, fb=fb, ft=ft, slope=slope, bow=bow)

        def wpos(u, s, off=0.0):
            t = s / slope
            hwx = hw0 + (hw1 - hw0) * t
            x = u * hwx / hw0
            f = fb + (ft - fb) * t + bow * (1 - (u / hw0) ** 2)
            z = zb + (zt - zb) * t
            # off pushes outward (along glass normal)
            nf, nz = (zt - zb) / slope, (fb - ft) / slope
            return (x, f + nf * off, z + nz * off)
        self.wpos = wpos
        poly = rrect_poly(-hw0, 0.0, hw0, slope, 0.05, 3)
        b.shell('glass', poly, lambda u, s: wpos(u, s), out=(0, 0.5, 0.9), thick=0.007, dens=0.25, bev=0.0)
        # gasket around the glass
        g = []
        for (u, s) in rrect_poly(-hw0 - 0.012, -0.012, hw0 + 0.012, slope + 0.012, 0.05, 3):
            g.append(wpos(u, s, 0.006))
        b.sweep('rubber', g, [(0.016, 0.005), (-0.016, 0.005), (-0.016, -0.005), (0.016, -0.005)], closed=True, up=(0, 0.3, 1))
        # A pillars (paint) and header
        for sg in (1, -1):
            pts = [wpos(sg * (hw0 + 0.04), s * slope / 8, 0.0) for s in range(9)]
            pts = [(p[0], p[1], p[2]) for p in pts]
            b.sweep('paint', pts[::4], rrect_prof(0.065, 0.06, 0.015, 1), up=(0, 1, 0))
            # (interior trim on the pillar: interior.cab_trim)
        # cowl panel + vent
        b.box('paint', (0, C.f_cowl + 0.005, C.z_ws_base - 0.02), (2 * (C.cab_hw) - 0.01, 0.075, 0.04), bev=0.01)
        for i in range(9):
            b.box('metal_dark', (-0.5 * k + i * 0.125 * k, C.f_cowl + 0.005, C.z_ws_base + 0.0), (0.09 * k, 0.03, 0.006), bev=0.001, seg=1)
        # wipers (parked along the base)
        for j, wx in enumerate((0.05 * k, -0.42 * k)):
            p0 = wpos(wx, 0.0, 0.02)
            p1 = wpos(wx + 0.50 * k, 0.09, 0.028)
            b.tube('metal_dark', [p0, p1], 0.005, n=6)
            b.cyl('metal_dark', (p0[0], p0[1], p0[2] - 0.02), 0.012, 0.04, axis='z', n=8)
            p2 = wpos(wx + 0.50 * k, 0.07, 0.024)
            p3 = wpos(wx + 0.50 * k - 0.44 * k, 0.07, 0.02)
            b.box('rubber', ((p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2, (p2[2] + p3[2]) / 2), (0.44 * k, 0.012, 0.008), bev=0.002, seg=1, rot=(math.degrees(math.atan2(C.z_roof - C.z_ws_base, C.ws_run)) - 90, 0, 0))

    # ------------------------------------------------------------------------------------------- roof + cab shell
    def cab_shell(self):
        C, b, k = self.C, self.b, self.k
        ws = self.ws
        hw = C.cab_hw - 0.012
        f1 = ws['ft'] - 0.005
        f0 = C.f_back - 0.02
        zr = C.z_roof
        crown = 0.045 * k

        def zs(x, f):
            z = zr - crown * (x / hw) ** 2
            d = f - (f1 - 0.16)
            if d > 0:
                z -= 0.055 * (d / 0.16) ** 2
            d2 = (f0 + 0.10) - f
            if d2 > 0:
                z -= 0.04 * (d2 / 0.10) ** 2
            e = abs(x) - (hw - 0.05)
            if e > 0:
                z -= 0.05 * (e / 0.05) ** 2
            return z
        self.roof_z = zs
        poly = rrect_poly(-hw, f0, hw, f1, 0.06, 4)
        b.shell('paint', poly, lambda u, v: (u, v, zs(u, v)), out=(0, 0, 1), thick=0.032, dens=C.dense * 1.7, bev=0.006, m2='interior', seed=21)
        # roof rain gutters
        for sg in (1, -1):
            pts = [(sg * (hw - 0.012), f0 + 0.12 + (f1 - f0 - 0.30) * i / 7, zs(hw - 0.012, f0 + 0.12 + (f1 - f0 - 0.30) * i / 7) - 0.018) for i in range(8)]
            b.sweep('metal_dark', pts, rrect_prof(0.028, 0.018, 0.005, 1), up=(1, 0, 0))
        # rear wall with window
        hwb = C.cab_hw
        zb0, zb1 = C.z_bed - 0.05, C.z_roof - 0.058
        fbk = C.f_back
        poly = rrect_poly(-hwb, zb0, hwb, zb1, 0.0, 4, r_tl=0.09, r_tr=0.09, r_bl=0.02, r_br=0.02)
        wk = hwb / 0.8
        wx, wz0, wz1 = 0.52 * wk, C.z_belt + 0.10 * k, C.z_roof - 0.17 * k
        hole = rrect_poly(-wx, wz0, wx, wz1, 0.06, 4)

        def fb_fn(u, v):
            return (u, fbk - 0.02 * (1 - (u / hwb) ** 2), v)
        b.shell('paint', poly, fb_fn, out=(0, -1, 0), thick=0.026, dens=C.dense * 1.4, holes=[hole], bev=0.005, m2='interior', seed=31)
        b.shell('glass', rrect_poly(-wx - 0.01, wz0 - 0.01, wx + 0.01, wz1 + 0.01, 0.06, 4), lambda u, v: (u, fbk - 0.012 - 0.02 * (1 - (u / hwb) ** 2), v),
                out=(0, -1, 0), thick=0.006, dens=0.25, bev=0.0)
        g = [(u, fbk - 0.028 - 0.02 * (1 - (u / hwb) ** 2), v) for (u, v) in rrect_poly(-wx - 0.012, wz0 - 0.012, wx + 0.012, wz1 + 0.012, 0.06, 4)]
        b.sweep('rubber', g, [(0.018, 0.006), (-0.018, 0.006), (-0.018, -0.006), (0.018, -0.006)], closed=True, up=(0, 1, 0))
        # rear corner pillars + sills
        for sg in (1, -1):
            b.box('paint', (sg * (C.door_hw - 0.055), (C.f_dr + fbk) / 2 - 0.002, (C.z_db + C.z_roof - 0.06) / 2 + 0.0), (0.11, C.f_dr - fbk + 0.005, C.z_roof - 0.06 - C.z_db), bev=0.012, taper=(0.86, 1.0))
            b.box('paint', (sg * (C.door_hw - 0.03), (C.f_df + C.f_dr) / 2, C.z_sill + 0.045), (0.09, C.f_df - C.f_dr + 0.02, 0.10), bev=0.014, seg=2)
            b.box('metal_dark', (sg * (C.door_hw - 0.10), (C.f_df + C.f_dr) / 2, C.z_sill + 0.075), (0.08, C.f_df - C.f_dr, 0.06), bev=0.005)
            # b-post / door-jamb shadow plates
            b.box('interior', (sg * (C.cab_hw - 0.01), (C.f_df + C.f_dr) / 2, (C.z_floor + C.z_belt) / 2), (0.03, C.f_df - C.f_dr, C.z_belt - C.z_floor), bev=0.004)
            # door-frame rubber seals around the opening
            b.box('rubber', (sg * (C.door_hw - 0.025), C.f_dr - 0.004, (C.z_db + C.z_belt) / 2), (0.02, 0.02, C.z_belt - C.z_db), bev=0.005, seg=1)
            b.box('rubber', (sg * (C.door_hw - 0.025), C.f_df + 0.004, (C.z_db + C.z_belt) / 2), (0.02, 0.02, C.z_belt - C.z_db), bev=0.005, seg=1)
        # floor, tunnel, firewall carpet
        # Close the front footwell/jamb corners with permanent kick panels.
        # The front fenders are detachable; they cannot be the cab's side wall.
        # Overlap floor, dash end caps, jambs and firewall without filling windows.
        kick_f0, kick_f1 = C.f_df - 0.012, C.f_cowl + 0.005
        kick_z0, kick_z1 = C.z_floor - 0.035, C.z_ws_base + 0.005
        for sg in (1, -1):
            b.box('interior', (sg * (C.cab_hw - 0.01), (kick_f0 + kick_f1) / 2,
                              (kick_z0 + kick_z1) / 2),
                  (0.056, kick_f1 - kick_f0, kick_z1 - kick_z0), bev=0.0)
        xw = C.cab_hw - 0.02
        b.box('metal_dark', (0, (C.f_cowl + fbk) / 2, C.z_floor - 0.02), (2 * xw, C.f_cowl - fbk, 0.03), bev=0.004)
        b.box('interior', (0, (C.f_cowl + fbk) / 2, C.z_floor - 0.0), (2 * xw - 0.06, C.f_cowl - fbk - 0.06, 0.015), bev=0.004)
        b.box('interior', (0, (C.f_cowl - 0.08 + fbk + 0.2) / 2, C.z_floor + 0.05), (0.36 * k, C.f_cowl - 0.08 - fbk - 0.2, 0.11), bev=0.03, seg=2, taper=(0.8, 1.0))
        # floor mats
        for sx in (C.driver_x, -C.driver_x if C.seat != 'bench' else -0.35):
            b.box('rubber', (sx, C.f_cowl - 0.30, C.z_floor + 0.012), (0.42, 0.44, 0.012), bev=0.004, seg=1)
        # rear cab wall storage shelf/back
        b.box('interior', (0, fbk + 0.04, C.z_floor + 0.20), (2 * xw - 0.06, 0.06, 0.4), bev=0.02)

    # ------------------------------------------------------------------------------------------- doors
    def doors(self):
        C, b, k = self.C, self.b, self.k
        zdb, zbl = C.z_db, C.z_belt
        f_r, f_f = C.f_dr + 0.006, C.f_df - 0.006
        fc, hl = (f_r + f_f) / 2, (f_f - f_r) / 2
        zc, hh = (zdb + zbl) / 2, (zbl - zdb) / 2
        hwd = C.door_hw
        tumble = 0.02 * k
        # window opening (f, z)
        zwb = zbl + 0.012
        zwt = C.z_roof - 0.075
        fwb, fwt = C.f_df - 0.035, C.f_cowl - C.ws_run - 0.005 - 0.02
        fwr, fwr_t = C.f_dr + 0.045, C.f_dr + 0.005
        win = [(fwb, zwb), (fwr, zwb), (fwr_t, zwt), (fwt, zwt)]
        wpts = fillet_path([(f, z, 0) for f, z in win], 0.05, 3, closed=True)
        win2 = [(p[0], p[1]) for p in wpts]

        def gx(z, sg):
            return sg * (hwd - 0.075 - 0.055 * (z - zbl) / (C.z_roof - zbl))
        for sg in (1, -1):
            name = 'panel_door_' + ('L' if sg > 0 else 'R')
            pt = self.part(name, (sg * hwd, C.f_df, zc))
            skin = 'paint2' if (sg < 0 and C.paint_door_R) else 'paint'

            def fn(u, v, sg=sg):
                x = hwd - tumble * (v - zdb) / (zbl - zdb)
                bulge = 0.014 * k * max(0.0, 1 - ((u - fc) / hl) ** 2) * max(0.0, 1 - ((v - zc) / hh) ** 2)
                # beltline shoulder
                x += bulge + 0.006 * math.exp(-((v - (zbl - 0.10)) / 0.03) ** 2)
                return (sg * x, u, v)
            self.fns['door%+d' % sg] = fn
            poly = rrect_poly(f_r, zdb, f_f, zbl, 0.0, 4, r_tl=0.02, r_tr=0.02, r_bl=0.05, r_br=0.05)
            dent = None
            if C.dents:
                dent = [(fc + 0.25, zc - 0.12, 0.22, 0.010), (fc - 0.30, zc + 0.20, 0.14, 0.006)] if sg > 0 else [(fc + 0.1, zc + 0.05, 0.26, 0.014), (fc - 0.35, zc - 0.25, 0.12, 0.006)]
            pt.shell(skin, poly, fn, out=(sg, 0, 0), thick=0.03, dens=C.dense * 1.1, bev=0.005, dent=dent, m2='metal_dark', seed=41 + sg)
            # body-side character line + lower rub strip
            for zl_, rr, m_ in ((zbl - 0.13 * k, 0.01, skin), (zdb + 0.20 * k, 0.014, 'plastic')):
                path = [(fn(f, zl_)[0] + sg * 0.004, f, zl_) for f in [f_r + 0.03 + (f_f - f_r - 0.06) * i / 8 for i in range(9)]]
                if m_ == 'plastic':
                    pt.sweep(m_, path, rrect_prof(0.028 * k, 0.012, 0.004, 1), up=(0, 0, 1) if False else (1, 0, 0))
                else:
                    pt.sweep(m_, path, [(0.0, 0.010), (0.014, 0.0), (0.0, -0.01), (-0.014, 0.0)], up=(1, 0, 0))
            # window frame + glass
            fr_path = []
            for (f, z) in win2:
                fr_path.append((gx(z, sg) + sg * 0.03, f, z))
            pt.sweep(skin if False else 'paint' if skin == 'paint' else 'paint2', fr_path, rrect_prof(0.052, 0.034, 0.008, 2), closed=True, up=(0, 1, 0)) if False else None
            fr_in = [(gx(z, sg) + sg * 0.03, f, z) for (f, z) in win2]
            pt.sweep('paint2' if skin == 'paint2' else 'paint', fr_in, rrect_prof(0.045, 0.03, 0.007, 1), closed=True, up=(sg, 0, 0))
            gl = [(f, z) for (f, z) in win2]
            # glass shell over the window polygon (mapped onto the tilted plane)
            pt.shell('glass', [(f, z) for (f, z) in win2], lambda u, v, sg=sg: (gx(v, sg), u, v), out=(sg, 0, 0), thick=0.006, dens=0.25, bev=0.0)
            # rubber gasket
            pt.sweep('rubber', [(gx(z, sg) + sg * 0.018, f, z) for (f, z) in win2], [(0.01, 0.006), (-0.01, 0.006), (-0.01, -0.006), (0.01, -0.006)], closed=True, up=(sg, 0, 0))
            # vent window divider (T1/T2 style quarter glass bar)
            if C.tier <= 2:
                fv = fwb - 0.17
                pt.sweep('metal_dark', [(gx(zwb, sg) + sg * 0.02, fv, zwb), (gx(zwt, sg) + sg * 0.02, fv - 0.03, zwt)], rrect_prof(0.02, 0.016, 0.004, 1), up=(sg, 0, 0))
            # handle, keyhole, lock pin
            door_handle(pt, (sg * (hwd + 0.004), f_r + 0.20 * k, zbl - 0.085), sg)
            pt.cyl('chrome', (sg * (hwd + 0.008), f_r + 0.36 * k, zbl - 0.078), 0.009, 0.008, axis='x', n=8)
            # hinges (visible on the door edge)
            for hz in (zdb + 0.14, zbl - 0.15):
                pt.box('metal_dark', (sg * (hwd - 0.02), f_f + 0.008, hz), (0.06, 0.02, 0.07), bev=0.004)
            # mirror
            if getattr(C, 'no_door_mirror', False):
                pass
            elif sg > 0 or C.tier > 1:
                W_, H_ = {1: (0.12, 0.17), 2: (0.16, 0.26), 3: (0.15, 0.22), 4: (0.17, 0.24)}[C.tier]
                gc = mirror2(pt, sg, f_f - 0.07, zbl, hwd, hwd + 0.03, W=W_, H=H_, m={1: 'plastic', 2: 'metal_dark', 4: 'paint'}.get(C.tier, 'paint'),
                             style='car' if C.tier == 1 else 'truck')
                self.mirror_glass = getattr(self, 'mirror_glass', {})
                self.mirror_glass['L' if sg > 0 else 'R'] = (gc, W_ - 0.03, H_ - 0.03, name)
            else:
                # missing mirror: bare bracket
                pt.box('metal_dark', (sg * (hwd - 0.005), f_f - 0.08, zbl + 0.09), (0.04, 0.05, 0.03), bev=0.004)
                pt.cyl2('metal_dark', (sg * hwd, f_f - 0.08, zbl + 0.09), (sg * (hwd + 0.09), f_f - 0.06, zbl + 0.14), 0.006, n=6)
            # ---- inside: door card (interior.py)
            self.door_card(pt, sg, f_r, f_f, zdb, zbl, hwd)
            if C.rust_patches and C.tier == 1:
                specs = [(fc - 0.30, zdb + 0.07, 0.09, (2.0, 0.7)), (fc + 0.32, zdb + 0.06, 0.06, (1.8, 0.8)), (f_f - 0.05, zdb + 0.30, 0.04, (0.7, 2.0)), (f_r + 0.05, zdb + 0.22, 0.05, (0.7, 1.8))] if sg > 0 else [(fc + 0.1, zdb + 0.06, 0.07, (2.2, 0.7)), (f_r + 0.06, zbl - 0.22, 0.04, (0.7, 1.8))]
                self.patches(pt, fn, (sg, 0, 0), specs)

    # ------------------------------------------------------------------------------------------- dash + interior
    def dash(self):
        C, b, k = self.C, self.b, self.k
        xw = C.cab_hw - 0.045
        fd = C.f_cowl - 0.36 * k
        fc = C.f_cowl - 0.012
        zr_, zf_ = C.z_ws_base - 0.135, C.z_ws_base - 0.03
        self.fd = fd

        def zs(x, f):
            t = max(0.0, min(1.0, (f - fd) / (fc - fd)))
            z = zr_ + (zf_ - zr_) * t ** 1.4
            z -= 0.03 * (1 - smoothstep(0, 0.06, f - fd))
            z += 0.012 * (1 - (x / xw) ** 2)
            return z
        self.dash_z = zs
        poly = rrect_poly(-xw, fd, xw, fc, 0.05, 3)
        b.shell('interior', poly, lambda u, v: (u, v, zs(u, v)), out=(0, 0, 1), thick=0.035, dens=0.11, bev=0.008, m2='metal_dark', seed=51)
        # dash face
        zt_ = zs(0, fd)
        face = rrect_poly(-xw, C.z_floor + 0.10, xw, zt_ - 0.02, 0.03, 3)
        b.plate('interior', face, lambda u, v: (u, fd + 0.055 - 0.05 * (v - C.z_floor) / (zt_ - C.z_floor) + 0.0, v), out=(0, -1, 0), thick=0.03, bev=0.006, m2='metal_dark')
        ff = fd + 0.01
        # instrument binnacle (driver)
        dx = C.driver_x
        bn = (dx, fd + 0.03, zt_ + 0.045)
        b.box('interior', bn, (0.48 * k, 0.15, 0.13), bev=0.03, seg=2, taper=(0.98, 0.8))
        b.box('metal_dark', (dx, fd - 0.035, zt_ + 0.02), (0.40 * k, 0.006, 0.10), bev=0.004, seg=1)
        gz = zt_ + 0.02
        for gx_, gr in ((dx + 0.11 * k, 0.05 * k), (dx - 0.06 * k, 0.05 * k)):
            b.cyl('chrome', (gx_, fd - 0.038, gz), gr, 0.012, axis='f', n=14)
            b.cyl('brass', (gx_, fd - 0.044, gz), gr * 0.86, 0.004, axis='f', n=14)
            b.box('metal_dark', (gx_ + gr * 0.2, fd - 0.049, gz + gr * 0.15), (gr * 0.6, 0.003, 0.004), bev=0.0, rot=(0, 0, 35))
        for i, gx_ in enumerate((dx - 0.16 * k, dx - 0.19 * k, dx + 0.19 * k)):
            b.cyl('chrome', (gx_, fd - 0.038, gz + 0.03 - i * 0.02 + (0.02 if i == 2 else 0)), 0.018 * k, 0.01, axis='f', n=10, bev=0.001)
        for i, m_ in enumerate(('brass', 'brass', 'brass')):
            b.box(m_, (dx + 0.02 + i * 0.03, fd - 0.04, gz - 0.04), (0.012, 0.004, 0.012), bev=0.0)
        # vents, radio, glove box, knobs
        for vx in (-0.62 * k, -0.15 * k, 0.55 * k):
            b.box('metal_dark', (vx, fd - 0.012, zt_ - 0.075), (0.11, 0.02, 0.05), bev=0.006)
            for i in range(4):
                b.box('interior', (vx, fd - 0.024, zt_ - 0.09 + i * 0.014), (0.10, 0.006, 0.005), bev=0.0)
        b.box('metal_dark', (0, fd - 0.012, zt_ - 0.16), (0.24, 0.04, 0.09), bev=0.008)
        for i in range(4):
            b.cyl('chrome', (-0.09 + i * 0.06, fd - 0.038, zt_ - 0.145), 0.010, 0.014, axis='f', n=6)
        b.box('metal_dark', (0, fd - 0.028, zt_ - 0.17), (0.17, 0.006, 0.03), bev=0.002, seg=1)
        b.box('interior', (-0.45 * k, fd - 0.012, zt_ - 0.20), (0.44 * k, 0.03, 0.17), bev=0.0)
        b.box('metal_dark', (-0.45 * k, fd - 0.028, zt_ - 0.20), (0.40 * k, 0.005, 0.005), bev=0.001, seg=1)
        b.box('chrome', (-0.45 * k, fd - 0.032, zt_ - 0.155), (0.06, 0.012, 0.02), bev=0.004)
        # heater control cluster
        for i in range(3):
            b.cyl('metal_bare', (0.10 + i * 0.05, fd - 0.036, zt_ - 0.27), 0.012, 0.012, axis='f', n=6)
        # steering column + wheel
        wc = (dx, C.f_cowl - 0.335 * k, C.z_ws_base - 0.055 * k)
        self.wheel_c = wc
        col0 = (dx, fd + 0.04, zt_ - 0.20)
        b.cyl2('plastic', col0, (wc[0], wc[1] + 0.02, wc[2] - 0.01), 0.04, r2=0.03, n=10)
        b.cyl2('metal_dark', (dx, fd + 0.06, zt_ - 0.30), (dx, fd + 0.15, C.z_floor + 0.15), 0.035, n=8)
        tilt = 25.0 * D2R
        n_b = Vector((0, math.cos(tilt), math.sin(tilt)))       # wheel faces back and up (Blender coords)
        ex = Vector((1, 0, 0))
        ev = n_b.cross(ex)
        r_sw = 0.185 * k
        rim_m = 'rubber' if C.tier <= 2 else 'leather'
        b.torus(rim_m, G(PV(wc)), r_sw, 0.0135 * k, axis=(n_b.x, n_b.y, n_b.z), nR=30, nr=8)
        b.cyl('plastic', wc, 0.05, 0.05, axis=(n_b.x, n_b.y, n_b.z), n=14, bev=0.008)
        hubb = PV(wc)
        for i in range(3):
            ang = [math.pi, 0.0, -math.pi / 2][i]
            d = ex * math.cos(ang) + ev * math.sin(ang)
            pe = hubb + d * (r_sw - 0.005)
            b.cyl2('plastic', wc, G(pe), 0.010, n=8)
        b.cyl('chrome', (wc[0], wc[1] - 0.026, wc[2] + 0.012), 0.022, 0.006, axis=(n_b.x, n_b.y, n_b.z), n=10)
        # pedals
        for i, px in enumerate((dx - 0.13, dx - 0.02, dx + 0.11)):
            w_ = 0.05 if i != 1 else 0.075
            b.box('metal_dark', (px, C.f_cowl - 0.10, C.z_floor + 0.14), (w_, 0.014, 0.10), bev=0.004, rot=(-25, 0, 0))
            b.box('rubber', (px, C.f_cowl - 0.115, C.z_floor + 0.13), (w_, 0.014, 0.085), bev=0.004, rot=(-25, 0, 0))
        # gear lever + handbrake
        gl = (0.0, C.f_cowl - 0.62 * k, C.z_floor + 0.11)
        b.cyl2('metal_dark', gl, (gl[0] + 0.02, gl[1] - 0.06, gl[2] + 0.30), 0.011, n=8)
        b.sph('plastic', (gl[0] + 0.02, gl[1] - 0.06, gl[2] + 0.32), 0.03, n=10)
        b.cyl('rubber', (gl[0], gl[1] + 0.02, gl[2] - 0.005), 0.05, 0.03, axis='z', n=12)
        b.box('metal_dark', (0.24 * k, C.f_cowl - 0.85 * k, C.z_floor + 0.11), (0.03, 0.26, 0.04), bev=0.008, rot=(18, 0, 0))
        # rear-view mirror, visors
        ws = self.ws
        m0 = self.wpos(0.0, ws['slope'] - 0.05, -0.03)
        b.box('plastic', (0.12 * k, m0[1] - 0.06, m0[2] - 0.08), (0.24, 0.03, 0.08), bev=0.012)
        b.cyl2('metal_dark', (0.12 * k, m0[1] - 0.01, m0[2] - 0.03), (0.12 * k, m0[1] - 0.05, m0[2] - 0.065), 0.006, n=6)
        for sg in (1, -1):
            b.box('interior', (sg * 0.36 * k, ws['ft'] - 0.06, C.z_roof - 0.07), (0.38 * k, 0.16, 0.022), bev=0.008, rot=(0, 0, 0))
        b.sph('plastic', (0, (ws['ft'] + C.f_back) / 2, C.z_roof - 0.05), 0.05, n=8, sc=(1.4, 1.0, 0.4))

    def seats(self):
        C, b, k = self.C, self.b, self.k
        z0 = C.seat_z - 0.09
        if C.seat == 'bench':
            bench_seat(b, (0.0, C.seat_f, z0), w=1.38 * k * 1.02 if C.tier > 1 else 1.38, depth=0.50 * k, back_h=0.62 * k,
                       cushion='fabric' if C.tier == 1 else 'leather', trim='fabric' if C.tier == 1 else 'leather', tilt=13)
        else:
            for sg in (1, -1):
                bucket_seat(b, (sg * C.driver_x, C.seat_f, z0), w=0.50 * k, depth=0.52 * k, back_h=0.66 * k, cushion='leather', trim='fabric', tilt=12)
            # centre console
            b.box('interior', (0, C.seat_f + 0.05, C.z_floor + 0.14), (0.24, 0.62, 0.20), bev=0.03)
            b.box('leather', (0, C.seat_f + 0.05, C.z_floor + 0.25), (0.20, 0.44, 0.04), bev=0.015)
        # seat belts (driver)
        dx = C.driver_x
        bf = C.seat_f - 0.26 * k
        b.ribbon('fabric' if C.tier == 1 else 'canvas', [(dx + 0.22, bf - 0.03, C.seat_z + 0.62 * k), (dx + 0.02, bf + 0.06, C.seat_z + 0.32 * k), (dx - 0.20, bf + 0.02, C.z_floor + 0.10)], 0.045, 0.004, up=(0, 1, 0), rad=0.03)
