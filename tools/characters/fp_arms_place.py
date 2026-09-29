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
SCAN_R = False
# manual right-hand adjustments per gun (mm): (along the grip axis, fore-aft across it, lateral) from the index-to-trigger start
R_ADJ = {}
# manual left-hand adjustments (mm, G axes) from the handguard-bottom contact point under the authored grip_L
L_ADJ = {}
LEFT_KIND = {"rifle": "hg", "smg": "hg", "shotgun": "hg", "lmg": "hg", "sniper": "hg", "pistol": "cup", "revolver": "cup", "rpg": "vgrip"}


def unit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


# ------------------------------------------------------------------------------------------------ signed distance field
class Field:
    """Signed distance to a triangle soup (mm): unsigned distance from dense surface samples; the sign comes from the nearest
    face normal close to the surface (< 1.2 mm) and from a winding-number occupancy grid deeper inside (robust to hidden inner
    faces / overlapping closed parts, where a nearest-normal sign flips)."""

    def __init__(self, tris, spacing=0.7, seed=0, roi=None, all_tris=None, vox=1.25):
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
        self.occ = None
        if roi is not None:
            self.lo, self.h = np.asarray(roi[0], float), vox
            self.occ = winding_grid(np.asarray(all_tris if all_tris is not None else tris, float), roi[0], roi[1], vox)

    def inside(self, q):
        if self.occ is None:
            return None
        ijk = np.floor((q - self.lo) / self.h).astype(int)
        sh = np.array(self.occ.shape)
        ok = np.all((ijk >= 0) & (ijk < sh), axis=1)
        out = np.zeros(len(q), bool)
        i = ijk[ok]
        out[ok] = self.occ[i[:, 0], i[:, 1], i[:, 2]]
        return out

    def sd(self, p):
        p = np.asarray(p, float)
        q = p.reshape(-1, 3)
        d, i = self.tree.query(q, workers=-1)
        s = np.einsum("ij,ij->i", q - self.P[i], self.N[i])
        neg = s < 0
        ins = self.inside(q)
        if ins is not None:
            neg = np.where(d < 1.2, neg, ins)
        return np.where(neg, -d, d).reshape(p.shape[:-1])


def winding_grid(tris, lo, hi, h):
    """Occupancy (bool grid, cell (i,j,k) covers lo + [i,j,k]*h .. +h) by the winding number along +x rays through the cell
    centres: +1 entering a face whose outward normal points -x, -1 leaving."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    nxc, nyc, nzc = [int(np.ceil((hi[d] - lo[d]) / h)) for d in range(3)]
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    nx = np.cross(b - a, c - a)[:, 0]
    ymin, ymax = np.minimum(np.minimum(a[:, 1], b[:, 1]), c[:, 1]), np.maximum(np.maximum(a[:, 1], b[:, 1]), c[:, 1])
    zmin, zmax = np.minimum(np.minimum(a[:, 2], b[:, 2]), c[:, 2]), np.maximum(np.maximum(a[:, 2], b[:, 2]), c[:, 2])
    j0 = np.maximum(np.ceil((ymin - lo[1]) / h - 0.5), 0).astype(int)
    j1 = np.minimum(np.floor((ymax - lo[1]) / h - 0.5), nyc - 1).astype(int)
    k0 = np.maximum(np.ceil((zmin - lo[2]) / h - 0.5), 0).astype(int)
    k1 = np.minimum(np.floor((zmax - lo[2]) / h - 0.5), nzc - 1).astype(int)
    wj, wk = j1 - j0 + 1, k1 - k0 + 1
    ok = (np.abs(nx) > 1e-12) & (wj > 0) & (wk > 0)
    idx = np.nonzero(ok)[0]
    cnt = (wj * wk)[idx]
    delta = np.zeros((nyc, nzc, nxc + 1), np.int16)
    # chunked so the pair arrays stay small
    start = 0
    csum = np.cumsum(cnt)
    while start < len(idx):
        end = int(np.searchsorted(csum, (csum[start - 1] if start else 0) + 4_000_000, side="right"))
        end = max(end, start + 1)
        ii, cc = idx[start:end], cnt[start:end]
        rep = np.repeat(ii, cc)
        off = np.arange(cc.sum()) - np.repeat(np.cumsum(cc) - cc, cc)
        wjr = wj[rep]
        jj = j0[rep] + off % wjr
        kk = k0[rep] + off // wjr
        py = lo[1] + (jj + 0.5) * h
        pz = lo[2] + (kk + 0.5) * h
        A, B, C = a[rep], b[rep], c[rep]
        v0y, v0z = C[:, 1] - A[:, 1], C[:, 2] - A[:, 2]
        v1y, v1z = B[:, 1] - A[:, 1], B[:, 2] - A[:, 2]
        v2y, v2z = py - A[:, 1], pz - A[:, 2]
        den = v0y * v1z - v1y * v0z
        good = np.abs(den) > 1e-12
        den = np.where(good, den, 1.0)
        uu = (v2y * v1z - v1y * v2z) / den
        vv = (v0y * v2z - v2y * v0z) / den
        hit = good & (uu >= 0) & (vv >= 0) & (uu + vv <= 1)
        x = A[:, 0] + uu * (C[:, 0] - A[:, 0]) + vv * (B[:, 0] - A[:, 0])
        ix = np.clip(np.ceil((x - lo[0]) / h - 0.5), 0, nxc).astype(int)
        sgn = np.where(nx[rep] < 0, 1, -1).astype(np.int16)
        np.add.at(delta, (jj[hit], kk[hit], ix[hit]), sgn[hit])
        start = end
    wind = np.cumsum(delta[:, :, :nxc], axis=2)
    return np.ascontiguousarray((wind > 0).transpose(2, 0, 1))


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
        return Field(self.tris[m], spacing, roi=(lo, hi), all_tris=self.tris)

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
    """The fp_arms hand (+ glove) vertices of one side, with finger / phalanx labels, skinned for any finger pose."""

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
        # finger labels
        self.fw = {}            # finger -> summed weight of its 3 bones
        self.seg = {}           # finger -> (V,) index 0..2 of the dominant phalanx (or -1)
        for f in RIG.FINGERS:
            cols = [bones.index("%sHand%s%d" % (side, f, k)) for k in (1, 2, 3)]
            ww = self.W[:, cols]
            self.fw[f] = ww.sum(1)
            sg = np.argmax(ww, axis=1)
            sg[ww.max(1) < 0.5] = -1
            self.seg[f] = sg
        fsum = np.sum([self.fw[f] for f in RIG.FINGERS], axis=0)
        self.body = fsum < 0.25
        # triangles of the hand (for the union field of the pistol support hand)
        idx = geo["idx"].reshape(-1, 3)
        remap = -np.ones(len(geo["pos"]), int)
        remap[np.nonzero(self.sel)[0]] = np.arange(self.sel.sum())
        t = remap[idx]
        self.tri = t[(t >= 0).all(1)]
        # placement subsample: every 3rd vertex + the whole palm
        sub = np.zeros(len(self.pos), bool)
        sub[::3] = True
        self.sub = sub | self.palm

    def posed(self, pose_side, mask=None):
        locs = self.rig.finger_locals({self.side: pose_side})
        if mask is None:
            return self.rig.skin(self.pos, self.W, locs)
        return self.rig.skin(self.pos[mask], self.W[mask], locs)


def euler_g(Rg):
    """G-frame rotation matrix -> gunlib socket rot (deg, Blender Euler 'XYZ' = extrinsic x, y, z)."""
    return [round(float(a), 3) for a in R.from_matrix(Rg).as_euler("xyz", degrees=True)]


def clean_pose(p):
    return {k: v for k, v in p.items() if not k.startswith("_")}


# ------------------------------------------------------------------------------------------------ fitting
class Placement:
    """Rigid transform socket frame (G mm) -> weapon (G mm): p_w = Rg p_s + t."""

    def __init__(self, R0, t0, basis=None):
        self.R0, self.t0 = np.asarray(R0, float), np.asarray(t0, float)
        self.B = np.eye(3) if basis is None else np.asarray(basis, float)     # columns: translation directions of x[0..2]
        self.x = np.zeros(6)

    def mat(self, x=None):
        x = self.x if x is None else x
        Rg = R.from_rotvec(np.radians(x[3:])).as_matrix() @ self.R0
        return Rg, self.t0 + self.B @ x[:3]

    def to_w(self, p, x=None):
        Rg, t = self.mat(x)
        return p @ Rg.T + t


def report(tag, pl, hand, hm, field, pose, extra=""):
    V = pl.to_w(hand.to_g(hm.posed(clean_pose(pose))))
    sd = field.sd(V)
    Rg, t = pl.mat()
    fing = {k: v for k, v in pose.items() if k in RIG.FINGERS or k == "thumb"}
    print("  %s t %s rot %s | pen>1mm %d max %.1f | palm gap %.1f %s\n     %s" % (
        tag, np.round(t, 1), euler_g(Rg), int((sd < -1).sum()), -sd.min(), np.median(np.sort(sd[hm.palm])[:20]), extra, fing))


def fit_fingers(hand, pl, field, specs, pose, order):
    """Analytic finger model (joint axes + pad points, fp_arms_fit.fit_finger) against the real gun field."""
    Rg, t = pl.mat()
    sdf_s = lambda p: field.sd(p @ Rg.T + t)          # noqa: E731
    to_s = lambda p: (np.asarray(p, float) - t) @ Rg  # noqa: E731
    for f in order:
        fs = specs[f]
        if f == "Thumb":
            x0 = tuple(pose.get("Thumb", fs["x0"][:3])) + tuple(pose.get("thumb", fs["x0"][3:]))
        else:
            x0 = tuple(pose.get(f, fs["x0"]))
        tgt = fs.get("target_s")
        if tgt is None and fs.get("target") is not None:
            tgt = to_s(fs["target"])
        ptg = to_s(fs["pad_target"]) if fs.get("pad_target") is not None else None
        ang, th, c = F.fit_finger(hand, f, sdf_s, fs["lo"], fs["hi"], x0, tgt, fs.get("tw", 0.0), fs.get("contact_w", 1.0),
                                  pose.get("spread", 0.0), pad_target=ptg, pw=fs.get("pw", 0.0))
        pose[f] = tuple(round(float(a), 1) for a in ang)
        if f == "Thumb":
            pose["thumb"] = tuple(round(float(a), 1) for a in th)
        pose["_cost_" + f] = round(float(c), 2)
    return pose


class Contact:
    """Penetration / palm-contact measures of the rigid hand (fingers excluded) for a Placement."""

    def __init__(self, hand, hm, pose, field, pl, thumb_w=0.6):
        psf = hand.to_g(hm.posed(clean_pose(pose)))
        fsum = sum(hm.fw[f] for f in F.FING)
        side = hand.side
        bi = [hm.rig.bones.index("%sHandThumb%d" % (side, k)) for k in (1, 2, 3)]
        t1 = hm.W[:, bi[0]]
        t23 = hm.W[:, bi[1]] + hm.W[:, bi[2]]
        # rigid part = palm / back of the hand / thumb metacarpal; phalanges are re-fitted afterwards
        w = np.where((fsum > 0.35) | (t23 > 0.35), 0.0, np.where(t1 > 0.5, thumb_w, 1.0))
        keep = (w > 0) | hm.palm
        self.ps, self.w, self.palm = psf[keep], w[keep], hm.palm[keep]
        self.field, self.pl = field, pl

    def terms(self, x):
        sd = self.field.sd(self.pl.to_w(self.ps, x))
        pen = float(np.sum(self.w * np.maximum(-sd - 0.3, 0.0) ** 2))
        gap = float(np.mean(np.maximum(np.sort(sd[self.palm])[:20], 0.0)))
        return pen, gap


def grid_min(fn, axes):
    """Brute force over a small grid: axes = list of 1D arrays -> (best x, best value)."""
    best, bx = None, None
    for x in np.stack(np.meshgrid(*axes, indexing="ij"), -1).reshape(-1, len(axes)):
        v = fn(x)
        if best is None or v < best:
            best, bx = v, x
    return bx, best


def fit_right(gun, rig, geo, S, verbose=True):
    """Right hand on the pistol grip: grip axis aligned (rake), palm on the right panel, the hand slid UP the grip until the web
    meets the tang (high grip); then the fingers are fitted on the real surface, the index pad on the trigger face."""
    t1 = time.time()
    pR, RR, gR = F.socket_R(rig, S)
    hand = F.Hand(rig, "Right", pR, RR)
    hm = HandMesh(rig, geo, "Right")
    field = gun.field((-220, -120, -160), (260, 120, 230))
    trig = gun.trigger_face()
    ga = RAKE[gun.name]
    R0 = R.from_euler("y", ga - F.RAKE_R, degrees=True).as_matrix()
    ax = np.array([np.sin(np.radians(ga)), 0.0, np.cos(np.radians(ga))])
    fp = np.array([np.cos(np.radians(ga)), 0.0, -np.sin(np.radians(ga))])
    h0 = (trig[2] - 26.0) / ax[2]
    pl = Placement(R0, ax * h0, basis=np.stack([ax, fp, [0.0, 1.0, 0.0]], axis=1))
    pose = {"spread": -3.0, "Thumb": (15, 25, 15), "thumb": (30, 20), "Index": (30, 45, 25), "Middle": (75, 90, 45),
            "Ring": (78, 90, 45), "Pinky": (80, 85, 45)}
    ct = Contact(hand, hm, pose, field, pl)

    def cost(hdy, push=0.5):
        x = np.array([hdy[0], hdy[1], hdy[2], 0.0, 0.0, 0.0])
        pen, gap = ct.terms(x)
        return pen + 4.0 * gap ** 2 - push * hdy[0] + 0.3 * hdy[1] ** 2 + 0.3 * hdy[2] ** 2
    # palm onto the panel (lateral / fore-aft) at the start height, then slide up the grip, then settle again
    if SCAN_R:
        x, _ = grid_min(lambda v: cost((0.0, v[0], v[1]), 0.0), [np.arange(-6, 6.1, 1.5), np.arange(-5, 5.1, 1.0)])
        d, y = x
        x, _ = grid_min(lambda v: cost((v[0], d, y)), [np.arange(-40, 40.1, 1.0)])
        hh = x[0]
        x, _ = grid_min(lambda v: cost((hh + v[0], v[1], v[2])), [np.arange(-2, 2.1, 1.0), np.arange(-6, 6.1, 1.5), np.arange(-5, 5.1, 1.0)])
        pl.x = np.array([hh + x[0], x[1], x[2], 0, 0, 0], float)
    else:
        # height fixed (index plane at the trigger, + manual R_ADJ); settle the palm onto the panel: lateral / fore-aft scan
        adj = R_ADJ.get(gun.name, (0, 0, 0))
        x, _ = grid_min(lambda v: cost((adj[0], v[0], v[1]), 0.0), [np.arange(-8, 8.1, 1.0), np.arange(-10, 4.1, 1.0)])
        pl.x = np.array([adj[0], x[0] + adj[1], x[1] + adj[2], 0, 0, 0], float)
    FH = F.FHI
    specs = {"Middle": dict(x0=(75, 90, 45), lo=(20, 30, 10), hi=FH), "Ring": dict(x0=(78, 90, 45), lo=(20, 30, 10), hi=FH),
             "Pinky": dict(x0=(80, 85, 45), lo=(20, 30, 10), hi=FH),
             "Index": dict(x0=(30, 45, 25), lo=(-10, 10, 5), hi=FH, pad_target=trig, pw=1.0, contact_w=0.0),
             "Thumb": dict(x0=(15, 25, 15, 30, 20), lo=F.TLO, hi=F.THI, target_s=np.array([25.0, 22.0, 40.0]), tw=0.3, contact_w=0.5)}
    fit_fingers(hand, pl, field, specs, pose, ("Middle", "Ring", "Pinky", "Index", "Thumb"))
    if verbose:
        pen, gap = ct.terms(pl.x)
        g = hand.finger("Index", pose["Index"], pose["spread"])
        P_ = pl.to_w(g["pads"][3:6])
        dt = min(np.linalg.norm(P_ - trig, axis=1))
        report("R (%.0fs) h %.1f d %.1f y %.1f" % (time.time() - t1, pl.x[0], pl.x[1], pl.x[2]), pl, hand, hm, field, pose,
               "pen %.1f trig %.1f mm" % (pen, dt))
    return pl, pose, hand, hm, field


def left_specs(kind):
    FH = F.FHI
    if kind == "vgrip":
        w = (25, 30, 10)
        return {"Index": dict(x0=(70, 85, 40), lo=w, hi=FH), "Middle": dict(x0=(72, 88, 40), lo=w, hi=FH),
                "Ring": dict(x0=(78, 90, 40), lo=w, hi=FH), "Pinky": dict(x0=(82, 88, 40), lo=w, hi=FH),
                "Thumb": dict(x0=(20, 25, 20, 30, 20), lo=F.TLO, hi=F.THI, contact_w=0.5)}, -2.0
    if kind == "cup":
        w = (10, 15, 5)
        return {"Index": dict(x0=(55, 70, 30), lo=w, hi=FH), "Middle": dict(x0=(60, 72, 32), lo=w, hi=FH),
                "Ring": dict(x0=(64, 74, 34), lo=w, hi=FH), "Pinky": dict(x0=(68, 74, 34), lo=w, hi=FH),
                "Thumb": dict(x0=(20, 10, 5, 5, 5), lo=F.TLO, hi=F.THI, contact_w=0.4)}, -2.0
    # handguard C-grip: fingers wrap up the right side, thumb lies forward along the left side (tip ~ at the centre height)
    w = (10, 15, 5)
    return {"Index": dict(x0=(45, 60, 30), lo=w, hi=FH), "Middle": dict(x0=(50, 65, 32), lo=w, hi=FH),
            "Ring": dict(x0=(55, 66, 34), lo=w, hi=FH), "Pinky": dict(x0=(60, 68, 34), lo=w, hi=FH),
            "Thumb": dict(x0=(0, 0, 0, 0, 15), fixed=True)}, 2.0     # thumb straight along the left side (checked in fp_qa)


def fit_left(gun, rig, geo, S, right=None, verbose=True):
    t1 = time.time()
    pL, RL, gL = F.socket_L(rig, S)
    hand = F.Hand(rig, "Left", pL, RL)
    hm = HandMesh(rig, geo, "Left")
    kind = LEFT_KIND[gun.name]
    g0 = np.asarray(gun.s["grip_L"], float)
    field = gun.field(g0 - 170, g0 + 170)
    if kind == "cup" and right is not None:
        plR, poseR, handR, hmR, _ = right
        Pw = plR.to_w(handR.to_g(hmR.posed(clean_pose(poseR))))
        field = Union(field, Field(Pw[hmR.tri], spacing=1.0))
    specs, spread = left_specs(kind)
    pose = {"spread": spread}
    for f, fs in specs.items():
        if f == "Thumb":
            pose["Thumb"], pose["thumb"] = tuple(fs["x0"][:3]), tuple(fs["x0"][3:])
        else:
            pose[f] = tuple(fs["x0"])
    if kind == "hg":
        R0s = [np.eye(3)]
    else:
        # palm toward the gun's right side (roll +90 about the barrel), spun about the palm normal
        # (cup: thumb forward along the frame, fingers down-forward over the right fist; vgrip: fingers forward round the grip)
        R0s = [R.from_euler("x", 90, degrees=True).as_matrix() @ R.from_euler("z", a, degrees=True).as_matrix()
               for a in ((-30, 0, 30) if kind == "cup" else (45, 65, 85))]
    best = None
    for R0 in R0s:
        pl = Placement(R0, g0.copy())
        ct = Contact(hand, hm, pose, field, pl, thumb_w=0.3)
        if kind == "hg":
            # the socket is the palm contact point: put it on the handguard's bottom surface under the bore (y = 0)
            zs = np.arange(g0[2] - 40.0, g0[2] + 60.0, 0.25)
            col = np.stack([np.full_like(zs, g0[0]), np.full_like(zs, L_ADJ.get(gun.name, (0, 0, 0))[1]), zs], -1)
            sdz = field.sd(col)
            zb = zs[np.argmax(sdz < 0)] if (sdz < 0).any() else g0[2]
            adj = L_ADJ.get(gun.name, (0, 0, 0))
            pl.x = np.array([adj[0], adj[1] - g0[1], zb - g0[2] + adj[2], 0, 0, 0])
            c = 0.0
        else:
            def cost(v):
                pen, gap = ct.terms(np.array([v[0], v[1], v[2], 0, 0, 0]))
                return pen + 4.0 * gap ** 2 + 0.01 * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
            x, c = grid_min(cost, [np.arange(-30, 30.1, 4.0)] * 3)
            x2, c = grid_min(cost, [x[k] + np.arange(-4, 4.1, 1.0) for k in range(3)])
            pl.x = np.array([x2[0], x2[1], x2[2], 0, 0, 0])
        p2 = dict(pose)
        order = [f for f in ("Index", "Middle", "Ring", "Pinky", "Thumb") if not specs[f].get("fixed")]
        fit_fingers(hand, pl, field, specs, p2, order)
        score = c + sum(v for k, v in p2.items() if k.startswith("_cost"))
        if verbose:
            pen, gap = ct.terms(pl.x)
            report("L (%.0fs) x %s" % (time.time() - t1, np.round(pl.x[:3], 1)), pl, hand, hm, field, p2,
                   "pen %.1f score %.1f" % (pen, score))
        if best is None or score < best[0]:
            best = (score, pl, p2)
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
        if LEFT_ONLY:
            plL, poseL, *_ = fit_left(gun, rig, geo, S, right=None)
            socks.setdefault(name, {})["grip_L"] = socket_entry(plL)
            poses.setdefault(CLIP[name], {"Right": {}})["Left"] = {k: (list(v) if isinstance(v, tuple) else v) for k, v in poseL.items()}
            json.dump(socks, open(SOCK_JSON, "w"), indent=1)
            json.dump(poses, open(POSE_JSON, "w"), indent=1)
            continue
        right = fit_right(gun, rig, geo, S)
        if RIGHT_ONLY:
            socks.setdefault(name, {})["grip_R"] = socket_entry(right[0])
            poses.setdefault(CLIP[name], {"Left": {}})["Right"] = {k: (list(v) if isinstance(v, tuple) else v) for k, v in right[1].items()}
            json.dump(socks, open(SOCK_JSON, "w"), indent=1)
            json.dump(poses, open(POSE_JSON, "w"), indent=1)
            continue
        plL, poseL, *_ = fit_left(gun, rig, geo, S, right=right)
        socks[name] = dict(grip_R=socket_entry(right[0]), grip_L=socket_entry(plL))
        clean = lambda p: {k: (list(v) if isinstance(v, tuple) else v) for k, v in p.items()}  # noqa: E731
        poses[CLIP[name]] = dict(Right=clean(right[1]), Left=clean(poseL), gun=name)
        print("  grip_R", socks[name]["grip_R"], " grip_L", socks[name]["grip_L"])
        json.dump(socks, open(SOCK_JSON, "w"), indent=1)
        json.dump(poses, open(POSE_JSON, "w"), indent=1)
    print("done %.0fs" % (time.time() - t0))


RIGHT_ONLY = "--right" in sys.argv
LEFT_ONLY = "--left" in sys.argv

if __name__ == "__main__":
    main([a for a in sys.argv[1:] if not a.startswith("--")] or ["rifle", "pistol", "shotgun", "smg", "lmg", "sniper", "rpg", "revolver"])
