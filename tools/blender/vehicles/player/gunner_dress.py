"""gunner_dress - what the gunner stares at all run: spent brass on the bed floor, diamond-plate standing pads, rear-window
guards, inner faces of shields/plates (stiffeners, grab bars, labels, extinguisher), light-bar/spotlight backs with wiring,
roof markings.  Game coords (x left+, f fwd+, z up).  Called after the tier kit (uses T.gunner_f)."""
import math
import random
from mathutils import Vector
from vlib import *  # noqa
from parts import *  # noqa
from kit_common import *  # noqa


class GunnerDressMixin:
    def gunner_dress(self):
        C = self.C
        getattr(self, 'gdress_t%d' % C.tier)()
        self.casings(40 if C.tier > 1 else 26)

    # ------------------------------------------------------------------------------------------- common pieces
    def casings(self, n):
        """spent rifle brass scattered around the gunner's feet"""
        C, b = self.C, self.b
        rnd = random.Random(7 + C.tier)
        hwi = C.bed_hw - C.bed_wall_t
        gf = self.gunner_f
        for i in range(n):
            r = abs(rnd.gauss(0, 0.32)) + 0.05
            a = rnd.uniform(0, 2 * math.pi)
            x = max(-hwi + 0.1, min(hwi - 0.1, r * math.cos(a) * 1.3))
            f = gf + r * math.sin(a) * 0.9
            yaw = rnd.uniform(0, 360)
            z = C.z_bed + 0.0095 + (0.016 if rnd.random() < 0.4 else 0.0)
            d = Vector((math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), 0))
            p = Vector((x, f, z))
            b.cyl2('brass', tuple(p - d * 0.024), tuple(p + d * 0.016), 0.0062, n=5)
            b.cyl2('brass', tuple(p + d * 0.016), tuple(p + d * 0.027), 0.0062, r2=0.0042, n=5, caps=False)

    def diamond_pad(self, cx, cf, w, d, z):
        """anti-slip diamond plate bolted on the bed floor"""
        b = self.b
        b.box('metal_bare', (cx, cf, z + 0.004), (w, d, 0.008), bev=0.002)
        # raised diamonds: single quads 2 mm above the plate (only their tops are ever seen)
        nx, nf = int(w / 0.06), int(d / 0.045)
        verts, faces = [], []
        for i in range(nx):
            for j in range(nf):
                x = cx - w / 2 + 0.03 + i * (w - 0.06) / max(1, nx - 1)
                f = cf - d / 2 + 0.025 + j * (d - 0.05) / max(1, nf - 1)
                a = math.radians(45 if (i + j) % 2 else -45)
                ux, uf = math.cos(a) * 0.016, math.sin(a) * 0.016
                vx, vf = -math.sin(a) * 0.004, math.cos(a) * 0.004
                k = len(verts)
                zz = z + 0.0102
                verts += [P(x - ux - vx, f - uf - vf, zz), P(x + ux - vx, f + uf - vf, zz), P(x + ux + vx, f + uf + vf, zz), P(x - ux + vx, f - uf + vf, zz)]
                faces.append((k + 3, k + 2, k + 1, k))
        b.raw('metal_bare', verts, faces)
        for sx in (-1, 1):
            for sf in (-1, 1):
                b.cyl('metal_dark', (cx + sx * (w / 2 - 0.025), cf + sf * (d / 2 - 0.025), z + 0.009), 0.008, 0.005, axis='z', n=6)

    def rear_glass_guard(self, style):
        """guard over the cab's rear window: 'mesh' (expanded metal in a frame) or 'bars' (welded rebar)"""
        C, b, k = self.C, self.b, self.k
        hwb = C.cab_hw
        wk = hwb / 0.8
        wx, wz0, wz1 = 0.52 * wk + 0.03, C.z_belt + 0.10 * k - 0.03, C.z_roof - 0.17 * k + 0.03
        fg = C.f_back - 0.045
        if style == 'bars':
            for i in range(7):
                x = -wx + 0.06 + i * (2 * wx - 0.12) / 6
                twisted_bar(b, [(x, fg, wz0 - 0.02 + (wz1 - wz0 + 0.04) * t / 6) for t in range(7)], r=0.011, twist=60)
            for z in (wz0 + 0.02, wz1 - 0.02):
                b.box('metal_dark', (0, fg + 0.004, z), (2 * wx, 0.012, 0.03), bev=0.003)
                for x in (-wx + 0.02, wx - 0.02):
                    weld_seam(b, (x, fg - 0.004, z - 0.02), (x, fg - 0.004, z + 0.02), r=0.005)
            return
        # expanded-metal mesh in an angle-iron frame
        pts = [(-wx, fg, wz0), (wx, fg, wz0), (wx, fg, wz1), (-wx, fg, wz1)]
        b.tube('metal_dark', pts, 0.012, n=6, closed=True)
        chainlink(b, fg - 0.002, -wx + 0.015, wx - 0.015, wz0 + 0.015, wz1 - 0.015, 0.05, r=0.0028, m='metal_dark', side=False)
        for (x, z) in ((-wx, wz0), (wx, wz0), (-wx, wz1), (wx, wz1), (0, wz0), (0, wz1)):
            b.box('metal_dark', (x, fg + 0.012, z), (0.04, 0.03, 0.03), bev=0.004)
            b.cyl('metal_bare', (x, fg - 0.01, z), 0.007, 0.01, axis='f', n=6)

    def lightbar_back(self, c, w, h=0.08, d=0.06):
        """cooling fins + brackets + loom on the back of a light bar centred at c (facing +f)"""
        b = self.b
        x, f, z = c
        n = int((w - 0.06) / 0.022)
        for i in range(n):
            xx = x - w / 2 + 0.04 + i * (w - 0.08) / max(1, n - 1)
            b.box('metal_dark', (xx, f - d / 2 - 0.009, z), (0.005, 0.018, h * 0.8), bev=0.0)
        b.cyl2('rubber', (x + w / 2 - 0.06, f - d / 2 - 0.01, z - h / 2), (x + w / 2 - 0.1, f - d / 2 - 0.03, z - h / 2 - 0.12), 0.007, n=6)

    def spot_back(self, c, r):
        b = self.b
        x, f, z = c
        for i in range(4):
            b.torus('metal_dark', (x, f - 0.06 - i * 0.012, z), r * (0.92 - i * 0.12), 0.004, axis='f', nR=14, nr=4)
        b.cyl('metal_dark', (x, f - 0.1, z), r * 0.35, 0.03, axis='f', n=10)
        b.cyl2('rubber', (x, f - 0.11, z), (x, f - 0.14, z - 0.1), 0.005, n=6)

    def tape_wrap(self, p0, p1, r, m='rubber', turns=7):
        """friction-tape spiral around a tube between p0 and p1"""
        b = self.b
        a, c = Vector(p0), Vector(p1)
        ax = (c - a).normalized()
        u = ax.orthogonal().normalized()
        v = ax.cross(u)
        pts = []
        n = turns * 10
        for i in range(n + 1):
            t = i / n
            q = a + (c - a) * t
            ang = t * turns * 2 * math.pi
            pts.append(tuple(q + (u * math.cos(ang) + v * math.sin(ang)) * (r + 0.0015)))
        b.sweep(m, pts, [(0.006, 0.001), (-0.006, 0.001), (-0.006, -0.001), (0.006, -0.001)])

    def roof_mark(self, name, w, h, fo=0.0, xo=0.0, rot=0.0):
        """spray stencil on the cab roof, facing up (the gunner sees it all run)"""
        C = self.C
        f = (self.ws['ft'] + C.f_back) / 2 - 0.12 + fo
        z = self.roof_z(xo, f)
        self.b.sticker(name, (xo, f, z + 0.0015), (0, 0, 1), (0, 1, 0), w, h, lift=0.0, rot=rot)

    # ------------------------------------------------------------------------------------------- per tier
    def gdress_t1(self):
        C, b = self.C, self.b
        # tally of kills sprayed on the roof, cracked + taped rear window
        self.roof_mark('tally', 0.36, 0.135, fo=-0.12, xo=0.12, rot=-4)
        hwb = C.cab_hw
        wk = hwb / 0.8
        fg = C.f_back - 0.028
        zc = (C.z_belt + 0.10 + C.z_roof - 0.17) / 2
        b.swatch('silver')
        for a in (32, -32):
            ang = math.radians(a)
            p0 = (0.18 - 0.2 * math.cos(ang), fg, zc - 0.2 * math.sin(ang))
            p1 = (0.18 + 0.2 * math.cos(ang), fg, zc + 0.2 * math.sin(ang))
            b.sweep('decal', [p0, p1], [(0.024, 0.0008), (-0.024, 0.0008), (-0.024, -0.0008), (0.024, -0.0008)], up=(0, -1, 0))
        b.swatch(None)
        # bucket of scrap + a crate behind the cab, a folded tarp
        hwi = C.bed_hw - C.bed_wall_t
        zb = C.z_bed
        b.cyl('metal_bare', (-0.2, C.f_bf - 0.2, zb + 0.13), 0.13, 0.26, axis='z', n=16, r2=0.15, caps=True, bev=0.004)
        b.torus('metal_dark', (-0.2, C.f_bf - 0.2, zb + 0.26), 0.15, 0.006, axis='z', nR=16, nr=4)
        for i in range(4):
            b.cyl2('metal_dark', (-0.2 + 0.05 * math.cos(i * 1.7), C.f_bf - 0.2 + 0.05 * math.sin(i * 1.7), zb + 0.2), (-0.2 + 0.09 * math.cos(i * 1.7 + 0.3), C.f_bf - 0.2 + 0.09 * math.sin(i * 1.7 + 0.3), zb + 0.36 + 0.03 * i), 0.008, n=5)

    def gdress_t2(self):
        C, b = self.C, self.b
        hwi = C.bed_hw - C.bed_wall_t
        zb = C.z_bed
        fh = C.f_bf - 0.14
        ztop = 2.42
        self.lightbar_back((0, fh + 0.05, ztop + 0.075), 1.30, h=0.08)
        for sx in (-0.78, 0.78):
            self.spot_back((sx, fh + 0.06, ztop + 0.065), 0.06)
        # loom down the roll bar hoop into the cab roof
        b.tube('rubber', [(0.5, fh + 0.03, ztop + 0.03), (0.66, fh + 0.035, ztop - 0.02), (hwi - 0.06 - 0.03, fh + 0.035, ztop - 0.2), (hwi - 0.06 - 0.03, fh + 0.035, C.bed_top + 0.2)], 0.008, n=6, rad=0.05, k=3)
        for z in (ztop - 0.35, ztop - 0.7, ztop - 1.0):
            b.torus('metal_dark', (hwi - 0.06, fh, z), 0.036, 0.004, axis='z', nR=10, nr=4)
        self.rear_glass_guard('mesh')
        # friction tape on the gunner rails + a first-aid box strapped to the roll bar
        xf = hwi - 0.05
        for sg in (1, -1):
            self.tape_wrap((sg * xf, fh - 0.6, zb + 0.95), (sg * xf, fh - 0.9, zb + 0.95), 0.024, turns=6)
        b.swatch('green')
        b.box('decal', (-0.25, fh - 0.05, zb + 0.72), (0.26, 0.09, 0.18), bev=0.012)
        b.swatch('white')
        b.box('decal', (-0.25, fh - 0.096, zb + 0.72), (0.06, 0.004, 0.018), bev=0.0)
        b.box('decal', (-0.25, fh - 0.096, zb + 0.72), (0.018, 0.004, 0.06), bev=0.0)
        b.swatch(None)
        for dz in (-0.05, 0.05):
            b.ribbon('fabric', [(-0.40, fh - 0.03, zb + 0.72 + dz), (-0.25, fh - 0.1, zb + 0.72 + dz), (-0.10, fh - 0.03, zb + 0.72 + dz)], 0.025, 0.003, up=(0, 0, 1))
        # jerry can strapped on the roof rack beside the spare
        b.box('paint2', (-0.52, 0.02, C.z_roof + 0.085 + 0.085), (0.16, 0.34, 0.17), bev=0.02, seg=2)
        b.box('metal_dark', (-0.52, 0.02, C.z_roof + 0.085 + 0.175), (0.05, 0.2, 0.03), bev=0.01)

    def gdress_t3(self):
        C, b = self.C, self.b
        hwi = C.bed_hw - C.bed_wall_t
        zb = C.z_bed
        self.rear_glass_guard('bars')
        self.diamond_pad(0.0, self.gunner_f, 1.1, 0.9, zb + 0.016)
        # inner face of the sloped shield: stiffeners, grab bar, stencil
        xr_ = hwi - 0.07
        f_front = C.f_bf - 0.23
        zs0, zs1 = zb + 0.32, zb + 1.16

        def inner(x, z, d=0.0):
            t = (z - zs0) / (zs1 - zs0)
            return (x, f_front + 0.05 - 0.11 * t - 0.032 - d, z)
        ang = math.degrees(math.atan2(0.11, zs1 - zs0))
        for sx in (-0.6, -0.3, 0.3, 0.6):
            c = inner(sx, (zs0 + zs1) / 2 - 0.08, 0.018)
            b.box('metal_dark', c, (0.012, 0.036, zs1 - zs0 - 0.28), bev=0.002, rot=(ang, 0, 0))
        for sx in (-0.45, 0.45):
            p0, p1 = inner(sx - 0.1, zs1 - 0.28, 0.0), inner(sx + 0.1, zs1 - 0.28, 0.0)
            b.tube('metal_bare', [p0, (p0[0], p0[1] - 0.06, p0[2]), (p1[0], p1[1] - 0.06, p1[2]), p1], 0.011, n=8, rad=0.03, k=3)
        b.sticker('lbl_danger', inner(0.0, zs0 + 0.36, 0.0025), (0, -0.99, 0.13), (0, 0.13, 0.99), 0.3, 0.075, lift=0.0)
        # ammo cans hung on the cage
        for sg in (1, -1):
            x = sg * (xr_ - 0.08)
            f = (f_front + C.f_tail) / 2 - 0.25
            b.box('interior', (x, f, zb + 0.72), (0.1, 0.28, 0.18), bev=0.008)
            b.box('metal_dark', (x, f, zb + 0.82), (0.07, 0.08, 0.02), bev=0.004)
            b.cyl2('metal_dark', (x + sg * 0.05, f - 0.1, zb + 0.8), (sg * xr_, f - 0.1, zb + 0.92), 0.004, n=5)

    def gdress_t4(self):
        C, b = self.C, self.b
        hwi = C.bed_hw - C.bed_wall_t
        zb = C.z_bed
        self.diamond_pad(0.0, self.gunner_f, 1.3, 1.0, zb + 0.016)
        hw_n = hwi - 0.02
        zt0 = C.bed_top - 0.04
        zt1 = zb + 1.02
        f_front = C.f_bf - 0.17
        f_rear = C.f_tail + 0.10
        span = zt1 - zt0
        # side plates, inside: stiffener ribs + grab handles + label
        for sg in (1, -1):
            def ins(f, z, d=0.0, sg=sg):
                return (sg * (hw_n + 0.02 + 0.10 * (z - zt0) / span - 0.034 - d), f, z)
            for fr in (0.3, 0.5, 0.7):
                f = f_rear + (f_front - f_rear) * fr
                b.cyl2('metal_dark', ins(f, zt0 + 0.12, 0.012), ins(f, zt1 - 0.1, 0.012), 0.014, n=6)
            for f in (f_rear + 0.5, f_front - 0.55):
                p0, p1 = ins(f - 0.1, zt1 - 0.18), ins(f + 0.1, zt1 - 0.18)
                b.tube('metal_bare', [p0, ins(f - 0.1, zt1 - 0.18, 0.06), ins(f + 0.1, zt1 - 0.18, 0.06), p1], 0.011, n=8, rad=0.03, k=3)
            b.sticker('lbl_caution' if sg > 0 else 'lbl_nostep', ins((f_front + f_rear) / 2, zt0 + 0.28, 0.0025), (-sg, 0, 0.1), (0, 0, 1), 0.26, 0.065, lift=0.0)
        # fire extinguisher in a bracket on the rear plate (inside)
        ex = (0.55, f_rear + 0.02, zt0 + 0.25)
        b.swatch('red')
        b.cyl('decal', ex, 0.06, 0.38, axis='z', n=14, bev=0.02)
        b.swatch(None)
        b.cyl('metal_dark', (ex[0], ex[1], ex[2] + 0.22), 0.025, 0.06, axis='z', n=10)
        b.box('metal_dark', (ex[0] + 0.04, ex[1], ex[2] + 0.26), (0.08, 0.02, 0.015), bev=0.003)
        for dz in (-0.1, 0.1):
            b.torus('metal_dark', (ex[0], ex[1], ex[2] + dz), 0.064, 0.005, axis='z', nR=14, nr=4)
        # inner face of the front shield: 'NITRO ARMED' + grab bar
        zs0, zs1 = zb + 0.30, zb + 1.30
        xs_ = hw_n - 0.10

        def shi(x, z, d=0.0):
            t = (z - zs0) / (zs1 - zs0)
            return (x, f_front + 0.03 - 0.16 * t - 0.036 - d, z)
        b.sticker('lbl_nitro', shi(0.0, zs0 + 0.5, 0.0025), (0, -0.99, 0.16), (0, 0.16, 0.99), 0.3, 0.075, lift=0.0)
        p0, p1 = shi(-0.55, zs1 - 0.35), shi(0.55, zs1 - 0.35)
        b.tube('metal_bare', [p0, shi(-0.55, zs1 - 0.35, 0.07), shi(0.55, zs1 - 0.35, 0.07), p1], 0.012, n=8, rad=0.04, k=3)
        for sx in (-0.7, -0.35, 0.35, 0.7):
            b.cyl2('metal_dark', shi(sx, zs0 + 0.12, 0.012), shi(sx, zs1 - 0.2, 0.012), 0.013, n=6)
        self.roof_mark('lbl_ride', 0.5, 0.125, fo=-0.35, xo=0.0)
