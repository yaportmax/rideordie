"""Procedural fabric / leather painters working on baked atlas attributes (see bake.Baked)."""
import numpy as np

import uvbake as U


def _lin(c):
    return np.asarray(c, np.float32)


def grain(shape, seed, scale=1.6, amp=0.05):
    n = U.fbm(shape, scale=scale, octaves=2, seed=seed, wrap=False)
    return (n - 0.5) * 2.0 * amp


def dust_layer(bk, seed, strength, ground_col=(0.45, 0.36, 0.25)):
    """Dust/grime mask: more toward the bottom edges, in crevices (ao) and in blotches."""
    shape = bk.mask.shape
    blot = U.fbm(shape, scale=90.0, octaves=4, seed=seed)
    fine = U.fbm(shape, scale=6.0, octaves=2, seed=seed + 1)
    low = 1.0 - U.smoothstep(0.0, 1.9, bk.Y)             # lower on the body = dirtier
    edge = 1.0 - U.smoothstep(0.0, 0.06, bk.hem)
    ao = bk.extra.get("ao", np.zeros(shape, np.float32))
    m = strength * (0.25 + 0.5 * low + 0.7 * edge + 0.8 * ao) * (0.35 + 1.2 * blot) * (0.75 + 0.5 * fine)
    return np.clip(m, 0.0, 1.0), np.array(ground_col, np.float32)


def crease_cavity(h, px_per_m, radius_m=0.01):
    """Cavity from a height field: valleys darker."""
    sig = max(radius_m * px_per_m, 1.0)
    cav = U.blur(h, sig) - h
    return np.clip(cav / 0.0012, 0.0, 1.0)


def limb_folds(P, fit, side_key, joint_s, width, k, amp, phase_noise, mask_fn=None):
    """Ring creases around a limb at arc coordinate joint_s: returns height (m) for points P (N,3)."""
    s, r = fit.chain_coord(P, side_key)
    d = (s - joint_s) / width
    env = np.exp(-d * d)
    return env * np.sin(k * (s - joint_s) + phase_noise * 3.0) * amp


def to_uint8(a):
    return (np.clip(a, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


# --- folds --------------------------------------------------------------------------------------------------

def torso_folds(bk, fit, hem_y, amp=0.0022, wavelength=0.075, gather=0.20, seed=1):
    """Vertical drape folds gathered toward the hem / belt on the trunk (height in metres)."""
    shape = bk.mask.shape
    P = bk.P.reshape(-1, 3)
    th = fit.theta(P).reshape(shape)
    y = bk.P[..., 1]
    n1 = U.fbm(shape, 140.0, 3, seed, wrap=False)
    n2 = U.fbm(shape, 45.0, 2, seed + 1, wrap=False)
    R = 0.17
    k = 2 * np.pi / wavelength
    arc = th * R
    ph = k * arc + 5.0 * (n1 - 0.5) + 2.5 * np.sin(y * 9.0 + 3 * n2)
    wave = np.sin(ph) * 0.65 + np.sin(ph * 2.13 + 1.3 * n2) * 0.35
    fall = 1.0 - U.smoothstep(hem_y, hem_y + gather, y)
    dep = bk.extra.get("depth")
    slack = np.clip(dep / 0.03, 0.0, 1.0) if dep is not None else 0.5
    env = 0.25 + 0.75 * fall
    return wave * amp * env * (0.4 + 0.6 * slack) * (0.6 + 0.8 * n2)


def creases(bk, fit, key, s_c, width, wavelength, amp, seed=0, side_bias=None):
    """Ring creases across a limb near joint coordinate s_c (elbow / knee)."""
    shape = bk.mask.shape
    P = bk.P.reshape(-1, 3)
    s, r = fit.chain_coord(P, key)
    s = s.reshape(shape)
    n = U.fbm(shape, 60.0, 3, seed, wrap=False)
    d = (s - s_c) / width
    env = np.exp(-d * d)
    k = 2 * np.pi / wavelength
    h = np.sin(k * (s - s_c) + 4.0 * (n - 0.5)) * env * amp
    return h


def side_seams(bk, fit, depth=0.0009):
    """Shallow seam grooves down both sides of the trunk (at +-90 degrees) and a centre-back seam."""
    shape = bk.mask.shape
    th = fit.theta(bk.P.reshape(-1, 3)).reshape(shape)
    a = np.abs(th)
    w = 0.0045 / 0.17
    g1 = np.exp(-(((a - np.pi / 2) / w) ** 2))
    return -g1 * depth


def edge_roll(bk, band=0.012, height=0.0012):
    """Rolled/hemmed border along free edges."""
    t = np.clip(bk.hem / band, 0.0, 1.0)
    return height * np.sin(np.clip(t, 0, 1) * np.pi) * (bk.hem < band * 1.05)


def finish_maps(alb, h, ppm, cav_strength=0.35, normal_strength=1.0):
    """height (m) -> normal map + cavity shading baked into the albedo."""
    cav = crease_cavity(h, ppm)
    alb = alb * (1.0 - cav_strength * cav[..., None])
    normal = U.height_to_normal(h, ppm, normal_strength)
    return alb, normal


# --- anisotropic (more natural) folds -------------------------------------------------------------------------

def aniso(shape, seed, su, sv):
    """Gaussian-filtered noise, unit std, stretched: su px across the columns (around the limb), sv px down the rows."""
    from scipy import ndimage
    rng = np.random.default_rng(seed)
    n = ndimage.gaussian_filter(rng.standard_normal(shape).astype(np.float32), sigma=(max(sv, 0.3), max(su, 0.3)), mode="wrap")
    return n / max(float(n.std()), 1e-6)


def drape(bk, hem_y, amp=0.002, width=0.022, length=0.16, gather=0.25, base=0.25, seed=1, slack_w=0.6):
    """Long irregular vertical folds, strongest near the hem / belt and where the cloth is slack (height, m)."""
    shape = bk.mask.shape
    ppm = bk.ppm
    n = aniso(shape, seed, width * ppm * 0.5, length * ppm * 0.5)
    n2 = aniso(shape, seed + 7, width * ppm * 0.28, length * ppm * 0.22)
    y = bk.P[..., 1]
    fall = 1.0 - U.smoothstep(hem_y, hem_y + gather, y)
    dep = bk.extra.get("depth")
    slack = np.clip(dep / 0.03, 0.0, 1.0) if dep is not None else 0.5
    env = (base + (1 - base) * fall) * ((1 - slack_w) + slack_w * slack)
    return (0.8 * n + 0.45 * n2) * amp * env


def wrinkles(bk, fit, key, s_c, width, amp=0.0016, along=0.05, across=0.006, seed=1, gain=1.0):
    """Horizontal (ring) wrinkles around a joint at limb coordinate s_c."""
    shape = bk.mask.shape
    ppm = bk.ppm
    act = np.flatnonzero(bk.active.reshape(-1))
    s = np.full(shape[0] * shape[1], -10.0)
    s[act] = fit.chain_coord(bk.P.reshape(-1, 3)[act], key)[0]
    s = s.reshape(shape)
    n = aniso(shape, seed, along * ppm * 0.5, across * ppm * 0.5)
    env = np.exp(-(((s - s_c) / width) ** 2))
    if key[0] in "LR":
        px = bk.P[..., 0]
        env = env * ((px < fit.cx) if key[0] == "L" else (px >= fit.cx))
    return n * amp * env * gain
