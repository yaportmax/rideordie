"""Animation toolkit + clip library for the shared Mixamo-named rig (see mh.py / rig.py).

Conventions (game space): +X = character's LEFT, +Y up, +Z forward, metres, feet on y = 0.  Every bone has an
IDENTITY rest rotation, so a bone's world rotation at rest is I and a clip is just a list of local rotations
(parent-relative) + the Hips translation.  Clips are therefore shareable between characters of different
proportions.

Authoring model
---------------
A pose is a dict of PARAMETERS (see Rig.neutral()), not raw bone rotations:
    * hips position/rotation, three spine bones, neck, head, clavicles      (FK, rotvec degrees)
    * per hand: grip-point target + two direction vectors (finger direction, palm normal) + elbow pole,
      expressed in the CHEST frame (Spine2) or the WORLD frame (a per-clip choice)      (analytic 2-bone IK)
    * per hand: 5 finger curl values, spread                                            (FK)
    * per foot: ankle target in world + yaw/pitch/roll + knee pole + toe bend           (analytic 2-bone IK)
Clips are keyframed sets of parameters (PCHIP or periodic cubic interpolation) that are solved per frame
(Rig.solve), so feet stay planted and hands stay on the gun / wheel while the torso moves.

Public API used by the character builds:
    clips = build_clips(heads, bulk=1.0, mesh=None, foot_sole=0.0, seat=None)
        -> {name: dict(times (T,), rot (T,B,4) local quaternions xyzw in mh.BONE_NAMES order, hips_t (T,3) Hips node
            translation (world, root at the floor), loop, note)}   (also keeps _poses/_params for debugging)
        heads: (B,3) rest bone heads in game space (B.Char(spec).heads_final).
        mesh=(pos, joints, weights) of the skinned character gives exact ground contact for death_fall.
    sock_pos, sock_rot = socket_frames(heads, clips)      -> pass to rig.add_skeleton(glb, heads, sock_pos, sock_rot)
    write_clips(glb, bone_nodes, clips)                   -> adds the glTF animations to a glb.Glb

Clip semantics (all 30 fps; loop clips have T*30+1 frames, last == first, so they repeat seamlessly):
    idle_stand 3.3 s loop | idle_sit_drive 3.0 s loop | sit_lean_L / _R 1.5 s loops holding the full lean (L = +X) |
    flinch_a 0.67 s, flinch_b 0.73 s (start and end exactly on idle_stand frame 0) | throw_grenade 1.0 s (release at 0.55 s,
    starts/ends on idle_stand frame 0) | celebrate 2.2 s one-shot (ends on idle_stand frame 0) | crouch_idle 3.0 s loop |
    death_fall 1.2 s (lands ~0.72 s, ends lying on its back, head toward -Z, Hips translation keeps the body on the floor) |
    pose_pistol / pose_rifle / pose_launcher: ONE frame at t = 0 (arms matter; feet/torso in a bladed stance).
"""
import copy

import numpy as np
from scipy.interpolate import CubicSpline, PchipInterpolator
from scipy.spatial.transform import Rotation as R

import mh

NB = len(mh.BONE_NAMES)
IDX = mh.BONE_INDEX
PAR = mh.PARENTS
FPS = 30.0
SIDES = ("L", "R")
FULL = {"L": "Left", "R": "Right"}


# ------------------------------------------------------------------------------------------------
# small math helpers
# ------------------------------------------------------------------------------------------------

def unit(v, fallback=(0.0, 0.0, 1.0)):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else np.asarray(fallback, float)


def rvm(deg):
    """Rotation matrix from a rotation vector in degrees."""
    return R.from_rotvec(np.radians(np.asarray(deg, float))).as_matrix()


def rv(pitch=0.0, twist=0.0, lean=0.0):
    """Rotation vector (deg) in natural terms for an upright bone: pitch = bend forward (+Z), twist = turn toward the
    character's left (+X), lean = tilt toward the character's left."""
    return np.array([pitch, twist, -lean], float)


def frame(d, n):
    """Orthonormal frame [e1 = d, e2 = n made perpendicular to d, e3 = e1 x e2] as matrix columns."""
    e1 = unit(d)
    e2 = np.asarray(n, float) - e1 * np.dot(e1, n)
    e2 = unit(e2, fallback=np.cross(e1, (0.0, 0.0, 1.0)) if abs(e1[2]) < 0.9 else np.cross(e1, (1.0, 0.0, 0.0)))
    e3 = np.cross(e1, e2)
    return np.stack([e1, e2, e3], axis=1)


def rot_axis(axis, ang):
    return R.from_rotvec(unit(axis) * ang).as_matrix()


# ------------------------------------------------------------------------------------------------
# the rig: rest data, IK, pose solving
# ------------------------------------------------------------------------------------------------

class Rig:
    def __init__(self, heads):
        self.heads = np.asarray(heads, float)
        H = self.heads
        self.off = np.zeros((NB, 3))
        for b in range(NB):
            self.off[b] = H[b] if PAR[b] < 0 else H[b] - H[PAR[b]]
        h = lambda n: H[IDX[n]]
        self.h = h
        self.hips_y = float(h("Hips")[1])
        self.ankle_h = float(h("LeftFoot")[1])
        # a size factor relative to the 1.82 m reference body
        self.k = float((h("Head")[1] - h("Hips")[1]) / 0.702)
        self.shoulder_w = float(h("LeftArm")[0] - h("RightArm")[0]) / 2.0
        self.arm = {}
        for S in SIDES:
            F = FULL[S]
            root, mid, end = h(F + "Arm"), h(F + "ForeArm"), h(F + "Hand")
            self.arm[S] = self._limb_rest(root, mid, end, None)
            root, mid, end = h(F + "UpLeg"), h(F + "Leg"), h(F + "Foot")
            self.arm["leg" + S] = self._limb_rest(root, mid, end, (0.0, 0.0, 1.0))
        # hands: finger direction, palm normal at rest, grip point
        self.hand = {}
        for S in SIDES:
            F = FULL[S]
            w = h(F + "Hand")
            m1 = h(F + "HandMiddle1")
            d0 = unit(m1 - w)
            lat = unit(h(F + "HandPinky1") - h(F + "HandIndex1"))
            dorsal = np.cross(d0, lat) * (1.0 if S == "L" else -1.0)
            palm = unit(-dorsal)
            palm = unit(palm - d0 * np.dot(palm, d0))
            knuckle_c = np.mean([h(F + "Hand" + f + "1") for f in ("Index", "Middle", "Ring", "Pinky")], axis=0)
            # grip centre: over the palm, 60% of the way to the knuckles, half a fist radius into the palm normal
            grip_local = 0.55 * (knuckle_c - w) + palm * 0.022 * self.k
            self.hand[S] = dict(d0=d0, palm0=palm, lat0=lat, grip_local=grip_local, m1=m1 - w)
        # finger hinge axes (curl toward the palm)
        self.finger = {}
        for S in SIDES:
            F = FULL[S]
            for fname, _ in mh.FINGERS:
                names = ["%sHand%s%d" % (F, fname, k) for k in (1, 2, 3)]
                p = [h(n) for n in names]
                d1, d2 = unit(p[1] - p[0]), unit(p[2] - p[1])
                dorsal = -self.hand[S]["palm0"]
                axis = unit(np.cross(dorsal, (d1 + d2)))
                self.finger[(S, fname)] = dict(bones=[IDX[n] for n in names], axis=axis)
        # collision spheres used for ground contact: (bone, offset toward child fraction, radius)
        k = self.k
        self.contact = [("Head", None, 0.10 * k), ("Neck", None, 0.06 * k), ("Spine2", None, 0.14 * k), ("Spine1", None, 0.14 * k),
                        ("Spine", None, 0.13 * k), ("Hips", None, 0.14 * k)]
        for F in ("Left", "Right"):
            # feet: radius = rest height of the sphere centre, so that the soles (boots included) touch y = 0 at rest
            foot_mid_y = 0.5 * (h(F + "Foot")[1] + h(F + "ToeBase")[1])
            self.contact += [(F + "UpLeg", F + "Leg", 0.09 * k), (F + "Leg", F + "Foot", 0.06 * k), (F + "Foot", F + "ToeBase", float(foot_mid_y)),
                             (F + "ToeBase", None, float(h(F + "ToeBase")[1])), (F + "Arm", F + "ForeArm", 0.05 * k),
                             (F + "ForeArm", F + "Hand", 0.045 * k), (F + "Hand", None, 0.04 * k)]

    # -- rest helpers ----------------------------------------------------------------------------
    def _limb_rest(self, root, mid, end, pole_hint):
        c0 = unit(end - root)
        pole = (mid - root) - c0 * np.dot(mid - root, c0)
        if np.linalg.norm(pole) < 0.006 or pole_hint is not None:
            if pole_hint is not None:
                pole = np.asarray(pole_hint, float) - c0 * np.dot(pole_hint, c0)
        pole = unit(pole)
        return dict(l1=float(np.linalg.norm(mid - root)), l2=float(np.linalg.norm(end - mid)), N0=unit(np.cross(c0, pole)),
                    d0u=unit(mid - root), d0f=unit(end - mid), pole0=pole)

    # -- parameters ------------------------------------------------------------------------------
    def neutral(self):
        """Parameter set that reproduces the rest (A) pose (world-frame hands)."""
        p = dict(hips_pos=self.heads[0].copy(), hips_rot=np.zeros(3), sp0=np.zeros(3), sp1=np.zeros(3), sp2=np.zeros(3),
                 neck=np.zeros(3), head=np.zeros(3), shr_L=np.zeros(3), shr_R=np.zeros(3))
        for S in SIDES:
            F = FULL[S]
            hd = self.hand[S]
            p["h%s_pos" % S] = self.heads[IDX[F + "Hand"]] + hd["grip_local"]
            p["h%s_f" % S] = hd["d0"].copy()
            p["h%s_p" % S] = hd["palm0"].copy()
            p["h%s_pole" % S] = self.arm[S]["pole0"].copy()
            p["fg%s" % S] = np.zeros(5)
            p["fs%s" % S] = np.zeros(1)
            p["f%s_pos" % S] = self.heads[IDX[F + "Foot"]].copy()
            p["f%s_yaw" % S] = np.zeros(1)
            p["f%s_pitch" % S] = np.zeros(1)
            p["f%s_roll" % S] = np.zeros(1)
            p["k%s_pole" % S] = np.array([0.0, 0.0, 1.0])
            p["toe%s" % S] = np.zeros(1)
        return p

    # -- IK --------------------------------------------------------------------------------------
    @staticmethod
    def two_bone(root, target, l1, l2, pole):
        chord = target - root
        d = np.linalg.norm(chord)
        dmax = (l1 + l2) * 0.9999
        dmin = abs(l1 - l2) * 1.001 + 1e-4
        dc = min(max(d, dmin), dmax)
        c = chord / d if d > 1e-9 else np.array([0.0, -1.0, 0.0])
        a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc)
        hgt = np.sqrt(max(l1 * l1 - a * a, 0.0))
        pp = pole - c * np.dot(c, pole)
        if np.linalg.norm(pp) < 1e-6:
            pp = np.cross(c, (1.0, 0.0, 0.0))
        pp = unit(pp)
        mid = root + c * a + pp * hgt
        return mid, root + c * dc, c, pp

    def _limb(self, key, root, target, pole):
        r = self.arm[key]
        mid, end, c, pp = self.two_bone(root, target, r["l1"], r["l2"], pole)
        N = unit(np.cross(c, pp))
        u, f = unit(mid - root), unit(end - mid)
        Wu = frame(u, N) @ frame(r["d0u"], r["N0"]).T
        Wf = frame(f, N) @ frame(r["d0f"], r["N0"]).T
        return Wu, Wf

    # -- the solver ------------------------------------------------------------------------------
    def torso(self, p):
        """FK of hips -> spine -> neck -> head only.  Returns (W, P); other bones are left at identity/zero."""
        W = np.tile(np.eye(3), (NB, 1, 1))
        P = np.zeros((NB, 3))
        W[0] = rvm(p["hips_rot"])
        P[0] = np.asarray(p["hips_pos"], float)
        for name, key in (("Spine", "sp0"), ("Spine1", "sp1"), ("Spine2", "sp2"), ("Neck", "neck"), ("Head", "head")):
            b = IDX[name]
            par = PAR[b]
            W[b] = W[par] @ rvm(p[key])
            P[b] = P[par] + W[par] @ self.off[b]
        return W, P

    def chest(self, p):
        W, P = self.torso(p)
        return P[IDX["Spine2"]].copy(), W[IDX["Spine2"]].copy()

    def solve(self, p, frames=("chest", "chest"), auto_shoulder=True):
        """Parameters -> (W (B,3,3) world rotations, P (B,3) world positions)."""
        W, P = self.torso(p)
        H = IDX
        Cpos, Crot = P[H["Spine2"]], W[H["Spine2"]]
        fr = dict(zip(SIDES, frames))

        def to_world(S, v, is_point):
            if fr[S] == "world":
                return np.asarray(v, float)
            return Crot @ np.asarray(v, float) + (Cpos if is_point else 0.0)

        # clavicles (auto raise/protract with the reach + user offset), then arms
        for S in SIDES:
            F = FULL[S]
            sgn = 1.0 if S == "L" else -1.0
            tgt = to_world(S, p["h%s_pos" % S], True)
            rel = Crot.T @ (tgt - Cpos)
            up = np.clip((rel[1] + 0.15 * self.k) / (0.45 * self.k), 0.0, 1.0)
            fwd = np.clip((rel[2] - 0.15 * self.k) / (0.45 * self.k), 0.0, 1.0)
            shr = np.zeros(3)
            if auto_shoulder:
                # +Z raises the left clavicle tip (-Z the right); protraction (tip forward) is -Y for left, +Y for right
                shr = np.array([0.0, -sgn * 9.0 * fwd, sgn * 18.0 * up])
            shr = shr + p["shr_" + S]
            b = H[F + "Shoulder"]
            W[b] = W[H["Spine2"]] @ rvm(shr)
            P[b] = P[H["Spine2"]] + W[H["Spine2"]] @ self.off[b]
            a = H[F + "Arm"]
            P[a] = P[b] + W[b] @ self.off[a]
            # hand orientation and wrist target
            hd = self.hand[S]
            fdir = to_world(S, p["h%s_f" % S], False)
            pal = to_world(S, p["h%s_p" % S], False)
            Rh = frame(fdir, pal) @ frame(hd["d0"], hd["palm0"]).T
            pole = to_world(S, p["h%s_pole" % S], False)
            for _ in range(8):
                # the wrist can only bend so far: if the wanted hand direction is too far from the forearm's, turn the
                # hand toward the forearm (the grip point stays on target, the wrist target is recomputed)
                wrist = tgt - Rh @ hd["grip_local"]
                Wu, Wf = self._limb(S, P[a], wrist, pole)
                fa_dir = Wf @ self.arm[S]["d0f"]
                h_dir = Rh @ hd["d0"]
                ang = np.arccos(np.clip(np.dot(fa_dir, h_dir), -1.0, 1.0))
                if ang <= self.WRIST_MAX:
                    break
                ax_w = unit(np.cross(h_dir, fa_dir))
                Rh = rot_axis(ax_w, ang - self.WRIST_MAX) @ Rh
            wrist = tgt - Rh @ hd["grip_local"]
            Wu, Wf = self._limb(S, P[a], wrist, pole)
            fa_dir = Wf @ self.arm[S]["d0f"]
            h_dir = Rh @ hd["d0"]
            ang = np.arccos(np.clip(np.dot(fa_dir, h_dir), -1.0, 1.0))
            if ang > self.WRIST_MAX + 1e-3:       # did not converge (folded arm): give up the exact grip point, keep the limit
                Rh = rot_axis(unit(np.cross(h_dir, fa_dir)), ang - self.WRIST_MAX) @ Rh
            # give the forearm half of the hand's twist about its own axis (softens the wrist candy-wrapper)
            ax = self.arm[S]["d0f"]
            rel_r = (Wf.T @ Rh)
            tw = self._twist(rel_r, ax)
            Wf = Wf @ rot_axis(ax, 0.5 * tw)
            W[a] = Wu
            fa = H[F + "ForeArm"]
            W[fa] = Wf
            P[fa] = P[a] + Wu @ self.off[fa]
            hb = H[F + "Hand"]
            W[hb] = Rh
            P[hb] = P[fa] + Wf @ self.off[hb]
            self._fingers(W, P, S, p["fg" + S], float(p["fs" + S][0]))
        # legs
        for S in SIDES:
            F = FULL[S]
            u = H[F + "UpLeg"]
            P[u] = P[0] + W[0] @ self.off[u]
            Wu, Wl = self._limb("leg" + S, P[u], np.asarray(p["f%s_pos" % S], float), np.asarray(p["k%s_pole" % S], float))
            W[u] = Wu
            l = H[F + "Leg"]
            W[l] = Wl
            P[l] = P[u] + Wu @ self.off[l]
            f = H[F + "Foot"]
            W[f] = (rot_axis((0, 1, 0), np.radians(p["f%s_yaw" % S][0])) @ rot_axis((1, 0, 0), np.radians(p["f%s_pitch" % S][0]))
                    @ rot_axis((0, 0, 1), np.radians(p["f%s_roll" % S][0])))
            P[f] = P[l] + Wl @ self.off[f]
            t = H[F + "ToeBase"]
            W[t] = W[f] @ rot_axis((1, 0, 0), np.radians(p["toe" + S][0]))
            P[t] = P[f] + W[f] @ self.off[t]
        return W, P

    @staticmethod
    def _twist(Rrel, axis):
        """Twist angle of rotation matrix Rrel about `axis` (swing-twist decomposition)."""
        q = R.from_matrix(Rrel).as_quat()      # x y z w
        proj = np.dot(q[:3], axis) * np.asarray(axis)
        tq = np.array([proj[0], proj[1], proj[2], q[3]])
        n = np.linalg.norm(tq)
        if n < 1e-9:
            return 0.0
        tq /= n
        ang = 2.0 * np.arctan2(np.dot(tq[:3], axis), tq[3])
        return float((ang + np.pi) % (2 * np.pi) - np.pi)

    WRIST_MAX = np.radians(58.0)     # max angle between the forearm axis and the hand axis

    FINGER_MAX = {"Thumb": (0.5, 0.9, 0.9), "Index": (1.45, 1.75, 1.15), "Middle": (1.5, 1.8, 1.15),
                  "Ring": (1.5, 1.8, 1.15), "Pinky": (1.5, 1.8, 1.1)}

    def _fingers(self, W, P, S, curls, spread):
        F = FULL[S]
        hb = IDX[F + "Hand"]
        sgn = 1.0 if S == "L" else -1.0
        for fi, (fname, _) in enumerate(mh.FINGERS):
            fd = self.finger[(S, fname)]
            axis = fd["axis"]
            prev = hb
            for k, b in enumerate(fd["bones"]):
                c = float(curls[fi])
                ang = self.FINGER_MAX[fname][k] * c
                Rl = rot_axis(axis, ang)
                if k == 0:
                    # spread: fan the fingers about the palm normal; thumb also swings across the palm as it curls
                    pn = self.hand[S]["palm0"]
                    if fname == "Thumb":
                        Rl = rot_axis(pn, -sgn * 0.0) @ Rl
                    else:
                        Rl = rot_axis(pn, sgn * spread * (fi - 2.5) * 0.18) @ Rl
                W[b] = W[prev] @ Rl
                P[b] = P[prev] + W[prev] @ self.off[b]
                prev = b

    def local_from_world(self, W):
        L = np.empty_like(W)
        for b in range(NB):
            L[b] = W[b] if PAR[b] < 0 else W[PAR[b]].T @ W[b]
        return L

    # -- ground contact --------------------------------------------------------------------------
    def set_mesh(self, pos, joints, weights, foot_sole=0.0, max_verts=3000):
        """Use the real skinned mesh for ground contact (exact).  pos (V,3) rest positions in game space, joints (V,4) bone
        indices, weights (V,4).  Pass EVERY vertex of the character incl. boots (foot_sole=0), or the bare body with
        foot_sole = thickness of the boot soles that the body mesh floats above y=0 (feet vertices are lowered by it)."""
        step = max(1, len(pos) // max_verts)
        self.m_pos = np.asarray(pos, float)[::step]
        self.m_j = np.asarray(joints).astype(int)[::step]
        self.m_w = np.asarray(weights, float)[::step]
        feet = [IDX[n] for n in ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase")]
        self.m_off = np.where(np.isin(self.m_j[:, 0], feet), -float(foot_sole), 0.0)

    m_pos = None

    def lowest(self, W, P):
        """Lowest point of the body (world y): the real mesh if set_mesh() was called, else collision spheres."""
        if self.m_pos is not None:
            rel = self.m_pos[:, None, :] - self.heads[self.m_j]
            out = np.einsum("vkij,vkj->vki", W[self.m_j], rel) + P[self.m_j]
            y = (out[:, :, 1] * self.m_w).sum(axis=1) + self.m_off
            return float(y.min())
        lo = 1e9
        for bone, child, r in self.contact:
            b = IDX[bone]
            c = P[b] if child is None else 0.5 * (P[b] + P[IDX[child]])
            if child is None and bone in ("Head",):
                c = P[b] + W[b] @ np.array([0.0, 0.09 * self.k, 0.0])
            lo = min(lo, c[1] - r)
        return lo


# ------------------------------------------------------------------------------------------------
# keyframes -> per-frame parameters
# ------------------------------------------------------------------------------------------------

def _flatten(p, keys):
    return np.concatenate([np.asarray(p[k], float).ravel() for k in keys])


def _unflatten(vec, template, keys):
    out, i = {}, 0
    for k in keys:
        n = np.asarray(template[k]).size
        out[k] = vec[i:i + n].reshape(np.asarray(template[k]).shape).copy()
        i += n
    return out


class Track:
    """Keyframed parameter set. key(t, **overrides) copies the previous key and overrides values."""

    def __init__(self, base):
        self.base = copy.deepcopy(base)
        self.keys = sorted(base.keys())
        self.times, self.vals = [], []

    def key(self, t, **over):
        prev = self.vals[-1] if self.vals else self.base
        p = copy.deepcopy(prev)
        for k, v in over.items():
            if k not in p:
                raise KeyError(k)
            p[k] = np.array(v, float).reshape(np.asarray(p[k]).shape)
        self.times.append(float(t))
        self.vals.append(p)
        return p

    def sample(self, times, loop=False, smooth="pchip"):
        ts = np.array(self.times)
        Y = np.array([_flatten(v, self.keys) for v in self.vals])
        if len(ts) == 1:
            return [copy.deepcopy(self.vals[0]) for _ in times]
        if loop:
            Y = Y.copy()
            Y[-1] = Y[0]
            f = CubicSpline(ts, Y, bc_type="periodic", axis=0)
        elif len(ts) > 2 and smooth == "pchip":
            f = PchipInterpolator(ts, Y, axis=0)
        else:
            f = CubicSpline(ts, Y, bc_type="clamped", axis=0) if len(ts) > 2 else (lambda t: np.array([np.interp(t, ts, Y[:, j]) for j in range(Y.shape[1])]).T)
        out = f(np.clip(times, ts[0], ts[-1]))
        return [_unflatten(o, self.base, self.keys) for o in out]


def breathing(p, t, T, amp=1.0, sway=1.0, seed=0):
    """Add seamless procedural micro-motion (integer cycles per T) to a parameter dict.  The offset is zero at t = 0
    (and t = T), so frame 0 of a loop equals the authored base pose exactly."""
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 2 * np.pi, 8)

    def deltas(tt):
        w = 2 * np.pi * tt / T
        b = np.sin(w * 1 + ph[0])                   # breath (one cycle per loop)
        b2 = np.sin(w * 2 + ph[1])
        s1 = np.sin(w * 1 + ph[2])
        s2 = np.sin(w * 2 + ph[3])
        return dict(
            sp2=np.array([1.1 * b * amp, 0.0, 0.0]),
            sp1=np.array([0.5 * b * amp, 0.6 * s1 * sway, 0.5 * s2 * sway]),
            sp0=np.array([0.0, 0.4 * s2 * sway, 0.7 * s1 * sway]),
            neck=np.array([-0.6 * b * amp + 0.5 * b2 * sway, 0.5 * s2 * sway, 0.3 * s1 * sway]),
            head=np.array([0.4 * b2 * sway, 0.8 * s1 * sway, 0.0]),
            shr_L=np.array([0, 0, 0.9 * b * amp]),
            shr_R=np.array([0, 0, -0.9 * b * amp]),
            hips_pos=np.array([0.006 * s1 * sway, 0.004 * b * amp + 0.003 * s2 * sway, 0.004 * s2 * sway]),
            hips_rot=np.array([0.3 * s2 * sway, 0.5 * s1 * sway, 0.6 * s2 * sway]))
    d, d0 = deltas(t), deltas(0.0)
    for k in d:
        p[k] = np.asarray(p[k], float) + d[k] - d0[k]
    return p


# ------------------------------------------------------------------------------------------------
# rendering helper for quick looks (stick figure)
# ------------------------------------------------------------------------------------------------

def stick_figure(rig, W, P, path, size=420, views=("front", "side", "top")):
    from PIL import Image, ImageDraw
    imgs = []
    for view in views:
        im = Image.new("RGB", (size, size), (24, 26, 30))
        d = ImageDraw.Draw(im)
        if view == "front":
            proj = lambda q: (q[0] * -1, q[1])          # x flipped so character's left is on the right of the picture
            cx, cy, sc = 0.0, 0.95, size / 2.1
        elif view == "side":
            proj = lambda q: (q[2], q[1])
            cx, cy, sc = 0.15, 0.95, size / 2.1
        else:
            proj = lambda q: (-q[0], -q[2])
            cx, cy, sc = 0.0, 0.1, size / 2.1
        tf = lambda q: (size / 2 + (proj(q)[0] - cx) * sc, size / 2 - (proj(q)[1] - cy) * sc)
        for b in range(NB):
            p_ = PAR[b]
            if p_ >= 0:
                name = mh.BONE_NAMES[b]
                col = (240, 120, 90) if name.startswith("Left") else (90, 160, 240) if name.startswith("Right") else (230, 230, 230)
                d.line([tf(P[p_]), tf(P[b])], fill=col, width=2)
        d.line([tf((-1, 0, 0)), tf((1, 0, 0))] if view != "side" else [tf((0, 0, -1)), tf((0, 0, 1))], fill=(70, 70, 70)) if view != "top" else None
        imgs.append(im)
    sheet = Image.new("RGB", (size * len(imgs), size))
    for i, im in enumerate(imgs):
        sheet.paste(im, (i * size, 0))
    sheet.save(path)


# ------------------------------------------------------------------------------------------------
# baking parameters -> clip arrays
# ------------------------------------------------------------------------------------------------

def add(p, **d):
    """Copy of p with the given deltas ADDED to the named parameters."""
    q = copy.deepcopy(p)
    for k, v in d.items():
        q[k] = np.asarray(q[k], float) + np.asarray(v, float).reshape(np.asarray(q[k]).shape)
    return q


def setp(p, **d):
    q = copy.deepcopy(p)
    for k, v in d.items():
        q[k] = np.asarray(v, float).reshape(np.asarray(q[k]).shape)
    return q


def bake(rig, track, T, loop, frames=("chest", "chest"), extra=None, ground=False, note="", ground_from=0.0):
    """Sample a Track at 30 fps over T seconds and solve every frame.  Loop clips get T*30+1 frames (last == first) so
    three.js loops them seamlessly.  ground=True keeps the lowest collision sphere on y = 0 (falls)."""
    n = int(round(T * FPS))
    times = np.arange(n + 1) / FPS
    params = track.sample(times, loop=loop)
    ground0 = 0.0
    Ls, hips, poses = [], [], []
    for t, p in zip(times, params):
        if extra is not None:
            p = extra(p, float(t))
        W, P = rig.solve(p, frames)
        if ground:
            # ground = True: clamp (never below the floor) and, from ground_from on, stick (always touching it)
            low = rig.lowest(W, P) - ground0
            if low < 0.0 or t >= ground_from:
                p = copy.deepcopy(p)
                p["hips_pos"] = np.asarray(p["hips_pos"]) + np.array([0.0, -low, 0.0])
                W, P = rig.solve(p, frames)
        Ls.append(rig.local_from_world(W))
        hips.append(P[0].copy())
        poses.append((W, P))
    Ls = np.array(Ls)
    q = R.from_matrix(Ls.reshape(-1, 3, 3)).as_quat().reshape(len(times), NB, 4)
    for t in range(1, len(q)):                       # keep one hemisphere so LINEAR interpolation is safe
        dots = np.sum(q[t] * q[t - 1], axis=-1)
        q[t][dots < 0] *= -1.0
    return dict(times=times, rot=q, hips_t=np.array(hips), loop=loop, note=note, _poses=poses, _params=params)


# ------------------------------------------------------------------------------------------------
# finger presets  (thumb, index, middle, ring, pinky curl 0..1)
# ------------------------------------------------------------------------------------------------
GRIP = {
    "relax": [0.25, 0.25, 0.3, 0.35, 0.4],
    "open": [0.05, 0.05, 0.05, 0.05, 0.05],
    "fist": [0.9, 1.0, 1.0, 1.0, 1.0],
    "rifle_R": [0.55, 0.45, 0.85, 0.9, 0.95],       # pistol grip, trigger finger lightly curled
    "rifle_L": [0.6, 0.8, 0.85, 0.85, 0.85],        # C-grip under the handguard
    "pistol_R": [0.5, 0.4, 0.85, 0.9, 0.9],
    "pistol_L": [0.7, 0.75, 0.75, 0.75, 0.75],
    "wheel": [0.55, 0.75, 0.8, 0.8, 0.8],
    "launcher_L": [0.6, 0.8, 0.85, 0.85, 0.85],
    "throw": [0.6, 0.55, 0.7, 0.75, 0.8],
}


def V(x, y, z):
    return np.array([x, y, z], float)


def S1(x):
    return np.array([float(x)])


# ------------------------------------------------------------------------------------------------
# the standard stances
# ------------------------------------------------------------------------------------------------

def ready_stance(rig, bulk=1.0):
    """Braced wide stance, rifle held low at the chest (neutral generic pose for the game's own IK on top).
    bulk > 1 widens the stance and pushes hands/elbows outward for thick torsos (e.g. 1.25 for a heavy)."""
    k = rig.k
    p = rig.neutral()
    # feet: wide, staggered (left foot forward), toes out
    p["fL_pos"] = V(0.27 * k, rig.ankle_h, 0.12 * k)
    p["fR_pos"] = V(-0.27 * k, rig.ankle_h, -0.10 * k)
    p["fL_yaw"], p["fR_yaw"] = S1(12), S1(-22)
    p["kL_pole"], p["kR_pole"] = unit([0.30, 0.0, 1.0]), unit([-0.30, 0.0, 1.0])
    # torso: slight forward lean, head level
    p["hips_rot"] = rv(pitch=3)
    p["sp0"], p["sp1"], p["sp2"] = rv(2), rv(3), rv(3)
    p["neck"], p["head"] = rv(-4), rv(-6)
    p["hips_pos"] = V(0.0, rig.hips_y - 0.075 * k, rig.heads[0][2] - 0.02 * k)
    # arms: right hand on the pistol grip beside the lower chest, left cupping the handguard ahead
    p["hR_pos"] = V(-0.12, -0.12, 0.26) * k
    p["hR_f"] = unit([-0.02, -0.28, 1.0])
    p["hR_p"] = unit([1.0, 0.20, 0.10])
    p["hR_pole"] = unit([-0.5, -1.0, -0.45])
    p["hL_pos"] = V(0.03, -0.05, 0.50) * k
    p["hL_f"] = unit([-0.85, 0.15, 0.40])
    p["hL_p"] = unit([0.10, 1.0, 0.15])
    p["hL_pole"] = unit([0.5, -1.0, -0.3])
    p["fgR"] = np.array(GRIP["rifle_R"])
    p["fgL"] = np.array(GRIP["rifle_L"])
    if bulk != 1.0:
        for key in ("fL_pos", "fR_pos"):
            p[key][0] *= bulk
        for key in ("hR_pos", "hL_pos", "hR_pole", "hL_pole"):
            p[key][0] *= bulk
        p["hR_pos"][2] += 0.03 * (bulk - 1.0)
        p["hL_pos"][2] += 0.03 * (bulk - 1.0)
    return p


def sit_geometry(rig, hip_height=0.56, wheel_up=0.36, wheel_fwd=0.44, tilt_deg=25.0, rad=0.19):
    """Seat + steering wheel geometry in character space, with the character's root on the floor plane directly below the
    hip point (x = z = 0 at the hip joints).  Defaults follow the car assets (e_sedan / e_van: steering_wheel = hip point
    + (0, 0.33..0.37, 0.43..0.46), column tilted 24 deg).  All values are ABSOLUTE metres (vehicles do not scale)."""
    hj = hip_height
    wc = V(0.0, hj + wheel_up, wheel_fwd)            # wheel centre
    tilt = np.radians(tilt_deg)
    n_w = V(0.0, np.sin(tilt), -np.cos(tilt))        # wheel face normal, toward the driver
    u_w = V(0.0, np.cos(tilt), np.sin(tilt))         # in-plane "12 o'clock"
    r_w = V(-1.0, 0.0, 0.0)                          # in-plane driver's right
    return dict(hj=hj, wc=wc, n_w=n_w, u_w=u_w, r_w=r_w, rad=rad)


def wheel_hand(g, S, phi_deg):
    """Grip point/orientation for a hand at clock angle phi (deg, 0 = 12 o'clock, + = clockwise seen by the driver)."""
    phi = np.radians(phi_deg)
    radial = np.cos(phi) * g["u_w"] + np.sin(phi) * g["r_w"]
    pos = g["wc"] + g["rad"] * radial
    f = -g["n_w"]
    pal = -radial
    return pos, unit(f), unit(pal)


def sit_base(rig, g=None):
    k = rig.k
    g = g or sit_geometry(rig)
    p = rig.neutral()
    p["hips_rot"] = rv(pitch=-7)
    p["sp0"], p["sp1"], p["sp2"] = rv(3), rv(2), rv(1)
    p["neck"], p["head"] = rv(4), rv(5)
    # pelvis so the mean hip-joint sits at (0, hj, 0)
    hipmid = 0.5 * (rig.off[IDX["LeftUpLeg"]] + rig.off[IDX["RightUpLeg"]])
    p["hips_pos"] = V(0.0, g["hj"], -0.004) - rvm(p["hips_rot"]) @ hipmid
    # legs: thighs ~horizontal, right foot on the throttle, left flat on the floor
    p["fL_pos"] = V(0.12 * k, rig.ankle_h, 0.40 * k)
    p["fR_pos"] = V(-0.10 * k, rig.ankle_h + 0.05, 0.44 * k)
    p["fL_yaw"], p["fR_yaw"] = S1(6), S1(-4)
    p["fR_pitch"] = S1(16)
    p["kL_pole"], p["kR_pole"] = unit([0.22, 0.0, 1.0]), unit([-0.22, 0.0, 1.0])
    p["toeR"] = S1(4)
    for S, phi in (("L", -60.0), ("R", 60.0)):
        pos, f, pal = wheel_hand(g, S, phi)
        p["h%s_pos" % S], p["h%s_f" % S], p["h%s_p" % S] = pos, f, pal
        p["h%s_pole" % S] = unit([0.55 if S == "L" else -0.55, -1.0, -0.3])
        p["fg" + S] = np.array(GRIP["wheel"])
    return p, g


def sit_set_wheel(p, g, steer_deg, jitter=(0.0, 0.0)):
    """Rotate both hands around the wheel centre (deg, + = clockwise = a right turn)."""
    p = copy.deepcopy(p)
    for S, phi, j in (("L", -60.0, jitter[0]), ("R", 60.0, jitter[1])):
        pos, f, pal = wheel_hand(g, S, phi + steer_deg + j)
        p["h%s_pos" % S], p["h%s_f" % S], p["h%s_p" % S] = pos, f, pal
    return p


# ------------------------------------------------------------------------------------------------
# aiming helper poses (hands placed in WORLD space and converted to the chest frame)
# ------------------------------------------------------------------------------------------------

def world_to_chest(rig, p, points=(), dirs=()):
    Cpos, Crot = rig.chest(p)
    return [Crot.T @ (np.asarray(q, float) - Cpos) for q in points], [Crot.T @ np.asarray(d, float) for d in dirs]


def shoulder_world(rig, p, S):
    W, P = rig.solve(p, frames=("chest", "chest"))
    return P[IDX[FULL[S] + "Arm"]]


def aim_pose(rig, base, kind):
    """One-frame weapon poses: 'pistol', 'rifle', 'launcher'.  Weapon axis = world +Z (muzzle), +Y up."""
    k = rig.k
    p = copy.deepcopy(base)
    # bladed stance: chest a little turned to the right, head looks along the barrel
    p["hips_rot"] = rv(pitch=2, twist=-6)
    p["sp0"], p["sp1"], p["sp2"] = rv(2, -4), rv(2, -6), rv(1, -6)
    p["neck"], p["head"] = rv(-2, 12), rv(3, 4, lean=-3)
    shR = shoulder_world(rig, p, "R")
    if kind == "rifle":
        axis_y = shR[1] + 0.105 * k
        ax = -0.085
        pad = V(ax - 0.03, axis_y - 0.05 * k, shR[2] + 0.075)
        rp = V(ax, axis_y - 0.095 * k, pad[2] + 0.25 * k)         # right hand: pistol grip
        lp = V(ax + 0.01, axis_y - 0.055 * k, pad[2] + 0.53 * k)  # left hand: handguard
        fR, pR = unit([0.0, -0.22, 1.0]), unit([1.0, 0.25, 0.08])
        fL, pL = unit([-0.85, 0.05, 0.45]), unit([0.12, 1.0, 0.0])
        gR, gL = GRIP["rifle_R"], GRIP["rifle_L"]
        poleR, poleL = V(-0.6, -1.0, -0.2), V(0.35, -1.0, -0.1)
    elif kind == "pistol":
        axis_y = 0.5 * (shR[1] + rig.h("Head")[1]) + 0.045 * k + 0.02
        rp = V(-0.045, axis_y - 0.02, 0.55 * k)
        lp = V(-0.005, axis_y - 0.045, 0.56 * k)
        fR, pR = unit([0.0, -0.2, 1.0]), unit([1.0, 0.25, 0.10])
        fL, pL = unit([-0.4, -0.15, 1.0]), unit([-1.0, 0.1, 0.15])
        gR, gL = GRIP["pistol_R"], GRIP["pistol_L"]
        poleR, poleL = V(-0.4, -1.0, 0.0), V(0.4, -1.0, 0.0)
    else:  # launcher
        axis_y = shR[1] + 0.13 * k
        ax = -0.14
        rp = V(ax + 0.02, axis_y - 0.075 * k, shR[2] + 0.19 * k)  # rear grip under the tube, near the cheek
        lp = V(ax + 0.13, axis_y - 0.085 * k, shR[2] + 0.50 * k)  # front grip under the tube
        fR, pR = unit([0.0, -0.22, 1.0]), unit([1.0, 0.25, 0.05])
        fL, pL = unit([-0.8, -0.1, 0.5]), unit([0.2, 1.0, 0.0])
        gR, gL = GRIP["rifle_R"], GRIP["launcher_L"]
        poleR, poleL = V(-0.6, -1.0, -0.2), V(0.4, -1.0, 0.0)
        p["neck"], p["head"] = rv(-3, 8, lean=-8), rv(2, 6, lean=-4)
    (rpc, lpc), (fRc, pRc, fLc, pLc, poleRc, poleLc) = world_to_chest(rig, p, [rp, lp], [fR, pR, fL, pL, poleR, poleL])
    p["hR_pos"], p["hL_pos"] = rpc, lpc
    p["hR_f"], p["hR_p"], p["hL_f"], p["hL_p"] = fRc, pRc, fLc, pLc
    p["hR_pole"], p["hL_pole"] = poleRc, poleLc
    p["fgR"], p["fgL"] = np.array(gR), np.array(gL)
    return p


# ------------------------------------------------------------------------------------------------
# glTF output
# ------------------------------------------------------------------------------------------------

def write_clips(glb, bone_nodes, clips, eps=1e-5):
    """Add every clip to a glb.Glb.  bone_nodes: node index per bone (mh.BONE_NAMES order).  Tracks that never change
    are written with two keys (or one, for one-frame clips) to keep files small."""
    for name, c in clips.items():
        times = np.asarray(c["times"], np.float32)
        q, hips = c["rot"], c["hips_t"]
        T = len(times)
        tin_full = glb.accessor(times, "SCALAR", minmax=True)
        tin_two = tin_full if T <= 2 else glb.accessor(times[[0, -1]], "SCALAR", minmax=True)
        samplers, channels = [], []

        def add_track(node, path, vals, const):
            vals = np.asarray(vals, np.float32)
            if const and T > 2:
                vals = vals[[0, -1]]
                tin = tin_two
            else:
                tin = tin_full
            kind = "VEC4" if path == "rotation" else "VEC3"
            out = glb.accessor(vals, kind)
            samplers.append({"input": tin, "output": out, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})

        for b in range(NB):
            const = float(np.abs(q[:, b] - q[0, b]).max()) < eps
            add_track(bone_nodes[b], "rotation", q[:, b], const)
        add_track(bone_nodes[0], "translation", hips, float(np.abs(hips - hips[0]).max()) < 1e-6)
        glb.g["animations"].append({"name": name, "samplers": samplers, "channels": channels})


# ------------------------------------------------------------------------------------------------
# the clips
# ------------------------------------------------------------------------------------------------

def _key(tr, t, base, add_=None, set_=None):
    """Append a key = base with `set_` replaced and `add_` added (dicts of parameter -> value)."""
    q = setp(base, **(set_ or {}))
    q = add(q, **(add_ or {}))
    tr.times.append(float(t))
    tr.vals.append(q)
    return q


def _idle_extra(T, seed, hands=True):
    def f(p, t):
        p = breathing(p, t, T, seed=seed)
        if hands:                       # the rifle floats a little with the breath: both hands move together
            dd = lambda tt: np.array([0.003 * np.sin(2 * np.pi * tt / T + 1.0), 0.004 * np.sin(2 * np.pi * tt / T) + 0.002 * np.sin(4 * np.pi * tt / T),
                                      0.003 * np.sin(4 * np.pi * tt / T + 0.5)])
            d = dd(t) - dd(0.0)
            p["hR_pos"] = p["hR_pos"] + d
            p["hL_pos"] = p["hL_pos"] + d * 1.3
        return p
    return f


def clip_idle_stand(rig, base):
    T = 3.3
    tr = Track(base)
    _key(tr, 0.0, base)
    _key(tr, T, base)
    return bake(rig, tr, T, True, extra=_idle_extra(T, 1), note="loop; braced wide stance, rifle low at the chest; feet planted (IK), breathing + sway")


def clip_crouch(rig, base):
    k = rig.k
    T = 3.0
    p = copy.deepcopy(base)
    p["fL_pos"] = V(0.25 * k, rig.ankle_h, 0.16 * k)
    p["fR_pos"] = V(-0.25 * k, rig.ankle_h, -0.06 * k)
    p["fL_yaw"], p["fR_yaw"] = S1(10), S1(-20)
    p["hips_rot"] = rv(pitch=17)
    p["sp0"], p["sp1"], p["sp2"] = rv(5), rv(5), rv(3)
    p["neck"], p["head"] = rv(-12), rv(-14)
    p["hips_pos"] = V(0.0, 0.575 * k + 0.0, rig.heads[0][2] - 0.19 * k)
    p["kL_pole"], p["kR_pole"] = unit([0.35, 0.0, 1.0]), unit([-0.35, 0.0, 1.0])
    p["hR_pos"] = V(-0.11, 0.0, 0.27) * k
    p["hL_pos"] = V(0.03, 0.09, 0.50) * k
    tr = Track(p)
    _key(tr, 0.0, p)
    _key(tr, T, p)
    return bake(rig, tr, T, True, extra=_idle_extra(T, 2), note="loop; deep crouch (knees ~110 deg), rifle at the ready; feet planted")


def clip_flinch_a(rig, base):
    k = rig.k
    T = 0.66
    tr = Track(base)
    _key(tr, 0.00, base)
    _key(tr, 0.07, base, dict(hips_pos=V(0, -0.025, -0.085) * k, hips_rot=rv(-6), sp0=rv(-7), sp1=rv(-12), sp2=rv(-11), neck=rv(-12, 9), head=rv(-24, 12),
                              shr_L=V(0, 0, 9), shr_R=V(0, 0, -9), hL_pos=V(0.18, 0.12, -0.12) * k, hR_pos=V(-0.05, 0.08, -0.08) * k,
                              hL_pole=V(0.4, 0.3, 0), fgL=-0.7 * np.ones(5)))
    _key(tr, 0.18, base, dict(hips_pos=V(0, -0.04, -0.07) * k, hips_rot=rv(-3), sp0=rv(-4), sp1=rv(-9), sp2=rv(-8), neck=rv(-8, 6), head=rv(-12, 8),
                              shr_L=V(0, 0, 6), shr_R=V(0, 0, -6), hL_pos=V(0.24, 0.06, -0.02) * k, hR_pos=V(-0.02, 0.02, -0.05) * k,
                              fgL=-0.5 * np.ones(5)))
    _key(tr, 0.34, base, dict(hips_pos=V(0, -0.015, -0.02) * k, sp1=rv(3), sp2=rv(2), neck=rv(3, -2), head=rv(4, -3), hL_pos=V(0.08, 0.02, 0.06) * k,
                              fgL=-0.2 * np.ones(5)))
    _key(tr, 0.50, base, dict(hips_pos=V(0, -0.005, 0.004) * k, sp1=rv(-1), sp2=rv(-1), head=rv(-1, 1)))
    _key(tr, T, base)
    return bake(rig, tr, T, False, note="hit from the front: torso recoils back, head snaps, left hand flies off the rifle; starts/ends at idle_stand frame 0")


def clip_flinch_b(rig, base):
    k = rig.k
    T = 0.72
    tr = Track(base)
    _key(tr, 0.00, base)
    _key(tr, 0.08, base, dict(hips_pos=V(0.09, -0.02, -0.02) * k, hips_rot=rv(0, 10, lean=4), sp0=rv(2, 8, lean=3), sp1=rv(5, 14, lean=6),
                              sp2=rv(3, 12, lean=4), neck=rv(-2, -14, lean=-6), head=rv(-6, -18, lean=-8),
                              shr_R=V(0, 0, -8), hR_pos=V(-0.24, 0.10, 0.12) * k, hR_pole=V(-1.0, 0.1, 0), hL_pos=V(0.10, 0.04, 0.34) * k,
                              fgR=-0.5 * np.ones(5), fL_pos=V(0.0, 0.0, 0.0), fR_pos=V(0.0, 0.0, 0.0)))
    _key(tr, 0.20, base, dict(hips_pos=V(0.11, -0.035, -0.01) * k, hips_rot=rv(0, 8, lean=5), sp0=rv(3, 6, lean=3), sp1=rv(6, 10, lean=6),
                              sp2=rv(4, 8, lean=5), neck=rv(-1, -8, lean=-4), head=rv(-3, -10, lean=-5),
                              hR_pos=V(-0.14, 0.05, 0.10) * k, hL_pos=V(0.06, 0.02, 0.40) * k, fgR=-0.3 * np.ones(5)))
    _key(tr, 0.38, base, dict(hips_pos=V(0.05, -0.015, 0.0) * k, hips_rot=rv(0, 3, lean=2), sp1=rv(2, 3, lean=2), sp2=rv(1, 2, lean=1), head=rv(1, -3)))
    _key(tr, 0.56, base, dict(hips_pos=V(0.012, -0.004, 0.0) * k, sp1=rv(-1, -1), head=rv(0, 1)))
    _key(tr, T, base)
    return bake(rig, tr, T, False, note="hit from the right: hips shove left, torso twists and folds, right arm flies out; starts/ends at idle_stand frame 0")


def clip_throw(rig, base):
    k = rig.k
    T = 1.0
    rel_hand = dict(hR_f=unit([0.1, 0.4, 1.0]), hR_p=unit([-0.6, 0.6, 0.3]))
    tr = Track(base)
    _key(tr, 0.00, base)
    # 0.12: left hand lets go and drops to the chest (pin), right hand brings the grenade to the chest centre
    _key(tr, 0.12, base, dict(hL_pos=V(0.10, -0.06, 0.25) * k - base["hL_pos"], hR_pos=V(-0.04, 0.0, 0.26) * k - base["hR_pos"], fgL=-0.3 * np.ones(5),
                              sp2=rv(1, 4), hips_pos=V(0, 0.0, 0.0)))
    # 0.30: wind-up: turn right, weight back, right arm cocked behind the shoulder, left arm points at the target
    _key(tr, 0.30, base, dict(hips_pos=V(0.0, 0.01, -0.06) * k, hips_rot=rv(-2, -14), sp0=rv(-3, -8), sp1=rv(-4, -14), sp2=rv(-3, -14, lean=-3),
                              neck=rv(0, 8), head=rv(2, 14),
                              hR_pos=V(-0.36, 0.22, -0.28) * k - base["hR_pos"], hR_pole=V(-0.4, 0.9, -0.6) - base["hR_pole"],
                              hR_f=V(0.0, 0.4, -1.0) - base["hR_f"], hR_p=V(0.9, 0.0, 0.3) - base["hR_p"],
                              hL_pos=V(0.12, 0.20, 0.52) * k - base["hL_pos"], hL_f=V(0.0, 0.3, 1.0) - base["hL_f"], hL_p=V(0.3, -1.0, 0.0) - base["hL_p"],
                              fgL=-0.5 * np.ones(5), fgR=np.array(GRIP["throw"]) - base["fgR"]))
    # 0.44: drive: hips and chest open up, elbow leads
    _key(tr, 0.44, base, dict(hips_pos=V(0.0, -0.01, 0.02) * k, hips_rot=rv(2, 10), sp0=rv(0, 6), sp1=rv(3, 10), sp2=rv(4, 8),
                              neck=rv(-2, -4), head=rv(-2, -6),
                              hR_pos=V(-0.20, 0.34, 0.06) * k - base["hR_pos"], hR_pole=V(-0.2, 0.6, -0.5) - base["hR_pole"],
                              hR_f=V(0.0, 0.5, 1.0) - base["hR_f"], hR_p=V(0.7, 0.0, 0.6) - base["hR_p"],
                              hL_pos=V(0.22, -0.05, 0.22) * k - base["hL_pos"], fgL=-0.5 * np.ones(5), fgR=np.array(GRIP["throw"]) - base["fgR"]))
    # 0.55 = release (55%): arm fully extended in front of the head, chest square-on and pitched forward
    _key(tr, 0.55, base, dict(hips_pos=V(0.0, -0.03, 0.08) * k, hips_rot=rv(6, 16), sp0=rv(4, 8), sp1=rv(8, 12), sp2=rv(8, 8),
                              neck=rv(-6, -8), head=rv(-6, -8),
                              hR_pos=V(-0.10, 0.30, 0.52) * k - base["hR_pos"], hR_pole=V(-0.3, -0.2, -0.3) - base["hR_pole"],
                              hR_f=V(0.0, 0.2, 1.0) - base["hR_f"], hR_p=V(0.9, 0.0, 0.2) - base["hR_p"],
                              hL_pos=V(0.28, -0.14, 0.06) * k - base["hL_pos"], fgL=-0.5 * np.ones(5), fgR=np.array(GRIP["open"]) - base["fgR"]))
    # 0.72: follow-through across the body
    _key(tr, 0.72, base, dict(hips_pos=V(0.0, -0.05, 0.10) * k, hips_rot=rv(10, 22), sp0=rv(6, 10), sp1=rv(12, 14), sp2=rv(10, 10),
                              neck=rv(-8, -12), head=rv(-8, -14),
                              hR_pos=V(0.14, -0.06, 0.40) * k - base["hR_pos"], hR_pole=V(0.1, -1.0, 0.0) - base["hR_pole"],
                              hR_f=V(-0.5, -0.4, 1.0) - base["hR_f"], hR_p=V(0.2, 0.6, 0.6) - base["hR_p"],
                              hL_pos=V(0.30, -0.16, 0.0) * k - base["hL_pos"], fgL=-0.4 * np.ones(5), fgR=np.array(GRIP["open"]) - base["fgR"]))
    _key(tr, 0.86, base, dict(hips_pos=V(0.0, -0.03, 0.03) * k, hips_rot=rv(5, 8), sp1=rv(5, 6), sp2=rv(4, 4), head=rv(-3, -4)))
    _key(tr, T, base)
    c = bake(rig, tr, T, False, note="overhand throw with the RIGHT hand; RELEASE at 0.55 s (55%%, frame %d); starts/ends at idle_stand frame 0" % int(round(0.55 * FPS)))
    c["release_time"] = 0.55
    return c


def clip_celebrate(rig, base):
    k = rig.k
    T = 2.2
    ay = rig.ankle_h
    hy = rig.hips_y
    fL0, fR0 = base["fL_pos"], base["fR_pos"]
    fists = dict(fgL=np.array(GRIP["fist"]) - base["fgL"], fgR=np.array(GRIP["fist"]) - base["fgR"])
    hd = lambda S: (unit([0.0, -1.0, 0.15]), unit([1.0 if S == "R" else -1.0, 0.0, 0.2]))
    hu = lambda S: (unit([0.0, 1.0, 0.25]), unit([0.6 if S == "R" else -0.6, 0.0, 0.8]))

    def arms(stateL, stateR, posL, posR, poleL=None, poleR=None):
        fL, pL = stateL(  "L")
        fR, pR = stateR("R")
        d = dict(hL_pos=np.asarray(posL) * k - base["hL_pos"], hR_pos=np.asarray(posR) * k - base["hR_pos"],
                 hL_f=fL - base["hL_f"], hL_p=pL - base["hL_p"], hR_f=fR - base["hR_f"], hR_p=pR - base["hR_p"],
                 hL_pole=(poleL if poleL is not None else V(0.6, -0.4, -0.3)) - base["hL_pole"],
                 hR_pole=(poleR if poleR is not None else V(-0.6, -0.4, -0.3)) - base["hR_pole"])
        d.update(fists)
        return d

    def keyframe(t, hips, hrot=rv(0), spine=(rv(0), rv(0), rv(0)), neck=rv(0), head=rv(0), feetL=None, feetR=None, **arm):
        """Absolute torso values (hips position, rotations) + optional absolute foot targets + arm deltas."""
        add_ = dict(hips_pos=np.asarray(hips) - base["hips_pos"], hips_rot=np.asarray(hrot) - base["hips_rot"],
                    sp0=np.asarray(spine[0]) - base["sp0"], sp1=np.asarray(spine[1]) - base["sp1"], sp2=np.asarray(spine[2]) - base["sp2"],
                    neck=np.asarray(neck) - base["neck"], head=np.asarray(head) - base["head"])
        add_.update(arm)
        set_ = {}
        if feetL is not None:
            set_["fL_pos"] = np.asarray(feetL)
        if feetR is not None:
            set_["fR_pos"] = np.asarray(feetR)
        _key(tr, t, base, add_, set_)

    tr = Track(base)
    b_hips = base["hips_pos"]
    hz = b_hips[2]
    # helper poses for arms: (posL, posR) chest-frame metres (before *k)
    A_down = arms(hd, hd, (0.30, -0.30, 0.04), (-0.30, -0.30, 0.04))
    A_swing = arms(hu, hu, (0.34, 0.50, 0.08), (-0.34, 0.50, 0.08), V(0.9, 0.3, -0.2), V(-0.9, 0.3, -0.2))
    A_pumpR = arms(hd, hu, (0.30, -0.02, 0.18), (-0.20, 0.56, 0.20), V(0.6, -0.5, -0.1), V(-0.7, -0.1, -0.4))
    A_pumpL = arms(hu, hd, (0.20, 0.56, 0.20), (-0.30, -0.02, 0.18), V(0.7, -0.1, -0.4), V(-0.6, -0.5, -0.1))
    A_both = arms(hu, hu, (0.20, 0.50, 0.26), (-0.20, 0.50, 0.26), V(0.7, -0.2, -0.4), V(-0.7, -0.2, -0.4))
    A_low = arms(hd, hd, (0.28, -0.08, 0.20), (-0.28, -0.08, 0.20))
    keyframe(0.00, b_hips)
    sp = lambda a, b, c: (rv(a), rv(b), rv(c))
    keyframe(0.20, V(0, 0.735 * k, hz - 0.04 * k), rv(16), sp(6, 8, 6), rv(-6), rv(-6), **A_down)
    keyframe(0.36, V(0, rig.hips_y - 0.005, hz), rv(2), sp(-2, -6, -6), rv(-4), rv(-6), **A_swing)
    keyframe(0.40, V(0, rig.hips_y + 0.03, hz), rv(0), sp(-4, -8, -8), rv(-8), rv(-8), feetL=fL0 + V(0, 0.04, 0), feetR=fR0 + V(0, 0.04, 0), **A_swing)
    keyframe(0.585, V(0, rig.hips_y + 0.27, hz - 0.02), rv(-3), sp(-4, -8, -8), rv(-8), rv(-10),
             feetL=V(0.22 * k, ay + 0.30, -0.02 * k), feetR=V(-0.22 * k, ay + 0.26, -0.10 * k), **A_swing)
    keyframe(0.78, V(0, rig.hips_y + 0.02, hz + 0.01), rv(6), sp(2, 3, 3), rv(-2), rv(-4),
             feetL=fL0 + V(0, 0.03, 0), feetR=fR0 + V(0, 0.03, 0), **A_low)
    keyframe(0.86, V(0, 0.75 * k, hz - 0.02 * k), rv(14), sp(5, 7, 5), rv(-5), rv(-6), feetL=fL0, feetR=fR0, **A_low)
    keyframe(1.02, V(0, 0.855 * k, hz - 0.02 * k), rv(4), sp(0, -2, -4), rv(-6), rv(-8), feetL=fL0, feetR=fR0, **A_pumpR)
    keyframe(1.20, V(0, 0.86 * k, hz - 0.02 * k), rv(3, -6), sp(0, -2, -4), rv(-4), rv(-8), feetL=fL0, feetR=fR0, **A_pumpL)
    keyframe(1.42, V(0, 0.83 * k, hz - 0.03 * k), rv(2), sp(-2, -6, -8), rv(-8), rv(-14), feetL=fL0, feetR=fR0, **A_both)
    keyframe(1.70, V(0, 0.855 * k, hz - 0.03 * k), rv(3), sp(-1, -2, -2), rv(-5), rv(-8), feetL=fL0, feetR=fR0, **A_low)
    _key(tr, T, base)
    return bake(rig, tr, T, False, note="one-shot ~2.2 s: crouch, jump with arms up (flight ~0.45 s), land, two fist pumps, both fists up, ends at idle_stand frame 0")


def clip_death(rig, base):
    k = rig.k
    T = 1.2
    ay = rig.ankle_h
    hz = base["hips_pos"][2]
    fL0, fR0 = base["fL_pos"], base["fR_pos"]
    open_ = -1.0 * base["fgL"] + 0.1
    tr = Track(base)
    def kf(t, hy, hzz, hrot, sp0, sp1, sp2, neck, head, hL, hR, fL=None, fR=None, fpL=0, fpR=0, poleL=None, poleR=None, fg=0.15):
        set_ = dict(hips_pos=V(0.0, hy, hzz), hips_rot=hrot, sp0=sp0, sp1=sp1, sp2=sp2, neck=neck, head=head,
                    hL_pos=np.asarray(hL) * k, hR_pos=np.asarray(hR) * k, fgL=fg * np.ones(5), fgR=fg * np.ones(5),
                    fL_pitch=S1(fpL), fR_pitch=S1(fpR))
        set_["hL_f"] = unit([0.4, -1.0, 0.3]) if fg < 0.5 else base["hL_f"]
        set_["hR_f"] = unit([-0.4, -1.0, 0.3]) if fg < 0.5 else base["hR_f"]
        set_["hL_p"] = unit([-0.7, 0.0, 0.7])
        set_["hR_p"] = unit([0.7, 0.0, 0.7])
        set_["hL_pole"] = poleL if poleL is not None else unit([0.6, -1.0, -0.5])
        set_["hR_pole"] = poleR if poleR is not None else unit([-0.6, -1.0, -0.5])
        if fL is not None:
            set_["fL_pos"] = np.asarray(fL)
        if fR is not None:
            set_["fR_pos"] = np.asarray(fR)
        _key(tr, t, base, None, set_)
    b = base
    _key(tr, 0.0, base)
    # hit (0.08), knees give (0.26), body tips back (0.42/0.60), lands on its back (0.76), bounces (0.86), goes limp
    kf(0.08, b["hips_pos"][1] - 0.02, hz - 0.05, rv(-2), rv(-3), rv(-8), rv(-8), rv(-9), rv(-16), (0.04, 0.05, 0.10), (-0.05, 0.08, 0.10), fg=0.6)
    kf(0.26, 0.72 * k, hz - 0.13 * k, rv(-10), rv(-5), rv(-9), rv(-7), rv(-8), rv(-16), (0.42, 0.18, -0.02), (-0.36, 0.14, -0.02), fg=0.1)
    kf(0.40, 0.42 * k, hz - 0.25 * k, rv(-26), rv(-6), rv(-8), rv(-6), rv(-6), rv(-14), (0.52, 0.16, -0.16), (-0.50, 0.14, -0.18),
       fL=V(0.27 * k, ay + 0.0, 0.14 * k), fR=V(-0.27 * k, ay + 0.0, -0.06 * k), fpL=4, fpR=8, fg=0.1)
    kf(0.56, 0.26 * k, hz - 0.38 * k, rv(-58), rv(-5), rv(-6), rv(-4), rv(-5), rv(-10), (0.56, 0.0, -0.20), (-0.55, -0.02, -0.20),
       fL=V(0.25 * k, ay + 0.10, 0.30 * k), fR=V(-0.23 * k, ay + 0.07, 0.17 * k), fpL=-12, fpR=-6, fg=0.2)
    kf(0.72, 0.17 * k, hz - 0.49 * k, rv(-90), rv(-2), rv(-3), rv(-4), rv(-4, 3), rv(-2, 8), (0.52, -0.28, -0.06), (-0.50, -0.28, -0.06),
       fL=V(0.23 * k, ay + 0.14, 0.31 * k), fR=V(-0.21 * k, ay + 0.10, 0.25 * k), fpL=-60, fpR=-50, fg=0.25)
    kf(0.86, 0.20 * k, hz - 0.51 * k, rv(-88), rv(-1), rv(-3), rv(-4), rv(-2, 5), rv(0, 12), (0.52, -0.30, -0.05), (-0.48, -0.30, -0.05),
       fL=V(0.23 * k, ay + 0.13, 0.31 * k), fR=V(-0.21 * k, ay + 0.11, 0.26 * k), fpL=-70, fpR=-60, fg=0.3)
    kf(1.00, 0.16 * k, hz - 0.52 * k, rv(-90), rv(-2), rv(-4), rv(-5), rv(-3, 3), rv(-3, 14), (0.50, -0.32, -0.06), (-0.47, -0.30, -0.06),
       fL=V(0.24 * k, ay + 0.07, 0.31 * k), fR=V(-0.20 * k, ay + 0.07, 0.26 * k), fpL=-82, fpR=-70, fg=0.35)
    kf(T, 0.15 * k, hz - 0.53 * k, rv(-90), rv(-2), rv(-4), rv(-5), rv(-4, 4), rv(-4, 16), (0.50, -0.34, -0.07), (-0.46, -0.30, -0.07),
       fL=V(0.24 * k, ay + 0.05, 0.31 * k), fR=V(-0.20 * k, ay + 0.05, 0.26 * k), fpL=-85, fpR=-72, fg=0.35)
    c = bake(rig, tr, T, False, ground=True, ground_from=0.72, note="standing -> falls backward, lands on its back (~0.72 s), goes limp; Hips keeps the body on y=0; ends lying face up, head toward -Z of the start position")
    return c


def clip_sit(rig, base_sit, g):
    T = 3.0
    tr = Track(base_sit)
    _key(tr, 0.0, base_sit)
    _key(tr, T, base_sit)

    def extra(p, t):
        w = 2 * np.pi * t / T
        p = breathing(p, t, T, amp=0.9, sway=0.7, seed=5)
        # micro steering corrections: hands orbit the wheel by a degree or two, together
        steer = 1.6 * np.sin(w) + 0.8 * np.sin(2 * w + 1.0)
        return sit_set_wheel(p, g, steer, (0.5 * np.sin(2 * w), -0.4 * np.sin(2 * w + 0.7)))
    return bake(rig, tr, T, True, frames=("world", "world"), extra=extra,
                note="loop; seated, hip joint %.2f m above the floor plane (feet plane y=0, root on the floor under the hip point), hands at 10 and 2 on a %.2f m wheel centred (0, %.2f, %.2f) with the face tilted 25 deg toward the driver"
                % (g["hj"], 2 * g["rad"], g["wc"][1], g["wc"][2]))


def clip_sit_lean(rig, base_sit, g, side):
    T = 1.5
    s = 1.0 if side == "L" else -1.0
    lean = 1.0
    p = copy.deepcopy(base_sit)
    p["hips_pos"] = p["hips_pos"] + V(0.025 * s, 0.0, 0.0)
    p["hips_rot"] = p["hips_rot"] + rv(0, -3 * s, lean=3 * s)
    p["sp0"] = p["sp0"] + rv(0, -2 * s, lean=5 * s)
    p["sp1"] = p["sp1"] + rv(1, -2 * s, lean=6 * s)
    p["sp2"] = p["sp2"] + rv(1, -1 * s, lean=5 * s)
    p["neck"] = p["neck"] + rv(0, 3 * s, lean=-6 * s)
    p["head"] = p["head"] + rv(0, 3 * s, lean=-7 * s)
    p["shr_L"] = p["shr_L"] + V(0, 0, -4 * s if s > 0 else 3)
    p["shr_R"] = p["shr_R"] + V(0, 0, 4 * s if s < 0 else -3)
    p = sit_set_wheel(p, g, -22.0 * s)
    tr = Track(p)
    _key(tr, 0.0, p)
    _key(tr, T, p)

    def extra(pp, t):
        w = 2 * np.pi * t / T
        pp = breathing(pp, t, T, amp=0.8, sway=0.8, seed=6 if side == "L" else 7)
        return sit_set_wheel(pp, g, -22.0 * s + 1.2 * np.sin(w), (0.6 * np.sin(2 * w), -0.5 * np.sin(2 * w)))
    return bake(rig, tr, T, True, frames=("world", "world"), extra=extra,
                note="loop that HOLDS the full lean toward %s (%s); wheel turned 22 deg; crossfade idle_sit_drive <-> this by steering input" % (side, "+X" if side == "L" else "-X"))


def clip_pose(rig, p, name, frames=("chest", "chest")):
    tr = Track(p)
    tr.times.append(0.0)
    tr.vals.append(copy.deepcopy(p))
    return bake(rig, tr, 0.0, False, frames=frames, note=name)


def socket_frames(heads, clips, head_top=None):
    """Socket bone placement (world rest position + local rotation relative to the parent bone).

    socket_hand_R / _L: at the grip centre of the hand, rotated so that in `pose_rifle` its world orientation is identity
    (+Z = weapon forward, +Y up, +X = weapon left) -> the weapon's grip_R / grip_L sockets align with it directly.
    socket_back: upper-back centre, a few cm behind Spine2, +Z forward.   socket_head: top centre of the head.
    """
    rig = Rig(heads)
    if "pose_rifle" in clips and "_poses" in clips["pose_rifle"]:
        W = clips["pose_rifle"]["_poses"][0][0]
    else:
        base = ready_stance(rig)
        W, _ = rig.solve(aim_pose(rig, base, "rifle"))
    pos, rot = {}, {}
    for S in SIDES:
        F = FULL[S]
        hb = IDX[F + "Hand"]
        pos["socket_hand_" + S] = rig.heads[hb] + rig.hand[S]["grip_local"]
        rot["socket_hand_" + S] = R.from_matrix(W[hb].T).as_quat()
    k = rig.k
    s2 = rig.heads[IDX["Spine2"]]
    pos["socket_back"] = s2 + V(0.0, 0.10 * k, -0.11 * k)
    rot["socket_back"] = np.array([0.0, 0.0, 0.0, 1.0])
    hd = rig.heads[IDX["Head"]]
    top = head_top if head_top is not None else float(hd[1] + 0.165 * k)
    pos["socket_head"] = V(hd[0], top, hd[2] - 0.005)
    rot["socket_head"] = np.array([0.0, 0.0, 0.0, 1.0])
    return pos, rot


def build_clips(heads, only=None, bulk=1.0, mesh=None, foot_sole=0.0, seat=None):
    """All clips for a body with the given rest bone heads (B,3), game space.  See module docstring for the format.
    bulk: >1 for thick torsos/wide builds (wider stance, hands and elbows further from the body).
    mesh: optional (pos (V,3), joints (V,4), weights (V,4)) of the skinned character for exact ground contact in death_fall
    (see Rig.set_mesh; foot_sole = boot sole thickness if the mesh does not include the boots).
    seat: optional dict(hip_height, wheel_up, wheel_fwd, tilt_deg, rad) overriding the seated geometry (see sit_geometry)."""
    rig = Rig(heads)
    if mesh is not None:
        rig.set_mesh(mesh[0], mesh[1], mesh[2], foot_sole)
    base = ready_stance(rig, bulk)
    sit_p, g = sit_base(rig, sit_geometry(rig, **(seat or {})))
    out = {}
    want = lambda n: only is None or n in only
    if want("idle_stand"):
        out["idle_stand"] = clip_idle_stand(rig, base)
    if want("idle_sit_drive"):
        out["idle_sit_drive"] = clip_sit(rig, sit_p, g)
    if want("sit_lean_L"):
        out["sit_lean_L"] = clip_sit_lean(rig, sit_p, g, "L")
    if want("sit_lean_R"):
        out["sit_lean_R"] = clip_sit_lean(rig, sit_p, g, "R")
    if want("flinch_a"):
        out["flinch_a"] = clip_flinch_a(rig, base)
    if want("flinch_b"):
        out["flinch_b"] = clip_flinch_b(rig, base)
    if want("throw_grenade"):
        out["throw_grenade"] = clip_throw(rig, base)
    if want("celebrate"):
        out["celebrate"] = clip_celebrate(rig, base)
    if want("crouch_idle"):
        out["crouch_idle"] = clip_crouch(rig, base)
    if want("death_fall"):
        out["death_fall"] = clip_death(rig, base)
    for kind in ("pistol", "rifle", "launcher"):
        if want("pose_" + kind):
            out["pose_" + kind] = clip_pose(rig, aim_pose(rig, base, kind), "one-frame %s pose (weapon axis +Z, arms only)" % kind)
    return out
