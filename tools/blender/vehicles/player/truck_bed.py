"""truck_bed - cargo bed, tailgate, rear bumper, tail lamps, gunner frame, sockets."""
import math
import random
from mathutils import Vector
import vlib
from vlib import *  # noqa
from parts import *  # noqa


class BedMixin:
    def bed(self):
        C, b, k = self.C, self.b, self.k
        hwi = C.bed_hw - C.bed_wall_t
        fb0, fb1 = C.f_bf - 0.03, C.f_tail + 0.05
        zbd, ztop = C.z_bed, C.bed_top
        zb = zbd - 0.30 * k
        # ---- floor: deck + ribs
        b.box('metal_dark', (0, (fb0 + fb1) / 2, zbd - 0.018), (2 * hwi - 0.01, fb0 - fb1, 0.036), bev=0.006)
        nrib = int(2 * hwi / 0.16)
        for i in range(nrib):
            x = -hwi + 0.08 + i * (2 * hwi - 0.08) / (nrib - 1)
            b.box('metal_dark', (x, (fb0 + fb1) / 2, zbd + 0.007), (0.055, fb0 - fb1 - 0.04, 0.016), bev=0.0, taper=(0.75, 1.0))
        # rust in the floor: darker strips + worn bare metal near the tailgate
        if C.rust_patches:
            for i in range(3):
                b.box('rust', (-hwi + 0.30 + i * 0.55, fb1 + 0.2 + i * 0.08, zbd + 0.016), (0.28, 0.25, 0.003), bev=0.0015, seg=1)
        # ---- bed sides (outer skin with wheel arch), inner wall, top rail
        ar = C.arch_R
        for sg in (1, -1):
            f0, f1 = C.f_tail + 0.004, C.f_bf - 0.004
            hx = C.bed_hw
            poly = [(f0, zb + 0.02)]
            arc = arch_arc(C.ra, C.R, ar, zb)
            poly = [(f0 + 0.02, zb), ] + arc + [(f1 - 0.02, zb), (f1, zb + 0.02), (f1, ztop - 0.02), (f1 - 0.02, ztop), (f0 + 0.02, ztop), (f0, ztop - 0.02), (f0, zb + 0.02)]
            flare = 0.045 if C.fender_flare else 0.0

            def fn(u, v, sg=sg, hx=hx, flare=flare):
                x = hx - 0.032 * smoothstep(ztop - 0.09, ztop, v)
                if flare:
                    d = math.hypot(u - C.ra, min(v, C.R + ar) - C.R)
                    x += flare * (1 - smoothstep(ar, ar + 0.10, d))
                return (sg * x, u, v)
            dent = None
            if C.dents:
                dent = [(C.ra - 0.7, zbd + 0.2, 0.22, 0.010), (C.f_tail + 0.3, zbd + 0.05, 0.14, 0.008)] if sg > 0 else [(C.ra + 0.45, zbd + 0.25, 0.24, 0.014)]
            b.shell('paint', poly, fn, out=(sg, 0, 0), thick=0.024, dens=C.dense * 1.2, bev=0.005, dent=dent, m2='metal_dark', seed=61 + sg)
            # inner wall
            b.plate('metal_dark', [(p[0], p[1]) for p in poly], lambda u, v, sg=sg: (sg * (hx - C.bed_wall_t), u, v), out=(-sg, 0, 0), thick=0.012, bev=0.003)
            # stamped body-line ribs (outside)
            for zr_ in (zbd + 0.10 * k, zbd + 0.21 * k):
                pth = [(fn(f, zr_)[0] + sg * 0.003, f, zr_) for f in [f0 + 0.05 + (f1 - f0 - 0.1) * i / 12 for i in range(13)]
                       if not (abs(f - C.ra) < ar + 0.06 and zr_ < C.R + ar + 0.02)]
                # split around the arch
                seg_pts = []
                for p in pth:
                    seg_pts.append(p)
                if len(seg_pts) > 2:
                    lo = [p for p in seg_pts if p[1] > C.ra]
                    hi = [p for p in seg_pts if p[1] <= C.ra]
                    for grp in (lo, hi):
                        if len(grp) > 1:
                            b.sweep('paint', grp, [(0.0, 0.010), (0.016, 0.0), (0.0, -0.01), (-0.016, 0.0)], up=(1, 0, 0))
            # top rail cap
            rail = [(sg * (hx - 0.032), f0 + 0.02 + (f1 - f0 - 0.04) * i / 10, ztop + 0.004) for i in range(11)]
            b.sweep('paint', rail[::2] + [rail[-1]], rrect_prof(0.085, 0.032, 0.013, 1), up=(0, 0, 1))
            b.sweep('metal_bare' if C.tier < 3 else 'metal_dark', [(p[0] - sg * 0.02, p[1], p[2] + 0.014) for p in rail], rrect_prof(0.03, 0.006, 0.002, 1), up=(0, 0, 1))
            # stake pockets
            for fp in (f1 - 0.25, (f0 + f1) / 2 - 0.1, f0 + 0.35):
                b.box('metal_dark', (sg * (hx - 0.05), fp, ztop - 0.03), (0.045, 0.08, 0.05), bev=0.0)
            # rolled arch lip (rounded)
            lip = [(fn(f, v)[0] + sg * 0.004, f, v) for (f, v) in arc]
            b.sweep('paint', lip, circle_prof(0.012 * k, 6, 1.0, 0.7), up=(1, 0, 0))
            if flare:
                band = [(sg * (hx + flare * 0.6), f, v) for (f, v) in arch_arc(C.ra, C.R, ar + 0.055, zb)]
                b.sweep('plastic', band, [(0.022, 0.0), (0.018, 0.02), (-0.018, 0.02), (-0.022, 0.0), (-0.018, -0.02), (0.018, -0.02)], up=(1, 0, 0))
                for p in band[1:-1:2]:
                    b.cyl('metal_bare', (p[0] + sg * 0.024, p[1], p[2]), 0.007, 0.006, axis='x', n=6)
            # tie-down rings
            b.torus('metal_dark', (sg * (hwi - 0.005), f1 - 0.18, zbd + 0.15), 0.028, 0.006, axis='x', nR=10, nr=4)
            if C.rust_patches:
                specs = [(C.ra + ar + 0.02, zb + 0.06, 0.08, (1.8, 0.7)), (C.f_tail + 0.12, zb + 0.10, 0.08, (0.8, 1.7)), (C.ra - ar - 0.25, zb + 0.06, 0.06, (2.0, 0.7)), (C.f_bf - 0.35, ztop - 0.03, 0.05, (2.2, 0.6))]
                self.patches_b(fn, sg, specs)
        # ---- front wall (headache board) + rear cab back cover
        b.box('paint', (0, C.f_bf + 0.03, zbd + (ztop + 0.14 - zbd) / 2), (2 * hwi, 0.05, ztop + 0.14 - zbd), bev=0.01)
        for i in range(5):
            x = -hwi + 0.25 + i * (2 * hwi - 0.5) / 4
            b.box('paint', (x, C.f_bf - 0.006, zbd + 0.20), (0.07, 0.014, 0.28), bev=0.006, taper=(1, 1))
        # ---- fuel filler (left side)
        fx = C.bed_hw + 0.002
        b.cyl('metal_dark', (fx - 0.01, C.f_bf - 0.42, ztop - 0.12), 0.062, 0.03, axis='x', n=16, bev=0.004)
        b.cyl('chrome', (fx + 0.004, C.f_bf - 0.42, ztop - 0.12), 0.046, 0.016, axis='x', n=16, bev=0.003)
        b.cyl('metal_dark', (fx + 0.014, C.f_bf - 0.42, ztop - 0.12), 0.02, 0.012, axis='x', n=8)
        b.box('paint', (fx - 0.006, C.f_bf - 0.42, ztop - 0.05), (0.006, 0.09, 0.02), bev=0.002, seg=1)

    def patches_b(self, fn, sg, specs):
        # rust decals directly on the body mesh
        self.patches(self.b, fn, (sg, 0, 0.2), specs, hole_every=2)

    # ----------------------------------------------------------------------------------------------- tailgate + rear bumper + lamps
    def rear_end(self):
        C, k = self.C, self.k
        b = self.b
        hwi = C.bed_hw - C.bed_wall_t
        zbd, ztop = C.z_bed, C.bed_top
        zt0, zt1 = zbd - 0.22 * k, ztop - 0.03
        ft = C.f_tail
        pt = self.part('panel_tailgate', (0, ft, zt0 + 0.02))
        hw = hwi - 0.002 + 0.0

        def fn(u, v):
            return (u, ft - 0.006 - 0.008 * (1 - (u / hw) ** 2), v)
        poly = rrect_poly(-hw, zt0, hw, zt1, 0.03, 3)
        dent = [(0.35, (zt0 + zt1) / 2 + 0.06, 0.22, 0.010)] if C.dents else None
        pt.shell('paint', poly, fn, out=(0, -1, 0), thick=0.026, dens=C.dense * 1.2, bev=0.005, dent=dent, m2='metal_dark', seed=71)
        # embossed panel frames
        zc = (zt0 + zt1) / 2
        for (x0, x1) in ((-hw + 0.08, -0.06), (0.06, hw - 0.08)):
            zz0, zz1 = zt0 + 0.07, zt1 - 0.07
            pth = [(x0, zz0), (x1, zz0), (x1, zz1), (x0, zz1)]
            pth = [(p[0], fn(p[0], p[1])[1] - 0.005, p[1]) for p in pth]
            pt.sweep('paint', pth, [(0.0, 0.009), (0.02, 0.0), (0.0, -0.009), (-0.02, 0.0)], closed=True, up=(0, 1, 0)) if False else None
            pt.sweep('paint', pth, rrect_prof(0.024, 0.009, 0.003, 1), closed=True, up=(0, 1, 0))
        # handle + latch + hinges
        pt.box('metal_dark', (0, ft - 0.022, zt1 - 0.06), (0.30, 0.02, 0.07), bev=0.008)
        pt.box('chrome' if C.tier == 1 else 'metal_bare', (0, ft - 0.036, zt1 - 0.06), (0.24, 0.018, 0.028), bev=0.008)
        for sx in (-hw + 0.05, hw - 0.05):
            pt.box('metal_dark', (sx, ft + 0.008, zt0 + 0.02), (0.07, 0.03, 0.06), bev=0.005)
            pt.cyl('metal_bare', (sx, ft + 0.008, zt0 + 0.02), 0.014, 0.09, axis='x', n=8)
        # chains
        for sg in (1, -1):
            x = sg * (hw - 0.03)
            p0 = Vector((x, ft + 0.004, zbd + 0.10 * k))
            p1 = Vector((x + sg * 0.01, ft + 0.30, zbd + 0.05))
            n_l = 5
            for i in range(n_l):
                t = i / (n_l - 1)
                c = p0 + (p1 - p0) * t
                c.z -= 0.02 * math.sin(math.pi * t)
                pt.torus('metal_dark', tuple(c), 0.013, 0.0038, axis='x' if i % 2 else 'z', nR=8, nr=4, sc=1.0)
        if C.rust_patches:
            self.patches(pt, fn, (0, -1, 0), [(-0.55, zt0 + 0.05, 0.08, (2.2, 0.7)), (0.62, zt0 + 0.05, 0.06, (2.0, 0.7)), (-0.2, zt1 - 0.04, 0.05, (2.0, 0.6))][:max(1, C.rust_patches // 5)])
        # ---- rear bumper
        zc = C.rail_z + 0.12 * k
        rb = self.part('panel_bumper_R', (0, ft - 0.14, zc))
        fr = ft - 0.12
        hw2 = C.bed_hw - 0.01
        path = [(hw2 - 0.02, fr + 0.16, zc), (hw2, fr + 0.04, zc), (hw2 - 0.12, fr - 0.06, zc), (-(hw2 - 0.12), fr - 0.06, zc), (-hw2, fr + 0.04, zc), (-(hw2 - 0.02), fr + 0.16, zc)]
        pts = fillet_path([Vector(p) for p in path], 0.10, 5)
        # rear bumper: C channel facing forward (sweep runs +x -> -x at the rear, 'a' axis points forward there) -> mirror the profile
        from truck_body import cprof_bumper
        prof = [(-a, b_) for (a, b_) in cprof_bumper(0.07 * k, 0.19 * k)]
        rb.sweep('metal_bare' if C.tier < 3 else 'metal_dark', [(p[0], p[1], p[2]) for p in reversed(pts)], prof, up=(0, 0, 1))
        # step plate on top
        rb.box('metal_bare' if C.tier < 3 else 'armor', (0, fr - 0.05, zc + 0.10 * k), (1.1 * k, 0.11, 0.014), bev=0.005)
        for i in range(9):
            rb.box('metal_dark', (-0.44 * k + i * 0.11 * k, fr - 0.05, zc + 0.108 * k), (0.02, 0.08, 0.004), bev=0.001, seg=1)
        # licence plate + lamp
        rb.box('metal_bare', (0, fr - 0.075, zc + 0.02), (0.315, 0.008, 0.155), bev=0.003)
        rb.box('metal_dark', (0, fr - 0.081, zc + 0.02), (0.29, 0.003, 0.13), bev=0.001, seg=1)
        for i in range(6):
            rb.box('metal_bare', (-0.11 + i * 0.044, fr - 0.083, zc + 0.03), (0.024, 0.002, 0.05), bev=0.0005, seg=1)
        for sx in (-0.13, 0.13):
            rb.cyl('metal_bare', (sx, fr - 0.081, zc - 0.03), 0.007, 0.005, axis='f', n=6)
        rb.box('metal_dark', (0, fr - 0.06, zc + 0.115), (0.07, 0.02, 0.014), bev=0.003, seg=1)
        # tow hitch receiver
        b.box('metal_dark', (0, C.f_tail - 0.03, C.rail_z - 0.01), (0.16, 0.18, 0.13), bev=0.012)
        # ---- tail lamps
        for sg, nm in ((1, 'L'), (-1, 'R')):
            lp = Part('lamp_tail_' + nm, origin=(sg * (C.bed_hw - 0.06), ft - 0.01, zbd + 0.17 * k))
            self.parts[lp.name] = lp
            taillamp(b, lp, (sg * (C.bed_hw - 0.06), ft - 0.008, zbd + 0.17 * k), sg, w=0.095 * k, h=0.24 * k)
            b.box('light_amber', (sg * (C.bed_hw + 0.004), ft + 0.03, zbd + 0.17 * k), (0.008, 0.06, 0.06), bev=0.003, seg=1)

    # ----------------------------------------------------------------------------------------------- gunner frame (per-tier style)
    def gunner_frame(self):
        C, b, k = self.C, self.b, self.k
        hwi = C.bed_hw - C.bed_wall_t
        zbd = C.z_bed
        zr = zbd + 0.95
        fmid = (C.f_bf + C.f_tail) / 2
        style = getattr(C, 'frame_style', 'ring')
        self.gunner_f = fmid - 0.02
        self.ring_post_fr = (-(hwi - 0.08), C.f_bf - 0.10 - 0.22)
        if style == 'ring':
            r_pipe = 0.021
            xr = hwi - 0.08
            f0, f1 = C.f_bf - 0.10, C.f_tail + 0.10
            ring = [(xr, f0, zr), (xr, f1, zr), (-xr, f1, zr), (-xr, f0, zr)]
            b.tube('metal_dark', ring, r_pipe, n=8, rad=0.22, k=4, closed=True)
            # weld beads + grip wraps
            mid_ring = [(xr, f0 - 0.0, zr), (-xr, f0, zr)]
            for (px, pf) in ((xr, f0 + 0.25), (-xr, f0 + 0.25), (xr, f1 - 0.25), (-xr, f1 - 0.25)):
                pass
            # posts: floor -> ring (six of them)
            posts = [(xr, f0 + 0.22), (-xr, f0 + 0.22), (xr, fmid), (-xr, fmid), (xr, f1 - 0.22), (-xr, f1 - 0.22)]
            for (px, pf) in posts:
                b.tube('metal_dark', [(px, pf, zbd), (px, pf, zr)], r_pipe, n=8)
                b.box('metal_dark', (px, pf, zbd + 0.006), (0.10, 0.10, 0.012), bev=0.004)
                bolt_circle(b, (px, pf, zbd + 0.014), 0.036, 4, 0.006, axis='z', plane='xy', h=0.006, m='metal_bare')
                b.sph('metal_bare', (px, pf, zr), r_pipe * 1.35, n=6, sc=(1, 1, 0.5))
            # diagonal braces to the bed rails
            for sg in (1, -1):
                for pf in (f0 + 0.22, f1 - 0.22):
                    b.tube('metal_dark', [(sg * xr, pf, zr - 0.05), (sg * (hwi + 0.02), pf + (0.16 if pf < fmid else -0.16), C.bed_top)], r_pipe * 0.8, n=8)
            # front hoop cross bar behind the cab (low bar)
            b.tube('metal_dark', [(xr, f0 + 0.22, zbd + 0.42), (-xr, f0 + 0.22, zbd + 0.42)], r_pipe * 0.9, n=8)
            # rope wrap grips on the front rail
            b.tube('canvas', [(0.25, f0 + 0.0, zr), (-0.25, f0, zr)], r_pipe * 1.28, n=10)
        # gunner socket
        return

    def sockets(self):
        C, k = self.C, self.k
        hwi = C.bed_hw - C.bed_wall_t
        S = []
        dx = C.driver_x
        S.append(socket('seat_driver', (dx, C.seat_f - 0.03, C.seat_z + 0.10)))
        wc = self.wheel_c
        S.append(socket('steering_wheel', wc, rot=(-25, 0, 0)))
        S.append(socket('seat_gunner', (0, self.gunner_f, C.z_bed + 0.005)))
        hx = C.hood_hw - 0.03
        zl = C.z_hood_f - 0.19 * k
        for sg, nm in ((1, 'L'), (-1, 'R')):
            S.append(socket('light_head_' + nm, (sg * (hx - 0.06 * k), C.f_grille + 0.04, zl)))
            S.append(socket('light_tail_' + nm, (sg * (C.bed_hw - 0.06), C.f_tail - 0.03, C.z_bed + 0.17 * k), rot=(0, 180, 0)))
        tip = self.exh_tip
        ex_rot = (80, 180, 0) if getattr(C, 'exhaust_style', 'dangle') == 'stack' else (-15, 180, 0)     # stacks: smoke rises
        S.append(socket('exhaust_R', tip, rot=ex_rot))
        S.append(socket('exhaust_L', (-tip[0] if getattr(C, 'exhaust_style', 'dangle') != 'dangle' else tip[0], tip[1], tip[2]), rot=ex_rot))
        S.append(socket('smoke_engine', (0, C.fa + 0.1, C.z_hood_f - 0.16)))
        S.append(socket('fuel_cap', (C.bed_hw + 0.02, C.f_bf - 0.42, C.bed_top - 0.12), rot=(0, 90, 0)))
        for sg, nm in ((1, 'L'), (-1, 'R')):
            S.append(socket('nitro_' + nm, (sg * 0.42, C.f_tail - 0.30, C.rail_z - 0.02), rot=(0, 180, 0)))
        S.append(socket('camera_hood', (0, C.f_grille - 0.55, self.hood_zs(0, C.f_grille - 0.55) + 0.15)))
        S.append(socket('roof_top', (0, (self.ws['ft'] + C.f_back) / 2, C.z_roof + 0.03)))
        self.socks = S
