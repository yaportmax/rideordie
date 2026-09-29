"""interior_dash - dash dressing for the player trucks: lip trim strips, pad seam welt, T3 bolted armour plates over the dash,
passenger grab handle, dash-top accessories (T2 clipboard + compass, T3 radio handset + ammo can, T4 GPS tablet on a mount).
Game coords (x left+, f fwd+, z up).  Uses InteriorMixin frames (lip, face_frame, clu, eye)."""
import math
from mathutils import Vector
from vlib import *  # noqa
from parts import *  # noqa
from interior import rrect2, smooth01, X


class InteriorDashMixin:
    def pad_top(self, x, f):
        """z of the dash pad's top surface at (x, f) (straight segment between the windshield base and the lip crown)"""
        C = self.C
        lf, lz = self.lip
        e = smooth01((abs(x) - (self.xw - 0.16)) / 0.16)
        lf += 0.035 * e
        lz -= 0.01 * e
        crown = 0.012 * (1 - (x / self.xw) ** 2)
        fc, zw = C.f_cowl - 0.02, C.z_ws_base - 0.02
        f_a, z_a = fc - 0.06, zw + 0.004 + crown
        f_b, z_b = lf + 0.09, lz + 0.05 + crown
        t = max(0.0, min(1.0, (f - f_b) / (f_a - f_b)))
        return z_b + (z_a - z_b) * t - 0.004 * math.sin(math.pi * t)

    def dash_extras(self):
        C, b, k, st = self.C, self.b, self.k, self.st
        tier = C.tier
        dx = C.driver_x
        xw = self.xw
        lf, lz = self.lip
        # ---- trim strip under the lip (both sides of the binnacle)
        trim = {1: 'wood', 2: 'metal_bare', 3: 'metal_dark', 4: 'paint2'}[tier]
        th = {1: 0.028, 2: 0.012, 3: 0.03, 4: 0.006}[tier]
        for (x0, x1) in ((-(xw - 0.07), dx - 0.235), (dx + 0.235, xw - 0.07)):
            n = max(2, int((x1 - x0) / 0.06))
            pts = []
            for i in range(n + 1):
                x = x0 + (x1 - x0) * i / n
                p, nrm, up = self.face_frame(x, 0.07, 0.006 if tier != 3 else 0.008)
                pts.append(tuple(p))
            prof = [(th / 2, 0.004), (-th / 2, 0.004), (-th / 2, -0.004), (th / 2, -0.004)] if tier != 3 else [(0.02, 0.005), (-0.02, 0.005), (-0.02, -0.005), (0.02, -0.005)]
            b.sweep(trim, pts, prof, up=(0, -1, 0.3))
            if tier == 3:
                for i in range(1, n, 2):
                    p, nrm, up = self.face_frame(x0 + (x1 - x0) * i / n, 0.07, 0.014)
                    b.cyl('metal_bare', tuple(p), 0.0065, 0.006, axis=tuple(nrm), n=6)
        # ---- pad seam welt running across the dash top, 12 cm ahead of the lip
        if tier in (1, 2, 4):
            fs = lf + 0.11
            pts = [(x, fs + 0.01 * (1 - (x / xw) ** 2), self.pad_top(x, fs) + 0.002) for x in [-(xw - 0.05) + 2 * (xw - 0.05) * i / 24 for i in range(25)]]
            b.sweep('leather' if tier != 4 else 'paint2', pts, [(0.0035, 0.0), (0.0, 0.0035), (-0.0035, 0.0), (0.0, -0.002)], up=(0, 0, 1))
        # ---- T3: bolted armour plates over the dash top + welded binnacle cage
        if tier == 3:
            self.armor_dash()
        # ---- passenger grab handle on the dash face (T2..T4)
        if tier >= 2:
            gx = -(xw - 0.2)
            p0, n0, u0 = self.face_frame(gx - 0.16, 0.12, 0.0)
            p1, n1, u1 = self.face_frame(gx + 0.16, 0.12, 0.0)
            path = [tuple(p0), tuple(p0 + n0 * 0.05 + Vector((0, 0, 0.01))), tuple((p0 + p1) / 2 + n0 * 0.065 + Vector((0, 0, 0.012))), tuple(p1 + n1 * 0.05 + Vector((0, 0, 0.01))), tuple(p1)]
            b.tube('rubber' if tier != 3 else 'metal_dark', path, 0.012, n=8, rad=0.04, k=3)
            for p, n_ in ((p0, n0), (p1, n1)):
                b.box('metal_dark', tuple(p + n_ * 0.008), (0.035, 0.02, 0.04), bev=0.006)
        # ---- dash-top accessories
        if tier == 2:
            # clipboard with papers on the passenger side, compass on the centre
            f0 = lf + 0.13
            x0 = -0.45
            z0 = self.pad_top(x0, f0)
            b.box('wood', (x0, f0, z0 + 0.006), (0.23, 0.31, 0.006), bev=0.002, rot=(-24, 8, 0))
            b.sticker('map', (x0, f0 + 0.006, z0 + 0.012), (0, -0.4, 0.92), (0, 0.92, 0.4), 0.2, 0.26, lift=0.0, rot=8)
            b.box('metal_bare', (x0 + 0.01, f0 + 0.13, z0 + 0.068), (0.08, 0.02, 0.012), bev=0.003, rot=(-24, 8, 0))
            cp = (0.1, lf + 0.19, self.pad_top(0.1, lf + 0.19) + 0.03)
            b.box('metal_dark', (cp[0], cp[1], cp[2] - 0.02), (0.06, 0.06, 0.016), bev=0.004)
            b.sph('glass_lens', cp, 0.028, n=12)
            b.swatch('white')
            b.cyl('decal', (cp[0], cp[1], cp[2] - 0.006), 0.02, 0.004, axis='z', n=12)
            b.swatch(None)
        elif tier == 3:
            # handheld radio on a clip + ammo can on the passenger dash
            rp = (0.02, lf + 0.16, self.pad_top(0.02, lf + 0.16) + 0.05)
            b.box('armor', rp, (0.06, 0.035, 0.1), bev=0.008, rot=(-20, 10, 0))
            b.cyl('rubber', (rp[0] + 0.018, rp[1] + 0.012, rp[2] + 0.075), 0.006, 0.08, axis='z', n=6)
            b.sticker('lamps', (rp[0], rp[1] - 0.019, rp[2] + 0.02), (0, -1, 0.3), (0, 0.3, 1), 0.04, 0.01, lift=0.0)
            ap = (-0.42, lf + 0.15, self.pad_top(-0.42, lf + 0.15) + 0.09)
            b.box('interior', ap, (0.28, 0.14, 0.17), bev=0.008, rot=(-18, -6, 0))
            b.box('metal_dark', (ap[0], ap[1] + 0.02, ap[2] + 0.09), (0.1, 0.03, 0.02), bev=0.004, rot=(-18, -6, 0))
            b.sticker('lbl_danger', (ap[0], ap[1] - 0.07 - 0.0, ap[2] - 0.02), (0, -0.95, 0.3), (0, 0.3, 0.95), 0.2, 0.05, lift=0.004, rot=0)
        elif tier == 4:
            # GPS tablet on a ball mount, right of the binnacle
            base = Vector((0.05, lf + 0.17, self.pad_top(0.05, lf + 0.17)))
            top = base + Vector((0.0, -0.05, 0.12))
            b.cyl('metal_dark', tuple(base + Vector((0, 0, 0.008))), 0.03, 0.016, axis='z', n=14, bev=0.004)
            b.cyl2('metal_dark', tuple(base + Vector((0, 0, 0.012))), tuple(top), 0.009, n=8)
            b.sph('metal_dark', tuple(top), 0.016, n=10)
            e = self.eye
            nrm = (e - top).normalized()
            upv = Vector((0, 0, 1))
            upv = (upv - nrm * upv.dot(nrm)).normalized()
            sc = top + nrm * 0.016
            rt = upv.cross(nrm).normalized()
            b.plate('metal_dark', rrect2(0.2, 0.13, 0.012, 2), lambda a, bb: tuple(sc + rt * a + upv * bb), out=tuple(nrm), thick=0.014, bev=0.004)
            b.sticker('map', tuple(sc + nrm * 0.0005), tuple(nrm), tuple(upv), 0.18, 0.11, lift=0.0)
            b.box('decal', tuple(sc + rt * 0.0 + upv * -0.058 + nrm * 0.001), (0.02, 0.003, 0.004), bev=0.0) if False else None

    def armor_dash(self):
        """T3: 6 mm steel plates bolted and welded over the original dash pad"""
        C, b = self.C, self.b
        dx = C.driver_x
        xw = self.xw
        lf, lz = self.lip
        spans = [(-(xw - 0.01), -0.27), (-0.27, dx - 0.225), (dx + 0.225, xw - 0.01)]
        f_a, f_b = C.f_cowl - 0.035, lf + 0.02
        for (x0, x1) in spans:
            poly = [(x0 + 0.004, f_b), (x1 - 0.004, f_b), (x1 - 0.004, f_a), (x0 + 0.004, f_a)]

            def fr(u, v):
                return (u, v, self.pad_top(u, v) + 0.012)
            b.shell('interior', poly, fr, out=(0, 0, 1), thick=0.007, dens=0.06, bev=0.002)
            # folded front lip over the dash lip
            n = max(2, int((x1 - x0) / 0.05))
            lip = [((x0 + 0.01) + (x1 - x0 - 0.02) * i / n, f_b - 0.012, self.pad_top(x0 + (x1 - x0) * i / n, f_b) + 0.0) for i in range(n + 1)]
            b.sweep('interior', lip, [(0.012, 0.018), (-0.012, 0.018), (-0.012, -0.03), (0.012, -0.03)], up=(0, 0, 1))
            for fx in (x0 + 0.035, x1 - 0.035):
                for ff in (f_b + 0.04, f_a - 0.04):
                    b.cyl('metal_bare', (fx, ff, self.pad_top(fx, ff) + 0.019), 0.009, 0.007, axis='z', n=6, bev=0.001)
            # weld bead along the front (windshield-side) edge
            pts = [(x0 + 0.02 + (x1 - x0 - 0.04) * i / max(2, n), f_a + 0.004, self.pad_top(x0 + (x1 - x0) * i / max(2, n), f_a) + 0.014) for i in range(n + 1)]
            b.sweep('metal_bare', pts, circle_prof(0.004, 5), up=(0, 0, 1), scale=[1.0 if i % 2 == 0 else 0.75 for i in range(len(pts))])
