"""MakeHuman (CC0) bodies for RIDE OR DIE: shaped, skinned bodies on a Mixamo-named skeleton.

Adapted from CONDUIT tools/humans/mh.py (read-only source data lives in C:/Dev/conduit/art_src/makehuman).
Internal ("MH space") conventions inherited from that pipeline and used by garments.py / hair.py:
    metres, feet on y = 0, body faces -Z, the characters LEFT = -X.
`to_final()` converts to the game convention (faces +Z, LEFT = +X) - a 180 degree turn about Y.
"""
import json
import os
import re

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MH = r"C:/Dev/conduit/art_src/makehuman"
DATA = MH + "/repo/makehuman/data"
ASSETS = MH + "/assets"
CACHE = HERE + "/_cache"

FINGERS = [("Thumb", 1), ("Index", 2), ("Middle", 3), ("Ring", 4), ("Pinky", 5)]

# The game skeleton: name, parent, MakeHuman bones merged into it.
GAME_BONES = [
    ("Hips", None, ["root", "pelvis.L", "pelvis.R"]),
    ("Spine", "Hips", ["spine05", "spine04"]),
    ("Spine1", "Spine", ["spine03", "spine02", "breast.L", "breast.R"]),
    ("Spine2", "Spine1", ["spine01"]),
    ("Neck", "Spine2", ["neck01", "neck02", "neck03"]),
    ("Head", "Neck", ["head", "jaw"]),     # + every small face bone (filled in below)
]
for side, s in (("Left", "L"), ("Right", "R")):
    GAME_BONES += [
        (side + "Shoulder", "Spine2", ["clavicle." + s, "shoulder01." + s]),
        (side + "Arm", side + "Shoulder", ["upperarm01." + s, "upperarm02." + s]),
        (side + "ForeArm", side + "Arm", ["lowerarm01." + s, "lowerarm02." + s]),
        (side + "Hand", side + "ForeArm", ["wrist." + s] + ["metacarpal%d.%s" % (i, s) for i in range(1, 5)]),
    ]
    for fname, fi in FINGERS:
        prev = side + "Hand"
        for k in (1, 2, 3):
            nm = "%sHand%s%d" % (side, fname, k)
            GAME_BONES.append((nm, prev, ["finger%d-%d.%s" % (fi, k, s)]))
            prev = nm
    GAME_BONES += [
        (side + "UpLeg", "Hips", ["upperleg01." + s, "upperleg02." + s]),
        (side + "Leg", side + "UpLeg", ["lowerleg01." + s, "lowerleg02." + s]),
        (side + "Foot", side + "Leg", ["foot." + s]),
        (side + "ToeBase", side + "Foot", ["toe%d-%d.%s" % (t, k, s) for t in range(1, 6) for k in range(1, 4)
                                          if not (t == 1 and k == 3)]),
    ]
BONE_NAMES = [b[0] for b in GAME_BONES]
BONE_INDEX = {n: i for i, n in enumerate(BONE_NAMES)}
PARENTS = [BONE_INDEX[p] if p else -1 for _, p, _ in GAME_BONES]


# --- files --------------------------------------------------------------------------------------

def load_obj(path):
    V, VT, F = [], [], []
    group = None
    with open(path, encoding="utf8", errors="ignore") as f:
        for line in f:
            if line.startswith("v "):
                V.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("vt "):
                VT.append([float(x) for x in line.split()[1:3]])
            elif line.startswith("g "):
                parts = line.split()
                group = parts[1] if len(parts) > 1 else None
            elif line.startswith("f "):
                vi, ti = [], []
                for tok in line.split()[1:]:
                    p = tok.split("/")
                    vi.append(int(p[0]) - 1)
                    ti.append(int(p[1]) - 1 if len(p) > 1 and p[1] else -1)
                F.append((vi, ti, group))
    return np.array(V, np.float64), np.array(VT, np.float64), F


_targets = {}


def target(rel):
    """A morph target (indices, deltas), cached."""
    if rel in _targets:
        return _targets[rel]
    os.makedirs(CACHE, exist_ok=True)
    key = CACHE + "/" + rel.replace("/", "__") + ".npz"
    if os.path.exists(key):
        z = np.load(key)
        out = (z["i"], z["d"].reshape(-1, 3))
    else:
        idx, d = [], []
        with open(DATA + "/targets/" + rel + ".target") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                p = line.split()
                idx.append(int(p[0]))
                d.append([float(p[1]), float(p[2]), float(p[3])])
        out = (np.array(idx, np.int64), np.array(d, np.float64).reshape(-1, 3))
        np.savez(key, i=out[0], d=out[1])
    _targets[rel] = out
    return out


def target_exists(rel):
    return os.path.exists(DATA + "/targets/" + rel + ".target")


# --- macro shape -------------------------------------------------------------------------------

def _tri(x, names):
    """Weights across [min, average, max] for a 0..1 slider (0.5 = average)."""
    if x <= 0.5:
        return {names[0]: (0.5 - x) / 0.5, names[1]: x / 0.5}
    return {names[1]: (1.0 - x) / 0.5, names[2]: (x - 0.5) / 0.5}


def macro_targets(gender, age, muscle, weight, height=0.5, proportions=0.5, race="caucasian"):
    """MakeHuman's macro system: weighted ethnic, universal, height and proportion targets.
    race may be a string or a dict {race: weight} (blend of caucasian / african / asian)."""
    gw = {"female": 1.0 - gender, "male": gender}
    if age < 0.1875:
        aw = {"baby": (0.1875 - age) / 0.1875, "child": age / 0.1875}
    elif age < 0.5:
        aw = {"child": (0.5 - age) / 0.3125, "young": (age - 0.1875) / 0.3125}
    else:
        aw = {"young": (1.0 - age) / 0.5, "old": (age - 0.5) / 0.5}
    mw = _tri(muscle, ["minmuscle", "averagemuscle", "maxmuscle"])
    ww = _tri(weight, ["minweight", "averageweight", "maxweight"])
    races = {race: 1.0} if isinstance(race, str) else race
    out = []
    for rc, rk in races.items():
        for g, a1 in gw.items():
            for a, a2 in aw.items():
                base = a1 * a2
                if base <= 1e-6:
                    continue
                out.append(("macrodetails/%s-%s-%s" % (rc, g, a), base * rk))
    for g, a1 in gw.items():
        for a, a2 in aw.items():
            base = a1 * a2
            if base <= 1e-6:
                continue
            for m, a3 in mw.items():
                for w, a4 in ww.items():
                    k = base * a3 * a4
                    if k <= 1e-6:
                        continue
                    out.append(("macrodetails/universal-%s-%s-%s-%s" % (g, a, m, w), k))
                    if abs(height - 0.5) > 1e-3:
                        hn = "maxheight" if height > 0.5 else "minheight"
                        out.append(("macrodetails/height/%s-%s-%s-%s-%s" % (g, a, m, w, hn), k * abs(height - 0.5) / 0.5))
                    if abs(proportions - 0.5) > 1e-3:
                        pn = "idealproportions" if proportions > 0.5 else "uncommonproportions"
                        out.append(("macrodetails/proportions/%s-%s-%s-%s-%s" % (g, a, m, w, pn), k * abs(proportions - 0.5) / 0.5))
    return [(n, k) for n, k in out if target_exists(n)]


# --- the body ----------------------------------------------------------------------------------

class Body:
    def __init__(self):
        self.base_v, self.vt, self.faces = load_obj(DATA + "/3dobjs/base.obj")
        self.v = self.base_v.copy()
        self.skel = json.load(open(DATA + "/rigs/default.mhskel"))
        self.mh_weights = json.load(open(DATA + "/rigs/default_weights.mhw"))["weights"]

    def shape(self, macro, extra=()):
        """macro: kwargs for macro_targets; extra: [(target, weight)]."""
        v = self.base_v.copy()
        for name, k in list(macro_targets(**macro)) + list(extra):
            if not target_exists(name):
                print("  (missing target %s)" % name)
                continue
            idx, d = target(name)
            v[idx] += d * k
        self.v = v
        return self

    # joints and bones in MakeHuman space
    def joint(self, name):
        return self.v[self.skel["joints"][name]].mean(axis=0)

    def mh_bone(self, name):
        b = self.skel["bones"][name]
        return self.joint(b["head"]), self.joint(b["tail"])


SCALE = 1.0   # the whole body, set per character


def to_game(p):
    """MakeHuman decimetres facing +Z -> metres facing -Z (internal space)."""
    p = np.asarray(p, np.float64)
    q = p * 0.1 * SCALE
    q[..., 0] *= -1.0
    q[..., 2] *= -1.0
    return q


def to_final(p):
    """Internal space (faces -Z) <-> game space (faces +Z): a turn about Y (self-inverse)."""
    q = np.array(p, np.float64, copy=True)
    q[..., 0] *= -1.0
    q[..., 2] *= -1.0
    return q


def face_bones(body):
    """Every MakeHuman face bone that is not one of the merged ones (they ride the Head)."""
    used = set()
    for _, _, merged in GAME_BONES:
        used.update(merged)
    return [n for n in body.skel["bones"] if n not in used]


def game_skeleton(body):
    """Heads and tails (internal space) for the game bones, plus MH bones merged into each."""
    extra = face_bones(body)
    merged = {}
    for name, parent, mb in GAME_BONES:
        merged[name] = list(mb) + (extra if name == "Head" else [])
    heads, tails = {}, {}
    for name, parent, mb in GAME_BONES:
        h, _ = body.mh_bone(mb[0])
        main = [b for b in mb if not b.startswith(("breast", "metacarpal", "pelvis"))]
        _, t = body.mh_bone(main[-1])
        if name == "Hips":
            h, t = body.mh_bone("root")
        elif name.endswith("Hand"):
            s = "L" if name.startswith("Left") else "R"
            h, _ = body.mh_bone("wrist." + s)
            t, _ = body.mh_bone("finger3-1." + s)
        elif name.endswith("ToeBase"):
            s = "L" if name.startswith("Left") else "R"
            h, _ = body.mh_bone("toe3-1." + s)
            _, t = body.mh_bone("toe3-3." + s)
        elif name == "Head":
            h, t = body.mh_bone("head")
        heads[name] = to_game(h)
        tails[name] = to_game(t)
    return {"heads": heads, "tails": tails, "merged": merged}


def weight_matrix(body, sk, n=None):
    """(n_vertices, n_bones) summed MakeHuman weights merged onto the game bones (not normalised)."""
    n = len(body.v) if n is None else n
    W = np.zeros((n, len(BONE_NAMES)), np.float64)
    for gi, name in enumerate(BONE_NAMES):
        for mb in sk["merged"][name]:
            for v, w in body.mh_weights.get(mb, []):
                if v < n:
                    W[v, gi] += w
    return W


def top4(W):
    """(joints, weights) top four per row, normalised; unweighted rows ride the hips."""
    joints = np.argsort(-W, axis=1)[:, :4]
    weights = np.take_along_axis(W, joints, axis=1)
    s = weights.sum(axis=1, keepdims=True)
    empty = s[:, 0] <= 1e-9
    weights = np.where(s > 1e-9, weights / np.maximum(s, 1e-9), 0.0)
    weights[empty, 0] = 1.0
    joints[empty, 0] = BONE_INDEX["Hips"]
    return joints.astype(np.uint16), weights.astype(np.float32)


def game_weights(body, sk, verts_idx):
    W = weight_matrix(body, sk)[verts_idx]
    return top4(W)


# --- proxies (eyes, teeth, tongue, lashes) -----------------------------------------------------

def load_mhclo(path):
    refs, scale = [], {}
    obj_file = None
    reading = False
    with open(path) as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            p = s.split()
            if p[0] == "obj_file":
                obj_file = p[1]
            elif p[0] in ("x_scale", "y_scale", "z_scale"):
                scale[p[0][0]] = (int(p[1]), int(p[2]), float(p[3]))
            elif p[0] == "verts":
                reading = True
            elif reading and p[0] in ("delete_verts",):
                reading = False
            elif reading and re.match(r"^-?\d", p[0]):
                if len(p) == 1:
                    refs.append(((int(p[0]), 0, 0), (1.0, 0.0, 0.0), (0.0, 0.0, 0.0)))
                elif len(p) >= 9:
                    refs.append(((int(p[0]), int(p[1]), int(p[2])), (float(p[3]), float(p[4]), float(p[5])),
                                 (float(p[6]), float(p[7]), float(p[8]))))
    return obj_file, refs, scale


def fit_proxy(body, mhclo_path):
    """Proxy vertices placed on the shaped body (MakeHuman space), plus its uv/faces and refs."""
    obj_file, refs, scale = load_mhclo(mhclo_path)
    pv, pvt, pf = load_obj(os.path.join(os.path.dirname(mhclo_path), obj_file))
    v = body.v
    sc = np.ones(3)
    for i, ax in enumerate("xyz"):
        if ax in scale:
            a, b, den = scale[ax]
            sc[i] = abs(v[a][i] - v[b][i]) / den
    out = np.zeros((len(refs), 3))
    for k, (ids, ws, off) in enumerate(refs):
        out[k] = ws[0] * v[ids[0]] + ws[1] * v[ids[1]] + ws[2] * v[ids[2]] + np.array(off) * sc
    return out, pvt, pf, refs


def proxy_weights(body, sk, refs):
    """Skin a fitted proxy by the weights of the body vertices it hangs from."""
    W = weight_matrix(body, sk)
    P = np.zeros((len(refs), len(BONE_NAMES)))
    for k, (ids, ws, off) in enumerate(refs):
        for i, wv in zip(ids, ws):
            if wv:
                P[k] += W[i] * wv
    return top4(P)


# --- mesh assembly -----------------------------------------------------------------------------

def triangulate(faces, keep):
    tris_v, tris_t = [], []
    for vi, ti, g in faces:
        if not keep(g):
            continue
        for k in range(1, len(vi) - 1):
            tris_v.append((vi[0], vi[k], vi[k + 1]))
            tris_t.append((ti[0], ti[k], ti[k + 1]))
    return np.array(tris_v, np.int64), np.array(tris_t, np.int64)


def vertex_normals(pos, tris):
    n = np.zeros_like(pos)
    a, b, c = pos[tris[:, 0]], pos[tris[:, 1]], pos[tris[:, 2]]
    fn = np.cross(b - a, c - a)
    for k in range(3):
        np.add.at(n, tris[:, k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.maximum(ln, 1e-12)


def split_seams(pos, nrm, uv_src, tris_v, tris_t):
    """Unique (vertex, uv) pairs -> flat arrays for glTF."""
    key = {}
    out_i = []
    src_v, src_t = [], []
    for tv, tt in zip(tris_v.reshape(-1), tris_t.reshape(-1)):
        k = (int(tv), int(tt))
        if k not in key:
            key[k] = len(src_v)
            src_v.append(k[0])
            src_t.append(k[1])
        out_i.append(key[k])
    src_v = np.array(src_v)
    src_t = np.array(src_t)
    uv = uv_src[src_t] if len(uv_src) else np.zeros((len(src_v), 2))
    uv = np.stack([uv[:, 0], 1.0 - uv[:, 1]], axis=1)   # OBJ v up -> glTF v down
    return {"pos": pos[src_v], "nrm": nrm[src_v], "uv": uv, "idx": np.array(out_i, np.uint32), "src": src_v}
