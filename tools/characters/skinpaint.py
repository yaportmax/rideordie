"""Paint the MakeHuman skin atlas: tone, dirt, tan, tattoos, scars, stubble, face paint (numpy, texel space)."""
import numpy as np

import cloth
import mh
import uvbake as U


def body_cavity(pos, nrm, tris):
    n = len(pos)
    nb_sum = np.zeros((n, 3))
    nb_cnt = np.zeros(n)
    edge = 0.0
    for a, b in ((0, 1), (1, 2), (2, 0)):
        i, k = tris[:, a], tris[:, b]
        np.add.at(nb_sum, i, pos[k])
        np.add.at(nb_sum, k, pos[i])
        np.add.at(nb_cnt, i, 1)
        np.add.at(nb_cnt, k, 1)
        edge += np.linalg.norm(pos[i] - pos[k], axis=1).mean() / 3.0
    used = nb_cnt > 0
    lap = np.zeros((n, 3))
    lap[used] = nb_sum[used] / nb_cnt[used, None] - pos[used]
    conc = np.einsum("ij,ij->i", lap, nrm) / max(edge, 1e-6)
    cav = np.clip(conc * 2.2, 0.0, 1.0)
    for _ in range(2):
        s = np.zeros(n)
        np.add.at(s, tris[:, 0], cav[tris[:, 1]] + cav[tris[:, 2]])
        np.add.at(s, tris[:, 1], cav[tris[:, 0]] + cav[tris[:, 2]])
        np.add.at(s, tris[:, 2], cav[tris[:, 0]] + cav[tris[:, 1]])
        c = np.zeros(n)
        np.add.at(c, tris.reshape(-1), 1)
        cav = np.where(c > 0, (cav + s / np.maximum(c, 1)) / 2.0, cav)
    return cav


class SkinBake:
    """Rasterise body attributes into the MakeHuman UV atlas."""

    def __init__(self, ch, fit, size=2048, tris=None):
        self.ch, self.fit, self.size = ch, fit, size
        tv, tt = (ch.tv, ch.tt) if tris is None else tris
        nrm = mh.vertex_normals(ch.pos, tv)
        m = mh.split_seams(ch.pos, nrm, ch.vt, tv, tt)
        src = m["src"]
        cav = body_cavity(ch.pos, nrm, tv)
        top = ch.top[src].astype(float)
        attrs = np.concatenate([ch.pos[src], nrm[src], cav[src][:, None], top[:, None], ch.W[src][:, :]], axis=1)
        img, mask = U.rasterize(m["uv"], m["idx"].reshape(-1, 3), attrs, size)
        img = U.dilate(img, mask, max_dist=10)
        self.mask = mask
        self.P = img[..., 0:3]                       # internal space
        self.N = img[..., 3:6]
        self.cav = img[..., 6]
        self.top = np.rint(img[..., 7]).astype(int)
        self.W = img[..., 8:]                        # per-bone weights (H, W, B)
        self.Y = self.P[..., 1]

    def bone_mask(self, *names, thresh=0.5):
        m = np.zeros(self.mask.shape, np.float32)
        for n in names:
            m += self.W[..., mh.BONE_INDEX[n]]
        return np.clip(m, 0, 1)

    def group_mask(self, sub):
        """Sum of weights over all bones whose name contains `sub`."""
        m = np.zeros(self.mask.shape, np.float32)
        for n, i in mh.BONE_INDEX.items():
            if sub in n:
                m += self.W[..., i]
        return np.clip(m, 0, 1)


def blend(alb, colour, mask):
    return alb * (1 - mask[..., None]) + np.asarray(colour, np.float32)[None, None, :] * mask[..., None]


def tone(alb, mul=(1, 1, 1), gamma=1.0, sat=1.0):
    a = np.clip(alb, 0, 1) ** gamma
    a = a * np.asarray(mul, np.float32)
    g = a.mean(axis=-1, keepdims=True)
    return np.clip(g + (a - g) * sat, 0, 1)


def dirt(sb, seed, amount=0.5, col=(0.36, 0.28, 0.2), hands=1.0, low=1.0):
    """Ground-in dirt: hands/forearms/lower legs grimier, crevices (cavity) dark, blotchy."""
    shape = sb.mask.shape
    blot = U.fbm(shape, 120.0, 4, seed)
    fine = U.fbm(shape, 8.0, 2, seed + 3)
    extremity = np.clip(sb.group_mask("Hand") * hands + sb.bone_mask("LeftForeArm", "RightForeArm") * 0.7 * hands
                        + sb.bone_mask("LeftFoot", "RightFoot", "LeftLeg", "RightLeg") * 0.6 * low
                        + sb.bone_mask("LeftArm", "RightArm") * 0.25, 0, 1)
    m = amount * (0.12 + 0.55 * extremity + 0.9 * sb.cav) * (0.35 + 1.1 * blot) * (0.8 + 0.4 * fine)
    return np.clip(m, 0, 0.85)


# --- decals in limb space -------------------------------------------------------------------------------------

def limb_uv(sb, key, phi0_dir):
    """(a, s): metres around the limb (from phi0_dir) and arc length along the limb chain for every texel."""
    fit = sb.fit
    P = sb.P.reshape(-1, 3)
    s, r = fit.chain_coord(P, key)
    pts = fit.chains[key]
    # local axis at s: use direction of the chain segment containing s
    acc = 0.0
    axis = np.zeros_like(P)
    cpt = np.zeros_like(P)
    for a, b in zip(pts[:-1], pts[1:]):
        L = float(np.linalg.norm(b - a))
        sel = (s >= acc) & (s <= acc + L + 1e-9)
        u = (b - a) / L
        axis[sel] = u
        cpt[sel] = a + np.clip(s[sel] - acc, 0, L)[:, None] * u
        acc += L
    v = P - cpt
    v = v - np.einsum("ij,ij->i", v, axis)[:, None] * axis
    e1 = np.asarray(phi0_dir, float)
    e1 = e1[None, :] - np.einsum("j,ij->i", e1, axis)[:, None] * axis
    e1 /= np.maximum(np.linalg.norm(e1, axis=1, keepdims=True), 1e-9)
    e2 = np.cross(axis, e1)
    phi = np.arctan2(np.einsum("ij,ij->i", v, e2), np.einsum("ij,ij->i", v, e1))
    a = phi * np.maximum(r, 0.02)
    return a.reshape(sb.mask.shape), s.reshape(sb.mask.shape), r.reshape(sb.mask.shape)


def ink(alb, mask, colour=(0.08, 0.10, 0.14), strength=0.85):
    m = np.clip(mask, 0, 1) * strength
    lum = alb.mean(axis=-1, keepdims=True)
    tinted = np.asarray(colour, np.float32)[None, None, :] * (0.6 + 0.8 * lum)
    return alb * (1 - m[..., None]) + tinted * m[..., None]


def tribal_band(a, s, s0, s1, period, amp=0.02, seed=0):
    """Repeating tribal spikes around a limb between s0 and s1 (mask 0..1)."""
    rng = np.random.default_rng(seed)
    ph = ((a / period) % 1.0)
    tri = 1.0 - np.abs(ph * 2.0 - 1.0)                # 0..1..0
    edge_top = s0 + amp * tri
    edge_bot = s1 - amp * (1.0 - tri) * 0.8
    band = (s > edge_top) & (s < edge_bot)
    ring1 = np.abs(s - (s0 - 0.006)) < 0.0025
    ring2 = np.abs(s - (s1 + 0.006)) < 0.0025
    # inner lightning cut-outs
    cut = ((np.abs(ph - 0.5) < 0.04 * (1 - (s - s0) / max(s1 - s0, 1e-3))) & (s > s0 + amp * 0.6))
    m = (band & ~cut) | ring1 | ring2
    return U.blur(m.astype(np.float32), 0.7)


def flame_sleeve(a, s, s0, s1, seed=0, scale=0.05):
    """Dense blackwork: domain-warped noise thresholded, fading toward s1."""
    sh = a.shape
    n = U.fbm(sh, 22.0, 3, seed, wrap=False)
    n2 = U.fbm(sh, 60.0, 2, seed + 1, wrap=False)
    fade = 1.0 - U.smoothstep(s0, s1, s)
    thr = 0.5 - 0.22 * fade
    m = ((n * 0.7 + n2 * 0.3) > thr + 0.08).astype(np.float32) * (s > s0) * (s < s1 + 0.02)
    return U.blur(m, 0.8)


def line_mask_3d(P, pts, width):
    """Distance-based mask to a 3D polyline (internal-space points), P (H, W, 3)."""
    shp = P.shape[:2]
    Q = P.reshape(-1, 3)
    d = np.full(len(Q), 1e9)
    for a, b in zip(pts[:-1], pts[1:]):
        ab = b - a
        L2 = float(ab @ ab)
        t = np.clip(((Q - a) @ ab) / max(L2, 1e-12), 0, 1)
        q = a + t[:, None] * ab
        d = np.minimum(d, np.linalg.norm(Q - q, axis=1))
    return d.reshape(shp)


def scar(alb, P, pts, width=0.004, colour=(0.62, 0.42, 0.40), strength=0.8):
    d = line_mask_3d(P, pts, width)
    core = 1.0 - U.smoothstep(width * 0.3, width, d)
    halo = 1.0 - U.smoothstep(width, width * 3.0, d)
    alb = alb * (1 - 0.25 * halo[..., None]) + np.asarray([0.55, 0.3, 0.28], np.float32) * 0.25 * halo[..., None] * 0
    return blend(alb, colour, core * strength)
