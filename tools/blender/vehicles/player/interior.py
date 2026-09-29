"""interior - first-person cab interior of the player trucks (the most-seen model in the game).

Moulded dash with a recessed instrument binnacle (the runtime overlays a live gauge cluster there), centre stack, vents,
glovebox, switches, stickers; steering wheel as its own node `steering_wheel_mesh` (child of the `steering_wheel` socket,
spins about the socket's local Z); column + stalks + key; shifter (+ `shifter_knob` socket); A-pillar trim, headliner, sun
visors, rear-view mirror (compact 'rubber' housing with a flat rear face = live mirror glass); door cards; seats.
Game coords everywhere: x = left (+), f = forward (+), z = up.  Tier styles in STYLE.
"""
import math
import random
from mathutils import Vector
import vlib
from vlib import *  # noqa
from parts import *  # noqa

C25, S25 = math.cos(25 * D2R), math.sin(25 * D2R)
X = Vector((1.0, 0.0, 0.0))


def V(*a):
    return Vector(a if len(a) == 3 else a[0])


def fillet_poly(pts, radii, k=3):
    """Closed 2D polygon with a fillet radius per corner -> rounded polygon with exactly len(pts)*(k+1) points
    (so profiles with equal control counts can be lofted into each other)."""
    out = []
    n = len(pts)
    P2 = [Vector((p[0], p[1])) for p in pts]
    for i in range(n):
        p0, p1, p2 = P2[i - 1], P2[i], P2[(i + 1) % n]
        d0, d1 = p0 - p1, p2 - p1
        l0, l1 = d0.length, d1.length
        r = max(1e-4, min(radii[i] if isinstance(radii, (list, tuple)) else radii, l0 * 0.45, l1 * 0.45))
        a, b = p1 + d0.normalized() * r, p1 + d1.normalized() * r
        for s in range(k + 1):
            t = s / k
            q = a * (1 - t) ** 2 + p1 * (2 * (1 - t) * t) + b * (t * t)
            out.append((q.x, q.y))
    return out


def rrect2(w, h, r, k=3):
    """rounded rectangle (a, b) CCW, exactly 4*(k+1) points, starting bottom-right"""
    return fillet_poly([(w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2)], [r] * 4, k)


def smooth01(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------------ tier styles
STYLE = {
    1: dict(pad='leather', face='interior', stack='interior', accent='wood', knob='chrome', vent='metal_dark', wheel='t1',
            pad_col=(0.30, 0.18, 0.09), face_col=(0.36, 0.28, 0.18), fabric_col=(0.40, 0.30, 0.19), leather_rough=0.78),
    2: dict(pad='leather', face='interior', stack='metal_dark', accent='metal_bare', knob='chrome', vent='metal_dark', wheel='t2',
            pad_col=(0.075, 0.075, 0.078), face_col=(0.2, 0.2, 0.205), fabric_col=(0.22, 0.215, 0.2), leather_rough=0.82),
    3: dict(pad='interior', face='interior', stack='armor', accent='metal_bare', knob='metal_bare', vent='metal_dark', wheel='t3',
            pad_col=(0.06, 0.06, 0.055), face_col=(0.105, 0.115, 0.07), fabric_col=(0.14, 0.14, 0.10), leather_rough=0.6),
    4: dict(pad='fabric', face='interior', stack='interior', accent='metal_bare', knob='metal_bare', vent='metal_dark', wheel='t4',
            pad_col=(0.05, 0.05, 0.052), face_col=(0.09, 0.09, 0.095), fabric_col=(0.075, 0.075, 0.08), leather_rough=0.55),
}


class InteriorMixin:
    # =========================================================================================== frames
    def ck_setup(self):
        C, k = self.C, self.k
        dx = C.driver_x
        self.st = STYLE[C.tier]
        # driver's eye as the runtime places it (head bone of the seated driver) -- measured in game
        self.eye = Vector((dx + 0.005, C.seat_f - 0.03 + 0.19, C.seat_z + 0.10 + 0.685))
        wc = Vector((dx, C.f_cowl - 0.335 * k, C.z_ws_base - 0.055 * k))
        self.wheel_c = tuple(wc)
        self.wcv = wc
        self.col = Vector((0.0, C25, -S25))               # along the column, into the dash
        self.wy = Vector((0.0, S25, C25))                 # wheel plane 'up' (top of the rim leans forward)
        self.wn = Vector((0.0, -C25, S25))                # wheel normal, toward the driver
        c = wc + self.col * 0.2 + Vector((0, 0, 0.075))   # runtime gauge cluster centre (src/view/cockpit.js)
        n = self.eye - c
        n.x = 0.0
        n.normalize()
        u = Vector((0.0, n.z, -n.y))
        self.clu = (c, n, u)
        # dash anchors
        bl = self.cf(0, -0.095, 0.03)
        self.lip = (bl.y - 0.012, bl.z - 0.03)
        self.dash_zb = C.z_floor + 0.25 * k
        self.xw = C.cab_hw - 0.035

    def cf(self, a, b, d):
        """point in the gauge-cluster frame: a = +x (left), b = up in the face plane, d = toward the eye"""
        c, n, u = self.clu
        return c + X * a + u * b + n * d

    def wf(self, r, th, d=0.0):
        """point in the steering-wheel frame: radius r at angle th (deg, 0 = driver's left / 9 o'clock, 90 = top), d toward the driver"""
        t = th * D2R
        return self.wcv + X * (r * math.cos(t)) + self.wy * (r * math.sin(t)) + self.wn * d

    # =========================================================================================== dash
    def dash_prof(self, x):
        """dash cross-section (f, z) at lateral x: upper pad + lower face as two closed profiles"""
        C, k = self.C, self.k
        lf, lz = self.lip
        ax = abs(x)
        e = smooth01((ax - (self.xw - 0.16)) / 0.16)       # dash ends curve forward toward the doors
        lf += 0.035 * e
        lz -= 0.01 * e
        fc, zw = C.f_cowl - 0.02, C.z_ws_base - 0.02
        crown = 0.012 * (1 - (x / self.xw) ** 2)
        pad = fillet_poly([
            (fc, zw - 0.075), (fc, zw), (fc - 0.06, zw + 0.004 + crown), (lf + 0.09, lz + 0.05 + crown), (lf, lz + 0.004),
            (lf + 0.028, lz - 0.052), (lf + 0.075, lz - 0.058), (fc - 0.06, zw - 0.09)],
            [0.01, 0.012, 0.05, 0.10, 0.028, 0.02, 0.015, 0.02], 3)
        zb = self.dash_zb
        face = fillet_poly([
            (lf + 0.05, lz - 0.03), (lf + 0.028, lz - 0.05), (lf + 0.07, zb), (lf + 0.16, zb - 0.015), (fc - 0.01, zb + 0.05), (fc - 0.01, lz - 0.02)],
            [0.01, 0.012, 0.025, 0.02, 0.02, 0.01], 3)
        return pad, face

    def face_pt(self, x, t, off=0.0):
        """point on the lower dash face (t = 0 just under the lip, 1 = bottom edge) + normal offset; returns (pos, normal)"""
        lf, lz = self.lip
        e = smooth01((abs(x) - (self.xw - 0.16)) / 0.16)
        lf += 0.035 * e
        lz -= 0.01 * e
        a = Vector((x, lf + 0.028, lz - 0.05))
        b = Vector((x, lf + 0.07, self.dash_zb))
        d = (b - a).normalized()
        nrm = Vector((0.0, d.z, -d.y))           # faces rearward (and a little down)
        if nrm.y > 0:
            nrm = -nrm
        nrm.normalize()
        return a + (b - a) * t + nrm * off, nrm

    def face_frame(self, x, t, off=0.0):
        """(origin, normal, up) on the lower dash face"""
        p, nrm = self.face_pt(x, t, off)
        up = Vector((0.0, nrm.z, -nrm.y))
        if up.z < 0:
            up = -up
        return p, nrm, up

    def dash(self):
        self.ck_setup()
        C, b, k, st = self.C, self.b, self.k, self.st
        xs = []
        n = 40
        for i in range(n + 1):
            t = i / n
            xs.append(-self.xw + 2 * self.xw * (0.5 - 0.5 * math.cos(math.pi * t)))
        pads, faces = [], []
        for x in xs:
            p, f = self.dash_prof(x)
            pads.append([(x, a, z) for (a, z) in p])
            faces.append([(x, a, z) for (a, z) in f])
        b.loft_grid(st['pad'], pads)
        b.loft_grid(st['face'], faces)
        self.fd = self.lip[0]
        self.dash_z = lambda x, f: self.lip[1]
        self.binnacle()
        self.dash_details()
        self.column()
        self.steering()
        self.shifter()
        self.floor_details()
        self.cab_trim()

    # ------------------------------------------------------------------------------------------- binnacle
    def binnacle(self):
        C, b, st = self.C, self.b, self.st
        dx = C.driver_x
        rings = []
        # (w, h, r, depth_top, depth_bottom): outer back (buried) -> outer shoulder -> lip -> inner lip -> inner back
        spec = [(0.44, 0.235, 0.05, -0.12, -0.12), (0.44, 0.235, 0.05, 0.015, -0.02), (0.425, 0.222, 0.045, 0.05, 0.022),
                (0.405, 0.205, 0.04, 0.056, 0.028), (0.385, 0.19, 0.035, 0.05, 0.024), (0.36, 0.172, 0.03, -0.074, -0.074)]
        for (w, h, r, dt, db) in spec:
            ring = []
            for (a, bb) in rrect2(w, h, r, 4):
                d = db + (dt - db) * (bb + h / 2) / h
                ring.append(tuple(self.cf(a, bb - 0.005, d)))
            rings.append(ring)
        b.loft_grid(st['pad'], rings, cap=True)
        # recessed face (behind the runtime cluster) with two dials + warning lamps for anyone else looking in
        face_d = -0.07
        c0 = self.cf(0, -0.005, face_d)
        n = self.clu[1]
        b.plate('metal_dark', rrect2(0.35, 0.165, 0.028, 3), lambda a, bb: tuple(self.cf(a, bb - 0.005, face_d + 0.003)), out=tuple(n), thick=0.004, bev=0.0)
        up = tuple(self.clu[2])
        for gx, nm in ((0.085, 'g_press'), (-0.085, 'g_temp')):
            p = self.cf(gx, 0.0, face_d + 0.0075)
            b.cyl('chrome', tuple(self.cf(gx, 0.0, face_d + 0.006)), 0.058, 0.006, axis=tuple(n), n=24)
            b.sticker(nm, tuple(p), tuple(n), up, 0.1, 0.1, lift=0.0)
        b.sticker('lamps', tuple(self.cf(0, -0.055, face_d + 0.007)), tuple(n), up, 0.12, 0.03, lift=0.0)

    # ------------------------------------------------------------------------------------------- dash furniture
    def vent(self, x, t, w=0.13, h=0.055, round_=False):
        b, st = self.b, self.st
        p, nrm, up = self.face_frame(x, t, 0.0)
        fr = lambda a, bb, d=0.0: tuple(p + X * a + up * bb + nrm * d)
        if round_:
            b.cyl(st['vent'], tuple(p + nrm * 0.006), w / 2 + 0.012, 0.014, axis=tuple(nrm), n=24, bev=0.004)
            b.cyl('metal_dark', tuple(p + nrm * 0.008), w / 2, 0.016, axis=tuple(nrm), n=20)
            for i in range(5):
                yy = (i - 2) * w * 0.17
                hw = math.sqrt(max(0.0, (w / 2) ** 2 - yy ** 2)) * 0.95
                b.box('rubber', fr(0, yy, 0.013), (2 * hw, 0.004, 0.009), bev=0.0, rot=None)
            return
        b.plate(st['vent'], rrect2(w + 0.022, h + 0.02, 0.012, 2), lambda a, bb: fr(a, bb, 0.004), out=tuple(nrm), thick=0.012, bev=0.003)
        b.plate('metal_dark', rrect2(w, h, 0.006, 2), lambda a, bb: fr(a, bb, 0.0165), out=tuple(nrm), thick=0.03, bev=0.0)
        rot_p = math.degrees(math.atan2(up.y, up.z))
        for i in range(4):
            bb = -h / 2 + h * (i + 0.5) / 4
            b.box('rubber', fr(0, bb, 0.012), (w - 0.006, 0.02, 0.003), bev=0.0, rot=(-rot_p - 15, 0, 0))
        b.box(st['knob'], fr(0, -h * 0.12, 0.02), (0.012, 0.012, 0.012), bev=0.003)

    def dash_details(self):
        C, b, k, st = self.C, self.b, self.k, self.st
        dx = C.driver_x
        lf, lz = self.lip
        xw = self.xw
        tier = C.tier
        # ---- defroster slots along the base of the windshield + dash-top speaker grilles
        zt = C.z_ws_base - 0.02 + 0.004
        for sg in (1, -1):
            xc = sg * 0.42 * k
            for i in range(7):
                b.box('metal_dark', (xc + (i - 3) * 0.045, C.f_cowl - 0.055, zt + 0.003), (0.035, 0.035, 0.006), bev=0.001)
            # speaker grille at the outer corner of the dash top
            sp = (sg * (xw - 0.11), C.f_cowl - 0.12, zt - 0.012)
            b.cyl('metal_dark', sp, 0.058, 0.006, axis=(0, 0.35, 0.94), n=20, bev=0.002)
            b.sticker('mesh', (sp[0], sp[1] - 0.001, sp[2] + 0.0045), (0, -0.35, 0.94), (0, 0.94, 0.35), 0.1, 0.1, lift=0.0)
        # ---- vents: outer (round on T4) and centre pair
        rv = tier == 4
        self.vent(xw - 0.12, 0.2, round_=rv, w=0.09 if rv else 0.12)
        self.vent(-(xw - 0.12), 0.2, round_=rv, w=0.09 if rv else 0.12)
        for sx in (0.085, -0.085):
            self.vent(sx, 0.18, w=0.12 if not rv else 0.085, h=0.05, round_=rv)
        # ---- centre stack bezel
        p0, nrm, up = self.face_frame(0, 0.37, 0.0)
        self.stack_up = up
        fr = lambda a, bb, d=0.0, p0=p0: tuple(p0 + X * a + up * bb + nrm * d)
        b.plate(st['stack'], rrect2(0.34, 0.24, 0.03, 3), lambda a, bb: fr(a, bb, 0.006), out=tuple(nrm), thick=0.03, bev=0.006)
        if tier == 1:
            # 80s AM/FM: chrome faceplate, dial window, two knobs, push buttons
            b.plate('chrome', rrect2(0.2, 0.055, 0.006, 2), lambda a, bb: fr(a, bb + 0.06, 0.012), out=tuple(nrm), thick=0.008, bev=0.002)
            b.sticker('radio_dial', fr(0, 0.07, 0.0205), tuple(nrm), tuple(up), 0.11, 0.022, lift=0.0)
            for sx in (-0.085, 0.085):
                b.cyl('metal_dark', fr(sx, 0.062, 0.03), 0.013, 0.02, axis=tuple(nrm), n=14, bev=0.003)
                b.cyl('chrome', fr(sx, 0.062, 0.041), 0.009, 0.004, axis=tuple(nrm), n=12)
            for i in range(5):
                b.box('metal_dark', fr(-0.044 + i * 0.022, 0.044, 0.022), (0.017, 0.008, 0.01), bev=0.002)
            # wood-grain strip across the stack (80s!)
            b.plate('wood', rrect2(0.32, 0.03, 0.006, 2), lambda a, bb: fr(a, bb + 0.012, 0.012), out=tuple(nrm), thick=0.005, bev=0.001)
            # heater: three slider slots with levers
            for i in range(3):
                bb = -0.025 - i * 0.022
                b.plate('metal_dark', rrect2(0.12, 0.006, 0.002, 1), lambda a, b2, bb=bb: fr(a, b2 + bb, 0.0125), out=tuple(nrm), thick=0.004, bev=0.0)
                b.box('chrome', fr(-0.03 + i * 0.03, bb, 0.018), (0.012, 0.01, 0.01), bev=0.002)
            b.swatch('red')
            b.box('decal', fr(-0.052, -0.025, 0.014), (0.012, 0.004, 0.006), bev=0.0)
            b.swatch('blue')
            b.box('decal', fr(0.052, -0.025, 0.014), (0.012, 0.004, 0.006), bev=0.0)
            b.swatch(None)
            # ashtray + lighter
            b.plate('metal_dark', rrect2(0.14, 0.035, 0.006, 2), lambda a, bb: fr(a - 0.03, bb - 0.095, 0.012), out=tuple(nrm), thick=0.006, bev=0.002)
            b.box('chrome', fr(-0.03, -0.083, 0.018), (0.07, 0.006, 0.008), bev=0.002)
            b.cyl('chrome', fr(0.09, -0.095, 0.014), 0.012, 0.012, axis=tuple(nrm), n=12, bev=0.002)
            b.cyl('metal_dark', fr(0.09, -0.095, 0.02), 0.008, 0.004, axis=tuple(nrm), n=10)
        elif tier == 2:
            # DIN radio + climate knobs; CB radio hangs under the dash (below)
            b.plate('metal_dark', rrect2(0.19, 0.055, 0.005, 2), lambda a, bb: fr(a, bb + 0.06, 0.012), out=tuple(nrm), thick=0.006, bev=0.002)
            b.sticker('radio_dial', fr(0.02, 0.066, 0.0185), tuple(nrm), tuple(up), 0.09, 0.02, lift=0.0)
            for sx in (-0.075, 0.075):
                b.cyl('metal_bare', fr(sx, 0.058, 0.026), 0.011, 0.016, axis=tuple(nrm), n=14, bev=0.003)
            for i in range(3):
                b.cyl('metal_dark', fr(-0.07 + i * 0.07, -0.04, 0.024), 0.022, 0.022, axis=tuple(nrm), n=18, bev=0.004)
                b.box('metal_bare', fr(-0.07 + i * 0.07, -0.04, 0.036), (0.006, 0.03, 0.004), bev=0.001)
            b.plate('metal_bare', rrect2(0.3, 0.012, 0.004, 1), lambda a, bb: fr(a, bb + 0.015, 0.012), out=tuple(nrm), thick=0.004, bev=0.001)
        elif tier == 3:
            # military radio box bolted into the stack + a toggle row
            b.box('armor', fr(0, 0.04, 0.05), (0.26, 0.09, 0.12), bev=0.008, rot=None)
            for sx in (-0.09, -0.03, 0.05, 0.1):
                b.cyl('metal_dark', fr(sx, 0.045, 0.11), 0.012, 0.02, axis=tuple(nrm), n=12, bev=0.003)
            b.sticker('g_volt', fr(-0.01, 0.07, 0.101), tuple(nrm), tuple(up), 0.035, 0.035, lift=0.0)
            for sx, sy in ((-0.115, 0.075), (0.115, 0.075), (-0.115, 0.005), (0.115, 0.005)):
                b.cyl('metal_bare', fr(sx, sy, 0.1), 0.006, 0.006, axis=tuple(nrm), n=6)
        else:
            # T4: carbon stack with a small screen + two climate dials
            b.plate('metal_dark', rrect2(0.2, 0.09, 0.008, 2), lambda a, bb: fr(a, bb + 0.05, 0.012), out=tuple(nrm), thick=0.006, bev=0.002)
            b.sticker('map', fr(0, 0.05, 0.0185), tuple(nrm), tuple(up), 0.18, 0.075, lift=0.0)
            for sx in (-0.1, 0.1):
                b.cyl('metal_bare', fr(sx, -0.05, 0.022), 0.024, 0.022, axis=tuple(nrm), n=20, bev=0.004)
                b.cyl('metal_dark', fr(sx, -0.05, 0.034), 0.016, 0.004, axis=tuple(nrm), n=16)
        # ---- glovebox (passenger side)
        gx0, gx1 = -(xw - 0.05), -0.22
        pg, nrm2, up2 = self.face_frame((gx0 + gx1) / 2, 0.35, 0.0)
        gw, gh = gx1 - gx0 - 0.04, 0.17
        fr2 = lambda a, bb, d=0.0: tuple(pg + X * a + up2 * bb + nrm2 * d)
        b.plate('metal_dark', rrect2(gw + 0.012, gh + 0.012, 0.03, 3), lambda a, bb: fr2(a, bb, 0.0015), out=tuple(nrm2), thick=0.003, bev=0.0)
        b.plate(st['face'] if tier != 3 else 'armor', rrect2(gw, gh, 0.028, 3), lambda a, bb: fr2(a, bb, 0.009), out=tuple(nrm2), thick=0.009, bev=0.003)
        b.box(st['knob'], fr2(0, gh / 2 - 0.03, 0.014), (0.05, 0.012, 0.018), bev=0.004)
        b.cyl('metal_dark', fr2(0.0, gh / 2 - 0.03, 0.019), 0.007, 0.004, axis=tuple(nrm2), n=10)
        sticker = {1: 'lbl_ride', 2: 'radiation', 3: 'lbl_danger', 4: 'lbl_nitro'}[tier]
        sw_, sh_ = (0.14, 0.035) if sticker.startswith('lbl') else (0.08, 0.08)
        b.sticker(sticker, fr2(-0.03, -0.02, 0.0185), tuple(nrm2), tuple(up2), sw_, sh_, lift=0.0, rot=-6.0)
        if tier in (1, 2):
            b.sticker('skull' if tier == 1 else 'hazard', fr2(0.1, 0.03, 0.0185), tuple(nrm2), tuple(up2), 0.06, 0.06 if tier == 1 else 0.052, lift=0.0, rot=8.0)
        # ---- switches / knobs around the binnacle on the dash face
        for sx, t in ((dx + 0.26, 0.28), (dx - 0.25, 0.3)):
            p, nr = self.face_pt(sx, t, 0.0)
            b.cyl('metal_dark', tuple(p + nr * 0.004), 0.016, 0.01, axis=tuple(nr), n=14, bev=0.002)
            b.cyl(st['knob'], tuple(p + nr * 0.02), 0.011, 0.03, axis=tuple(nr), n=12, bev=0.003)
        # ---- trims, T3 armour plates, grab handle, accessories (interior_dash.py)
        self.dash_extras()
        if tier == 1:
            self.dash_junk_t1()
        # under-dash wiring (loose on T1/T3)
        if tier in (1, 3):
            rnd = random.Random(3)
            zb = self.dash_zb
            for i, cname in enumerate(('red', 'yellow', 'black', 'blue', 'red')):
                x0 = dx - 0.28 + i * 0.05
                f0 = lf + 0.12
                pts = [(x0, f0, zb - 0.005), (x0 + rnd.uniform(-0.05, 0.05), f0 - 0.02, zb - 0.09 - rnd.uniform(0, 0.06)), (x0 + rnd.uniform(-0.08, 0.08), f0 + 0.03, zb - 0.05)]
                b.swatch(cname)
                b.tube('decal', pts, 0.0035, n=5, rad=0.04, k=3)
                b.swatch(None)

    def dash_junk_t1(self):
        """cassette, compass ball, a folded road map on the dash top; hazard sticker on the binnacle."""
        C, b, k = self.C, self.b, self.k
        lf, lz = self.lip
        ztop = lambda f: lz + 0.004 + (f - lf) * 0.55 + 0.012
        # road map, folded, passenger side
        fm = lf + 0.12
        b.sticker('map', (-0.35, fm, ztop(fm) + 0.022), (0, -0.25, 0.97), (0, 0.97, 0.25), 0.26, 0.13, lift=0.0, rot=12)
        b.box('interior', (-0.35, fm, ztop(fm) + 0.012), (0.27, 0.14, 0.018), bev=0.004, rot=(10, 12, 0))
        # cassette
        b.box('rubber', (0.02, lf + 0.10, ztop(lf + 0.10) + 0.012), (0.1, 0.064, 0.012), bev=0.002, rot=(12, -20, 0))
        b.sticker('lbl_v8', (0.02, lf + 0.10, ztop(lf + 0.10) + 0.0185), (0, -0.2, 0.98), (0, 0.98, 0.2), 0.07, 0.022, lift=0.0, rot=-20)
        # compass ball on the passenger side of the binnacle
        cp = (0.08, lf + 0.2, ztop(lf + 0.2) + 0.03)
        b.box('rubber', (cp[0], cp[1], cp[2] - 0.022), (0.05, 0.05, 0.012), bev=0.003)
        b.sph('glass_lens', cp, 0.026, n=12)
        b.swatch('white')
        b.cyl('decal', (cp[0], cp[1], cp[2] - 0.004), 0.019, 0.004, axis='z', n=12)
        b.swatch(None)

    # ------------------------------------------------------------------------------------------- column + wheel
    def column(self):
        C, b, k = self.C, self.b, self.k
        wc, col = self.wcv, self.col
        # shroud (split clamshell) from behind the hub into the dash face
        c0 = wc + col * 0.13 + Vector((0, 0, -0.004))
        b.box('interior' if C.tier != 3 else 'metal_dark', tuple(c0), (0.085, 0.2, 0.1), bev=0.022, seg=2, rot=(-25, 0, 0), taper=(0.9, 1.0))
        b.box('metal_dark', tuple(wc + col * 0.13 + Vector((0, 0, -0.004))), (0.087, 0.2, 0.004), bev=0.0, rot=(-25, 0, 0))
        b.cyl('metal_dark', tuple(wc + col * 0.035), 0.032, 0.04, axis=tuple(col), n=16, bev=0.004)
        # stalks: turn signal (left), wipers (right)
        for sg, L in ((1, 0.17), (-1, 0.15)):
            p0 = wc + col * 0.07 + X * (sg * 0.042) + self.wy * 0.012
            p1 = p0 + X * (sg * L) + self.wy * 0.02 + self.wn * 0.02
            b.cyl2('metal_dark', tuple(p0), tuple(p1), 0.007, r2=0.009, n=8)
            b.cyl('metal_dark', tuple(p1), 0.011, 0.03, axis='x', n=10, bev=0.004)
        # ignition key (right side of the shroud) + keyring
        kp = wc + col * 0.1 + X * -0.046 + self.wy * -0.01
        b.cyl('chrome', tuple(kp), 0.013, 0.008, axis='x', n=12)
        b.box('metal_bare', tuple(kp + X * -0.016), (0.012, 0.022, 0.004), bev=0.001, rot=(-25, 0, 0))
        b.torus('chrome', tuple(kp + X * -0.03 + Vector((0, 0, -0.02))), 0.014, 0.0018, axis='f', nR=12, nr=4)
        if C.tier == 1:
            # rabbit-foot keychain
            b.sph('fabric', tuple(kp + X * -0.032 + Vector((0, -0.005, -0.06))), 0.014, n=8, sc=(0.8, 0.8, 1.6))
        # column below the dash to the floor (visible under the dash)
        b.cyl2('metal_dark', tuple(wc + col * 0.22), tuple(wc + col * 0.62), 0.028, n=10)

    def steering(self):
        """Wheel as its own Part (build.py parents it to the steering_wheel socket, local Z = column)."""
        C, k, st = self.C, self.k, self.st
        pt = self.part('steering_wheel_mesh', self.wheel_c)
        kind = st['wheel']
        R = {'t1': 0.19, 't2': 0.2, 't3': 0.195, 't4': 0.185}[kind]
        rim_m = {'t1': 'rubber', 't2': 'rubber', 't3': 'leather', 't4': 'leather'}[kind]
        ra, rb = {'t1': (0.0135, 0.016), 't2': (0.016, 0.019), 't3': (0.017, 0.02), 't4': (0.017, 0.021)}[kind]
        dish = {'t1': 0.018, 't2': 0.028, 't3': 0.02, 't4': 0.06}[kind]
        nR, nP = 64, 12

        def centre(th):
            p = Vector((R * math.cos(th * D2R), R * math.sin(th * D2R)))
            if kind == 't4' and p.y < -R * 0.8:      # flat bottom
                p.y = -R * 0.8 - (p.y + R * 0.8) * 0.08
            return p

        rings = []
        for i in range(nR):
            th = 360.0 * i / nR
            c2 = centre(th)
            rd = (X * math.cos(th * D2R) + self.wy * math.sin(th * D2R))
            cp = self.wcv + X * c2.x + self.wy * c2.y
            grip = kind in ('t1', 't2') and (i % 4 == 0)
            ring = []
            for j in range(nP):
                a = 2 * math.pi * j / nP
                ca, sa = math.cos(a), math.sin(a)
                bb = rb * sa
                if grip and sa < -0.3:                 # finger bumps on the back of the rim
                    bb *= 1.22
                ring.append(tuple(cp + rd * (ra * ca) + self.wn * bb))
            rings.append(ring)
        pt.loft_grid(rim_m, rings, cyc_u=True, cyc_v=True, cap=False)
        # spokes: flat bars from the (dished) hub to the rim
        spokes = {'t1': (-22, 202), 't2': (-12, 192, 245, 295), 't3': (0, 180, 270), 't4': (-8, 188, 270)}[kind]
        sp_m = {'t1': 'rubber', 't2': 'rubber', 't3': 'metal_bare', 't4': 'metal_bare'}[kind]
        for th in spokes:
            rd = X * math.cos(th * D2R) + self.wy * math.sin(th * D2R)
            tg = X * -math.sin(th * D2R) + self.wy * math.cos(th * D2R)
            rr = []
            for s in range(6):
                t = s / 5
                r = 0.045 + (R - 0.05) * t
                d = -dish + dish * smooth01(t * 1.2)
                if kind == 't4':
                    d = -dish * (1 - t)
                w = {'t1': 0.05, 't2': 0.042, 't3': 0.036, 't4': 0.03}[kind] * (1.0 + 0.5 * t * t)
                th_ = {'t1': 0.014, 't2': 0.016, 't3': 0.006, 't4': 0.007}[kind]
                cp = self.wcv + rd * r + self.wn * d
                rr.append([tuple(cp + tg * aa + self.wn * bb) for (aa, bb) in rrect2(w, th_, min(th_ * 0.45, 0.006), 2)])
            pt.loft_grid(sp_m, rr, cap=True)
            if kind == 't4':
                for s in range(3):       # lightening holes (dark discs both sides)
                    r = 0.075 + s * 0.035
                    cp = self.wcv + rd * r + self.wn * (-dish * (1 - (r - 0.045) / (R - 0.05)))
                    pt.cyl('metal_dark', tuple(cp), 0.008, 0.0075, axis=tuple(self.wn), n=10)
        # hub / horn pad
        hc = self.wcv + self.wn * (-dish + 0.012)
        if kind == 't1':
            pt.box('rubber', tuple(hc + self.wn * 0.012), (0.15, 0.03, 0.105), bev=0.02, seg=3, rot=(-25, 0, 0))
            pt.box('metal_bare', tuple(hc + self.wn * 0.03), (0.04, 0.004, 0.022), bev=0.004, rot=(-25, 0, 0))
            # suicide knob on the rim (lower left)
            kp = self.wcv + X * (R * math.cos(-40 * D2R)) + self.wy * (R * math.sin(-40 * D2R))
            pt.cyl('chrome', tuple(kp), ra * 1.45, 0.028, axis=tuple(-X * math.sin(-40 * D2R) + self.wy * math.cos(-40 * D2R)), n=12)
            pt.cyl2('chrome', tuple(kp + self.wn * 0.015), tuple(kp + self.wn * 0.04), 0.005, n=8)
            pt.swatch('cream')
            pt.sph('decal', tuple(kp + self.wn * 0.052), 0.017, n=12, sc=(1, 1, 0.8))
            pt.swatch(None)
        elif kind == 't2':
            pt.box('rubber', tuple(hc + self.wn * 0.016), (0.17, 0.035, 0.125), bev=0.025, seg=3, rot=(-25, 0, 0))
            pt.box('interior', tuple(hc + self.wn * 0.036), (0.13, 0.004, 0.08), bev=0.012, seg=2, rot=(-25, 0, 0))
            pt.cyl('chrome', tuple(hc + self.wn * 0.04), 0.018, 0.005, axis=tuple(self.wn), n=16, bev=0.002)
        elif kind == 't3':
            pt.cyl('metal_dark', tuple(hc), 0.06, 0.03, axis=tuple(self.wn), n=20, bev=0.006)
            pt.cyl('metal_bare', tuple(hc + self.wn * 0.017), 0.045, 0.006, axis=tuple(self.wn), n=20, bev=0.002)
            for i in range(6):
                a = i * 60 * D2R
                pt.cyl('metal_dark', tuple(hc + self.wn * 0.021 + X * (0.034 * math.cos(a)) + self.wy * (0.034 * math.sin(a))), 0.006, 0.005, axis=tuple(self.wn), n=6)
            # cloth-tape wrap on the rim (10 to 11 o'clock)
            pts = []
            for i in range(90):
                th = 20 + 60 * i / 89
                a = i * 0.9
                c2 = centre(th)
                rd = X * math.cos(th * D2R) + self.wy * math.sin(th * D2R)
                cp = self.wcv + X * c2.x + self.wy * c2.y
                pts.append(tuple(cp + rd * ((ra + 0.0015) * math.cos(a)) + self.wn * ((rb + 0.0015) * math.sin(a))))
            pt.sweep('fabric', pts, [(0.004, 0.0008), (-0.004, 0.0008), (-0.004, -0.0008), (0.004, -0.0008)], up=tuple(self.wn))
        else:
            pt.cyl('metal_dark', tuple(hc), 0.05, 0.05, axis=tuple(self.wn), n=20, bev=0.006)       # quick-release boss
            pt.cyl('metal_bare', tuple(hc + self.wn * 0.03), 0.034, 0.012, axis=tuple(self.wn), n=20, bev=0.003)
            pt.cyl('paint2', tuple(hc + self.wn * 0.038), 0.026, 0.008, axis=tuple(self.wn), n=20, bev=0.003)
            # 12 o'clock marker band
            mk = []
            for i in range(7):
                th = 86 + 8 * i / 6
                c2 = centre(th)
                rd = X * math.cos(th * D2R) + self.wy * math.sin(th * D2R)
                cp = self.wcv + X * c2.x + self.wy * c2.y
                mk.append([tuple(cp + rd * (ra * 1.06 * math.cos(2 * math.pi * j / nP)) + self.wn * (rb * 1.06 * math.sin(2 * math.pi * j / nP))) for j in range(nP)])
            pt.loft_grid('paint2', mk, cap=True)
            # contrast stitching along the inner edge of the rim
            pt.swatch('orange')
            for i in range(0, 120):
                th = 3.0 * i
                if 84 < th < 96:
                    continue
                c2 = centre(th)
                rd = X * math.cos(th * D2R) + self.wy * math.sin(th * D2R)
                cp = self.wcv + X * c2.x + self.wy * c2.y + rd * (-ra * 1.02)
                tg = X * -math.sin(th * D2R) + self.wy * math.cos(th * D2R)
                for sgn in (1, -1):
                    q = cp + self.wn * (sgn * rb * 0.35)
                    pt.quad('decal', tuple(q), tuple(-rd), tuple(tg), 0.0013, 0.0045)
            pt.swatch(None)

    # ------------------------------------------------------------------------------------------- shifter
    def shifter(self):
        C, b, k, st = self.C, self.b, self.k, self.st
        tier = C.tier
        zt = C.z_floor + 0.105                 # tunnel top
        base = Vector((0.03, C.seat_f + 0.42 * k, zt))
        top = base + Vector((0.04, -0.09, 0.30 if tier < 4 else 0.2))
        if tier == 1:
            top = base + Vector((0.03, -0.12, 0.33))
        # boot
        b.cyl('rubber', tuple(base + Vector((0, 0, 0.004))), 0.075, 0.012, axis='z', n=16, bev=0.003)
        rings = []
        for i in range(6):
            t = i / 5
            r = 0.062 * (1 - t) + 0.016 * t + 0.006 * math.sin(t * math.pi * 5)
            c = base + (top - base) * (t * 0.35)
            rings.append([tuple(c + Vector((r * math.cos(a), r * math.sin(a), 0))) for a in [2 * math.pi * j / 12 for j in range(12)]])
        b.loft_grid('rubber', rings, cap=True)
        # lever (slight dog-leg on the old trucks)
        mid = base + (top - base) * 0.55 + Vector((0.015 if tier < 3 else 0, 0.02, 0))
        b.tube('chrome' if tier == 1 else 'metal_dark', [tuple(base + (top - base) * 0.3), tuple(mid), tuple(top)], 0.008, n=8, rad=0.06, k=3)
        if tier == 1:          # 8-ball knob
            b.sph('rubber', tuple(top + Vector((0, 0, 0.018))), 0.024, n=14)
            b.swatch('white')
            b.cyl('decal', tuple(top + Vector((0, -0.012, 0.036))), 0.009, 0.004, axis=(0, -0.5, 0.87), n=12)
            b.swatch(None)
            knob_top = top + Vector((0, 0, 0.042))
        elif tier == 2:
            b.cyl('rubber', tuple(top + Vector((0, 0, 0.02))), 0.021, 0.05, axis='z', n=14, bev=0.01)
            knob_top = top + Vector((0, 0, 0.045))
            # transfer-case lever (4x4) beside it
            tb = base + Vector((0.07, -0.05, 0))
            tt = tb + Vector((0.03, -0.06, 0.2))
            b.cyl2('metal_dark', tuple(tb), tuple(tt), 0.007, n=8)
            b.swatch('red')
            b.sph('decal', tuple(tt + Vector((0, 0, 0.014))), 0.018, n=12, sc=(1, 1, 1.2))
            b.swatch(None)
        elif tier == 3:
            b.cyl('metal_bare', tuple(top + Vector((0, 0, 0.022))), 0.02, 0.05, axis='z', n=12, bev=0.006)
            b.cyl('metal_dark', tuple(top + Vector((0, 0, 0.048))), 0.021, 0.006, axis='z', n=12)
            knob_top = top + Vector((0, 0, 0.051))
            for i, dx_ in enumerate((0.08, 0.12)):
                tb = base + Vector((dx_, -0.03, 0))
                tt = tb + Vector((0.0, -0.07, 0.17 - i * 0.03))
                b.cyl2('metal_dark', tuple(tb), tuple(tt), 0.006, n=8)
                b.swatch('yellow' if i == 0 else 'red')
                b.cyl('decal', tuple(tt + Vector((0, 0, 0.018))), 0.013, 0.036, axis='z', n=10, bev=0.004)
                b.swatch(None)
        else:
            b.cyl('metal_bare', tuple(top + Vector((0, 0, 0.02))), 0.022, 0.04, axis='z', n=18, bev=0.008)
            b.cyl('paint2', tuple(top + Vector((0, 0, 0.012))), 0.0225, 0.006, axis='z', n=18)
            knob_top = top + Vector((0, 0, 0.04))
            # big NOS push button on the tunnel ahead of the shifter
            nb_ = base + Vector((-0.02, 0.1, 0.0))
            b.box('metal_bare', tuple(nb_ + Vector((0, 0, 0.03))), (0.1, 0.08, 0.06), bev=0.008)
            b.cyl('paint2', tuple(nb_ + Vector((0, -0.01, 0.07))), 0.022, 0.02, axis=(0, -0.3, 0.95), n=18, bev=0.004)
            b.sticker('lbl_nos', tuple(nb_ + Vector((0, -0.041, 0.035))), (0, -1, 0), (0, 0, 1), 0.07, 0.02, lift=0.0)
        self.shifter_knob = tuple(knob_top)

    def floor_details(self):
        pass
