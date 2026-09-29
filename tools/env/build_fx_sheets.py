"""FX flipbooks for the particle atlas (numpy + scipy + PIL) -> public/textures/particles/
   usage: python tools/env/build_fx_sheets.py [flame] [fireball] [smoke] [dust] [preview]

   flame_sheet.png     8x4 frames (128x256): a seamlessly LOOPING flame tongue (noise scrolls up one period per loop),
                       colour baked (white-yellow core -> orange -> red licks), straight alpha. Played at ~30 fps.
   fireball_sheet.png  8x8 frames (128x128): one explosion fireball over its life (played once): white-hot turbulent ball
                       that billows out, cools through orange/red and chars into sooty smoke. Ray-marched 3D noise volume.
   smoke_lit.png       4 families x 4 life frames (256x256): NORMAL-LIT smoke puffs. RG = view-space normal (x right, y up),
                       B = thinness (light that makes it through, for back-lit glow), A = coverage. Lit at runtime by the
                       sun/moon + sky (see particles.js). Ray-marched 3D noise blobs, so the billows read as volumes.
   dust_lit.png        same encoding, wispier / flatter dust clouds.
"""
import os, sys, math
import numpy as np
from scipy import ndimage as ndi
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "public", "textures", "particles")
PREV = os.path.join(ROOT, "shots", "fx", "v2")
os.makedirs(OUT, exist_ok=True)


def sstep(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def noise2(n, beta=2.0, seed=0, fmax=None):
    """periodic fbm (n x n), zero mean, unit std"""
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(n) * n
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt(fx * fx + fy * fy); r[0, 0] = 1
    amp = r ** (-beta / 2.0); amp[0, 0] = 0
    if fmax: amp = amp * np.exp(-(r / fmax) ** 4)
    a = np.real(np.fft.ifft2(amp * np.exp(1j * rng.uniform(0, 2 * np.pi, (n, n)))))
    a -= a.mean(); a /= a.std() + 1e-9
    return a.astype(np.float32)


def noise3(n, beta=2.2, seed=0, fmax=None):
    """periodic 3D fbm volume (n^3), zero mean, unit std"""
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(n) * n
    fx, fy, fz = np.meshgrid(f, f, f, indexing="ij")
    r = np.sqrt(fx * fx + fy * fy + fz * fz); r[0, 0, 0] = 1
    amp = r ** (-beta / 2.0 - 0.5); amp[0, 0, 0] = 0
    if fmax: amp = amp * np.exp(-(r / fmax) ** 4)
    a = np.real(np.fft.ifftn(amp * np.exp(1j * rng.uniform(0, 2 * np.pi, (n, n, n)))))
    a -= a.mean(); a /= a.std() + 1e-9
    return a.astype(np.float32)


def samp2(tex, u, v):
    """bilinear wrap sample of a periodic 2D texture at texel coords (u = column, v = row)"""
    return ndi.map_coordinates(tex, [v.ravel(), u.ravel()], order=1, mode="grid-wrap").reshape(u.shape)


def samp3(vol, x, y, z):
    return ndi.map_coordinates(vol, [x.ravel(), y.ravel(), z.ravel()], order=1, mode="grid-wrap").reshape(x.shape)


def to_img(rgb_lin, a, srgb=True):
    """straight-alpha RGBA uint8. rgb in linear 0..1 is stored gamma-2 encoded (the particle shader squares it)."""
    c = np.sqrt(np.clip(rgb_lin, 0, 1)) if srgb else np.clip(rgb_lin, 0, 1)
    arr = np.dstack([c, np.clip(a, 0, 1)[..., None]])
    return (arr * 255 + 0.5).astype(np.uint8)


def save(arr, name):
    p = os.path.join(OUT, name)
    Image.fromarray(arr, "RGBA").save(p, optimize=True)
    print("saved", name, arr.shape[1], "x", arr.shape[0], os.path.getsize(p) // 1024, "KB", flush=True)


def down2(a):
    """2x box downsample (supersampled render -> final)"""
    h, w = a.shape[:2]
    return a.reshape(h // 2, 2, w // 2, 2, *a.shape[2:]).mean(axis=(1, 3))


def tile(frames, cols):
    h, w = frames[0].shape[:2]
    rows = (len(frames) + cols - 1) // cols
    out = np.zeros((rows * h, cols * w, frames[0].shape[2]), np.uint8)
    for k, f in enumerate(frames):
        r, c = divmod(k, cols)
        out[r * h:(r + 1) * h, c * w:(c + 1) * w] = f
    return out


# ------------------------------------------------------------------------------------------------ fire colour
FIRE_RAMP = np.array([
    [0.00, 0.000, 0.000, 0.000],
    [0.08, 0.120, 0.010, 0.003],
    [0.22, 0.450, 0.055, 0.010],
    [0.42, 0.900, 0.210, 0.025],
    [0.62, 1.000, 0.430, 0.070],
    [0.80, 1.000, 0.680, 0.220],
    [1.00, 1.000, 0.920, 0.700],
], np.float32)


def fire_col(T):
    T = np.clip(T, 0, 1)
    out = np.zeros(T.shape + (3,), np.float32)
    for c in range(3):
        out[..., c] = np.interp(T, FIRE_RAMP[:, 0], FIRE_RAMP[:, c + 1])
    return out


# ------------------------------------------------------------------------------------------------ flame tongues
def flame_sheet(N=32, W=128, H=256, cols=8):
    SS = 2
    w, h = W * SS, H * SS
    P = 256                                                    # noise tile (texels); the flame scrolls whole tiles per loop
    nA = noise2(P, beta=2.4, seed=11)                          # big licks
    nB = noise2(P, beta=1.8, seed=12)                          # detail
    nW = noise2(P, beta=2.8, seed=13)                          # domain warp
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    x = (xx + 0.5) / w * 2 - 1                                 # -1..1
    y = 1.0 - (yy + 0.5) / h                                   # 0 bottom .. 1 top
    frames = []
    for k in range(N):
        ph = k / N
        su = (x * 0.5 + 0.5) * P * 0.42
        sv = (1 - y) * P * 0.62
        warp = samp2(nW, su * 0.5 + 17, sv * 0.5 + ph * P)
        lick = samp2(nA, su * 0.8 + warp * 12 * (0.2 + y), sv * 0.8 + ph * P * 2)
        det = samp2(nB, su * 1.3 + 40, sv * 1.2 + ph * P * 3)
        sway = 0.08 * y ** 1.5 * np.sin(2 * math.pi * (ph + 0.5 * y)) + 0.12 * y ** 1.3 * warp
        xr = (x - sway)
        hw = 0.78 * np.clip(1.02 - y, 0.0, 1.0) ** 0.5 * (0.70 + 0.30 * sstep(y, 0.0, 0.12))
        shape = 1.0 - (np.abs(xr) / np.maximum(hw, 1e-3)) ** 2 - 0.9 * y ** 1.3
        split = 0.5 + 0.5 * np.cos(xr * math.pi * 2.6 + warp * 2.2 + 1.3)          # 2-3 tongues in the upper half
        q = shape + (lick * 0.72 + det * 0.14) * (0.08 + 0.66 * y) - 0.42 * sstep(y, 0.25, 0.8) * split
        q = np.clip(q * sstep(y, 0.0, 0.05), 0, 1.4)
        heat = (0.46 + 0.54 * (1 - y) ** 1.8) * (0.78 + 0.22 * (1 - sstep(np.abs(xr) / np.maximum(hw, 0.05), 0, 0.8)))
        T = np.clip(q, 0, 1) ** 0.9 * heat
        rgb = fire_col(np.clip(T * 0.98, 0, 1))
        a = sstep(q, 0.02, 0.5)
        img = to_img(rgb, a)
        frames.append(np.clip(down2(img.astype(np.float32)), 0, 255).astype(np.uint8))
    return tile(frames, cols)


# ------------------------------------------------------------------------------------------------ explosion fireball
def fireball_sheet(N=64, S=128, cols=8, steps=56):
    SS = 2
    s = S * SS
    V = 64
    vol = noise3(V, beta=2.0, seed=21, fmax=9)
    vol2 = noise3(V, beta=1.4, seed=22, fmax=18)
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    px = (xx + 0.5) / s * 2 - 1
    py = 1 - (yy + 0.5) / s * 2
    zs = np.linspace(-1, 1, steps, dtype=np.float32)
    dz = zs[1] - zs[0]
    frames = []
    rng = np.random.default_rng(5)
    for k in range(N):
        t = k / (N - 1)
        R = 0.50 + 0.20 * (1 - (1 - t) ** 2.4)                 # fast expansion, then it slows (the sprite grows too)
        rise = 0.08 * t
        heat = np.clip(1.35 * (1 - t) ** 1.25, 0, 1.35)
        T = np.ones((s, s), np.float32)                        # transmittance
        C = np.zeros((s, s, 3), np.float32)
        for z in zs:                                           # z = -1 nearest the viewer
            X, Y, Z = px, py - rise, np.full_like(px, z)
            r = np.sqrt(X * X + Y * Y + Z * Z)
            # billowing: noise coords scale with the ball (features grow), plus a slow roll
            nx = (X / R) * 7 + 32 + t * 3.0; ny = (Y / R) * 7 + 32 - t * 6.0; nz = (Z / R) * 7 + 32
            n1 = samp3(vol, nx, ny, nz)
            n2 = samp3(vol2, nx * 2.3 + 7, ny * 2.3, nz * 2.3 + 3)
            shell = R * (1 + 0.26 * n1 + 0.09 * n2)
            dens = sstep(shell - r, -0.02, 0.10 + 0.08 * t) * (0.75 + 0.35 * n2 * 0.5 + 0.25)
            dens *= 1.0 - 0.55 * sstep(t, 0.55, 1.0) * sstep(n2, -0.2, 1.2)     # late: breaks up into wisps
            if not dens.any():
                continue
            sig = dens * (3.2 + 2.0 * t) * dz * 2.5
            # temperature: hottest inside and early; cooler bumps on the outside char first
            tin = np.clip(1 - r / np.maximum(shell, 1e-3), 0, 1)
            Tk = np.clip(heat * (0.28 + 1.0 * tin) + 0.34 * n1 * heat - 0.14, 0, 1)
            Tk = Tk * (1 - 0.65 * sstep(n2, 0.2, 1.3) * sstep(t, 0.08, 0.45))            # sooty patches roll over the ball
            emis = fire_col(Tk) * (Tk[..., None] ** 0.9) * 1.7
            smoke = np.array([0.055, 0.050, 0.046], np.float32) * (0.6 + 0.4 * (0.5 + 0.5 * n2))[..., None]
            a = 1 - np.exp(-sig)
            C += (T * a)[..., None] * (emis + smoke)
            T *= np.exp(-sig)
        alpha = 1 - T
        rgb = C / np.maximum(alpha, 1e-4)[..., None]          # straight colour
        rgb = np.clip(rgb, 0, 1)                               # HDR intensity comes from the particle colour
        img = to_img(rgb, alpha)
        frames.append(np.clip(down2(img.astype(np.float32)), 0, 255).astype(np.uint8))
        print("  fireball frame", k, flush=True) if k % 16 == 0 else None
    return tile(frames, cols)


# ------------------------------------------------------------------------------------------------ normal-lit smoke / dust
def lit_puffs(fam=4, life=4, S=256, steps=48, dust=False, seed=31):
    SS = 1
    s = S * SS
    V = 64
    vol = noise3(V, beta=2.0 if not dust else 1.6, seed=seed)
    vol2 = noise3(V, beta=1.3, seed=seed + 1)
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    px = (xx + 0.5) / s * 2 - 1
    py = 1 - (yy + 0.5) / s * 2
    zs = np.linspace(-1, 1, steps, dtype=np.float32)
    dz = zs[1] - zs[0]
    rng = np.random.default_rng(seed)
    frames = []
    for f in range(fam):
        # a cluster of lumpy spheres (a billow), flatter + wider for dust
        nb = 7 if not dust else 9
        blobs = [(0.0, 0.0, 0.0, 0.34 if not dust else 0.28)]
        for i in range(nb - 1):
            a = rng.uniform(0, 2 * math.pi); e = rng.uniform(-0.6, 0.8)
            rr = rng.uniform(0.18, 0.34)
            blobs.append((math.cos(a) * rr * (1.35 if dust else 1.0), math.sin(e) * rr * (0.55 if dust else 0.9), math.sin(a) * rr, rng.uniform(0.13, 0.24) * (0.9 if dust else 1.0)))
        off = rng.uniform(0, 64, 3)
        for L in range(life):
            t = L / (life - 1)
            grow = 1.0 + 0.32 * t
            T = np.ones((s, s), np.float32)
            Nx = np.zeros((s, s), np.float32); Ny = np.zeros((s, s), np.float32); Nz = np.zeros((s, s), np.float32)
            tau = np.zeros((s, s), np.float32)
            for z in zs:
                X, Y, Z = px / grow, py / grow, np.full_like(px, z) / grow
                field = np.full_like(px, -1.0)
                for (bx, by, bz, br) in blobs:
                    d = np.sqrt((X - bx) ** 2 + (Y - by) ** 2 + (Z - bz) ** 2)
                    field = np.maximum(field, 1 - d / br)
                nx, ny, nz = X * 7 + off[0], Y * 7 + off[1] + t * 2.5, Z * 7 + off[2]
                n1 = samp3(vol, nx, ny, nz)
                n2 = samp3(vol2, nx * 2.6, ny * 2.6, nz * 2.6)
                f3 = field + 0.30 * n1 + 0.12 * n2 - 0.35 * t * (0.6 + 0.4 * sstep(n2, -1, 1))
                dens = sstep(f3, 0.0, 0.35) * (1.0 - (0.35 if dust else 0.15) * t)
                if not dens.any():
                    continue
                # gradient of the (smooth) field for the normal (pointing out of the puff)
                sig = dens * dz * (5.5 if not dust else 3.6)
                w = T * (1 - np.exp(-sig))
                # analytic-ish normal: radial direction from the nearest blob mixed with noise gradient
                gx = np.zeros_like(px); gy = np.zeros_like(px); gz = np.zeros_like(px)
                best = np.full_like(px, -9.0)
                for (bx, by, bz, br) in blobs:
                    d = np.sqrt((X - bx) ** 2 + (Y - by) ** 2 + (Z - bz) ** 2) + 1e-4
                    v = 1 - d / br
                    m = v > best
                    best = np.where(m, v, best)
                    gx = np.where(m, (X - bx) / d, gx); gy = np.where(m, (Y - by) / d, gy); gz = np.where(m, (Z - bz) / d, gz)
                e = 0.6
                gnx = samp3(vol, nx + e, ny, nz) - samp3(vol, nx - e, ny, nz)
                gny = samp3(vol, nx, ny + e, nz) - samp3(vol, nx, ny - e, nz)
                gnz = samp3(vol, nx, ny, nz + e) - samp3(vol, nx, ny, nz - e)
                Nx += w * (gx - 0.55 * gnx); Ny += w * (gy - 0.55 * gny); Nz += w * (-gz - 0.55 * -gnz)
                tau += sig
                T *= np.exp(-sig)
            alpha = 1 - T
            nl = np.sqrt(Nx * Nx + Ny * Ny + Nz * Nz) + 1e-6
            nxv, nyv, nzv = Nx / nl, Ny / nl, np.abs(Nz / nl)
            # soften toward the view vector where coverage is thin (edges read as wisps, not hard spheres)
            k = sstep(alpha, 0.0, 0.6)
            nxv *= k; nyv *= k
            thin = np.exp(-tau * 0.55)
            rgb = np.dstack([nxv * 0.5 + 0.5, nyv * 0.5 + 0.5, thin])
            a = alpha * sstep(alpha, 0.004, 0.05)
            frames.append(to_img(rgb, a, srgb=False))
            print("  puff", f, L, flush=True)
    return tile(frames, life)


def preview(name, bg=(40, 44, 52)):
    im = Image.open(os.path.join(OUT, name)).convert("RGBA")
    b = Image.new("RGBA", im.size, bg + (255,))
    b.alpha_composite(im)
    os.makedirs(PREV, exist_ok=True)
    b.convert("RGB").save(os.path.join(PREV, "prev_" + name.replace(".png", ".jpg")), quality=88)


if __name__ == "__main__":
    what = sys.argv[1:] or ["flame", "fireball", "smoke", "dust"]
    if "flame" in what:
        save(flame_sheet(), "flame_sheet.png"); preview("flame_sheet.png", (8, 8, 10))
    if "fireball" in what:
        save(fireball_sheet(), "fireball_sheet.png"); preview("fireball_sheet.png", (120, 150, 190))
    if "smoke" in what:
        save(lit_puffs(), "smoke_lit.png"); preview("smoke_lit.png")
    if "dust" in what:
        save(lit_puffs(dust=True, seed=41), "dust_lit.png"); preview("dust_lit.png")
