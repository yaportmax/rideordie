"""fp_arms rig: skeleton subset (identity rest rotations), sockets (= hero_gunner's), finger pose solver and pose clips.

Finger joints are hinges about MakeHuman's own flexion planes (tip, middle joint, wrist), positive = curl toward the palm.
Poses are authored per hand as {finger: (mcp, pip, dip) degrees} + spread + a thumb CMC rotation, see POSES.
"""
import os
import sys

import numpy as np
from scipy.spatial.transform import Rotation as R

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

FINGERS = ("Thumb", "Index", "Middle", "Ring", "Pinky")
SIDES = ("Left", "Right")


def unit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


def rot(axis, deg):
    return R.from_rotvec(unit(axis) * np.radians(deg)).as_matrix()


class FpRig:
    def __init__(self, S):
        self.all_names = [str(n) for n in S["all_bones"]]
        self.heads_all = np.asarray(S["heads"], float)
        self.bones = [str(b) for b in S["bones"]]
        self.H = {n: self.heads_all[i] for i, n in enumerate(self.all_names)}
        self.parent = {}
        for b in self.bones:
            if b == "Spine2":
                self.parent[b] = None
            elif b.endswith("Shoulder"):
                self.parent[b] = "Spine2"
            elif b.endswith("ForeArm"):
                self.parent[b] = b.replace("ForeArm", "Arm")
            elif b.endswith("Arm"):
                self.parent[b] = b.replace("Arm", "Shoulder")
            elif b.endswith("Hand"):
                self.parent[b] = b.replace("Hand", "ForeArm")
            else:
                k = int(b[-1])
                self.parent[b] = b[:-1] + str(k - 1) if k > 1 else b[: b.index("Hand") + 4]
        tips = {str(k): v for k, v in zip(S["tip_keys"], S["tips"])}
        planes = {str(k): v for k, v in zip(S["tip_keys"], S["planes"])}
        self.tips = tips
        self.frames = {}
        self.axes = {}
        for s in SIDES:
            w = self.H[s + "Hand"]
            d0 = unit(self.H[s + "HandMiddle1"] - w)
            lat = unit(self.H[s + "HandPinky1"] - self.H[s + "HandIndex1"])
            dorsal = np.cross(d0, lat) * (1.0 if s == "Left" else -1.0)
            dorsal = unit(dorsal - d0 * np.dot(dorsal, d0))
            self.frames[s] = dict(d0=d0, lat=lat, dorsal=dorsal, palm=-dorsal)
            for f in FINGERS:
                p = planes[s + f]
                n = unit(np.cross(p[1] - p[0], p[2] - p[0]))
                # sign: a positive rotation must move the tip toward the palm
                j1 = self.H["%sHand%s1" % (s, f)]
                tip = tips[s + f]
                d = tip - j1
                moved = rot(n, 5) @ d - d
                ref = -dorsal if f != "Thumb" else unit(-dorsal + d0 * 0.2 + lat * 0.6)
                if np.dot(moved, ref) < 0:
                    n = -n
                self.axes[(s, f)] = n

    # ------------------------------------------------------------------------------------------------ poses
    def finger_locals(self, pose):
        """pose: {side: {finger: (a1, a2, a3), 'spread': deg, 'thumb': (opp, abd)}} -> {bone: 3x3 local rotation}."""
        out = {}
        for s in SIDES:
            P = pose.get(s, {})
            fr = self.frames[s]
            spread = P.get("spread", 0.0)
            for fi, f in enumerate(FINGERS):
                ang = P.get(f, (0.0, 0.0, 0.0))
                ax = self.axes[(s, f)]
                for k in (1, 2, 3):
                    Rl = rot(ax, ang[k - 1])
                    if k == 1 and f != "Thumb":
                        sg = 1.0 if s == "Left" else -1.0
                        Rl = rot(fr["dorsal"], sg * spread * (fi - 2.5) * 0.35) @ Rl
                    if k == 1 and f == "Thumb":
                        opp, abd = P.get("thumb", (0.0, 0.0))
                        t_ax = unit(self.H["%sHandThumb2" % s] - self.H["%sHandThumb1" % s])
                        sg = 1.0 if s == "Left" else -1.0
                        # abduction swings the metacarpal away from the palm plane toward the palm side, opposition rolls it
                        Rl = rot(fr["d0"], sg * abd) @ rot(t_ax, sg * opp) @ Rl
                    out["%sHand%s%d" % (s, f, k)] = Rl
        return out

    def world(self, locals_):
        """FK: {bone: local 3x3} -> {bone: (world R, world p)} (rest = identity rotations)."""
        W = {}
        for b in self.bones:
            p = self.parent[b]
            Rl = locals_.get(b, np.eye(3))
            if p is None:
                W[b] = (Rl, self.H[b].copy())
            else:
                Rp, Pp = W[p]
                W[b] = (Rp @ Rl, Pp + Rp @ (self.H[b] - self.H[p]))
        return W

    def skin(self, pos, weights, locals_):
        """Linear-blend skinning of rest positions (V,3) with weights (V,B in self.bones order)."""
        W = self.world(locals_)
        out = np.zeros_like(pos)
        for bi, b in enumerate(self.bones):
            w = weights[:, bi]
            m = w > 1e-5
            if not m.any():
                continue
            Rw, Pw = W[b]
            out[m] += w[m, None] * ((pos[m] - self.H[b]) @ Rw.T + Pw)
        return out


# ---------------------------------------------------------------------------------------------------- the poses
# (mcp, pip, dip) degrees; spread in degrees (fans the fingers); thumb: (opposition roll, abduction) degrees
POSES = {
    "pose_rifle": {
        "Right": {"Thumb": (10, 25, 20), "thumb": (35, 25), "Index": (30, 50, 25), "Middle": (72, 88, 38), "Ring": (78, 90, 40),
                  "Pinky": (82, 88, 38), "spread": -4},
        "Left": {"Thumb": (5, 15, 10), "thumb": (30, 30), "Index": (42, 62, 30), "Middle": (48, 66, 32), "Ring": (52, 68, 34),
                 "Pinky": (58, 70, 34), "spread": 2},
    },
    "pose_pistol": {
        "Right": {"Thumb": (5, 15, 10), "thumb": (30, 22), "Index": (22, 35, 18), "Middle": (75, 88, 38), "Ring": (80, 90, 40),
                  "Pinky": (84, 88, 38), "spread": -4},
        "Left": {"Thumb": (0, 10, 5), "thumb": (20, 15), "Index": (55, 70, 30), "Middle": (60, 72, 32), "Ring": (64, 74, 34),
                 "Pinky": (68, 74, 34), "spread": -2},
    },
    "pose_launcher": {
        "Right": {"Thumb": (10, 25, 20), "thumb": (35, 25), "Index": (30, 50, 25), "Middle": (72, 88, 38), "Ring": (78, 90, 40),
                  "Pinky": (82, 88, 38), "spread": -4},
        "Left": {"Thumb": (10, 25, 20), "thumb": (35, 25), "Index": (65, 85, 38), "Middle": (72, 88, 38), "Ring": (78, 90, 40),
                 "Pinky": (82, 88, 38), "spread": -4},
    },
    "pose_open": {
        "Right": {"Thumb": (0, 8, 6), "thumb": (10, 10), "Index": (8, 12, 6), "Middle": (10, 14, 8), "Ring": (12, 16, 8), "Pinky": (14, 18, 8),
                  "spread": 3},
        "Left": {"Thumb": (0, 8, 6), "thumb": (10, 10), "Index": (8, 12, 6), "Middle": (10, 14, 8), "Ring": (12, 16, 8), "Pinky": (14, 18, 8),
                 "spread": 3},
    },
}


def sockets(S):
    """socket_hand_R / _L exactly as hero_gunner.glb (anim.socket_frames on the same skeleton)."""
    import anim
    heads = np.asarray(S["heads"], float)
    clips = anim.build_clips(heads, only=("pose_rifle",))
    pos, rot_ = anim.socket_frames(heads, clips)
    return {k: (pos[k], rot_[k]) for k in ("socket_hand_R", "socket_hand_L")}
