"""Standing-gunner clip library (riding in a vehicle bed): idles, aims, fire, reloads, throws, taunts, hits, deaths.

All clips are authored with motion.py: a weapon prop in the chest frame with the hands on its grips (runtime contract:
weapon parented to socket_hand_R at identity), world-space overlap springs and a procedural ride layer.
Game space: +X = character's left, +Y up, +Z forward; feet on y = 0.
"""
import copy

import numpy as np
from scipy.optimize import minimize
from scipy.spatial.transform import Rotation as R

import anim as A
import motion as M
from anim import GRIP, IDX, S1, V, rv, rvm, unit

# default overlap springs (Hz, damping ratio): light torso whip, weapon inertia
SPR_IDLE = {"Neck": (3.2, 0.55), "Head": (2.6, 0.5), "weapon": (5.0, 0.55), "weapon_rot": (4.5, 0.6)}
SPR_ACT = {"Spine2": (5.5, 0.55), "Neck": (4.0, 0.45), "Head": (3.2, 0.42), "weapon": (6.5, 0.5), "weapon_rot": (6.0, 0.55)}
SPR_HIT = {"Spine1": (6.0, 0.5), "Spine2": (4.5, 0.42), "Neck": (3.5, 0.38), "Head": (2.8, 0.35), "weapon": (5.0, 0.4),
           "weapon_rot": (4.5, 0.45), "hL": (4.0, 0.4), "hR": (4.0, 0.4)}
SPR_LIMP = {"Spine1": (4.0, 0.5), "Spine2": (3.2, 0.45), "Neck": (2.6, 0.4), "Head": (2.2, 0.35), "hL": (2.8, 0.38), "hR": (2.8, 0.38)}


# ------------------------------------------------------------------------------------------------
# stances
# ------------------------------------------------------------------------------------------------

def stance_feet(rig, p, bulk=1.0):
    """Wide braced stance for a moving vehicle bed: left foot forward, toes out, knees soft."""
    k = rig.k
    p["fL_pos"] = V(0.26 * k * bulk, rig.ankle_h, 0.13 * k)
    p["fR_pos"] = V(-0.26 * k * bulk, rig.ankle_h, -0.11 * k)
    p["fL_yaw"], p["fR_yaw"] = S1(10), S1(-24)
    p["kL_pole"], p["kR_pole"] = unit([0.32, 0.0, 1.0]), unit([-0.36, 0.0, 1.0])
    return p


def torso_ready(rig, p):
    """Slightly hunched fighting posture: hips back, chest over the feet, head level and forward (menacing)."""
    k = rig.k
    p["hips_rot"] = rv(pitch=6, twist=-4)
    p["sp0"], p["sp1"], p["sp2"] = rv(3, -2), rv(4, -3), rv(3, -2)
    p["neck"], p["head"] = rv(-2, 3), rv(-9, 5, lean=-1)
    p["hips_pos"] = V(0.004 * k, rig.hips_y - 0.085 * k, rig.heads[0][2] - 0.035 * k)
    return p


def base_pose(rig, bulk=1.0, wclass="rifle"):
    p = rig.neutral()
    p = stance_feet(rig, p, bulk)
    p = torso_ready(rig, p)
    p["fgR"] = np.array(GRIP["rifle_R"])
    p["fgL"] = np.array(GRIP["rifle_L"] if wclass != "pistol" else GRIP["pistol_L"])
    # neutral free-hand targets (used when a hand lets go of the weapon): relaxed at the sides, chest frame
    p["hR_pos"] = V(-0.22, -0.30, 0.10) * rig.k
    p["hR_f"], p["hR_p"] = unit([0.0, -1.0, 0.25]), unit([1.0, 0.0, 0.1])
    p["hL_pos"] = V(0.22, -0.30, 0.10) * rig.k
    p["hL_f"], p["hL_p"] = unit([0.0, -1.0, 0.25]), unit([-1.0, 0.0, 0.1])
    p["hR_pole"] = unit([-0.55, -1.0, -0.45])
    p["hL_pole"] = unit([0.55, -1.0, -0.40])
    p = M.with_weapon(p, wclass)
    if bulk != 1.0:
        for key in ("hR_pole", "hL_pole"):
            p[key][0] *= bulk
    return p


def low_ready(rig, p, wclass="rifle", bulk=1.0):
    """Rifle carried at a compressed low-ready: stock tucked against the right pec, muzzle forward-down and a bit across
    the body, both hands on it.  Pistol: two hands, low in front of the belly.  Launcher: tube on the right shoulder,
    muzzle raised."""
    k = rig.k
    W, P = rig.torso(p)
    sh = P[IDX["Spine2"]] + W[IDX["Spine2"]] @ (rig.heads[IDX["RightArm"]] - rig.heads[IDX["Spine2"]])
    if wclass in ("rifle", "shotgun"):
        # blade the chest to the right and protract the left shoulder so the support hand reaches the handguard
        p = add(p, sp1=rv(0, -4), sp2=rv(0, -5), shr_L=V(0, -9, 2))
        W, P = rig.torso(p)
        sh = P[IDX["Spine2"]] + W[IDX["Spine2"]] @ (rig.heads[IDX["RightArm"]] - rig.heads[IDX["Spine2"]])
        fwd = unit([0.42, -0.78, 1.0])
        Rw = M.rot_from(fwd, up=unit([-0.2, 1.0, 0.0]))
        stock = M.WEAPONS[wclass]["stock"]
        pocket = sh + V(0.07 * k * bulk, -0.13 * k, 0.09 * k)            # front of the right pec, under the collarbone
        O = pocket - Rw @ stock
        # low-ready: the support hand holds the rear of the handguard (runtime IK can slide it onto grip_L)
        p = add(p, gL_pos=V(0.0, 0.0, -0.075 if wclass == "rifle" else -0.03))
    elif wclass == "pistol":
        fwd = unit([0.10, -0.55, 1.0])
        Rw = M.rot_from(fwd, up=unit([0.2, 1.0, 0.0]))
        O = P[IDX["Spine1"]] + V(-0.03 * k, -0.02 * k, 0.30 * k)
    else:  # launcher at the shoulder, pointed up-forward
        fwd = unit([0.05, 0.30, 1.0])
        Rw = M.rot_from(fwd)
        stock = M.WEAPONS["launcher"]["stock"]
        pocket = sh + V(0.03 * k, 0.07 * k, 0.03 * k)
        O = pocket - Rw @ (stock + V(0.0, 0.07, 0.0))
    q = M.set_weapon_world(rig, p, O, Rw)
    return q


def aim_stance(rig, p, wclass="rifle", bulk=1.0):
    """Shouldered aim along world +Z with the sight on the right eye; the torso (bladed), head (cheek weld) and right
    clavicle are optimised so the stock sits in the shoulder pocket.  Pistol: two-handed at eye level, arms extended."""
    k = rig.k
    w = M.WEAPONS[wclass]
    q = copy.deepcopy(p)
    # bladed: pelvis and chest turned to the right, left foot forward, weight forward
    q["hips_rot"] = rv(pitch=7, twist=-14)
    q["sp0"], q["sp1"], q["sp2"] = rv(3, -5), rv(5, -6, lean=-1), rv(4, -5, lean=-1)
    q["hips_pos"] = q["hips_pos"] + V(-0.005, -0.005, 0.02) * k
    q["fL_pos"] = V(0.20 * k * bulk, rig.ankle_h, 0.17 * k)
    q["fR_pos"] = V(-0.24 * k * bulk, rig.ankle_h, -0.15 * k)
    q["fL_yaw"], q["fR_yaw"] = S1(-4), S1(-38)
    Rw = np.eye(3)
    if wclass == "pistol":
        q["sp0"], q["sp1"], q["sp2"] = rv(2, -2), rv(3, -3), rv(2, -2)
        q["hips_rot"] = rv(pitch=6, twist=-6)
        q["neck"], q["head"] = rv(-2, 5), rv(-6, 3)
        W, P = rig.torso(q)
        E = M.eye_world(rig, W, P, "R")
        O = E + V(0.035, 0.0, 0.46 * k) - w["sight"]
        return M.set_weapon_world(rig, q, O, Rw)
    stock = w["stock"] if wclass != "launcher" else w["stock"] + V(0.0, 0.07, 0.0)

    def place(x):
        qq = copy.deepcopy(q)
        qq["neck"] = rv(x[0], 6 + x[1], lean=-x[2])
        qq["head"] = rv(x[3], 8 + x[4], lean=-x[5])
        qq["sp2"] = q["sp2"] + rv(0, x[6], 0)
        W, P = rig.torso(qq)
        E = M.eye_world(rig, W, P, "R")
        O = E - w["sight"]
        C = P[IDX["Spine2"]]
        Cr = W[IDX["Spine2"]]
        sh = C + Cr @ (rig.heads[IDX["RightArm"]] - rig.heads[IDX["Spine2"]])
        if wclass == "launcher":
            pocket = sh + Cr @ V(0.04 * k, 0.085 * k, 0.0)                 # on top of the shoulder
        else:
            pocket = sh + Cr @ V(0.065 * k * bulk, -0.035 * k, 0.075 * k)  # the shoulder pocket (skin surface)
        S = O + stock
        return qq, O, S, pocket

    def cost(x):
        _, O, S, pocket = place(x)
        reg = 0.00002 * (x[0] ** 2 + x[1] ** 2 + x[2] ** 2 + x[3] ** 2 + x[4] ** 2 + x[5] ** 2 + 2 * x[6] ** 2)
        d = S - pocket
        return float(d @ d + reg)
    x0 = np.array([6.0, 0.0, 4.0, 8.0, 0.0, 5.0, 0.0])
    bounds = [(-10, 25), (-15, 15), (-5, 18), (-10, 25), (-15, 15), (-5, 20), (-12, 12)]
    res = minimize(cost, x0, method="L-BFGS-B", bounds=bounds)
    qq, O, S, pocket = place(res.x)
    q = M.set_weapon_world(rig, qq, O, Rw)
    q["_aim_err"] = np.array([float(np.linalg.norm(S - pocket))])
    return q


def strip_private(p):
    return {k: v for k, v in p.items() if not k.startswith("_")}


# ------------------------------------------------------------------------------------------------
# clip helpers
# ------------------------------------------------------------------------------------------------

def key(tr, t, base, add=None, set_=None):
    return A._key(tr, t, base, add, set_)


def weapon_delta(rig, p, dpos_world=None, drot_world=None, dpos_w=None, drot_w=None):
    """Offset the weapon of pose p: world-space translation / rotation about the grip, or weapon-local ones (_w)."""
    O, Rw = M.weapon_world(rig, p)
    if drot_world is not None:
        Rw = rvm(drot_world) @ Rw
    if drot_w is not None:
        Rw = Rw @ rvm(drot_w)
    if dpos_world is not None:
        O = O + np.asarray(dpos_world, float)
    if dpos_w is not None:
        O = O + Rw @ np.asarray(dpos_w, float)
    return M.set_weapon_world(rig, p, O, Rw)


def pivot_weapon(rig, p, pivot_w, drot_w=None, drot_world=None, dpos_world=None):
    """Rotate the weapon of pose p about a point given in the weapon frame (e.g. the stock pad -> recoil climbs about the
    shoulder), then translate."""
    O, Rw = M.weapon_world(rig, p)
    piv = O + Rw @ np.asarray(pivot_w, float)
    Rn = Rw.copy()
    if drot_w is not None:
        Rn = Rn @ rvm(drot_w)
    if drot_world is not None:
        Rn = rvm(drot_world) @ Rn
    On = piv - Rn @ np.asarray(pivot_w, float)
    if dpos_world is not None:
        On = On + np.asarray(dpos_world, float)
    return M.set_weapon_world(rig, p, On, Rn)


class Ctx:
    def __init__(self, rig, bulk=1.0):
        self.rig = rig
        self.k = rig.k
        self.bulk = bulk
        self.rel = M.HandRel(rig)
        self.base = {}
        self.ready = {}
        self.aim = {}
        for wc in ("rifle", "pistol", "shotgun", "launcher"):
            b = base_pose(rig, bulk, wc)
            self.base[wc] = b
            self.ready[wc] = low_ready(rig, b, wc, bulk)
            self.aim[wc] = aim_stance(rig, self.ready[wc], wc, bulk)

    def bake(self, tr, T, loop, **kw):
        kw.setdefault("rel", self.rel)
        return M.bake2(self.rig, tr, T, loop, **kw)


# ------------------------------------------------------------------------------------------------
# authoring helpers
# ------------------------------------------------------------------------------------------------

def K(tr, t, p):
    """Append an absolute key (a full pose dict)."""
    tr.times.append(float(t))
    tr.vals.append(strip_private(copy.deepcopy(p)))
    return p


def mod(p, **kw):
    """Copy of p with parameters SET."""
    q = copy.deepcopy(p)
    for k, v in kw.items():
        q[k] = np.asarray(v, float).reshape(np.asarray(q[k]).shape)
    return q


def add(p, **kw):
    """Copy of p with deltas ADDED."""
    q = copy.deepcopy(p)
    for k, v in kw.items():
        q[k] = np.asarray(q[k], float) + np.asarray(v, float).reshape(np.asarray(q[k]).shape)
    return q


def heel_raise(rig, p, S, deg):
    """Raise the heel of foot S by pitching the foot about the ball (ToeBase joint) and flexing the toes flat."""
    F = A.FULL[S]
    q = copy.deepcopy(p)
    yaw, pitch, roll = float(p["f%s_yaw" % S][0]), float(p["f%s_pitch" % S][0]), float(p["f%s_roll" % S][0])
    Rf = lambda pt: (A.rot_axis((0, 1, 0), np.radians(yaw)) @ A.rot_axis((1, 0, 0), np.radians(pt)) @ A.rot_axis((0, 0, 1), np.radians(roll)))
    off = rig.off[IDX[F + "ToeBase"]]
    ball = np.asarray(p["f%s_pos" % S], float) + Rf(pitch) @ off
    q["f%s_pitch" % S] = S1(pitch + deg)
    q["toe" + S] = S1(float(p["toe" + S][0]) - deg)
    q["f%s_pos" % S] = ball - Rf(pitch + deg) @ off
    return q


def fingers(p, R_=None, L_=None):
    q = copy.deepcopy(p)
    if R_ is not None:
        q["fgR"] = np.asarray(GRIP[R_] if isinstance(R_, str) else R_, float)
    if L_ is not None:
        q["fgL"] = np.asarray(GRIP[L_] if isinstance(L_, str) else L_, float)
    return q


GRIP.setdefault("splay", [-0.15, -0.2, -0.2, -0.2, -0.25])
GRIP.setdefault("limp", [0.3, 0.35, 0.45, 0.55, 0.6])
GRIP.setdefault("point", [0.7, 0.0, 0.95, 1.0, 1.0])
GRIP.setdefault("claw", [0.35, 0.55, 0.6, 0.65, 0.7])
GRIP.setdefault("mag", [0.55, 0.55, 0.6, 0.65, 0.7])
GRIP.setdefault("pinch", [0.45, 0.5, 0.55, 0.7, 0.8])


def chest_pt(c, x, y, z):
    return V(x, y, z) * c.k


def one_shot(c, tr, T, springs=None, settle=0.12, layer=None, note="", **kw):
    return c.bake(tr, T, False, springs=springs, settle=settle, layer=layer, note=note, **kw)


def ride_window(T, amp=0.6, seed=77, fade=0.2):
    return M.ride(T, amp=amp, sway=amp, seed=seed, window=M.window_fn(T, fade, fade))


# ------------------------------------------------------------------------------------------------
# idles and aims
# ------------------------------------------------------------------------------------------------

def clip_idle_stand(c):
    T = 4.0
    p = strip_private(c.ready["rifle"])
    tr = A.Track(p)
    key(tr, 0.0, p)
    key(tr, T, p)
    layer = M.chain(M.breathe(T, 1.0, 0.8, seed=1), M.ride(T, amp=1.0, sway=1.0, seed=21))
    return c.bake(tr, T, True, layer=layer, springs=SPR_IDLE,
                  note="loop 4 s; riding a vehicle bed: wide braced stance, knees soft absorbing bumps, rocking with the truck, head "
                       "stabilised; rifle at a compressed low-ready (weapon on socket_hand_R, left hand on the handguard)")


def clip_aim(c, wclass):
    T = 3.0
    p = strip_private(c.aim[wclass])
    tr = A.Track(p)
    key(tr, 0.0, p)
    key(tr, T, p)
    seed = {"rifle": 31, "pistol": 32, "launcher": 33, "shotgun": 34}[wclass]
    layer = M.chain(M.breathe(T, 0.7, 0.5, seed=seed), M.ride(T, amp=0.8, sway=0.8, seed=seed + 10, stabilize=0.9))
    return c.bake(tr, T, True, layer=layer, springs=SPR_IDLE,
                  note="loop 3 s; %s shouldered/aimed along +Z (sight on the right eye), bladed stance, riding sway with the head "
                       "and muzzle stabilised" % wclass)


# ------------------------------------------------------------------------------------------------
# firing
# ------------------------------------------------------------------------------------------------

KICK = {  # back (m), climb (deg), yaw (deg), chest pitch/twist (deg), head (deg), recovery time (s)
    "rifle": dict(back=0.036, climb=5.0, yaw=0.9, sp_pitch=-1.4, sp_twist=-1.8, head=-1.2, rec=0.16),
    "pistol": dict(back=0.035, climb=11.0, yaw=1.2, sp_pitch=-0.8, sp_twist=-0.8, head=-0.8, rec=0.20),
    "shotgun": dict(back=0.060, climb=8.5, yaw=1.5, sp_pitch=-3.5, sp_twist=-3.0, head=-3.0, rec=0.28),
    "launcher": dict(back=0.040, climb=2.2, yaw=0.6, sp_pitch=-2.5, sp_twist=-1.5, head=-5.0, rec=0.35),
}


def kicked(c, a, wc, s=1.0, yaw_sign=1.0):
    """Pose `a` with one recoil impulse of strength s applied (weapon about the stock/wrist, shoulder, chest, head)."""
    kk = KICK[wc]
    w = M.WEAPONS[wc]
    pivot = w["stock"] if w["stock"] is not None else V(0.0, -0.06, -0.05)   # pistol: flips about the wrist
    q = pivot_weapon(c.rig, a, pivot, drot_w=rv(-kk["climb"] * s, kk["yaw"] * s * yaw_sign, 0), dpos_world=V(0, 0.004 * s, -kk["back"] * s))
    q = add(q, sp2=rv(kk["sp_pitch"] * s, kk["sp_twist"] * s), sp1=rv(kk["sp_pitch"] * 0.5 * s, kk["sp_twist"] * 0.4 * s),
            neck=rv(kk["head"] * 0.5 * s), head=rv(kk["head"] * 0.5 * s), shr_R=V(0, 2.0 * s, 1.0 * s),
            hips_pos=V(0, 0, -0.006 * s))
    return q


def clip_fire(c, wc):
    """One shot: recoil impulse -> recovery back onto aim_<wc> frame 0 (additive-ready: frame 0 == aim pose)."""
    a = strip_private(c.aim[wc])
    kk = KICK[wc]
    rec = kk["rec"]
    T = {"rifle": 0.30, "pistol": 0.36, "shotgun": 1.0, "launcher": 1.3}[wc]
    tr = A.Track(a)
    K(tr, 0.0, a)
    K(tr, 0.033, kicked(c, a, wc, 1.0))
    K(tr, 0.033 + rec * 0.45, kicked(c, a, wc, 0.45))
    K(tr, 0.033 + rec, kicked(c, a, wc, 0.08))
    if wc == "shotgun":
        # rack the pump: fore-end back 62 mm and forward, the gun dips a little, head stays on the stock
        g0 = a["gL_pos"]
        K(tr, 0.40, add(kicked(c, a, wc, 0.05), gL_pos=V(0, 0, -0.01)))
        K(tr, 0.50, add(weapon_delta(c.rig, a, drot_w=rv(2.0, 0, 0), dpos_world=V(0, -0.01, -0.01)), gL_pos=V(0, -0.004, -0.062)))
        K(tr, 0.60, add(weapon_delta(c.rig, a, drot_w=rv(1.0, 0, 0)), gL_pos=V(0, 0, 0.002)))
        K(tr, 0.75, a)
    elif wc == "launcher":
        # the back-blast shoves the shoulders, the shooter flinches away, lowers the tube a little to watch, re-acquires
        K(tr, 0.45, add(weapon_delta(c.rig, a, drot_w=rv(3.5, 0, 0), dpos_world=V(0, -0.03, -0.01)), neck=rv(-4, 3), head=rv(-6, 4),
                        sp2=rv(-1.5, 0), hips_pos=V(0, 0, -0.01)))
        K(tr, 0.85, add(weapon_delta(c.rig, a, drot_w=rv(2.0, 0, 0), dpos_world=V(0, -0.02, 0)), neck=rv(-2, 2), head=rv(-3, 2)))
        K(tr, 1.1, a)
    K(tr, T, a)
    spr = dict(SPR_ACT)
    spr["weapon"] = (9.0, 0.45)
    spr["weapon_rot"] = (8.0, 0.5)
    return one_shot(c, tr, T, springs=spr, settle=0.08,
                    note="one shot, %s: recoil impulse at 0.033 s, recovers onto aim_%s frame 0 by %.2f s%s; starts/ends on aim_%s frame 0 "
                         "(additive-ready)" % (wc, wc, T, ", pump racked 0.40-0.60 s" if wc == "shotgun" else "", wc))


def clip_fire_auto(c):
    """Full-auto loop (5 shots in 0.5 s = 600 rpm; timeScale = rps / 10): each shot kicks before the last recovered,
    the shooter rides the recoil and drags the muzzle back down."""
    a = strip_private(c.aim["rifle"])
    T = 0.5
    tr = A.Track(a)
    amps = [1.0, 0.85, 1.1, 0.9, 1.05]
    yaws = [1.0, -0.6, 0.8, -1.0, 0.4]
    for i in range(5):
        t0 = 0.1 * i
        K(tr, t0, kicked(c, a, "rifle", 0.30, yaws[i - 1] if i else 0.0))
        K(tr, t0 + 0.033, kicked(c, a, "rifle", 0.30 + 0.75 * amps[i], yaws[i]))
    K(tr, T, kicked(c, a, "rifle", 0.30, 0.0))
    spr = {"Neck": (4.5, 0.5), "Head": (3.8, 0.45), "weapon": (10.0, 0.5), "weapon_rot": (9.0, 0.55)}
    return c.bake(tr, T, True, springs=spr, note="loop 0.5 s: sustained full-auto, 5 kicks (600 rpm; set timeScale = rps/10); frame 0 = aim_rifle "
                                                  "with a slight held recoil offset -> crossfade from aim_rifle while the trigger is held")


# ------------------------------------------------------------------------------------------------
# reloads (start/end on the class's idle frame 0; left hand leaves the weapon, head follows the hands)
# ------------------------------------------------------------------------------------------------

def look(p, pitch=0.0, twist=0.0, lean=0.0, neck_share=0.45):
    """Turn the head (neck + head split) by the given angles on top of p."""
    return add(p, neck=rv(pitch * neck_share, twist * neck_share, lean * neck_share),
               head=rv(pitch * (1 - neck_share), twist * (1 - neck_share), lean * (1 - neck_share)))


def free_L(p, pos, f, pal, pole=None, att=0.0, grip=None):
    """Left hand free target in the chest frame (att = remaining attachment to the weapon grip)."""
    q = mod(p, hL_pos=pos, hL_f=unit(f), hL_p=unit(pal), attL=S1(att))
    if pole is not None:
        q["hL_pole"] = unit(pole)
    if grip is not None:
        q = fingers(q, L_=grip)
    return q


def on_weapon_L(p, pos, f, pal, grip=None):
    """Left hand on a point of the WEAPON (weapon frame), e.g. the magazine or the charging handle."""
    q = mod(p, gL_pos=pos, gL_f=unit(f), gL_p=unit(pal), attL=S1(1.0))
    if grip is not None:
        q = fingers(q, L_=grip)
    return q


def clip_reload_rifle(c):
    k = c.k
    r0 = strip_private(c.ready["rifle"])
    rig = c.rig
    T = 2.4
    # the reload hold: rifle pulled in, raised, canted so the magazine faces the left hand, muzzle up-left
    hold = weapon_delta(rig, r0, dpos_world=V(0.035, 0.075, -0.03) * k, drot_world=rv(-14, 10, 0))
    hold = weapon_delta(rig, hold, drot_w=rv(0, 0, 28))
    hold = add(hold, hips_pos=V(0, -0.012, 0), sp1=rv(2, 3), sp2=rv(2, 3))
    hold = look(hold, 16, 10, 4)
    mag_grab = on_weapon_L(hold, V(0.030, -0.045, 0.140), [-0.15, -0.75, -0.35], [-1.0, 0.15, 0.1], "mag")
    tr = A.Track(r0)
    K(tr, 0.00, r0)
    K(tr, 0.10, add(weapon_delta(rig, r0, dpos_world=V(0.0, 0.02, 0.0), drot_world=rv(-4, 3, 0)), sp2=rv(1, 1)))
    K(tr, 0.30, mag_grab)
    # thumb the release, rock the mag forward and out
    K(tr, 0.40, add(mag_grab, gL_pos=V(0.0, -0.01, 0.01)))
    K(tr, 0.55, add(weapon_delta(rig, mag_grab, dpos_world=V(0, 0.012, 0)), gL_pos=V(0.03, -0.17, 0.08)))
    # flick the empty away, reach for the chest pouch (twist left, head follows)
    fling = free_L(hold, chest_pt(c, 0.30, -0.32, 0.26), [0.4, -0.6, 0.6], [-0.3, -0.8, 0.2], pole=[0.9, -0.6, -0.2], grip="splay")
    K(tr, 0.68, add(fling, sp1=rv(1, 4), head=rv(2, 6)))
    pouch = free_L(hold, chest_pt(c, 0.10, -0.33, 0.22), [-0.1, -1.0, 0.1], [-0.9, 0.0, 0.2], pole=[0.8, -0.8, -0.3], grip="mag")
    pouch = look(add(pouch, sp1=rv(3, 5), sp2=rv(2, 4), hips_pos=V(0, -0.02, 0)), 10, 8)
    K(tr, 0.86, fingers(pouch, L_="claw"))
    K(tr, 0.96, pouch)
    # bring the fresh mag up, hook the front lip, rock it in, slap
    K(tr, 1.08, add(free_L(hold, chest_pt(c, 0.12, -0.12, 0.34), [-0.1, -0.6, -0.8], [-0.9, 0.3, 0.1], grip="mag"), sp1=rv(1, 2)))
    K(tr, 1.16, on_weapon_L(hold, V(0.03, -0.12, 0.17), [-0.1, -0.5, -0.8], [-0.95, 0.2, 0.1], "mag"))
    seat = on_weapon_L(hold, V(0.03, -0.05, 0.145), [-0.1, -0.7, -0.6], [-0.95, 0.2, 0.1], "mag")
    K(tr, 1.24, seat)
    K(tr, 1.30, add(weapon_delta(rig, seat, dpos_world=V(0, 0.014, 0.004), drot_world=rv(-2, 0, 0)), gL_pos=V(0, 0.012, 0)))
    # over the top to the charging handle (right side), rack it hard, let it fly
    over = on_weapon_L(weapon_delta(rig, hold, drot_w=rv(0, 0, -12)), V(0.0, 0.17, 0.16), [-1.0, -0.3, 0.1], [0.0, -1.0, 0.0], "claw")
    K(tr, 1.42, look(over, -4, 0))
    handle = on_weapon_L(weapon_delta(rig, hold, drot_w=rv(0, 0, -14)), V(-0.035, 0.10, 0.17), [-0.7, -0.6, 0.2], [0.2, -0.6, -0.8], "fist")
    K(tr, 1.50, handle)
    pulled = add(weapon_delta(rig, handle, dpos_world=V(0, 0, 0.012)), gL_pos=V(0, 0.0, -0.10), sp2=rv(0, 3), neck=rv(0, 2))
    K(tr, 1.62, pulled)
    K(tr, 1.67, add(fingers(pulled, L_="splay"), gL_pos=V(0.02, 0.03, -0.02)))
    # hand back to the handguard, rifle rolls upright, eyes up and scanning
    back = look(add(r0, sp2=rv(0, -2)), -3, -6)
    K(tr, 1.92, add(weapon_delta(rig, back, drot_world=rv(-3, 2, 0)), sp1=rv(0, -1)))
    K(tr, 2.15, look(r0, -1, -2))
    K(tr, T, r0)
    return one_shot(c, tr, T, springs=SPR_ACT, settle=0.15, layer=ride_window(T, 0.5, seed=41),
                    note="2.4 s, rifle/smg/lmg: cant the rifle, strip the empty (0.40-0.55), flick it away, fresh mag from the chest "
                         "pouch (0.86-0.96), rock it in + slap (1.24-1.30), rack the charging handle over the top (1.50-1.67), back "
                         "to low-ready; starts/ends on idle_stand frame 0")


def clip_reload_pistol(c):
    k = c.k
    rig = c.rig
    r0 = strip_private(c.ready["pistol"])
    T = 1.6
    hold = weapon_delta(rig, r0, dpos_world=V(0.02, 0.12, -0.06) * k, drot_world=rv(-30, 12, 0))
    hold = weapon_delta(rig, hold, drot_w=rv(0, 0, 22))
    hold = look(add(hold, sp1=rv(2, 2)), 14, 8)
    tr = A.Track(r0)
    K(tr, 0.0, r0)
    K(tr, 0.18, free_L(hold, chest_pt(c, 0.10, -0.12, 0.30), [-0.2, -0.3, 0.9], [-0.8, 0.3, 0.0], grip="relax"))
    belt = free_L(hold, chest_pt(c, 0.20, -0.44, 0.12), [0.0, -1.0, 0.2], [-0.9, 0.0, 0.3], pole=[0.9, -0.5, -0.4], grip="claw")
    belt = look(add(belt, sp1=rv(3, 4), sp2=rv(2, 3), hips_pos=V(0, -0.015, 0)), 6, 6)
    K(tr, 0.40, belt)
    K(tr, 0.50, fingers(belt, L_="mag"))
    K(tr, 0.66, free_L(hold, chest_pt(c, 0.08, -0.22, 0.30), [-0.3, 0.2, 0.9], [-0.6, 0.6, 0.2], grip="mag"))
    K(tr, 0.76, on_weapon_L(hold, V(0.0, -0.12, 0.02), [-0.2, 0.9, 0.1], [0.0, 0.2, -1.0], "mag"))
    seat = on_weapon_L(hold, V(0.0, -0.075, 0.015), [-0.2, 0.9, 0.1], [0.0, 0.3, -0.95], "fist")
    K(tr, 0.84, seat)
    K(tr, 0.88, weapon_delta(rig, seat, dpos_world=V(0, 0.018, 0), drot_world=rv(-3, 0, 0)))
    # overhand rack of the slide
    rack = on_weapon_L(weapon_delta(rig, hold, drot_w=rv(0, 0, -18)), V(0.0, 0.075, -0.005), [-1.0, -0.2, 0.0], [0.0, -1.0, 0.1], "claw")
    K(tr, 1.00, look(rack, -4, -2))
    racked = add(weapon_delta(rig, rack, dpos_world=V(0, 0, 0.02)), gL_pos=V(0, 0.005, -0.045))
    K(tr, 1.10, fingers(racked, L_="fist"))
    K(tr, 1.14, fingers(add(racked, gL_pos=V(0.02, 0.03, -0.01)), L_="splay"))
    K(tr, 1.34, look(add(r0, sp2=rv(0, -1)), -2, -4))
    K(tr, T, r0)
    return one_shot(c, tr, T, springs=SPR_ACT, settle=0.12, layer=ride_window(T, 0.5, seed=42),
                    note="1.6 s, pistol/revolver: tip the pistol up, fresh mag from the left hip (0.40-0.50), insert + slap (0.76-0.88), "
                         "overhand slide rack (1.00-1.14); starts/ends on idle_pistol frame 0")


def clip_reload_shotgun(c):
    k = c.k
    rig = c.rig
    r0 = strip_private(c.ready["shotgun"])
    T = 2.3
    hold = weapon_delta(rig, r0, dpos_world=V(0.03, 0.05, -0.02) * k, drot_world=rv(-6, 12, 0))
    hold = weapon_delta(rig, hold, drot_w=rv(0, 0, 38))
    hold = look(add(hold, sp1=rv(2, 3), hips_pos=V(0, -0.01, 0)), 16, 10, 3)
    tr = A.Track(r0)
    K(tr, 0.0, r0)
    t = 0.22
    K(tr, t, on_weapon_L(hold, V(0.03, -0.04, 0.20), [0.0, -0.3, -1.0], [-1.0, 0.2, 0.0], "claw"))
    for i in range(3):
        belt = free_L(hold, chest_pt(c, 0.16 + 0.02 * i, -0.40, 0.16), [0.0, -1.0, 0.3], [-0.9, 0.0, 0.3], pole=[0.9, -0.5, -0.4], grip="claw")
        belt = look(add(belt, sp1=rv(3, 4), sp2=rv(1, 3)), 4, 8)
        K(tr, t + 0.14, belt)
        K(tr, t + 0.20, fingers(belt, L_="pinch"))
        K(tr, t + 0.33, on_weapon_L(hold, V(0.01, -0.06, 0.20), [-0.1, 0.4, -0.9], [-0.3, -0.9, -0.1], "pinch"))
        K(tr, t + 0.40, on_weapon_L(hold, V(0.0, -0.03, 0.15), [-0.1, 0.4, -0.9], [-0.2, -0.95, 0.0], "pinch"))
        K(tr, t + 0.44, weapon_delta(rig, on_weapon_L(hold, V(0.0, -0.025, 0.13), [-0.1, 0.4, -0.9], [-0.2, -0.95, 0.0], "fist"),
                                     dpos_world=V(0, 0.006, 0)))
        t += 0.44
    # back to the pump, roll upright and rack it
    aimish = add(r0, sp2=rv(0, -1))
    K(tr, t + 0.22, aimish)
    K(tr, t + 0.32, add(weapon_delta(rig, aimish, dpos_world=V(0, -0.01, 0)), gL_pos=V(0, -0.004, -0.062)))
    K(tr, t + 0.42, aimish)
    K(tr, T, r0)
    return one_shot(c, tr, T, springs=SPR_ACT, settle=0.12, layer=ride_window(T, 0.5, seed=43),
                    note="2.3 s, pump shotgun: roll the gun, thumb three shells from the belt into the loading port (0.22-1.54), "
                         "rack the pump (1.76-1.96); starts/ends on the shotgun low-ready (idle_stand frame 0 hold)")


def clip_reload_launcher(c):
    k = c.k
    rig = c.rig
    a0 = strip_private(c.aim["launcher"])
    T = 2.8
    # lower the tube to the chest, muzzle forward-left, then fetch a rocket from the back over the left shoulder
    low = weapon_delta(rig, a0, dpos_world=V(0.06, -0.20, 0.06) * k, drot_world=rv(4, 22, 0))
    low = look(add(low, sp1=rv(2, 6), sp2=rv(1, 6)), 8, 14)
    tr = A.Track(a0)
    K(tr, 0.0, a0)
    K(tr, 0.30, add(low, attL=S1(-0.4)))
    reach = free_L(low, chest_pt(c, 0.14, 0.26, -0.10), [-0.2, 0.3, -1.0], [0.3, 0.9, 0.1], pole=[1.0, 0.3, 0.0], grip="claw")
    reach = look(add(reach, sp1=rv(-2, 10), sp2=rv(-2, 10), shr_L=V(0, -6, 10)), 2, 26, -4)
    K(tr, 0.62, reach)
    K(tr, 0.74, fingers(reach, L_="fist"))
    fwd = free_L(low, chest_pt(c, 0.30, 0.02, 0.35), [-0.4, 0.1, 0.9], [-0.1, 0.9, 0.2], pole=[1.0, -0.6, -0.2], grip="fist")
    K(tr, 1.00, look(add(fwd, sp1=rv(0, 8), sp2=rv(0, 8)), 10, 20))
    K(tr, 1.28, look(on_weapon_L(low, V(0.0, 0.09, 0.80), [-0.9, 0.0, 0.3], [0.0, 1.0, 0.0], "fist"), 10, 16))
    K(tr, 1.55, look(on_weapon_L(low, V(0.0, 0.10, 0.60), [-0.9, 0.0, 0.3], [0.0, 1.0, 0.0], "fist"), 10, 14))
    K(tr, 1.62, weapon_delta(rig, look(on_weapon_L(low, V(0.0, 0.10, 0.575), [-0.9, 0.0, 0.3], [0.0, 1.0, 0.0], "fist"), 10, 14),
                             dpos_world=V(0, 0, -0.012)))
    K(tr, 1.90, low)
    K(tr, 2.35, add(weapon_delta(rig, a0, dpos_world=V(0, -0.02, 0), drot_world=rv(3, 3, 0)), neck=rv(1, 2)))
    K(tr, T, a0)
    return one_shot(c, tr, T, springs=SPR_ACT, settle=0.15, layer=ride_window(T, 0.5, seed=44),
                    note="2.8 s, RPG: lower the tube, draw a rocket from the back over the left shoulder (0.62-0.74), feed it into the "
                         "muzzle (1.28-1.62), back to the front grip and re-shoulder; starts/ends on aim_launcher frame 0")


# ------------------------------------------------------------------------------------------------
# throws, taunts (the rifle passes to the LEFT hand: runtime reparents it to socket_hand_L, see the notes)
# ------------------------------------------------------------------------------------------------

def free_R(p, pos, f, pal, pole=None, att=0.0, grip=None):
    q = mod(p, hR_pos=pos, hR_f=unit(f), hR_p=unit(pal), attR=S1(att))
    if pole is not None:
        q["hR_pole"] = unit(pole)
    if grip is not None:
        q = fingers(q, R_=grip)
    return q


def rifle_in_left(c, p, where=(0.20, -0.40, 0.16), fwd=(0.25, -0.85, 0.45), up=(0.3, 0.2, 1.0)):
    """Rifle carried by the LEFT hand at the handguard (chest-frame point `where`, muzzle along `fwd` in the chest frame)."""
    rig = c.rig
    Cpos, Crot = rig.chest(p)
    Rw = Crot @ M.rot_from(unit(fwd), up=unit(up))
    grip_world = Cpos + Crot @ (V(*where) * c.k)
    O = grip_world - Rw @ p["gL_pos"]
    return M.set_weapon_world(rig, p, O, Rw)


def clip_throw(c, kind="grenade"):
    k = c.k
    rig = c.rig
    r0 = strip_private(c.ready["rifle"])
    lob = kind == "molotov"
    T = 1.7 if lob else 1.3
    tr_ = 0.95 if lob else 0.55                              # release time
    sR = 1.0
    tr = A.Track(r0)
    K(tr, 0.0, r0)
    # 0.08: right hand lets go, the rifle swings down into the left hand
    carry = rifle_in_left(c, r0, where=(0.17, -0.33, 0.30), fwd=(-0.05, -0.45, 1.0), up=(0.0, 1.0, 0.2))
    grab = free_R(carry, chest_pt(c, -0.12, -0.18, 0.20), [0.1, -0.9, 0.3], [0.9, 0.0, 0.4], pole=[-0.8, -0.8, -0.3], grip="claw")
    K(tr, 0.08, add(r0, attR=S1(-0.2)))
    K(tr, 0.18 if not lob else 0.22, look(add(grab, sp1=rv(3, -3)), 8, -6))
    held = free_R(carry, chest_pt(c, -0.05, -0.02, 0.26), [0.0, 0.3, 0.95], [0.3, -0.3, 0.9], pole=[-0.9, -0.6, -0.2], grip="throw")
    t_hold = 0.26 if not lob else 0.42
    K(tr, t_hold, add(held, sp2=rv(1, -2)))
    # wind-up: weight back onto the right foot, hips and chest turn right, arm cocked behind the head, rifle arm forward
    cock = free_R(carry, chest_pt(c, -0.34, 0.24, -0.22) if not lob else chest_pt(c, -0.30, 0.02, -0.34),
                  [0.0, 0.5, -0.85] if not lob else [0.0, -0.6, -0.8], [0.1, 0.3, 0.95], pole=[-1.0, 0.3, -0.4] if not lob else [-1.0, -0.4, -0.3], grip="throw")
    cock = rifle_in_left(c, cock, where=(0.22, -0.20, 0.40), fwd=(0.1, -0.25, 1.0), up=(0.0, 1.0, 0.2))
    cock = add(cock, hips_pos=V(-0.035, -0.012, -0.045) * k, hips_rot=rv(-4, -16), sp0=rv(-3, -6), sp1=rv(-6, -10, lean=3), sp2=rv(-5, -8, lean=4),
               shr_R=V(0, 6, 6))
    cock = look(cock, -6, 22, -3)
    t_cock = 0.44 if not lob else 0.74
    K(tr, t_cock - 0.06, add(cock, hips_rot=rv(1, 3)))                     # the turn arrives first, the arm drags behind
    K(tr, t_cock, cock)
    # drive: hips fire first, chest follows, elbow leads the hand
    drive = free_R(carry, chest_pt(c, -0.24, 0.34, 0.02) if not lob else chest_pt(c, -0.22, 0.42, -0.02),
                   [0.0, 0.8, 0.5], [0.2, 0.3, 0.95], pole=[-0.8, 0.5, -0.3], grip="throw")
    drive = rifle_in_left(c, drive, where=(0.22, -0.30, 0.32), fwd=(0.0, -0.45, 1.0), up=(0.0, 1.0, 0.2))
    drive = add(drive, hips_pos=V(0.01, -0.02, 0.03) * k, hips_rot=rv(3, 10), sp0=rv(2, 5), sp1=rv(3, 8), sp2=rv(4, 6), shr_R=V(0, 3, 8))
    drive = look(drive, -2, 4)
    K(tr, tr_ - 0.07, drive)
    # release: arm long and high in front, chest square and pitched forward, back heel coming up
    rel = free_R(carry, chest_pt(c, -0.08, 0.34, 0.50) if not lob else chest_pt(c, -0.06, 0.52, 0.40),
                 [0.0, 0.25, 1.0] if not lob else [0.0, 0.6, 0.8], [0.0, -0.3, 0.95], pole=[-0.4, -0.3, -0.6], grip="open")
    rel = rifle_in_left(c, rel, where=(0.24, -0.38, 0.22), fwd=(-0.1, -0.30, 1.0), up=(0.0, 1.0, 0.2))
    lk = 0.55 if lob else 1.0
    rel = add(rel, hips_pos=V(0.03, -0.035, 0.07) * k, hips_rot=rv(6 * lk, 18), sp0=rv(4 * lk, 7), sp1=rv(6 * lk, 10), sp2=rv(5 * lk, 6))
    rel = heel_raise(rig, look(rel, -8, -10), "R", 14)
    K(tr, tr_, rel)
    # follow-through across the body, heel up, chest folded over the front leg
    fol = free_R(carry, chest_pt(c, 0.16, -0.18, 0.36), [0.5, -0.7, 0.4], [0.6, 0.2, -0.7], pole=[-0.4, -1.0, 0.2], grip="relax")
    fol = rifle_in_left(c, fol, where=(0.24, -0.40, 0.18), fwd=(-0.1, -0.22, 1.0), up=(0.0, 1.0, 0.2))
    fol = add(fol, hips_pos=V(0.04, -0.05, 0.09) * k, hips_rot=rv(8 * lk, 24), sp0=rv(4 * lk, 9), sp1=rv(7 * lk, 12), sp2=rv(5 * lk, 8))
    fol = heel_raise(rig, look(fol, -12, -14), "R", 26)
    K(tr, tr_ + 0.18, fol)
    # recover: back to the grip, rifle up into the low-ready
    rec = free_R(carry, chest_pt(c, -0.08, -0.16, 0.26), [0.0, -0.6, 0.8], [0.9, 0.1, 0.3], pole=[-0.7, -0.8, -0.3], grip="relax")
    rec = add(rec, hips_pos=V(0.015, -0.02, 0.03) * k, hips_rot=rv(4, 8), sp1=rv(4, 3))
    rec = heel_raise(rig, look(rec, -4, -4), "R", 6)
    K(tr, tr_ + 0.40, rec)
    K(tr, T - 0.2, add(r0, sp1=rv(1, 0)))
    K(tr, T, r0)
    note = ("%.1f s %s throw with the RIGHT hand, RELEASE at %.2f s. The rifle passes to the LEFT hand: parent the weapon to socket_hand_L "
            "(position = -grip_L of the weapon, identity rotation) from 0.08 s to %.2f s, then back to socket_hand_R; show the %s in "
            "socket_hand_R from 0.18 s to the release. Starts/ends on idle_stand frame 0" % (T, "lobbed molotov" if lob else "overhand grenade",
                                                                                             tr_, T - 0.12, "bottle" if lob else "grenade"))
    spr = dict(SPR_ACT)
    spr["hR"] = (6.5, 0.5)
    c_ = one_shot(c, tr, T, springs=spr, settle=0.15, note=note)
    c_["release_time"] = tr_
    return c_


def clip_taunt(c):
    """Brandish the rifle overhead one-handed, roar with the chest thrown out, pound the air with the fist, back to ready."""
    k = c.k
    rig = c.rig
    r0 = strip_private(c.ready["rifle"])
    T = 2.4
    tr = A.Track(r0)
    K(tr, 0.0, r0)
    # anticipation: dip, gather
    dip = weapon_delta(rig, add(r0, hips_pos=V(0, -0.03, 0) * k, sp1=rv(5, 2), sp2=rv(4, 2)), dpos_world=V(0, -0.04, 0))
    K(tr, 0.20, look(dip, 8, 0))
    up_rot = M.rot_from(unit([0.05, 0.85, -0.5]), up=unit([0.2, 0.3, 1.0]))
    def overhead(p, h=0.62, x=-0.16, shake=0.0):
        Cpos, Crot = rig.chest(p)
        O = Cpos + Crot @ (V(x, h + shake, 0.10) * k)
        q = M.set_weapon_world(rig, p, O, Crot @ up_rot)
        return free_L(q, chest_pt(c, 0.30, 0.10 + shake * 0.6, 0.30), [0.0, 0.9, 0.3], [-0.9, 0.1, 0.3], pole=[1.0, -0.6, -0.3], grip="fist")
    roar = add(r0, hips_pos=V(0, 0.01, -0.02) * k, hips_rot=rv(-2, 0), sp0=rv(-3, 0), sp1=rv(-7, 4), sp2=rv(-8, 3), shr_R=V(0, 0, -8), shr_L=V(0, 0, 6))
    roar = look(roar, -22, 6)
    K(tr, 0.45, overhead(roar, 0.50))
    K(tr, 0.62, overhead(roar, 0.66))
    for i, t in enumerate((0.85, 1.10, 1.35)):
        K(tr, t, overhead(add(roar, sp1=rv(2, -2 + 4 * (i % 2))), 0.56, shake=-0.05))
        K(tr, t + 0.12, overhead(add(roar, sp1=rv(-2, 2 - 4 * (i % 2))), 0.68, shake=0.04))
    K(tr, 1.75, overhead(look(add(roar, sp2=rv(4, 0)), 14, -4), 0.50))
    K(tr, 2.05, look(weapon_delta(rig, add(r0, attL=S1(-0.3), sp1=rv(2, 0)), dpos_world=V(0, 0.06, 0)), 3, -2))
    K(tr, T, r0)
    spr = dict(SPR_ACT)
    spr["hL"] = (5.0, 0.45)
    return one_shot(c, tr, T, springs=spr, settle=0.15, note="2.4 s taunt: dip, thrust the rifle overhead one-handed, roar with the chest out "
                                                              "and head back, three fist/rifle pumps, back to ready; starts/ends on idle_stand frame 0")


def clip_shout(c):
    """Lean in and jab a finger at the target while yelling (rifle held one-handed at the hip)."""
    k = c.k
    rig = c.rig
    r0 = strip_private(c.ready["rifle"])
    T = 1.6
    tr = A.Track(r0)
    K(tr, 0.0, r0)
    hip = weapon_delta(rig, r0, dpos_world=V(-0.03, -0.06, -0.02), drot_world=rv(12, -8, 0))
    def point(p, reach=0.62, y=0.16, lean=6):
        y = y + 0.16
        lean = lean * 0.6
        q = free_L(p, chest_pt(c, 0.10, y, reach), [0.05, 0.1, 1.0], [-0.3, -0.9, 0.1], pole=[0.9, -0.6, -0.2], grip="point")
        return look(add(q, hips_pos=V(0, -0.01, 0.02) * k, sp0=rv(2, 2), sp1=rv(lean, 4), sp2=rv(lean * 0.7, 3), shr_L=V(0, -4, 4)), -10, -4)
    K(tr, 0.22, point(hip, 0.40, 0.05, 2))
    K(tr, 0.40, point(hip, 0.66, 0.18, 8))
    K(tr, 0.58, point(hip, 0.52, 0.12, 5))
    K(tr, 0.74, point(hip, 0.68, 0.20, 9))
    K(tr, 0.92, point(hip, 0.55, 0.14, 6))
    K(tr, 1.06, point(hip, 0.66, 0.18, 8))
    K(tr, 1.34, look(add(r0, attL=S1(-0.4)), 0, -2))
    K(tr, T, r0)
    spr = dict(SPR_ACT)
    spr["hL"] = (6.0, 0.45)
    return one_shot(c, tr, T, springs=spr, settle=0.12, note="1.6 s: lean in and jab the left index finger at the target three times "
                                                              "(yelling), rifle one-handed at the hip; starts/ends on idle_stand frame 0")


def clip_crouch(c):
    k = c.k
    rig = c.rig
    T = 3.0
    r0 = strip_private(c.ready["rifle"])
    p = copy.deepcopy(r0)
    p["fL_pos"] = V(0.25 * k * c.bulk, rig.ankle_h, 0.17 * k)
    p["fR_pos"] = V(-0.25 * k * c.bulk, rig.ankle_h, -0.08 * k)
    p["hips_pos"] = V(0.0, 0.56 * k, rig.heads[0][2] - 0.20 * k)
    p["hips_rot"] = rv(pitch=20, twist=-5)
    p["sp0"], p["sp1"], p["sp2"] = rv(8, -2), rv(8, -3), rv(5, -2)
    p = look(p, -26, 4)
    p = heel_raise(rig, p, "R", 20)
    p = weapon_delta(rig, p, drot_world=rv(8, 0, 0), dpos_world=V(0, -0.02, 0.03))
    tr = A.Track(p)
    K(tr, 0.0, p)
    K(tr, T, p)
    layer = M.chain(M.breathe(T, 1.1, 0.6, seed=2), M.ride(T, amp=0.7, sway=0.8, seed=23))
    return c.bake(tr, T, True, layer=layer, springs=SPR_IDLE, note="loop 3 s; ducked behind the rail: deep crouch, back heel up, rifle "
                                                                   "low and ready, head up watching, riding sway")


def clip_idle_class(c, wc):
    T = 4.0
    p = strip_private(c.ready[wc])
    tr = A.Track(p)
    K(tr, 0.0, p)
    K(tr, T, p)
    seed = {"pistol": 51, "launcher": 52}[wc]
    layer = M.chain(M.breathe(T, 1.0, 0.8, seed=seed), M.ride(T, amp=1.0, sway=1.0, seed=seed + 5))
    return c.bake(tr, T, True, layer=layer, springs=SPR_IDLE,
                  note="loop 4 s; riding idle like idle_stand, %s" % ("pistol held low in both hands" if wc == "pistol" else "RPG on the right shoulder, muzzle raised"))


def clip_celebrate(c):
    k = c.k
    rig = c.rig
    r0 = strip_private(c.ready["rifle"])
    T = 2.2
    tr = A.Track(r0)
    K(tr, 0.0, r0)
    Rh = M.rot_from(unit([1.0, 0.1, 0.0]), up=unit([0.0, 0.2, 1.0]))      # rifle horizontal overhead, muzzle to the left
    def over(p, h):
        Cpos, Crot = rig.chest(p)
        O = Cpos + Crot @ (V(-0.18, h, 0.12) * k)
        return M.set_weapon_world(rig, p, O, Crot @ Rh)
    crouch = add(r0, hips_pos=V(0, -0.05, -0.01) * k, sp1=rv(6, 0), sp2=rv(4, 0))
    K(tr, 0.22, look(weapon_delta(rig, crouch, dpos_world=V(0, -0.05, 0)), 10, 0))
    cheer = look(add(r0, hips_pos=V(0, 0.015, 0) * k, sp1=rv(-6, 0), sp2=rv(-7, 0), shr_L=V(0, 0, 8), shr_R=V(0, 0, -8)), -20, 0)
    K(tr, 0.48, over(cheer, 0.64))
    for i, t in enumerate((0.75, 1.05, 1.35)):
        K(tr, t, over(add(cheer, hips_pos=V(0, -0.03, 0) * k, sp1=rv(3, 3 - 6 * (i % 2))), 0.50))
        K(tr, t + 0.15, over(add(cheer, sp1=rv(-2, -2 + 4 * (i % 2))), 0.68))
    K(tr, 1.85, look(weapon_delta(rig, add(r0, sp1=rv(2, 0)), dpos_world=V(0, 0.08, 0)), 2, 0))
    K(tr, T, r0)
    return one_shot(c, tr, T, springs=SPR_ACT, settle=0.15, note="2.2 s: gather, rifle hoisted overhead in both hands, three bouncing cheers, "
                                                                  "back to ready; starts/ends on idle_stand frame 0")


def build(rig, bulk=1.0, only=None):
    c = Ctx(rig, bulk)
    out = {}
    want = lambda n: only is None or n in only
    if want("idle_stand"):
        out["idle_stand"] = clip_idle_stand(c)
    for wc, name in (("rifle", "aim_rifle"), ("pistol", "aim_pistol"), ("launcher", "aim_launcher"), ("shotgun", "aim_shotgun")):
        if want(name):
            out[name] = clip_aim(c, wc)
    for wc in ("rifle", "pistol", "shotgun", "launcher"):
        if want("fire_" + wc):
            out["fire_" + wc] = clip_fire(c, wc)
    if want("fire_rifle_auto"):
        out["fire_rifle_auto"] = clip_fire_auto(c)
    for wc, fn in (("rifle", clip_reload_rifle), ("pistol", clip_reload_pistol), ("shotgun", clip_reload_shotgun), ("launcher", clip_reload_launcher)):
        if want("reload_" + wc):
            out["reload_" + wc] = fn(c)
    for wc in ("pistol", "launcher"):
        if want("idle_" + wc):
            out["idle_" + wc] = clip_idle_class(c, wc)
    if want("crouch_idle"):
        out["crouch_idle"] = clip_crouch(c)
    if want("throw_grenade"):
        out["throw_grenade"] = clip_throw(c, "grenade")
    if want("throw_molotov"):
        out["throw_molotov"] = clip_throw(c, "molotov")
    if want("taunt"):
        out["taunt"] = clip_taunt(c)
    if want("shout"):
        out["shout"] = clip_shout(c)
    if want("celebrate"):
        out["celebrate"] = clip_celebrate(c)
    return out, c
