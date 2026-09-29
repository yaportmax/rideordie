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
        fwd = unit([0.30, -0.42, 1.0])
        Rw = M.rot_from(fwd, up=unit([-0.15, 1.0, 0.0]))
        stock = M.WEAPONS[wclass]["stock"]
        pocket = sh + V(0.085 * k * bulk, -0.10 * k, 0.085 * k)           # front of the right pec, under the collarbone
        O = pocket - Rw @ stock
        O = O + V(0.0, 0.0, 0.02)
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


def build(rig, bulk=1.0, only=None):
    c = Ctx(rig, bulk)
    out = {}
    want = lambda n: only is None or n in only
    if want("idle_stand"):
        out["idle_stand"] = clip_idle_stand(c)
    for wc, name in (("rifle", "aim_rifle"), ("pistol", "aim_pistol"), ("launcher", "aim_launcher")):
        if want(name):
            out[name] = clip_aim(c, wc)
    return out, c
