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


def finger_cost_fn(hand, hm, pl, field, f, pose, spec):
    """Cost of one finger's angles against the real gun surface, using the finger's own skinned vertices."""
    m = hm.fw[f] > 0.02
    seg = hm.seg[f][m]
    dist = hm.fw[f][m] > 0.5
    base = clean_pose(pose)
    is_t = f == "Thumb"
    cw = spec.get("contact_w", 1.0)
    segw = spec.get("seg_w", (0.4, 1.0, 1.0))
    tgt = spec.get("target")
    ptg = spec.get("pad_target")
    avoid = spec.get("avoid")          # optional extra field the finger must stay out of (and not count as contact)
    prior = (np.asarray(spec["prior"][0], float), spec["prior"][1]) if spec.get("prior") else None

    def cost(x):
        p = dict(base)
        if is_t:
            p["Thumb"], p["thumb"] = (x[0], x[1], x[2]), (x[3], x[4])
        else:
            p[f] = (x[0], x[1], x[2])
        V = pl.to_w(hand.to_g(hm.posed(p, m)))
        sd = field.sd(V)
        c = np.sum(np.maximum(-sd - 0.3, 0.0) ** 2) * 2.0
        if avoid is not None:
            c += np.sum(np.maximum(-avoid.sd(V) - 0.3, 0.0) ** 2) * 2.0
        if cw > 0:
            for k in range(3):
                mk = dist & (seg == k)
                if mk.any():
                    c += cw * segw[k] * max(sd[mk].min(), 0.0) ** 2
        if tgt is not None or ptg is not None:
            g = hand.finger(f, p[f] if not is_t else p["Thumb"], p.get("spread", 0.0), p.get("thumb", (0, 0)))
            if tgt is not None:
                c += spec.get("tw", 1.0) * 0.05 * np.sum((pl.to_w(g["P"][-1]) - tgt) ** 2)
            if ptg is not None:
                # trigger contact anywhere from the middle-phalanx pad (DIP crease) to the distal pad; the distal pad is preferred
                cand = pl.to_w(np.array([g["pads"][3], (g["pads"][3] + g["pads"][4]) * 0.5, g["pads"][4], (g["pads"][4] + g["pads"][5]) * 0.5]))
                d2 = np.sum((cand - ptg) ** 2, axis=1) + np.array([30.0, 16.0, 6.0, 0.0])
                c += spec.get("pw", 1.0) * 0.05 * d2.min()
        if not is_t:
            c += 0.004 * (x[2] - 0.65 * x[1]) ** 2
        if prior is not None:
            c += prior[1] * np.sum((np.asarray(x[:len(prior[0])]) - prior[0]) ** 2)
        return c
    return cost


def fit_finger_mesh(hand, hm, pl, field, f, pose, spec):
    lo, hi = spec["lo"], spec["hi"]
    cost = finger_cost_fn(hand, hm, pl, field, f, pose, spec)
    if f == "Thumb":
        x0 = np.array(tuple(pose.get("Thumb", spec["x0"][:3])) + tuple(pose.get("thumb", spec["x0"][3:])), float)
    else:
        x0 = np.array(pose.get(f, spec["x0"]), float)
    best, bx = cost(x0), x0
    if f != "Thumb":
        for a in np.arange(lo[0], hi[0] + 1, 10.0):
            for b in np.arange(lo[1], hi[1] + 1, 12.0):
                for r in (0.4, 0.65, 0.9):
                    x = np.array([a, b, min(hi[2], b * r)])
                    c = cost(x)
                    if c < best:
                        best, bx = c, x
    else:
        rng = np.random.default_rng(3)
        for _ in range(500):
            x = np.array([rng.uniform(l_, h_) for l_, h_ in zip(lo, hi)])
            c = cost(x)
            if c < best:
                best, bx = c, x
    r = minimize(cost, bx, method="Powell", bounds=list(zip(lo, hi)), options=dict(xtol=0.2, ftol=1e-4, maxiter=4000))
    x = r.x if r.fun <= best else bx
    if f == "Thumb":
        pose["Thumb"], pose["thumb"] = tuple(round(float(v), 1) for v in x[:3]), tuple(round(float(v), 1) for v in x[3:])
    else:
        pose[f] = tuple(round(float(v), 1) for v in x)
    pose["_cost_" + f] = round(float(min(r.fun, best)), 2)
    return pose


def place_cost(pl, x, field, ps, palm, finger_w, pads=None, pad_goal=None, pad_w=0.05, fix=None, reg=0.02, contact_w=0.5,
               web=None, web_w=10.0, push=None):
    pw = pl.to_w(ps, x)
    sd = field.sd(pw)
    c = np.sum(finger_w * np.maximum(-sd - 0.4, 0.0) ** 2)
    sp = np.sort(sd[palm])[: max(8, palm.sum() // 3)]
    c += contact_w * np.mean(np.maximum(sp, 0.0) ** 2) * 10.0
    if web is not None and web.any():
        c += web_w * max(np.sort(sd[web])[:6].mean(), 0.0) ** 2
    if push is not None:             # constant force (per mm) along a direction, e.g. up the grip into the tang (high grip)
        c -= push[1] * float(np.dot(x[:3], push[0]))
    if pads is not None:
        c += pad_w * np.sum((pl.to_w(pads, x) - pad_goal) ** 2)
    if fix is not None:              # stay near the authored position (the arm reach was tuned for it)
        c += fix[1] * (x[fix[0]]) ** 2
    c += reg * np.sum(x[3:] ** 2)
    return c


def optimise_place(pl, cost, starts, bounds):
    best = None
    for s in starts:
        r = minimize(cost, np.asarray(s, float), method="Powell", bounds=bounds, options=dict(xtol=0.1, ftol=1e-4, maxiter=4000))
        if best is None or r.fun < best.fun:
            best = r
    pl.x = best.x
    return best.fun


def report(tag, pl, hand, hm, field, pose, extra=""):
    V = pl.to_w(hand.to_g(hm.posed(clean_pose(pose))))
    sd = field.sd(V)
    Rg, t = pl.mat()
    fing = {k: v for k, v in pose.items() if k in RIG.FINGERS or k == "thumb"}
    print("  %s t %s rot %s | pen>1mm %d max %.1f | palm gap %.1f %s\n     %s" % (
        tag, np.round(t, 1), euler_g(Rg), int((sd < -1).sum()), -sd.min(), np.median(np.sort(sd[hm.palm])[:20]), extra, fing))


def fit_right(gun, rig, geo, S, verbose=True, iters=3):
    """Right hand: palm on the right grip panel, web of the hand up against the backstrap / tang (high grip), then the fingers."""
    pR, RR, gR = F.socket_R(rig, S)
    hand = F.Hand(rig, "Right", pR, RR)
    hm = HandMesh(rig, geo, "Right")
    field = gun.field((-220, -120, -160), (260, 120, 230))
    trig = gun.trigger_face()
    ga = RAKE[gun.name]
    R0 = R.from_euler("y", ga - F.RAKE_R, degrees=True).as_matrix()
    ax = np.array([np.sin(np.radians(ga)), 0.0, np.cos(np.radians(ga))])
    h = (trig[2] - 26.0) / ax[2]
    fp = np.array([np.cos(np.radians(ga)), 0.0, -np.sin(np.radians(ga))])
    # the grip centre stays on the grip axis: x = (along the axis, fore-aft across it, lateral) + small rotations
    pl = Placement(R0, ax * h, basis=np.stack([ax, fp, [0.0, 1.0, 0.0]], axis=1))
    pose = {"spread": -3.0, "Thumb": (15, 25, 15), "thumb": (30, 20), "Index": (30, 45, 25), "Middle": (75, 90, 45),
            "Ring": (78, 90, 45), "Pinky": (80, 85, 45)}
    FH = F.FHI
    wrap = (25, 35, 10)
    specs = {"Middle": dict(x0=(75, 90, 45), lo=wrap, hi=FH, prior=((72, 88, 50), 0.002)),
             "Ring": dict(x0=(78, 90, 45), lo=wrap, hi=FH, prior=((76, 90, 50), 0.002)),
             "Pinky": dict(x0=(80, 85, 45), lo=wrap, hi=FH, prior=((80, 88, 50), 0.002)),
             "Index": dict(x0=(30, 45, 25), lo=(-5, 15, 5), hi=FH, pad_target=trig, pw=1.0, contact_w=0.0, prior=((30, 50, 30), 0.001)),
             "Thumb": dict(x0=(15, 25, 15, 30, 20), lo=F.TLO, hi=F.THI, contact_w=0.6, seg_w=(0.0, 0.5, 1.0),
                           target=np.array([25.0, 22.0, 40.0]), tw=0.15)}
    for it in range(iters):
        t1 = time.time()
        psf = hand.to_g(hm.posed(clean_pose(pose)))
        # web of the hand = whatever skin crosses behind the grip's mid-plane (thenar / thumb metacarpal / purlicue)
        web = (np.abs(psf[:, 1]) < 9.0) & (psf[:, 0] < -12.0) & (psf[:, 2] > -10.0) & (hm.fw["Thumb"] < 0.9)
        m = hm.sub
        ps = psf[m]
        fsum = sum(hm.fw[f] for f in F.FING)
        fwt = np.where(fsum > 0.5, 0.15, np.where(hm.fw["Thumb"] > 0.5, 0.5, 1.0))[m]
        # the thumb target lives in the socket frame -> weapon frame for the finger fit
        Rg, t = pl.mat()
        specs["Thumb"]["target"] = np.array([25.0, 22.0, 40.0]) @ Rg.T + t
        cost = lambda x: place_cost(pl, x, field, ps, hm.palm[m], fwt, contact_w=0.5, web=web[m], web_w=4.0,  # noqa: E731
                                    push=(np.array([1.0, 0, 0]), 0.6), reg=0.08)
        x0 = pl.x.copy()
        starts = [x0] if it else [x0, x0 + [10, 0, 0, 0, 0, 0], x0 + [-10, 0, 0, 0, 0, 0]]
        b = [(-45, 45), (-6, 6), (-4, 4), (-6, 6), (-6, 6), (-6, 6)]
        optimise_place(pl, cost, starts, b)
        Rg, t = pl.mat()
        specs["Thumb"]["target"] = np.array([25.0, 22.0, 40.0]) @ Rg.T + t
        for f in ("Middle", "Ring", "Pinky", "Index", "Thumb"):
            fit_finger_mesh(hand, hm, pl, field, f, pose, specs[f])
        if verbose:
            g = hand.finger("Index", pose["Index"], pose["spread"])
            padw = pl.to_w((g["pads"][4] + g["pads"][5]) * 0.5)
            wsd = field.sd(pl.to_w(psf[web]))
            report("R it%d (%.0fs)" % (it, time.time() - t1), pl, hand, hm, field, pose,
                   "pad->trig %.1f  web gap %.1f (%d verts)" % (np.linalg.norm(padw - trig), np.sort(wsd)[:6].mean(), web.sum()))
    return pl, pose, hand, hm, field


def left_specs(kind):
    FL, FH = F.FLO, F.FHI
    if kind == "vgrip":
        return {"Index": dict(x0=(70, 85, 40), lo=FL, hi=FH), "Middle": dict(x0=(72, 88, 40), lo=FL, hi=FH),
                "Ring": dict(x0=(78, 90, 40), lo=FL, hi=FH), "Pinky": dict(x0=(82, 88, 40), lo=FL, hi=FH),
                "Thumb": dict(x0=(20, 25, 20, 30, 20), lo=F.TLO, hi=F.THI, contact_w=0.6, seg_w=(0.0, 0.5, 1.0))}, -2.0
    if kind == "cup":
        return {"Index": dict(x0=(55, 70, 30), lo=FL, hi=FH), "Middle": dict(x0=(60, 72, 32), lo=FL, hi=FH),
                "Ring": dict(x0=(64, 74, 34), lo=FL, hi=FH), "Pinky": dict(x0=(68, 74, 34), lo=FL, hi=FH),
                "Thumb": dict(x0=(20, 10, 5, 5, 5), lo=F.TLO, hi=F.THI, contact_w=0.5, seg_w=(0.0, 0.5, 1.0))}, -2.0
    return {"Index": dict(x0=(45, 60, 30), lo=FL, hi=FH), "Middle": dict(x0=(50, 65, 32), lo=FL, hi=FH),
            "Ring": dict(x0=(55, 66, 34), lo=FL, hi=FH), "Pinky": dict(x0=(60, 68, 34), lo=FL, hi=FH),
            "Thumb": dict(x0=(10, 15, 10, 20, 20), lo=F.TLO, hi=F.THI, contact_w=0.5, seg_w=(0.0, 0.5, 1.0))}, 2.0


def fit_left(gun, rig, geo, S, right=None, verbose=True, iters=3):
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
    if kind == "hg":
        R0s = [np.eye(3)]
    else:
        # palm toward the gun's right side: roll +90 about the barrel axis, then spin about the palm normal
        # (cup: thumb forward along the frame, fingers down-forward over the right fist; vgrip: fingers forward round the grip)
        R0s = [R.from_euler("x", 90, degrees=True).as_matrix() @ R.from_euler("z", a, degrees=True).as_matrix()
               for a in ((-30, 0, 30) if kind == "cup" else (45, 65, 85))]
    fix = (0, 0.02) if kind == "hg" else None
    best = None
    for R0 in R0s:
        pl = Placement(R0, g0.copy())
        pose = {"spread": spread}
        for f, fs in specs.items():
            if f == "Thumb":
                pose["Thumb"], pose["thumb"] = tuple(fs["x0"][:3]), tuple(fs["x0"][3:])
            else:
                pose[f] = tuple(fs["x0"])
        fwt = np.where(hm.body, 1.0, 0.25)[hm.sub]
        for it in range(iters):
            t1 = time.time()
            ps = hand.to_g(hm.posed(clean_pose(pose)))[hm.sub]
            cost = lambda x: place_cost(pl, x, field, ps, hm.palm[hm.sub], fwt, fix=fix, contact_w=1.0)  # noqa: E731
            x0 = pl.x.copy()
            b = [(-25, 25), (-35, 35), (-35, 35), (-40, 40), (-40, 40), (-40, 40)]
            starts = [x0] if it else [x0, x0 + [0, 0, -10, 0, 0, 0], x0 + [0, 10, 0, 0, 0, 0], x0 + [0, -10, 0, 0, 0, 0]]
            optimise_place(pl, cost, starts, b)
            for f in ("Index", "Middle", "Ring", "Pinky", "Thumb"):
                fit_finger_mesh(hand, hm, pl, field, f, pose, specs[f])
            if verbose:
                report("L it%d (%.0fs)" % (it, time.time() - t1), pl, hand, hm, field, pose)
        ps = hand.to_g(hm.posed(clean_pose(pose)))[hm.sub]
        score = place_cost(pl, pl.x, field, ps, hm.palm[hm.sub], fwt, fix=fix, contact_w=1.0) + \
            sum(v for k, v in pose.items() if k.startswith("_cost"))
        if verbose:
            print("   start score %.1f" % score)
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

if __name__ == "__main__":
    main([a for a in sys.argv[1:] if not a.startswith("--")] or ["rifle", "pistol", "shotgun", "smg", "lmg", "sniper", "rpg", "revolver"])
