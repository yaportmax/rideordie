"""The Leviathan's rear and flanks (trailer #2 reactor tower, bolt-on rear plates, drop ramp, thrusters, flame nozzles, flank
walkways) - the part players chase for the whole fight.  Game space (+X left, +Y up, +Z forward), same conventions as boss_warrig.py.

Contract notes (src/data/boss.js reads the part boxes from model_info.json):
  * panel_armor_rear_1/2/3 and ramp_rear keep their exact bounding boxes (all added detail stays inside them) and origins.
  * part_engine (the reactor) stays enclosed: tower sides / front / top are closed, only the three rear plates cover the core.
  * sockets flame_L/R, nitro_L/R, light_tail_L/R keep position + rotation; only the geometry around them changed.
"""
import math
from mathutils import Vector
from boss_parts import *  # noqa
import parts2 as P2

PI = math.pi
TZ0, TZ1 = -17.0, -15.1          # tower rear / front face z
TY0, TY1 = 3.0, 8.4              # pillar bottom / top
TOPY = 8.7                       # top of the roof slab


# ------------------------------------------------------------------------------------------------ small helpers
def chevrons(m, c, w, h, n=(0, 0, -1), obj=None, stripe=0.22, up=(0, 1, 0), broken=0.25, dark='metal_dark', yellow='decal_yellow', t=0.012):
    """yellow/black hazard band as real thin plates: yellow base + dark diagonal stripes, some segments chipped away"""
    U, V_, N = P2._frame(n, up)
    C = V3(c)
    m.plate(yellow, [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)], t, at=tuple(C + N * (t / 2)), u=tuple(U), v=tuple(V_), bevel=0.004, seg=1, obj=obj)
    k = int(w / (stripe * 2)) + 2
    for i in range(k):
        x0 = -w / 2 + i * stripe * 2 - h * 0.5
        if m.rng.random() < broken:              # chipped / missing stripe
            continue
        pts = [(x0, -h / 2), (x0 + stripe, -h / 2), (x0 + stripe + h, h / 2), (x0 + h, h / 2)]
        pts = [(max(-w / 2, min(w / 2, a)), b) for a, b in pts]
        if abs(pts[1][0] - pts[0][0]) < 0.02 and abs(pts[2][0] - pts[3][0]) < 0.02:
            continue
        m.plate(dark, pts, t * 0.6, at=tuple(C + N * (t + t * 0.3)), u=tuple(U), v=tuple(V_), bevel=0, seg=1, obj=obj)


def caged_lamp(m, at, n, r=0.22, obj=None, bars=3):
    P2.spot2(m, at, n=n, r=r, obj=obj or 'body')
    P2.cage_bars(m, tuple(V3(at) + V3(n).normalized() * 0.01), n, r * 2.3, r * 2.3, nb=bars, r=r * 0.06, depth=r * 0.55, obj=obj or 'body')


def plate_skull_emblem(m, c, s=1.0, n=(0, 0, -1), obj=None, bone='plastic', dark='metal_dark', glow='light_amber', bones=True):
    """skull-and-crossbones cut from steel plate, painted bone, bolted on stand-offs, glowing eye holes (faces n)"""
    U, V_, N = P2._frame(n)
    C = V3(c)
    t = 0.06 * s
    # crossed bones behind (thick bars with knuckle ends)
    if bones:
        for sg in (1, -1):
            a = C + U * (-0.95 * s * sg) + V_ * (-0.8 * s) + N * (0.03 * s)
            b = C + U * (0.95 * s * sg) + V_ * (0.75 * s) + N * (0.03 * s)
            m.beam(bone, tuple(a), tuple(b), 0.16 * s, 0.07 * s, up=tuple(N), bevel=0.015 * s, seg=1, obj=obj)
            for e, d in ((a, -1), (b, 1)):
                for k in (-1, 1):
                    q = e + (b - a).normalized() * (0.02 * d * s) + (b - a).normalized().cross(N) * (0.07 * s * k)
                    m.cyl(bone, tuple(q - N * 0.0), tuple(q + N * (0.08 * s)), 0.085 * s, seg=8, obj=obj)
    # cranium plate with eye + nose holes
    cran = [(0.62 * s * math.cos(a), 0.18 * s + 0.58 * s * math.sin(a)) for a in [PI * i / 10 for i in range(11)]]
    cran += [(-0.6 * s, -0.08 * s), (-0.46 * s, -0.3 * s), (-0.3 * s, -0.36 * s), (0.3 * s, -0.36 * s), (0.46 * s, -0.3 * s), (0.6 * s, -0.08 * s)]
    cran = cran[::-1]
    eye = lambda x: [(x + 0.17 * s * math.cos(2 * PI * k / 7), 0.08 * s + 0.14 * s * math.sin(2 * PI * k / 7)) for k in range(7)]
    nose = [(0.0, -0.08 * s), (0.08 * s, -0.25 * s), (-0.08 * s, -0.25 * s)]
    P = C + N * (0.1 * s)
    m.plate(bone, cran, t, at=tuple(P), u=tuple(U), v=tuple(V_), bevel=0.012 * s, seg=1, holes=[eye(-0.24 * s), eye(0.24 * s), nose], obj=obj)
    # jaw plate with a row of teeth
    jaw = [(-0.36 * s, -0.42 * s), (0.36 * s, -0.42 * s), (0.3 * s, -0.66 * s), (-0.3 * s, -0.66 * s)]
    m.plate(bone, jaw, t, at=tuple(P - N * (0.01 * s)), u=tuple(U), v=tuple(V_), bevel=0.01 * s, seg=1, obj=obj)
    for i in range(6):
        x = (-0.25 + i * 0.1) * s
        m.plate(bone, [(x - 0.035 * s, -0.43 * s), (x + 0.035 * s, -0.43 * s), (x + 0.03 * s, -0.33 * s), (x - 0.03 * s, -0.33 * s)], t * 0.8, at=tuple(P + N * (0.004 * s)),
                u=tuple(U), v=tuple(V_), bevel=0.004 * s, seg=1, obj=obj)
    # glowing eyes + dark socket backs, stand-off bolts
    for x in (-0.24, 0.24):
        m.plate(glow, [(x * s + 0.13 * s * math.cos(2 * PI * k / 7), 0.08 * s + 0.1 * s * math.sin(2 * PI * k / 7)) for k in range(7)], 0.02 * s,
                at=tuple(C + N * (0.06 * s)), u=tuple(U), v=tuple(V_), bevel=0, obj=obj)
    m.plate(dark, [(-0.1 * s, -0.3 * s), (0.1 * s, -0.3 * s), (0.0, -0.06 * s)], 0.02 * s, at=tuple(C + N * (0.06 * s)), u=tuple(U), v=tuple(V_), bevel=0, obj=obj)
    for (x, y) in ((-0.45, 0.35), (0.45, 0.35), (0.0, 0.62), (-0.42, -0.2), (0.42, -0.2), (-0.22, -0.55), (0.22, -0.55)):
        m.hexbolt('armor', tuple(P + U * (x * s) + V_ * (y * s) + N * (t / 2)), tuple(N), r=0.03 * s, h=0.025 * s, obj=obj)
    # a crack weld repair across the brow
    m.bead('armor', [tuple(P + U * (0.05 * s) + V_ * (0.72 * s) + N * (t / 2)), tuple(P + U * (0.12 * s) + V_ * (0.45 * s) + N * (t / 2)),
                     tuple(P + U * (0.02 * s) + V_ * (0.3 * s) + N * (t / 2))], r=0.018 * s, n=tuple(N), obj=obj)


def cut_letters(m, text, c, height, n=(0, 0, -1), mat='plastic', obj=None, depth=0.08, spacing=1.05):
    """welded letters cut from thick plate (extruded text), each tacked to the frame"""
    U, V_, N = P2._frame(n)
    m.text(mat, text, tuple(V3(c) + N * (depth / 2)), u=tuple(U), v=tuple(V_), size=height, depth=depth, res=2, obj=obj, spacing=spacing)


# ------------------------------------------------------------------------------------------------ tower (body)
def tower(m):
    m.use('body')
    for sx in (1, -1):
        x = 2.1 * sx
        # pillar + a rear face plate with rivet rows and a vertical weld seam
        m.box('paint', (0.5, 5.4, 1.9), at=(x, 5.7, -16.05), bevel=0.05, seg=1)
        m.box('armor', (0.5, 5.3, 0.07), at=(x, 5.7, TZ0 - 0.035), bevel=0.02, seg=1)
        for dx in (-0.2, 0.2):
            m.rivet_line('metal_dark', (x + dx, 3.2, TZ0 - 0.075), (x + dx, 8.2, TZ0 - 0.075), (0, 0, -1), step=0.32, r=0.035)
        P2.taillight2(m, (x, 4.6, TZ0 - 0.075), 0.3, 0.52, n=(0, 0, -1), obj='body')
        light_rect(m, (x, 3.85, TZ0 - 0.075), (0.3, 0.18), 'light_amber', n=(0, 0, -1), depth=0.12)
        P2.cage_bars(m, (x, 3.85, TZ0 - 0.08), (0, 0, -1), 0.4, 0.28, nb=2, r=0.014, depth=0.08, obj='body')
        caged_lamp(m, (x, 7.55, TZ0 - 0.2), (0, -0.08, -1), r=0.2)
        m.box('metal_dark', (0.08, 0.3, 0.2), at=(x, 7.3, TZ0 - 0.12), bevel=0.01, seg=1)
        # outboard: side wall plates (panel_tower_*), exhaust stack, work lamp
        nm = 'panel_tower_%s' % ('L' if sx > 0 else 'R')
        apanel_like(m, nm, (2.4 * sx, 5.7, -16.05))
        wall(m, 'armor', (2.36 * sx, 5.7, -16.05), (0, 0, -sx), (0, 1, 0), 1.9, 5.2, 1, 3, t=0.08, gap=0.08, rr=0.04, bevel=0.03, obj=nm)
        for y in (4.05, 5.8, 7.5):
            m.bead('armor', [(2.47 * sx, y, -16.95), (2.47 * sx, y, -15.15)], r=0.03, n=(sx, 0, 0), obj=nm)
        m.use('body')
        # exhaust stack up the tower side (soot at the top), heat shield, brackets
        P2.exhaust_stack2(m, (2.72 * sx, 2.9, -15.45), (2.72 * sx, 9.95, -15.45), r=0.17, mat='chrome', cap='metal_dark', seg=10)
        for y in (4.4, 6.4, 8.2):
            m.box('metal_dark', (0.3, 0.1, 0.12), at=(2.56 * sx, y, -15.45), bevel=0.01, seg=1)
        m.tube('metal_dark', [(2.2 * sx, 2.4, -14.9), (2.72 * sx, 2.6, -15.2), (2.72 * sx, 2.95, -15.45)], 0.16, seg=8, bend=0.3, bsteps=2)
        caged_lamp(m, (2.62 * sx, 6.9, -16.45), (sx, -0.1, 0), r=0.2)
    # tower front wall (faces the cannon): plate + ribs + hazard band; underside box
    m.box('armor', (3.6, 0.2, 0.3), at=(0, 5.45, -15.2), bevel=0.02, seg=1)
    m.plate('armor', [(-2.05, 5.45), (2.05, 5.45), (2.05, 8.4), (-2.05, 8.4)], 0.22, at=(0, 0, TZ1), u=(1, 0, 0), v=(0, 1, 0), bevel=0.03, seg=1)
    m.rivet_rect('metal_dark', (0, 6.9, TZ1 + 0.1), 4.1, 2.9, (0, 0, 1), u=(1, 0, 0), v=(0, 1, 0), step=0.4, r=0.045, inset=0.12)
    chevrons(m, (0, 7.9, TZ1 + 0.11), 3.8, 0.34, n=(0, 0, 1), stripe=0.2)
    for x in (-1.0, 1.0):
        m.beam('armor', (x, 5.6, TZ1 + 0.14), (x, 8.3, TZ1 + 0.14), 0.12, 0.08, up=(0, 0, 1), bevel=0.01, seg=1)
    # ladder with a safety cage (left side, outboard)
    P2.ladder(m, 2.95, 2.95, [(3.0, -16.75), (8.9, -16.75)], rung=0.34, r=0.03) if False else None
    for z in (-16.95, -16.45):
        m.cyl('metal_dark', (2.95, 3.0, z), (2.95, 9.6, z), 0.035, seg=6)
        for y in (3.6, 5.6, 7.6):
            m.box('metal_dark', (0.5, 0.06, 0.06), at=(2.7, y, z), bevel=0, seg=1)
    for i in range(18):
        y = 3.3 + i * 0.34
        m.cyl('metal_dark', (2.95, y, -16.95), (2.95, y, -16.45), 0.022, seg=5)
    for i in range(7):                                                                           # cage hoops
        y = 5.0 + i * 0.7
        ring = [(2.95 + 0.42 * math.sin(PI * k / 8), y, -16.7 + 0.42 * math.cos(PI * k / 8) * (-1)) for k in range(9)]
        ring = [(2.95 + 0.4 * math.sin(a), y, -16.7 - 0.4 * math.cos(a)) for a in [PI * k / 8 - PI / 2 + PI / 2 for k in range(9)]]
        m.tube('metal_dark', [(2.95, y, -16.95)] + [(2.95 + 0.42 * math.sin(PI * k / 6), y, -16.7 - 0.25 * math.cos(PI * k / 6)) for k in range(7)] + [(2.95, y, -16.45)],
               0.018, seg=4)
    for k in (1, 3, 5):
        a = PI * k / 6
        m.cyl('metal_dark', (2.95 + 0.42 * math.sin(a), 5.0, -16.7 - 0.25 * math.cos(a)), (2.95 + 0.42 * math.sin(a), 9.2, -16.7 - 0.25 * math.cos(a)), 0.016, seg=4)
    # bar cage over the right tower side (rear half)
    for i in range(7):
        z = -16.95 + i * 0.14
        m.cyl('metal_dark', (-2.62, 4.6, z), (-2.62, 8.3, z), 0.022, seg=5)
    for y in (4.7, 6.45, 8.2):
        m.box('armor', (0.06, 0.08, 1.0), at=(-2.62, y, -16.53), bevel=0, seg=1)
    # chains hanging off the pillar tops
    for sx in (1, -1):
        chain(m, (1.75 * sx, 8.2, TZ0 - 0.12), (2.3 * sx, 6.2, TZ0 - 0.14), sag=0.35, link=0.3, r=0.05)
    # reactor core lives inside (weak point behind the plates)
    reactor(m, (0, 6.75, -16.05), s=1.0)
    m.use('body')


def apanel_like(m, name, origin):
    al = dict(metal_dark='armor', chrome='armor', metal_bare='armor', paint='armor', paint2='armor', rust='armor', spike='armor', plastic='armor')
    m.panel(name, origin, **al)


def tower_top(m):
    """roof slab, perimeter railing, sandbagged corner stands, flags, spikes, WARLORD sign with cut-plate letters and caged floods"""
    m.use('body')
    m.box('paint2', (5.0, 0.3, 2.1), at=(0, 8.55, -16.1), bevel=0.05, seg=1)
    m.box('armor', (4.7, 0.05, 1.8), at=(0, TOPY + 0.025, -16.1), bevel=0.01, seg=1)
    for i in range(9):
        m.box('metal_dark', (4.6, 0.03, 0.05), at=(0, TOPY + 0.06, -16.9 + i * 0.2), bevel=0)
    for sx in (1, -1):                                                                       # side railings
        railing(m, [(2.35 * sx, TOPY, -15.2), (2.35 * sx, TOPY, -16.9)], h=0.95, r=0.03, post_step=0.85, rails=(0.48, 0.95), mat='metal_dark')
    railing(m, [(2.35, TOPY, -15.15), (-2.35, TOPY, -15.15)], h=0.95, r=0.03, post_step=1.2, rails=(0.48, 0.95), mat='metal_dark')
    # sandbagged corner stands at the rear corners, with a spiked shield plate each
    for sx in (1, -1):
        P2.sandbag_ring(m, [(2.2 * sx, -16.2), (2.2 * sx, -16.95), (1.35 * sx, -16.95)], TOPY + 0.05, rows=2, L=0.5, D=0.3, H=0.16)
        m.plate('armor', [(-0.35, 0.0), (0.35, 0.0), (0.3, 0.55), (-0.3, 0.55)], 0.03, at=(1.75 * sx, TOPY + 0.38, -17.1), u=(1, 0, 0), v=(0, 1, 0), bevel=0.006, seg=1)
        for k in (-1, 1):
            P2.spike2(m, (1.75 * sx + 0.22 * k, TOPY + 0.9, -17.1), (1.75 * sx + 0.26 * k, TOPY + 1.25, -17.12), 0.035, mat='spike')
        P2.ammo_can(m, (1.9 * sx, TOPY + 0.05, -15.6), yaw=20 * sx, mat='paint2', size=(0.22, 0.26, 0.4))
        # tall flag poles at the front corners
        m.cyl('metal_dark', (2.3 * sx, TOPY, -15.25), (2.3 * sx, 10.05, -15.25), 0.035, seg=6)
        P2.flag(m, (2.3 * sx, 10.0, -15.28), length=1.1, height=0.62, direction=(0.25 * sx, 0, -1), mat='cloth_red', cols=8, wave=0.08)
        skull(m, (2.35 * sx, TOPY + 0.2, -15.55), s=1.3, n=(sx * 0.5, 0.1, -1), horns=True, mat='plastic', eyes='light_amber')
    # spike crown along the rear top edge (under the sign)
    for i in range(9):
        x = -2.0 + i * 0.5
        P2.spike2(m, (x, 8.45, TZ0 - 0.14), (x * 1.02, 8.35, TZ0 - 0.55 - 0.12 * (i % 2)), 0.05, mat='spike')
    # WARLORD sign: welded frame of pipe + angle, cut-plate letters, marquee bulbs, caged floods under it
    SZ = -17.02
    for sx in (1, -1):
        m.beam('armor', (1.95 * sx, TOPY, SZ), (1.95 * sx, 10.08, SZ), 0.12, 0.12, bevel=0.012, seg=1)
        m.beam('armor', (1.95 * sx, TOPY + 0.05, SZ + 0.9), (1.95 * sx, 9.9, SZ + 0.06), 0.08, 0.08, bevel=0.01, seg=1)          # rake braces
    m.beam('armor', (-2.0, 10.02, SZ), (2.0, 10.02, SZ), 0.1, 0.12, bevel=0.012, seg=1)
    m.beam('armor', (-2.0, 9.05, SZ), (2.0, 9.05, SZ), 0.1, 0.12, bevel=0.012, seg=1)
    for i in range(5):
        x = -1.6 + i * 0.8
        m.cyl('metal_dark', (x, 9.1, SZ + 0.02), (x, 9.97, SZ + 0.02), 0.02, seg=5)
    cut_letters(m, 'WARLORD', (0, 9.53, SZ - 0.06), 0.62, n=(0, 0, -1), mat='plastic', depth=0.09, spacing=1.1)
    for i in range(11):                                                                        # marquee bulbs
        x = -1.85 + i * 0.37
        m.revolve('light_amber', [(0.0, 0.0), (0.05, 0.02), (0.045, 0.07), (0.0, 0.08)], at=(x, 10.08, SZ - 0.02), axis='y', seg=6, closed=False)
    for i, x in enumerate((-1.5, 0.0, 1.5)):                                                   # caged floods under the sign
        caged_lamp(m, (x, 8.95, -17.2), (0, -0.12, -1), r=0.3)


# ------------------------------------------------------------------------------------------------ rear plates over the reactor (detachable, bbox kept)
def rear_plates(m):
    import os
    spans = ((-0.6, 0.6, 5.23), (0.65, 2.05, 5.18), (-2.05, -0.65, 5.18))
    for i, (x0, x1, yb) in enumerate(spans, start=1):
        if os.environ.get('NOPLATES'):
            continue
        nm = 'panel_armor_rear_%d' % i
        m.panel(nm, ((x0 + x1) / 2, 6.75, -17.05), metal_dark='armor', chrome='armor', metal_bare='armor', paint='armor', rust='armor', spike='armor',
                decal_yellow='armor', plastic='armor')
        w = x1 - x0
        xc = (x0 + x1) / 2
        # base plate (-16.94 .. -17.06) with a lower flange that reaches the old box bottom
        m.box('armor', (w, 2.7, 0.12), at=(xc, 6.75, -17.0), bevel=0.03, seg=1, obj=nm)
        m.box('armor', (w - 0.06, 0.2, 0.06), at=(xc, yb + 0.1, -17.07), bevel=0.012, seg=1, obj=nm)
        # layered patch plates (bevelled), welded + bolted
        rng = m.rng
        layers = [(xc - w * 0.18, 7.45, w * 0.58, 1.1, 0.0), (xc + w * 0.12, 6.2, w * 0.7, 0.95, 4.0)] if i != 1 else [(xc, 7.55, w * 0.8, 0.7, 0.0), (xc, 6.35, w * 0.84, 1.2, -3.0)]
        for (px, py, pw, ph, rot) in layers:
            P2.patch_plate(m, (px, py, -17.06), (0, 0, -1), pw, ph, mat='armor', t=0.05, obj=nm, bolts=4, bead=True, rot=rot, cut=0.06)
        # stiffener ribs + heavy bolts along the edges (reach the old -17.24 face)
        for y in (5.75, 8.0):
            m.box('armor', (w - 0.1, 0.1, 0.08), at=(xc, y, -17.1), bevel=0.012, seg=1, obj=nm)
        for y in (5.5, 6.4, 7.3, 7.95):
            for x in (x0 + 0.1, x1 - 0.1):
                m.hexbolt('metal_dark', (x, y, -17.06), (0, 0, -1), r=0.05, h=0.04, obj=nm)
        m.box('metal_dark', (0.24, 0.24, 0.12), at=(xc, 7.9, -17.18), bevel=0.02, seg=1, obj=nm)              # lifting lug block
        m.cyl('metal_dark', (xc - 0.08, 8.02, -17.2), (xc + 0.08, 8.02, -17.2), 0.04, seg=6, obj=nm)
        m.box('armor', (0.1, 0.1, 0.06), at=(xc, 6.8, -17.21), bevel=0.01, seg=1, obj=nm)                    # (front-most point = old bbox face)
        # chipped hazard chevrons low on the plate
        chevrons(m, (xc, 5.55, -17.09), w - 0.16, 0.3, n=(0, 0, -1), stripe=0.14, broken=0.3, obj=nm, t=0.01)
        if i == 1:                                                                                                  # reactor warning trefoil
            c = Vector((xc, 6.9, -17.12))
            m.revolve('decal_yellow', [(0.0, 0.0), (0.36, 0.0)], at=tuple(c), axis='-z', seg=16, obj=nm, closed=False)
            for k in range(3):
                a0 = PI / 2 + k * 2 * PI / 3
                fan = [(0.0, 0.0)] + [(0.3 * math.cos(a0 - 0.52 + 1.04 * j / 5), 0.3 * math.sin(a0 - 0.52 + 1.04 * j / 5)) for j in range(6)]
                fan = [(max(0.07, math.hypot(a, b)) * math.cos(math.atan2(b, a)) if (a, b) != (0.0, 0.0) else 0.0,
                        max(0.07, math.hypot(a, b)) * math.sin(math.atan2(b, a)) if (a, b) != (0.0, 0.0) else 0.0) for a, b in fan]
                m.plate('metal_dark', fan, 0.01, at=tuple(c + Vector((0, 0, -0.012))), u=(-1, 0, 0), v=(0, 1, 0), bevel=0, obj=nm)
            m.revolve('metal_dark', [(0.0, 0.0), (0.05, 0.0)], at=tuple(c + Vector((0, 0, -0.016))), axis='-z', seg=10, obj=nm, closed=False)
        m.use('body')


# ------------------------------------------------------------------------------------------------ drop ramp (detachable node, bbox kept)
def ramp(m):
    o = 'ramp_rear'
    m.panel(o, (0, 3.02, -17.0), metal_dark='armor', chrome='armor', metal_bare='armor', paint='armor', rust='armor', spike='armor', plastic='armor',
            decal_yellow='armor')
    # slab + perimeter frame
    m.box('armor', (3.9, 2.5, 0.22), at=(0, 4.27, -17.02), bevel=0.04, seg=1, obj=o)
    for y in (3.12, 5.42):
        m.box('armor', (3.9, 0.18, 0.12), at=(0, y, -17.18), bevel=0.02, seg=1, obj=o)
    for sx in (1, -1):
        m.box('armor', (0.2, 2.3, 0.12), at=(1.85 * sx, 4.27, -17.18), bevel=0.02, seg=1, obj=o)
    m.rivet_line('metal_dark', (-1.8, 5.42, -17.245), (1.8, 5.42, -17.245), (0, 0, -1), step=0.3, r=0.04, obj=o)
    m.rivet_line('metal_dark', (-1.8, 3.12, -17.245), (1.8, 3.12, -17.245), (0, 0, -1), step=0.3, r=0.04, obj=o)
    # herringbone traction bars (the ramp's walking face)
    for row in range(5):
        y = 3.35 + row * 0.2
        for sx in (1, -1):
            for k in range(4):
                x = sx * (0.25 + k * 0.4)
                m.beam('armor', (x - 0.14 * sx, y - 0.05, -17.15), (x + 0.14 * sx, y + 0.05, -17.15), 0.05, 0.05, up=(0, 0, -1), bevel=0.008, seg=1, obj=o)
    # hazard band along the top edge
    chevrons(m, (0, 5.18, -17.14), 3.4, 0.24, n=(0, 0, -1), stripe=0.18, broken=0.2, obj=o, t=0.012)
    # hinge knuckles along the bottom + hydraulic rams at the sides (these define the old box width)
    for i in range(6):
        x = -1.75 + i * 0.7
        m.cyl('metal_dark', (x - 0.22, 3.02, -17.0), (x + 0.22, 3.02, -17.0), 0.14, seg=10, obj=o)
    m.cyl('metal_dark', (-1.95, 3.02, -17.0), (1.95, 3.02, -17.0), 0.07, seg=8, obj=o)
    for sx in (1, -1):
        m.cyl('armor', (2.08 * sx, 3.25, -17.12), (2.55 * sx, 4.6, -17.3), 0.11, seg=8, obj=o)           # ram barrel
        m.cyl('chrome', (2.55 * sx, 4.6, -17.3), (2.62 * sx, 5.1, -17.33), 0.055, seg=8, obj=o)          # piston rod
        m.cyl('metal_dark', (2.03 * sx, 3.18, -17.1), (2.14 * sx, 3.34, -17.14), 0.14, seg=8, obj=o)
    # skull-and-crossbones emblem cut from plate (glowing eyes)
    plate_skull_emblem(m, (0, 4.32, -17.24), s=1.12, n=(0, 0, -1), obj=o)
    m.use('body')


# ------------------------------------------------------------------------------------------------ flame nozzles + thrusters + rear bumper (body)
def flame_nozzle(m, sx, at, name):
    """flamethrower on the tower corner: pump housing, swivel ring, nozzle swung OUTWARD (the jets fire sideways), pilot light, fuel hose.
    Socket unchanged (position + rotation) from the old rig."""
    rot = (0, 180 - 15 * sx, 0)
    A = V3(at)
    m.box('armor', (0.42, 0.62, 0.48), at=(A.x - 0.05 * sx, A.y, A.z + 0.1), bevel=0.04, seg=1)
    m.rivet_rect('metal_dark', (A.x - 0.05 * sx, A.y, A.z - 0.145), 0.42, 0.62, (0, 0, -1), u=(1, 0, 0), v=(0, 1, 0), step=0.14, r=0.025, inset=0.05)
    d = Vector((0.82 * sx, -0.06, -0.57)).normalized()
    p0 = A + Vector((0.12 * sx, 0.02, -0.12))
    m.cyl('metal_dark', tuple(p0 - d * 0.12), tuple(p0 + d * 0.08), 0.26, seg=12)                              # swivel ring
    m.cyl('armor', tuple(p0), tuple(p0 + d * 0.95), 0.12, seg=10)                                               # barrel
    m.cyl('metal_dark', tuple(p0 + d * 0.1), tuple(p0 + d * 0.62), 0.19, seg=10)                                # heat shield sleeve
    for k in range(4):
        c = p0 + d * (0.15 + k * 0.13)
        m.cyl('armor', tuple(c - d * 0.015), tuple(c + d * 0.015), 0.205, seg=10)
    m.cyl('armor', tuple(p0 + d * 0.95), tuple(p0 + d * 1.2), 0.12, 0.2, seg=10)                                # flared muzzle
    m.revolve('light_amber', [(0.0, 0.0), (0.11, 0.0)], at=tuple(p0 + d * 1.19), axis=tuple(d), seg=10, closed=False)
    pil = p0 + d * 0.9 + Vector((0, 0.18, 0))                                                                   # pilot light
    m.cyl('metal_dark', tuple(p0 + d * 0.5 + Vector((0, 0.16, 0))), tuple(pil), 0.025, seg=5)
    m.revolve('light_amber', [(0.0, 0.0), (0.04, 0.02), (0.0, 0.05)], at=tuple(pil), axis=tuple(d), seg=6, closed=False)
    m.tube('rubber_tire', [(3.05 * sx, 3.55, -16.3), (3.2 * sx, 3.4, -16.8), (A.x + 0.1 * sx, A.y - 0.25, A.z + 0.15)], 0.07, seg=6, bend=0.25, bsteps=2)
    m.sock(name, at, rot=rot, size=0.4)
    return tuple(p0 + d * 1.2)


def thruster(m, at):
    """rocket-bell booster under the ramp (nitro socket at the bell mouth side), sooted"""
    A = V3(at)
    m.box('armor', (0.7, 0.62, 0.5), at=(A.x, A.y + 0.05, -16.85), bevel=0.04, seg=1)
    with m.xf((A.x, A.y, -17.05)):
        m.revolve('metal_dark', [(0.2, 0.0), (0.2, 0.18), (0.12, 0.28), (0.18, 0.42), (0.3, 0.62), (0.36, 0.78), (0.34, 0.8), (0.27, 0.62), (0.15, 0.44),
                                 (0.08, 0.3), (0.0, 0.3)], axis='-z', seg=16, closed=False)
        for k in range(3):
            t = 0.46 + k * 0.1
            rr = 0.18 + 0.2 * (t - 0.42) / 0.36 + 0.02
            m.revolve('armor', [(rr, t - 0.012), (rr + 0.02, t), (rr, t + 0.012)], axis='-z', seg=16, closed=False)
        for k in range(4):
            a = 2 * PI * k / 4 + PI / 4
            m.tube('metal_dark', [(0.22 * math.cos(a), 0.22 * math.sin(a), 0.1), (0.3 * math.cos(a), 0.3 * math.sin(a), -0.05), (0.32 * math.cos(a), 0.32 * math.sin(a), 0.2)],
                   0.025, seg=4)
    return (A.x, A.y, -17.85)


def rear_bumper(m):
    m.box('armor', (5.0, 0.42, 0.34), at=(0, 1.55, -17.25), bevel=0.04, seg=1)
    m.rivet_line('metal_dark', (-2.3, 1.55, -17.43), (2.3, 1.55, -17.43), (0, 0, -1), step=0.3, r=0.035)
    chevrons(m, (0, 1.55, -17.42), 4.6, 0.3, n=(0, 0, -1), stripe=0.2, broken=0.3, t=0.012)
    for sx in (1, -1):
        m.beam('armor', (1.4 * sx, 1.7, -16.9), (1.5 * sx, 2.3, -16.3), 0.2, 0.3, bevel=0.02, seg=1)
    for (x, L) in ((-2.2, 0.8), (-0.55, 1.2), (0.55, 1.2), (2.2, 0.8)):
        P2.spike2(m, (x, 1.55, -17.42), (x * 1.04, 1.5, -17.42 - L), 0.09, mat='spike')


def rear(m):
    """everything at the back of trailer #2 that is body"""
    tower(m)
    tower_top(m)
    spots = []
    spots.append(flame_nozzle(m, 1, (2.55, 4.1, -17.05), 'flame_L'))
    spots.append(flame_nozzle(m, -1, (-2.55, 4.1, -17.05), 'flame_R'))
    for sx in (1, -1):
        spots.append(thruster(m, (1.9 * sx, 2.2, -17.25)))
    rear_bumper(m)
    m.sock('nitro_L', (1.9, 2.2, -17.25))
    m.sock('nitro_R', (-1.9, 2.2, -17.25))
    m.sock('light_tail_L', (2.15, 4.6, -17.35))
    m.sock('light_tail_R', (-2.15, 4.6, -17.35))
    return spots


# ------------------------------------------------------------------------------------------------ trailer #2 flanks
def flanks2(m, Z2F=-9.7, Z2R=-17.0):
    m.use('body')
    for sx in (1, -1):
        x = 2.25 * sx
        # stiffeners + rub rail on the side wall, bolted patches, hazard band at the rear end
        for z in (-10.4, -11.9, -13.4, -14.9, -16.3):
            m.box('armor', (0.1, 1.8, 0.14), at=(x + 0.18 * sx, 3.65, z), bevel=0.02, seg=1)
        m.box('metal_dark', (0.12, 0.16, 7.0), at=(x + 0.2 * sx, 4.45, -13.3), bevel=0.02, seg=1)
        chevrons(m, (x + 0.16 * sx, 2.5, -16.2), 1.3, 0.34, n=(sx, 0, 0), stripe=0.18, broken=0.25)
        chevrons(m, (x + 0.16 * sx, 2.5, -10.3), 1.1, 0.34, n=(sx, 0, 0), stripe=0.18, broken=0.25)
        P2.patch_plate(m, (x + 0.15 * sx, 3.75, -12.6), (sx, 0, 0), 0.9, 0.6, mat='rust', t=0.03, bolts=4, bead=True, rot=5)
        # walkway railing along the wall top + a sandbagged firing stand at the front corner
        railing(m, [(2.3 * sx, 4.6, -11.2), (2.3 * sx, 4.6, -14.9)], h=0.95, r=0.03, post_step=0.95, rails=(0.5, 0.95), mat='metal_dark')
        m.box('armor', (1.05, 0.08, 1.15), at=(1.88 * sx, 4.62, -10.45), bevel=0.02, seg=1)
        m.box('armor', (0.16, 1.5, 0.16), at=(1.5 * sx, 3.85, -10.45), bevel=0.02, seg=1)
        P2.sandbag_ring(m, [(1.4 * sx, -9.95), (2.35 * sx, -9.95), (2.35 * sx, -10.95)], 4.66, rows=2, L=0.5, D=0.3, H=0.16)
        m.plate('armor', [(-0.45, 0.0), (0.45, 0.0), (0.4, 0.6), (0.1, 0.6), (0.06, 0.48), (-0.06, 0.48), (-0.1, 0.6), (-0.4, 0.6)], 0.03,
                at=(1.9 * sx, 4.95, -9.9), u=(1, 0, 0), v=(0, 1, 0), bevel=0.006, seg=1)
        P2.ammo_can(m, (1.8 * sx, 4.66, -10.7), yaw=80, mat='paint2', size=(0.22, 0.26, 0.4))
        # chain draped between the wheel arch and the tower
        chain(m, (3.3 * sx, 2.9, -15.3), (3.3 * sx, 2.9, -16.9), sag=0.3, link=0.28, r=0.05)
        # tank cradle straps (below the tank only: they stay when the tank blows)
        for zz in (-11.9, -15.4):
            m.box('metal_dark', (0.9, 0.08, 0.16), at=(2.75 * sx, 3.18, zz), bevel=0.01, seg=1)


def trailer1_rear(m, Z1R=-8.4):
    """hazard paint + caged floods on the back of trailer #1 (seen from behind-sides over trailer #2)"""
    m.use('body')
    chevrons(m, (0, 4.85, Z1R - 0.2), 5.6, 0.3, n=(0, 0, -1), stripe=0.2, broken=0.3)
    for sx in (1, -1):
        caged_lamp(m, (3.05 * sx, 5.7, -8.75), (0.2 * sx, -0.1, -1), r=0.25)
        m.box('metal_dark', (0.12, 0.3, 0.3), at=(3.05 * sx, 5.55, -8.6), bevel=0.01, seg=1)
