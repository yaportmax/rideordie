"""Procedural textures for the road-furniture props (signs, billboard, barrels, chain-link).  Writes into the props texture cache
(envlib.PTEX / ROD_PROP_TEX).  Everything is weathered on purpose: sun-fade, grime streaks, rust, scratches, bullet holes, peeling.

    python tools/env/sign_textures.py [name ...]      (no args = all)
"""
import os, sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import noise, aniso_noise, smoothstep, blur, height_to_n, enc_n, s2l, l2s, lum, save_jpg   # noqa: E402

PT = os.environ.get("ROD_PROP_TEX", "C:/Dev/art_cache/rideordie/props_tex")
os.makedirs(PT, exist_ok=True)
FD = "C:/Windows/Fonts/"


def font(name, size):
    return ImageFont.truetype(FD + name, size)


def rng_for(seed):
    return np.random.default_rng(seed)


def fbm_rect(h, w, beta, seed):
    n = 1 << int(math.ceil(math.log2(max(h, w))))
    a = noise(n, beta, seed)
    return a[:h, :w]


def to_arr(im):
    return np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0


def from_arr(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))


def sun_fade(a, amt=0.35, warm=0.0):
    """desaturate + bleach (sun-faded paint); reds/blues fade most."""
    L = lum(a)[..., None]
    a = a * (1 - amt) + (L * 0.6 + 0.35) * amt
    a[..., 2] -= warm * 0.05
    return np.clip(a, 0, 1)


def grime(a, seed, amt=0.5, streaks=0.6, bottom=0.5):
    h, w = a.shape[:2]
    low = fbm_rect(h, w, 3.0, seed)
    mid = fbm_rect(h, w, 1.6, seed + 1)
    g = 1 - amt * 0.22 * smoothstep(low, -0.3, 1.2) - amt * 0.10 * smoothstep(mid, 0.0, 1.5)
    # rain streaks running down from the top edge
    n = 1 << int(math.ceil(math.log2(max(h, w))))
    st = aniso_noise(n, n * 0.25, 6, seed + 2)[:h, :w]
    yy = np.linspace(0, 1, h)[:, None]
    g *= 1 - streaks * 0.25 * smoothstep(st, 0.4, 2.0) * (0.35 + 0.65 * (1 - yy))
    # dirt gathering at the bottom edge
    g *= 1 - bottom * 0.35 * smoothstep(yy, 0.8, 1.0)
    dirt = np.array([0.55, 0.42, 0.30])
    a = a * g[..., None]
    a = a * (1 - 0.06 * amt) + dirt * (1 - g)[..., None] * 0.12
    return np.clip(a, 0, 1)


def rust_patches(a, seed, amt=0.4, edge=0.5):
    h, w = a.shape[:2]
    n1 = fbm_rect(h, w, 2.2, seed)
    n2 = fbm_rect(h, w, 1.0, seed + 5)
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy)) / (0.5 * min(h, w))
    m = smoothstep(n1 + n2 * 0.4 + edge * (1 - np.clip(d * 5, 0, 1)) * 1.6 - (1 - amt) * 2.0, 0.2, 0.9)
    col = np.array([0.42, 0.2, 0.09]) * (0.8 + 0.4 * (n2 * 0.25 + 0.5))[..., None]
    return np.clip(a * (1 - m[..., None]) + col * m[..., None], 0, 1), m


def scratches(a, seed, count=40, light=0.28):
    im = from_arr(a)
    d = ImageDraw.Draw(im, "RGBA")
    r = rng_for(seed)
    h, w = a.shape[:2]
    for _ in range(count):
        x, y = r.uniform(0, w), r.uniform(0, h)
        ang = r.uniform(-0.6, 0.6) + (math.pi / 2 if r.random() < 0.3 else 0)
        L = r.uniform(20, 140)
        col = (235, 235, 230, int(255 * light * r.uniform(0.4, 1))) if r.random() < 0.7 else (40, 30, 25, int(255 * light))
        d.line([(x, y), (x + math.cos(ang) * L, y + math.sin(ang) * L)], fill=col, width=1)
    return to_arr(im)


def bullet_holes(a, seed, count=6, rmin=4, rmax=8, region=None):
    """dark holes with a bright peeled-metal rim + tiny radial cracks"""
    im = from_arr(a)
    d = ImageDraw.Draw(im, "RGBA")
    r = rng_for(seed)
    h, w = a.shape[:2]
    x0, y0, x1, y1 = region or (0.1 * w, 0.1 * h, 0.9 * w, 0.9 * h)
    for _ in range(count):
        x, y = r.uniform(x0, x1), r.uniform(y0, y1)
        rad = r.uniform(rmin, rmax)
        d.ellipse([x - rad * 1.9, y - rad * 1.9, x + rad * 1.9, y + rad * 1.9], fill=(200, 200, 195, 90))
        d.ellipse([x - rad * 1.35, y - rad * 1.35, x + rad * 1.35, y + rad * 1.35], fill=(215, 215, 210, 150))
        d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=(10, 8, 8, 255))
        for _k in range(4):
            ang = r.uniform(0, 6.28)
            d.line([(x, y), (x + math.cos(ang) * rad * 3, y + math.sin(ang) * rad * 3)], fill=(30, 25, 25, 130), width=1)
    return to_arr(im)


def peel(a, seed, amt=0.25, under=(0.55, 0.55, 0.53)):
    """paint peeling to reveal galvanised sheet underneath"""
    h, w = a.shape[:2]
    n = fbm_rect(h, w, 2.2, seed) + 0.6 * fbm_rect(h, w, 1.0, seed + 1)
    m = smoothstep(n, 1.35 - amt * 2.2, 1.6 - amt * 2.2)
    edge = smoothstep(n, 1.2 - amt * 2.2, 1.35 - amt * 2.2) * (1 - m)
    a = a * (1 - m[..., None]) + np.array(under) * (0.85 + 0.3 * fbm_rect(h, w, 1.5, seed + 2)[..., None] * 0.2) * m[..., None]
    a = a * (1 - 0.25 * edge[..., None])
    return np.clip(a, 0, 1), m


def rr(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def ctext(d, xy, text, f, fill, stroke=0, stroke_fill=None):
    d.text(xy, text, font=f, fill=fill, anchor="mm", stroke_width=stroke, stroke_fill=stroke_fill)


def save_plate(a, name):
    p = os.path.join(PT, name + ".jpg")
    save_jpg(np.clip(a, 0, 1), p, 90, 0)
    print("wrote", p, a.shape[:2])


# ------------------------------------------------------------------------------------------------------------ signs
def sign_speed():
    W, H = 512, 640
    im = Image.new("RGB", (W, H), (236, 236, 228))
    d = ImageDraw.Draw(im)
    rr(d, (16, 16, W - 17, H - 17), 44, outline=(12, 12, 12), width=11)
    ctext(d, (W // 2, 140), "SPEED", font("arialbd.ttf", 118), (12, 12, 12))
    ctext(d, (W // 2, 250), "LIMIT", font("arialbd.ttf", 118), (12, 12, 12))
    ctext(d, (W // 2, 452), "65", font("arialbd.ttf", 300), (12, 12, 12))
    a = to_arr(im)
    a = sun_fade(a, 0.22)
    a = grime(a, 11, 0.9, 0.7, 0.6)
    a, _ = peel(a, 12, 0.06)
    a, _ = rust_patches(a, 13, 0.25, 1.0)
    a = scratches(a, 14, 60)
    a = bullet_holes(a, 15, 7, 4, 7)
    save_plate(a, "sign_speed")


def sign_warning():
    W, H = 512, 640
    im = Image.new("RGB", (W, H), (246, 196, 24))
    d = ImageDraw.Draw(im)
    rr(d, (16, 16, W - 17, H - 17), 44, outline=(14, 14, 14), width=11)
    # chevron pointing to the right (viewer's right)
    pts = [(120, 150), (250, 150), (410, 320), (250, 490), (120, 490), (280, 320)]
    d.polygon(pts, fill=(14, 14, 14))
    a = to_arr(im)
    a = sun_fade(a, 0.30, warm=1.0)
    a = grime(a, 21, 0.9, 0.8, 0.6)
    a, _ = peel(a, 22, 0.08)
    a, _ = rust_patches(a, 23, 0.3, 1.0)
    a = scratches(a, 24, 70)
    a = bullet_holes(a, 25, 5, 4, 7)
    save_plate(a, "sign_warning")


def sign_exit():
    W, H = 1024, 512
    im = Image.new("RGB", (W, H), (0, 96, 62))
    d = ImageDraw.Draw(im)
    rr(d, (14, 14, W - 15, H - 15), 30, outline=(235, 235, 225), width=13)
    ctext(d, (300, 110), "EXIT 42", font("arialbd.ttf", 124), (240, 240, 232))
    ctext(d, (405, 250), "DEADHORSE", font("arialbd.ttf", 116), (240, 240, 232))
    ctext(d, (405, 380), "LAST GAS 140 MI", font("arialbd.ttf", 70), (240, 240, 232))
    # arrow (up-right)
    d.polygon([(860, 150), (960, 250), (905, 250), (905, 400), (815, 400), (815, 250), (760, 250)], fill=(240, 240, 232))
    a = to_arr(im)
    a = sun_fade(a, 0.28)
    a = grime(a, 31, 1.0, 0.9, 0.5)
    a, _ = peel(a, 32, 0.06, under=(0.5, 0.5, 0.48))
    a, _ = rust_patches(a, 33, 0.22, 1.0)
    a = scratches(a, 34, 90)
    a = bullet_holes(a, 35, 12, 4, 9)
    save_plate(a, "sign_exit")


def sign_gas_cabinet():
    W, H = 1024, 512
    im = Image.new("RGB", (W, H), (236, 190, 30))
    d = ImageDraw.Draw(im)
    rr(d, (10, 10, W - 11, H - 11), 26, outline=(150, 20, 20), width=22)
    ctext(d, (W // 2, 230), "GAS", font("impact.ttf", 430), (190, 25, 25), stroke=6, stroke_fill=(30, 10, 10))
    ctext(d, (W // 2, 452), "FOOD  -  ICE  -  24 HRS", font("arialbd.ttf", 64), (40, 25, 20))
    a = to_arr(im)
    a = sun_fade(a, 0.34, warm=1.0)
    a = grime(a, 41, 1.0, 0.9, 0.7)
    a, _ = peel(a, 42, 0.16, under=(0.52, 0.5, 0.46))
    a, _ = rust_patches(a, 43, 0.4, 1.0)
    a = scratches(a, 44, 80)
    a = bullet_holes(a, 45, 9, 4, 9)
    save_plate(a, "sign_gas_cabinet")


def sign_gas_prices():
    W, H = 512, 512
    im = Image.new("RGB", (W, H), (18, 18, 20))
    d = ImageDraw.Draw(im)
    rr(d, (8, 8, W - 9, H - 9), 20, outline=(200, 180, 60), width=8)
    f = font("consolab.ttf", 72)
    rows = [("REG", "12.99"), ("MID", "13.49"), ("DSL", "13.99")]
    for i, (k, v) in enumerate(rows):
        y = 110 + i * 150
        d.text((40, y), k, font=f, fill=(236, 226, 190), anchor="lm")
        d.text((W - 40, y), v, font=f, fill=(236, 90, 40), anchor="rm")
    a = to_arr(im)
    a = sun_fade(a, 0.15)
    a = grime(a, 51, 1.0, 0.9, 0.6)
    a, _ = rust_patches(a, 53, 0.3, 1.0)
    a = scratches(a, 54, 50)
    a = bullet_holes(a, 55, 5, 4, 8)
    save_plate(a, "sign_gas_prices")


def mile_marker():
    W, H = 256, 384
    im = Image.new("RGB", (W, H), (0, 96, 62))
    d = ImageDraw.Draw(im)
    rr(d, (8, 8, W - 9, H - 9), 20, outline=(236, 236, 226), width=7)
    ctext(d, (W // 2, 92), "MILE", font("arialbd.ttf", 66), (240, 240, 232))
    ctext(d, (W // 2, 230), "87", font("arialbd.ttf", 190), (240, 240, 232))
    a = to_arr(im)
    a = sun_fade(a, 0.3)
    a = grime(a, 61, 1.0, 0.9, 0.7)
    a, _ = peel(a, 62, 0.1, under=(0.5, 0.5, 0.48))
    a, _ = rust_patches(a, 63, 0.3, 1.0)
    a = scratches(a, 64, 30)
    a = bullet_holes(a, 65, 2, 3, 5)
    save_plate(a, "mile_marker")


def billboard_ad():
    W, H = 2048, 683                              # drawn at 3:1, stretched to 2048x1024 (mapped on a 12x4 m panel)
    im = Image.new("RGB", (W, H), (30, 120, 130))
    d = ImageDraw.Draw(im)
    # sky gradient
    for y in range(H):
        t = y / H
        c = (int(30 + 210 * t), int(120 + 40 * t), int(140 - 60 * t))
        d.line([(0, y), (W, y)], fill=c)
    # sunburst rays from the right
    cx, cy = 1500, 300
    for i in range(0, 36, 2):
        a0, a1 = i * 10 * math.pi / 180, (i + 1) * 10 * math.pi / 180
        d.polygon([(cx, cy), (cx + 2400 * math.cos(a0), cy + 2400 * math.sin(a0)), (cx + 2400 * math.cos(a1), cy + 2400 * math.sin(a1))], fill=(250, 200, 90))
    d.ellipse([cx - 170, cy - 170, cx + 170, cy + 170], fill=(255, 235, 150))
    # bottle
    bx = 1580
    d.rounded_rectangle([bx - 70, 120, bx + 70, 640], radius=50, fill=(120, 60, 30), outline=(40, 20, 10), width=8)
    d.rounded_rectangle([bx - 26, 40, bx + 26, 190], radius=18, fill=(120, 60, 30), outline=(40, 20, 10), width=8)
    d.rectangle([bx - 32, 30, bx + 32, 56], fill=(200, 180, 60))
    d.rectangle([bx - 70, 300, bx + 70, 470], fill=(240, 235, 210))
    ctext(d, (bx, 385), "S", font("impact.ttf", 150), (190, 30, 30))
    # slogan
    ctext(d, (700, 200), "SUNBURST", font("impact.ttf", 330), (255, 210, 40), stroke=14, stroke_fill=(150, 30, 20))
    ctext(d, (700, 470), "ICE COLD  -  ONLY 25c", font("arialbd.ttf", 120), (250, 245, 230), stroke=5, stroke_fill=(20, 60, 70))
    ctext(d, (700, 600), "TASTES LIKE THE OLD WORLD", font("arialbd.ttf", 62), (250, 245, 230))
    im = im.resize((2048, 1024), Image.LANCZOS)
    a = to_arr(im)
    a = sun_fade(a, 0.55, warm=1.0)
    h, w = a.shape[:2]
    # horizontal panel seams (billboards are hung as strips) with slight tone offsets
    for i in range(1, 6):
        x = int(i * w / 6)
        a[:, x - 2:x + 2] *= 0.55
        a[:, x:] *= 1 + 0.02 * ((i * 37) % 5 - 2)
    a = grime(a, 71, 1.2, 1.4, 0.9)
    a, _ = peel(a, 72, 0.32, under=(0.6, 0.56, 0.48))
    a, _ = rust_patches(a, 73, 0.4, 1.4)
    a = scratches(a, 74, 160)
    a = bullet_holes(a, 75, 24, 5, 12)
    save_plate(a, "billboard_ad")


# ------------------------------------------------------------------------------------------------------------ barrels
BODY_V0 = 0.455        # cylindrical body occupies v in [BODY_V0, 1]; lid/bottom discs live in the lower part (see roadlib.barrel_uv)


def _barrel_common(name, paint, seed, label_fn=None, rust_amt=0.5):
    """all colours are sRGB-space values (0..1) -- the jpgs are written as-is"""
    N = 1024
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N
    body = np.zeros((N, N, 3), np.float32) + np.array(paint, np.float32)
    n_lo = noise(N, 3.0, seed)
    n_mid = noise(N, 1.8, seed + 1)
    n_hi = noise(N, 0.9, seed + 2)
    body *= (1 + 0.06 * n_lo)[..., None]                          # paint mottling
    rows = yy / (1 - BODY_V0)                                     # 0 = top of the barrel .. 1 = bottom (inside the body region of the image)
    if label_fn:
        body = label_fn(body, rows, xx)
    rib_rows = [0.02, 0.33, 0.67, 0.98]
    rib = sum(np.exp(-((rows - r) / 0.03) ** 2) for r in rib_rows)
    rust_m = smoothstep(n_lo * 0.9 + n_mid * 0.5 + n_hi * 0.25 + rib * 0.9 + (rows > 0.85) * 0.5 - (1 - rust_amt) * 1.7, 0.15, 0.8)
    chip = smoothstep(n_hi + n_mid * 0.6 + rib * 0.6 - 1.4, 0.0, 0.25)
    rmix = smoothstep(n_mid + n_hi * 0.5, 0.0, 1.2)[..., None]
    rust_col = np.array([0.50, 0.24, 0.10]) * (0.8 + 0.4 * (n_hi * 0.2 + 0.5))[..., None]
    rust_col2 = np.array([0.66, 0.34, 0.13])
    rc = rust_col * (1 - rmix) + rust_col2 * rmix
    alb = body * (1 - rust_m[..., None]) + rc * rust_m[..., None]
    alb = alb * (1 - chip[..., None]) + np.array([0.52, 0.51, 0.50]) * chip[..., None]
    st = aniso_noise(N, N * 0.3, 5, seed + 3)                    # drip streaks + grime
    alb *= (1 - 0.14 * smoothstep(st, 0.5, 2.2))[..., None]
    alb *= (1 - 0.22 * smoothstep(n_lo, 0.0, 1.5))[..., None]
    # lid + bottom disc region (lower part of the image, centre u=0.2, image-y=0.735): dark rusty metal with a rolled ring
    lid = np.zeros_like(alb) + np.array([0.24, 0.20, 0.17])
    lid = lid * (1 - 0.4 * smoothstep(n_mid, -0.3, 1.0)[..., None]) + np.array([0.55, 0.28, 0.12]) * smoothstep(n_lo + n_hi * 0.5, 0.0, 1.0)[..., None] * 0.55
    rad = np.sqrt((xx - 0.2) ** 2 + (yy - 0.735) ** 2)
    ring = np.exp(-((rad - 0.14) / 0.008) ** 2)
    lid = lid * (1 - 0.35 * ring[..., None]) + np.array(paint) * 0.35 * (rad < 0.15)[..., None] * (1 - smoothstep(n_hi, 0.2, 1.0))[..., None]
    lid_zone = (yy > (1 - BODY_V0) - 0.001).astype(np.float32)
    alb = alb * (1 - lid_zone[..., None]) + lid * lid_zone[..., None]
    paint_mask = (1 - rust_m) * (1 - chip)
    rough = 0.45 * paint_mask + 0.88 * rust_m + 0.5 * chip
    rough = np.where(lid_zone > 0, 0.8, rough)
    metal = 0.0 * paint_mask + 0.15 * rust_m + 1.0 * chip
    metal = np.where(lid_zone > 0, 0.3, metal)
    ao = 1 - 0.35 * rib * 0.4
    arm = np.stack([ao, rough, metal], -1)
    rust_all = np.where(lid_zone > 0, 0.6, rust_m)
    hgt = n_hi * 0.10 * rust_all + noise(N, 2.4, seed + 9) * 0.5
    nrm = height_to_n(hgt.astype(np.float32), 0.8)
    for suf, arr, q, sub in (("albedo", alb, 90, 2), ("arm", arm, 85, 2), ("normal", enc_n(nrm), 90, 0)):
        save_jpg(np.clip(arr, 0, 1), os.path.join(PT, f"{name}_{suf}.jpg"), q, sub)
    print("wrote barrel set", name)


def barrel():
    _barrel_common("barrel_paint", (0.22, 0.34, 0.44), 101, rust_amt=0.55)        # faded blue drum


def barrel_explosive():
    def label(body, rows, xx):
        N = body.shape[0]
        band = ((rows > 0.62) & (rows < 0.75)).astype(np.float32)
        stripes = (((xx * 22 + rows * 5) % 1.0) < 0.5).astype(np.float32)
        yel = np.array([0.80, 0.62, 0.10]); blk = np.array([0.06, 0.06, 0.06])
        bandc = yel * stripes[..., None] + blk * (1 - stripes[..., None])
        body = body * (1 - band[..., None]) + bandc * band[..., None]
        im = Image.fromarray((np.clip(body, 0, 1) * 255).astype(np.uint8))
        d = ImageDraw.Draw(im)
        cx, cy, r = int(0.5 * N), int(0.153 * N), 96
        d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=(190, 32, 22), outline=(235, 232, 220))
        d.polygon([(cx, cy - r + 12), (cx + r - 12, cy), (cx, cy + r - 12), (cx - r + 12, cy)], outline=(235, 232, 220))
        d.polygon([(cx, cy - 50), (cx + 20, cy - 12), (cx + 37, cy + 20), (cx + 18, cy + 46), (cx - 18, cy + 46), (cx - 37, cy + 20), (cx - 14, cy - 6), (cx - 8, cy - 28)], fill=(240, 238, 230))
        d.polygon([(cx, cy - 4), (cx + 13, cy + 21), (cx + 6, cy + 38), (cx - 6, cy + 38), (cx - 13, cy + 21)], fill=(190, 32, 22))
        ctext(d, (cx, int(0.262 * N)), "DANGER", font("impact.ttf", 84), (240, 236, 222))
        ctext(d, (cx, int(0.322 * N)), "FLAMMABLE", font("arialbd.ttf", 54), (240, 236, 222))
        return np.asarray(im, np.float32) / 255.0
    _barrel_common("barrel_explosive", (0.58, 0.13, 0.09), 111, label_fn=label, rust_amt=0.4)


def painted_cyl(name, base, bands, rubber_v=0.0, rust_amt=0.3, seed=1, dirt=0.6, chip=0.5, N=512, rust_col=(0.52, 0.27, 0.11)):
    """cylindrically wrapped painted-metal/plastic texture (u = around, v = height, v=1 top).  bands = [(v0, v1, (r,g,b), glossy)].
       v < rubber_v is a dark rubber strip (cone base).  All colours sRGB 0..1."""
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N
    v = 1.0 - yy
    n_lo, n_mid, n_hi = noise(N, 3.0, seed), noise(N, 1.7, seed + 1), noise(N, 0.9, seed + 2)
    col = np.zeros((N, N, 3), np.float32) + np.array(base, np.float32)
    gloss = np.zeros((N, N), np.float32)
    for (v0, v1, c, gl) in bands:
        m = smoothstep(v, v0 - 0.004, v0 + 0.004) * (1 - smoothstep(v, v1 - 0.004, v1 + 0.004))
        col = col * (1 - m[..., None]) + np.array(c, np.float32) * m[..., None]
        gloss = np.maximum(gloss, m * gl)
    rub = np.zeros((N, N), np.float32)
    if rubber_v > 0:
        rub = 1 - smoothstep(v, rubber_v - 0.004, rubber_v + 0.004)
        col = col * (1 - rub[..., None]) + np.array([0.07, 0.07, 0.075], np.float32) * (1 + 0.3 * n_hi)[..., None] * rub[..., None]
    col *= (1 + 0.05 * n_lo)[..., None]
    # sun fade
    Lm = lum(col)[..., None]
    col = col * 0.85 + (Lm * 0.6 + 0.2) * 0.15 * (1 - rub[..., None])
    # paint chips -> bare metal / rust
    chipm = smoothstep(n_hi + n_mid * 0.7 - (1.7 - chip), 0.0, 0.3) * (1 - rub)
    rust = smoothstep(n_mid * 0.8 + n_lo * 0.6 + n_hi * 0.3 - (1.25 - rust_amt * 1.2) + 1.2 * np.exp(-v * 5.0), 0.1, 0.9) * (1 - rub)
    rustc = np.array(rust_col, np.float32) * (0.8 + 0.4 * (n_hi * 0.2 + 0.5))[..., None]
    col = col * (1 - rust[..., None]) + rustc * rust[..., None]
    col = col * (1 - chipm[..., None]) + np.array([0.5, 0.49, 0.47], np.float32) * chipm[..., None]
    # dirt: grime from the ground up, vertical streaks, scuffs
    st = aniso_noise(N, N * 0.3, 5, seed + 3)
    g = 1 - dirt * (0.55 * np.exp(-v * 3.5) + 0.25 * smoothstep(n_lo, 0.0, 1.5) + 0.2 * smoothstep(st, 0.5, 2.2))
    col = col * g[..., None] + np.array([0.30, 0.22, 0.15], np.float32) * (1 - g)[..., None] * 0.35
    scuff = smoothstep(aniso_noise(N, N * 0.35, 2.2, seed + 4), 1.0, 2.6)          # horizontal scuffs
    col = col * (1 - 0.18 * scuff[..., None]) 
    paint_mask = (1 - rust) * (1 - chipm)
    rough = (0.55 * (1 - gloss) + 0.28 * gloss) * paint_mask + 0.9 * rust + 0.5 * chipm
    rough = np.where(rub > 0.5, 0.9, rough)
    metal = 0.0 * paint_mask + 0.1 * rust + 1.0 * chipm
    ao = 1 - 0.3 * smoothstep(n_lo, 0.5, 2.0) * 0
    arm = np.stack([np.ones_like(rough) * ao, rough, metal], -1)
    nrm = height_to_n((noise(N, 2.0, seed + 9) * 0.5 + n_hi * 0.10 * (rust + chipm)).astype(np.float32), 0.7)
    for suf, arr, q, sub in (("albedo", col, 90, 2), ("arm", arm, 85, 2), ("normal", enc_n(nrm), 90, 0)):
        save_jpg(np.clip(arr, 0, 1), os.path.join(PT, f"{name}_{suf}.jpg"), q, sub)
    print("wrote painted set", name)


def road_cone_tex():
    painted_cyl("road_cone", (0.86, 0.34, 0.06), [(0.435, 0.531, (0.86, 0.86, 0.82), 1.0), (0.60, 0.73, (0.86, 0.86, 0.82), 1.0)], rubber_v=0.15, rust_amt=0.35, seed=201, dirt=0.85, chip=0.08, rust_col=(0.30, 0.20, 0.13))


def bollard_tex():
    painted_cyl("bollard", (0.88, 0.62, 0.05), [(0.70, 0.78, (0.86, 0.86, 0.82), 1.0), (0.80, 0.84, (0.86, 0.86, 0.82), 1.0)], rubber_v=0.0, rust_amt=0.4, seed=211, dirt=0.9, chip=0.6)



def tire_tex():
    """1024x512: tread strip in the top 128 rows (u = around, 22 diagonal tread blocks + centre groove), sidewall disc (centre u=.25 v=.34, radius 0.159 u)
       in the lower part: concentric ribs + raised size marks; weathered, dusty, dry-rot cracks."""
    W, H = 1024, 512
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u, v = xx / W, 1.0 - yy / H
    n_lo = noise(1024, 3.0, 301)[:H, :W]
    n_mid = noise(1024, 1.8, 302)[:H, :W]
    n_hi = noise(1024, 0.9, 303)[:H, :W]
    height = np.zeros((H, W), np.float32)
    col = np.zeros((H, W, 3), np.float32) + np.array([0.085, 0.085, 0.09], np.float32)
    # tread
    tv = (v - 0.75) / 0.25                                     # 0..1 across the tread
    tread = (v >= 0.75).astype(np.float32)
    ph = (u * 22 + (tv - 0.5) * 0.9) % 1.0
    block = (ph > 0.20).astype(np.float32)
    groove_c = (np.abs(tv - 0.5) < 0.05).astype(np.float32)
    edge = ((tv < 0.06) | (tv > 0.94)).astype(np.float32)
    height += tread * (block * (1 - groove_c)) * 1.0
    col = col * (1 - 0.25 * tread[..., None] * (1 - block)[..., None])
    # sidewall disc
    rad = np.sqrt(((u - 0.25) / 0.159) ** 2 + ((v - 0.34) / 0.318) ** 2)      # 0..1 across the disc
    side = ((rad <= 1.0) & (v < 0.72)).astype(np.float32)
    ribs = 0.5 + 0.5 * np.sin(rad * 60)
    height += side * (0.12 * ribs + 0.3 * np.exp(-((rad - 0.72) / 0.05) ** 2))
    # raised lettering / size marks along a ring
    im = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(im)
    cx, cy = 0.25 * W, (1 - 0.34) * H
    rr_ = 0.74 * 0.318 * H
    txt = "ROADKING 195/70 R14   TUBELESS  "
    f = font("arialbd.ttf", 26)
    for i, ch in enumerate(txt):
        a = i * 0.105 - 0.9
        tile = Image.new("L", (40, 40), 0)
        ImageDraw.Draw(tile).text((20, 20), ch, font=f, fill=255, anchor="mm")
        tile = tile.rotate(-math.degrees(a) - 90 + 180, resample=Image.BICUBIC)
        x = cx + rr_ * math.cos(a - math.pi / 2)
        y = cy + rr_ * math.sin(a - math.pi / 2)
        im.paste(tile, (int(x - 20), int(y - 20)), tile)
    letters = np.asarray(im, np.float32) / 255.0 * side
    height += letters * 0.7
    col = col * (1 + 0.5 * letters[..., None])
    # weathering: dust, dry-rot cracks, sun bleaching
    col *= (1 + 0.25 * n_lo)[..., None]
    dust = smoothstep(n_mid + n_lo * 0.5, 0.3, 1.6)
    col = col * (1 - 0.6 * dust[..., None]) + np.array([0.27, 0.23, 0.19], np.float32) * dust[..., None] * 0.6
    cracks = smoothstep(np.abs(noise(1024, 0.8, 304)[:H, :W]), 0.0, 0.05)
    col *= (0.75 + 0.25 * cracks)[..., None]
    height -= (1 - cracks) * 0.4 * side
    col *= (0.9 + 0.2 * (n_hi * 0.2 + 0.5))[..., None]
    rough = 0.82 + 0.12 * dust + 0.05 * n_hi
    arm = np.stack([np.ones_like(rough), np.clip(rough, 0, 1), np.zeros_like(rough)], -1)
    hh = np.zeros((1024, 1024), np.float32)
    hh[:H, :W] = height * 2.0 + n_hi * 0.05
    nrm = height_to_n(hh, 0.9)[:H, :W]
    for suf, arr, q, sub in (("albedo", col, 90, 2), ("arm", arm, 85, 2), ("normal", enc_n(nrm), 90, 0)):
        save_jpg(np.clip(arr, 0, 1), os.path.join(PT, f"tire_{suf}.jpg"), q, sub)
    print("wrote tire set")



def chainlink():
    """RGBA tile (256x256 = 0.4 x 0.4 m): galvanised diamond wire mesh, alpha = wire coverage"""
    S = 4
    N = 256 * S
    P = 32 * S                            # diamond pitch (px): 5 cm at 0.4 m per tile
    wth = 3.3 * S
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    def dist_mod(v):
        m = np.mod(v + P / 2, P) - P / 2
        return np.abs(m)
    # zig-zag wires: two diagonal families
    d1 = dist_mod(xx + yy) / math.sqrt(2)
    d2 = dist_mod(xx - yy) / math.sqrt(2)
    cov = np.maximum(np.clip(1 - (d1 - wth * 0.5) / (S * 0.8), 0, 1), np.clip(1 - (d2 - wth * 0.5) / (S * 0.8), 0, 1))
    # knuckles where wires cross
    k = np.exp(-((d1 / (wth * 1.2)) ** 2 + (d2 / (wth * 1.2)) ** 2))
    cov = np.clip(cov + 0.4 * k, 0, 1)
    a = np.asarray(Image.fromarray((cov * 255).astype(np.uint8)).resize((256, 256), Image.LANCZOS), np.float32) / 255.0
    n = noise(256, 1.8, 121)
    col = np.array([0.50, 0.50, 0.48]) * (1 + 0.15 * n)[..., None]
    rust = smoothstep(noise(256, 2.0, 122), 0.4, 1.4)[..., None]
    col = col * (1 - rust) + np.array([0.36, 0.2, 0.1]) * rust
    rgba = np.concatenate([np.clip(col, 0, 1), a[..., None]], -1)
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(PT, "chainlink.png"), optimize=True)
    print("wrote chainlink.png")


ALL = dict(tire=tire_tex, road_cone=road_cone_tex, bollard=bollard_tex, sign_speed=sign_speed, sign_warning=sign_warning, sign_exit=sign_exit, sign_gas_cabinet=sign_gas_cabinet, sign_gas_prices=sign_gas_prices,
           mile_marker=mile_marker, billboard_ad=billboard_ad, barrel=barrel, barrel_explosive=barrel_explosive, chainlink=chainlink)

if __name__ == "__main__":
    names = sys.argv[1:] or list(ALL)
    for n in names:
        ALL[n]()
