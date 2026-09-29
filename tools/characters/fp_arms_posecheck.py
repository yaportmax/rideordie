"""Where do the fingertips of an fp_arms pose land on a weapon?  (QA helper; numpy venv)

Prints every fingertip / knuckle in the WEAPON frame (G frame mm: +X forward, +Y left, +Z up, origin = grip_R) assuming the game's IK
puts socket_hand_R on grip_R and socket_hand_L on grip_L (identity orientations), as src/view/viewmodel.js does.
    python tools/characters/fp_arms_posecheck.py pose_pistol --gripL 14,15,4
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fp_arms_rig as RIG  # noqa: E402
from scipy.spatial.transform import Rotation as R  # noqa: E402


def tips(pose_name, gripL=(0, 0, 0), verbose=True):
    S = np.load(os.path.join(HERE, "_cache", "fp_arms", "stage1.npz"))
    rig = RIG.FpRig(S)
    socks = RIG.sockets(S)
    locs = rig.finger_locals(RIG.POSES[pose_name])
    W = rig.world(locs)
    out = {}
    for side, sk, grip in (("Right", "socket_hand_R", (0, 0, 0)), ("Left", "socket_hand_L", gripL)):
        pos, q = socks[sk]
        Rs = R.from_quat(q).as_matrix()                     # socket rotation relative to the hand bone (= model at rest)
        for f in RIG.FINGERS:
            for k, label in ((3, "tip"), (2, "mid")):
                b = "%sHand%s%d" % (side, f, k)
                Rw, Pw = W[b]
                if label == "tip":
                    d = rig.tips[side + f] - rig.H[b]
                    p = Pw + Rw @ d
                else:
                    p = Pw
                ps = Rs.T @ (p - pos)                        # socket frame = weapon glTF axes (x left, y up, z fwd), metres
                g = np.array([ps[2], ps[0], ps[1]]) * 1000.0 + np.asarray(grip, float)
                out[(side, f, label)] = g
                if verbose and label == "tip":
                    print("%-5s %-6s tip  x=%7.1f  y=%7.1f  z=%7.1f" % (side, f, g[0], g[1], g[2]))
    return out


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "pose_rifle"
    gl = (0, 0, 0)
    if "--gripL" in sys.argv:
        gl = tuple(float(v) for v in sys.argv[sys.argv.index("--gripL") + 1].split(","))
    tips(name, gl)
