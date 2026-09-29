"""interior_cab - cab trim for the player trucks: A-pillar trims, header, headliner, dome light, sun visors, rear-view mirror,
grab handles, tier extras (T2 A-pillar gauge pod + CB radio, T3 shotgun rack, T4 overhead NOS panel + roll cage), door cards
and seats.  Game coords (x left+, f fwd+, z up).  Mixed into Truck after InteriorMixin (uses its frames: eye, lip, face_frame)."""
import math
import random
from mathutils import Vector
import vlib
from vlib import *  # noqa
from parts import *  # noqa
from interior import fillet_poly, rrect2, smooth01, X


class InteriorCabMixin:
    # =========================================================================================== cab trim
    def cab_trim(self):
        C, b, k = self.C, self.b, self.k
        tier = C.tier
        ws = self.ws
        hw0, hw1, zb, zt, fb, ft = ws['hw0'], ws['hw1'], ws['zb'], ws['zt'], ws['fb'], ws['ft']
        zs = self.roof_z
        trim_m = {1: 'interior', 2: 'interior', 3: 'metal_dark', 4: 'fabric'}[tier]
        # ---- A-pillar trims (D-section wrapping the pillar's inner face)
        for sg in (1, -1):
            path = []
            for i in range(9):
                t = i / 8
                x = hw0 + (hw1 - hw0) * t
                path.append((sg * (x + 0.012), fb + (ft - fb) * t - 0.035, zb + 0.02 + (zt - zb - 0.03) * t))
            prof = [(0.05, -0.012), (0.045, 0.004), (0.028, 0.016), (0.0, 0.021), (-0.028, 0.016), (-0.045, 0.004), (-0.05, -0.012)]
            b.sweep(trim_m, path, prof, up=(-sg, -0.4, 0))
        # ---- header trim above the windshield
        hdr = [(x, ft - 0.035, zt + 0.005) for x in [-(hw1 + 0.02) + 2 * (hw1 + 0.02) * i / 12 for i in range(13)]]
        b.sweep(trim_m, hdr, [(0.035, -0.02), (0.03, 0.012), (-0.03, 0.02), (-0.04, -0.01)], up=(0, 0, 1))
        # ---- headliner
        f_a, f_b = C.f_back + 0.05, ft - 0.06
        hx = C.cab_hw - 0.07
        if tier == 1:
            sp = (f_b - f_a) / 4

            def hl(u, v):
                fr = ((v - f_a) / sp) % 1.0
                return (u, v, zs(u, v) - 0.05 - 0.013 * math.sin(math.pi * fr) * (1 - (u / hx) ** 4))
            b.shell('fabric', rrect_poly(-hx, f_a, hx, f_b, 0.05, 3), hl, out=(0, 0, -1), thick=0.008, dens=0.04, bev=0.0)
            for i in range(5):
                f = f_a + i * sp
                pts = [(x, f, zs(x, f) - 0.052) for x in [-hx + 2 * hx * j / 14 for j in range(15)]]
                b.sweep('leather', pts, circle_prof(0.0065, 6), up=(0, 0, 1))
            # a torn corner sagging at the back right
            b.shell('fabric', [(-hx + 0.02, f_a + 0.02), (-hx + 0.30, f_a + 0.02), (-hx + 0.1, f_a + 0.22)],
                    lambda u, v: (u, v, zs(u, v) - 0.075 - 0.25 * max(0.0, (f_a + 0.18 - v)) - 0.1 * max(0.0, -hx + 0.25 - u)), out=(0, 0, -1), thick=0.004, dens=0.05, bev=0.0)
        else:
            m_ = 'fabric' if tier != 3 else 'interior'
            b.shell(m_, rrect_poly(-hx, f_a, hx, f_b, 0.08, 3), lambda u, v: (u, v, zs(u, v) - 0.046 - 0.006 * (1 - (u / hx) ** 2)), out=(0, 0, -1), thick=0.01, dens=0.06, bev=0.0)
            if tier == 3:        # pressed stiffening ribs
                for i in range(3):
                    f = f_a + (f_b - f_a) * (i + 0.5) / 3
                    pts = [(x, f, zs(x, f) - 0.058) for x in [-hx + 0.05 + (2 * hx - 0.1) * j / 12 for j in range(13)]]
                    b.sweep('interior', pts, rrect_prof(0.05, 0.016, 0.006, 1), up=(0, 0, 1))
        # dome light
        dc = (0.0, (f_a + f_b) / 2 - 0.1, zs(0, (f_a + f_b) / 2 - 0.1) - 0.058)
        b.box('metal_dark', dc, (0.16, 0.08, 0.014), bev=0.005)
        b.swatch('cream')
        b.box('decal', (dc[0], dc[1], dc[2] - 0.009), (0.13, 0.06, 0.008), bev=0.003)
        b.swatch(None)
        if tier == 3:
            for i in range(4):
                b.box('metal_dark', (dc[0] - 0.06 + i * 0.04, dc[1], dc[2] - 0.022), (0.006, 0.09, 0.006), bev=0.0)
        # ---- sun visors (stowed flat against the headliner; undersides visible)
        for sg in (1, -1):
            vw = 0.36 * k if tier < 4 else 0.4
            xc = sg * (hw1 - vw / 2 - 0.02)
            fh = ft - 0.06
            fz = zs(xc, fh - 0.09) - 0.078
            b.box(trim_m if tier != 1 else 'fabric', (xc, fh - 0.09, fz), (vw, 0.17, 0.024), bev=0.01, seg=2)
            b.cyl2('metal_bare', (xc - sg * vw / 2 - sg * 0.015, fh - 0.005, fz + 0.004), (xc + sg * vw / 2, fh - 0.005, fz + 0.004), 0.005, n=6)
            b.box('metal_dark', (xc + sg * vw / 2 + sg * 0.012, fh - 0.005, zs(xc, fh) - 0.06), (0.03, 0.03, 0.03), bev=0.006)
            b.box('metal_dark', (xc - sg * vw / 2 - sg * 0.02, fh - 0.04, zs(xc, fh) - 0.062), (0.022, 0.03, 0.02), bev=0.005)
            under = fz - 0.0125
            if sg > 0 and tier == 1:
                b.sticker('photo', (xc + 0.06, fh - 0.09, under - 0.001), (0, 0, -1), (0, -1, 0), 0.075, 0.088, lift=0.0, rot=8)
                b.swatch('darkred')
                b.box('decal', (xc - 0.07, fh - 0.07, under - 0.009), (0.045, 0.075, 0.017), bev=0.003, rot=(0, -10, 0))
                b.swatch('cream')
                b.box('decal', (xc - 0.07, fh - 0.07, under - 0.0178), (0.046, 0.022, 0.002), bev=0.0, rot=(0, -10, 0))
                b.swatch(None)
                b.box('rubber', (xc, fh - 0.09, under - 0.002), (vw * 0.9, 0.012, 0.004), bev=0.0)
            elif sg < 0:
                b.box('metal_dark', (xc, fh - 0.09, under - 0.002), (0.2, 0.09, 0.004), bev=0.002)
                b.box('chrome', (xc, fh - 0.09, under - 0.0045), (0.18, 0.075, 0.002), bev=0.0)
            elif tier == 2:
                b.sticker('map', (xc, fh - 0.09, under - 0.001), (0, 0, -1), (0, -1, 0), 0.2, 0.1, lift=0.0, rot=-4)
                b.box('rubber', (xc, fh - 0.12, under - 0.002), (vw * 0.9, 0.012, 0.004), bev=0.0)
            elif tier == 4:
                b.sticker('lbl_pull', (xc, fh - 0.09, under - 0.001), (0, 0, -1), (0, -1, 0), 0.16, 0.04, lift=0.0)
        # ---- rear-view mirror: 'rubber' housing with a flat rear face (the runtime puts the live mirror glass on it)
        mx = 0.12 * k
        top_f = ft - 0.012
        mz = zt - 0.1 - 0.01 * k
        mf = top_f - 0.075
        rings = []
        for (df, sc) in ((0.0, 1.0), (0.005, 1.04), (0.022, 1.0), (0.034, 0.8)):
            rings.append([(mx + a, mf + df, mz + bb) for (a, bb) in rrect2(0.25 * sc, 0.07 * sc, 0.026 * sc, 4)])
        b.loft_grid('rubber', rings, cap=True)
        b.cyl2('metal_dark', (mx, mf + 0.03, mz + 0.01), (mx - 0.01, top_f - 0.012, zt + 0.02), 0.007, n=8)
        b.sph('metal_dark', (mx, mf + 0.034, mz + 0.01), 0.011, n=8)
        b.box('metal_dark', (mx - 0.01, top_f - 0.01, zt + 0.025), (0.05, 0.02, 0.035), bev=0.006)
        self.rvm_c = (mx, mf, mz)
        # ---- grab handle over the passenger door + seat-belt anchors on the B-pillars
        if tier >= 2:
            gx = -(C.cab_hw - 0.07)
            gf = (C.f_df + C.f_dr) / 2 + 0.1
            gz = C.z_roof - 0.12
            b.tube('rubber', [(gx, gf - 0.12, gz + 0.03), (gx, gf - 0.1, gz - 0.02), (gx + 0.035, gf, gz - 0.035), (gx, gf + 0.1, gz - 0.02), (gx, gf + 0.12, gz + 0.03)], 0.011, n=8, rad=0.03, k=3)
        for sg in (1, -1):
            b.box('metal_dark', (sg * (C.cab_hw - 0.06), C.f_back + 0.08, C.z_belt + 0.12), (0.03, 0.05, 0.07), bev=0.008)
        # ---- tier extras
        if tier == 4:
            self.nos_panel()
            self.cab_cage()
        elif tier == 3:
            self.gun_rack()
        elif tier == 2:
            self.pillar_pod()
            self.cb_radio()

    def pillar_pod(self):
        """T2: aftermarket 3-gauge pod on the driver's A-pillar, each dial aimed at the driver"""
        C, b = self.C, self.b
        ws = self.ws
        e = self.eye

        def on_pillar(t, inset):
            return Vector((ws['hw0'] + (ws['hw1'] - ws['hw0']) * t - inset, ws['fb'] + (ws['ft'] - ws['fb']) * t - 0.065, ws['zb'] + (ws['zt'] - ws['zb']) * t))
        for i in range(3):
            p = on_pillar(0.26 + i * 0.1, 0.045)
            n = (e - p).normalized()
            b.cyl('metal_dark', tuple(p), 0.036, 0.05, axis=tuple(n), n=16, bev=0.004)
            b.cyl('chrome', tuple(p + n * 0.026), 0.034, 0.005, axis=tuple(n), n=16)
            b.sticker(['g_oil', 'g_volt', 'g_press'][i], tuple(p + n * 0.0255), tuple(n), (0, 0, 1), 0.056, 0.056, lift=0.0)
        b.cyl2('interior', tuple(on_pillar(0.22, 0.03)), tuple(on_pillar(0.54, 0.03)), 0.03, n=10)

    def cb_radio(self):
        """T2: CB radio hung under the dash + mic on its hook + coiled cord"""
        C, b = self.C, self.b
        lf, lz = self.lip
        c = Vector((-0.05, lf + 0.12, self.dash_zb - 0.045))
        b.box('metal_dark', tuple(c), (0.17, 0.2, 0.05), bev=0.006)
        b.box('metal_dark', tuple(c + Vector((0, -0.101, 0))), (0.16, 0.004, 0.042), bev=0.001)
        for sx in (-0.055, -0.02, 0.015):
            b.cyl('chrome', tuple(c + Vector((sx, -0.108, 0.005))), 0.007, 0.012, axis='f', n=10)
        b.sticker('lamps', tuple(c + Vector((0.05, -0.104, 0.008))), (0, -1, 0), (0, 0, 1), 0.05, 0.012, lift=0.0)
        for sx in (-0.09, 0.09):
            b.box('metal_bare', tuple(c + Vector((sx, 0, 0.03))), (0.012, 0.06, 0.07), bev=0.002)
        hp, nrm, up = self.face_frame(-0.2, 0.75, 0.0)
        b.box('metal_dark', tuple(hp + nrm * 0.01), (0.02, 0.012, 0.03), bev=0.003)
        mic = hp + nrm * 0.03 + Vector((0, 0, -0.04))
        b.box('rubber', tuple(mic), (0.055, 0.03, 0.085), bev=0.012, seg=2)
        b.box('metal_dark', tuple(mic + Vector((0.029, 0, 0.01))), (0.006, 0.014, 0.03), bev=0.002)
        pts = []
        p0 = mic + Vector((0, 0, -0.045))
        p1 = c + Vector((-0.05, -0.1, -0.02))
        for i in range(60):
            t = i / 59
            q = p0 + (p1 - p0) * t + Vector((0, 0, -0.06 * math.sin(math.pi * t)))
            a = i * 1.4
            pts.append(tuple(q + Vector((0.009 * math.cos(a), 0.009 * math.sin(a), 0))))
        b.sweep('rubber', pts, circle_prof(0.0025, 4))

    def gun_rack(self):
        """T3: pump shotgun in two hooks along the headliner above the passenger"""
        C, b = self.C, self.b
        zs = self.roof_z
        x = -0.35
        f0, f1 = C.f_back + 0.12, C.f_back + 0.9
        for f in (f0 + 0.1, f1 - 0.15):
            z = zs(x, f) - 0.06
            b.box('metal_dark', (x, f, z), (0.05, 0.02, 0.03), bev=0.004)
            b.tube('rubber', [(x + 0.03, f, z - 0.01), (x + 0.03, f, z - 0.06), (x - 0.02, f, z - 0.075)], 0.006, n=6, rad=0.02, k=2)
        z = zs(x, (f0 + f1) / 2) - 0.12
        b.cyl2('metal_dark', (x, f1 + 0.05, z + 0.005), (x, f0 + 0.3, z + 0.005), 0.009, n=10)
        b.cyl2('metal_dark', (x, f0 + 0.55, z - 0.018), (x, f0 + 0.35, z - 0.018), 0.012, n=10)
        b.box('wood', (x, f0 + 0.42, z - 0.02), (0.035, 0.18, 0.035), bev=0.008)
        b.box('metal_dark', (x, f0 + 0.2, z - 0.01), (0.04, 0.22, 0.06), bev=0.008)
        b.box('wood', (x, f0 + 0.0, z - 0.03), (0.035, 0.26, 0.07), bev=0.012, rot=(-8, 0, 0))

    def nos_panel(self):
        """T4: overhead aircraft-style switch panel (NOS arm/purge/pump) bolted to the headliner"""
        C, b = self.C, self.b
        zs = self.roof_z
        f = self.ws['ft'] - 0.2
        z = zs(0.12, f) - 0.075
        c = Vector((0.12, f, z))
        b.box('metal_bare', tuple(c), (0.32, 0.13, 0.03), bev=0.006)
        for sx in (-0.15, 0.15):
            for sf in (-0.055, 0.055):
                b.cyl('metal_dark', tuple(c + Vector((sx, sf, -0.016))), 0.005, 0.004, axis='z', n=6)
        b.sticker('lbl_nitro', tuple(c + Vector((0.08, 0.035, -0.0152))), (0, 0, -1), (0, -1, 0), 0.12, 0.03, lift=0.0)
        b.sticker('lbl_arm', tuple(c + Vector((-0.08, 0.035, -0.0152))), (0, 0, -1), (0, -1, 0), 0.1, 0.028, lift=0.0)
        for i in range(4):
            sx = -0.105 + i * 0.07
            p = c + Vector((sx, -0.02, -0.016))
            b.cyl('metal_dark', tuple(p), 0.011, 0.006, axis='z', n=10)
            b.cyl2('chrome', tuple(p), tuple(p + Vector((0, -0.012, -0.03))), 0.003, n=6)
            b.swatch('red' if i < 2 else 'orange')
            b.box('decal', tuple(p + Vector((0, 0.022, -0.02))), (0.026, 0.006, 0.04), bev=0.002, rot=(-60, 0, 0))
            b.swatch(None)
        b.sticker('lamps', tuple(c + Vector((0, -0.05, -0.0152))), (0, 0, -1), (0, -1, 0), 0.12, 0.028, lift=0.0)

    def cab_cage(self):
        """T4: internal roll cage (A-pillar bars, header, B-hoop) with foam pads"""
        C, b = self.C, self.b
        ws = self.ws
        zs = self.roof_z
        r = 0.022
        hx = C.cab_hw - 0.1
        fb_ = C.f_back + 0.1
        for sg in (1, -1):
            p1 = (sg * (ws['hw1'] - 0.075), ws['ft'] - 0.1, ws['zt'] - 0.04)
            p2 = (sg * hx, fb_, zs(hx, fb_) - 0.07)
            b.tube('metal_dark', [(sg * (ws['hw0'] - 0.07), ws['fb'] - 0.1, C.z_floor + 0.3), (sg * (ws['hw0'] - 0.07), ws['fb'] - 0.12, ws['zb'] - 0.05), p1,
                                  (sg * (hx - 0.02), ws['ft'] - 0.25, zs(hx, ws['ft'] - 0.25) - 0.07), p2, (sg * hx, fb_, C.z_floor + 0.02)], r, n=10, rad=0.08, k=4)
            b.tube('rubber', [(sg * (ws['hw1'] - 0.075), ws['ft'] - 0.12, ws['zt'] - 0.05), (sg * (hx - 0.02), ws['ft'] - 0.28, zs(hx, ws['ft'] - 0.28) - 0.07)], r * 1.8, n=10)
        b.tube('metal_dark', [(hx, fb_, zs(hx, fb_) - 0.07), (-hx, fb_, zs(hx, fb_) - 0.07)], r, n=10)
        b.tube('metal_dark', [(hx, fb_, zs(hx, fb_) - 0.07), (-hx, fb_, C.z_belt + 0.1)], r * 0.9, n=10)
        b.tube('rubber', [(0.45, fb_, zs(0.45, fb_) - 0.07), (-0.45, fb_, zs(0.45, fb_) - 0.07)], r * 1.9, n=10)

    # =========================================================================================== door card
    def door_card(self, pt, sg, f_r, f_f, zdb, zbl, hwd):
        C = self.C
        tier = C.tier
        xc = hwd - 0.105
        fc = (f_r + f_f) / 2

        def X_(d):                                   # d = distance inboard from the card plane
            return sg * (xc - d)
        skin = 'paint2' if (sg < 0 and C.paint_door_R) else 'paint'
        card = rrect_poly(f_r + 0.03, zdb + 0.04, f_f - 0.03, zbl - 0.015, 0.04, 3)
        pt.plate('metal_dark', card, lambda u, v: (sg * (xc + 0.01), u, v), out=(-sg, 0, 0), thick=0.02, bev=0.004)
        za = C.seat_z + 0.2                          # armrest height
        if tier in (1, 2):
            top = rrect_poly(f_r + 0.03, zbl - 0.13, f_f - 0.03, zbl - 0.01, 0.02, 2)
            pt.plate(skin, top, lambda u, v: (X_(0.004), u, v), out=(-sg, 0, 0), thick=0.012, bev=0.004)
            pt.box('metal_dark', (X_(0.0), fc, zbl - 0.004), (0.03, f_f - f_r - 0.08, 0.014), bev=0.004)
            cardp = rrect_poly(f_r + 0.05, zdb + 0.06, f_f - 0.05, zbl - 0.14, 0.03, 3)
            pt.plate('interior', cardp, lambda u, v: (X_(0.008), u, v), out=(-sg, 0, 0), thick=0.014, bev=0.005)
            for i in range(4):
                pt.box('metal_dark', (X_(0.0165), fc, zdb + 0.1 + i * 0.045), (0.004, f_f - f_r - 0.14, 0.005), bev=0.0)
            ar = []
            for s in range(7):
                f = f_r + 0.12 + (f_f - f_r - 0.42) * s / 6
                w_ = 0.07 * (1 - 0.25 * (s / 6) ** 2)
                ar.append([(X_(0.045 + a), f, za + bb) for (a, bb) in rrect2(w_, 0.06, 0.022, 3)])
            pt.loft_grid('leather', ar, cap=True)
            pt.box('metal_dark', (X_(0.045), f_r + 0.3, za + 0.028), (0.04, 0.12, 0.012), bev=0.004)
            pt.cyl('chrome', (X_(0.02), f_f - 0.2, zbl - 0.2), 0.024, 0.014, axis='x', n=14, bev=0.003)
            pt.box('chrome', (X_(0.03), f_f - 0.2, zbl - 0.2 + 0.045), (0.008, 0.016, 0.1), bev=0.003)
            pt.cyl2('rubber', (X_(0.033), f_f - 0.2, zbl - 0.2 + 0.09), (X_(0.07), f_f - 0.2, zbl - 0.2 + 0.09), 0.009, n=8)
            pt.box('chrome', (X_(0.012), f_f - 0.14, zbl - 0.1), (0.012, 0.11, 0.045), bev=0.008)
            pt.box('chrome', (X_(0.025), f_f - 0.13, zbl - 0.1), (0.016, 0.08, 0.014), bev=0.005)
            pt.cyl('chrome' if tier == 1 else 'rubber', (X_(0.02), f_r + 0.1, zbl + 0.01), 0.006, 0.05, axis='z', n=8)
            pt.cyl('metal_dark', (X_(0.016), f_f - 0.16, zdb + 0.17), 0.068, 0.012, axis='x', n=20, bev=0.003)
            pt.sticker('mesh', (X_(0.0225), f_f - 0.16, zdb + 0.17), (-sg, 0, 0), (0, 0, 1), 0.11, 0.11, lift=0.0)
            if tier == 1 and sg > 0:
                pt.sticker('skull', (X_(0.0155), f_r + 0.2, zdb + 0.22), (-sg, 0, 0), (0, 0, 1), 0.07, 0.07, lift=0.0, rot=-12)
                pt.swatch('silver')
                pt.box('decal', (X_(0.016), fc + 0.1, zdb + 0.13), (0.002, 0.2, 0.05), bev=0.0, rot=(4, 0, 0))
                pt.swatch(None)
        elif tier == 3:
            pt.plate('interior', card, lambda u, v: (X_(0.0), u, v), out=(-sg, 0, 0), thick=0.006, bev=0.002)
            for a in (0.0, 1.0):
                pt.cyl2('metal_dark', (X_(0.015), f_r + 0.08, zdb + 0.1 + a * 0.4), (X_(0.015), f_f - 0.08, zdb + 0.5 - a * 0.4), 0.012, n=8)
            pt.box('metal_dark', (X_(0.015), fc, zbl - 0.06), (0.03, f_f - f_r - 0.1, 0.05), bev=0.005)
            pt.ribbon('fabric', [(X_(0.02), f_f - 0.1, zbl - 0.1), (X_(0.05), f_f - 0.2, zbl - 0.14), (X_(0.02), f_f - 0.3, zbl - 0.1)], 0.035, 0.005, up=(sg, 0, 0), rad=0.03)
            pt.box('interior', (X_(0.05), f_r + 0.25, zdb + 0.14), (0.09, 0.26, 0.17), bev=0.008)
            pt.box('metal_dark', (X_(0.05), f_r + 0.25, zdb + 0.23), (0.07, 0.07, 0.02), bev=0.004)
            pt.sticker('lbl_danger', (X_(0.0955), f_r + 0.25, zdb + 0.14), (-sg, 0, 0), (0, 0, 1), 0.2, 0.05, lift=0.0)
            pt.box('metal_dark', (X_(0.03), fc - 0.05, za), (0.06, 0.3, 0.03), bev=0.006)
            pt.cyl2('metal_bare', (X_(0.01), f_f - 0.14, zbl - 0.1), (X_(0.04), f_f - 0.2, zbl - 0.1), 0.008, n=8)
        else:
            cardp = rrect_poly(f_r + 0.05, zdb + 0.06, f_f - 0.05, zbl - 0.02, 0.04, 3)
            pt.plate('interior', cardp, lambda u, v: (X_(0.006), u, v), out=(-sg, 0, 0), thick=0.012, bev=0.004)
            ins = rrect_poly(f_r + 0.12, zdb + 0.14, f_f - 0.14, za - 0.06, 0.03, 3)
            pt.plate('fabric', ins, lambda u, v: (X_(0.016), u, v), out=(-sg, 0, 0), thick=0.006, bev=0.003)
            ar = []
            for s in range(7):
                f = f_r + 0.1 + (f_f - f_r - 0.3) * s / 6
                ar.append([(X_(0.045 + a), f, za + bb) for (a, bb) in rrect2(0.075, 0.05, 0.02, 3)])
            pt.loft_grid('leather', ar, cap=True)
            pt.box('metal_dark', (X_(0.05), f_f - 0.28, za + 0.03), (0.05, 0.12, 0.02), bev=0.005)
            for i in range(2):
                pt.box('metal_bare', (X_(0.05), f_f - 0.31 + i * 0.05, za + 0.043), (0.02, 0.03, 0.008), bev=0.003)
            pt.tube('metal_bare', [(X_(0.02), f_r + 0.25, za + 0.1), (X_(0.05), f_r + 0.3, za + 0.13), (X_(0.05), f_r + 0.55, za + 0.13), (X_(0.02), f_r + 0.6, za + 0.1)], 0.012, n=10, rad=0.03, k=3)
            pt.cyl('metal_bare', (X_(0.012), f_f - 0.2, zdb + 0.14), 0.07, 0.01, axis='x', n=24, bev=0.003)
            pt.sticker('mesh', (X_(0.0175), f_f - 0.2, zdb + 0.14), (-sg, 0, 0), (0, 0, 1), 0.12, 0.12, lift=0.0)
            pt.box('paint2', (X_(0.013), fc, zbl - 0.06), (0.004, f_f - f_r - 0.2, 0.012), bev=0.0)

    # =========================================================================================== seats
    def seats(self):
        C, b, k = self.C, self.b, self.k
        tier = C.tier
        z0 = C.seat_z - 0.09
        if C.seat == 'bench':
            self.bench((0.0, C.seat_f, z0), w=2 * (C.cab_hw - 0.13), depth=0.52 * min(k, 1.12), back_h=0.62 * min(k, 1.12), tier=tier)
        else:
            for sg in (1, -1):
                self.bucket((sg * C.driver_x, C.seat_f, z0), w=0.52, depth=0.52, back_h=0.72 if tier == 4 else 0.64, tier=tier, driver=sg > 0)
            b.box('interior' if tier == 4 else 'metal_dark', (0, C.seat_f + 0.1, C.z_floor + 0.14), (0.22, 0.62, 0.2), bev=0.03)
            b.box('leather', (0, C.seat_f - 0.02, C.z_floor + 0.25), (0.2, 0.36, 0.05), bev=0.018)
        dx = C.driver_x
        bf = C.seat_f - 0.26
        belt = 'fabric' if tier < 4 else 'paint2'
        b.ribbon(belt, [(C.cab_hw - 0.06, C.f_back + 0.1, C.z_belt + 0.1), (dx + 0.2, bf, C.seat_z + 0.45), (dx + 0.24, bf + 0.1, C.seat_z + 0.05), (dx + 0.25, bf + 0.15, C.z_floor + 0.08)], 0.045, 0.004, up=(1, 0, 0), rad=0.05)

    def _seat_pan(self, m, c, w, d, h, pleat=None, bolster=0.0):
        """seat cushion as a loft along x: profile (f,z) with a rounded front roll; pleat(x)->dz on top; bolster raises the sides"""
        x0, f0, z0 = c
        rings = []
        n = max(12, int(w / 0.014))
        for i in range(n + 1):
            t = i / n
            x = x0 - w / 2 + w * t
            e = abs(2 * t - 1)
            end = smooth01((e - 0.86) / 0.14)
            dz = (pleat(x - x0) if pleat else 0.0) * (1 - end)
            bz = bolster * smooth01((e - 0.6) / 0.3)
            top = z0 + h - 0.02 * end + dz + bz
            prof = fillet_poly([(f0 + d / 2 - 0.02, z0), (f0 + d / 2 - 0.005 * end, top - 0.03), (f0 + d / 2 - 0.07, top + 0.004), (f0 - d / 2 + 0.08, top - 0.012),
                                (f0 - d / 2, top - 0.02), (f0 - d / 2 + 0.01, z0)], [0.02, 0.045, 0.06, 0.05, 0.02, 0.01], 3)
            rings.append([(x, a, zz) for (a, zz) in prof])
        self.b.loft_grid(m, rings, cap=True)

    def _seat_back(self, m, c, w, h, tilt, thick=0.12, pleat=None, bolster=0.0):
        """backrest loft along x: profile in the tilted (up, out) plane; c = bottom-rear-centre (x, f, z)"""
        x0, f0, z0 = c
        ca, sa = math.cos(tilt * D2R), math.sin(tilt * D2R)
        upv = Vector((0, -sa, ca))
        fw = Vector((0, ca, sa))
        rings = []
        n = max(12, int(w / 0.014))
        for i in range(n + 1):
            t = i / n
            x = x0 - w / 2 + w * t
            e = abs(2 * t - 1)
            end = smooth01((e - 0.86) / 0.14)
            dz = (pleat(x - x0) if pleat else 0.0) * (1 - end)
            bz = bolster * smooth01((e - 0.6) / 0.3)
            tk = thick - 0.02 * end + dz + bz
            prof = fillet_poly([(0.0, 0.0), (h - 0.02, 0.0), (h, tk * 0.6), (h - 0.05, tk), (0.12, tk - 0.01), (0.03, tk * 0.8)], [0.01, 0.03, 0.05, 0.06, 0.06, 0.03], 3)
            base = Vector((x, f0, z0))
            rings.append([tuple(base + upv * a + fw * bb) for (a, bb) in prof])
        self.b.loft_grid(m, rings, cap=True)

    def bench(self, c, w, depth, back_h, tier):
        b, C = self.b, self.C
        x0, f0, z0 = c
        cush = 'leather'
        b.box('metal_dark', (x0, f0, z0 - 0.08), (w * 0.95, depth * 0.85, 0.05), bev=0.008)
        for sx in (-w * 0.3, w * 0.3):
            b.box('metal_dark', (x0 + sx, f0, (C.z_floor + z0 - 0.08) / 2), (0.05, depth * 0.7, z0 - 0.08 - C.z_floor), bev=0.006)
        per = 0.075 if tier == 1 else 0.11

        def pleat(x):
            if abs(x) > w * 0.36 or abs(abs(x) - w * 0.12) < 0.035:
                return 0.0
            return 0.009 * abs(math.sin(math.pi * x / per)) ** 0.6
        self._seat_pan(cush, (x0, f0, z0 - 0.05), w, depth, 0.13, pleat=pleat)
        tilt = 13
        self._seat_back(cush, (x0, f0 - depth / 2 + 0.02, z0 + 0.05), w, back_h, tilt, thick=0.12, pleat=pleat)
        pw = [(x0 - w / 2 + 0.04 + (w - 0.08) * i / 16, f0 + depth / 2 - 0.004, z0 + 0.06) for i in range(17)]
        b.sweep('leather', pw, circle_prof(0.006, 6), up=(0, 0, 1))
        if tier == 1:
            tx, tf = x0 + 0.33, f0 + 0.05
            ztop = z0 - 0.05 + 0.13 + 0.004
            b.swatch('foam')
            b.box('decal', (tx, tf, ztop - 0.002), (0.12, 0.03, 0.008), bev=0.003, rot=(0, 25, 0))
            b.box('decal', (tx + 0.02, tf - 0.03, ztop - 0.002), (0.06, 0.025, 0.008), bev=0.003, rot=(0, -40, 0))
            b.swatch('silver')
            for a in (35, -35):
                b.box('decal', (x0 - 0.3, f0 + 0.02, ztop + 0.0005), (0.16, 0.045, 0.0025), bev=0.0, rot=(0, a, 0))
            b.swatch(None)
            self.blanket((x0 - w * 0.27, f0 - depth / 2 + 0.02, z0 + 0.05), w * 0.42, back_h, tilt)
        else:
            b.box('leather', (x0, f0 - 0.05, z0 + 0.14), (0.2, 0.36, 0.1), bev=0.035, seg=2, rot=(-4, 0, 0))

    def blanket(self, c, w, h, tilt):
        """serape draped over the backrest (decal stripes), with folds"""
        x0, f0, z0 = c
        ca, sa = math.cos(tilt * D2R), math.sin(tilt * D2R)
        upv = Vector((0, -sa, ca))
        fw = Vector((0, ca, sa))
        prof = [(0.1, 0.135), (h * 0.5, 0.137), (h - 0.02, 0.13), (h + 0.02, 0.07), (h - 0.02, -0.01), (h - 0.3, -0.02)]
        rings = []
        n = 18
        for i in range(n + 1):
            t = i / n
            x = x0 - w / 2 + w * t
            wav = 0.012 * math.sin(t * math.pi * 5)
            rings.append([tuple(Vector((x, f0, z0)) + upv * (a - (0.05 * math.sin(t * math.pi) if a < h * 0.5 else 0)) + fw * (bb + wav)) for (a, bb) in prof])
        b = self.b
        did = vlib.decal_spec('serape', o=P(x0, f0, z0), u=Vector((1, 0, 0)), v=Vector((0, 0, 1)), w=w * 1.1, h=h * 1.4)
        b.cur_decal = did
        grid = [[r[j] for r in rings] for j in range(len(prof))]
        b.loft_grid('decal', grid, cyc_u=False, cap=False)
        inner = [[tuple(Vector(p) - fw * 0.004) for p in row] for row in grid]
        b.loft_grid('decal', inner, cyc_u=False, cap=False, flip=True)
        b.cur_decal = 0

    def bucket(self, c, w, depth, back_h, tier, driver):
        b, C = self.b, self.C
        x0, f0, z0 = c
        cush = 'fabric' if tier == 4 else 'leather'
        b.box('metal_dark', (x0, f0, z0 - 0.08), (w * 0.8, depth * 0.8, 0.05), bev=0.008)
        for sx in (-w * 0.35, w * 0.35):
            b.box('metal_dark', (x0 + sx, f0, (C.z_floor + z0 - 0.08) / 2), (0.04, depth * 0.75, z0 - 0.08 - C.z_floor), bev=0.004)

        def pleat(x):
            return 0.006 * abs(math.sin(math.pi * x / 0.06)) if abs(x) < w * 0.26 else 0.0
        self._seat_pan(cush, (x0, f0, z0 - 0.05), w, depth, 0.12, pleat=pleat, bolster=0.05)
        tilt = 14
        self._seat_back(cush, (x0, f0 - depth / 2 + 0.03, z0 + 0.04), w, back_h, tilt, thick=0.11, pleat=pleat, bolster=0.07)
        ca, sa = math.cos(tilt * D2R), math.sin(tilt * D2R)
        upv = Vector((0, -sa, ca))
        fw = Vector((0, ca, sa))
        bc = Vector((x0, f0 - depth / 2 + 0.03, z0 + 0.04)) - fw * 0.03
        if tier == 4:
            rings = []
            for s in range(6):
                t = s / 5
                a = back_h * t + 0.02
                ww = w * (1.02 - 0.12 * t)
                rings.append([tuple(bc + upv * a + X * (ww / 2 * math.cos(q)) + fw * (0.07 * math.sin(q) - 0.02)) for q in [math.pi * j / 10 for j in range(11)]])
            b.loft_grid('interior', [[r[j] for r in rings] for j in range(11)], cyc_u=False, cap=False)
            for sx in (-0.07, 0.07):
                b.box('metal_dark', tuple(bc + upv * (back_h - 0.12) + X * sx + fw * 0.12), (0.06, 0.03, 0.015), bev=0.004)
            if not driver:
                for sx in (-0.08, 0.08):
                    pts = [tuple(bc + upv * (back_h - 0.12) + X * sx + fw * 0.13), tuple(bc + upv * (back_h - 0.15) + X * sx * 0.6 + fw * 0.2), tuple(bc + upv * 0.25 + X * sx * 0.4 + fw * 0.2), (x0, f0 + 0.1, z0 + 0.1)]
                    b.ribbon('paint2', pts, 0.05, 0.004, up=(0, 1, 0), rad=0.05)
                b.box('metal_bare', (x0, f0 + 0.1, z0 + 0.12), (0.09, 0.02, 0.09), bev=0.02)
        else:
            b.tube('metal_dark', [tuple(bc + upv * 0.05 + X * (w / 2 - 0.02)), tuple(bc + upv * (back_h - 0.02) + X * (w / 2 - 0.05)),
                                  tuple(bc + upv * (back_h - 0.02) + X * -(w / 2 - 0.05)), tuple(bc + upv * 0.05 + X * -(w / 2 - 0.02))], 0.012, n=8, rad=0.05, k=3)
            b.box(cush, tuple(bc + upv * (back_h + 0.08) + fw * 0.06), (0.26, 0.08, 0.15), bev=0.035, seg=2, rot=(-tilt, 0, 0))
            for sx in (-0.07, 0.07):
                b.cyl2('metal_bare', tuple(bc + upv * (back_h - 0.02) + X * sx + fw * 0.06), tuple(bc + upv * (back_h + 0.03) + X * sx + fw * 0.06), 0.006, n=6)
