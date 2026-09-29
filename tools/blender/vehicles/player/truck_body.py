"""truck_body - nose of the truck: hood, fenders, grille, lamps, front bumper + generic wear helpers."""
import math
import random
from mathutils import Vector
import vlib
from vlib import *  # noqa
from parts import *  # noqa


def surf_normal(fn, u, v, out, e=0.01):
    p = Vector(fn(u, v))
    du = Vector(fn(u + e, v)) - p
    dv = Vector(fn(u, v + e)) - p
    n = du.cross(dv)
    if n.length < 1e-9:
        return Vector(out).normalized()
    n.normalize()
    if n.dot(Vector(out)) < 0:
        n = -n
    return n


class BodyMixin:
    # ------------------------------------------------------------------------------------------- wear helpers
    def patch(self, pt, fn, out, u, v, r, mat='rust', lift=0.003, thick=0.004, seed=0, elong=(1.0, 1.0), hole=False, satellite=False):
        rnd = random.Random(seed * 131 + 7)
        ph = [rnd.uniform(0, 6.28) for _ in range(5)]
        n = 9 if satellite else 16
        poly = []
        for i in range(n):
            a = 2 * math.pi * i / n
            rr = r * (1 + 0.20 * math.sin(2 * a + ph[0]) + 0.13 * math.sin(3 * a + ph[1]) + 0.10 * math.sin(5 * a + ph[2])
                      + 0.07 * math.sin(9 * a + ph[3]) + rnd.uniform(-0.07, 0.07))
            poly.append((u + rr * math.cos(a) * elong[0], v + rr * math.sin(a) * elong[1]))

        def fn2(uu, vv, lift=lift):
            p = Vector(fn(uu, vv))
            nrm = surf_normal(fn, uu, vv, out)
            return tuple(p + nrm * lift)
        if satellite:
            pt.plate(mat, poly, fn2, out, thick=thick, bev=0.0)
            return
        pt.shell(mat, poly, fn2, out, thick=thick, dens=max(0.04, r * 0.8), bev=0.0, edge_dens=max(0.03, r * 0.5), seed=seed)
        if hole:
            poly2 = [(u + (p[0] - u) * 0.40, v + (p[1] - v) * 0.40) for p in poly]

            def fn3(uu, vv):
                p = Vector(fn(uu, vv))
                nrm = surf_normal(fn, uu, vv, out)
                return tuple(p + nrm * (lift + 0.003))
            pt.shell('metal_dark', poly2, fn3, out, thick=0.003, dens=max(0.03, r * 0.5), bev=0.0, seed=seed + 1)

    def patches(self, pt, fn, out, specs, hole_every=3):
        """Rust patches; specs = (u, v, r[, (eu, ev)]).  Each main patch spawns two little satellites (corrosion creep)."""
        for i, s in enumerate(specs):
            u, v, r = s[:3]
            el = s[3] if len(s) > 3 else (1.0, 1.0)
            sd = i + int(abs(u * 100))
            self.patch(pt, fn, out, u, v, r, seed=sd, hole=(i % hole_every == 1) and r > 0.05, elong=el)
            rnd = random.Random(sd + 99)
            for q in range(2):
                a = rnd.uniform(0, 6.28)
                d = r * rnd.uniform(1.3, 1.9)
                self.patch(pt, fn, out, u + math.cos(a) * d * el[0], v + math.sin(a) * d * el[1], r * rnd.uniform(0.22, 0.38), seed=sd * 3 + q, elong=el, satellite=True)

    # ------------------------------------------------------------------------------------------- hood
    def hood(self):
        C, k = self.C, self.k
        fr0, fr1 = C.f_cowl + 0.014, C.f_grille + 0.035
        hw = C.hood_hw - 0.007
        zr, zf, crown = C.z_hood_r, C.z_hood_f, C.hood_crown
        pt = self.part('panel_hood', (0, C.f_cowl, zr))
        self.hood_z = None

        def zs(x, f):
            t = (f - fr0) / (fr1 - fr0)
            z = zr + (zf - zr) * t - 0.012 * math.sin(math.pi * t)
            z += crown * (1 - (x / hw) ** 2)
            d = f - (fr1 - 0.13)
            if d > 0:
                z -= 0.075 * (d / 0.13) ** 2
            e = abs(x) - (hw - 0.07)
            if e > 0:
                z -= 0.065 * (e / 0.07) ** 2
            return z
        self.hood_zs = zs

        def fn(u, v):
            return (u, v, zs(u, v))
        poly = rrect_poly(-hw, fr0, hw, fr1, 0.0, 4, r_tl=0.02, r_tr=0.02, r_bl=0.07 * k, r_br=0.07 * k)
        dent = None
        if C.dents:
            dent = [(0.25, 1.9 * k, 0.24, 0.008), (-0.35, 1.45, 0.20, 0.006), (0.05, 1.2, 0.16, 0.005)]
        holes = []
        cut = getattr(C, 'hood_cutout', None)
        if cut:
            holes.append(rrect_poly(cut[0], cut[1], cut[2], cut[3], 0.03, 3))
        pt.shell('paint', poly, fn, out=(0, 0, 1), thick=0.028, dens=C.dense, holes=holes, bev=0.006, dent=dent, m2='metal_dark', seed=3)
        # press ridges
        for sx in (-0.26 * k, 0.26 * k):
            path = [(sx, fr0 + 0.10, zs(sx, fr0 + 0.10) + 0.004), (sx, (fr0 + fr1) / 2, zs(sx, (fr0 + fr1) / 2) + 0.004), (sx * 0.93, fr1 - 0.22, zs(sx * 0.93, fr1 - 0.22) + 0.004)]
            path = [(x, f, zs(x, f) + 0.004) for x, f in [(p[0], p[1]) for p in self._resample(path, 14)]]
            pt.sweep('paint', path, [(0.028, 0.0), (0.02, 0.008), (-0.02, 0.008), (-0.028, 0.0), (-0.02, -0.004), (0.02, -0.004)], up=(1, 0, 0))
        # hinges + latch on the underside
        for sg in (1, -1):
            pt.box('metal_dark', (sg * (hw - 0.12), fr0 + 0.03, zr - 0.035), (0.09, 0.06, 0.03), bev=0.005)
        pt.box('metal_dark', (0, fr1 - 0.06, zf - 0.10), (0.10, 0.03, 0.06), bev=0.005)
        # under-hood stiffeners
        for sx in (-0.30 * k, 0.0, 0.30 * k):
            pt.box('metal_dark', (sx, (fr0 + fr1) / 2, zs(sx, (fr0 + fr1) / 2) - 0.036), (0.05, (fr1 - fr0) * 0.8, 0.012), bev=0.003)
        if C.rust_patches:
            specs = [(0.42, fr1 - 0.05, 0.07, (2.2, 0.8)), (-0.30, fr1 - 0.04, 0.05, (2.0, 0.8)), (0.60, 1.55, 0.05, (0.8, 2.0)), (-0.15, fr0 + 0.05, 0.05, (2.4, 0.7)), (0.30, 1.9, 0.045)]
            self.patches(pt, fn, (0, 0, 1), specs[:max(2, C.rust_patches // 3)])

    def _resample(self, path, n):
        pts = [Vector(p) for p in path]
        # simple Catmull-like resample through the polyline by linear interpolation
        out = []
        L = [0.0]
        for i in range(1, len(pts)):
            L.append(L[-1] + (pts[i] - pts[i - 1]).length)
        for i in range(n):
            d = L[-1] * i / (n - 1)
            j = max(1, next((q for q in range(1, len(L)) if L[q] >= d), len(L) - 1))
            t = (d - L[j - 1]) / max(L[j] - L[j - 1], 1e-9)
            out.append(tuple(pts[j - 1] + (pts[j] - pts[j - 1]) * t))
        return out

    # ------------------------------------------------------------------------------------------- fenders
    def fenders(self):
        C, k = self.C, self.k
        hwf = C.fender_hw
        zb = C.z_sill + 0.02
        zt = C.fender_top
        x_in = C.hood_hw + 0.007
        rsh = 0.085 * k
        Ls = zt - 0.03 - rsh - zb
        La = math.pi / 2 * rsh
        Lt = hwf - rsh - x_in
        S = Ls + La + Lt
        f0, f1 = C.f_df + 0.008, C.f_grille + 0.03
        ar = C.arch_R
        zc = C.R
        flare = 0.05 if C.fender_flare else 0.0

        def sec(s):
            if s <= Ls:
                return hwf, zb + s
            if s <= Ls + La:
                th = (s - Ls) / rsh
                cx, cz = hwf - rsh, zb + Ls
                return cx + rsh * math.cos(th), cz + rsh * math.sin(th)
            t = s - Ls - La
            return hwf - rsh - t, zt - 0.03
        for sg in (1, -1):
            name = 'panel_fender_' + ('L' if sg > 0 else 'R')
            pt = self.part(name, (sg * (hwf - 0.05), (f0 + f1) / 2, zt - 0.1))

            def fn(u, v, sg=sg):
                x, z = sec(v)
                if flare and v <= Ls + La * 0.5:
                    d = math.hypot(u - C.fa, zb + min(v, Ls) - zc)
                    x += flare * (1 - smoothstep(ar, ar + 0.10, d))
                return (sg * x, u, z)
            arc = arch_arc(C.fa, zc - zb, ar, 0.0)
            poly = [(f0, 0.0)] + arc + [(f1 - 0.03, 0.0), (f1, 0.03), (f1, S - 0.03), (f1 - 0.03, S), (f0 + 0.03, S), (f0, S - 0.03)]
            dent = None
            if C.dents:
                dent = [(f1 - 0.35, 0.45, 0.18, 0.009), (f0 + 0.15, 0.30, 0.12, 0.006)] if sg > 0 else [(f1 - 0.55, 0.55, 0.22, 0.012), (f1 - 0.2, Ls - 0.05, 0.14, 0.007)]
            pt.shell('paint', poly, fn, out=(sg, 0, 0.5), thick=0.026, dens=C.dense, bev=0.005, dent=dent, m2='metal_dark', seed=11 + sg)
            # rolled lip around the wheel arch
            lip = []
            for (f, v) in arc:
                x, z = sec(v)
                d = 0
                lip.append(fn(f, v))
            lip = [(p[0] + sg * 0.004, p[1], p[2]) for p in lip]
            pt.sweep('paint', lip, circle_prof(0.012 * k, 6, 1.0, 0.7), up=(1, 0, 0))
            if flare:
                # extra bolted flare band
                band = []
                for (f, v) in arch_arc(C.fa, zc - zb, ar + 0.055, 0.0):
                    band.append((sg * (hwf + flare * 0.6), f, zb + v))
                pt.sweep('plastic', band, [(0.022, 0.0), (0.018, 0.02), (-0.018, 0.02), (-0.022, 0.0), (-0.018, -0.02), (0.018, -0.02)], up=(1, 0, 0), scale=None)
                bolt_pts = band[1:-1:2]
                for b_ in bolt_pts:
                    pt.cyl('metal_bare', (b_[0] + sg * 0.024, b_[1], b_[2]), 0.007, 0.006, axis='x', n=6)
            # side marker
            pt.box('light_amber', (sg * (hwf + 0.003), f1 - 0.12, zb + 0.44), (0.012, 0.075, 0.035), bev=0.004, seg=1)
            # mud flap behind the front wheel
            fl = C.fa - ar - 0.03
            if C.tier < 4:
                pt.box('rubber', (sg * (hwf - 0.03), C.fa - 0.47 * k, zb - 0.02), (0.012, 0.22, 0.24), bev=0.004, seg=1)
            if C.rust_patches:
                specs = [(C.fa - ar - 0.05, 0.07, 0.07, (1.8, 0.7)), (C.fa + ar + 0.10, 0.06, 0.08, (2.0, 0.6)), (f1 - 0.15, 0.10, 0.05, (1.5, 0.8)), (C.fa + 0.30, 0.75, 0.04, (0.8, 1.6))]
                if sg > 0:
                    specs += [(f0 + 0.08, 0.30, 0.05, (0.7, 2.0))]
                self.patches(pt, fn, (sg, 0, 0.3), specs[:max(1, C.rust_patches // 3)])

    # ------------------------------------------------------------------------------------------- nose: grille, lamps, bumper
    def front_end(self):
        C, b, k = self.C, self.b, self.k
        fg = C.f_grille
        hx = C.hood_hw - 0.03
        zl = C.z_hood_f - 0.19 * k
        # backing panel + surround
        b.box('metal_dark', (0, fg - 0.03, zl - 0.02), (2 * (C.fender_hw - 0.02), 0.05, 0.47 * k), bev=0.008)
        # grille
        gw = (hx - 0.25 * k) * 2 * 0.98
        gh = 0.30 * k
        gm = 'chrome' if C.tier >= 2 else 'metal_bare'
        b.box('metal_dark', (0, fg + 0.006, zl - 0.02), (gw, 0.03, gh), bev=0.006)
        nsl = 6 if C.tier == 1 else 7
        for i in range(nsl):
            z = zl - 0.02 - gh / 2 + gh * (i + 0.5) / nsl
            b.box(gm, (0, fg + 0.028, z), (gw - 0.02, 0.028, gh / nsl * 0.55), bev=0.005)
        for sx in (-1, 0, 1):
            b.box(gm, (sx * (gw / 2 - 0.01) if sx else 0, fg + 0.03, zl - 0.02), (0.022, 0.03, gh), bev=0.005)
        b.box(gm, (0, fg + 0.03, zl - 0.02 + gh / 2 + 0.008), (gw + 0.03, 0.03, 0.02), bev=0.005)
        b.box(gm, (0, fg + 0.03, zl - 0.02 - gh / 2 - 0.008), (gw + 0.03, 0.03, 0.02), bev=0.005)
        # emblem
        b.cyl('chrome', (0, fg + 0.048, zl - 0.02), 0.03 * k, 0.012, axis='f', n=14, bev=0.003)
        # headlamps
        for sg, nm in ((1, 'L'), (-1, 'R')):
            lp = Part('lamp_head_' + nm, origin=(sg * (hx - 0.06 * k), fg + 0.02, zl))
            self.parts[lp.name] = lp
            if C.tier == 1:
                headlamp(b, lp, (sg * (hx - 0.06), fg + 0.01, zl), sg, w=0.25, h=0.15, kind='rect', bezel='metal_bare')
            else:
                headlamp(b, lp, (sg * (hx - 0.10 * k), fg + 0.01, zl), sg, w=0.21 * k, kind='round', bezel='chrome')
            # turn signal / marker
            b.box('metal_dark', (sg * (hx - 0.06), fg + 0.005, zl - 0.17 * k), (0.17, 0.03, 0.07), bev=0.006)
            b.box('light_amber', (sg * (hx - 0.06), fg + 0.022, zl - 0.17 * k), (0.14, 0.012, 0.045), bev=0.006, seg=1)
        # valance under the bumper
        b.box('metal_dark', (0, fg - 0.02, C.rail_z + 0.30 * k), (2 * (C.fender_hw - 0.10), 0.05, 0.14 * k), bev=0.008)
        # tow hooks
        for sg in (1, -1):
            b.tube('rust' if C.tier == 1 else 'metal_dark', [(sg * 0.32, C.f_nose - 0.16, C.rail_z + 0.06), (sg * 0.32, C.f_nose + 0.02, C.rail_z + 0.06), (sg * 0.32, C.f_nose + 0.05, C.rail_z - 0.02), (sg * 0.32, C.f_nose - 0.04, C.rail_z - 0.04)], 0.014, n=6, rad=0.03, k=2)

    def bumper_front(self):
        C, k = self.C, self.k
        fn_ = C.f_nose
        zc = C.rail_z + 0.13 * k
        pt = self.part('panel_bumper_F', (0, fn_ - 0.06, zc))
        hw = C.fender_hw - 0.02
        path = [(hw - 0.02, fn_ - 0.32, zc), (hw, fn_ - 0.12, zc), (hw - 0.14, fn_, zc), (-(hw - 0.14), fn_, zc), (-hw, fn_ - 0.12, zc), (-(hw - 0.02), fn_ - 0.32, zc)]
        pts = fillet_path([Vector(p) for p in path], 0.12, 5)
        pt.sweep('metal_bare' if C.tier == 1 else 'metal_dark', [(p[0], p[1], p[2]) for p in pts], cprof_bumper(0.06 * k, 0.16 * k), up=(0, 0, 1))
        # bolts, plate, ends
        for sx in (-0.42, 0.42):
            pt.cyl('metal_dark', (sx, fn_ + 0.02, zc), 0.014, 0.012, axis='f', n=8)
        pt.box('metal_bare', (0, fn_ + 0.008, zc + 0.005), (0.36, 0.012, 0.16), bev=0.003)
        for sx in (-0.15, 0.15):
            for sz in (-0.04, 0.04):
                pt.cyl('metal_dark', (sx, fn_ + 0.016, zc + sz), 0.006, 0.006, axis='f', n=6)
        if C.tier == 1:
            for sx in (-0.7, 0.62):
                self.patch(pt, lambda u, v: (u, fn_ + 0.032, v), (0, 1, 0), sx, zc, 0.06, hole=False, seed=int(abs(sx) * 10))


def cprof_bumper(depth, h):
    """C channel: opening toward +a (rearward at the centre of a left->right sweep)."""
    t = 0.008
    return [(-depth / 2, h / 2), (depth / 2, h / 2), (depth / 2, h / 2 - t), (-depth / 2 + t, h / 2 - t), (-depth / 2 + t, -h / 2 + t), (depth / 2, -h / 2 + t), (depth / 2, -h / 2), (-depth / 2, -h / 2)]
