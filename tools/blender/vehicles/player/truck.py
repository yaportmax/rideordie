"""truck - parametric player-truck builder.  Everything in game coords (x left+, f forward+, z up).  See tiers.py for dims."""
import math
import random
from mathutils import Vector
import vlib
from vlib import *  # noqa
from parts import *  # noqa
from truck_body import BodyMixin
from truck_cab import CabMixin
from truck_bed import BedMixin

C_PROF = [(-0.5, 0.5), (0.5, 0.5), (0.5, 0.5 - 0.11), (-0.5 + 0.11, 0.5 - 0.11), (-0.5 + 0.11, -0.5 + 0.11), (0.5, -0.5 + 0.11), (0.5, -0.5), (-0.5, -0.5)]


def cprof(w, h, mirror=False):
    return [((-a if mirror else a) * w, b * h) for a, b in C_PROF]


class Truck(BodyMixin, CabMixin, BedMixin):
    def __init__(self, C, seed=1):
        self.C = C
        C.z_db = C.z_sill + 0.075
        self.rnd = random.Random(seed)
        self.b = Part('body')
        self.parts = {}
        self.wheels = {}
        self.k = C.R / 0.335        # scale factor vs the compact truck
        self.socks = []
        self.fns = {}          # panel surface mappings (for decals): 'hood', 'fender+1', 'door+1', ...

    # ----------------------------------------------------------------------------------------------- utils
    def part(self, name, origin):
        p = Part(name, origin=origin)
        self.parts[name] = p
        return p

    def hub(self, ax, sg):
        C = self.C
        return (sg * C.track, C.fa if ax == 'F' else C.ra, C.R)

    # ----------------------------------------------------------------------------------------------- chassis
    def chassis(self):
        C, b, k = self.C, self.b, self.k
        rx, rz = C.rail_x, C.rail_z
        fr, rr = C.f_nose - 0.30, C.f_tail - 0.16
        hrail = 0.14 * k
        for sg in (1, -1):
            path = [(sg * (rx - 0.06), fr, rz + 0.07 * k), (sg * rx, fr - 0.40, rz + 0.02), (sg * rx, C.ra + 0.4, rz), (sg * rx, rr + 0.35, rz + 0.02), (sg * rx, rr, rz + 0.09 * k)]
            b.sweep('metal_dark', path, cprof(0.075 * k, hrail, mirror=(sg < 0)), up=(0, 0, 1))
        # cross members
        ncm = 6
        for i in range(ncm):
            f = fr - 0.25 - i * (fr - rr - 0.5) / (ncm - 1)
            b.box('metal_dark', (0, f, rz + 0.02), (2 * rx + 0.02, 0.07 * k, 0.09 * k), bev=0.0)
        # bumper mounting stubs
        for sg in (1, -1):
            b.box('metal_dark', (sg * (rx - 0.04), C.f_nose - 0.22, rz + 0.06 * k), (0.09, 0.12, 0.12), bev=0.0)
            b.box('metal_dark', (sg * (rx - 0.04), C.f_tail - 0.06, rz + 0.06 * k), (0.09, 0.10, 0.12), bev=0.0)
        # axles + diffs + springs + shocks
        for ax in ('F', 'R'):
            f = C.fa if ax == 'F' else C.ra
            z = C.R
            aw = C.track - 0.16
            b.cyl('metal_dark', (0, f, z), 0.042 * k, 2 * aw, axis='x', n=12)
            for sg in (1, -1):
                b.cyl('metal_dark', (sg * (aw - 0.02), f, z), 0.058 * k, 0.15, axis='x', n=10)
                b.cyl('metal_dark', (sg * (aw + 0.04), f, z), 0.075 * k, 0.05, axis='x', n=10)
            dx = 0.05 if ax == 'F' else 0.0
            b.sph('metal_dark', (dx, f, z), 0.12 * k, n=10, sc=(1.05, 1.0, 0.95))
            sgn = 1 if ax == 'F' else -1
            b.cyl('metal_dark', (dx, f + sgn * 0.115 * k, z), 0.10 * k, 0.03, axis='f', n=14)
            b.cyl('rust' if C.tier == 1 else 'metal_bare', (dx, f + sgn * 0.132 * k, z), 0.075 * k, 0.01, axis='f', n=14)
            bolt_circle(b, (dx, f + sgn * 0.135 * k, z), 0.085 * k, 6, 0.006, axis='f', plane='xz', h=0.008, n=5)
            # pinion yoke
            b.cyl('metal_dark', (dx, f - sgn * 0.14 * k, z), 0.032, 0.09, axis='f', n=10)
            spx = rx + 0.08 * k
            for sg in (1, -1):
                zt = z + 0.06 * k
                leaf_spring(b, sg * spx, f - 0.62 * k, f + 0.62 * k, zt + 0.05, sag=0.05, leaves=4 if C.tier < 3 else 6, w=0.06 * k)
                # u-bolts + plate
                b.box('metal_dark', (sg * spx, f, z + 0.045 * k), (0.085, 0.13, 0.02), bev=0.0)
                for uf in (-0.05, 0.05):
                    for ux in (-0.036, 0.036):
                        b.cyl('metal_bare', (sg * spx + ux, f + uf, z + 0.085 * k), 0.007, 0.09 * k, axis='z', n=4)
                # spring hangers on the frame
                b.box('metal_dark', (sg * spx - sg * 0.02, f + 0.66 * k, rz + 0.02), (0.05, 0.05, 0.18 * k), bev=0.0)
                b.box('metal_dark', (sg * spx - sg * 0.02, f - 0.66 * k, rz + 0.02), (0.05, 0.05, 0.18 * k), bev=0.0)
                # shocks
                sx = C.track - 0.20 * k
                shock(b, (sg * sx, f - 0.10 * k if ax == 'R' else f + 0.12 * k, z + 0.06), (sg * (sx - 0.05), f - 0.06 * k if ax == 'R' else f + 0.08 * k, z + 0.06 + 0.32 * k), r=0.02 * k)
        # steering linkage (front)
        f = C.fa - 0.16 * k
        b.cyl('metal_dark', (0, f, C.R + 0.02), 0.014, 2 * (C.track - 0.19), axis='x', n=8)
        b.cyl2('metal_dark', (0.22, f, C.R + 0.02), (0.32, C.fa - 0.55, C.R + 0.10), 0.014, n=8)
        b.box('metal_dark', (0.30, C.fa - 0.56, C.R + 0.10), (0.09, 0.10, 0.06), bev=0.0)
        # stabiliser bar
        b.tube('metal_dark', [(C.track - 0.20, C.fa - 0.28, C.R + 0.02), (C.track - 0.20 - 0.02, C.fa - 0.12 * k, C.R + 0.02), (-(C.track - 0.20 - 0.02), C.fa - 0.12 * k, C.R + 0.02), (-(C.track - 0.20), C.fa - 0.28, C.R + 0.02)], 0.012, n=8)
        # gearbox / transfer case / driveshafts
        b.box('metal_dark', (0, C.fa - 0.72, rz + 0.05), (0.30, 0.55, 0.20), bev=0.02)
        b.box('metal_dark', (0, C.fa - 1.12, rz + 0.02), (0.22, 0.50, 0.16), bev=0.02)
        b.cyl('metal_dark', (0, C.fa - 1.52, rz + 0.0), 0.05, 0.06, axis='f', n=10)
        zs = rz - 0.02
        b.cyl2('metal_dark', (0, C.fa - 1.56, zs), (0, C.ra + 0.16, zs), 0.032 * k, n=10)
        for uf in (C.fa - 1.56, C.ra + 0.16):
            b.box('metal_dark', (0, uf, zs), (0.07, 0.06, 0.07), bev=0.0)
        b.cyl2('metal_dark', (0.05, C.fa - 0.60, zs - 0.03), (0.05, C.fa - 0.14, C.R + 0.01), 0.026 * k, n=10)
        # fuel tank + straps
        ft = C.f_tail + 0.55
        b.box('metal_dark', (0, ft - 0.25, rz - 0.02), (2 * rx - 0.16, 0.62, 0.20 * k), bev=0.03)
        for sf in (-0.1, -0.42):
            b.box('metal_bare', (0, ft + sf - 0.06, rz + 0.075 * k), (2 * rx - 0.10, 0.035, 0.012), bev=0.0)
        # skid plate (heavier trucks)
        if C.tier >= 2:
            b.box('metal_dark', (0, C.fa - 0.3, rz - 0.055 * k), (2 * rx - 0.08, 0.8, 0.02), bev=0.008)
        # under-bed cross bars (support the bed floor)
        for i in range(6):
            f = C.f_bf - 0.10 - i * ((C.f_bf - C.f_tail - 0.16) / 5)
            b.box('metal_dark', (0, f, C.z_bed - 0.045), (2 * C.bed_hw - 0.20, 0.06, 0.07), bev=0.0)
        for sg in (1, -1):
            b.box('metal_dark', (sg * (C.bed_hw - 0.16), (C.f_bf + C.f_tail) / 2, C.z_bed - 0.045), (0.07, C.f_bf - C.f_tail, 0.07), bev=0.0)
            b.box('metal_dark', (sg * (C.rail_x + 0.12), (C.f_bf + C.f_tail) / 2, C.z_bed - 0.045), (0.06, C.f_bf - C.f_tail, 0.06), bev=0.0)

    # ----------------------------------------------------------------------------------------------- exhaust
    def exhaust(self):
        C, b, k = self.C, self.b, self.k
        rz = C.rail_z
        st = getattr(C, 'exhaust_style', 'dangle')
        x = -0.30
        pipe_r = 0.032 * k
        if st == 'dangle':
            path = [(x + 0.05, C.fa + 0.28, 0.66), (x, C.fa + 0.10, 0.5), (x, C.fa - 0.05, rz - 0.06), (x, C.ra + 1.3, rz - 0.06)]
            b.tube('metal_dark', path, pipe_r, n=10, rad=0.14)
            b.sph('metal_dark', (x, C.ra + 1.3, rz - 0.06), pipe_r * 1.0, n=8)
            # muffler
            mf = C.ra + 0.95
            b.cyl('metal_dark', (x, mf, rz - 0.055), 0.085 * k, 0.72, axis='f', n=16, bev=0.012)
            b.cyl('rust', (x, mf + 0.10, rz - 0.055), 0.0865 * k, 0.16, axis='f', n=16)
            b.cyl('rust', (x, mf - 0.20, rz - 0.055), 0.0865 * k, 0.10, axis='f', n=16)
            for df in (0.28, -0.28):
                b.box('metal_bare', (x, mf + df, rz - 0.055), (0.03, 0.02, 0.19 * k), bev=0.003)
                b.box('metal_bare', (x, mf + df, rz + 0.02), (0.02, 0.04, 0.06), bev=0.003)
            # tailpipe: hangs down / broken hanger
            tail = [(x, mf - 0.36, rz - 0.055), (x, mf - 0.6, rz - 0.06), (x, C.f_tail + 0.05, rz - 0.10), (x, C.f_tail - 0.10, rz - 0.20)]
            b.tube('metal_dark', tail, pipe_r * 0.9, n=10, rad=0.10)
            b.cyl2('rust', (x, C.f_tail - 0.10, rz - 0.20), (x, C.f_tail - 0.16, rz - 0.235), pipe_r * 0.95, n=10)
            self.exh_tip = (x, C.f_tail - 0.16, rz - 0.235)
        else:
            self.exh_tip = (x, C.f_tail, rz)

    # ----------------------------------------------------------------------------------------------- wheels
    def wheels_build(self):
        C = self.C
        for ax in ('F', 'R'):
            for sg, nm in ((1, 'L'), (-1, 'R')):
                h = self.hub(ax, sg)
                name = 'wheel_%s%s' % (ax, nm)
                pt = Part(name, origin=h, mesh_name='wheel_%s_mesh' % nm)
                build_wheel(pt, h, sg, C.R, C.tw, C.rimR, style=C.wheel_style, tread=C.tread, seg=C.wheel_seg,
                            lug_pitch=C.lug_pitch, lug_depth=C.lug_depth, beadlock=C.beadlock,
                            rust=0.6 if C.tier == 1 else 0.1, drum=(C.drum_rear and ax == 'R'),
                            seed=hash((ax, nm)) % 100)
                self.wheels[name] = pt

    # ----------------------------------------------------------------------------------------------- engine bay
    def engine(self):
        C, b, k = self.C, self.b, self.k
        fe = C.fa - 0.02 * k
        z0 = C.rail_z + 0.04
        ev = (C.z_hood_f - 0.055 - z0) / (0.66 * k)     # squash the engine to fit under this hood

        def Z(dz):
            return z0 + dz * ev
        # oil pan / block / head / cover
        b.box('metal_dark', (0, fe, Z(0.03 * k + 0.02)), (0.30 * k, 0.52 * k, 0.11 * k * ev), bev=0.01, taper=(0.85, 0.9))
        b.box('metal_dark', (0, fe, Z(0.20 * k)), (0.36 * k, 0.58 * k, 0.28 * k * ev), bev=0.016)
        b.box('metal_bare', (0, fe, Z(0.375 * k)), (0.34 * k, 0.56 * k, 0.09 * k * ev), bev=0.012)
        b.box('metal_dark', (0, fe, Z(0.455 * k)), (0.28 * k, 0.46 * k, 0.07 * k * ev), bev=0.012)
        for i in range(5):
            b.box('metal_bare', (0, fe - 0.17 * k + i * 0.085 * k, Z(0.495 * k)), (0.25 * k, 0.014, 0.012), bev=0.0)
        b.cyl('chrome', (0.06 * k, fe + 0.10 * k, Z(0.50 * k)), 0.028 * k, 0.03, axis='z', n=10, bev=0.004)
        # intake manifold (left) + air cleaner
        for i in range(4):
            f = fe - 0.20 * k + i * 0.135 * k
            b.tube('metal_dark', [(0.16 * k, f, Z(0.36 * k)), (0.23 * k, f, Z(0.40 * k)), (0.12 * k, f, Z(0.47 * k))], 0.022 * k, n=8, rad=0.05, k=3)
        b.box('metal_dark', (0.11 * k, fe, Z(0.50 * k)), (0.10 * k, 0.46 * k, 0.045 * k * ev), bev=0.01)
        ac_c = (0.09 * k, fe + 0.02 * k, Z(0.56 * k))
        if not getattr(C, 'no_air_cleaner', False):
            b.cyl('metal_dark', ac_c, 0.115 * k, 0.085 * k * ev, axis='z', n=20, bev=0.01)
            b.cyl('metal_bare', (ac_c[0], ac_c[1], ac_c[2] + 0.048 * k * ev), 0.10 * k, 0.014, axis='z', n=20, bev=0.004)
            b.cyl('metal_dark', (ac_c[0], ac_c[1], ac_c[2] + 0.06 * k * ev), 0.018 * k, 0.025, axis='z', n=8)
        mx = 'rust' if C.tier == 1 else 'metal_dark'
        # exhaust manifold (right)
        b.tube(mx, [(-0.17 * k, fe - 0.22 * k, Z(0.30 * k)), (-0.22 * k, fe - 0.22 * k, Z(0.30 * k)), (-0.22 * k, fe + 0.22 * k, Z(0.30 * k))], 0.026 * k, n=8)
        for i in range(4):
            f = fe - 0.20 * k + i * 0.135 * k
            b.cyl2(mx, (-0.17 * k, f, Z(0.34 * k)), (-0.22 * k, f, Z(0.30 * k)), 0.02 * k, n=8)
        # radiator + fan
        fr = C.f_grille - 0.13
        rz = Z(0.36 * k)
        b.box('metal_dark', (0, fr, rz), (0.66 * k, 0.07, 0.50 * k * ev), bev=0.006)
        for i in range(16):
            b.box('metal_bare', (-0.30 * k + i * 0.04 * k, fr + 0.037, rz), (0.006, 0.006, 0.46 * k * ev), bev=0.0)
        b.box('metal_dark', (0, fr - 0.005, rz + 0.27 * k * ev), (0.68 * k, 0.09, 0.05), bev=0.008)
        b.box('metal_dark', (0, fr - 0.005, rz - 0.27 * k * ev), (0.68 * k, 0.09, 0.05), bev=0.008)
        b.cyl('chrome', (-0.22 * k, fr - 0.01, rz + 0.30 * k * ev), 0.028, 0.03, axis='z', n=10, bev=0.004)
        fan_f = fr - 0.13
        b.box('metal_dark', (0, fan_f + 0.04, rz), (0.60 * k, 0.06, 0.46 * k * ev), bev=0.016)
        b.cyl('metal_dark', (0, fan_f, rz), 0.028, 0.05, axis='f', n=10)
        for i in range(5):
            a = 2 * math.pi * i / 5
            b.box('metal_dark', (0.11 * k * math.cos(a), fan_f, rz + 0.11 * k * ev * math.sin(a)), (0.05, 0.012, 0.19 * k * ev), bev=0.0, rot=(12, 0, a / D2R - 90))
        # hoses
        b.tube('rubber', [(-0.24 * k, fr - 0.01, rz + 0.30 * k * ev), (-0.28 * k, fr - 0.15, rz + 0.30 * k * ev), (-0.10 * k, fe + 0.15 * k, Z(0.47 * k))], 0.022 * k, n=8, rad=0.08)
        b.tube('rubber', [(0.24 * k, fr - 0.01, rz - 0.26 * k * ev), (0.30 * k, fr - 0.16, rz - 0.24 * k * ev), (0.12 * k, fe + 0.29 * k, Z(0.22 * k))], 0.022 * k, n=8, rad=0.08)
        # alternator + belt
        b.cyl('metal_dark', (-0.16 * k, fe + 0.27 * k, Z(0.30 * k)), 0.06 * k, 0.09, axis='x', n=12)
        b.cyl('metal_bare', (-0.16 * k, fe + 0.27 * k, Z(0.30 * k)), 0.035 * k, 0.11, axis='x', n=10)
        b.torus('rubber', (0.0, fe + 0.31 * k, Z(0.20 * k)), 0.10 * k, 0.008, axis='f', nR=16, nr=5, sc=1.0)
        # battery + tray, brake booster, master cylinder, reservoir
        bx = -(C.hood_hw - 0.20)
        b.box('metal_dark', (bx, fe + 0.30 * k, Z(0.17 * k)), (0.26, 0.20, 0.03), bev=0.004)
        b.box('plastic', (bx, fe + 0.30 * k, Z(0.28 * k)), (0.24, 0.17, 0.17 * ev), bev=0.01)
        for tx in (-0.06, 0.06):
            b.cyl('chrome', (bx + tx, fe + 0.30 * k, Z(0.28 * k) + 0.09 * ev), 0.013, 0.018, axis='z', n=8)
        b.cyl('metal_dark', (C.hood_hw - 0.28, C.f_cowl + 0.09, Z(0.52 * k)), 0.10 * k, 0.16, axis='f', n=16, bev=0.008)
        b.cyl('metal_bare', (C.hood_hw - 0.28, C.f_cowl + 0.21, Z(0.52 * k)), 0.032, 0.10, axis='f', n=10)
        b.box('plastic', (C.hood_hw - 0.42, C.f_cowl + 0.16, Z(0.56 * k)), (0.08, 0.06, 0.09), bev=0.008)
        b.tube('plastic', [(C.hood_hw - 0.28, C.f_cowl + 0.10, Z(0.44 * k)), (0.15, C.f_cowl + 0.25, Z(0.42 * k)), (0.12 * k, fe - 0.20, Z(0.38 * k))], 0.007, n=5, rad=0.05)
        # wiring loom
        b.tube('plastic', [(-0.20 * k, fe - 0.30 * k, Z(0.44 * k)), (-0.32, fe - 0.4 * k, Z(0.34 * k)), (bx, fe + 0.18, Z(0.36 * k))], 0.012, n=6, rad=0.06)
        # firewall
        b.box('metal_dark', (0, C.f_cowl - 0.005, (C.z_floor + C.z_ws_base) / 2 - 0.02), (2 * C.cab_hw - 0.06, 0.02, C.z_ws_base - C.z_floor - 0.04), bev=0.0)
        # radiator support frame + front panel
        for sg in (1, -1):
            b.box('metal_dark', (sg * (C.hood_hw - 0.03), fr + 0.04, rz), (0.05, 0.09, 0.62 * k * ev), bev=0.0)
        b.box('metal_dark', (0, fr + 0.055, rz + 0.33 * k * ev), (2 * C.hood_hw, 0.05, 0.06), bev=0.006)

    # ----------------------------------------------------------------------------------------------- inner fenders
    def inner_fenders(self):
        C, b = self.C, self.b
        for sg in (1, -1):
            x = sg * (C.hood_hw - 0.015)
            f0, f1 = C.f_cowl + 0.02, C.f_grille - 0.10
            zb, zt = C.z_sill + 0.10, C.fender_top - 0.035
            ar = C.arch_R - 0.02
            zc = C.R
            pts = [(f0, zb)] + arch_arc(C.fa, zc, ar, zb) + [(f1, zb), (f1, zt), (f0, zt)]
            # x offset slightly bowl-shaped
            def fn(u, v, sg=sg, x=x):
                return (x - sg * 0.04 * smoothstep(zb, zt, v), u, v)
            b.shell('metal_dark', pts, fn, out=(-sg, 0, 0), thick=0.008, dens=0.14, bev=0.003)

    # ----------------------------------------------------------------------------------------------- everything
    def build_all(self, kit=None):
        self.chassis()
        self.exhaust()
        self.engine()
        self.inner_fenders()
        self.hood()
        self.fenders()
        self.front_end()
        self.bumper_front()
        self.windshield()
        self.cab_shell()
        self.doors()
        self.dash()
        self.seats()
        self.bed()
        self.rear_end()
        self.gunner_frame()
        if kit is not None:
            kit(self)
        self.wheels_build()
        self.sockets()
