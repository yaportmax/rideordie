"""Standing-gunner reactions: directional hits (light / heavy with stagger steps) and deaths (falls, crumple, slump over the
rail, thrown off the vehicle back/left/right, blown up, airborne flail loop + landings).

Deaths use WORLD-frame hands (frames = world) authored relative to the pelvis / chest of each key pose (the body turns
over), ballistic arcs for the airborne phases (g = 9.81), mesh-based ground contact and limp overlap springs.
The weapon is released at the start of every death (runtime: detach it / let it drop when the death clip starts).
"""
import copy

import numpy as np
from scipy.spatial.transform import Rotation as R

import anim as A
import motion as M
import clips_gunner as G
from anim import GRIP, IDX, S1, V, rv, rvm, unit
from clips_gunner import K, add, mod, look, fingers, heel_raise, free_L, strip_private, weapon_delta, chest_pt

G9 = 9.81

# ------------------------------------------------------------------------------------------------
# hits
# ------------------------------------------------------------------------------------------------

PUSH = {"front": V(0, 0, -1), "back": V(0, 0, 1), "left": V(-1, 0, 0), "right": V(1, 0, 0)}   # direction the body is shoved


def _shove(c, base, d, s, twist_bias=0.0):
    """The impact frame: pelvis shoved along d, spine bent away, shoulders tense, rifle knocked, left hand loosens."""
    k = c.k
    px, pz = float(d[0]), float(d[2])
    q = add(base, hips_pos=V(px * 0.026, -0.008, pz * 0.026) * k * s,
            hips_rot=rv(3 * pz * s, (-3 * px + twist_bias) * s * 0.6, 2 * px * s),
            sp0=rv(3 * pz * s, (-3 * px + twist_bias) * s * 0.5, 3 * px * s),
            sp1=rv(7 * pz * s, (-6 * px + twist_bias) * s, 5 * px * s),
            sp2=rv(9 * pz * s, (-5 * px + twist_bias) * s, 5 * px * s),
            neck=rv(-2 * pz * s, 0, -2 * px * s), head=rv(-3 * pz * s, 2 * px * s, -3 * px * s),
            shr_L=V(0, 0, 7 * s), shr_R=V(0, 0, -7 * s))
    q = weapon_delta(c.rig, q, drot_world=rv(-9 * s * (1 if pz <= 0 else -0.3), 8 * px * s, 0), dpos_world=V(px * 0.03, 0.02, pz * 0.03) * s)
    q = mod(q, attL=S1(max(0.0, 1.0 - 0.45 * s)))
    q = add(q, hL_pos=V(0.04 * s, 0.02 * s, -0.03 * s) * c.k)
    return fingers(q, L_="splay")


def _curl(c, base, d, s):
    """Protective flinch after the shove: knees give, chest hunches, head ducks, shoulders up."""
    k = c.k
    px, pz = float(d[0]), float(d[2])
    q = add(base, hips_pos=V(px * 0.02, -0.03, pz * 0.018) * k * s, hips_rot=rv(2 * s, 0, px * s),
            sp0=rv(3 * s, 0, 2 * px * s), sp1=rv(4 * s, -3 * px * s, 3 * px * s), sp2=rv(4 * s, -2 * px * s, 2 * px * s),
            neck=rv(5 * s), head=rv(4 * s, 3 * px * s), shr_L=V(0, -3, 5 * s), shr_R=V(0, 3, -5 * s))
    q = weapon_delta(c.rig, q, drot_world=rv(4 * s, 3 * px * s, 0), dpos_world=V(0, -0.02, 0) * s)
    return mod(q, attL=S1(max(0.0, 1.0 - 0.5 * s)))


def free_at_grip(c, p):
    """Left-hand free target = where the attached hand currently is (chest frame), so releasing it (attL -> 0) is continuous."""
    rig = c.rig
    q = M.resolve_grips(rig, p, c.rel)
    out = copy.deepcopy(p)
    for key in ("hL_pos", "hL_f", "hL_p"):
        out[key] = np.asarray(q[key], float).copy()
    return out


def clip_hit(c, dname, heavy=False):
    k = c.k
    rig = c.rig
    base = free_at_grip(c, strip_private(c.ready["rifle"]))
    d = PUSH[dname]
    tr = A.Track(base)
    K(tr, 0.0, base)
    bias = {"front": -2.0, "back": 2.0, "left": 0.0, "right": 0.0}[dname]
    if not heavy:
        T = 0.62
        K(tr, 0.05, _shove(c, base, d, 1.0, bias))
        K(tr, 0.16, _curl(c, base, d, 0.8))
        K(tr, 0.34, add(_curl(c, base, d, 0.25), attL=S1(0.0)))
        K(tr, 0.48, add(base, sp1=rv(-0.8 * d[2], 0, -0.8 * d[0])))
        K(tr, T, base)
        return G.one_shot(c, tr, T, springs=G.SPR_HIT, settle=0.1,
                          note="%.2f s light hit, shoved toward %s (hit from the %s): impact 0.05 s, flinch 0.16 s, recovered by ~0.5 s; "
                               "starts/ends on idle_stand frame 0 (additive-ready)" % (T, {"front": "-Z", "back": "+Z", "left": "-X", "right": "+X"}[dname], dname))
    # heavy: shove, stagger step to catch the balance, buckle + clutch the wound, recover
    T = 1.25
    step_foot = {"front": "L", "back": "R", "left": "R", "right": "L"}[dname]
    f0 = np.asarray(base["f%s_pos" % step_foot], float)
    f1 = f0 + V(d[0] * 0.16, 0, d[2] * 0.15) * k
    sh = _shove(c, base, d, 2.0, bias)
    K(tr, 0.06, sh)
    lift = add(_shove(c, base, d, 1.6, bias), hips_pos=V(d[0] * 0.05, -0.02, d[2] * 0.05) * k)
    lift = mod(lift, **{"f%s_pos" % step_foot: 0.5 * (f0 + f1) + V(0, 0.07, 0)})
    lift["f%s_pitch" % step_foot] = S1(-8)
    K(tr, 0.20, lift)
    buck = add(_curl(c, base, d, 2.0), hips_pos=V(d[0] * 0.06, -0.04, d[2] * 0.06) * k)
    buck = mod(buck, **{"f%s_pos" % step_foot: f1})
    # the free left hand: clutch the wound (front/left) or throw it out for balance (back/right)
    if dname == "front":
        buck = free_L(buck, chest_pt(c, -0.02, -0.12, 0.17), [-0.9, -0.2, 0.1], [0.1, 0.0, -1.0], pole=[0.8, -0.8, 0.0], grip="claw")
    elif dname == "left":
        buck = free_L(buck, chest_pt(c, 0.10, -0.06, 0.12), [-0.4, 0.5, -0.4], [0.9, 0.0, -0.3], pole=[0.6, -1.0, 0.3], grip="claw")
    else:
        buck = free_L(buck, chest_pt(c, 0.50, 0.02, 0.18 if dname == "right" else 0.35), [0.8, -0.3, 0.4], [0.0, -1.0, 0.0],
                      pole=[0.3, -1.0, -0.4], grip="splay")
    buck = look(buck, 10, -6 * d[0])
    K(tr, 0.36, buck)
    hurt = add(buck, hips_pos=V(0, -0.012, 0) * k, sp1=rv(2, 0), sp2=rv(2, 0))
    hurt = weapon_delta(rig, hurt, drot_world=rv(8, 0, 0), dpos_world=V(0, -0.03, 0))
    K(tr, 0.62, hurt)
    back_ = add(_curl(c, base, d, 0.8), hips_pos=V(d[0] * 0.02, 0.0, d[2] * 0.02) * k)
    back_ = mod(back_, **{"f%s_pos" % step_foot: f1})
    K(tr, 0.78, mod(back_, attL=S1(0.3)))
    ret = add(_curl(c, base, d, 0.4), attL=S1(0.5))
    ret = mod(ret, **{"f%s_pos" % step_foot: 0.5 * (f0 + f1) + V(0, 0.05, 0)})
    K(tr, 0.90, ret)
    K(tr, 1.02, add(base, sp1=rv(-1, 0)))
    K(tr, T, base)
    spr = dict(G.SPR_HIT)
    return G.one_shot(c, tr, T, springs=spr, settle=0.12,
                      note="%.2f s heavy hit from the %s: big shove 0.06 s, stagger step with the %s foot (0.20-0.36 s), buckle and %s "
                           "(0.36-0.62 s), steps back and recovers by 1.1 s; starts/ends on idle_stand frame 0"
                           % (T, dname, "left" if step_foot == "L" else "right",
                              "clutch the wound" if dname in ("front", "left") else "throw the free arm out for balance"))


# ------------------------------------------------------------------------------------------------
# death authoring helpers (world-frame limbs relative to the pelvis / chest of the key pose)
# ------------------------------------------------------------------------------------------------

def to_world_start(c, p):
    """Idle pose -> world-frame hands (resolving the weapon grips) with the weapon released (attR = attL = 0)."""
    rig = c.rig
    q = M.resolve_grips(rig, p, c.rel)
    W, P = rig.torso(q)
    Cpos, Crot = P[IDX["Spine2"]], W[IDX["Spine2"]]
    for S in ("L", "R"):
        q["h%s_pos" % S] = Cpos + Crot @ np.asarray(q["h%s_pos" % S], float)
        q["h%s_f" % S] = Crot @ np.asarray(q["h%s_f" % S], float)
        q["h%s_p" % S] = Crot @ np.asarray(q["h%s_p" % S], float)
        q["h%s_pole" % S] = Crot @ np.asarray(q["h%s_pole" % S], float)
    q["attR"], q["attL"] = S1(0.0), S1(0.0)
    return q


def body(c, p, hips=None, hrot=None, sp=None, neck=None, head=None):
    q = copy.deepcopy(p)
    if hips is not None:
        q["hips_pos"] = np.asarray(hips, float)
    if hrot is not None:
        q["hips_rot"] = np.asarray(hrot, float)
    if sp is not None:
        q["sp0"], q["sp1"], q["sp2"] = (np.asarray(x, float) for x in sp)
    if neck is not None:
        q["neck"] = np.asarray(neck, float)
    if head is not None:
        q["head"] = np.asarray(head, float)
    return q


def limbs(c, p, hL=None, hR=None, fL=None, fR=None, gL=None, gR=None, kL=None, kR=None):
    """Place limbs relative to the key pose's own body.
    hX = (pos_chest (x,y,z)*k, finger dir chest, palm dir chest, elbow pole chest)  -> world
    fX = (pos_pelvis (x,y,z)*k, foot pitch rel. pelvis (deg), foot roll rel. (deg))  -> world ankle + foot yaw/pitch/roll
    kX = knee pole in the pelvis frame.  gX = finger preset."""
    rig = c.rig
    k = c.k
    q = copy.deepcopy(p)
    W, P = rig.torso(q)
    Cpos, Crot = P[IDX["Spine2"]], W[IDX["Spine2"]]
    Hp, Hr = P[0], W[0]
    for S, h in (("L", hL), ("R", hR)):
        if h is None:
            continue
        pos, f, pal, pole = h
        q["h%s_pos" % S] = Cpos + Crot @ (V(*pos) * k)
        q["h%s_f" % S] = Crot @ unit(f)
        q["h%s_p" % S] = Crot @ unit(pal)
        q["h%s_pole" % S] = Crot @ unit(pole)
    for S, f in (("L", fL), ("R", fR)):
        if f is None:
            continue
        pos, pit, rol = (list(f) + [0.0, 0.0])[:3]
        q["f%s_pos" % S] = Hp + Hr @ (V(*pos) * k)
        Rf = Hr @ A.rot_axis((1, 0, 0), np.radians(pit)) @ A.rot_axis((0, 0, 1), np.radians(rol))
        yaw, pitch, roll = R.from_matrix(Rf).as_euler("YXZ", degrees=True)
        q["f%s_yaw" % S], q["f%s_pitch" % S], q["f%s_roll" % S] = S1(yaw), S1(pitch), S1(roll)
        q["toe" + S] = S1(0.0)
    for S, kp in (("L", kL), ("R", kR)):
        if kp is not None:
            q["k%s_pole" % S] = Hr @ unit(kp)
    if gL is not None:
        q = fingers(q, L_=gL)
    if gR is not None:
        q = fingers(q, R_=gR)
    return q


def windmill(c, S, phase, reach=0.46, tilt=0.35, fwd=0.25):
    """Chest-frame hand target for an arm windmilling about its own shoulder: arm long (reach * k from the shoulder), the hand
    sweeping a circle in a plane tilted out from the sagittal plane.  Returns (pos, finger dir, palm dir, pole) for limbs()."""
    rig = c.rig
    sg = 1.0 if S == "L" else -1.0
    sh = (rig.heads[IDX[A.FULL[S] + "Arm"]] - rig.heads[IDX["Spine2"]]) / c.k
    a = phase
    d = np.array([sg * (tilt + 0.25 * np.sin(a) ** 2), np.cos(a), np.sin(a) + fwd])
    d = d / np.linalg.norm(d)
    pos = sh + d * reach
    f = d + np.array([0.0, 0.0, 0.15])
    pal = np.array([-sg, 0.0, 0.0]) - d * (-sg * d[0])
    pole = np.array([sg * 0.3, -0.2, -1.0]) - d * np.dot(d, [sg * 0.3, -0.2, -1.0])
    return (tuple(pos), tuple(f), tuple(pal if np.linalg.norm(pal) > 1e-3 else (0, 0, 1.0)), tuple(pole))


def ground_feet(c, p, fL=None, fR=None):
    """Feet as WORLD ground positions (x, z) * k with a foot pitch (deg, - = toes up) and yaw."""
    q = copy.deepcopy(p)
    k = c.k
    for S, f in (("L", fL), ("R", fR)):
        if f is None:
            continue
        x, z, pit = f[0], f[1], f[2]
        yaw = f[3] if len(f) > 3 else 0.0
        h = c.rig.ankle_h if abs(pit) < 30 else (0.075 * k if pit < 0 else 0.125 * k)
        q["f%s_pos" % S] = V(x * k, h, z * k)
        q["f%s_pitch" % S], q["f%s_yaw" % S], q["f%s_roll" % S] = S1(pit), S1(yaw), S1(0.0)
        q["toe" + S] = S1(0.0)
    return q


def ballistic(p0, v0, t):
    return np.asarray(p0, float) + np.asarray(v0, float) * t + V(0, -0.5 * G9 * t * t, 0)


# common limp end poses ------------------------------------------------------------------------------

def yawed(rotvec_deg, yaw_deg):
    """World yaw applied on top of a pelvis rotation (rotvec degrees) -> rotvec degrees."""
    Rm = A.rot_axis((0, 1, 0), np.radians(yaw_deg)) @ rvm(rotvec_deg)
    return np.degrees(R.from_matrix(Rm).as_rotvec())


def lying_back(c, p, hz, twist=0.0, head_turn=22.0, knee="L", x0=0.0):
    """Supine: head toward -Z, one knee fallen outward, arms splayed palm-up.  (Pelvis frame when supine: +Y toward the head,
    +Z = world up, so the floor is at pelvis -Z; chest frame likewise.)"""
    k = c.k
    q = body(c, p, hips=V(x0, 0.11 * k, hz), hrot=yawed(rv(-90, 0, 0), twist), sp=(rv(-2, 0), rv(-3, 2), rv(-2, 2)), neck=rv(-4, head_turn * 0.4),
             head=rv(-6, head_turn * 0.6, 4))
    sg = 1.0 if knee == "L" else -1.0
    bent = ((sg * 0.20, -0.40, -0.03), 75, -25 * sg)          # foot flat on the floor, knee up and fallen outward
    straight = ((-sg * 0.14, -0.84, -0.05), 35, 8 * sg)        # heel on the floor, toes up and out
    q = limbs(c, q, hL=((0.60, -0.14, -0.04), (0.6, -0.5, 0.1), (0.0, 0.0, 1.0), (1.0, 0.0, 0.3)),
              hR=((-0.52, -0.28, -0.04), (-0.4, -0.8, 0.0), (0.0, 0.1, 1.0), (-1.0, 0.2, 0.3)),
              fL=bent if knee == "L" else straight, fR=straight if knee == "L" else bent,
              kL=(1.0, 0.1, 0.6) if knee == "L" else (0.1, 0.0, 1.0), kR=(-0.1, 0.0, 1.0) if knee == "L" else (-1.0, 0.1, 0.6),
              gL="limp", gR="limp")
    return q


def lying_front(c, p, hz, twist=0.0, head_turn=-70.0, x0=0.0):
    """Prone: head toward +Z, face turned to the side, one arm up by the head, one down along the body, one leg drawn up.
    (Pelvis/chest frame when prone: +Y toward the head, +Z = world DOWN, so the floor is at +Z.)"""
    k = c.k
    q = body(c, p, hips=V(x0, 0.12 * k, hz), hrot=yawed(rv(93, 0, 0), twist), sp=(rv(-3, 0), rv(-4, -2), rv(-3, -3)), neck=rv(-8, head_turn * 0.4),
             head=rv(-10, head_turn * 0.6, 8))
    q = limbs(c, q, hL=((0.46, 0.20, 0.09), (0.3, 0.9, 0.0), (0.0, 0.0, 1.0), (0.7, 0.0, -0.7)),
              hR=((-0.40, -0.30, 0.02), (-0.2, -1.0, 0.0), (0.3, 0.0, -1.0), (-0.7, 0.0, -0.7)),
              fL=((0.13, -0.86, 0.03), 80, 0), fR=((-0.34, -0.58, 0.05), 70, 20),
              kL=(0.0, -0.1, 1.0), kR=(-1.0, 0.2, -0.1), gL="limp", gR="limp")
    return q


def _lie_delta(p, d0, d1, s1, s2):
    """Lying pose p with the pelvis tipped by d0 (about its own lateral axis) / rolled by d1 (about its long axis) and the
    spine arched by s1 / s2 (deg)."""
    q = copy.deepcopy(p)
    Rh = rvm(p["hips_rot"]) @ A.rot_axis((1, 0, 0), np.radians(d0)) @ A.rot_axis((0, 1, 0), np.radians(d1))
    q["hips_rot"] = np.degrees(R.from_matrix(Rh).as_rotvec())
    q["sp1"] = np.asarray(p["sp1"], float) + rv(s1)
    q["sp2"] = np.asarray(p["sp2"], float) + rv(s2)
    return q


def settle_lying(c, tr, t_from):
    """Let the final lying pose sink: search pelvis tip / roll and spine arch so the pelvis ends as low as the body and its
    rigid gear allow (every body lies on its own gear differently), then ramp that correction into the keys after t_from."""
    rig = c.rig
    if rig.m_pos is None:
        return
    p_end = tr.vals[-1]

    def height(q):
        W, P = rig.solve(q, ("world", "world"))
        return float(P[0][1] - rig.lowest(W, P))
    best = (height(p_end), (0.0, 0.0, 0.0, 0.0))
    for d0 in np.arange(-20, 21, 5.0):
        for d1 in np.arange(-20, 21, 5.0):
            for s in (-8.0, 0.0, 8.0):
                d = (d0, d1, s, s * 0.7)
                h = height(_lie_delta(p_end, *d)) + 0.00004 * (d0 * d0 + d1 * d1 + s * s)
                if h < best[0] - 1e-4:
                    best = (h, d)
    d = best[1]
    # then drop each foot onto the ground (lying legs were authored relative to the pelvis and rise with it)
    q = _lie_delta(p_end, *d)
    dyf = {"L": 0.0, "R": 0.0}
    for _ in range(3):
        W, P = rig.solve(q, ("world", "world"))
        g = rig.lowest(W, P)
        for S in ("L", "R"):
            F = A.FULL[S]
            y = rig.lowest_of(W, P, (F + "Foot", F + "ToeBase"))
            if y is not None and y - g > 0.02:
                dy = -(y - g - 0.01)
                dyf[S] += dy
                q["f%s_pos" % S] = np.asarray(q["f%s_pos" % S], float) + np.array([0.0, dy, 0.0])
    if max(abs(x) for x in d) < 1e-6 and abs(dyf["L"]) + abs(dyf["R"]) < 1e-4:
        return
    for i, t in enumerate(tr.times):
        if t >= t_from:
            k = A_s(clamp01((t - t_from) / 0.25))
            v = _lie_delta(tr.vals[i], *(x * k for x in d))
            for S in ("L", "R"):
                v["f%s_pos" % S] = np.asarray(v["f%s_pos" % S], float) + np.array([0.0, dyf[S] * k, 0.0])
            tr.vals[i] = v


def clamp01(x):
    return max(0.0, min(1.0, x))


def A_s(x):
    return x * x * (3 - 2 * x)


def death_bake(c, tr, T, ground_from, note, springs=None, settle=0.0):
    spr = springs if springs is not None else dict(G.SPR_LIMP, fL=(3.5, 0.5), fR=(3.5, 0.5))
    c.rig.soft = 0.006
    try:
        settle_lying(c, tr, ground_from + 0.05)
        return c.bake(tr, T, False, frames=("world", "world"), springs=spr, settle=settle, ground=True, ground_from=ground_from, note=note,
                      rel=None)
    finally:
        c.rig.soft = 0.0


# ------------------------------------------------------------------------------------------------
# deaths
# ------------------------------------------------------------------------------------------------

def clip_death_fall(c):
    """Shot in the chest: jolt, knees buckle, sits down hard backwards, back then head hit the floor, legs settle."""
    k = c.k
    b0 = to_world_start(c, strip_private(c.ready["rifle"]))
    hy, hz = float(b0["hips_pos"][1]), float(b0["hips_pos"][2])
    T = 1.8
    tr = A.Track(b0)
    K(tr, 0.0, b0)
    p = body(c, b0, hips=V(0, hy - 0.01, hz - 0.035 * k), hrot=rv(-4, 3), sp=(rv(-4, 2), rv(-10, 3), rv(-11, 2)), neck=rv(4), head=rv(6, 0, 3))
    p = limbs(c, p, hL=((0.34, 0.02, 0.36), (0.3, 0.4, 0.9), (0.0, -0.9, 0.3), (1.0, -0.6, -0.2)),
              hR=((-0.30, -0.02, 0.34), (-0.3, 0.3, 0.9), (0.0, -0.9, 0.3), (-1.0, -0.6, -0.2)), gL="splay", gR="splay")
    K(tr, 0.07, p)
    p = body(c, b0, hips=V(0.01, hy - 0.13 * k, hz - 0.12 * k), hrot=rv(-12, 5), sp=(rv(-5, 3), rv(-8, 3), rv(-8, 2)), neck=rv(-2), head=rv(-6, 4))
    p = limbs(c, p, hL=((0.42, 0.10, 0.20), (0.5, 0.6, 0.5), (0.0, -0.8, 0.4), (1.0, -0.3, -0.4)),
              hR=((-0.40, 0.06, 0.22), (-0.5, 0.5, 0.5), (0.0, -0.8, 0.4), (-1.0, -0.3, -0.4)), gL="limp", gR="limp")
    K(tr, 0.24, p)
    p = body(c, b0, hips=V(0.015, 0.42 * k, hz - 0.30 * k), hrot=rv(-36, 7), sp=(rv(-4, 3), rv(-5, 2), rv(-4, 2)), neck=rv(6), head=rv(8, 6))
    p = limbs(c, p, hL=((0.50, 0.28, 0.06), (0.4, 0.8, 0.1), (0.0, -0.5, 0.8), (1.0, 0.2, -0.4)),
              hR=((-0.50, 0.22, 0.04), (-0.4, 0.8, 0.1), (0.0, -0.5, 0.8), (-1.0, 0.2, -0.4)))
    p = ground_feet(c, p, fL=(0.27, 0.16, -6), fR=(-0.26, -0.08, -4, -20))
    K(tr, 0.42, p)
    p = body(c, b0, hips=V(0.02, 0.15 * k, hz - 0.42 * k), hrot=rv(-64, 8), sp=(rv(2, 2), rv(3, 2), rv(2, 2)), neck=rv(12), head=rv(10, 6))
    p = limbs(c, p, hL=((0.52, 0.18, -0.14), (0.4, 0.2, -0.9), (0.0, -1.0, 0.0), (1.0, 0.3, 0.2)),
              hR=((-0.52, 0.12, -0.16), (-0.4, 0.2, -0.9), (0.0, -1.0, 0.0), (-1.0, 0.3, 0.2)))
    p = ground_feet(c, p, fL=(0.25, 0.26, -18), fR=(-0.24, 0.02, -12, -20))
    K(tr, 0.58, p)
    p = body(c, b0, hips=V(0.02, 0.12 * k, hz - 0.50 * k), hrot=rv(-88, 8), sp=(rv(-2, 1), rv(-4, 1), rv(-2, 1)), neck=rv(14), head=rv(12, 8))
    p = limbs(c, p, hL=((0.56, 0.02, -0.10), (0.5, -0.2, -0.8), (0.0, -1.0, 0.0), (1.0, 0.0, 0.3)),
              hR=((-0.54, -0.06, -0.10), (-0.5, -0.2, -0.8), (0.0, -1.0, 0.0), (-1.0, 0.0, 0.3)))
    p = ground_feet(c, p, fL=(0.22, 0.36, -30), fR=(-0.22, 0.16, -26, -20))
    K(tr, 0.74, p)
    end = lying_back(c, b0, hz - 0.52 * k, twist=6, head_turn=24, knee="L", x0=0.02)
    mid = copy.deepcopy(end)
    mid = body(c, mid, hips=V(0.02, 0.15 * k, hz - 0.51 * k), neck=rv(-2, 6), head=rv(-10, 10, 2))
    mid = ground_feet(c, mid, fL=(0.20, 0.30, -10), fR=(-0.20, 0.30, -40, -10))
    K(tr, 0.86, mid)
    K(tr, 1.05, add(end, hips_pos=V(0, 0.01, 0)))
    K(tr, T, end)
    return death_bake(c, tr, T, 0.74, "1.8 s death: shot in the chest, knees buckle (0.24), sits down hard (0.58), back hits the floor (0.74), "
                                        "head knocks back (0.86), a knee falls outward; ends supine, head toward -Z. Hips keep the body on y = 0")


def clip_death_crumple(c):
    """Instant drop (head shot): knees fold straight down, kneels, topples forward onto the face and rolls a little."""
    k = c.k
    b0 = to_world_start(c, strip_private(c.ready["rifle"]))
    hy, hz = float(b0["hips_pos"][1]), float(b0["hips_pos"][2])
    T = 1.7
    tr = A.Track(b0)
    K(tr, 0.0, b0)
    p = body(c, b0, hips=V(0, hy - 0.02, hz - 0.01), hrot=rv(2, -3), sp=(rv(-2), rv(-4, -2), rv(-5)), neck=rv(-8, -4), head=rv(-16, -8, -6))
    p = limbs(c, p, gL="splay", gR="splay")
    K(tr, 0.05, p)
    # the knees fold, the body drops like a sack
    p = body(c, b0, hips=V(0, 0.52 * k, hz + 0.02 * k), hrot=rv(12, -4), sp=(rv(8), rv(10, -2), rv(8, -2)), neck=rv(10), head=rv(12, -6, -6))
    p = limbs(c, p, hL=((0.22, -0.36, 0.20), (0.0, -1.0, 0.2), (-0.9, 0.0, 0.3), (1.0, 0.0, -0.3)),
              hR=((-0.22, -0.38, 0.18), (0.0, -1.0, 0.2), (0.9, 0.0, 0.3), (-1.0, 0.0, -0.3)), gL="limp", gR="limp")
    p = ground_feet(c, p, fL=(0.25, 0.12, 20), fR=(-0.25, -0.12, 30, -20))
    K(tr, 0.28, p)
    # knees hit the floor
    p = body(c, b0, hips=V(0, 0.36 * k, hz - 0.06 * k), hrot=rv(10, -6), sp=(rv(10, 2), rv(12, -2), rv(10, -2)), neck=rv(14), head=rv(10, -8, -8))
    p = limbs(c, p, hL=((0.26, -0.40, 0.14), (0.0, -1.0, 0.1), (-0.9, 0.0, 0.3), (1.0, 0.0, -0.3)),
              hR=((-0.25, -0.42, 0.10), (0.0, -1.0, 0.1), (0.9, 0.0, 0.3), (-1.0, 0.0, -0.3)))
    p = ground_feet(c, p, fL=(0.22, -0.30, 70), fR=(-0.22, -0.40, 72, -10))
    p["kL_pole"], p["kR_pole"] = unit([0.2, -0.3, 1.0]), unit([-0.2, -0.3, 1.0])
    K(tr, 0.44, p)
    # tipping forward over the knees
    p = body(c, b0, hips=V(0.02, 0.40 * k, hz + 0.04 * k), hrot=rv(40, -8, -6), sp=(rv(12, -2), rv(14, -4), rv(10, -4)), neck=rv(8, -8), head=rv(4, -14, -8))
    p = limbs(c, p, hL=((0.30, -0.10, 0.34), (0.2, -0.3, 0.9), (0.0, -1.0, 0.1), (1.0, -0.2, -0.3)),
              hR=((-0.28, -0.26, 0.22), (-0.1, -0.8, 0.5), (0.3, -0.5, 0.8), (-1.0, -0.3, -0.3)))
    p = ground_feet(c, p, fL=(0.22, -0.34, 72), fR=(-0.22, -0.44, 74, -10))
    p["kL_pole"], p["kR_pole"] = unit([0.2, -0.5, 1.0]), unit([-0.2, -0.5, 1.0])
    K(tr, 0.66, p)
    # face-down impact, bounce, the hips slide back down, legs straighten out, head turned
    end = lying_front(c, b0, hz + 0.40 * k, twist=-12, head_turn=-60, x0=0.03)
    hit = add(end, hips_pos=V(0, 0.10 * k, -0.18 * k), hips_rot=rv(-22, 0, 0))
    hit = ground_feet(c, hit, fL=(0.20, -0.36, 76), fR=(-0.20, -0.40, 80, -10))
    hit["kL_pole"], hit["kR_pole"] = unit([0.2, -0.8, 1.0]), unit([-0.2, -0.8, 1.0])
    K(tr, 0.84, hit)
    K(tr, 1.02, add(end, hips_pos=V(0, 0.04 * k, -0.08 * k), hips_rot=rv(-8, 0, 0)))
    K(tr, T, end)
    return death_bake(c, tr, T, 0.84, "1.7 s death (head shot): legs fold instantly, knees hit the floor (0.44), topples forward onto the face "
                                        "(0.84), legs slide out; ends prone, head toward +Z, face turned to the right")


def clip_death_slump_rail(c, rail_h=None, rail_z=None):
    """Shot, lurches forward into the waist-high rail in front, folds over it and hangs there (arms dangling outside)."""
    k = c.k
    rig = c.rig
    b0 = to_world_start(c, strip_private(c.ready["rifle"]))
    hy, hz = float(b0["hips_pos"][1]), float(b0["hips_pos"][2])
    rail_h = rail_h if rail_h is not None else c.rig.hips_y + 0.03 * k   # rail top at belt height (standing, legs straight)
    rail_z = rail_z if rail_z is not None else 0.30 * k             # in front of the body
    T = 2.2
    tr = A.Track(b0)
    K(tr, 0.0, b0)
    p = body(c, b0, hips=V(0, hy - 0.01, hz + 0.01), hrot=rv(2, -4), sp=(rv(4, -3), rv(8, -4), rv(9, -3)), neck=rv(-6), head=rv(-10, -6))
    p = limbs(c, p, gL="splay", gR="splay")
    K(tr, 0.06, p)
    # staggers forward (knees buckle, the front foot slides), hands come off the gun
    p = body(c, b0, hips=V(0.01, hy - 0.08 * k, hz + 0.12 * k), hrot=rv(14, -6), sp=(rv(8, -2), rv(12, -3), rv(10, -2)), neck=rv(4), head=rv(6, -6))
    p = limbs(c, p, hL=((0.26, -0.18, 0.36), (0.0, -0.6, 0.8), (-0.3, -0.8, 0.3), (1.0, -0.5, 0.0)),
              hR=((-0.26, -0.22, 0.34), (0.0, -0.6, 0.8), (0.3, -0.8, 0.3), (-1.0, -0.5, 0.0)), gL="limp", gR="limp")
    p = ground_feet(c, p, fL=(0.24, 0.20, 0), fR=(-0.25, -0.02, 18, -24))
    K(tr, 0.30, p)
    # belly hits the rail: pelvis stops, the torso keeps going over it
    hips_at = V(0.01, rail_h - 0.075 * k, rail_z - 0.17 * k)
    p = body(c, b0, hips=hips_at, hrot=rv(40, -6), sp=(rv(18, -2), rv(20, -3), rv(16, -2)), neck=rv(10), head=rv(10, -8))
    p = limbs(c, p, hL=((0.30, -0.20, 0.46), (0.0, -0.8, 0.6), (-0.3, -0.5, -0.6), (1.0, -0.3, 0.0)),
              hR=((-0.30, -0.26, 0.44), (0.0, -0.8, 0.6), (0.3, -0.5, -0.6), (-1.0, -0.3, 0.0)))
    p = ground_feet(c, p, fL=(0.22, 0.02, 10), fR=(-0.23, -0.14, 20, -20))
    K(tr, 0.48, p)
    # folds over: the upper body drops to hanging, arms swing down outside the rail, knees sag
    def dangle(p, y, z, spread=0.2, swing=0.0):
        q = copy.deepcopy(p)
        for S, sg in (("L", 1.0), ("R", -1.0)):
            q["h%s_pos" % S] = V(sg * spread * k + 0.01, y * k, (z + swing * (0.5 + 0.5 * sg)) * k)
            q["h%s_f" % S] = unit([0.1 * sg, -1.0, 0.1])
            q["h%s_p" % S] = unit([-sg, 0.0, -0.3])
            q["h%s_pole" % S] = unit([sg * 0.3, 0.2, -1.0])
        return fingers(q, L_="limp", R_="limp")
    fold = body(c, b0, hips=hips_at + V(0, -0.015, 0.02) * k, hrot=rv(46, -6, 3), sp=(rv(10, -2), rv(13, -3), rv(11, -2)), neck=rv(16, -6), head=rv(18, -14, -6))
    fold = dangle(fold, 0.34, 0.66, 0.24)
    fold = ground_feet(c, fold, fL=(0.21, -0.02, 22), fR=(-0.22, -0.18, 34, -20))
    fold["kL_pole"], fold["kR_pole"] = unit([0.3, -0.2, 1.0]), unit([-0.3, -0.2, 1.0])
    K(tr, 0.72, fold)
    # bounce + settle: arms swing (springs), hips slide down a touch, toes drag
    hang = add(fold, hips_pos=V(0, -0.02, 0.015) * k, hips_rot=rv(5, 0, 0), sp1=rv(2, 0), sp2=rv(2, 0), neck=rv(4, 0), head=rv(4, -4))
    hang = dangle(hang, 0.16, 0.50, 0.19)
    hang = ground_feet(c, hang, fL=(0.21, -0.06, 40), fR=(-0.22, -0.22, 52, -20))
    K(tr, 0.92, dangle(add(hang, hips_pos=V(0, 0.012, 0) * k), 0.20, 0.44, 0.20, swing=0.06))
    K(tr, 1.25, dangle(add(hang, hips_pos=V(0, -0.005, 0) * k, hips_rot=rv(2, 0, 0)), 0.15, 0.53, 0.18, swing=-0.03))
    K(tr, T, hang)
    spr = dict(G.SPR_LIMP, fL=(4.0, 0.5), fR=(4.0, 0.5))
    return c.bake(tr, T, False, frames=("world", "world"), springs=spr, settle=0.0, ground=False, rel=None,
                  note="2.2 s death: shot, lurches forward, belly hits a waist-high rail %.2f m in front (top at %.2f m, 0.48 s), folds over "
                       "it and hangs, arms dangling outside the vehicle; toes stay on the bed. Needs a rail/side panel in front: turn the "
                       "body to face the nearest rail (runtime) or use death_crumple" % (rail_z, rail_h))


def clip_death_thrown(c, side="back"):
    """Blasted off the vehicle: airborne flail on a ballistic arc, lands (back / side), bounces, rolls, goes limp."""
    k = c.k
    b0 = to_world_start(c, strip_private(c.ready["rifle"]))
    hy, hz = float(b0["hips_pos"][1]), float(b0["hips_pos"][2])
    T = 2.1
    tr = A.Track(b0)
    K(tr, 0.0, b0)
    sx = {"back": 0.0, "left": 1.0, "right": -1.0}[side]
    back = side == "back"
    # impact: the body is hit and jack-knifes, limbs lag
    p = body(c, b0, hips=V(sx * 0.04, hy - 0.03, hz - (0.05 if back else 0.01)) , hrot=rv(-6 if back else -2, 0, 8 * sx),
             sp=(rv(-6, 0, 3 * sx), rv(-10, 2, 5 * sx), rv(-10, 2, 5 * sx)), neck=rv(8, 0, -4 * sx), head=rv(10, 0, -6 * sx))
    p = limbs(c, p, gL="splay", gR="splay")
    K(tr, 0.05, p)
    t0 = 0.10
    h0 = V(sx * 0.10, hy - 0.06, hz - (0.10 if back else 0.0))
    v0 = V(sx * 3.1, 2.7, -3.0 if back else -0.4)
    tland = (v0[1] + np.sqrt(v0[1] ** 2 + 2 * G9 * (h0[1] - 0.22 * k))) / G9      # hips at ~0.22 m when the back touches
    # airborne flail keys (arms windmill, legs kick), body rotating toward the landing orientation
    n = 6
    rot_end = rv(-95, 10, 0) if back else rv(-20, -30 * sx, 95 * sx)
    for i in range(n + 1):
        u = i / n
        t = t0 + u * tland
        hp = ballistic(h0, v0, u * tland)
        e = u ** 1.2
        hr = rot_end * e + rv(-8, 0, 6 * sx) * (1 - e)
        wob = np.sin(u * np.pi * 2.2)
        p = body(c, b0, hips=hp, hrot=hr, sp=(rv(-4 - 6 * wob, 6 * wob, 4 * sx), rv(-6 - 8 * wob, 8 * wob, 5 * sx), rv(-5 - 6 * wob, 6 * wob, 4 * sx)),
                 neck=rv(10 - 8 * u, -10 * wob), head=rv(8 - 10 * u, -14 * wob, -5 * sx))
        aL = 2 * np.pi * (0.85 * u) + 0.6
        aR = 2 * np.pi * (0.85 * u) + 2.9
        p = limbs(c, p, hL=windmill(c, "L", aL), hR=windmill(c, "R", aR),
                  fL=((0.16, -0.60 + 0.18 * np.sin(u * 7.0), 0.30 + 0.25 * np.sin(u * 7.0 + 0.6)), 25, 0),
                  fR=((-0.16, -0.70 + 0.16 * np.sin(u * 7.0 + 2.4), 0.20 + 0.25 * np.sin(u * 7.0 + 3.0)), 30, 0),
                  kL=(0.2, 0.2, 1.0), kR=(-0.2, 0.2, 1.0), gL="splay" if i % 2 else "claw", gR="claw" if i % 2 else "splay")
        K(tr, t, p)
    tl = t0 + tland
    xland = h0[0] + v0[0] * tland
    zland = h0[2] + v0[2] * tland
    if back:
        # slam: shoulders first, the head whips, legs come down after, momentum slides the body, it half-rolls to its side
        end = lying_back(c, b0, zland - 0.55 * k, twist=-8, head_turn=-30, knee="R", x0=xland + 0.05)
        slam = body(c, end, hips=V(xland, 0.16 * k, zland - 0.20 * k), hrot=rv(-100, 6, 0), sp=(rv(-4, 0), rv(-6, 2), rv(-4, 2)), neck=rv(16), head=rv(16, -6))
        slam = limbs(c, slam, hL=((0.58, 0.10, -0.06), (0.5, 0.3, -0.7), (0.0, -1.0, 0.0), (1.0, 0.2, 0.4)),
                     hR=((-0.56, 0.12, -0.08), (-0.5, 0.3, -0.7), (0.0, -1.0, 0.0), (-1.0, 0.2, 0.4)),
                     fL=((0.18, -0.55, 0.55), -30, 0), fR=((-0.18, -0.45, 0.62), -40, 0), kL=(0.3, 0.2, 1.0), kR=(-0.3, 0.2, 1.0))
        K(tr, tl + 0.02, slam)
        bnc = add(slam, hips_pos=V(0, 0.06 * k, -0.12 * k), hips_rot=rv(8, 0, -6), neck=rv(-18, -8), head=rv(-20, -12))
        bnc = limbs(c, bnc, fL=((0.16, -0.62, 0.40), -45, 0), fR=((-0.18, -0.70, 0.30), -55, 0))
        K(tr, tl + 0.16, bnc)
        roll = add(end, hips_pos=V(0, 0.02 * k, 0.12 * k), hips_rot=rv(0, 0, -22))
        K(tr, tl + 0.42, roll)
        K(tr, T, add(end, hips_rot=rv(0, 0, -10)))
        note = "thrown BACKWARD off the vehicle: airborne %.2f-%.2f s on a ballistic arc (travels %.1f m back), arms windmill, legs kick; slams " \
               "onto the back at %.2f s, bounces, slides, half-rolls, limp. Ends supine, head toward -Z" % (t0, tl, -v0[2] * tland, tl)
    else:
        # lands on the side, rolls onto the front, one arm flops over
        end = lying_front(c, b0, zland + 0.10 * k, twist=-55 * sx, head_turn=60 * sx, x0=xland + sx * 0.55 * k)
        side_ = body(c, end, hips=V(xland, 0.18 * k, zland), hrot=rv(-10, -20 * sx, 92 * sx), sp=(rv(4, 0, 4 * sx), rv(6, 0, 5 * sx), rv(4, 0, 4 * sx)),
                     neck=rv(6, 0, -10 * sx), head=rv(6, 0, -12 * sx))
        side_ = limbs(c, side_, hL=((0.40, 0.25, 0.25), (0.4, 0.8, 0.2), (0.0, -0.3, 0.9), (1.0, 0.0, -0.4)),
                      hR=((-0.40, 0.20, 0.25), (-0.4, 0.8, 0.2), (0.0, -0.3, 0.9), (-1.0, 0.0, -0.4)),
                      fL=((0.16, -0.78, 0.20), 30, 0), fR=((-0.16, -0.70, 0.35), 30, 0), kL=(0.2, 0.0, 1.0), kR=(-0.2, 0.0, 1.0))
        K(tr, tl + 0.02, side_)
        over = body(c, side_, hips=V(xland + sx * 0.28 * k, 0.20 * k, zland + 0.05 * k), hrot=rv(40, -50 * sx, 110 * sx))
        over = limbs(c, over, hL=((0.45, 0.35, 0.10), (0.4, 0.8, 0.2), (0.0, -0.3, 0.9), (1.0, 0.0, -0.4)),
                     hR=((-0.45, 0.10, 0.20), (-0.4, 0.8, 0.2), (0.0, -0.3, 0.9), (-1.0, 0.0, -0.4)))
        K(tr, tl + 0.26, over)
        K(tr, tl + 0.50, add(end, hips_pos=V(-sx * 0.06 * k, 0.04 * k, 0), hips_rot=rv(-8, 0, 0)))
        K(tr, T, end)
        note = "thrown to the character's %s (%s) off the vehicle: airborne %.2f-%.2f s (%.1f m sideways), flailing; lands on the %s side at " \
               "%.2f s, rolls onto the front, limp. Ends prone" % ("LEFT" if sx > 0 else "RIGHT", "+X" if sx > 0 else "-X", t0, tl, abs(v0[0] * tland),
                                                              "left" if sx > 0 else "right", tl)
    return death_bake(c, tr, T, tl, "%.1f s death: " % T + note)


def clip_death_blown_up(c):
    """Explosion under the feet: launched high, spread-eagled and back-flipping, lands face down, bounces, limp."""
    k = c.k
    b0 = to_world_start(c, strip_private(c.ready["rifle"]))
    hy, hz = float(b0["hips_pos"][1]), float(b0["hips_pos"][2])
    T = 2.5
    tr = A.Track(b0)
    K(tr, 0.0, b0)
    p = body(c, b0, hips=V(0, hy - 0.08 * k, hz), hrot=rv(10, 0), sp=(rv(8), rv(10), rv(8)), neck=rv(10), head=rv(12))
    p = limbs(c, p, hL=((0.30, -0.10, 0.30), (0.2, 0.6, 0.7), (0.0, -0.8, 0.5), (1.0, -0.4, -0.3)),
              hR=((-0.30, -0.12, 0.30), (-0.2, 0.6, 0.7), (0.0, -0.8, 0.5), (-1.0, -0.4, -0.3)), gL="splay", gR="splay")
    K(tr, 0.04, p)
    t0 = 0.08
    h0 = V(0.0, hy - 0.04, hz)
    v0 = V(0.35, 5.2, -1.6)
    tland = (v0[1] + np.sqrt(v0[1] ** 2 + 2 * G9 * (h0[1] - 0.24 * k))) / G9
    n = 8
    for i in range(n + 1):
        u = i / n
        t = t0 + u * tland
        hp = ballistic(h0, v0, u * tland)
        pitch = -250.0 * (u ** 0.95)                  # a back-flip and a quarter: lands face down (-270 ~ +90)
        spread = np.sin(min(u * 1.6, 1.0) * np.pi / 2)
        wob = np.sin(u * np.pi * 3.0)
        p = body(c, b0, hips=hp, hrot=rv(pitch - 18 * (1 - u) * 0, 14 * wob, 10 * wob),
                 sp=(rv(-8 * spread, 5 * wob), rv(-10 * spread, 6 * wob, 4 * wob), rv(-8 * spread, 5 * wob)), neck=rv(-14 * spread + 10 * (1 - spread)),
                 head=rv(-16 * spread + 8 * (1 - spread), 10 * wob))
        p = limbs(c, p, hL=((0.62 * spread + 0.3 * (1 - spread), 0.30 + 0.10 * wob, 0.05), (0.9, 0.3, 0.0), (0.0, 0.2, 1.0), (0.3, 0.0, -1.0)),
                  hR=((-0.60 * spread - 0.3 * (1 - spread), 0.26 - 0.10 * wob, 0.08), (-0.9, 0.3, 0.0), (0.0, 0.2, 1.0), (-0.3, 0.0, -1.0)),
                  fL=((0.30 * spread + 0.12, -0.72, 0.18 * wob), 35, 0), fR=((-0.34 * spread - 0.12, -0.70, -0.16 * wob), 35, 0),
                  kL=(0.3, 0.0, 1.0), kR=(-0.3, 0.0, 1.0), gL="splay", gR="splay")
        K(tr, t, p)
    tl = t0 + tland
    xland, zland = h0[0] + v0[0] * tland, h0[2] + v0[2] * tland
    end = lying_front(c, b0, zland + 0.25 * k, twist=20, head_turn=70, x0=xland + 0.08)
    hit = body(c, end, hips=V(xland, 0.20 * k, zland + 0.05 * k), hrot=rv(70, 12, -8))
    hit = limbs(c, hit, hL=((0.55, 0.25, 0.10), (0.8, 0.3, 0.2), (0.0, 0.0, -1.0), (0.4, 0.0, -1.0)),
                hR=((-0.55, 0.20, 0.10), (-0.8, 0.3, 0.2), (0.0, 0.0, -1.0), (-0.4, 0.0, -1.0)),
                fL=((0.26, -0.70, -0.30), 60, 0), fR=((-0.26, -0.66, -0.40), 55, 0), kL=(0.3, 0.3, -1.0), kR=(-0.3, 0.3, -1.0))
    K(tr, tl + 0.02, hit)
    K(tr, tl + 0.18, add(end, hips_pos=V(0.0, 0.07 * k, -0.08 * k), hips_rot=rv(-10, 4, 0)))
    K(tr, tl + 0.40, add(end, hips_pos=V(0, 0.01 * k, -0.02 * k)))
    K(tr, T, end)
    return death_bake(c, tr, T, tl, "%.1f s death: blast under the feet launches the body %.1f m up (0.08 s), spread-eagled back-flip, lands face down "
                                     "at %.2f s, bounces, limp. Ends prone" % (T, v0[1] ** 2 / (2 * G9), tl))


def clip_fall_flail(c):
    """Airborne flail LOOP for runtime-driven ballistic flight (hips fixed; the runtime moves/rotates the root)."""
    k = c.k
    b0 = to_world_start(c, strip_private(c.ready["rifle"]))
    hy, hz = float(b0["hips_pos"][1]), float(b0["hips_pos"][2])
    T = 0.9
    tr = A.Track(b0)
    n = 6
    for i in range(n + 1):
        u = i / n
        a = 2 * np.pi * u
        p = body(c, b0, hips=V(0, hy, hz), hrot=rv(-8 + 4 * np.sin(a), 6 * np.sin(a + 1), 4 * np.cos(a)),
                 sp=(rv(-4 + 3 * np.sin(a), 5 * np.sin(a)), rv(-6 + 4 * np.sin(a), 7 * np.sin(a)), rv(-5 + 3 * np.sin(a + 0.5), 6 * np.sin(a))),
                 neck=rv(4 + 6 * np.sin(a + 0.8), -8 * np.sin(a)), head=rv(4 + 6 * np.sin(a + 1.2), -10 * np.sin(a + 0.4)))
        p = limbs(c, p, hL=windmill(c, "L", a + 0.6), hR=windmill(c, "R", a + 2.9),
                  fL=((0.15, -0.66 + 0.16 * np.sin(2 * a), 0.18 + 0.26 * np.sin(2 * a + 0.6)), 25, 0),
                  fR=((-0.15, -0.66 + 0.16 * np.sin(2 * a + 3.1), 0.18 + 0.26 * np.sin(2 * a + 3.7)), 30, 0),
                  kL=(0.2, 0.2, 1.0), kR=(-0.2, 0.2, 1.0), gL="splay", gR="claw")
        K(tr, u * T, p)
    spr = dict(G.SPR_LIMP)
    spr["hL"] = (4.0, 0.5)
    spr["hR"] = (4.0, 0.5)
    return c.bake(tr, T, True, frames=("world", "world"), springs=spr, rel=None,
                  note="loop 0.9 s: airborne flailing (arms windmill, legs bicycle), Hips fixed at the standing height, root upright -> "
                       "the runtime drives the ballistic flight and tumble of the root; switch to land_back / land_front on ground contact")


def clip_land(c, face="back"):
    """Ground impact after a runtime-driven flight: starts lying (limbs still up from the flail), slams, bounces, goes limp."""
    k = c.k
    b0 = to_world_start(c, strip_private(c.ready["rifle"]))
    T = 1.3
    hz = 0.0
    if face == "back":
        end = lying_back(c, b0, hz, twist=5, head_turn=26, knee="L")
        start = body(c, end, hips=V(0, 0.26 * k, hz), hrot=rv(-82, 0, 0), sp=(rv(-4, 0), rv(-6, 0), rv(-4, 0)), neck=rv(12), head=rv(14))
        start = limbs(c, start, hL=((0.44, 0.34, 0.20), (0.5, 0.6, 0.4), (0.0, -0.4, 0.9), (1.0, -0.2, -0.6)),
                      hR=((-0.44, 0.30, 0.22), (-0.5, 0.6, 0.4), (0.0, -0.4, 0.9), (-1.0, -0.2, -0.6)),
                      fL=((0.16, -0.55, 0.40), 20, 0), fR=((-0.16, -0.62, 0.30), 25, 0), kL=(0.2, 0.2, 1.0), kR=(-0.2, 0.2, 1.0), gL="splay", gR="splay")
        slam = body(c, end, hips=V(0, 0.15 * k, hz), hrot=rv(-96, 4, 0), neck=rv(16), head=rv(16))
        slam = limbs(c, slam, hL=((0.56, 0.08, -0.04), (0.5, 0.3, -0.7), (0.0, -1.0, 0.0), (1.0, 0.2, 0.4)),
                     hR=((-0.54, 0.10, -0.06), (-0.5, 0.3, -0.7), (0.0, -1.0, 0.0), (-1.0, 0.2, 0.4)),
                     fL=((0.18, -0.60, 0.28), 30, 0), fR=((-0.18, -0.55, 0.34), 30, 0), kL=(0.3, 0.2, 1.0), kR=(-0.3, 0.2, 1.0))
    else:
        end = lying_front(c, b0, hz, twist=-10, head_turn=-65)
        start = body(c, end, hips=V(0, 0.28 * k, hz), hrot=rv(78, 0, 0), sp=(rv(-4, 0), rv(-6, 0), rv(-4, 0)), neck=rv(-8), head=rv(-10))
        start = limbs(c, start, hL=((0.44, 0.34, 0.20), (0.5, 0.6, 0.4), (0.0, -0.4, 0.9), (1.0, -0.2, -0.6)),
                      hR=((-0.44, 0.30, 0.22), (-0.5, 0.6, 0.4), (0.0, -0.4, 0.9), (-1.0, -0.2, -0.6)),
                      fL=((0.16, -0.62, -0.30), 40, 0), fR=((-0.16, -0.66, -0.20), 40, 0), kL=(0.2, 0.2, -1.0), kR=(-0.2, 0.2, -1.0), gL="splay", gR="splay")
        slam = body(c, end, hips=V(0, 0.16 * k, hz), hrot=rv(96, -4, 0), neck=rv(-12, -20), head=rv(-10, -30))
        slam = limbs(c, slam, hL=((0.52, 0.30, 0.10), (0.6, 0.6, 0.0), (0.0, 0.0, -1.0), (0.4, 0.0, -1.0)),
                     hR=((-0.50, 0.26, 0.12), (-0.6, 0.6, 0.0), (0.0, 0.0, -1.0), (-0.4, 0.0, -1.0)),
                     fL=((0.18, -0.80, -0.20), 70, 0), fR=((-0.20, -0.62, -0.36), 40, 0), kL=(0.0, 0.0, -1.0), kR=(-0.4, 0.3, -1.0))
    tr = A.Track(start)
    K(tr, 0.0, start)
    K(tr, 0.07, slam)
    K(tr, 0.20, add(end, hips_pos=V(0, 0.06 * k, 0), hips_rot=rv(8 if face == "back" else -8, 0, 5)))
    K(tr, 0.42, add(end, hips_pos=V(0, 0.01 * k, 0)))
    K(tr, T, end)
    return death_bake(c, tr, T, 0.07, "1.3 s: ground impact after a runtime-driven flight (%s): frame 0 = body lying %s just above the ground "
                                       "with limbs still up, slams at 0.07 s, bounces, limp; root must be upright (yaw only) when it starts"
                      % ("lands on the back" if face == "back" else "lands face down", "on its back" if face == "back" else "face down"))


def build(c, only=None):
    out = {}
    want = lambda n: only is None or n in only
    for dname in ("front", "back", "left", "right"):
        if want("hit_" + dname):
            out["hit_" + dname] = clip_hit(c, dname, False)
        if want("hit_%s_heavy" % dname):
            out["hit_%s_heavy" % dname] = clip_hit(c, dname, True)
    # first-generation names kept as aliases of the new light hits
    if want("flinch_a"):
        out["flinch_a"] = out.get("hit_front") or clip_hit(c, "front", False)
    if want("flinch_b"):
        out["flinch_b"] = out.get("hit_right") or clip_hit(c, "right", False)
    if want("death_fall"):
        out["death_fall"] = clip_death_fall(c)
    if want("death_crumple"):
        out["death_crumple"] = clip_death_crumple(c)
    if want("death_slump_rail"):
        out["death_slump_rail"] = clip_death_slump_rail(c)
    for side in ("back", "left", "right"):
        if want("death_thrown_" + side):
            out["death_thrown_" + side] = clip_death_thrown(c, side)
    if want("death_blown_up"):
        out["death_blown_up"] = clip_death_blown_up(c)
    if want("fall_flail"):
        out["fall_flail"] = clip_fall_flail(c)
    for face in ("back", "front"):
        if want("land_" + face):
            out["land_" + face] = clip_land(c, face)
    return out
