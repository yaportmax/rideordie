"""Second-generation clip authoring on top of anim.Rig: weapon props, overlap springs, ride motion, high-rate baking.

Concepts
--------
* WEAPON PROP.  A pose may carry a weapon frame (params `pw_pos` metres + `pw_rot` rotvec degrees, in the CHEST frame for
  chest-frame clips, WORLD for world-frame clips).  The weapon frame is the weapon GLB's own frame: origin = grip_R
  (pistol-grip centre), +Z muzzle, +Y up, +X weapon-left.  `attR` / `attL` (0..1) blend each hand between its free target
  (hX_pos/_f/_p) and the weapon grips: the right hand onto grip_R with the socket_hand_R orientation (so a weapon parented
  to socket_hand_R at identity follows the authored weapon frame exactly), the left hand onto `gL_pos` / `gL_f` / `gL_p`
  (weapon frame; default = the class's grip_L).  The runtime contract that falls out of this:
      weapon.root  -> child of socket_hand_R, identity transform           (every weapon clip)
      left hand    -> the clip already puts it on grip_L of the class weapon; an IK touch-up onto the real weapon's
                      grip_L is optional (smg/lmg/shotgun grips differ by a few cm)
* OVERLAP.  World-space second-order springs on the torso chain (Spine .. Head), on the weapon and on free hands: parts
  lag behind the authored motion and overshoot a little -> follow-through and secondary motion for free.
* RIDE.  A procedural "standing in a moving truck bed" layer: suspension bumps absorbed by the knees, lateral rocking,
  counter-balancing spine and a stabilised head (integer harmonics per loop -> seamless loops).
* bake2() samples at 120 Hz, applies layers + springs, resolves the weapon grips, downsamples to 30 fps and solves the IK
  (feet planted, hands on grips) exactly like anim.bake, with optional ground contact for falls.
"""
import copy

import numpy as np
from scipy.spatial.transform import Rotation as R

import anim as A
from anim import FULL, IDX, NB, SIDES, S1, V, rv, rvm, unit

HZ = 120.0

# weapon classes: socket positions in the weapon frame (public/models/weapons/README.md)
WEAPONS = {
    "rifle": dict(gripL=V(0.008, 0.048, 0.325), stock=V(0.0, 0.051, -0.333), sight=V(0.0, 0.159, -0.150), mag=V(0.0, 0.056, 0.115),
                  muzzle=V(0.0, 0.092, 0.568), charge=V(-0.03, 0.10, 0.16),
                  fL=unit([-0.85, 0.05, 0.45]), pL=unit([0.12, 1.0, 0.0]), gL=A.GRIP["rifle_L"]),
    "pistol": dict(gripL=V(0.015, 0.004, 0.014), stock=None, sight=V(0.0, 0.077, -0.070), mag=V(0.0, 0.035, 0.013),
                   muzzle=V(0.0, 0.058, 0.158), charge=V(0.0, 0.066, -0.03),
                   fL=unit([-0.4, -0.15, 1.0]), pL=unit([-1.0, 0.1, 0.15]), gL=A.GRIP["pistol_L"]),
    "shotgun": dict(gripL=V(0.0, 0.019, 0.358), stock=V(0.0, -0.052, -0.317), sight=V(0.0, 0.090, -0.120), mag=V(0.0, 0.013, 0.148),
                    muzzle=V(0.0, 0.054, 0.683), charge=None,
                    fL=unit([-0.85, 0.05, 0.45]), pL=unit([0.12, 1.0, 0.0]), gL=A.GRIP["rifle_L"]),
    "launcher": dict(gripL=V(0.0, 0.018, 0.215), stock=V(0.0, 0.030, -0.224), sight=V(0.064, 0.106, -0.207), mag=V(0.0, 0.090, 0.522),
                     muzzle=V(0.0, 0.090, 0.530), charge=None,
                     fL=unit([-0.25, -1.0, 0.25]), pL=unit([-1.0, 0.0, 0.1]), gL=A.GRIP["launcher_L"]),
}

TORSO = (("Spine", "sp0"), ("Spine1", "sp1"), ("Spine2", "sp2"), ("Neck", "neck"), ("Head", "head"))


# ------------------------------------------------------------------------------------------------
# pose helpers
# ------------------------------------------------------------------------------------------------

def with_weapon(p, wclass="rifle"):
    """Add the weapon parameters (prop frame + attachments) to a pose dict; returns a copy."""
    q = copy.deepcopy(p)
    w = WEAPONS[wclass]
    q.setdefault("pw_pos", V(0, 0, 0))
    q.setdefault("pw_rot", V(0, 0, 0))
    q.setdefault("attR", S1(1.0))
    q.setdefault("attL", S1(1.0))
    q.setdefault("gL_pos", w["gripL"].copy())
    q.setdefault("gL_f", w["fL"].copy())
    q.setdefault("gL_p", w["pL"].copy())
    return q


def eye_world(rig, W, P, side="R"):
    """World position of the right (or left) eye from a solved/torso pose."""
    k = rig.k
    off = V(-0.031 if side == "R" else 0.031, 0.041 * k, 0.089 * k)
    return P[IDX["Head"]] + W[IDX["Head"]] @ off


def chest_to_world(rig, p, pos, rotm):
    Cpos, Crot = rig.chest(p)
    return Cpos + Crot @ pos, Crot @ rotm


def world_to_chest_frame(rig, p, pos, rotm):
    Cpos, Crot = rig.chest(p)
    return Crot.T @ (np.asarray(pos) - Cpos), Crot.T @ rotm


def set_weapon_world(rig, p, pos, rotm):
    """Set pw_pos / pw_rot (chest frame) from a desired WORLD weapon frame for the pose's current torso."""
    lp, lr = world_to_chest_frame(rig, p, pos, rotm)
    q = copy.deepcopy(p)
    q["pw_pos"] = lp
    q["pw_rot"] = np.degrees(R.from_matrix(lr).as_rotvec())
    return q


def weapon_world(rig, p):
    return chest_to_world(rig, p, np.asarray(p["pw_pos"], float), rvm(p["pw_rot"]))


def rot_from(fwd, up=(0.0, 1.0, 0.0)):
    """Rotation matrix whose +Z is `fwd` and +Y is as close to `up` as possible (weapon frame from an aim direction)."""
    z = unit(fwd)
    x = unit(np.cross(up, z))
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


# ------------------------------------------------------------------------------------------------
# the hand <-> weapon relation (from pose_rifle: socket_hand_R is identity in the weapon frame there)
# ------------------------------------------------------------------------------------------------

class HandRel:
    """Right hand orientation relative to the weapon (= the solved pose_rifle right hand, whose weapon frame is the world)."""

    def __init__(self, rig):
        base = A.ready_stance(rig)
        p = A.aim_pose(rig, base, "rifle")
        W, P = rig.solve(p)
        self.R = W[IDX["RightHand"]].copy()                  # hand world rotation when the weapon frame is identity
        self.grip0 = P[IDX["RightHand"]] + W[IDX["RightHand"]] @ rig.hand["R"]["grip_local"]


def _hand_dirs(rig, S, Rh):
    hd = rig.hand[S]
    return Rh @ hd["d0"], Rh @ hd["palm0"]


def _hand_rot(rig, S, f, pal):
    hd = rig.hand[S]
    return A.frame(f, pal) @ A.frame(hd["d0"], hd["palm0"]).T


def _slerp_m(Ra, Rb, t):
    if t <= 0.0:
        return Ra
    if t >= 1.0:
        return Rb
    rel = R.from_matrix(Ra.T @ Rb).as_rotvec()
    return Ra @ R.from_rotvec(rel * t).as_matrix()


def resolve_grips(rig, p, rel):
    """Hands onto the weapon grips by attR/attL (in the pose's hand frame = the weapon's frame of expression)."""
    if "pw_pos" not in p:
        return p
    q = dict(p)
    O = np.asarray(p["pw_pos"], float)
    Wr = rvm(p["pw_rot"])
    aR = float(np.clip(p["attR"][0], 0, 1))
    aL = float(np.clip(p["attL"][0], 0, 1))
    if aR > 1e-4:
        RhA = Wr @ rel.R
        RhF = _hand_rot(rig, "R", p["hR_f"], p["hR_p"])
        Rh = _slerp_m(RhF, RhA, aR)
        q["hR_pos"] = (1 - aR) * np.asarray(p["hR_pos"]) + aR * O
        q["hR_f"], q["hR_p"] = _hand_dirs(rig, "R", Rh)
    if aL > 1e-4:
        RhA = _hand_rot(rig, "L", Wr @ p["gL_f"], Wr @ p["gL_p"])
        RhF = _hand_rot(rig, "L", p["hL_f"], p["hL_p"])
        Rh = _slerp_m(RhF, RhA, aL)
        q["hL_pos"] = (1 - aL) * np.asarray(p["hL_pos"]) + aL * (O + Wr @ np.asarray(p["gL_pos"], float))
        q["hL_f"], q["hL_p"] = _hand_dirs(rig, "L", Rh)
    return q


# ------------------------------------------------------------------------------------------------
# layers (functions of (p, t) -> p)
# ------------------------------------------------------------------------------------------------

def harmonic_noise(T, seed, n=6, lo=1, hi=9, falloff=1.0):
    """Seamless (period T) band-limited noise f(t) with f(0) = 0, unit-ish amplitude."""
    rng = np.random.default_rng(seed)
    ks = rng.integers(lo, hi + 1, n)
    ph = rng.uniform(0, 2 * np.pi, n)
    amp = 1.0 / (ks.astype(float) ** falloff)
    amp /= np.sqrt((amp ** 2).sum() / 2)

    def f(t):
        return float(np.sum(amp * (np.sin(2 * np.pi * ks * t / T + ph) - np.sin(ph))))
    return f


def ride(T, amp=1.0, sway=1.0, seed=11, stabilize=0.75, window=None, bumps=1.0):
    """Standing in a moving vehicle bed: vertical bumps absorbed by the knees, side-to-side rocking, counter-balance,
    stabilised head.  Returns an extra(p, t) layer; all offsets are 0 at t = 0 (and t = T), so loops stay seamless.
    window: None (loop) or a function t -> 0..1 multiplying the whole layer (one-shots)."""
    bob = harmonic_noise(T, seed, n=7, lo=3, hi=13, falloff=0.7)          # suspension chatter
    heave = harmonic_noise(T, seed + 1, n=3, lo=1, hi=3, falloff=0.5)     # slow road undulation
    roll = harmonic_noise(T, seed + 2, n=3, lo=1, hi=3, falloff=0.6)      # vehicle rocking side to side
    pitch = harmonic_noise(T, seed + 3, n=3, lo=1, hi=4, falloff=0.6)
    yaw = harmonic_noise(T, seed + 4, n=2, lo=1, hi=2, falloff=0.5)

    def f(p, t):
        w = 1.0 if window is None else window(t)
        if w <= 0:
            return p
        a, s = amp * w, sway * w
        q = dict(p)
        dy = -0.011 * a * bumps * (0.6 * bob(t) + 0.4 * abs(bob(t))) + 0.008 * a * heave(t)
        rl = roll(t)
        dx = 0.022 * s * rl
        q["hips_pos"] = np.asarray(p["hips_pos"], float) + V(dx, dy, 0.006 * s * pitch(t))
        # the pelvis rolls with the truck, the spine counter-leans to keep the chest over the feet
        hr = rv(pitch=1.2 * a * pitch(t), twist=1.5 * s * yaw(t), lean=-2.2 * s * rl)
        q["hips_rot"] = np.asarray(p["hips_rot"], float) + hr
        q["sp0"] = np.asarray(p["sp0"], float) + rv(0.5 * a * bob(t), 0.0, 1.1 * s * rl)
        q["sp1"] = np.asarray(p["sp1"], float) + rv(0.4 * a * bob(t), -0.4 * s * yaw(t), 0.8 * s * rl)
        q["sp2"] = np.asarray(p["sp2"], float) + rv(0.3 * a * bob(t), -0.4 * s * yaw(t), 0.3 * s * rl)
        # head stabilisation: undo most of the accumulated torso lean/pitch/twist
        acc = hr + rv(0.5 * a * bob(t), 0, 1.1 * s * rl) + rv(0.4 * a * bob(t), -0.4 * s * yaw(t), 0.8 * s * rl) + rv(0.3 * a * bob(t), -0.4 * s * yaw(t), 0.3 * s * rl)
        q["neck"] = np.asarray(p["neck"], float) - 0.45 * stabilize * acc
        q["head"] = np.asarray(p["head"], float) - 0.55 * stabilize * acc
        return q
    return f


def breathe(T, amp=1.0, sway=1.0, seed=0):
    def f(p, t):
        return A.breathing(copy.deepcopy(p), t, T, amp=amp, sway=sway, seed=seed)
    return f


def chain(*layers):
    def f(p, t):
        for L in layers:
            if L is not None:
                p = L(p, t)
        return p
    return f


def window_fn(T, fade_in=0.25, fade_out=0.25):
    def w(t):
        a = np.clip(t / max(fade_in, 1e-6), 0, 1)
        b = np.clip((T - t) / max(fade_out, 1e-6), 0, 1)
        return float(A_s(a) * A_s(b))
    return w


def A_s(x):
    return x * x * (3 - 2 * x)


# ------------------------------------------------------------------------------------------------
# springs (world space) over a sampled parameter sequence
# ------------------------------------------------------------------------------------------------

class RotSpring:
    def __init__(self, f, z):
        self.w0 = 2 * np.pi * f
        self.z = z
        self.X = None
        self.v = np.zeros(3)

    def step(self, target, dt):
        if self.X is None:
            self.X = target.copy()
            return self.X
        e = R.from_matrix(target @ self.X.T).as_rotvec()
        self.v += (self.w0 * self.w0 * e - 2 * self.z * self.w0 * self.v) * dt
        self.X = R.from_rotvec(self.v * dt).as_matrix() @ self.X
        return self.X


class PosSpring:
    def __init__(self, f, z):
        self.w0 = 2 * np.pi * f
        self.z = z
        self.x = None
        self.v = np.zeros(3)

    def step(self, target, dt):
        if self.x is None:
            self.x = np.array(target, float)
            return self.x.copy()
        self.v += (self.w0 * self.w0 * (target - self.x) - 2 * self.z * self.w0 * self.v) * dt
        self.x = self.x + self.v * dt
        return self.x.copy()


def overlap(rig, params, spec, loop=False, dt=1.0 / HZ, settle=0.0, frames=("chest", "chest")):
    """World-space lag on the torso chain / weapon / free hands.  spec: {'Spine1': (f_hz, zeta), ..., 'weapon': (f, z),
    'weapon_rot': (f, z), 'hL': (f, z), 'hR': (f, z)}.  Loops are run three times (last pass kept) so they stay seamless;
    one-shots start at rest and, with settle > 0, blend back to the authored values over the last `settle` seconds."""
    if not spec:
        return params
    n = len(params)
    passes = 3 if loop else 1
    springs = {k: (RotSpring(*v) if k not in ("weapon", "hL", "hR", "fL", "fR") else PosSpring(*v)) for k, v in spec.items()}
    out = None
    for ps in range(passes):
        res = []
        for i in range(n):
            p = copy.deepcopy(params[i])
            W, P = rig.torso(p)
            # torso chain: each spring-ed bone lags its authored WORLD orientation; locals are rebuilt from lagged parents
            Wn = W.copy()
            for bone, key in TORSO:
                b = IDX[bone]
                par = A.PAR[b]
                if bone in springs:
                    Wn[b] = springs[bone].step(W[b], dt)
                else:
                    Wn[b] = Wn[par] @ rvm(p[key])
                p[key] = np.degrees(R.from_matrix(Wn[par].T @ Wn[b]).as_rotvec())
            if "weapon" in springs or "weapon_rot" in springs or "hL" in springs or "hR" in springs:
                Cpos0, Crot0 = P[IDX["Spine2"]], W[IDX["Spine2"]]
                _, P2 = rig.torso(p)
                Cpos, Crot = P2[IDX["Spine2"]], Wn[IDX["Spine2"]]
                if "pw_pos" in p and ("weapon" in springs or "weapon_rot" in springs):
                    if frames[0] == "world":
                        Ow, Rw = np.asarray(p["pw_pos"], float), rvm(p["pw_rot"])
                    else:
                        Ow = Cpos + Crot @ np.asarray(p["pw_pos"], float)
                        Rw = Crot @ rvm(p["pw_rot"])
                    if "weapon" in springs:
                        Ow = springs["weapon"].step(Ow, dt)
                    if "weapon_rot" in springs:
                        Rw = springs["weapon_rot"].step(Rw, dt)
                    if frames[0] == "world":
                        p["pw_pos"], p["pw_rot"] = Ow, np.degrees(R.from_matrix(Rw).as_rotvec())
                    else:
                        p["pw_pos"] = Crot.T @ (Ow - Cpos)
                        p["pw_rot"] = np.degrees(R.from_matrix(Crot.T @ Rw).as_rotvec())
                for S in ("L", "R"):
                    key = "h" + S
                    if key in springs:
                        fr = frames[0 if S == "L" else 1]
                        tgt = np.asarray(p[key + "_pos"], float) if fr == "world" else Cpos + Crot @ np.asarray(p[key + "_pos"], float)
                        x = springs[key].step(tgt, dt)
                        p[key + "_pos"] = x if fr == "world" else Crot.T @ (x - Cpos)
            for S in ("L", "R"):
                key = "f" + S
                if key in springs:                          # feet are always world-space targets
                    p[key + "_pos"] = springs[key].step(np.asarray(p[key + "_pos"], float), dt)
            res.append(p)
        out = res
    if settle > 0 and not loop:
        m = int(round(settle / dt))
        for j in range(max(0, n - m), n):
            a = A_s((j - (n - m)) / max(m - 1, 1))
            out[j] = _mix(out[j], params[j], a)
    return out


def _mix(a, b, t):
    q = {}
    for k in a:
        q[k] = (1 - t) * np.asarray(a[k], float) + t * np.asarray(b[k], float)
    return q


# ------------------------------------------------------------------------------------------------
# baking
# ------------------------------------------------------------------------------------------------

def bake2(rig, track, T, loop, frames=("chest", "chest"), layer=None, springs=None, settle=0.15, ground=False, ground_from=0.0,
          note="", rel=None, post=None, ground_clamp=True, relock_left=True):
    """Sample `track` at 120 Hz over T s, apply `layer(p, t)`, the overlap `springs`, resolve the weapon grips, then solve
    at 30 fps (T*30+1 frames; loops end on their first frame).  post(p, t) runs on the 30 fps params right before solving.
    ground=True keeps the body on y = 0 (clamp from the start, stick from ground_from)."""
    unwrap_angle_keys(track)
    n30 = int(round(T * A.FPS))
    step = int(round(HZ / A.FPS))
    nhi = n30 * step
    times_hi = np.arange(nhi + 1) / HZ
    params = track.sample(times_hi, loop=loop) if len(track.times) > 1 else [copy.deepcopy(track.vals[0]) for _ in times_hi]
    if layer is not None:
        params = [layer(p, float(t)) for p, t in zip(params, times_hi)]
    params = finger_filter(params, loop)
    if springs:
        if loop:
            params = overlap(rig, params[:-1], springs, loop=True, frames=frames) + [None]
            params[-1] = copy.deepcopy(params[0])
        else:
            params = overlap(rig, params, springs, loop=False, settle=settle, frames=frames)
    params30 = params[::step]
    times = np.arange(n30 + 1) / A.FPS
    rig.reset_state()
    Ls, hips, poses, used = [], [], [], []
    for t, p in zip(times, params30):
        if post is not None:
            p = post(copy.deepcopy(p), float(t))
        if rel is not None:
            p = resolve_grips(rig, p, rel)
        W, P = rig.solve(p, frames)
        if rel is not None and relock_left and "pw_pos" in p and float(p["attL"][0]) > 1e-3 and float(p["attR"][0]) > 0.999 and frames[0] == "chest":
            # the weapon follows the ACTUAL right hand (runtime: weapon parented to socket_hand_R) -> re-target the left hand
            p = _relock_left(rig, p, W, P, rel)
            W, P = rig.solve(p, frames)
        if ground:
            if frames[0] == "world":
                # limb targets never below the floor (they would lift the whole body when the pose is shifted up)
                p = copy.deepcopy(p)
                for S, fr in zip(("L", "R"), frames):
                    if fr == "world":
                        hp = np.asarray(p["h%s_pos" % S], float).copy()
                        hp[1] = max(hp[1], 0.045 * rig.k)
                        p["h%s_pos" % S] = hp
                    fp = np.asarray(p["f%s_pos" % S], float).copy()
                    fp[1] = max(fp[1], 0.055 * rig.k)
                    p["f%s_pos" % S] = fp
                W, P = rig.solve(p, frames)
            low = rig.lowest(W, P)
            if (ground_clamp and low < 0.0) or t >= ground_from:
                # rigid shift of the whole pose (hips + every world-space target)
                p = copy.deepcopy(p)
                dy = np.array([0.0, -low, 0.0])
                p["hips_pos"] = np.asarray(p["hips_pos"]) + dy
                if frames[0] == "world":
                    for S, fr in zip(("L", "R"), frames):
                        if fr == "world":
                            p["h%s_pos" % S] = np.asarray(p["h%s_pos" % S], float) + dy
                        p["f%s_pos" % S] = np.asarray(p["f%s_pos" % S], float) + dy
                W, P = rig.solve(p, frames)
        Ls.append(rig.local_from_world(W))
        hips.append(P[0].copy())
        poses.append((W, P))
        used.append(p)
    rig.state = None
    Ls = np.array(Ls)
    q = R.from_matrix(Ls.reshape(-1, 3, 3)).as_quat().reshape(len(times), NB, 4)
    for t in range(1, len(q)):
        dots = np.sum(q[t] * q[t - 1], axis=-1)
        q[t][dots < 0] *= -1.0
    if loop:
        q[-1] = q[0]
        hips[-1] = hips[0]
    return dict(times=times, rot=q, hips_t=np.array(hips), loop=loop, note=note, _poses=poses, _params=used)


ANGLE_KEYS = ("fL_yaw", "fL_pitch", "fL_roll", "fR_yaw", "fR_pitch", "fR_roll", "toeL", "toeR")


def unwrap_angle_keys(track):
    """Euler-angle parameters (degrees) of successive keys: take the representative closest to the previous key so the
    interpolation never goes the long way round (feet of tumbling bodies)."""
    for k in ANGLE_KEYS:
        prev = None
        for v in track.vals:
            if k not in v:
                continue
            x = float(np.asarray(v[k]).ravel()[0])
            if prev is not None:
                x = prev + ((x - prev + 180.0) % 360.0 - 180.0)
                v[k] = np.array([x])
            prev = x


def finger_filter(params, loop, hz=HZ, f=7.0, z=0.9):
    """Critically-damped low-pass on the finger curls (fgL/fgR): hands open/close over ~0.1 s instead of snapping."""
    if not params or "fgL" not in params[0]:
        return params
    out = [dict(p) for p in params]
    dt = 1.0 / hz
    for key in ("fgL", "fgR"):
        x = np.asarray(params[0][key], float).copy()
        if loop:
            x = np.asarray(params[-1][key], float).copy()
        v = np.zeros_like(x)
        w0 = 2 * np.pi * f
        passes = 2 if loop else 1
        for ps in range(passes):
            for i, p in enumerate(params):
                tgt = np.asarray(p[key], float)
                v += (w0 * w0 * (tgt - x) - 2 * z * w0 * v) * dt
                x = x + v * dt
                if ps == passes - 1:
                    out[i][key] = x.copy()
    if loop:
        out[-1] = dict(out[-1])
        out[-1]["fgL"], out[-1]["fgR"] = out[0]["fgL"], out[0]["fgR"]
    return out


def _relock_left(rig, p, W, P, rel):
    """Left-hand grip target recomputed from the solved right hand (weapon frame = hand * rel^-1)."""
    Wh = W[IDX["RightHand"]]
    grip = P[IDX["RightHand"]] + Wh @ rig.hand["R"]["grip_local"]
    Wweap = Wh @ rel.R.T
    Cpos, Crot = W[IDX["Spine2"]], W[IDX["Spine2"]]
    Cpos = P[IDX["Spine2"]]
    aL = float(np.clip(p["attL"][0], 0, 1))
    tgt = grip + Wweap @ np.asarray(p["gL_pos"], float)
    RhA = _hand_rot(rig, "L", Wweap @ p["gL_f"], Wweap @ p["gL_p"])
    cur_pos = Cpos + Crot @ np.asarray(p["hL_pos"], float)
    cur_R = _hand_rot(rig, "L", Crot @ p["hL_f"], Crot @ p["hL_p"])
    # only the attached share moves (the free share was already blended in by resolve_grips)
    new_pos = cur_pos + aL * (tgt - _attached_pos(rig, p, rel, Cpos, Crot))
    Rh = _slerp_m(cur_R, RhA, aL) if aL < 1 else RhA
    q = dict(p)
    q["hL_pos"] = Crot.T @ (new_pos - Cpos)
    f, pal = _hand_dirs(rig, "L", Rh)
    q["hL_f"], q["hL_p"] = Crot.T @ f, Crot.T @ pal
    return q


def _attached_pos(rig, p, rel, Cpos, Crot):
    O = np.asarray(p["pw_pos"], float)
    Wr = rvm(p["pw_rot"])
    return Cpos + Crot @ (O + Wr @ np.asarray(p["gL_pos"], float))


def weapon_error(rig, clip, rel):
    """Max angle (deg) / distance (m) between the authored weapon frame and the one the runtime would get from the right
    hand (socket_hand_R), over frames where attR = 1."""
    ang, dist = 0.0, 0.0
    for (W, P), p in zip(clip["_poses"], clip["_params"]):
        if "pw_pos" not in p or float(p["attR"][0]) < 0.999:
            continue
        Wh = W[IDX["RightHand"]]
        grip = P[IDX["RightHand"]] + Wh @ rig.hand["R"]["grip_local"]
        Cpos, Crot = P[IDX["Spine2"]], W[IDX["Spine2"]]
        O = Cpos + Crot @ np.asarray(p["pw_pos"], float)
        Rw = Crot @ rvm(p["pw_rot"])
        Wweap = Wh @ rel.R.T
        ang = max(ang, float(np.degrees(np.linalg.norm(R.from_matrix(Rw.T @ Wweap).as_rotvec()))))
        dist = max(dist, float(np.linalg.norm(grip - O)))
    return ang, dist
