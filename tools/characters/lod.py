"""Body decimation for the low-budget raiders (Blender's collapse decimator, weights re-transferred from the full mesh)."""
import os
import subprocess
import tempfile

import numpy as np
from scipy.spatial import cKDTree

import mh

BLENDER = "C:/Dev/tools/Blender-4.5.11-portable/blender.exe"
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "blender_decimate.py")


def closest_on_mesh(P, verts, faces, k=10):
    """Closest point on a triangle mesh for each P: returns (face index, barycentric (N,3))."""
    cen = verts[faces].mean(axis=1)
    tree = cKDTree(cen)
    _, cand = tree.query(P, k=k)
    best_d = np.full(len(P), 1e9)
    best_f = np.zeros(len(P), np.int64)
    best_b = np.zeros((len(P), 3))
    for j in range(cand.shape[1]):
        f = cand[:, j]
        a, b, c = verts[faces[f, 0]], verts[faces[f, 1]], verts[faces[f, 2]]
        ab, ac, ap = b - a, c - a, P - a
        d1, d2 = np.einsum("ij,ij->i", ab, ap), np.einsum("ij,ij->i", ac, ap)
        bp = P - b
        d3, d4 = np.einsum("ij,ij->i", ab, bp), np.einsum("ij,ij->i", ac, bp)
        cp = P - c
        d5, d6 = np.einsum("ij,ij->i", ab, cp), np.einsum("ij,ij->i", ac, cp)
        vc = d1 * d4 - d3 * d2
        vb = d5 * d2 - d1 * d6
        va = d3 * d6 - d5 * d4
        den = 1.0 / np.maximum(va + vb + vc, 1e-18)
        v = vb * den
        w = vc * den
        u = 1.0 - v - w
        # clamp to triangle by projecting (simple: clamp & renormalise)
        u, v, w = np.clip(u, 0, 1), np.clip(v, 0, 1), np.clip(w, 0, 1)
        s = u + v + w
        u, v, w = u / s, v / s, w / s
        q = a * u[:, None] + b * v[:, None] + c * w[:, None]
        d = np.linalg.norm(P - q, axis=1)
        better = d < best_d
        best_d = np.where(better, d, best_d)
        best_f = np.where(better, f, best_f)
        best_b = np.where(better[:, None], np.stack([u, v, w], axis=1), best_b)
    return best_f, best_b


def importance(ch, head=0.8, hands=0.7, torso=0.35, limbs=0.3, feet=0.0):
    """Per-vertex importance: 1 = keep detail (face, hands)."""
    imp = np.full(len(ch.pos), limbs, np.float32)
    top = ch.top
    for n, i in mh.BONE_INDEX.items():
        sel = top == i
        if n in ("Head", "Neck"):
            imp[sel] = head
        elif "Hand" in n:
            imp[sel] = hands
        elif n in ("Spine", "Spine1", "Spine2", "Hips", "LeftShoulder", "RightShoulder"):
            imp[sel] = torso
        elif "Foot" in n or "Toe" in n:
            imp[sel] = feet
    return imp


def decimate(ch, ratio=0.35, imp=None, symmetry=True):
    """Replace ch.pos / tv / tt / vt / W / top / nrm by a decimated body (same skeleton, weights transferred)."""
    imp = importance(ch) if imp is None else imp
    pos, tv = ch.pos, ch.tv
    uv = ch.vt[ch.tt]                                     # (T,3,2)
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "in.npz")
        dst = os.path.join(td, "out.npz")
        # Blender wants Y-up/Z-up irrelevant: we pass positions as they are (only topology matters)
        np.savez(src, verts=pos.astype(np.float32), faces=tv.astype(np.int32), uv=uv.astype(np.float32), imp=imp.astype(np.float32))
        r = subprocess.run([BLENDER, "-b", "--factory-startup", "-P", SCRIPT, "--", src, dst, str(ratio), "1" if symmetry else "0"],
                           capture_output=True, text=True)
        if not os.path.exists(dst):
            raise RuntimeError("decimate failed:\n" + r.stdout[-1500:] + r.stderr[-1500:])
        with np.load(dst) as out:
            V, F, UV = out["verts"].astype(np.float64), out["faces"].astype(np.int64), out["uv"].astype(np.float64)
    # drop unused vertices
    used = np.unique(F)
    remap = -np.ones(len(V), np.int64)
    remap[used] = np.arange(len(used))
    V, F = V[used], remap[F]
    # weights from the full mesh
    fi, bary = closest_on_mesh(V, pos, tv)
    W = np.einsum("nk,nkb->nb", bary, ch.W[tv[fi]])
    s = W.sum(axis=1, keepdims=True)
    W = W / np.maximum(s, 1e-9)
    ch.full = dict(pos=ch.pos, tv=ch.tv, tt=ch.tt, vt=ch.vt, W=ch.W, top=ch.top, nrm=ch.nrm)
    ch.pos = V
    ch.tv = F
    ch.vt = UV.reshape(-1, 2)
    ch.tt = np.arange(len(F) * 3).reshape(-1, 3)
    ch.W = W
    ch.top = np.argmax(W, axis=1)
    ch.nrm = mh.vertex_normals(V, F)
    return ch
