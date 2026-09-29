"""Procedural particle / decal sprites -> public/textures/particles/*.png   (numpy + scipy + PIL)
   usage: build_particles.py [name ...]   names: smoke dust fire spark debris muzzle bullet scorch skid cracks shockwave"""
import os, sys, math
import numpy as np
from scipy import ndimage as ndi
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import noise, smoothstep, aniso_noise
from texlib import blur as pblur


def blur(a, sigma):
    return ndi.gaussian_filter(a.astype(np.float32), sigma, mode='constant')

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "public", "textures", "particles")
os.makedirs(OUT, exist_ok=True)


def save_rgba(rgb, a, name):
    arr = np.dstack([np.clip(rgb, 0, 1), np.clip(a, 0, 1)])
    Image.fromarray((arr * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, name), optimize=True)
    print("saved", name, arr.shape[:2], os.path.getsize(os.path.join(OUT, name)) // 1024, "KB", flush=True)


def sheet(cells, cols):
    """cells: list of (rgb, a) -> big (rgb, a)"""
    S = cells[0][1].shape[0]
    rows = (len(cells) + cols - 1) // cols
    rgb = np.zeros((rows * S, cols * S, 3), np.float32)
    a = np.zeros((rows * S, cols * S), np.float32)
    for k, (c, al) in enumerate(cells):
        r, cidx = divmod(k, cols)
        rgb[r * S:(r + 1) * S, cidx * S:(cidx + 1) * S] = c
        a[r * S:(r + 1) * S, cidx * S:(cidx + 1) * S] = al
    return rgb, a


def grid(S):
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    return (xx / (S - 1)) * 2 - 1, (yy / (S - 1)) * 2 - 1


def sstep_rev(a, hi, lo):  # 1 at a<=lo, 0 at a>=hi
    return 1.0 - smoothstep(a, lo, hi)


def norm01(a):
    return 0.5 + 0.5 * np.tanh(a * 0.9)


def shade(d, light_dir=(-0.62, -0.68), steps=14, step_px=None, blur_px=None):
    """volumetric-ish lighting for a density field d: returns (light 0..1 diffuse-wrapped, shadow 0..1)"""
    S = d.shape[0]
    bp = blur_px or S / 150.0
    h = blur(d, bp)
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nrm = np.stack([-gx * S / 12.0, -gy * S / 12.0, np.ones_like(h)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    L = np.array([light_dir[0], light_dir[1], 0.62], np.float32)
    L /= np.linalg.norm(L)
    diff = np.clip((nrm @ L) * 0.5 + 0.5, 0, 1)
    sp = step_px or S / 90.0
    tau = np.zeros_like(d)
    for k in range(1, steps + 1):
        dx, dy = light_dir[0] * k * sp, light_dir[1] * k * sp
        tau += ndi.shift(h, (-dy, -dx), order=1, mode="constant")   # sample toward the light (up-left)
    shadow = np.exp(-tau / steps * 1.5)
    return diff, shadow


# ------------------------------------------------------------------------------------------------ smoke / dust
def puff_frames(S, n, seed, dust=False, aspect=(1.0, 1.0), spread=1.0, scale=1.0):
    x, y = grid(S)
    rng = np.random.default_rng(seed)
    nb = 12 if not dust else 10
    blobs = [(0.0, 0.0, 0.38 * (1 if not dust else 0.9))]
    for i in range(nb - 1):
        a = rng.uniform(0, 2 * math.pi)
        r = (rng.uniform(0, 1) ** 0.8) * (0.34 if not dust else 0.42) * spread
        blobs.append((math.cos(a) * r * aspect[0], math.sin(a) * r * aspect[1] * (1.0 if not dust else 0.55), rng.uniform(0.22, 0.38) * (1 if not dust else 0.85) * (1.0 - 0.25 * r)))
    wa1, wa2 = noise(S, 3.2, seed + 1), noise(S, 3.2, seed + 2)
    wb1, wb2 = noise(S, 3.2, seed + 3), noise(S, 3.2, seed + 4)
    da1, da2 = noise(S, 2.8, seed + 5), noise(S, 2.8, seed + 6)
    fa1, fa2 = noise(S, 2.2, seed + 7), noise(S, 2.2, seed + 8)
    rr = np.sqrt(x * x + y * y)
    frames = []
    for i in range(n):
        t = i / max(1, n - 1)
        th = t * 1.3
        c, s_ = math.cos(th), math.sin(th)
        wa, wb, dd, ff = c * wa1 + s_ * wa2, c * wb1 + s_ * wb2, c * da1 + s_ * da2, c * fa1 + s_ * fa2
        grow = (0.98 + 0.30 * t ** 0.7) * scale
        warp = 0.10 * (0.7 + 0.5 * t)
        X = x + warp * wa
        Y = y + warp * wb
        d = np.zeros((S, S), np.float32)
        for (cx, cy, R) in blobs:
            r2 = ((X - cx * grow) ** 2 + (Y - cy * grow) ** 2) / (R * grow) ** 2
            d += np.clip(1 - r2, 0, 1) ** 1.35
        d = np.clip(d, 0, 1.7)
        det = norm01(dd * 1.1)
        fine = norm01(ff * 1.2)
        d = d * (0.60 + 0.58 * det) * (0.88 + 0.25 * fine)
        d = np.clip(d - 0.04, 0, None)
        d *= sstep_rev(rr, 0.99, 0.72)
        d *= (1.0 - 0.50 * t ** 1.5)
        d *= 1.0 if not dust else 0.85
        d = blur(d, S / 300.0)
        frames.append(d)
    return frames


FAMILIES = [dict(aspect=(1.0, 1.0), spread=1.0, scale=1.15), dict(aspect=(1.3, 0.8), spread=1.1, scale=1.05),
            dict(aspect=(0.75, 1.25), spread=1.0, scale=1.05), dict(aspect=(1.0, 1.0), spread=1.35, scale=0.98)]


def smoke_cells(S=512, seed=3):
    cells = []
    for fi, fam in enumerate(FAMILIES):          # row = one puff family, column = its life (young -> dissipating)
        for d in puff_frames(S, 4, seed + fi * 17, **fam):
            alpha_d = smoothstep(d, 0.0, 0.85) ** 0.9
            diff, shadow = shade(d)
            thick = blur(d, S / 60.0)
            light = np.clip(shadow * (0.35 + 0.65 * diff), 0, 1)
            light = light * (1.0 - 0.22 * smoothstep(thick, 0.35, 1.2))
            lit = np.array([0.90, 0.875, 0.85], np.float32)
            dark = np.array([0.20, 0.215, 0.24], np.float32)
            rgb = dark + (lit - dark) * light[..., None]
            cells.append((rgb, np.clip(alpha_d * 0.97, 0, 0.97)))
    return cells


def dust_cells(S=256, seed=8):
    cells = []
    for fi, fam in enumerate(FAMILIES):
        for d in puff_frames(S, 4, seed + fi * 11, dust=True, **fam):
            alpha_d = smoothstep(d, 0.0, 0.9) ** 0.95
            diff, shadow = shade(d, steps=10)
            light = np.clip(0.45 + 0.55 * shadow * (0.5 + 0.5 * diff), 0, 1)
            lit = np.array([0.88, 0.75, 0.56], np.float32)
            dark = np.array([0.46, 0.37, 0.28], np.float32)
            rgb = dark + (lit - dark) * light[..., None]
            cells.append((rgb, np.clip(alpha_d * 0.88, 0, 0.88)))
    return cells


# ------------------------------------------------------------------------------------------------ fire
def ramp(T):
    stops = np.array([0.0, 0.10, 0.28, 0.5, 0.75, 1.0])
    cols = np.array([[0.10, 0.01, 0.0], [0.45, 0.04, 0.0], [0.92, 0.20, 0.02], [1.0, 0.5, 0.06], [1.0, 0.82, 0.30], [1.0, 0.97, 0.80]])
    return np.stack([np.interp(T, stops, cols[:, k]) for k in range(3)], -1).astype(np.float32)


def fire_cells(S=512, n=16, seed=5):
    x, y = grid(S)
    yn = 1.0 - (y + 1) / 2                     # 0 bottom .. 1 top
    N1 = noise(S, 1.7, seed)
    N2 = noise(S, 2.8, seed + 1)
    N3 = noise(S, 1.1, seed + 2)
    cells = []
    for i in range(n):
        sh = -(i * S // n)
        nf = np.roll(N1, sh, 0)
        nw = np.roll(N2, sh, 0)
        n3 = np.roll(N3, sh * 2, 0)
        # each frame also breathes a little
        breathe = 1 + 0.06 * math.sin(2 * math.pi * i / n)
        hw = 0.34 * np.clip(1 - np.clip(yn - 0.06, 0, 1) / 0.9, 0, 1) ** 0.62 * breathe
        wob = (0.16 * yn ** 1.2 * nw + 0.05 * yn * nf)
        xn = x - wob
        core = np.clip(1 - np.abs(xn) / np.maximum(hw, 1e-3), 0, 1)
        T = core ** 0.85
        lick = norm01(nf * 0.9 + n3 * 0.5)
        T = T * (0.45 + 0.75 * lick)
        tip = np.clip((0.97 - yn + 0.22 * nf * yn) / 0.35, 0, 1)
        T = T * tip
        base = np.exp(-(((x / 0.36) ** 2) + (((yn - 0.04) / 0.10) ** 2)))          # hot base glow
        T = np.clip(T * 1.02 + 0.45 * base, 0, 1)
        T = T * smoothstep(yn, 0.0, 0.05)
        T = blur(T, S / 320.0)
        rgb = ramp(T)
        a = smoothstep(T, 0.035, 0.30)
        cells.append((rgb, a))
    return cells


# ------------------------------------------------------------------------------------------------ sparks / muzzle / shockwave
def spark_sprite(S=256):
    x, y = grid(S)
    r = np.sqrt(x * x + y * y) + 1e-6
    core = np.exp(-(r / 0.10) ** 2) * 1.4
    glow = np.exp(-(r / 0.30) ** 1.6) * 0.55
    th = np.arctan2(y, x)
    star = np.zeros_like(r)
    for k in range(4):
        d = np.abs(((th - k * math.pi / 2 + math.pi) % (2 * math.pi)) - math.pi)
        star += np.exp(-(d / 0.045) ** 2) * np.exp(-r / (0.38 if k % 2 == 0 else 0.26))
    I = np.clip(core + glow + star * 0.75, 0, 1.6)
    I = I * sstep_rev(r, 1.0, 0.75)
    rgb = ramp(np.clip(I * 0.85, 0, 1))
    return rgb, np.clip(I, 0, 1)


def spark_streak(W=256, H=64):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    x = xx / (W - 1)
    y = (yy / (H - 1)) * 2 - 1
    head = np.exp(-(((1 - x) / 0.10) ** 2))
    body = np.exp(-(y / (0.16 + 0.22 * (1 - x))) ** 2) * (x ** 1.6)
    I = np.clip(body * 0.9 + head * np.exp(-(y / 0.32) ** 2) * 1.0, 0, 1.4)
    I *= smoothstep(x, 0.0, 0.08)
    rgb = ramp(np.clip(I * 0.95, 0, 1))
    return rgb, np.clip(I, 0, 1)


def muzzle_cells(S=512):
    x, y = grid(S)
    r = np.sqrt(x * x + y * y) + 1e-6
    th = np.arctan2(y, x)
    cells = []

    def finish(I, seed):
        I = I * sstep_rev(r, 1.0, 0.82)
        I = np.clip(I, 0, 1.5)
        rgb = ramp(np.clip(I * 0.9, 0, 1))
        rgb = rgb * np.clip(I * 1.6, 0, 1)[..., None]                   # additive friendly: fades to black
        return rgb, np.clip(I * 1.4, 0, 1)

    def star(seed, k, longest=0.85, core=0.16, jag=0.5):
        rng = np.random.default_rng(seed)
        I = np.exp(-(r / core) ** 2) * 1.6 + np.exp(-(r / (core * 2.6)) ** 1.5) * 0.5
        base = rng.uniform(0, 2 * math.pi)
        rag = noise(S, 3.2, seed) * 0.4
        for j in range(k):
            a = base + 2 * math.pi * j / k + rng.uniform(-0.25, 0.25)
            L = longest * rng.uniform(0.45, 1.0)
            w = rng.uniform(0.05, 0.10)
            d = np.abs(((th - a + math.pi) % (2 * math.pi)) - math.pi)
            I += np.exp(-(d / (w * (1 + 2.5 * r))) ** 2) * np.exp(-(r / (L * 0.42)) ** 1.3) * 1.1
        I *= (1 + jag * rag * np.clip(r * 2, 0, 1))
        return I

    def cone(seed, length=0.9, spread=0.55, side=0.0, lobes=1):
        rng = np.random.default_rng(seed)
        I = np.exp(-((r / 0.13) ** 2)) * 1.5
        rag = noise(S, 3.2, seed + 3) * 0.6
        for lb in range(lobes):
            ang = 0.0 if lobes == 1 else (-0.22 + 0.44 * lb)
            xr = (x + 0.78) * math.cos(ang) + y * math.sin(ang)                # distance along axis, muzzle at x=-0.78
            yr = -(x + 0.78) * math.sin(ang) + y * math.cos(ang)
            xr0 = np.clip(xr, 0, None)
            hw = 0.05 + spread * 0.24 * xr0 ** 0.8
            I += np.exp(-((yr / (hw * (1 + 0.25 * rag))) ** 2)) * np.exp(-((xr0 / (length * 0.62)) ** 1.6)) * (xr > -0.02) * 1.05
        if side > 0:
            for sgn in (-1, 1):
                a = math.pi / 2 * sgn + rng.uniform(-0.15, 0.15)
                d = np.abs(((th - a + math.pi) % (2 * math.pi)) - math.pi)
                I += side * np.exp(-(d / 0.20) ** 2) * np.exp(-(np.sqrt((x + 0.5) ** 2 + y ** 2) / 0.28) ** 1.4) * (x > -0.75)
        I *= (1 + 0.35 * rag)
        return I

    cells.append(finish(star(1, 7), 1))
    cells.append(finish(star(2, 9, 0.95, 0.14), 2))
    cells.append(finish(star(3, 4, 0.9, 0.15, 0.3), 3))
    cells.append(finish(cone(4), 4))
    cells.append(finish(cone(5, 0.95, 0.7, 0.5), 5))
    cells.append(finish(cone(6, 0.75, 0.4), 6))
    cells.append(finish(star(7, 12, 0.7, 0.2, 0.9) * 0.9, 7))
    cells.append(finish(cone(8, 0.9, 0.55, 0.25, lobes=2), 8))
    return cells


def shockwave(S=512):
    x, y = grid(S)
    r = np.sqrt(x * x + y * y)
    th = np.arctan2(y, x)
    rag = noise(S, 3.0, 21)
    ang = sum(np.cos(th * k + k * 1.7) * (0.6 / k) for k in (2, 3, 5, 8, 13)) * 0.02
    rr = r + ang + rag * 0.012
    ring = np.exp(-((rr - 0.80) / 0.035) ** 2)
    halo = np.exp(-((rr - 0.80) / 0.11) ** 2) * 0.35
    inner = smoothstep(rr, 0.2, 0.8) * 0.10 * (rr < 0.82)
    I = np.clip(ring * 1.2 + halo + inner, 0, 1) * sstep_rev(r, 1.0, 0.9)
    I *= 0.8 + 0.2 * (0.5 + 0.5 * np.tanh(noise(S, 3.0, 22)))
    rgb = np.stack([np.ones_like(I) * 1.0, np.ones_like(I) * 0.95, np.ones_like(I) * 0.86], -1)
    return rgb, np.clip(I, 0, 1)


def blast_flash(S=512):
    x, y = grid(S)
    r = np.sqrt(x * x + y * y) + 1e-6
    th = np.arctan2(y, x)
    rag = noise(S, 3.2, 31) * 0.8
    I = np.exp(-(r / 0.22) ** 2) * 1.6 + np.exp(-(r / 0.55) ** 1.4) * 0.5
    for j, (k, w, L) in enumerate([(9, 0.06, 0.9), (13, 0.04, 0.7), (6, 0.09, 1.0)]):
        rng = np.random.default_rng(40 + j)
        for i in range(k):
            a = rng.uniform(0, 2 * math.pi)
            d = np.abs(((th - a + math.pi) % (2 * math.pi)) - math.pi)
            I += np.exp(-(d / (w * (1 + 2 * r))) ** 2) * np.exp(-(r / (L * 0.5)) ** 1.5) * 0.5
    I *= (1 + 0.3 * rag)
    I *= sstep_rev(r, 1.0, 0.8)
    I = np.clip(I, 0, 1.5)
    rgb = ramp(np.clip(I * 0.8, 0, 1)) * np.clip(I * 1.5, 0, 1)[..., None]
    return rgb, np.clip(I * 1.3, 0, 1)


# ------------------------------------------------------------------------------------------------ debris
def poly_mask(S, pts, ss=3):
    im = Image.new("L", (S * ss, S * ss), 0)
    ImageDraw.Draw(im).polygon([(px * ss, py * ss) for px, py in pts], fill=255)
    return np.asarray(im.resize((S, S), Image.LANCZOS), np.float32) / 255.0


def chunk(S, kind, seed):
    rng = np.random.default_rng(seed)
    cx = cy = S / 2
    if kind in ("rock", "concrete"):
        n = rng.integers(6, 10)
        base = S * rng.uniform(0.22, 0.36)
        asp = rng.uniform(0.6, 1.0)
        rot = rng.uniform(0, 2 * math.pi)
        pts = []
        for i in range(n):
            a = 2 * math.pi * i / n + rng.uniform(-0.25, 0.25)
            rad = base * rng.uniform(0.62, 1.05)
            px, py = math.cos(a) * rad, math.sin(a) * rad * asp
            pts.append((cx + px * math.cos(rot) - py * math.sin(rot), cy + px * math.sin(rot) + py * math.cos(rot)))
        col = np.array([0.42, 0.38, 0.34]) if kind == "rock" else np.array([0.62, 0.60, 0.57])
    elif kind == "dirt":
        n = 14
        base = S * rng.uniform(0.18, 0.28)
        pts = [(cx + math.cos(2 * math.pi * i / n) * base * rng.uniform(0.75, 1.1), cy + math.sin(2 * math.pi * i / n) * base * rng.uniform(0.7, 1.05)) for i in range(n)]
        col = np.array([0.36, 0.25, 0.17])
    elif kind == "metal":
        L, W = S * rng.uniform(0.34, 0.45), S * rng.uniform(0.06, 0.13)
        rot = rng.uniform(0, 2 * math.pi)
        loc = [(-L, -W * rng.uniform(0.5, 1)), (L * rng.uniform(0.2, 0.9), -W * rng.uniform(0.7, 1.3)), (L, rng.uniform(-W, W) * 0.3), (L * rng.uniform(0.3, 0.8), W * rng.uniform(0.7, 1.4)), (-L * rng.uniform(0.6, 1.0), W * rng.uniform(0.4, 1))]
        pts = [(cx + px * math.cos(rot) - py * math.sin(rot), cy + px * math.sin(rot) + py * math.cos(rot)) for px, py in loc]
        col = np.array([0.30, 0.31, 0.33])
    else:  # wood
        L, W = S * rng.uniform(0.36, 0.46), S * rng.uniform(0.045, 0.08)
        rot = rng.uniform(0, 2 * math.pi)
        loc = [(-L, -W), (L * 0.5, -W * 1.1), (L, rng.uniform(-W, W) * 0.4), (L * 0.6, W * 1.1), (-L, W * 0.9)]
        pts = [(cx + px * math.cos(rot) - py * math.sin(rot), cy + px * math.sin(rot) + py * math.cos(rot)) for px, py in loc]
        col = np.array([0.42, 0.30, 0.18])
    m = poly_mask(S, pts)
    inside = ndi.distance_transform_edt(m > 0.5).astype(np.float32)
    h = np.sqrt(np.clip(inside / (inside.max() + 1e-6), 0, 1))
    h = h * (0.6 if kind in ("metal", "wood") else 1.0)
    rough = noise(S, 2.0, seed + 11) * 0.05 + noise(S, 2.8, seed + 12) * 0.05
    if kind in ("rock", "concrete", "dirt"):
        h = h + rough * (1.4 if kind == "dirt" else 1.0)
    hh = h * S * 0.10
    gx = (np.roll(hh, -1, 1) - np.roll(hh, 1, 1)) * 0.5
    gy = (np.roll(hh, -1, 0) - np.roll(hh, 1, 0)) * 0.5
    nrm = np.stack([-gx, -gy, np.ones_like(hh) * 0.9], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    L_ = np.array([-0.55, -0.6, 0.6]); L_ /= np.linalg.norm(L_)
    diff = np.clip(nrm @ L_, 0, 1)
    ao = 0.55 + 0.45 * np.clip(h * 1.5, 0, 1)
    albedo = col[None, None, :] * (0.80 + 0.40 * (0.5 + 0.5 * np.tanh(noise(S, 2.4, seed + 13)))[..., None])
    if kind == "metal":
        spec = np.clip(nrm @ np.array([0.0, -0.3, 1.0]) / 1.04, 0, 1) ** 12
        albedo = albedo + 0.35 * spec[..., None] * (0.3 + diff[..., None])
        rust = smoothstep(noise(S, 1.4, seed + 14), 0.4, 1.4)[..., None] * np.array([0.35, 0.16, 0.06])
        albedo = albedo * (1 - rust.max(-1, keepdims=True) * 0.9) + rust
    if kind == "wood":
        grain = np.sin((x_grid(S) * math.cos(rot) + y_grid(S) * math.sin(rot)) * 0.35 * S / 16 + noise(S, 2.0, seed + 15) * 2.0)
        albedo = albedo * (0.85 + 0.15 * grain[..., None])
    rgb = albedo * (0.30 + 0.85 * diff[..., None]) * ao[..., None]
    edge = np.exp(-(inside / 2.5) ** 2) * 0.10
    rgb = rgb * (1 - edge[..., None] * 0.5)
    return np.clip(rgb, 0, 1), m


def x_grid(S):
    return np.tile(np.arange(S, dtype=np.float32), (S, 1))


def y_grid(S):
    return np.tile(np.arange(S, dtype=np.float32)[:, None], (1, S))


def debris_cells(S=256):
    kinds = ["rock"] * 3 + ["concrete"] * 3 + ["dirt"] * 3 + ["metal"] * 4 + ["wood"] * 3
    cells = []
    for i, k in enumerate(kinds):
        rgb, m = chunk(S, k, 100 + i * 7)
        # colour bleed: dilate colour outward so bilinear filtering never picks up black
        inside = m > 0.02
        idx = ndi.distance_transform_edt(~inside, return_distances=False, return_indices=True)
        rgb2 = rgb[idx[0], idx[1]]
        cells.append((rgb2, m))
    return cells


# ------------------------------------------------------------------------------------------------ decals
def bullet_holes(S=512):
    x, y = grid(S)
    cells, ncells = [], []
    rr = np.sqrt(x * x + y * y) + 1e-6
    th = np.arctan2(y, x)

    def radial_cracks(seed, k, L, w=0.012):
        rng = np.random.default_rng(seed)
        out = np.zeros_like(rr)
        for i in range(k):
            a = rng.uniform(0, 2 * math.pi)
            d = np.abs(((th - a + math.pi) % (2 * math.pi)) - math.pi) * rr
            wob = noise(S, 1.6, seed + i) * 0.006
            out += np.exp(-((d + wob) / w) ** 2) * np.exp(-(rr / (L * rng.uniform(0.5, 1.0))) ** 2) * smoothstep(rr, 0.03, 0.08)
        return np.clip(out, 0, 1)

    # a: asphalt / concrete chip
    rag = noise(S, 3.0, 1)
    R = 0.055 * (1 + 0.25 * rag)
    hole = smoothstep(-rr, -R * 1.15, -R * 0.8)
    crater = np.exp(-((rr - 0.06) / 0.10) ** 2) * (0.7 + 0.3 * noise(S, 1.2, 2))
    chips = smoothstep(noise(S, 2.4, 3) + 0.4 * noise(S, 1.8, 4), 0.6, 1.5) * np.exp(-(rr / 0.30) ** 2)
    cr = radial_cracks(5, 6, 0.30)
    a = np.clip(hole + crater * 0.55 + chips * 0.5 + cr * 0.7, 0, 1) * sstep_rev(rr, 0.98, 0.85)
    dark = np.clip(hole + cr * 0.8 + crater * 0.4, 0, 1)
    light = np.clip(chips * 0.7 + crater * 0.25, 0, 1)
    rgb = np.stack([0.03 + 0.5 * light, 0.03 + 0.48 * light, 0.03 + 0.44 * light], -1) * (1 - 0.0 * dark[..., None])
    rgb = rgb * (1 - dark[..., None]) + 0.02 * dark[..., None]
    hgt = -hole * 1.0 - crater * 0.25 - cr * 0.3
    cells.append((rgb, a)); ncells.append(hgt)

    # b: metal punch with bent petals
    rag = noise(S, 3.0, 6)
    R = 0.05 * (1 + 0.2 * rag)
    hole = smoothstep(-rr, -R * 1.1, -R * 0.75)
    rng = np.random.default_rng(7)
    petals = np.zeros_like(rr)
    for i in range(7):
        a0 = 2 * math.pi * i / 7 + rng.uniform(-0.2, 0.2)
        d = np.abs(((th - a0 + math.pi) % (2 * math.pi)) - math.pi)
        petals += np.exp(-(d / 0.20) ** 2) * smoothstep(rr, R * 0.9, R * 1.3) * (1 - smoothstep(rr, R * 2.0, R * 3.2))
    rim = np.exp(-((rr - R * 1.25) / (R * 0.5)) ** 2)
    scratch = np.exp(-(((rr - 0.19) * (1 + 0.5 * rag)) / 0.16) ** 2) * 0.35 * (0.6 + 0.4 * noise(S, 0.9, 8))
    a = np.clip(hole + rim * 0.9 + petals * 0.8 + scratch * 0.5, 0, 1) * sstep_rev(rr, 0.98, 0.85)
    metal = np.clip(rim * 0.7 + petals * 0.55, 0, 1)
    rgb = np.stack([0.02 + 0.55 * metal + 0.10 * scratch, 0.02 + 0.55 * metal + 0.08 * scratch, 0.02 + 0.58 * metal + 0.07 * scratch], -1)
    rgb = rgb * (1 - hole[..., None]) + 0.01 * hole[..., None]
    hgt = -hole * 1.0 + rim * 0.25 + petals * 0.35
    cells.append((rgb, a)); ncells.append(hgt)

    # c: dirt / sand impact (soft)
    rag = noise(S, 3.0, 9)
    R = 0.06
    pit = np.exp(-(rr / (R * (1 + 0.3 * rag))) ** 2)
    ring = np.exp(-((rr - 0.17) / 0.11) ** 2) * (0.6 + 0.4 * noise(S, 1.2, 10))
    spray = smoothstep(noise(S, 2.2, 11), 0.5, 1.6) * np.exp(-(rr / 0.42) ** 2)
    a = np.clip(pit * 0.95 + ring * 0.35 + spray * 0.35, 0, 1) * sstep_rev(rr, 0.98, 0.8)
    rgb = np.stack([0.05 + 0.30 * ring + 0.2 * spray, 0.04 + 0.24 * ring + 0.16 * spray, 0.03 + 0.17 * ring + 0.11 * spray], -1)
    rgb = rgb * (1 - pit[..., None] * 0.9)
    hgt = -pit * 0.8 + ring * 0.25
    cells.append((rgb, a)); ncells.append(hgt)

    # d: shotgun cluster of small holes + scuffs
    rng = np.random.default_rng(12)
    hole = np.zeros_like(rr); rim = np.zeros_like(rr); scuff = np.zeros_like(rr)
    for i in range(9):
        px, py = rng.normal(0, 0.16, 2)
        rd = math.hypot(px, py)
        if rd > 0.4:
            continue
        d = np.sqrt((x - px) ** 2 + (y - py) ** 2) + noise(S, 3.0, 300 + i) * 0.004
        Rr = rng.uniform(0.018, 0.034)
        hole += smoothstep(-d, -Rr * 1.15, -Rr * 0.8)
        rim += np.exp(-((d - Rr * 1.4) / (Rr * 0.8)) ** 2) * 0.7
        scuff += np.exp(-(d / (Rr * 4.0)) ** 2) * 0.35
    hole, rim, scuff = np.clip(hole, 0, 1), np.clip(rim, 0, 1), np.clip(scuff, 0, 1)
    a = np.clip(hole + rim * 0.6 + scuff * 0.5, 0, 1) * sstep_rev(rr, 0.98, 0.85)
    rgb = np.stack([0.03 + 0.42 * rim + 0.12 * scuff, 0.03 + 0.40 * rim + 0.11 * scuff, 0.03 + 0.38 * rim + 0.10 * scuff], -1)
    rgb = rgb * (1 - hole[..., None]) + 0.01 * hole[..., None]
    hgt = -hole + rim * 0.2
    cells.append((rgb, a)); ncells.append(hgt)

    # normal map sheet
    ns = []
    for h in ncells:
        hh = blur(h.astype(np.float32), 1.2) * S * 0.06
        gx = (np.roll(hh, -1, 1) - np.roll(hh, 1, 1)) * 0.5
        gy = (np.roll(hh, -1, 0) - np.roll(hh, 1, 0)) * 0.5
        nn = np.stack([-gx, gy, np.ones_like(hh)], -1)
        nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
        ns.append((nn * 0.5 + 0.5, np.ones_like(hh)))
    return cells, ns


def scorch_cells(S=512):
    x, y = grid(S)
    cells = []
    for i in range(4):
        seed = 60 + i
        sx, sy = (1.0, 1.0) if i != 3 else (1.0, 0.55)
        rr = np.sqrt((x / sx) ** 2 + (y / sy) ** 2) + 1e-6
        th = np.arctan2(y / sy, x / sx)
        rag = noise(S, 3.2, seed)
        rag2 = noise(S, 2.4, seed + 1)
        rad = 0.55 + 0.16 * rag + 0.05 * rag2
        rng = np.random.default_rng(seed)
        rays = np.zeros_like(rr)
        for k in range(14):
            a = rng.uniform(0, 2 * math.pi)
            d = np.abs(((th - a + math.pi) % (2 * math.pi)) - math.pi)
            rays += np.exp(-(d / rng.uniform(0.04, 0.12)) ** 2) * smoothstep(rr, 0.15, 0.6) * rng.uniform(0.3, 0.9) * (1 - smoothstep(rr, 0.55, 0.95))
        core = 1 - smoothstep(rr, 0.05, rad)
        soot = np.clip(core ** 0.8 * 0.95 + rays * 0.45, 0, 1)
        soot *= (0.70 + 0.30 * (0.5 + 0.5 * np.tanh(noise(S, 2.6, seed + 2)))) * (0.9 + 0.1 * (0.5 + 0.5 * np.tanh(noise(S, 1.3, seed + 3))))
        soot *= sstep_rev(rr, 1.0, 0.85)
        char = np.exp(-(rr / 0.16) ** 2)
        rgb = np.stack([0.035 + 0.02 * (1 - char), 0.03 + 0.015 * (1 - char), 0.028 + 0.012 * (1 - char)], -1) * np.ones((S, S, 1))
        cells.append((rgb, np.clip(soot * 0.94, 0, 0.94)))
    return cells


def skid_tile(W=256, H=1024):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u = xx / (W - 1) * 2 - 1
    # width of mark ~0.55 of tile, ragged edges from streaky noise (periodic in y)
    streak = aniso_noise(H, 60, 3, seed=71)
    st = np.tile(streak[:, :W], (1, 1))[:H, :W]
    f2 = aniso_noise(H, 30, 2, seed=72)[:H, :W]
    n1 = aniso_noise(H, 80, 6, seed=73)[:H, :W]
    edge = 0.55 + 0.05 * f2 + 0.06 * n1
    body = 1 - smoothstep(np.abs(u), edge - 0.12, edge)
    dens = 0.62 + 0.20 * st + 0.10 * f2
    fade = 0.75 + 0.25 * (0.5 + 0.5 * np.tanh(aniso_noise(H, 4, 2, seed=74)[:H, :W]))
    a = np.clip(body * dens * fade, 0, 0.92)
    # thin ridge streaks inside (tread pattern hint)
    tread = 0.5 + 0.5 * np.cos(u * 26 + n1 * 0.6)
    a *= 0.85 + 0.15 * tread
    rgb = np.ones((H, W, 3), np.float32) * np.array([0.03, 0.028, 0.026], np.float32)
    return rgb, np.clip(a, 0, 0.92)


def crack_cells(S=512):
    cells = []
    for i in range(4):
        rng = np.random.default_rng(200 + i)
        ss = 2
        im = Image.new("L", (S * ss, S * ss), 0)
        d = ImageDraw.Draw(im)

        def branch(x0, y0, ang, length, width, depth):
            x, yv, a = x0, y0, ang
            steps = int(length / 6)
            for s in range(steps):
                a += rng.normal(0, 0.22)
                nx, ny = x + math.cos(a) * 6, yv + math.sin(a) * 6
                w = max(1, int(width * (1 - s / steps) ** 0.7 * ss))
                d.line([(x * ss, yv * ss), (nx * ss, ny * ss)], fill=255, width=w)
                x, yv = nx, ny
                if depth > 0 and rng.uniform() < 0.07:
                    branch(x, yv, a + rng.choice([-1, 1]) * rng.uniform(0.5, 1.2), length * rng.uniform(0.25, 0.55), width * 0.6, depth - 1)
                if not (10 < x < S - 10 and 10 < yv < S - 10):
                    break
        cx, cy = S / 2 + rng.normal(0, 20), S / 2 + rng.normal(0, 20)
        nmain = 3 + i % 3
        for k in range(nmain):
            branch(cx, cy, rng.uniform(0, 2 * math.pi), rng.uniform(180, 250), 4.0, 3)
        m = np.asarray(im.resize((S, S), Image.LANCZOS), np.float32) / 255.0
        x, y = grid(S)
        rr = np.sqrt(x * x + y * y)
        m *= sstep_rev(rr, 1.0, 0.80)
        halo = blur(m, 3.0) * 0.5
        lip = np.clip(np.roll(blur(m, 1.2), (2, 2), (0, 1)) - m * 0.6, 0, 1) * 0.35   # bright chipped lip on one side
        a = np.clip(m + halo * 0.5 + lip, 0, 1) * (0.8 + 0.2 * (0.5 + 0.5 * np.tanh(noise(S, 1.2, 210 + i))))
        rgb = np.stack([0.02 + 0.30 * lip, 0.02 + 0.29 * lip, 0.02 + 0.28 * lip], -1)
        rgb = rgb * (1 - np.clip(m, 0, 1)[..., None] * 0.85) + 0.012 * np.clip(m, 0, 1)[..., None]
        cells.append((rgb, a))
    return cells


# ------------------------------------------------------------------------------------------------ main
def do(name):
    if name == "smoke":
        rgb, a = sheet(smoke_cells(512, 3), 4); save_rgba(rgb, a, "smoke_sheet.png")
    elif name == "dust":
        rgb, a = sheet(dust_cells(256, 8), 4); save_rgba(rgb, a, "dust_puff.png")
    elif name == "fire":
        rgb, a = sheet(fire_cells(512, 16, 5), 4); save_rgba(rgb, a, "fire_sheet.png")
    elif name == "spark":
        rgb, a = spark_sprite(256); save_rgba(rgb, a, "spark.png")
        rgb, a = spark_streak(256, 64); save_rgba(rgb, a, "spark_streak.png")
    elif name == "debris":
        rgb, a = sheet(debris_cells(256)[:16], 4); save_rgba(rgb, a, "debris_sheet.png")
    elif name == "muzzle":
        rgb, a = sheet(muzzle_cells(512), 4); save_rgba(rgb, a, "muzzle_flash_sheet.png")
    elif name == "bullet":
        c, n = bullet_holes(512)
        rgb, a = sheet(c, 2); save_rgba(rgb, a, "bullet_hole_sheet.png")
        rgb, a = sheet(n, 2)
        Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "bullet_hole_sheet_normal.png"), optimize=True)
    elif name == "scorch":
        rgb, a = sheet(scorch_cells(512), 2); save_rgba(rgb, a, "scorch_sheet.png")
    elif name == "skid":
        rgb, a = skid_tile(); save_rgba(rgb, a, "skid_mark.png")
    elif name == "cracks":
        rgb, a = sheet(crack_cells(512), 2); save_rgba(rgb, a, "crack_sheet.png")
    elif name == "shockwave":
        rgb, a = shockwave(512); save_rgba(rgb, a, "shockwave.png")
        rgb, a = blast_flash(512); save_rgba(rgb, a, "blast_flash.png")


ALL = ["smoke", "dust", "fire", "spark", "debris", "muzzle", "bullet", "scorch", "skid", "cracks", "shockwave"]
if __name__ == "__main__":
    for n in (sys.argv[1:] or ALL):
        do(n)
