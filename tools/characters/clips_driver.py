"""Seated-driver clip library: steering idle with road vibration, leans, brace, crash impact, hit, glances, taunt, deaths.

All seated clips use WORLD-frame hands (on the steering wheel, see anim.sit_geometry): the character's root is on the floor
plane directly below the hip point (hip joints 0.56 m above the root).  The runtime IKs the hands onto the real wheel rim
while driving; for the deaths / shout / glance clips it should fade that IK out (notes per clip).
"""
import copy

import numpy as np

import anim as A
import motion as M
from anim import GRIP, IDX, S1, V, rv, unit
from clips_gunner import K, add, mod, look, fingers

SPR_SIT = {"Neck": (3.4, 0.55), "Head": (2.8, 0.5)}
SPR_SIT_ACT = {"Spine1": (6.5, 0.55), "Spine2": (5.0, 0.5), "Neck": (3.8, 0.42), "Head": (3.0, 0.38), "hL": (5.0, 0.45), "hR": (5.0, 0.45)}
SPR_SIT_LIMP = {"Spine1": (4.0, 0.5), "Spine2": (3.2, 0.45), "Neck": (2.6, 0.4), "Head": (2.2, 0.36), "hL": (3.0, 0.4), "hR": (3.0, 0.4)}


def road(T, amp=1.0, seed=5):
    """Seated road vibration + body roll with the car + stabilised head (seamless for loops)."""
    bob = M.harmonic_noise(T, seed, n=8, lo=5, hi=17, falloff=0.6)
    roll = M.harmonic_noise(T, seed + 1, n=3, lo=1, hi=3, falloff=0.6)
    pit = M.harmonic_noise(T, seed + 2, n=3, lo=1, hi=4, falloff=0.6)

    def f(p, t):
        q = dict(p)
        rl = roll(t)
        q["hips_pos"] = np.asarray(p["hips_pos"], float) + V(0.006 * amp * rl, 0.004 * amp * bob(t), 0.0)
        hr = rv(0.8 * amp * pit(t), 0.0, -1.2 * amp * rl)
        q["hips_rot"] = np.asarray(p["hips_rot"], float) + hr
        q["sp1"] = np.asarray(p["sp1"], float) + rv(0.5 * amp * bob(t), 0.0, 0.9 * amp * rl)
        q["sp2"] = np.asarray(p["sp2"], float) + rv(0.4 * amp * bob(t), 0.0, 0.6 * amp * rl)
        acc = hr + rv(0.9 * amp * bob(t), 0.0, 1.5 * amp * rl)
        q["neck"] = np.asarray(p["neck"], float) - 0.4 * acc
        q["head"] = np.asarray(p["head"], float) - 0.5 * acc
        return q
    return f


class Ctx:
    def __init__(self, rig, seat=None):
        self.rig = rig
        self.k = rig.k
        self.g = A.sit_geometry(rig, **(seat or {}))
        base, _ = A.sit_base(rig, self.g)
        # a little more attitude than the stock pose: shoulders forward, chin down, eyes on the road
        base = add(base, sp1=rv(2, 0), sp2=rv(3, 0), neck=rv(2), head=rv(-3))
        self.base = base

    def wheel(self, p, steer=0.0, jL=0.0, jR=0.0):
        return A.sit_set_wheel(p, self.g, steer, (jL, jR))

    def bake(self, tr, T, loop, **kw):
        kw.setdefault("frames", ("world", "world"))
        kw.setdefault("rel", None)
        return M.bake2(self.rig, tr, T, loop, **kw)


def hand_free(c, p, S, pos, f, pal, pole, grip=None):
    """A hand off the wheel at a WORLD point (character space)."""
    q = mod(p, **{"h%s_pos" % S: V(*pos), "h%s_f" % S: unit(f), "h%s_p" % S: unit(pal), "h%s_pole" % S: unit(pole)})
    if grip is not None:
        q = fingers(q, **({"L_": grip} if S == "L" else {"R_": grip}))
    return q


# ------------------------------------------------------------------------------------------------
# driving
# ------------------------------------------------------------------------------------------------

def clip_idle(c):
    T = 4.0
    p = c.base
    tr = A.Track(p)
    K(tr, 0.0, p)
    K(tr, T, p)
    steer = M.harmonic_noise(T, 91, n=4, lo=1, hi=5, falloff=0.8)
    grip = M.harmonic_noise(T, 92, n=3, lo=2, hi=6, falloff=0.5)
    br = M.breathe(T, 0.9, 0.5, seed=5)
    rd = road(T, 1.0, seed=5)

    def post(q, t):
        return c.wheel(q, 2.2 * steer(t), 0.6 * grip(t), -0.5 * grip(t + 0.7))

    def layer(q, t):
        return rd(br(q, t), t)
    return c.bake(tr, T, True, layer=layer, post=post, springs=SPR_SIT,
                  note="loop 4 s; seated at the wheel (hands at 10 and 2, micro steering corrections), road vibration, body rolling with "
                       "the car, head stabilised. Root on the floor under the hip point, hip joints %.2f m above it" % c.g["hj"])


def clip_lean(c, side):
    T = 1.5
    s = 1.0 if side == "L" else -1.0
    p = add(c.base, hips_pos=V(0.03 * s, 0.0, 0.0), hips_rot=rv(0, -3 * s, 4 * s), sp0=rv(0, -2 * s, 6 * s), sp1=rv(1, -3 * s, 8 * s),
            sp2=rv(1, -2 * s, 6 * s), neck=rv(0, 5 * s, -9 * s), head=rv(0, 5 * s, -10 * s), shr_L=V(0, 0, -5 * s if s > 0 else 3),
            shr_R=V(0, 0, 5 * s if s < 0 else -3))
    tr = A.Track(p)
    K(tr, 0.0, p)
    K(tr, T, p)
    steer = M.harmonic_noise(T, 93 + (0 if side == "L" else 1), n=3, lo=1, hi=4, falloff=0.8)
    rd = road(T, 1.2, seed=6 if side == "L" else 7)

    def post(q, t):
        return c.wheel(q, -28.0 * s + 2.0 * steer(t))
    return c.bake(tr, T, True, layer=rd, post=post, springs=SPR_SIT,
                  note="loop that HOLDS the full lean into a %s turn (body toward %s, head counter-tilted level, wheel turned 28 deg); "
                       "crossfade idle_sit_drive <-> this by steering input" % ("left" if s > 0 else "right", "+X" if s > 0 else "-X"))


def clip_brace(c):
    """Bracing for an impact: arms locked straight on the wheel, back pressed into the seat, chin tucked, shoulders up, shaking."""
    k = c.k
    T = 1.2
    p = add(c.base, hips_pos=V(0, 0.0, -0.02), hips_rot=rv(-3, 0), sp0=rv(-2), sp1=rv(-4), sp2=rv(-5), neck=rv(10), head=rv(10),
            shr_L=V(0, 4, 9), shr_R=V(0, -4, -9))
    p = c.wheel(p, 0.0)
    for S in ("L", "R"):
        p["h%s_pole" % S] = unit([0.8 if S == "L" else -0.8, -0.8, -0.2])
    p = fingers(p, L_="fist", R_="fist")
    tr = A.Track(p)
    K(tr, 0.0, p)
    K(tr, T, p)
    shake = M.harmonic_noise(T, 97, n=5, lo=6, hi=14, falloff=0.3)

    def layer(q, t):
        q = dict(q)
        q["sp2"] = np.asarray(q["sp2"], float) + rv(0.8 * shake(t), 0.6 * shake(t + 0.3))
        q["head"] = np.asarray(q["head"], float) + rv(1.2 * shake(t + 0.1), 1.0 * shake(t + 0.5))
        q["hips_pos"] = np.asarray(q["hips_pos"], float) + V(0, 0.003 * shake(t + 0.2), 0)
        return q
    return c.bake(tr, T, True, layer=layer, springs=SPR_SIT,
                  note="loop 1.2 s; braced for impact: arms locked on the wheel, back into the seat, chin tucked, shoulders up, trembling")


def clip_impact(c):
    """Crash jolt: thrown forward against the wheel (arms buckle, head whips forward), rebound into the seat, settle."""
    k = c.k
    T = 1.0
    b = c.base
    tr = A.Track(b)
    K(tr, 0.0, b)
    fwd = add(b, hips_pos=V(0, 0.01, 0.045), hips_rot=rv(6), sp0=rv(8), sp1=rv(12), sp2=rv(12), neck=rv(-6), head=rv(-10), shr_L=V(0, -8, 4), shr_R=V(0, 8, -4))
    for S in ("L", "R"):
        fwd["h%s_pole" % S] = unit([0.9 if S == "L" else -0.9, -0.5, -0.1])
    K(tr, 0.08, fwd)
    reb = add(b, hips_pos=V(0, 0.0, -0.012), hips_rot=rv(-4), sp0=rv(-3), sp1=rv(-6), sp2=rv(-7), neck=rv(6), head=rv(10))
    K(tr, 0.24, reb)
    K(tr, 0.42, add(b, sp1=rv(3), sp2=rv(3), head=rv(-4, 5)))
    K(tr, 0.62, add(b, head=rv(2, -3)))
    K(tr, T, b)
    return c.bake(tr, T, False, springs=SPR_SIT_ACT, settle=0.12,
                  note="1.0 s crash jolt: thrown forward into the wheel (0.08 s, arms buckle, head whips), rebound into the seat (0.24 s), "
                       "shakes it off; starts/ends on idle_sit_drive frame 0 (additive-ready; hands stay on the wheel)")


def clip_sit_hit(c):
    k = c.k
    T = 0.75
    b = c.base
    tr = A.Track(b)
    K(tr, 0.0, b)
    h = add(b, hips_pos=V(-0.01, 0.0, -0.015), hips_rot=rv(-2, 4), sp1=rv(-6, 8, -3), sp2=rv(-8, 8, -4), neck=rv(-4, -6), head=rv(-8, -12, 6),
            shr_R=V(0, 6, -8))
    h = hand_free(c, h, "R", c.base["hR_pos"] + V(-0.12, 0.10, -0.12), [-0.3, 0.5, 0.6], [0.4, -0.3, 0.8], [-0.8, -0.6, -0.2], "splay")
    K(tr, 0.06, h)
    K(tr, 0.20, add(b, sp1=rv(4, 3, -1), sp2=rv(4, 2), neck=rv(6, -2), head=rv(6, -3), hips_pos=V(0, -0.005, 0.01)))
    K(tr, 0.40, add(b, sp1=rv(1, 1), head=rv(2, 1)))
    K(tr, T, b)
    return c.bake(tr, T, False, springs=SPR_SIT_ACT, settle=0.1,
                  note="0.75 s: shot in the seat: torso jerks back and twists, head snaps, right hand flies off the wheel and grabs it "
                       "again by 0.2 s (fade the right-hand wheel IK over 0.02-0.2 s); starts/ends on idle_sit_drive frame 0")


def clip_glance(c, side):
    T = 1.7
    s = 1.0 if side == "L" else -1.0
    b = c.base
    tr = A.Track(b)
    K(tr, 0.0, b)
    K(tr, 0.12, look(add(b, sp2=rv(0, 2 * s)), -2, 12 * s))                       # the eyes lead, a small anticipation
    over = look(add(b, hips_rot=rv(0, 4 * s), sp0=rv(0, 4 * s), sp1=rv(-1, 9 * s, 2 * s), sp2=rv(-1, 11 * s, 2 * s), shr_L=V(0, 3 * s, 0), shr_R=V(0, 3 * s, 0)),
                -4, 72 * s, 3 * s)
    K(tr, 0.42, over)
    K(tr, 0.95, add(over, head=rv(1, 4 * s)))
    K(tr, 1.28, look(add(b, sp2=rv(0, 1 * s)), 0, 4 * s))
    K(tr, T, b)
    return c.bake(tr, T, False, springs=SPR_SIT_ACT, settle=0.12,
                  note="1.7 s: glance over the %s shoulder (head ~70 deg + chest) and back to the road; hands stay on the wheel; starts/ends "
                       "on idle_sit_drive frame 0" % ("left" if s > 0 else "right"))


def clip_shout(c):
    """Raider driver taunt: left fist off the wheel shaking out of the window, head turned to the target, yelling."""
    k = c.k
    T = 2.0
    b = c.base
    tr = A.Track(b)
    K(tr, 0.0, b)
    lean = look(add(b, hips_rot=rv(0, 4, 4), sp0=rv(0, 2, 3), sp1=rv(-3, 8, 6), sp2=rv(-4, 10, 5), shr_L=V(0, -6, 18)), -12, 50, 6)
    def fist(y, x, z=0.0):
        return hand_free(c, lean, "L", (0.42 + x, c.g["hj"] + 0.78 + y, 0.10 + z), [0.1, 1.0, -0.1], [-0.9, 0.1, 0.4], [1.0, -0.3, -0.5], "fist")
    K(tr, 0.20, hand_free(c, add(b, sp2=rv(0, 3)), "L", (0.30, c.g["hj"] + 0.34, 0.22), [0.3, 0.7, 0.5], [-0.8, 0.2, 0.4], [1.0, -0.6, -0.3], "fist"))
    K(tr, 0.42, fist(0.10, 0.02))
    for i, t in enumerate((0.60, 0.80, 1.00, 1.20)):
        K(tr, t, fist(-0.10 if i % 2 == 0 else 0.08, 0.03 * (i % 2), 0.04 if i % 2 == 0 else -0.02))
    K(tr, 1.55, hand_free(c, look(add(b, sp2=rv(0, 3)), -2, 14), "L", (0.26, c.g["hj"] + 0.28, 0.30), [-0.3, 0.3, 0.9], [-0.4, -0.5, 0.7],
                          [1.0, -0.6, -0.3], "relax"))
    K(tr, T, b)
    return c.bake(tr, T, False, springs=SPR_SIT_ACT, settle=0.15,
                  note="2.0 s raider taunt: left hand off the wheel, fist shaken out of the window (+X side) four times, head turned to "
                       "the target, yelling; fade the LEFT-hand wheel IK out over 0.05-0.22 s and back in over 1.55-2.0 s; starts/ends on "
                       "idle_sit_drive frame 0")


# ------------------------------------------------------------------------------------------------
# seated deaths (the runtime should fade the wheel IK out at the start)
# ------------------------------------------------------------------------------------------------

def clip_death_slump(c):
    """Shot: head snaps back, then the body folds forward onto the wheel, arms slide off, head comes to rest on the rim."""
    k = c.k
    g = c.g
    T = 1.9
    b = c.base
    tr = A.Track(b)
    K(tr, 0.0, b)
    snap = add(b, hips_pos=V(0, 0.0, -0.015), sp1=rv(-6, 3), sp2=rv(-8, 3), neck=rv(-8, 4), head=rv(-14, 6, 4))
    K(tr, 0.07, fingers(snap, L_="splay", R_="splay"))
    # the tension goes: shoulders drop, head lolls forward, the hands still hang on the rim
    sag = add(b, hips_pos=V(0, -0.01, 0.01), sp1=rv(6, 2), sp2=rv(8, 2), neck=rv(10, 3), head=rv(12, 8, 6), shr_L=V(0, 0, -6), shr_R=V(0, 0, 6))
    K(tr, 0.34, fingers(c.wheel(sag, 6.0), L_="limp", R_="limp"))
    # the chest pitches onto the wheel: forehead on the rim top, arms slip off and fall to the lap / door
    wc = g["wc"]
    over = add(b, hips_pos=V(0.0, -0.012, 0.04), hips_rot=rv(6, 0, 0), sp0=rv(10, 2), sp1=rv(16, 3, -2), sp2=rv(16, 3, -3), neck=rv(12, -6),
               head=rv(10, -22, -12), shr_L=V(0, -4, -8), shr_R=V(0, 4, 8))
    over = hand_free(c, over, "L", (0.22, g["hj"] + 0.04, 0.28), [0.2, -0.9, 0.3], [-0.6, 0.2, 0.7], [1.0, -0.4, -0.3], "limp")
    over = hand_free(c, over, "R", (-0.14, g["hj"] + 0.08, 0.30), [0.3, -0.8, 0.4], [0.5, 0.3, 0.8], [-1.0, -0.4, -0.3], "limp")
    K(tr, 0.62, over)
    rest = add(over, hips_pos=V(0, -0.004, 0.006), sp2=rv(2, 0), neck=rv(2, -2), head=rv(2, -4))
    rest = hand_free(c, rest, "L", (0.23, g["hj"] + 0.0, 0.24), [0.3, -1.0, 0.1], [-0.8, 0.0, 0.3], [1.0, -0.3, -0.2], "limp")
    rest = hand_free(c, rest, "R", (-0.12, g["hj"] + 0.04, 0.24), [0.2, -0.9, 0.3], [0.6, 0.2, 0.7], [-1.0, -0.4, -0.2], "limp")
    K(tr, 0.85, add(rest, sp2=rv(-2, 0), head=rv(-3, 0)))
    K(tr, 1.1, rest)
    K(tr, T, rest)
    return c.bake(tr, T, False, springs=SPR_SIT_LIMP, settle=0.0,
                  note="1.9 s seated death: head snaps back (0.07), shoulders sag, the body folds forward onto the wheel (0.62), head rests "
                       "on the rim turned to the side, arms slide off to the lap and the door. Fade the wheel IK out over 0.2-0.6 s")


def clip_death_jerk(c, side):
    """Shot: a convulsive yank of the wheel (hands still on it) toward `side`, then slumps sideways, head lolling."""
    k = c.k
    g = c.g
    T = 2.1
    s = 1.0 if side == "L" else -1.0
    b = c.base
    tr = A.Track(b)
    K(tr, 0.0, b)
    jolt = add(b, hips_pos=V(0, 0.01, -0.015), sp1=rv(-6, 3 * s), sp2=rv(-8, 4 * s), neck=rv(-6), head=rv(-12, 4 * s, 4 * s), shr_L=V(0, 0, 6), shr_R=V(0, 0, -6))
    K(tr, 0.06, fingers(c.wheel(jolt, 10.0 * -s), L_="fist", R_="fist"))
    yank = add(b, hips_pos=V(0.02 * s, 0.0, 0.0), hips_rot=rv(0, 4 * s, 3 * s), sp0=rv(2, 5 * s, 4 * s), sp1=rv(3, 10 * s, 7 * s),
               sp2=rv(4, 10 * s, 6 * s), neck=rv(4, 8 * s, -4 * s), head=rv(6, 10 * s, -6 * s))
    K(tr, 0.22, fingers(c.wheel(yank, -95.0 * s), L_="fist", R_="fist"))
    K(tr, 0.34, fingers(c.wheel(add(yank, sp2=rv(2, 2 * s)), -105.0 * s), L_="relax", R_="relax"))
    # hands slip, the body topples toward the door (+X) or the passenger side (-X)
    tip = add(b, hips_pos=V(0.03 * s, -0.01, 0.02), hips_rot=rv(2, 2 * s, 5 * s), sp0=rv(5, 2 * s, 5 * s), sp1=rv(7, 4 * s, 7 * s),
              sp2=rv(7, 4 * s, 6 * s), neck=rv(10, 6 * s, 12 * s), head=rv(12, 10 * s, 16 * s), shr_L=V(0, 0, -6), shr_R=V(0, 0, 6))
    inner = "R" if s > 0 else "L"
    outer = "L" if s > 0 else "R"
    tip = hand_free(c, tip, outer, (0.25 * s, g["hj"] - 0.02, 0.18), [0.2 * s, -1.0, 0.1], [-0.6 * s, 0.1, 0.5], [s, -0.4, -0.2], "limp")
    tip = hand_free(c, tip, inner, (-0.02 * s, g["hj"] + 0.06, 0.28), [0.3 * s, -0.8, 0.4], [0.4 * s, 0.3, 0.8], [-s, -0.4, -0.2], "limp")
    K(tr, 0.70, tip)
    rest = add(tip, hips_pos=V(0.01 * s, -0.004, 0.0), sp1=rv(1, 0, 2 * s), neck=rv(2, 0, 4 * s), head=rv(2, 2 * s, 5 * s))
    K(tr, 0.95, add(rest, head=rv(-3, 0, -3 * s)))
    K(tr, 1.2, rest)
    K(tr, T, rest)
    return c.bake(tr, T, False, springs=SPR_SIT_LIMP, settle=0.0,
                  note="2.1 s seated death: shot (0.06), a convulsive yank of the wheel ~100 deg to the %s with both hands (0.22-0.34), "
                       "hands slip off, the body topples toward %s and the head lolls onto the shoulder. Use it when the car swerves %s; "
                       "fade the wheel IK out over 0.3-0.5 s (let the wheel itself spin with the car's steering)"
                       % ("left" if s > 0 else "right", "the door (+X)" if s > 0 else "the passenger side (-X)", "left" if s > 0 else "right"))


def clip_death_headback(c):
    k = c.k
    g = c.g
    T = 1.6
    b = c.base
    tr = A.Track(b)
    K(tr, 0.0, b)
    snap = add(b, hips_pos=V(0, 0.005, -0.02), hips_rot=rv(-3), sp1=rv(-8, -2), sp2=rv(-10, -2), neck=rv(-12, -4), head=rv(-20, -6, -4))
    K(tr, 0.06, fingers(snap, L_="splay", R_="splay"))
    back = add(b, hips_pos=V(0, -0.01, -0.03), hips_rot=rv(-6), sp0=rv(-4), sp1=rv(-8, -2), sp2=rv(-10, -3), neck=rv(-14, -6), head=rv(-22, -18, -12),
               shr_L=V(0, 0, -8), shr_R=V(0, 0, 8))
    back = hand_free(c, back, "L", (0.25, g["hj"] - 0.06, 0.12), [0.2, -1.0, 0.1], [-0.8, 0.0, 0.3], [1.0, -0.3, -0.2], "limp")
    back = hand_free(c, back, "R", (-0.25, g["hj"] - 0.06, 0.10), [-0.2, -1.0, 0.1], [0.8, 0.0, 0.3], [-1.0, -0.3, -0.2], "limp")
    K(tr, 0.40, back)
    K(tr, 0.62, add(back, head=rv(4, 3), neck=rv(2)))
    K(tr, 0.85, back)
    K(tr, T, back)
    return c.bake(tr, T, False, springs=SPR_SIT_LIMP, settle=0.0,
                  note="1.6 s seated death: head thrown back against the headrest, arms drop off the wheel and dangle beside the seat, "
                       "head lolls to the side. Fade the wheel IK out over 0.06-0.3 s")


def build(rig, seat=None, only=None):
    c = Ctx(rig, seat)
    out = {}
    want = lambda n: only is None or n in only
    if want("idle_sit_drive"):
        out["idle_sit_drive"] = clip_idle(c)
    for side in ("L", "R"):
        if want("sit_lean_" + side):
            out["sit_lean_" + side] = clip_lean(c, side)
        if want("sit_glance_" + side):
            out["sit_glance_" + side] = clip_glance(c, side)
        if want("death_sit_jerk_" + side):
            out["death_sit_jerk_" + side] = clip_death_jerk(c, side)
    if want("sit_brace"):
        out["sit_brace"] = clip_brace(c)
    if want("sit_impact"):
        out["sit_impact"] = clip_impact(c)
    if want("sit_hit"):
        out["sit_hit"] = clip_sit_hit(c)
    if want("sit_shout"):
        out["sit_shout"] = clip_shout(c)
    if want("death_sit_slump"):
        out["death_sit_slump"] = clip_death_slump(c)
    if want("death_sit_headback"):
        out["death_sit_headback"] = clip_death_headback(c)
    return out
