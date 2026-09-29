"""Hair: a cap of dense hair over the scalp (so no head is a bald egg under
its strands) and cards of strands grown from it. Each strand starts along
the scalp, is pulled down by its own weight and lies over whatever it meets
(head, ears, neck, shoulders, back); strands mat together into clumps toward
their tips, lank with grease and grave-dirt.

Styles: long, short, patchy (fallen out in places), wisps (a few long thin
strands over a bare scalp)."""
import os

import numpy as np
from scipy.spatial import cKDTree

import mh

STYLES = {
    # cards, length range (m), width range (m), cap, clumping, segments
    "long": dict(count=600, length=(0.3, 0.56), width=(0.028, 0.042), cap=True, clump=0.5, segs=14, clumps=44),
    "short": dict(count=520, length=(0.04, 0.09), width=(0.016, 0.024), cap=True, clump=0.2, segs=4, clumps=60),
    "patchy": dict(count=260, length=(0.05, 0.2), width=(0.014, 0.022), cap=True, clump=0.45, segs=6, clumps=40),
    "wisps": dict(count=60, length=(0.18, 0.4), width=(0.006, 0.012), cap=False, clump=0.3, segs=9, clumps=14),
}


def strand_texture(path):
    """A card's worth of strands (roots at the top): bright cores, soft alpha,
    a few strays, tips thinning out."""
    if os.path.exists(path):
        return
    from PIL import Image
    rng = np.random.default_rng(3)
    w, h = 256, 512
    col = np.zeros((h, w), np.float32)
    alpha = np.zeros((h, w), np.float32)
    ys = np.arange(h, dtype=np.float32)
    for _ in range(260):
        x0 = rng.uniform(0, w)
        thick = rng.uniform(0.9, 2.6)
        length = rng.uniform(0.55, 1.0) * h
        bright = rng.uniform(0.35, 1.0)
        wob, freq, drift = rng.uniform(0, 6.28), rng.uniform(0.006, 0.02), rng.uniform(-0.03, 0.03)
        xs = x0 + np.sin(ys * freq + wob) * rng.uniform(1.0, 4.0) + ys * drift
        fade = np.clip(1.0 - (ys / length) ** 2.5, 0.0, 1.0)
        for dx in range(-3, 4):
            xx = (np.floor(xs).astype(int) + dx) % w
            k = np.clip(1.0 - np.abs(xs - np.floor(xs) - dx) / (thick * 0.5 + 0.35), 0.0, 1.0) * fade
            alpha[ys.astype(int), xx] = np.maximum(alpha[ys.astype(int), xx], k)
            col[ys.astype(int), xx] = np.maximum(col[ys.astype(int), xx], bright * k)
    img = np.zeros((h, w, 4), np.uint8)
    img[..., 0] = img[..., 1] = img[..., 2] = (np.clip(col, 0, 1) * 255).astype(np.uint8)
    img[..., 3] = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(img, "RGBA").save(path)


def _weights(body, sk, n):
    W = np.zeros((n, len(mh.BONE_NAMES)))
    for gi, name in enumerate(mh.BONE_NAMES):
        for mb in sk["merged"][name]:
            for v, w in body.mh_weights.get(mb, []):
                if v < n:
                    W[v, gi] += w
    return W


def _scalp(body, sk, pos, nrm, tris):
    """Scalp triangles: the head above the ears, not the face."""
    S = mh.SCALE
    W = _weights(body, sk, len(pos))
    top = np.argmax(W, axis=1)
    B = mh.BONE_INDEX
    hy = float(sk["heads"]["Head"][1])
    brow_y = hy + 0.1 * S
    ear_y = hy + 0.02 * S
    hz = float(sk["heads"]["Head"][2])
    ok = (top == B["Head"]) & (pos[:, 1] > ear_y)
    # Not the face: front-facing below the hairline.
    ok &= ~((nrm[:, 2] < -0.35) & (pos[:, 1] < brow_y + 0.035 * S))
    # Sideburn line: in front of the ears only above them.
    ok &= ~((pos[:, 2] < hz - 0.045 * S) & (pos[:, 1] < brow_y - 0.01 * S))
    tm = np.all(ok[tris], axis=1)
    return tris[tm], W


def _sample(tri_pts, tri_nrm, count, rng):
    a = np.linalg.norm(np.cross(tri_pts[:, 1] - tri_pts[:, 0], tri_pts[:, 2] - tri_pts[:, 0]), axis=1)
    pick = rng.choice(len(a), size=count, p=a / a.sum())
    u, v = rng.random(count), rng.random(count)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    w0 = 1 - u - v
    P = tri_pts[pick, 0] * w0[:, None] + tri_pts[pick, 1] * u[:, None] + tri_pts[pick, 2] * v[:, None]
    N = tri_nrm[pick, 0] * w0[:, None] + tri_nrm[pick, 1] * u[:, None] + tri_nrm[pick, 2] * v[:, None]
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    return P, N


def _grow(p0, n0, L, segs, head_c, tree, pos, nrm, clr, rng):
    """One strand: along the scalp at first, then its weight takes it,
    lying over the head and body beneath."""
    down = np.array([0.0, -1.0, 0.0])
    out = p0 - head_c
    out[1] = 0.0
    out /= max(np.linalg.norm(out), 1e-6)
    if out[2] < -0.35:
        side = np.array([np.sign(p0[0] - head_c[0]) or 1.0, 0.0, 0.25])
        out = out * 0.35 + side / np.linalg.norm(side) * 0.65
        out /= np.linalg.norm(out)
    d = down + out * 0.9
    d = d - n0 * (d @ n0) + n0 * 0.15          # start along the scalp
    d /= np.linalg.norm(d)
    pts = [p0 + n0 * clr]
    seg = L / segs
    for s in range(1, segs + 1):
        t = s / segs
        d = d * (1.0 - 0.3 * t) + down * (0.25 + 0.9 * t) + rng.normal(0.0, 0.05, 3)
        d /= np.linalg.norm(d)
        q = pts[-1] + d * seg
        # Lie over whatever is underneath (a few passes: head, then ears, neck, shoulders).
        for _ in range(3):
            _, i = tree.query(q)
            depth = (q - pos[i]) @ nrm[i]
            if depth < clr:
                q = q + nrm[i] * (clr - depth)
        d = q - pts[-1]
        d /= max(np.linalg.norm(d), 1e-6)
        pts.append(q)
    return np.array(pts)


def cards(body, sk, pos, nrm, style, seed=1, tris=None):
    """Hair cap and cards: returns glTF-ready arrays (or None)."""
    st = STYLES[style]
    S = mh.SCALE
    rng = np.random.default_rng(seed)
    B = mh.BONE_INDEX
    st_tris, W = _scalp(body, sk, pos, nrm, tris)
    if len(st_tris) == 0:
        return None
    valid = np.zeros(len(pos), bool)
    valid[np.unique(tris)] = True
    head = (np.argmax(W, axis=1) == B["Head"]) & valid
    head_c = pos[head].mean(axis=0)
    # Only the body's own surface: MakeHuman's helper geometry floats around it.
    vidx = np.where(valid)[0]
    pos_all, nrm_all = pos, nrm
    pos, nrm = pos[vidx], nrm[vidx]
    body_tree = cKDTree(pos)
    neck_y = float(sk["heads"]["Neck"][1])
    shoulder_y = neck_y - 0.02 * S
    P, N, J, Wt, UV, C, T = [], [], [], [], [], [], []

    def skin(q, root_w):
        # Rooted on the head; below the neck the ends follow the neck and back.
        if q[1] > shoulder_y:
            return (B["Head"], 0, 0, 0), (1.0, 0.0, 0.0, 0.0)
        f = min(1.0, (shoulder_y - q[1]) / (0.22 * S))
        return (B["Head"], B["Neck"], B["Spine2"], 0), (1.0 - f, f * 0.4, f * 0.6, 0.0)

    # Patches where it has fallen out.
    def bald(p):
        if style != "patchy":
            return False
        k = np.sin(p[0] * 41.0 + seed) + np.cos(p[2] * 33.0 - seed) + np.sin(p[1] * 27.0 + seed * 0.5)
        return k < -0.5

    # The cap: the scalp itself, a hair's breadth out, alpha fading at the hairline.
    if st["cap"]:
        verts = np.unique(st_tris)
        local = -np.ones(len(pos_all), int)
        local[verts] = np.arange(len(verts))
        lt = local[st_tris]
        # Distance to the hairline over the cap.
        count = {}
        for a, b, c in lt:
            for e in ((a, b), (b, c), (c, a)):
                k = (min(e), max(e))
                count[k] = count.get(k, 0) + 1
        edge = {v for (a, b), c in count.items() if c == 1 for v in (a, b)}
        cp = pos_all[verts]
        dist = np.full(len(verts), 1.0)
        if edge:
            et = cKDTree(cp[list(edge)])
            dist = np.clip(et.query(cp)[0] / (0.02 * S), 0.0, 1.0)
        base = len(P)
        crown = head_c + np.array([0.0, 0.1 * S, 0.02 * S])
        for k, v in enumerate(verts):
            q = pos_all[v] + nrm_all[v] * 0.0025 * S
            P.append(q)
            N.append(nrm_all[v])
            j, w = skin(q, 1.0)
            J.append(j)
            Wt.append(w)
            r = q - crown
            ang = np.arctan2(r[0], -r[2])
            UV.append((ang * 0.05 * 6.0, float(np.linalg.norm(r)) * 6.0))
            C.append((float(dist[k]) * (0.0 if bald(q) else 1.0), 1.0, 0.0, 1.0))
        for a, b, c in lt:
            T.append((base + a, base + b, base + c))
    # The strands.
    tp = pos_all[st_tris]
    tn = nrm_all[st_tris]
    roots, rn = _sample(tp, tn, st["count"], rng)
    keep = np.array([not bald(r) for r in roots])
    roots, rn = roots[keep], rn[keep]
    lens = rng.uniform(*st["length"], len(roots)) * S
    guides = []
    clr0 = 0.004 * S
    for i in range(len(roots)):
        clr = clr0 + rng.uniform(0.0, 0.012) * S
        g = _grow(roots[i], rn[i], lens[i], st["segs"], head_c, body_tree, pos, nrm, clr, rng)
        # Relax the kinks the collisions leave, then lie back over the body.
        for _ in range(4):
            g[1:-1] = g[1:-1] * 0.5 + (g[:-2] + g[2:]) * 0.25
            g[-1] = g[-1] * 0.6 + g[-2] * 0.4 + (g[-2] - g[-3]) * 0.4
            for s in range(1, len(g)):
                _, vi = body_tree.query(g[s])
                depth = (g[s] - pos[vi]) @ nrm[vi]
                if depth < clr:
                    g[s] = g[s] + nrm[vi] * (clr - depth)
        guides.append(g)
    # Mat into clumps toward the tips.
    kc = min(st["clumps"], len(roots))
    if kc > 1:
        centres = rng.choice(len(roots), kc, replace=False)
        ct = cKDTree(roots[centres])
        _, owner = ct.query(roots)
        for i in range(len(roots)):
            gi = centres[owner[i]]
            if gi == i:
                continue
            g, h = guides[i], guides[gi]
            da, db = g[min(3, len(g) - 1)] - g[0], h[min(3, len(h) - 1)] - h[0]
            if da @ db < 0.5 * np.linalg.norm(da) * np.linalg.norm(db):
                continue
            m = min(len(g), len(h))
            s = np.linspace(0.0, 1.0, m)[:, None]
            f = st["clump"] * s ** 1.4
            g[:m] = g[:m] * (1 - f) + (h[:m] + (g[0] - h[0]) * (1 - s) * 0.3) * f
            for s2 in range(1, len(g)):
                _, vi = body_tree.query(g[s2])
                depth = (g[s2] - pos[vi]) @ nrm[vi]
                if depth < clr0:
                    g[s2] = g[s2] + nrm[vi] * (clr0 - depth)
            guides[i] = g
    for i, g in enumerate(guides):
        w0 = rng.uniform(*st["width"]) * S
        base = len(P)
        segs = len(g) - 1
        for s, q in enumerate(g):
            t = s / segs
            d = g[min(s + 1, segs)] - g[max(s - 1, 0)]
            d /= max(np.linalg.norm(d), 1e-6)
            _, vi = body_tree.query(q)
            outn = nrm[vi]
            side = np.cross(d, outn)
            if np.linalg.norm(side) < 1e-4:
                side = np.cross(d, [0.0, 0.0, 1.0])
            side /= np.linalg.norm(side)
            # Narrow where it leaves the scalp, full a little way down, thinning to the tip.
            wdt = w0 * (0.45 + 0.55 * min(1.0, t / 0.18)) * (1.0 - 0.6 * t)
            u0 = rng.uniform(0.0, 0.5) if s == 0 else u0
            for k, sgn in enumerate((-1.0, 1.0)):
                P.append(q + side * wdt * 0.5 * sgn)
                N.append(outn)
                j, w = skin(q, 1.0)
                J.append(j)
                Wt.append(w)
                UV.append((u0 + k * 0.5, t))
                C.append((1.0, 0.0, 0.0, 1.0))
        for s in range(segs):
            a, b = base + s * 2, base + s * 2 + 1
            c, d2 = base + s * 2 + 2, base + s * 2 + 3
            T.append((a, b, c))
            T.append((b, d2, c))
    P = np.array(P)
    return dict(pos=P, nrm=np.array(N), uv=np.array(UV, float), joints=np.array(J, np.uint16),
                weights=np.array(Wt, np.float32), idx=np.array(T, np.int64).reshape(-1).astype(np.uint32),
                color=np.array(C, np.float32))
