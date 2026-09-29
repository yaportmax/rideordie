"""fp_arms: fit both hands onto the REAL weapon meshes (numpy / scipy venv).

For every weapon the posed hand (skinned fp_arms mesh) is placed rigidly on the gun and its fingers are re-fitted against the gun
surface, alternating a few times:
  * right hand: palm pressed on the pistol grip, no interpenetration, index distal pad on the trigger face, thumb over the left panel;
  * left hand : palm on the handguard / fore-end (C-grip) or round the vertical front grip (RPG), or - pistols - cupping the right
                fist and the left grip panel (the field is then gun + posed right hand).
The rigid placement becomes the weapon's grip_R / grip_L socket (position + rotation, G frame); the finger angles become the pose
clips (pose_rifle = rifle, pose_pistol = pistol, pose_launcher = rpg, and per-weapon pose_<gun> clips for the others).

Inputs : tools/characters/_cache/fp_arms/gun_<name>.npz   (tools/blender/weapons/grip_extract.py, Blender)
Outputs: tools/blender/weapons/hand_sockets.json          (read by the weapon build scripts + patch_hand_sockets.py)
         tools/characters/_cache/fp_arms/hand_poses.json  (read by fp_arms_fit.solve_poses -> fp_arms.glb clips)
    python tools/characters/fp_arms_place.py [gun ...]
"""
import json
import os
import sys
import time

import numpy as np
from scipy.optimize import minimize
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation as R

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fp_arms_rig as RIG  # noqa: E402
import fp_arms_fit as F  # noqa: E402

CACHE = os.path.join(HERE, "_cache", "fp_arms")
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SOCK_JSON = os.path.join(ROOT, "tools", "blender", "weapons", "hand_sockets.json")
POSE_JSON = os.path.join(CACHE, "hand_poses.json")

# grip rake (deg) of each weapon's pistol grip (G frame: top forward), used for the initial placement only
RAKE = {"rifle": 20.0, "pistol": 20.0, "revolver": 22.0, "smg": 16.0, "shotgun": 18.0, "lmg": 14.0, "sniper": 4.0, "rpg": 12.0}
CLIP = {"rifle": "pose_rifle", "pistol": "pose_pistol", "rpg": "pose_launcher", "smg": "pose_smg", "shotgun": "pose_shotgun",
        "lmg": "pose_lmg", "sniper": "pose_sniper", "revolver": "pose_revolver"}
LEFT_KIND = {"rifle": "hg", "smg": "hg", "shotgun": "hg", "lmg": "hg", "sniper": "hg", "pistol": "cup", "revolver": "cup", "rpg": "vgrip"}


def unit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


# ------------------------------------------------------------------------------------------------ signed distance field
class Field:
    """Signed distance to a triangle soup (mm), from dense surface samples with face normals (sign = outward normal)."""

    def __init__(self, tris, spacing=0.7, seed=0):
        tris = np.asarray(tris, float)
        a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
        n = np.cross(b - a, c - a)
        ln = np.linalg.norm(n, axis=1)
        keep = ln > 1e-9
        a, b, c, n, ln = a[keep], b[keep], c[keep], n[keep], ln[keep]
        nu = n / ln[:, None]
        k = np.clip(np.ceil(0.5 * ln / spacing ** 2), 1, 20000).astype(int)
        rep = np.repeat(np.arange(len(a)), k)
        rng = np.random.default_rng(seed)
        u, v = rng.random(len(rep)), rng.random(len(rep))
        fl = u + v > 1
        u[fl], v[fl] = 1 - u[fl], 1 - v[fl]
        pts = a[rep] + (b - a)[rep] * u[:, None] + (c - a)[rep] * v[:, None]
        self.P = np.concatenate([pts, a, b, c])
        self.N = np.concatenate([nu[rep], nu, nu, nu])
        self.tree = cKDTree(self.P)

    def sd(self, p):
        p = np.asarray(p, float)
        q = p.reshape(-1, 3)
        d, i = self.tree.query(q)
        s = np.einsum("ij,ij->i", q - self.P[i], self.N[i])
        return np.where(s < 0, -d, d).reshape(p.shape[:-1])


class Union:
    def __init__(self, *fields):
        self.fields = fields

    def sd(self, p):
        return np.min([f.sd(p) for f in self.fields], axis=0)


class Gun:
    def __init__(self, name):
        D = np.load(os.path.join(CACHE, "gun_%s.npz" % name))
        self.name = name
        self.tris, self.oid, self.names = D["tris"], D["oid"], [str(s) for s in D["names"]]
        self.s = {k[2:]: D[k] for k in D.files if k.startswith("s_")}

    def field(self, lo, hi, exclude=(), only=None, spacing=0.7):
        c = self.tris.mean(axis=1)
        m = np.all((c > np.asarray(lo)) & (c < np.asarray(hi)), axis=1)
        for i, n in enumerate(self.names):
            if n in exclude or (only is not None and n not in only):
                m &= self.oid != i
        return Field(self.tris[m], spacing)

    def trigger_face(self):
        """Point on the trigger blade's front face where the distal pad presses (G mm)."""
        i = self.names.index("trigger")
        V = self.tris[self.oid == i].reshape(-1, 3)
        V = V[np.abs(V[:, 1]) < 3.0]
        zmin, zmax = V[:, 2].min(), V[:, 2].max()
        zc = zmin + 0.35 * (zmax - zmin)
        band = V[np.abs(V[:, 2] - zc) < 2.5]
        return np.array([band[:, 0].max() + 0.3, 0.0, zc])


# ------------------------------------------------------------------------------------------------ posed hand mesh
class HandMesh:
    def __init__(self, rig, geo, side):
        self.rig, self.side = rig, side
        W = geo["weights"]
        bones = rig.bones
        hb = [i for i, b in enumerate(bones) if b.startswith(side + "Hand")]
        self.sel = W[:, hb].sum(1) > 0.5
        self.pos = geo["pos"][self.sel]
        self.W = W[self.sel]
        fr = rig.frames[side]
        palm = -fr["dorsal"]
        w = rig.H[side + "Hand"]
        mc = np.mean([rig.H["%sHand%s1" % (side, f)] for f in F.FING], axis=0)
        hw = self.W[:, bones.index(side + "Hand")]
        rel = self.pos - (w + mc) * 0.5
        along = (self.pos - w) @ fr["d0"]
        L = np.dot(mc - w, fr["d0"])
        self.palm = (hw > 0.6) & (rel @ palm > 0.004) & (along > 0.15 * L) & (along < 1.05 * L)
        # triangles of the hand (for the union field of the pistol support hand)
        idx = geo["idx"].reshape(-1, 3)
        remap = -np.ones(len(geo["pos"]), int)
        remap[np.nonzero(self.sel)[0]] = np.arange(self.sel.sum())
        t = remap[idx]
        self.tri = t[(t >= 0).all(1)]

    def posed(self, pose_side):
        locs = self.rig.finger_locals({self.side: pose_side})
        return self.rig.skin(self.pos, self.W, locs)


def euler_g(Rg):
    """G-frame rotation matrix -> gunlib socket rot (deg, Blender Euler 'XYZ' = extrinsic x, y, z)."""
    return [round(float(a), 3) for a in R.from_matrix(Rg).as_euler("xyz", degrees=True)]


# ------------------------------------------------------------------------------------------------ fitting
class Placement:
    """Rigid transform socket frame (G mm) -> weapon (G mm): p_w = Rg p_s + t."""

    def __init__(self, R0, t0):
        self.R0, self.t0 = np.asarray(R0, float), np.asarray(t0, float)
        self.x = np.zeros(6)

    def mat(self, x=None):
        x = self.x if x is None else x
        Rg = R.from_rotvec(np.radians(x[3:])).as_matrix() @ self.R0
        return Rg, self.t0 + x[:3]

    def to_w(self, p, x=None):
        Rg, t = self.mat(x)
        return p @ Rg.T + t

    def to_s(self, p, x=None):
        Rg, t = self.mat(x)
        return (p - t) @ Rg


def fit_fingers(hand, sdf, specs, spread, pose):
    """specs: {finger: dict(x0, lo, hi, target?, tw?, pad_target?, pw?, contact_w?)} -> updates pose dict in place."""
    for f, fs in specs.items():
        x0 = fs["x0"] if f not in pose else (tuple(pose[f]) + (tuple(pose.get("thumb", (0, 0))) if f == "Thumb" else ()))
        ang, th, c = F.fit_finger(hand, f, sdf, fs["lo"], fs["hi"], x0, fs.get("target"), fs.get("tw", 0.0), fs.get("contact_w", 1.0),
                                  spread, pad_target=fs.get("pad_target"), pw=fs.get("pw", 0.0))
        pose[f] = tuple(round(float(a), 1) for a in ang)
        if f == "Thumb":
            pose["thumb"] = tuple(round(float(a), 1) for a in th)
        pose["_cost_" + f] = round(c, 2)
    pose["spread"] = spread
    return pose


def place_cost(pl, x, field, ps, palm, pads=None, pad_goal=None, pad_w=0.05, fix_x=None, reg=0.02, contact_w=0.5):
    pw = pl.to_w(ps, x)
    sd = field.sd(pw)
    c = np.sum(np.maximum(-sd - 0.4, 0.0) ** 2)
    sp = np.sort(sd[palm])[: max(8, palm.sum() // 3)]
    c += contact_w * np.mean(np.maximum(sp, 0.0) ** 2) * 10.0
    if pads is not None:
        c += pad_w * np.sum((pl.to_w(pads, x) - pad_goal) ** 2)
    if fix_x is not None:            # stay near the authored position along the barrel (the arm reach was tuned for it)
        c += 0.02 * (x[0] - fix_x) ** 2
    c += reg * np.sum(x[3:] ** 2)
    return c


def optimise_place(pl, cost, starts, bounds):
    best = None
    for s in starts:
        r = minimize(cost, np.asarray(s, float), method="Powell", bounds=bounds, options=dict(xtol=0.05, ftol=1e-4, maxiter=6000))
        if best is None or r.fun < best.fun:
            best = r
    pl.x = best.x
    return best.fun


def index_pad(hand, pose):
    g = hand.finger("Index", pose["Index"], pose.get("spread", 0.0))
    return (g["pads"][4] + g["pads"][5]) * 0.5


def fit_right(gun, rig, geo, S, verbose=True):
    pR, RR, gR = F.socket_R(rig, S)
    hand = F.Hand(rig, "Right", pR, RR)
    hm = HandMesh(rig, geo, "Right")
    field = gun.field((-220, -120, -160), (260, 120, 230))
    trig = gun.trigger_face()
    ga = RAKE[gun.name]
    R0 = R.from_euler("y", ga - F.RAKE_R, degrees=True).as_matrix()
    ax = np.array([np.sin(np.radians(ga)), 0.0, np.cos(np.radians(ga))])
    # start: grip centre on the grip axis where the index plane (~z 25 in the socket frame) meets the trigger height
    h = (trig[2] - 26.0) / ax[2]
    pl = Placement(R0, ax * h)
    pose = {"spread": -3.0, "Thumb": (15, 25, 15), "thumb": (30, 20), "Index": (30, 45, 25), "Middle": (75, 90, 45),
            "Ring": (78, 90, 45), "Pinky": (80, 85, 45)}
    FL, FH = F.FLO, F.FHI
    for it in range(3):
        Rg, t = pl.mat()
        sdf_s = lambda p: field.sd(p @ Rg.T + t)          # noqa: E731
        trig_s = (trig - t) @ Rg
        thumb_t = (np.array([25.0, 20.0, 46.0]))
        specs = {
            "Index": dict(x0=(30, 45, 25), lo=FL, hi=FH, pad_target=trig_s, pw=1.0, contact_w=0.0),
            "Middle": dict(x0=(75, 90, 45), lo=FL, hi=FH), "Ring": dict(x0=(78, 90, 45), lo=FL, hi=FH),
            "Pinky": dict(x0=(80, 85, 45), lo=FL, hi=FH),
            "Thumb": dict(x0=(15, 25, 15, 30, 20), lo=F.TLO, hi=F.THI, target=thumb_t, tw=0.25, contact_w=0.5)}
        fit_fingers(hand, sdf_s, specs, -3.0, pose)
        ps = hand.to_g(hm.posed({k: v for k, v in pose.items() if not k.startswith("_")}))
        pad = index_pad(hand, pose)
        cost = lambda x: place_cost(pl, x, field, ps, hm.palm, pads=pad[None], pad_goal=trig[None], pad_w=0.08)  # noqa: E731
        x0 = pl.x.copy()
        starts = [x0, x0 + [0, 0, 6, 0, 0, 0], x0 + [0, 0, -6, 0, 0, 0], x0 + [-5, 0, 0, 0, 0, 0]]
        b = [(x0[0] - 25, x0[0] + 25), (-12, 12), (x0[2] - 30, x0[2] + 30), (-14, 14), (-14, 14), (-14, 14)]
        fc = optimise_place(pl, cost, starts, b)
        if verbose:
            Rg, t = pl.mat()
            pw = pl.to_w(ps)
            sd = field.sd(pw)
            print("  R it%d cost %.1f  t %s  rot %s  pen>1mm %d  max pen %.1f  pad->trig %.1f mm" % (
                it, fc, np.round(t, 1), euler_g(Rg), int((sd < -1).sum()), -sd.min(), np.linalg.norm(pl.to_w(pad) - trig)))
    return pl, pose, hand, hm, field


def left_specs(kind):
    FL, FH = F.FLO, F.FHI
    if kind == "vgrip":
        return {"Index": dict(x0=(70, 85, 40), lo=FL, hi=FH), "Middle": dict(x0=(72, 88, 40), lo=FL, hi=FH),
                "Ring": dict(x0=(78, 90, 40), lo=FL, hi=FH), "Pinky": dict(x0=(82, 88, 40), lo=FL, hi=FH),
                "Thumb": dict(x0=(20, 25, 20, 30, 20), lo=F.TLO, hi=F.THI, contact_w=0.6)}, -2.0
    if kind == "cup":
        return {"Index": dict(x0=(55, 70, 30), lo=FL, hi=FH), "Middle": dict(x0=(60, 72, 32), lo=FL, hi=FH),
                "Ring": dict(x0=(64, 74, 34), lo=FL, hi=FH), "Pinky": dict(x0=(68, 74, 34), lo=FL, hi=FH),
                "Thumb": dict(x0=(20, 10, 5, 5, 5), lo=F.TLO, hi=F.THI, contact_w=0.4)}, -2.0
    return {"Index": dict(x0=(45, 60, 30), lo=FL, hi=FH), "Middle": dict(x0=(50, 65, 32), lo=FL, hi=FH),
            "Ring": dict(x0=(55, 66, 34), lo=FL, hi=FH), "Pinky": dict(x0=(60, 68, 34), lo=FL, hi=FH),
            "Thumb": dict(x0=(10, 15, 10, 20, 20), lo=F.TLO, hi=F.THI, contact_w=0.5)}, 2.0


def fit_left(gun, rig, geo, S, right=None, verbose=True):
    pL, RL, gL = F.socket_L(rig, S)
    hand = F.Hand(rig, "Left", pL, RL)
    hm = HandMesh(rig, geo, "Left")
    kind = LEFT_KIND[gun.name]
    g0 = np.asarray(gun.s["grip_L"], float)
    lo, hi = g0 - 170, g0 + 170
    field = gun.field(lo, hi)
    if kind == "cup" and right is not None:
        # the support hand wraps the right fist as well
        plR, poseR, handR, hmR, _ = right
        P = handR.to_g(hmR.posed({k: v for k, v in poseR.items() if not k.startswith("_")}))
        Pw = plR.to_w(P)
        field = Union(field, Field(Pw[hmR.tri], spacing=1.0))
    specs, spread = left_specs(kind)
    if kind == "hg":
        R0s = [np.eye(3)]
        t0 = g0.copy()
    elif kind == "vgrip":
        # palm faces the gun's right (-y) round a vertical grip: roll +90 about the barrel axis, fingers point back/right
        R0s = [R.from_euler("x", 90, degrees=True).as_matrix() @ R.from_euler("z", a, degrees=True).as_matrix() for a in (-90, -60, -120)]
        t0 = g0.copy()
    else:
        R0s = [R.from_euler("x", 90, degrees=True).as_matrix() @ R.from_euler("z", a, degrees=True).as_matrix() for a in (-20, 20, 60)]
        t0 = g0.copy()
    best = None
    for R0 in R0s:
        pl = Placement(R0, t0)
        pose = {"spread": spread}
        for f, fs in specs.items():
            pose[f] = tuple(fs["x0"][:3])
            if f == "Thumb":
                pose["thumb"] = tuple(fs["x0"][3:])
        fc = None
        for it in range(3):
            ps = hand.to_g(hm.posed({k: v for k, v in pose.items() if not k.startswith("_")}))
            cost = lambda x: place_cost(pl, x, field, ps, hm.palm, fix_x=0.0 if kind == "hg" else None, contact_w=1.0)  # noqa: E731
            x0 = pl.x.copy()
            b = [(x0[0] - 20, x0[0] + 20), (x0[1] - 30, x0[1] + 30), (x0[2] - 30, x0[2] + 30), (-35, 35), (-35, 35), (-35, 35)]
            starts = [x0, x0 + [0, 0, -8, 0, 0, 0], x0 + [0, 8, 0, 0, 0, 0], x0 + [0, -8, 0, 0, 0, 0]]
            fc = optimise_place(pl, cost, starts, b)
            Rg, t = pl.mat()
            sdf_s = lambda p: field.sd(p @ Rg.T + t)  # noqa: E731
            fit_fingers(hand, sdf_s, specs, spread, pose)
            if verbose:
                pw = pl.to_w(hand.to_g(hm.posed({k: v for k, v in pose.items() if not k.startswith("_")})))
                sd = field.sd(pw)
                print("  L it%d cost %.1f  t %s  rot %s  pen>1mm %d  max pen %.1f  fingers %s" % (
                    it, fc, np.round(t, 1), euler_g(Rg), int((sd < -1).sum()), -sd.min(),
                    {k: v for k, v in pose.items() if k in F.FING or k == "Thumb"}))
        ps = hand.to_g(hm.posed({k: v for k, v in pose.items() if not k.startswith("_")}))
        score = place_cost(pl, pl.x, field, ps, hm.palm, contact_w=1.0) + sum(v for k, v in pose.items() if k.startswith("_cost"))
        if best is None or score < best[0]:
            best = (score, pl, pose)
    return best[1], best[2], hand, hm, field


def socket_entry(pl):
    Rg, t = pl.mat()
    return dict(pos=[round(float(v), 2) for v in t], rot=euler_g(Rg))


def main(guns):
    t0 = time.time()
    S = np.load(os.path.join(CACHE, "stage1.npz"))
    geo = dict(np.load(os.path.join(CACHE, "stage2.npz")))
    rig = RIG.FpRig(S)
    socks = json.load(open(SOCK_JSON)) if os.path.exists(SOCK_JSON) else {}
    poses = json.load(open(POSE_JSON)) if os.path.exists(POSE_JSON) else {}
    for name in guns:
        print("==", name)
        gun = Gun(name)
        right = fit_right(gun, rig, geo, S)
        plL, poseL, *_ = fit_left(gun, rig, geo, S, right=right)
        socks[name] = dict(grip_R=socket_entry(right[0]), grip_L=socket_entry(plL))
        clean = lambda p: {k: (list(v) if isinstance(v, tuple) else v) for k, v in p.items()}  # noqa: E731
        poses[CLIP[name]] = dict(Right=clean(right[1]), Left=clean(poseL), gun=name)
        print("  grip_R", socks[name]["grip_R"], " grip_L", socks[name]["grip_L"])
        json.dump(socks, open(SOCK_JSON, "w"), indent=1)
        json.dump(poses, open(POSE_JSON, "w"), indent=1)
    print("done %.0fs" % (time.time() - t0))


if __name__ == "__main__":
    main(sys.argv[1:] or ["rifle", "pistol", "shotgun", "smg", "lmg", "sniper", "rpg", "revolver"])
