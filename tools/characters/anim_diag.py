"""Animation diagnostics: hand orientation / grip errors per frame for a clip (target vs solved), foot sliding."""
import sys
import numpy as np
from scipy.spatial.transform import Rotation as R

import anim as A
import motion as M


def hand_errors(rig, clip, S="L", frames=("chest", "chest")):
    F = A.FULL[S]
    out = []
    for (W, P), p in zip(clip["_poses"], clip["_params"]):
        q = p
        Cpos, Crot = P[A.IDX["Spine2"]], W[A.IDX["Spine2"]]
        fr = frames[0 if S == "L" else 1]
        f = np.asarray(q["h%s_f" % S], float)
        pal = np.asarray(q["h%s_p" % S], float)
        pos = np.asarray(q["h%s_pos" % S], float)
        if fr == "chest":
            f, pal, pos = Crot @ f, Crot @ pal, Cpos + Crot @ pos
        Rt = M._hand_rot(rig, S, f, pal)
        Wh = W[A.IDX[F + "Hand"]]
        ang = np.degrees(np.linalg.norm(R.from_matrix(Rt.T @ Wh).as_rotvec()))
        grip = P[A.IDX[F + "Hand"]] + Wh @ rig.hand[S]["grip_local"]
        out.append((ang, float(np.linalg.norm(grip - pos))))
    return np.array(out)


if __name__ == "__main__":
    import reanim
    cid, clipname = sys.argv[1], sys.argv[2]
    js, b = reanim.read_glb("C:/Dev/rideordie/public/models/characters/%s.glb" % cid)
    heads, bn = reanim.rest_heads(js)
    clips = A.build_clips(heads, only=[clipname], mesh=reanim.body_mesh(js, b), **reanim.ANIM_PARAMS.get(cid, {}))
    c = clips[clipname]
    rig = A.Rig(heads)
    for S in ("L", "R"):
        e = hand_errors(rig, c, S)
        print(S, "max ang %.1f deg at frame %d, max pos %.3f m" % (e[:, 0].max(), e[:, 0].argmax(), e[:, 1].max()))
        print("  ", " ".join("%.0f" % x for x in e[:, 0]))


def lowest_bones(rig, clip, every=6):
    """Per sampled frame: (time, lowest point y, bone that owns it) using the rig's mesh contact set."""
    import mh
    out = []
    for i in range(0, len(clip["times"]), every):
        W, P = clip["_poses"][i]
        rel = rig.m_pos[:, None, :] - rig.heads[rig.m_j]
        pts = np.einsum("vkij,vkj->vki", W[rig.m_j], rel) + P[rig.m_j]
        y = (pts[:, :, 1] * rig.m_w).sum(axis=1) + rig.m_off
        j = int(np.argmin(y))
        out.append((float(clip["times"][i]), float(y[j]), mh.BONE_NAMES[int(rig.m_j[j, 0])]))
    return out
