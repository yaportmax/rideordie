"""The Leviathan's rear and flanks: trailer #2 reactor tower, bolt-on rear plates, drop ramp, flame nozzles, thrusters, bumper,
flank firing stands, back of trailer #1 - what the players chase for the whole fight (seen from behind / behind-sides at 10-60 m).
Game space (+X left, +Y up, +Z forward), same conventions as boss_warrig.py.

Contract (src/data/boss.js reads part boxes from model_info.json):
  * panel_armor_rear_1/2/3 and ramp_rear keep their node origins and (to ~1 cm) their bounding boxes; all their detail is parented to them.
  * part_engine (reactor) is unchanged and stays enclosed: tower sides, front and roof are closed, only the three rear plates cover it.
  * sockets flame_L/R, nitro_L/R, light_tail_L/R keep position + rotation.
"""
import math
from mathutils import Vector
from boss_parts import *  # noqa  (wall, reactor, railing, light_rect, skull, V3 ...)
import parts2 as P2

PI = math.pi
TZ0, TZ1 = -17.0, -15.1          # tower rear / front face z
DECKY = 8.75                     # tower roof deck top
SZ = -16.62                      # WARLORD sign backing plate (z)


def _frame(n, up=(0, 1, 0)):
    return P2._frame(n, up)


def _clip_x(poly, a, b):
    """clip a convex 2D polygon to a <= x <= b"""
    def clip(pts, x0, ge):
        out = []
        for i in range(len(pts)):
            P, Q = pts[i], pts[(i + 1) % len(pts)]
            pin = P[0] >= x0 if ge else P[0] <= x0
            qin = Q[0] >= x0 if ge else Q[0] <= x0
            if pin:
                out.append(P)
            if pin != qin:
                t = (x0 - P[0]) / (Q[0] - P[0])
                out.append((x0, P[1] + t * (Q[1] - P[1])))
        return out
    p = clip(list(poly), a, True)
    if len(p) >= 3:
        p = clip(p, b, False)
    if len(p) < 3:
        return []
    ar = 0.5 * abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))))
    return p if ar > 2e-4 else []


def chevrons(m, c, w, h, n, obj=None, stripe=0.2, gaps=1, t=0.012, up=(0, 1, 0), slant=1, dark='metal_dark', yellow='decal_yellow'):
    """hazard band as real thin plates on a surface (c on the surface, n outward): yellow strip broken into pieces (paint lost at the
    gaps, steel shows through) with dark diagonal stripes on top.  Chipping comes from the decal_yellow bake recipe."""
    U, V_, N = _frame(n, up)
    C = V3(c)
    rng = m.rng
    cuts = sorted(rng.uniform(-w / 2 + 0.25, w / 2 - 0.25) for _ in range(gaps)) if w > 0.8 else []
    pieces, x = [], -w / 2
    for cu in cuts:
        g = rng.uniform(0.03, 0.11)
        pieces.append((x, cu - g / 2)); x = cu + g / 2
    pieces.append((x, w / 2))
    t2 = t * 0.6
    for (a, b) in pieces:
        if b - a < 0.08:
            continue
        m.plate(yellow, [(a, -h / 2), (b, -h / 2), (b, h / 2), (a, h / 2)], t, at=tuple(C + N * (t / 2)), u=tuple(U), v=tuple(V_), bevel=0, obj=obj)
        x0 = -w / 2 - h
        while x0 < w / 2:
            poly = [(x0, -h / 2), (x0 + stripe, -h / 2), (x0 + stripe + h, h / 2), (x0 + h, h / 2)]
            if slant < 0:
                poly = [(-p[0], p[1]) for p in poly][::-1]
            cp = _clip_x(poly, a, b)
            if cp:
                m.plate(dark, cp, t2, at=tuple(C + N * (t + t2 / 2)), u=tuple(U), v=tuple(V_), bevel=0, obj=obj)
            x0 += stripe * 2


def bpatch(m, c, n, w, h, t=0.035, obj=None, rot=0.0, bolt_r=0.035, bolts=True, bead_r=0.02, cut=0.09, mat='armor', up=(0, 1, 0)):
    """boss-scale scrap patch plate: bevelled, corner-cut, fillet-welded all round, bolted at the corners + long-edge midpoints"""
    U, V_, N = _frame(n, up)
    if rot:
        ca, sa = math.cos(rot * D2R), math.sin(rot * D2R)
        U, V_ = U * ca + V_ * sa, V_ * ca - U * sa
    C0 = V3(c)
    C = C0 + N * (t / 2)
    hw, hh = w / 2, h / 2
    poly = [(-hw + cut, -hh), (hw, -hh), (hw, hh - cut), (hw - cut, hh), (-hw, hh), (-hw, -hh + cut)]
    m.plate(mat, poly, t, at=tuple(C), u=tuple(U), v=tuple(V_), bevel=0.008, seg=1, obj=obj)
    pts = [tuple(C0 + U * x + V_ * y) for x, y in poly + [poly[0]]]
    m.bead('armor', pts, r=bead_r, obj=obj, n=tuple(N), step=0.11, seg=3)
    if bolts:
        ins = bolt_r * 2.2
        spots = [(-hw + ins + cut * 0.5, -hh + ins), (hw - ins, -hh + ins), (hw - ins - cut * 0.5, hh - ins), (-hw + ins, hh - ins)]
        if w > 0.7:
            spots += [(0, -hh + ins), (0, hh - ins)]
        if h > 0.7:
            spots += [(-hw + ins, 0), (hw - ins, 0)]
        for x, y in spots:
            m.hexbolt('metal_dark', tuple(C + U * x + V_ * y + N * (t / 2)), tuple(N), r=bolt_r, h=bolt_r * 0.7, obj=obj)


def caged_lamp(m, at, n, r=0.22, obj='body', bars=3):
    """work lamp on a U bracket behind a bent-bar guard"""
    nn = V3(n).normalized()
    P2.spot2(m, at, n=tuple(nn), r=r, obj=obj, seg=10)
    P2.cage_bars(m, tuple(V3(at) + nn * 0.012), tuple(nn), r * 2.3, r * 2.3, nb=bars, r=max(0.012, r * 0.06), depth=r * 0.6, obj=obj)


def chain_loop(m, a, b, sag, link=0.22, wire=0.028, obj=None, k=7):
    """chain hanging between two points (parabolic sag), 24 tris per link"""
    A, B = V3(a), V3(b)
    pts = [tuple(A + (B - A) * (i / k) - Vector((0, sag * 4 * (i / k) * (1 - i / k), 0))) for i in range(k + 1)]
    P2.chain(m, pts, link=link, wire=wire, obj=obj)


def plate_skull_emblem(m, c, s=1.0, n=(0, 0, -1), obj=None, bone='plastic', glow='light_amber'):
    """skull-and-crossbones cut from steel plate (bone paint), on stand-offs, glowing eye holes; c on the mounting surface"""
    U, V_, N = _frame(n)
    C = V3(c)
    t = 0.06 * s
    for sg in (1, -1):                                                        # crossed bones (square bars, knuckle ends)
        a = C + U * (-0.9 * s * sg) + V_ * (-0.76 * s) + N * (0.045 * s)
        b = C + U * (0.9 * s * sg) + V_ * (0.72 * s) + N * (0.045 * s)
        m.beam(bone, tuple(a), tuple(b), 0.15 * s, 0.07 * s, up=tuple(N), bevel=0.012 * s, seg=1, obj=obj)
        d = (b - a).normalized()
        sd = d.cross(N).normalized()
        for e in (a, b):
            for kk in (-1, 1):
                q = e + sd * (0.07 * s * kk)
                m.cyl(bone, tuple(q - N * (0.035 * s)), tuple(q + N * (0.035 * s)), 0.08 * s, seg=8, obj=obj)
    P = C + N * (0.1 * s)
    cran = [(0.6 * s * math.cos(a), 0.2 * s + 0.56 * s * math.sin(a)) for a in [PI * i / 10 for i in range(11)]]
    cran += [(-0.6 * s, -0.06 * s), (-0.48 * s, -0.28 * s), (-0.32 * s, -0.36 * s), (0.32 * s, -0.36 * s), (0.48 * s, -0.28 * s), (0.6 * s, -0.06 * s)]
    eye = lambda x: [(x + 0.16 * s * math.cos(2 * PI * k / 8), 0.1 * s + 0.13 * s * math.sin(2 * PI * k / 8)) for k in range(8)]
    nose = [(0.0, -0.06 * s), (-0.08 * s, -0.24 * s), (0.08 * s, -0.24 * s)]
    m.plate(bone, cran, t, at=tuple(P), u=tuple(U), v=tuple(V_), bevel=0.01 * s, seg=1, holes=[eye(-0.24 * s), eye(0.24 * s), nose], obj=obj)
    jaw = [(-0.34 * s, -0.66 * s), (0.34 * s, -0.66 * s), (0.36 * s, -0.4 * s), (-0.36 * s, -0.4 * s)]
    m.plate(bone, jaw, t, at=tuple(P - N * (0.012 * s)), u=tuple(U), v=tuple(V_), bevel=0.008 * s, seg=1, obj=obj)
    for i in range(6):                                                        # teeth bridging skull and jaw
        x = (-0.25 + i * 0.1) * s
        m.plate(bone, [(x - 0.034 * s, -0.46 * s), (x + 0.034 * s, -0.46 * s), (x + 0.03 * s, -0.33 * s), (x - 0.03 * s, -0.33 * s)], t * 0.8,
                at=tuple(P + N * (0.006 * s)), u=tuple(U), v=tuple(V_), bevel=0.004 * s, seg=1, obj=obj)
    back = C + N * (0.05 * s)                                                 # glow plates behind the eye holes, dark behind the nose
    for x in (-0.24, 0.24):
        m.plate(glow, [(x * s + 0.15 * s * math.cos(2 * PI * k / 8), 0.1 * s + 0.12 * s * math.sin(2 * PI * k / 8)) for k in range(8)], 0.03 * s,
                at=tuple(back), u=tuple(U), v=tuple(V_), bevel=0, obj=obj)
    m.plate('metal_dark', [(0.0, -0.04 * s), (-0.1 * s, -0.27 * s), (0.1 * s, -0.27 * s)], 0.03 * s, at=tuple(back), u=tuple(U), v=tuple(V_), bevel=0, obj=obj)
    for (x, y) in ((-0.44, 0.4), (0.44, 0.4), (0.0, 0.66), (-0.44, -0.16), (0.44, -0.16), (-0.24, -0.56), (0.24, -0.56)):
        m.hexbolt('metal_dark', tuple(P + U * (x * s) + V_ * (y * s) + N * (t / 2)), tuple(N), r=0.032 * s, h=0.024 * s, obj=obj)
    fr = P + N * (t / 2)                                                      # crack weld across the brow
    m.bead('armor', [tuple(fr + U * (0.06 * s) + V_ * (0.74 * s)), tuple(fr + U * (0.13 * s) + V_ * (0.5 * s)), tuple(fr + U * (0.03 * s) + V_ * (0.3 * s))],
           r=0.02 * s, n=tuple(N), obj=obj, step=0.08, seg=3)


# ------------------------------------------------------------------------------------------------ tower (body)
def apanel_like(m, name, origin):
    m.panel(name, origin, metal_dark='armor', chrome='armor', metal_bare='armor', paint='armor', paint2='armor', rust='armor', spike='armor',
            plastic='armor')


def tower(m):
    m.use('body')
    for sx in (1, -1):
        x = 2.1 * sx
        m.box('paint', (0.5, 5.4, 1.9), at=(x, 5.7, -16.05), bevel=0.05, seg=1)                    # pillar
        m.box('armor', (0.4, 0.3, 1.9), at=(1.9 * sx, 3.1, -16.05), bevel=0.02, seg=1)              # pillar foot
        # rear face: bolted armour strip, joint weld, hazard foot, tail + amber lamps, caged work lamp
        m.box('armor', (0.54, 5.3, 0.08), at=(x, 5.65, TZ0 - 0.04), bevel=0.02, seg=1)
        for dx in (-0.21, 0.21):
            m.rivet_line('metal_dark', (x + dx, 5.05, TZ0 - 0.08), (x + dx, 8.1, TZ0 - 0.08), (0, 0, -1), step=0.34, r=0.035)
        m.bead('armor', [(x - 0.27, 6.2, TZ0 - 0.08), (x + 0.27, 6.2, TZ0 - 0.08)], r=0.025, n=(0, 0, -1), step=0.1, seg=3)
        chevrons(m, (x, 3.42, TZ0 - 0.08), 0.5, 0.34, (0, 0, -1), stripe=0.11, gaps=0, slant=sx)
        P2.taillight2(m, (2.15 * sx, 4.6, TZ0 - 0.08), 0.34, 0.5, n=(0, 0, -1), obj='body')
        light_rect(m, (2.15 * sx, 3.95, TZ0 - 0.08), (0.3, 0.16), 'light_amber', n=(0, 0, -1), depth=0.1)
        P2.cage_bars(m, (2.15 * sx, 3.95, TZ0 - 0.1), (0, 0, -1), 0.4, 0.26, nb=3, r=0.014, depth=0.07, obj='body')
        m.box('metal_dark', (0.12, 0.12, 0.2), at=(x, 7.35, TZ0 - 0.18), bevel=0.01, seg=1)
        caged_lamp(m, (x, 7.55, TZ0 - 0.3), (0, -0.1, -1), r=0.2)
        # side wall plates (panel_tower_*), unchanged node + origin; a firing port on them
        nm = 'panel_tower_%s' % ('L' if sx > 0 else 'R')
        apanel_like(m, nm, (2.4 * sx, 5.7, -16.05))
        wall(m, 'armor', (2.36 * sx, 5.7, -16.05), (0, 0, -sx), (0, 1, 0), 1.9, 5.2, 1, 3, t=0.08, gap=0.08, rr=0.04, bevel=0.03, obj=nm)
        P2.firing_port(m, (2.49 * sx, 7.55, -15.75), (sx, 0, 0), w=0.52, h=0.13, mat='armor', obj=nm, open_=0.55)
        m.use('body')
        # exhaust stack out of the tower side (above the fuel tank), soot at the top (bake heat spot)
        m.tube('metal_dark', [(2.3 * sx, 5.35, -15.65), (2.8 * sx, 5.35, -15.65), (2.8 * sx, 5.75, -15.65)], 0.17, seg=10, bend=0.26, bsteps=3)
        P2.exhaust_stack2(m, (2.8 * sx, 5.7, -15.65), (2.8 * sx, 9.95, -15.65), r=0.17, mat='chrome', cap='metal_dark', seg=10)
        for y in (6.9, 8.5):
            m.box('metal_dark', (0.36, 0.08, 0.14), at=(2.62 * sx, y, -15.65), bevel=0.01, seg=1)
        # chain loop hanging in front of each pillar head
        chain_loop(m, (1.88 * sx, 8.32, TZ0 - 0.13), (2.34 * sx, 8.32, TZ0 - 0.13), sag=0.75, link=0.22, wire=0.03, k=6)
    # lintel over the plates (closes the slot under the roof slab) + bolts
    m.box('armor', (4.2, 0.3, 0.26), at=(0, 8.25, TZ0), bevel=0.03, seg=1)
    for i in range(9):
        m.hexbolt('metal_dark', (-1.8 + i * 0.45, 8.25, TZ0 - 0.13), (0, 0, -1), r=0.045, h=0.035)
    # left side: ladder from the tank top to the roof, with a safety cage
    for z in (-16.35, -16.85):
        m.cyl('metal_dark', (2.62, 5.15, z), (2.62, 9.45, z), 0.035, seg=6)
        for y in (5.6, 7.4, 9.0):
            m.box('metal_dark', (0.16, 0.06, 0.06), at=(2.54, y, z), bevel=0, seg=1)
    for i in range(13):
        y = 5.45 + i * 0.3
        m.cyl('metal_dark', (2.62, y, -16.85), (2.62, y, -16.35), 0.022, seg=5)
    for i in range(6):
        y = 6.6 + i * 0.54
        m.tube('metal_dark', [(2.62 + 0.4 * math.sin(a), y, -16.6 - 0.25 * math.cos(a)) for a in [PI * k / 6 for k in range(7)]], 0.018, seg=4)
    for a in (PI / 4, PI / 2, 3 * PI / 4):
        m.cyl('metal_dark', (2.62 + 0.4 * math.sin(a), 6.6, -16.6 - 0.25 * math.cos(a)), (2.62 + 0.4 * math.sin(a), 9.3, -16.6 - 0.25 * math.cos(a)), 0.016, seg=4)
    # right side: reactor coolant radiator behind guard bars, pipes into the wall
    m.box('metal_dark', (0.14, 2.3, 0.8), at=(-2.55, 6.85, -16.5), bevel=0.015, seg=1)
    for i in range(10):
        m.box('metal_dark', (0.12, 0.028, 0.72), at=(-2.66, 5.86 + i * 0.22, -16.5), bevel=0, seg=1)
    for i in range(5):
        z = -16.82 + i * 0.16
        m.cyl('metal_dark', (-2.76, 5.55, z), (-2.76, 8.15, z), 0.022, seg=5)
    for y in (5.6, 8.1):
        m.box('armor', (0.1, 0.07, 0.9), at=(-2.72, y, -16.5), bevel=0, seg=1)
    for z in (-16.2, -16.8):
        m.tube('metal_dark', [(-2.55, 8.05, z), (-2.55, 8.35, z), (-2.44, 8.45, z)], 0.06, seg=6, bend=0.12, bsteps=2)
    # tower front wall (faces the cannon): plate, rivets, hazard band, ribs
    m.box('armor', (3.6, 0.2, 0.3), at=(0, 5.45, -15.2), bevel=0.02, seg=1)
    m.plate('armor', [(-2.05, 5.45), (2.05, 5.45), (2.05, 8.4), (-2.05, 8.4)], 0.22, at=(0, 0, TZ1), u=(1, 0, 0), v=(0, 1, 0), bevel=0.03, seg=1)
    m.rivet_rect('metal_dark', (0, 6.9, TZ1 + 0.11), 4.1, 2.9, (0, 0, 1), u=(1, 0, 0), v=(0, 1, 0), step=0.42, r=0.045, inset=0.12)
    chevrons(m, (0, 7.85, TZ1 + 0.11), 3.7, 0.36, (0, 0, 1), stripe=0.2, gaps=1)
    for xx in (-1.0, 1.0):
        m.beam('armor', (xx, 5.6, TZ1 + 0.15), (xx, 7.6, TZ1 + 0.15), 0.12, 0.08, up=(0, 0, 1), bevel=0.01, seg=1)
    reactor(m, (0, 6.75, -16.05), s=1.0)                                     # the weak point (unchanged)
    m.use('body')


def tower_top(m):
    """roof deck, railings, sandbagged rear-corner stands, skulls on spikes, flags, spike crown, WARLORD sign (cut-plate letters,
    marquee bulbs) and caged floods on the pillar heads"""
    m.use('body')
    m.box('paint2', (5.0, 0.3, 2.1), at=(0, 8.55, -16.1), bevel=0.05, seg=1)
    m.box('armor', (4.7, 0.05, 1.8), at=(0, DECKY - 0.025, -16.1), bevel=0.01, seg=1)
    for i in range(9):
        m.box('metal_dark', (4.6, 0.03, 0.05), at=(0, DECKY + 0.015, -16.9 + i * 0.2), bevel=0)
    for sx in (1, -1):
        railing(m, [(2.36 * sx, DECKY, -15.2), (2.36 * sx, DECKY, -16.25)], h=0.95, r=0.03, post_step=0.55, rails=(0.48, 0.95), mat='metal_dark')
    railing(m, [(2.36, DECKY, -15.16), (-2.36, DECKY, -15.16)], h=0.95, r=0.03, post_step=1.2, rails=(0.48, 0.95), mat='metal_dark')
    m.revolve('armor', [(0.0, 0.0), (0.42, 0.0), (0.42, 0.07), (0.36, 0.1), (0.0, 0.1)], at=(-0.9, DECKY, -15.75), axis='y', seg=12)   # roof hatch
    m.tube('metal_dark', [(-0.9 + 0.18 * math.cos(2 * PI * k / 8), DECKY + 0.16, -15.75 + 0.18 * math.sin(2 * PI * k / 8)) for k in range(9)], 0.016, seg=4)
    m.cyl('metal_dark', (-0.9, DECKY + 0.1, -15.75), (-0.9, DECKY + 0.16, -15.75), 0.03, seg=5)
    for sx in (1, -1):
        # rear-corner gun stand: two courses of sandbags, ammo
        P2.sandbag_ring(m, [(2.2 * sx, -16.3), (2.2 * sx, -16.98), (1.25 * sx, -16.98)], DECKY + 0.02, rows=2, L=0.55, D=0.32, H=0.18)
        P2.ammo_can(m, (1.7 * sx, DECKY + 0.02, -16.45), yaw=15 * sx, mat='paint2', size=(0.22, 0.26, 0.4))
        # horned skull on a spike pole beside the sign
        m.cyl('metal_dark', (2.3 * sx, DECKY, -17.05), (2.3 * sx, 9.72, -17.05), 0.04, seg=6)
        P2.skull2(m, (2.3 * sx, 9.8, -17.07), s=1.35, n=(0.25 * sx, 0.05, -1), mat='plastic', dark='light_amber', horn_mat='metal_dark')
        # flag poles at the front corners (flags stream back)
        m.cyl('metal_dark', (2.3 * sx, DECKY, -15.25), (2.3 * sx, 10.05, -15.25), 0.035, seg=6)
        P2.flag(m, (2.3 * sx, 10.0, -15.28), length=1.1, height=0.62, direction=(0.22 * sx, 0, -1), mat='cloth_red', cols=8, wave=0.08, t=0.012)
        # spikes along the roof side edges
        for k in range(4):
            z = -15.4 - k * 0.5
            P2.spike2(m, (2.5 * sx, 8.55, z), (2.95 * sx, 8.62, z - 0.12), 0.055, mat='spike')
        # caged floods on the pillar heads (outside the sign so they never hide the letters)
        m.box('metal_dark', (0.1, 0.36, 0.1), at=(2.15 * sx, DECKY + 0.08, -17.12), bevel=0.01, seg=1)
        caged_lamp(m, (2.15 * sx, 9.08, -17.28), (0.1 * sx, -0.12, -1), r=0.27)
    # spike crown along the rear roof edge (above the lintel)
    for i in range(9):
        x = -2.0 + i * 0.5
        P2.spike2(m, (x, 8.52, -17.16), (x * 1.03, 8.44, -17.62 - 0.1 * (i % 2)), 0.06, mat='spike')
    # WARLORD sign: welded frame, dark backing plate, bone letters cut from 9 cm plate standing proud on stand-offs, marquee bulbs
    for sx in (1, -1):
        m.beam('armor', (1.99 * sx, DECKY, SZ), (1.99 * sx, 10.1, SZ), 0.12, 0.12, bevel=0.012, seg=1)
        m.beam('armor', (1.99 * sx, DECKY + 0.03, SZ + 0.85), (1.99 * sx, 9.75, SZ + 0.07), 0.08, 0.08, bevel=0.008, seg=1)
    m.beam('armor', (-2.05, 10.04, SZ), (2.05, 10.04, SZ), 0.12, 0.12, bevel=0.012, seg=1)
    m.beam('armor', (-2.05, 9.12, SZ), (2.05, 9.12, SZ), 0.12, 0.12, bevel=0.012, seg=1)
    m.plate('metal_dark', [(-1.93, 9.17), (1.93, 9.17), (1.93, 9.99), (-1.93, 9.99)], 0.04, at=(0, 0, SZ), u=(-1, 0, 0), v=(0, 1, 0), bevel=0.006, seg=1)
    m.rivet_rect('metal_dark', (0, 9.58, SZ - 0.02), 3.86, 0.82, (0, 0, -1), u=(-1, 0, 0), v=(0, 1, 0), step=0.48, r=0.03, inset=0.05)
    m.text('plastic', 'WARLORD', (0, 9.56, SZ - 0.02 - 0.05 - 0.045), u=(-1, 0, 0), v=(0, 1, 0), size=0.8, depth=0.09, res=2, spacing=1.04, bold=0.012)
    for i in range(12):
        x = -1.87 + i * 0.34
        for y in (10.04, 9.12):
            m.revolve('light_amber', [(0.0, 0.0), (0.045, 0.015), (0.04, 0.06), (0.0, 0.075)], at=(x, y, SZ - 0.06), axis='-z', seg=6)


# ------------------------------------------------------------------------------------------------ rear plates over the reactor (detachable)
def rear_plates(m):
    import os
    specs = ((-0.6, 0.6, 5.23, -17.24), (0.65, 2.05, 5.18, -17.25), (-2.05, -0.65, 5.18, -17.25))
    layouts = {1: [(0.0, 7.72, 0.8, 0.5, 0.0), (0.0, 6.18, 0.84, 0.46, -3.0)],
               2: [(-0.2, 7.42, 0.6, 1.08, 0.0), (0.13, 6.3, 0.72, 0.88, 4.0)],
               3: [(0.16, 7.5, 0.66, 0.92, -2.5), (-0.1, 6.28, 0.7, 0.84, 0.0)]}
    for i, (x0, x1, yb, zmin) in enumerate(specs, start=1):
        if os.environ.get('NOPLATES'):
            continue
        nm = 'panel_armor_rear_%d' % i
        m.panel(nm, ((x0 + x1) / 2, 6.75, -17.05), metal_dark='armor', chrome='armor', metal_bare='armor', paint='armor', paint2='armor', rust='armor',
                spike='armor', decal_yellow='armor', plastic='armor')
        w = x1 - x0
        xc = (x0 + x1) / 2
        m.box('armor', (w, 2.7, 0.12), at=(xc, 6.75, -17.0), bevel=0.03, seg=1, obj=nm)                     # base plate -16.94..-17.06
        m.box('armor', (w - 0.04, 5.45 - yb, 0.06), at=(xc, (yb + 5.45) / 2, -17.08), bevel=0.012, seg=1, obj=nm)   # kick flange
        for (px, py, pw, ph, rot) in layouts[i]:                                                             # layered patches
            bpatch(m, (xc + px * w, py, -17.06), (0, 0, -1), pw * w, ph, t=0.035, obj=nm, rot=rot, bolt_r=0.032, bead_r=0.02)
        for xx in (x0 + 0.06, x1 - 0.06):                                                                    # edge stiffeners + bolts
            m.box('armor', (0.08, 2.5, 0.05), at=(xx, 6.72, -17.085), bevel=0.01, seg=1, obj=nm)
            for k in range(7):
                m.hexbolt('metal_dark', (xx, 5.6 + k * 0.38, -17.11), (0, 0, -1), r=0.032, h=0.024, obj=nm)
        m.box('armor', (w - 0.1, 0.08, 0.05), at=(xc, 7.98, -17.085), bevel=0.01, seg=1, obj=nm)
        dz = -17.06 - zmin                                                                                    # lifting lug (front-most point)
        m.box('armor', (0.26, 0.2, dz), at=(xc, 7.9, -17.06 - dz / 2), bevel=0.02, seg=1, obj=nm)
        m.cyl('metal_dark', (xc - 0.15, 7.9, zmin + 0.06), (xc + 0.15, 7.9, zmin + 0.06), 0.035, seg=6, obj=nm)
        chevrons(m, (xc, 5.62, -17.06), w - 0.2, 0.3, (0, 0, -1), obj=nm, stripe=0.13, gaps=1 if w > 1.3 else 0, slant=1 if i != 3 else -1)
        if i == 1:                                                                                            # reactor trefoil
            c = Vector((xc, 6.92, -17.06))
            circ = lambda r_, k=16: [(r_ * math.cos(2 * PI * j / k), r_ * math.sin(2 * PI * j / k)) for j in range(k)]
            m.plate('decal_yellow', circ(0.34), 0.012, at=tuple(c + Vector((0, 0, -0.006))), u=(-1, 0, 0), v=(0, 1, 0), bevel=0, obj=nm)
            for k in range(3):
                a0 = PI / 2 + k * 2 * PI / 3
                fan = [(0.0, 0.0)] + [(0.29 * math.cos(a0 - 0.52 + 1.04 * j / 4), 0.29 * math.sin(a0 - 0.52 + 1.04 * j / 4)) for j in range(5)]
                m.plate('metal_dark', fan, 0.008, at=tuple(c + Vector((0, 0, -0.016))), u=(-1, 0, 0), v=(0, 1, 0), bevel=0, obj=nm)
            m.plate('decal_yellow', circ(0.1, 10), 0.006, at=tuple(c + Vector((0, 0, -0.023))), u=(-1, 0, 0), v=(0, 1, 0), bevel=0, obj=nm)
            m.plate('metal_dark', circ(0.06, 8), 0.006, at=tuple(c + Vector((0, 0, -0.029))), u=(-1, 0, 0), v=(0, 1, 0), bevel=0, obj=nm)
        m.use('body')


# ------------------------------------------------------------------------------------------------ drop ramp (detachable node)
def ramp(m):
    o = 'ramp_rear'
    m.panel(o, (0, 3.02, -17.0), metal_dark='armor', chrome='armor', metal_bare='armor', paint='armor', paint2='armor', rust='armor', spike='armor',
            plastic='armor', decal_yellow='armor')
    m.box('armor', (3.9, 2.5, 0.22), at=(0, 4.27, -17.02), bevel=0.04, seg=1, obj=o)                        # slab -17.13..-16.91
    for y in (3.14, 5.42):
        m.box('armor', (3.9, 0.16, 0.1), at=(0, y, -17.18), bevel=0.02, seg=1, obj=o)
        m.rivet_line('metal_dark', (-1.8, y, -17.23), (1.8, y, -17.23), (0, 0, -1), step=0.3, r=0.04, obj=o)
    for sx in (1, -1):
        m.box('armor', (0.18, 2.12, 0.1), at=(1.86 * sx, 4.28, -17.18), bevel=0.02, seg=1, obj=o)
        for k in range(8):                                                                                   # traction bars
            y = 3.42 + k * 0.21
            m.beam('armor', (1.25 * sx, y - 0.04, -17.155), (1.68 * sx, y + 0.06, -17.155), 0.05, 0.05, up=(0, 0, -1), bevel=0.008, seg=1, obj=o)
    chevrons(m, (0, 5.2, -17.13), 3.5, 0.22, (0, 0, -1), obj=o, stripe=0.17, gaps=2)
    for i in range(6):                                                                                       # hinge knuckles on the pivot axis
        x = -1.75 + i * 0.7
        m.cyl('metal_dark', (x - 0.22, 3.02, -17.0), (x + 0.22, 3.02, -17.0), 0.14, seg=10, obj=o)
    m.cyl('metal_dark', (-1.98, 3.02, -17.0), (1.98, 3.02, -17.0), 0.07, seg=8, obj=o)
    for sx in (1, -1):                                                                                       # hydraulic rams
        m.cyl('armor', (2.06 * sx, 3.22, -17.1), (2.46 * sx, 4.45, -17.3), 0.11, seg=8, obj=o)
        m.cyl('chrome', (2.46 * sx, 4.45, -17.3), (2.62 * sx, 5.05, -17.39), 0.055, seg=8, obj=o)
        m.cyl('metal_dark', (2.0 * sx, 3.14, -17.08), (2.12 * sx, 3.3, -17.12), 0.14, seg=8, obj=o)
        m.cyl('metal_dark', (2.62 * sx, 5.05, -17.26), (2.62 * sx, 5.05, -17.44), 0.06, seg=6, obj=o)
    plate_skull_emblem(m, (0, 4.14, -17.13), s=0.98, n=(0, 0, -1), obj=o)
    m.use('body')


# ------------------------------------------------------------------------------------------------ flame nozzles, thrusters, bumper (body)
def flame_nozzle(m, sx, at, name):
    """flamethrower on the tower corner.  The jets fire sideways (fx: dir (side, -0.07, 0.04)), so the nozzle swings outboard from a
    pump housing; swivel ring, heat sleeve with fins, flared muzzle with a hot glow, pilot light, fuel hose from the tank.  Socket unchanged."""
    rot = (0, 180 - 15 * sx, 0)
    A = V3(at)
    m.box('armor', (0.4, 0.6, 0.46), at=(A.x - 0.06 * sx, A.y, A.z + 0.12), bevel=0.04, seg=1)
    m.rivet_rect('metal_dark', (A.x - 0.06 * sx, A.y, A.z - 0.11), 0.4, 0.6, (0, 0, -1), u=(-1, 0, 0), v=(0, 1, 0), step=0.15, r=0.025, inset=0.05)
    d = Vector((0.97 * sx, -0.07, 0.04)).normalized()
    p0 = A + Vector((0.1 * sx, 0.0, -0.08))
    m.cyl('metal_dark', tuple(p0 - d * 0.1), tuple(p0 + d * 0.06), 0.24, seg=12)
    m.cyl('armor', tuple(p0), tuple(p0 + d * 0.86), 0.11, seg=10)
    m.cyl('metal_dark', tuple(p0 + d * 0.12), tuple(p0 + d * 0.6), 0.165, seg=10)
    for k in range(3):
        c = p0 + d * (0.2 + k * 0.15)
        m.cyl('metal_dark', tuple(c - d * 0.015), tuple(c + d * 0.015), 0.2, seg=10)
    m.cyl('armor', tuple(p0 + d * 0.84), tuple(p0 + d * 1.05), 0.11, 0.17, seg=10)
    m.cyl('light_amber', tuple(p0 + d * 1.0), tuple(p0 + d * 1.03), 0.135, seg=10)
    pil = p0 + d * 0.95 + Vector((0, 0.2, 0))
    m.cyl('metal_dark', tuple(p0 + d * 0.45 + Vector((0, 0.17, 0))), tuple(pil), 0.025, seg=5)
    m.revolve('light_amber', [(0.0, 0.0), (0.04, 0.02), (0.0, 0.05)], at=tuple(pil), axis=tuple(d), seg=6)
    m.tube('rubber_tire', [(3.0 * sx, 3.5, -16.3), (3.1 * sx, 3.45, -16.85), (A.x + 0.05 * sx, A.y - 0.24, A.z + 0.2)], 0.07, seg=6, bend=0.25, bsteps=2)
    m.sock(name, at, rot=rot, size=0.4)


def thruster(m, at):
    """rocket-bell booster under the ramp (nitro socket at the bell), sooted by the bake heat spot"""
    A = V3(at)
    m.box('armor', (0.7, 0.62, 0.5), at=(A.x, A.y + 0.05, -16.85), bevel=0.04, seg=1)
    with m.xf((A.x, A.y, -17.05)):
        m.revolve('metal_dark', [(0.0, 0.0), (0.2, 0.0), (0.2, 0.16), (0.12, 0.28), (0.18, 0.42), (0.3, 0.62), (0.36, 0.78), (0.34, 0.8), (0.27, 0.63),
                                 (0.15, 0.45), (0.08, 0.32), (0.0, 0.3)], axis='-z', seg=16)
        for k in range(3):
            t = 0.47 + k * 0.1
            rr = 0.18 + 0.18 * (t - 0.42) / 0.36 + 0.035
            m.revolve('armor', [(rr - 0.02, t - 0.018), (rr + 0.012, t - 0.012), (rr + 0.012, t + 0.012), (rr - 0.02, t + 0.018)], axis='-z', seg=16)
        for k in range(4):
            a = 2 * PI * k / 4 + PI / 4
            m.tube('metal_dark', [(0.2 * math.cos(a), 0.2 * math.sin(a), -0.1), (0.3 * math.cos(a), 0.3 * math.sin(a), -0.35), (0.3 * math.cos(a), 0.3 * math.sin(a), -0.5)],
                   0.022, seg=4)


def rear_bumper(m):
    m.box('armor', (5.0, 0.42, 0.34), at=(0, 1.55, -17.25), bevel=0.04, seg=1)
    m.rivet_line('metal_dark', (-2.35, 1.7, -17.42), (2.35, 1.7, -17.42), (0, 0, -1), step=0.32, r=0.035)
    chevrons(m, (0, 1.5, -17.42), 4.7, 0.24, (0, 0, -1), stripe=0.2, gaps=2)
    for sx in (1, -1):
        m.beam('armor', (1.45 * sx, 1.7, -17.05), (1.55 * sx, 2.25, -16.45), 0.2, 0.3, bevel=0.02, seg=1)
    for (x, tip) in ((-2.2, -18.2), (-0.55, -18.645), (0.55, -18.645), (2.2, -18.2)):                  # centre spikes keep the rear envelope
        P2.spike2(m, (x, 1.55, -17.42), (x * 1.04, 1.5, tip), 0.09, mat='spike')
    chain_loop(m, (0.9, 1.36, -17.44), (-0.9, 1.36, -17.44), sag=0.32, link=0.2, wire=0.026, k=8)


def rear(m):
    """everything at the back of trailer #2 that is body (and the reactor)"""
    tower(m)
    tower_top(m)
    flame_nozzle(m, 1, (2.55, 4.1, -17.05), 'flame_L')
    flame_nozzle(m, -1, (-2.55, 4.1, -17.05), 'flame_R')
    for sx in (1, -1):
        thruster(m, (1.9 * sx, 2.2, -17.25))
    rear_bumper(m)
    m.sock('nitro_L', (1.9, 2.2, -17.25))
    m.sock('nitro_R', (-1.9, 2.2, -17.25))
    m.sock('light_tail_L', (2.15, 4.6, -17.35))
    m.sock('light_tail_R', (-2.15, 4.6, -17.35))


HEAT_SPOTS = [(1.9, 2.2, -17.65, 0.95), (-1.9, 2.2, -17.65, 0.95),            # thruster bells
              (3.62, 4.03, -17.1, 0.6), (-3.62, 4.03, -17.1, 0.6),            # flame muzzles
              (2.8, 9.95, -15.65, 0.7), (-2.8, 9.95, -15.65, 0.7)]           # tower stacks


# ------------------------------------------------------------------------------------------------ trailer #2 flanks + back of trailer #1
def flanks2(m):
    m.use('body')
    for sx in (1, -1):
        chevrons(m, (2.49 * sx, 2.5, -16.1), 1.3, 0.34, (sx, 0, 0), stripe=0.17, gaps=1)
        chevrons(m, (2.49 * sx, 2.5, -10.95), 1.6, 0.34, (sx, 0, 0), stripe=0.17, gaps=1, slant=-1)
        # firing stand at the trailer's front corner: grating platform on a post, sandbags, side shield with a firing notch, ammo
        m.box('armor', (1.05, 0.08, 1.15), at=(1.88 * sx, 4.62, -10.46), bevel=0.02, seg=1)
        for k in range(4):
            m.box('metal_dark', (1.0, 0.02, 0.04), at=(1.88 * sx, 4.67, -10.0 - k * 0.3), bevel=0)
        m.box('armor', (0.16, 1.5, 0.16), at=(1.5 * sx, 3.84, -10.46), bevel=0.02, seg=1)
        m.beam('armor', (1.5 * sx, 3.3, -10.46), (2.2 * sx, 4.55, -10.46), 0.1, 0.1, bevel=0.01, seg=1)
        P2.sandbag_ring(m, [(1.4 * sx, -9.96), (2.3 * sx, -9.96), (2.3 * sx, -10.95)], 4.67, rows=1, L=0.55, D=0.32, H=0.18)
        m.plate('armor', [(-0.45, 0.0), (0.45, 0.0), (0.42, 0.5), (0.1, 0.5), (0.07, 0.38), (-0.07, 0.38), (-0.1, 0.5), (-0.42, 0.5)], 0.03,
                at=(2.43 * sx, 4.66, -10.5), u=(0, 0, -sx), v=(0, 1, 0), bevel=0.006, seg=1)
        P2.ammo_can(m, (1.75 * sx, 4.67, -10.7), yaw=80, mat='paint2', size=(0.22, 0.26, 0.4))
        # tank cradle straps (below the tank: they stay when it blows)
        for zz in (-11.9, -15.4):
            m.box('metal_dark', (0.9, 0.06, 0.16), at=(2.75 * sx, 3.2, zz), bevel=0.01, seg=1)


def trailer1_rear(m):
    """caged floods on trailer #1's rear corner towers (seen from behind-sides beside trailer #2)"""
    m.use('body')
    for sx in (1, -1):
        m.box('metal_dark', (0.12, 0.34, 0.26), at=(3.05 * sx, 5.05, -8.78), bevel=0.01, seg=1)
        caged_lamp(m, (3.05 * sx, 5.28, -8.92), (0.15 * sx, -0.1, -1), r=0.24)
