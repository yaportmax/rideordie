"""RIDE OR DIE - ejected casings: shell_9mm, shell_shotgun (12 ga), shell_rifle (7.62x39).
Units mm, G frame. Model faces +Z (mouth), the case axis is the model's Z axis, origin = centre of the case length on the axis.
    blender -b --factory-startup -P tools/blender/weapons/shells.py -- --which 9mm|shotgun|rifle [--flat] [--size 512]"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpg_helpers import *

which = RL.argv().get("which", "all")
install_golden_brass()


def dent_bm(bm, t_from, ang_deg, width_deg, depth, cy=0.0, cz=0.0):
    """squeeze the mouth of a case inward on one side (fired brass is rarely round)"""
    a0 = math.radians(ang_deg)
    for v in bm.verts:
        if v.co.x < t_from:
            continue
        y, z = v.co.y - cy, v.co.z - cz
        r = math.hypot(y, z)
        if r < 1e-6:
            continue
        a = math.atan2(z, y)
        d = abs((a - a0 + math.pi) % (2 * math.pi) - math.pi)
        w = max(0.0, 1.0 - d / math.radians(width_deg))
        k = (v.co.x - t_from) / max(1e-3, 8.0)
        f = 1.0 - depth * (w * w * (3 - 2 * w)) * min(1.0, k)
        v.co.y = cy + y * f
        v.co.z = cz + z * f


def fired_case_profile(kind, wall=0.32, floor_t=None, head_ring=True):
    """Outer profile head -> mouth (flared), then inner wall back down to a conical floor."""
    d = AMMO[kind]
    r, t = d["rim_r"], d["rim_t"]
    L = d["len"]
    outer = [(0.35, 0.0), (0.35, 2.6), (0.0, 2.6)]
    if head_ring:
        outer += [(0.0, r - 1.5), (0.13, r - 1.35), (0.13, r - 0.95), (0.0, r - 0.8)]
    outer += [(0.0, r - 0.35), (0.35, r), (t, r), (t, d["groove_r"]), (t + d["groove_w"], d["groove_r"]), (t + d["groove_w"], d["body_r0"])]
    stations = []
    if d["shoulder"]:
        s0, s1 = d["shoulder"]
        stations = [(s0, d["body_r1"]), (s1, d["neck_r"] + 0.03), (L - 0.3, d["neck_r"])]
        mouth_r = d["neck_r"]
    else:
        stations = [(L - 0.3, d["body_r1"])]
        mouth_r = d["body_r1"]
    outer += stations
    outer += [(L, mouth_r + 0.22)]
    # inner wall: same stations minus the wall thickness, then a conical floor
    ft = floor_t if floor_t is not None else t + d["groove_w"] + 2.2
    inner = [(L - 0.05, mouth_r - 0.12)] + [(x, rr - wall) for x, rr in reversed(stations)]
    inner = [(x, rr) for x, rr in inner if x > ft + 1.0]
    inner_r = inner[-1][1]
    inner += [(ft + 1.0, inner_r - 0.15), (ft, inner_r * 0.55), (ft - 0.4, 0.0)]
    return outer + inner


def dented_primer(r=2.0, depth=0.5):
    return [(0.32, 0.0), (0.10, 0.5), (-0.06, 0.9), (-0.06, r - 0.15), (0.05, r), (1.1, r), (1.1, 0.0)]


def build_metal_case(kind, name, segs, tag):
    d = AMMO[kind]
    L = d["len"]
    G = Gun(name)
    p = G.part("body", pivot=(0, 0, 0))
    off = -L / 2.0
    prof = fired_case_profile(kind)
    bm = lathe_bm(prof, segs, "x", (off, 0, 0))
    dent_bm(bm, off + L - 4.5, 65.0, 55.0, 0.20, 0, 0)
    p.add(bm, "brass", bevel=0.0)
    pr = lathe_bm(dented_primer(2.0 if kind == "9mm" else (2.0 if kind == "762x39" else 2.0)), max(12, segs - 8), "x", (off, 0, 0))
    p.add(pr, "gun_steel", bevel=0.0)
    G.remark("Fired %s case: mouth toward +Z (glTF), origin at the middle of the case length on the axis, case axis = Z. Length %.1f mm, rim dia %.1f mm. Slight mouth dent, dented primer, headstamp ring." % (tag, L, d["rim_r"] * 2))
    G.notes["style"] = dict(wear=1.0, dirt=1.0)
    G.finish(size=512)


def build_shotgun():
    G = Gun("shell_shotgun")
    p = G.part("body", pivot=(0, 0, 0))
    L = 70.0
    off = -L / 2.0
    BR, HR = 9.6, 9.3                 # brass cup radius, hull radius
    RIM_R = 10.2
    c0 = (off, 0, 0)
    # --- brass head (high-brass cup, 19 mm tall) with rim and primer pocket
    head = [(0.7, 0.0), (0.7, 3.9), (0.0, 3.9), (0.0, 7.6), (0.14, 7.75), (0.14, 8.3), (0.0, 8.45), (0.0, RIM_R - 0.5), (0.4, RIM_R), (1.7, RIM_R), (1.7, BR - 0.1),
            (1.9, BR), (18.6, BR), (19.4, BR - 0.15), (19.7, BR - 0.4), (19.7, BR - 1.15), (10.0, BR - 1.2), (5.0, BR - 2.6), (3.0, 4.0), (3.0, 0.0)]
    p.add(lathe_bm(head, 36, "x", c0), "brass", bevel=0.0)
    # --- primer (dented)
    p.add(lathe_bm([(0.35, 0.0), (0.05, 1.0), (-0.1, 1.9), (-0.1, 3.0), (0.1, 3.3), (1.3, 3.3), (1.3, 0.0)], 28, "x", c0), "gun_steel", bevel=0.0)
    # --- plastic hull: cylinder with a flared, slit (star-crimp opened) mouth
    wall = 0.75
    hull_out = [(19.0, HR - 0.2), (19.5, HR), (55.0, HR), (61.0, HR + 0.08), (65.0, HR + 0.5), (68.0, HR + 1.1), (69.6, HR + 1.7), (70.0, HR + 1.9)]
    hull_in = [(70.0, HR + 1.9 - wall * 0.6), (69.3, HR + 1.3 - wall), (65.0, HR + 0.1 - wall), (55.0, HR - wall), (19.6, HR - wall), (19.0, HR - wall - 0.2)]
    hull = hull_out + hull_in + [hull_out[0]]
    hb = lathe_loop(hull, 36, "x", c0)
    slits = [box_bm((11.0, 0.9, 30.0), c=(off + L - 5.4, 0, 0), rot=(a, 0, 0)) for a in (0.0, 60.0, 120.0)]
    p.add(hb, "paint", bevel=0.0, cut=slits)
    # crimp memory: a shallow groove ring and two subtle hull ribs
    p.add(lathe_loop([(off * 0 + 57.0, HR - 0.2), (57.0, HR + 0.12), (58.4, HR + 0.12), (58.4, HR - 0.2), (57.0, HR - 0.2)], 36, "x", c0), "paint", bevel=0.0)
    G.remark("Fired 12 ga shell: red plastic hull (`paint`, tint via the material colour) with a brass head, splayed star-crimp petals at the mouth (+Z), origin at the middle of the 70 mm length, axis = Z.")
    G.notes["style"] = dict(paint_color=(0.30, 0.020, 0.012), wear=0.35, dirt=0.8)
    G.finish(size=512)


if which in ("9mm", "all"):
    build_metal_case("9mm", "shell_9mm", 32, "9x19 mm")
if which in ("shotgun", "all"):
    build_shotgun()
if which in ("rifle", "all"):
    build_metal_case("762x39", "shell_rifle", 32, "7.62x39 mm")
