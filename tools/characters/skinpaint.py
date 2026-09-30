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


_GROUPS = {
    "LeftArm": ["LeftArm"], "RightArm": ["RightArm"], "LeftForeArm": ["LeftForeArm"], "RightForeArm": ["RightForeArm"],
    "LeftHand": [n for n in mh.BONE_NAMES if n.startswith("LeftHand")], "RightHand": [n for n in mh.BONE_NAMES if n.startswith("RightHand")],
    "Head": ["Head"], "Neck": ["Neck"],
    "LeftLeg": ["LeftUpLeg", "LeftLeg"], "RightLeg": ["RightUpLeg", "RightLeg"],
    "LeftFoot": ["LeftFoot", "LeftToeBase"], "RightFoot": ["RightFoot", "RightToeBase"],
    "Torso": ["Spine", "Spine1", "Spine2", "Hips", "LeftShoulder", "RightShoulder"],
}
_GKEYS = list(_GROUPS)


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
        gw = np.stack([ch.W[:, [mh.BONE_INDEX[b] for b in _GROUPS[k]]].sum(axis=1) for k in _GKEYS], axis=1)
        attrs = np.concatenate([ch.pos[src], nrm[src], cav[src][:, None], top[:, None], gw[src]], axis=1).astype(np.float32)
        img, mask = U.rasterize(m["uv"], m["idx"].reshape(-1, 3), attrs, size)
        img = U.dilate(img, mask, max_dist=10)
        self.mask = mask
        self.P = img[..., 0:3]                       # internal space
        self.N = img[..., 3:6]
        self.cav = img[..., 6]
        self.top = np.rint(img[..., 7]).astype(int)
        self.G = {k: img[..., 8 + i] for i, k in enumerate(_GKEYS)}
        self.Y = self.P[..., 1]
        # coverage of the FULL-resolution MakeHuman UVs (the original texture is only valid there)
        full = getattr(ch, "full", None)
        if full is not None:
            fuv = full["vt"][full["tt"]].reshape(-1, 2)
            fuv = np.stack([fuv[:, 0], 1.0 - fuv[:, 1]], axis=1)
            _, fm = U.rasterize(fuv, np.arange(len(fuv)).reshape(-1, 3), np.zeros((len(fuv), 1)), size)
            self.src_mask = fm
        else:
            self.src_mask = mask

    def fill_gutters(self, img):
        """Replace texels outside the source texture's UV islands by the nearest valid texel (kills pale seams)."""
        return U.dilate(np.asarray(img, np.float32), self.src_mask)

    def bone_mask(self, *names, thresh=0.5):
        m = np.zeros(self.mask.shape, np.float32)
        for n in names:
            m += self.G[n]
        return np.clip(m, 0, 1)

    def group_mask(self, sub):
        m = np.zeros(self.mask.shape, np.float32)
        for k in _GKEYS:
            if sub in k:
                m += self.G[k]
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

def limb_uv(sb, key, phi0_dir, sel=None):
    """(a, s, r): metres around the limb (from phi0_dir), arc length along the limb chain and radius, for every texel.
    sel: optional bool image restricting the (expensive) evaluation; other texels get s = -10."""
    fit = sb.fit
    Pfull = sb.P.reshape(-1, 3)
    if sel is not None:
        idx = np.flatnonzero(sel.reshape(-1))
        P = Pfull[idx]
    else:
        idx = None
        P = Pfull
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
    if idx is not None:
        A = np.zeros(Pfull.shape[0]); S = np.full(Pfull.shape[0], -10.0); R = np.zeros(Pfull.shape[0])
        A[idx], S[idx], R[idx] = a, s, r
        a, s, r = A, S, R
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


def flame_sleeve(a, s, s0, s1, seed=0, scale=0.05, period=0.034):
    """Graphic flame tattoo licking up the limb from s1 toward s0 (a = metres around the limb, s = along it):
    tongues of varying height with thin cut-outs; returns a 0..1 mask."""
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 6.28, 3)
    k = 2 * np.pi / period
    tong = 0.5 + 0.5 * np.sin(a * k + 1.7 * np.sin(a * k * 0.43 + ph[0]) + ph[1])
    tong = tong ** 1.6
    L = s1 - s0
    top = s1 - L * (0.25 + 0.75 * tong)                     # flames rise from s1 toward s0
    body = (s > top) & (s < s1)
    # inner cut-out: a thinner flame inside each tongue
    tong2 = 0.5 + 0.5 * np.sin(a * k + 1.7 * np.sin(a * k * 0.43 + ph[0]) + ph[1] + 0.0)
    inner_top = s1 - L * (0.12 + 0.45 * tong2 ** 2.2)
    width_ok = np.abs(np.sin(a * k * 0.5 + ph[1] * 0.5 + 0.9 * np.sin(a * k * 0.43 + ph[0]))) > 0.82
    cut = width_ok & (s > inner_top) & (s < s1 - 0.012)
    base = (s > s1) & (s < s1 + 0.006)                      # solid rim at the base of the flames
    m = (body & ~cut) | base
    return U.blur(m.astype(np.float32), 0.7)


def line_mask_3d(P, pts, width):
    """Distance-based mask to a 3D polyline (internal-space points), P (H, W, 3); evaluated near the polyline only."""
    shp = P.shape[:2]
    Qfull = P.reshape(-1, 3)
    lo, hi = pts.min(axis=0) - width * 6, pts.max(axis=0) + width * 6
    near = np.all((Qfull >= lo) & (Qfull <= hi), axis=1)
    idx = np.flatnonzero(near)
    Q = Qfull[idx]
    d = np.full(len(Q), 1e9)
    for a, b in zip(pts[:-1], pts[1:]):
        ab = b - a
        L2 = float(ab @ ab)
        t = np.clip(((Q - a) @ ab) / max(L2, 1e-12), 0, 1)
        q = a + t[:, None] * ab
        d = np.minimum(d, np.linalg.norm(Q - q, axis=1))
    out = np.full(len(Qfull), 1e9)
    out[idx] = d
    return out.reshape(shp)


def scar(alb, P, pts, width=0.004, colour=(0.62, 0.42, 0.40), strength=0.8):
    d = line_mask_3d(P, pts, width)
    core = 1.0 - U.smoothstep(width * 0.3, width, d)
    halo = 1.0 - U.smoothstep(width, width * 3.0, d)
    alb = alb * (1 - 0.25 * halo[..., None]) + np.asarray([0.55, 0.3, 0.28], np.float32) * 0.25 * halo[..., None] * 0
    return blend(alb, colour, core * strength)


def freckles(alb, sb, ch, seed=1, amount=0.6, colour=(0.45, 0.28, 0.18)):
    """Freckles over the nose bridge and cheeks (internal-space face box from the eye positions)."""
    eL = mh.to_game(ch.body.mh_bone("eye.L")[0]) + ch.lift
    eR = mh.to_game(ch.body.mh_bone("eye.R")[0]) + ch.lift
    c = 0.5 * (eL + eR)
    half = abs(eL[0] - eR[0]) * 0.5
    P = sb.P
    inside = (np.abs(P[..., 0] - c[0]) < half * 2.1) & (P[..., 1] < c[1] + 0.008) & (P[..., 1] > c[1] - 0.06) & (P[..., 2] < c[2] + 0.02) & (sb.N[..., 2] < -0.3)
    n = U.fbm(sb.mask.shape, 2.6, 2, seed, wrap=False)
    dots = U.smoothstep(0.66, 0.76, n) * inside
    dots = U.blur(dots.astype(np.float32), 0.6)
    return blend(alb, colour, np.clip(dots * amount, 0, 1))


def face_box(ch):
    eL = mh.to_game(ch.body.mh_bone("eye.L")[0]) + ch.lift
    eR = mh.to_game(ch.body.mh_bone("eye.R")[0]) + ch.lift
    return eL, eR


def _face_frame(ch):
    eL, eR = face_box(ch)
    c = 0.5 * (eL + eR)
    half = abs(eL[0] - eR[0]) * 0.5
    return c, half


def stubble(alb, sb, ch, seed=1, amount=0.6, colour=(0.07, 0.055, 0.045), cheeks=0.45, chin=1.0, lip=1.0):
    """Beard shadow / stubble over the lower face (mouth excluded), denser at chin and moustache."""
    c, half = _face_frame(ch)
    P, N = sb.P, sb.N
    u = half / 0.032                                  # scale relative to a 64 mm eye spacing
    x = np.abs(P[..., 0] - c[0]) / u
    y = (P[..., 1] - c[1]) / u
    front = N[..., 2] < 0.55
    face = sb.G["Head"] > 0.5
    reg = (face & front & (y > -0.128) & (x < 0.078) & (P[..., 2] < c[2] + 0.06 * u)).astype(np.float32)
    # soft, slightly irregular cheek line (higher toward the sideburns)
    cheek_line = -0.050 + 0.012 * np.clip(x / 0.07, 0, 1) + 0.004 * (U.fbm(sb.mask.shape, 12.0, 2, seed + 7, wrap=False) - 0.5)
    reg = reg * (1.0 - U.smoothstep(cheek_line - 0.006, cheek_line + 0.006, y))
    # jaw line falloff
    jaw = 1.0 - U.smoothstep(0.045, 0.078, x + np.maximum(-y - 0.09, 0) * 0.6)
    n = U.fbm(sb.mask.shape, 1.9, 2, seed, wrap=False)
    dots = U.smoothstep(0.42, 0.6, n)
    dens = reg * jaw * (0.35 * cheeks + 0.65 * chin * U.smoothstep(-0.085, -0.108, y) + 0.5 * lip * (y > -0.075))
    # keep the lips clean
    lips = (np.abs(y + 0.078) < 0.0085) & (x < 0.030)
    dens = dens * (1 - lips)
    m = np.clip(dens * (0.4 + 0.6 * dots) * amount, 0, 0.9)
    m = U.blur(m.astype(np.float32), 0.5)
    return blend(alb, colour, m)


def sunburn(alb, sb, ch, amount=0.35, colour=(0.72, 0.30, 0.22)):
    """Red-brown burn on nose, cheeks, ears, neck, shoulders and forearms."""
    c, half = _face_frame(ch)
    P = sb.P
    u = half / 0.032
    x = np.abs(P[..., 0] - c[0]) / u
    y = (P[..., 1] - c[1]) / u
    nose = np.exp(-((x / 0.012) ** 2 + ((y + 0.018) / 0.03) ** 2))
    cheek = np.exp(-(((x - 0.045) / 0.028) ** 2 + ((y + 0.03) / 0.03) ** 2))
    neck = sb.bone_mask("Neck") * 0.8
    sh = np.clip(sb.bone_mask("LeftArm", "RightArm") * 0.7 + sb.bone_mask("LeftForeArm", "RightForeArm") * 0.5, 0, 1)
    m = np.clip((nose + cheek) * 0.9 + neck + sh * 0.6, 0, 1) * amount
    m = m * (0.6 + 0.8 * U.fbm(sb.mask.shape, 70.0, 3, 5))
    return blend(alb, colour, np.clip(m, 0, 0.6))


def face_bands(alb, sb, ch, paint):
    """Apply face-paint shapes: paint(x, y, front_mask, u) -> (mask, colour) items, x/y in eye-spacing-relative metres."""
    c, half = _face_frame(ch)
    P, N = sb.P, sb.N
    u = half / 0.032
    x = (P[..., 0] - c[0]) / u
    y = (P[..., 1] - c[1]) / u
    front = ((N[..., 2] < 0.3) & (P[..., 2] < c[2] + 0.035 * u) & (sb.G["Head"] > 0.5)).astype(np.float32)
    for mask, colour, strength in paint(x, y, front):
        alb = blend(alb, colour, np.clip(U.blur((mask * front).astype(np.float32), 0.6) * strength, 0, 1))
    return alb


# --- relief (normal map) + roughness for the skin ------------------------------------------------------------------------------

def _texel_metres(P, mask):
    """Metres per texel along x (columns) and y (rows) from the baked positions (smoothed, >0)."""
    dx = np.linalg.norm(np.diff(P, axis=1, append=P[:, -1:]), axis=-1)
    dy = np.linalg.norm(np.diff(P, axis=0, append=P[-1:]), axis=-1)
    m = mask.astype(bool)
    for d in (dx, dy):
        good = m & (d > 1e-6) & (d < 0.02)
        med = float(np.median(d[good])) if good.any() else 1e-3
        d[~good] = med
    return U.blur(dx, 2.0), U.blur(dy, 2.0)


def skin_relief(sb, ch, age=0.5, muscle=0.5, seed=1):
    """Height field (metres) of the skin: forehead lines, frown lines, crow's feet, under-eye creases, nasolabial folds,
    lip crease + vertical lip lines, knuckle creases, forearm veins.  Returns (height, crease mask 0..1, roughness 0..1)."""
    rng = np.random.default_rng(seed)
    P, shape = sb.P, sb.mask.shape
    head = sb.G["Head"] > 0.5
    c, half = _face_frame(ch)
    u = half / 0.032
    x = (P[..., 0] - c[0]) / u
    y = (P[..., 1] - c[1]) / u
    front = (sb.N[..., 2] < 0.35) & head & (P[..., 2] < c[2] + 0.05 * u)
    ak = float(np.clip((age - 0.30) * 3.2, 0.35, 1.3))
    acc = {"h": np.zeros(shape, np.float32), "c": np.zeros(shape, np.float32)}

    def groove(mask, depth, soft=1.0):
        m = U.blur(mask.astype(np.float32), soft)
        acc["h"] -= m * depth
        acc["c"] = np.maximum(acc["c"], m)

    # forehead lines (wavy, broken)
    for k, yy in enumerate((0.052, 0.064, 0.077)):
        wav = yy + 0.0025 * np.sin(x * 70 + k * 1.7) + 0.0015 * np.sin(x * 190 + k)
        brk = U.fbm(shape, 25.0, 2, seed + k, wrap=False) > 0.38
        groove((np.abs(y - wav) < 0.0014) & (np.abs(x) < 0.050 - 0.006 * k) & brk & front, 0.00035 * ak)
    # frown lines between the brows
    for sx in (-1, 1):
        groove((np.abs(x - sx * (0.007 + 0.12 * (y - 0.03))) < 0.0009) & (y > 0.026) & (y < 0.042) & front, 0.0003 * ak)
    # crow's feet
    for sx in (-1, 1):
        for a in (-0.35, 0.0, 0.35):
            px, py = sx * x - 0.056, y - 0.002
            t = px * np.cos(a) + py * np.sin(a)
            dist = np.abs(-px * np.sin(a) + py * np.cos(a))
            groove((dist < 0.0010) & (t > 0) & (t < 0.014) & front, 0.0003 * ak)
    # under-eye crease (arc)
    for sx in (-1, 1):
        r = np.hypot((x - sx * 0.032) / 1.3, y + 0.002)
        groove((np.abs(r - 0.0135) < 0.0009) & (y < -0.009) & (np.abs(x - sx * 0.032) < 0.011) & front, 0.00025 * ak, 0.8)
    # nasolabial folds: nose wing -> mouth corner (deep, soft)
    for sx in (-1, 1):
        t = np.clip((-0.022 - y) / 0.062, 0, 1)
        cx = sx * (0.019 + 0.012 * t + 0.006 * np.sin(t * np.pi))
        groove((np.abs(x - cx) < 0.0018) & (y < -0.020) & (y > -0.086) & front, 0.0007 * (0.6 + 0.4 * ak), 1.2)
    # mouth: lip crease, corners, philtrum, vertical lip lines
    groove((np.abs(y + 0.0775 + 0.004 * (x / 0.03) ** 2) < 0.0012) & (np.abs(x) < 0.027) & front, 0.0007, 0.7)
    for sx in (-1, 1):
        groove((np.hypot(x - sx * 0.029, y + 0.080) < 0.0035) & front, 0.0004, 1.0)
    groove((np.abs(x) < 0.005) & (y < -0.052) & (y > -0.070) & front, 0.00025, 1.5)
    lipz = (np.abs(y + 0.078) < 0.010) & (np.abs(x) < 0.025) & front
    groove(lipz & (np.abs(np.sin(x * 900 + 2 * np.sin(y * 300))) < 0.22), 0.0001, 0.5)
    # hands: knuckle creases around every finger joint
    Hh = {n: np.asarray(ch.sk["heads"][n], float) for n in mh.BONE_NAMES if n in ch.sk["heads"]}
    for side in ("Left", "Right"):
        hand = sb.G[side + "Hand"] > 0.5
        for f in ("Index", "Middle", "Ring", "Pinky", "Thumb"):
            for j in (2, 3):
                n0, nprev = "%sHand%s%d" % (side, f, j), "%sHand%s%d" % (side, f, j - 1)
                if n0 not in Hh or nprev not in Hh:
                    continue
                p = Hh[n0]
                ax = p - Hh[nprev]
                ax /= max(np.linalg.norm(ax), 1e-6)
                rel = P - p
                along = rel @ ax
                rad = np.linalg.norm(rel - along[..., None] * ax, axis=-1)
                near = (rad < 0.014) & hand
                for off in (-0.0022, 0.0, 0.0022):
                    groove(near & (np.abs(along - off) < 0.0007), 0.00025)
    # forearm veins (muscular bodies): meandering raised lines on the forearm
    if muscle > 0.45:
        for side in ("Left", "Right"):
            el, wr = Hh[side + "ForeArm"], Hh[side + "Hand"]
            ax = (wr - el) / np.linalg.norm(wr - el)
            rel = P - el
            along = rel @ ax
            perp = rel - along[..., None] * ax
            ang = np.arctan2(perp[..., 1], perp[..., 2])
            L = np.linalg.norm(wr - el)
            sel = (sb.G[side + "ForeArm"] > 0.5) & (along > 0.02) & (along < L - 0.02)
            for k in range(2):
                a0 = rng.uniform(-2.4, -1.0) if k == 0 else rng.uniform(-1.8, -0.6)
                path = a0 + 0.25 * np.sin(along * rng.uniform(25, 40) + rng.uniform(0, 6))
                vein = sel & (np.abs(ang - path) < 0.05)
                acc["h"] += U.blur(vein.astype(np.float32), 1.2) * 0.0005 * (muscle - 0.3)
    # roughness: oily T-zone and lips glossier, the rest satin
    rough = np.full(shape, 0.66, np.float32)
    tz = front & (((np.abs(x) < 0.018) & (y > -0.06) & (y < 0.02)) | ((y > 0.035) & (np.abs(x) < 0.045)))
    rough -= U.blur(tz.astype(np.float32), 3.0) * 0.14
    rough -= U.blur(lipz.astype(np.float32), 1.5) * 0.10
    rough += 0.06 * (U.fbm(shape, 30.0, 2, seed + 9, wrap=False) - 0.5)
    rough += acc["c"] * 0.08
    acc["lips"] = U.blur(lipz.astype(np.float32), 1.5)
    skin_relief.last_lips = acc["lips"]
    mouth = (np.abs(y + 0.0775 + 0.004 * (x / 0.03) ** 2) < 0.0024) & (np.abs(x) < 0.026) & front
    skin_relief.last_mouth = U.blur(mouth.astype(np.float32), 0.8)
    rough = np.maximum(rough, skin_relief.last_mouth * 0.85)
    return acc["h"], acc["c"], np.clip(rough, 0.3, 0.9)


def relief_normal(sb, h, strength=1.0):
    """Tangent-space normal map from a skin height field, gradients in metres using the per-texel scale."""
    mx, my = _texel_metres(sb.P, sb.mask)
    gy, gx = np.gradient(h.astype(np.float32))
    gx = gx / mx * strength
    gy = gy / my * strength
    n = np.stack([-gx, gy, np.ones_like(gx)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return ((n * 0.5 + 0.5) * 255.0 + 0.5).astype(np.uint8)
