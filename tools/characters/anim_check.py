"""Numeric QA for the baked clips of a character GLB (reads the GLB, so it checks exactly what ships):
loop seams, planted-foot sliding (standing/seated clips), per-frame angular-velocity spikes (pops), Hips below the floor.

    C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/characters/anim_check.py public/models/characters/raider_b.glb
"""
import sys

import numpy as np
from scipy.spatial.transform import Rotation as R

import anim as A
import mh
import reanim

PLANTED = ("idle_", "aim_", "fire_", "reload_", "crouch_idle", "taunt", "shout", "celebrate", "hit_", "flinch_", "throw_", "sit_",
           "death_sit")


def fk(heads, rot, hips):
    """World positions of every bone for one frame (rot: (B,4) local quats)."""
    off = np.zeros_like(heads)
    for b in range(len(heads)):
        off[b] = heads[b] if A.PAR[b] < 0 else heads[b] - heads[A.PAR[b]]
    W = [None] * len(heads)
    P = np.zeros_like(heads)
    for b in range(len(heads)):
        L = R.from_quat(rot[b]).as_matrix()
        if A.PAR[b] < 0:
            W[b] = L
            P[b] = hips
        else:
            W[b] = W[A.PAR[b]] @ L
            P[b] = P[A.PAR[b]] + W[A.PAR[b]] @ off[b]
    return P


def main(path):
    js, b = reanim.read_glb(path)
    heads, bn = reanim.rest_heads(js)
    clips = reanim.existing_clips(js, b, bn)
    iF = [mh.BONE_INDEX[n] for n in ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase")]
    bad = 0
    for name, c in clips.items():
        rot, hips = c["rot"], c["hips_t"]
        T = len(rot)
        msg = []
        if T > 2:
            # angular speed per bone (deg/frame) -> spikes
            d = np.abs(np.sum(rot[1:] * rot[:-1], axis=-1)).clip(0, 1)
            ang = np.degrees(2 * np.arccos(d))
            # FLIP = an isolated one-frame spike (>45 deg in one frame while both neighbours move < 40% of that)
            flips = []
            for bb in range(ang.shape[1]):
                a = ang[:, bb]
                for t in range(len(a)):
                    lo = a[t - 1] if t > 0 else 0.0
                    hi = a[t + 1] if t + 1 < len(a) else 0.0
                    if a[t] > 45 and max(lo, hi) < 0.4 * a[t]:
                        flips.append((a[t], t, mh.BONE_NAMES[bb]))
            if flips:
                flips.sort(reverse=True)
                msg.append("FLIP " + ", ".join("%.0f deg f%d %s" % f for f in flips[:3]))
            fast = float(ang.max())
            if fast > 60 and not flips:
                t, bb = np.unravel_index(ang.argmax(), ang.shape)
                msg.append("fast %.0f deg/f f%d %s" % (fast, t, mh.BONE_NAMES[bb]))
        if any(name.startswith(p) for p in PLANTED) and T > 2:
            feet = np.array([fk(heads, rot[t], hips[t])[iF] for t in range(0, T, 2)])
            slide = np.linalg.norm(feet[:, :2, [0, 2]] - feet[:1, :2, [0, 2]], axis=-1).max()
            if slide > 0.03 and not name.startswith(("hit_", "throw_", "celebrate", "taunt")):
                msg.append("FOOT SLIDE %.3f m" % slide)
        loop_like = name.startswith(("idle_", "aim_", "crouch_idle", "sit_lean", "fall_flail", "sit_brace")) or name == "fire_rifle_auto"
        if loop_like:
            seam = float(np.degrees(2 * np.arccos(np.abs(np.sum(rot[0] * rot[-1], axis=-1)).clip(0, 1))).max())
            if seam > 0.5 or np.abs(hips[0] - hips[-1]).max() > 0.002:
                msg.append("LOOP SEAM %.2f deg" % seam)
        if hips[:, 1].min() < 0.05:
            msg.append("HIPS LOW %.3f" % hips[:, 1].min())
        print("%-20s %5.2fs %3d f  %s" % (name, c["times"][-1], T, "; ".join(msg) if msg else "ok"))
        bad += bool(msg)
    print("%d clips, %d flagged" % (len(clips), bad))


if __name__ == "__main__":
    main(sys.argv[1])
