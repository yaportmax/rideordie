"""gen_tex - build-input textures for the player trucks (run with a Python that has numpy + scipy + Pillow):

    C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/blender/vehicles/player/gen_tex.py

Writes tools/blender/vehicles/player/tex/:
  decal_atlas.png (+ decal_atlas.json rects)   stickers, labels, gauge faces, colour swatches (material 'decal')
  n_grain.png   vinyl / leather grain normal (tileable)      n_weave.png  woven cloth normal
  n_metal.png   orange-peel paint + scratches + dings        n_cast.png   pitted / cast / rust normal
  n_carbon.png  2x2 twill carbon normal                       a_carbon.png carbon albedo modulation (grayscale)
  n_ribbed.png  moulded plastic stipple                       a_crack.png  cracked-vinyl albedo modulation (T1 dash pad)
All deterministic (fixed seeds).
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'tex')
os.makedirs(OUT, exist_ok=True)
FONTS = 'C:/Windows/Fonts/'


# ------------------------------------------------------------------------------------------------ tileable noise helpers
def fft_noise(rng, s, beta, aniso=(1.0, 1.0)):
    f = np.fft.fftfreq(s)
    fx, fy = np.meshgrid(f * aniso[0], f * aniso[1])
    r = np.sqrt(fx ** 2 + fy ** 2)
    r[0, 0] = 1.0
    spec = (rng.normal(size=(s, s)) + 1j * rng.normal(size=(s, s))) / (r ** beta)
    spec[0, 0] = 0
    n = np.fft.ifft2(spec).real
    return (n - n.mean()) / (n.std() + 1e-9)


def blur(a, sigma):
    s0, s1 = a.shape
    fy = np.fft.fftfreq(s0)[:, None]
    fx = np.fft.fftfreq(s1)[None, :]
    k = np.exp(-2 * (math.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    return np.fft.ifft2(np.fft.fft2(a) * k).real


def worley(rng, s, n, jitter=1.0):
    """Periodic cellular noise: returns F1, F2 (in pixels) for n random feature points."""
    pts = rng.uniform(0, s, (n, 2))
    tiles = np.concatenate([pts + np.array([dx, dy]) * s for dx in (-1, 0, 1) for dy in (-1, 0, 1)])
    tree = cKDTree(tiles)
    yy, xx = np.mgrid[0:s, 0:s]
    q = np.stack([xx.ravel() + 0.5, yy.ravel() + 0.5], axis=1)
    d, _ = tree.query(q, k=2)
    return d[:, 0].reshape(s, s), d[:, 1].reshape(s, s)


def scratches(rng, s, count, length=(0.02, 0.2), width=0.6, vert=0.0):
    a = np.zeros((s, s))
    for _ in range(count):
        x0, y0 = rng.uniform(0, s, 2)
        ang = rng.uniform(0, math.pi) if rng.random() > vert else math.pi / 2 + rng.normal() * 0.15
        L = rng.uniform(*length) * s
        n = max(int(L * 1.5), 2)
        t = np.linspace(0, 1, n)
        bend = rng.normal() * 0.08
        xs = (x0 + np.cos(ang + bend * t) * L * t) % s
        ys = (y0 + np.sin(ang + bend * t) * L * t) % s
        np.add.at(a, (ys.astype(int), xs.astype(int)), rng.uniform(0.4, 1.0))
    return np.clip(blur(a, width) * 3.0, 0, 1)


def height_to_normal(h, strength):
    """OpenGL (Y+ up) tangent-space normal map from a tileable height field (row 0 = top of the image)."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dup = (np.roll(h, 1, axis=0) - np.roll(h, -1, axis=0)) * 0.5
    nx, ny, nz = -dx * strength, -dup * strength, np.ones_like(h)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / L, ny / L, nz / L], axis=-1) * 0.5 + 0.5
    return (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)


def save_rgb(name, arr):
    Image.fromarray(arr, 'RGB').save(os.path.join(OUT, name))
    print('wrote', name, arr.shape)


def save_gray(name, a):
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'L').save(os.path.join(OUT, name))
    print('wrote', name, a.shape)


# ------------------------------------------------------------------------------------------------ detail maps
def gen_grain(s=512):
    rng = np.random.default_rng(11)
    f1, f2 = worley(rng, s, 5200)
    cell = np.clip((f2 - f1) / 3.0, 0, 1) ** 0.6          # raised pebbles, creases between them
    h = cell * 0.8 + 0.25 * fft_noise(rng, s, 1.2) * 0.2 + 0.35 * blur(fft_noise(rng, s, 2.0), 6) * 0.3
    # a few long soft creases (worn vinyl)
    h -= 0.35 * scratches(rng, s, 30, (0.05, 0.3), 1.6)
    save_rgb('n_grain.png', height_to_normal(blur(h, 0.6), 1.6))


def gen_weave(s=512):
    rng = np.random.default_rng(12)
    yy, xx = np.mgrid[0:s, 0:s].astype(float)
    p = 8.0                                                # 64 threads per tile
    u, v = xx / p, yy / p
    warp = np.sin(2 * np.pi * u) * 0.5 + 0.5
    weft = np.sin(2 * np.pi * v) * 0.5 + 0.5
    over = (np.floor(u) + np.floor(v)) % 2
    thread_u = np.abs(np.sin(np.pi * v)) ** 0.5            # weft thread cross-section (varies along v)
    thread_v = np.abs(np.sin(np.pi * u)) ** 0.5
    h = np.where(over > 0.5, thread_u * (0.7 + 0.3 * warp), thread_v * (0.7 + 0.3 * weft))
    h += 0.15 * fft_noise(rng, s, 1.0) + 0.25 * blur(fft_noise(rng, s, 2.2), 8)
    save_rgb('n_weave.png', height_to_normal(blur(h, 0.5), 1.2))


def gen_metal(s=512):
    rng = np.random.default_rng(13)
    peel = blur(fft_noise(rng, s, 1.0), 2.2) * 0.25                     # orange peel
    dings = blur(fft_noise(rng, s, 2.6), 10) * 0.9                        # soft dents / waviness
    sc = scratches(rng, s, 200, (0.01, 0.10), 0.5)
    h = peel + dings - sc * 0.35
    save_rgb('n_metal.png', height_to_normal(h, 2.0))


def gen_cast(s=512):
    rng = np.random.default_rng(14)
    f1, f2 = worley(rng, s, 900)
    pits = -np.clip(1 - f1 / 5.0, 0, 1) ** 2                             # pitting
    h = pits * 0.9 + 0.35 * fft_noise(rng, s, 1.3) + 0.8 * blur(fft_noise(rng, s, 2.4), 6)
    save_rgb('n_cast.png', height_to_normal(h, 1.8))


def gen_ribbed(s=512):
    """moulded-plastic stipple (fine) for dash plastics"""
    rng = np.random.default_rng(15)
    f1, _ = worley(rng, s, 9000)
    h = -np.clip(1 - f1 / 2.6, 0, 1) + 0.2 * fft_noise(rng, s, 1.0) + 0.3 * blur(fft_noise(rng, s, 2.0), 10)
    save_rgb('n_stipple.png', height_to_normal(blur(h, 0.5), 1.0))


def gen_carbon(s=512):
    """2x2 twill: tows alternate over two / under two, shifted one per row."""
    yy, xx = np.mgrid[0:s, 0:s].astype(float)
    p = s / 32.0                                           # tow width in px (32 tows per tile)
    iu, iv = np.floor(xx / p), np.floor(yy / p)
    fu, fv = xx / p - iu, yy / p - iv
    over = ((iu + iv) % 4) < 2                             # warp on top
    # tow cross-section + fibre sheen direction
    prof_w = np.sin(np.pi * fv) ** 0.35
    prof_f = np.sin(np.pi * fu) ** 0.35
    h = np.where(over, prof_w, prof_f)
    rng = np.random.default_rng(16)
    fib = blur(fft_noise(rng, s, 0.6), 0.5)
    alb = np.where(over, 0.55 + 0.35 * np.sin(np.pi * fv) ** 2, 0.25 + 0.25 * np.sin(np.pi * fu) ** 2) + 0.05 * fib
    save_gray('a_carbon.png', np.clip(alb, 0, 1))
    save_rgb('n_carbon.png', height_to_normal(blur(h, 0.7) + 0.05 * fib, 1.4))


def gen_crack(s=1024):
    """cracked sun-baked vinyl: long meandering splits with branches + faint crazing, grayscale multiply (1 = no change)."""
    rng = np.random.default_rng(17)
    big = Image.new('L', (s, s), 0)
    d = ImageDraw.Draw(big)

    def walk(x, y, ang, L, w, depth):
        pts = [(x, y)]
        step = 6.0
        for i in range(int(L / step)):
            ang += rng.normal(0, 0.16)
            x += math.cos(ang) * step
            y += math.sin(ang) * step
            pts.append((x, y))
            if depth < 2 and rng.random() < 0.035:
                walk(x, y, ang + rng.choice([-1, 1]) * rng.uniform(0.6, 1.3), rng.uniform(30, 160), max(1, w - 1), depth + 1)
        for ox in (-s, 0, s):
            for oy in (-s, 0, s):
                d.line([(px + ox, py + oy) for px, py in pts], fill=255, width=int(w))
    for k in range(16):
        walk(rng.uniform(0, s), rng.uniform(0, s), rng.uniform(-0.5, 0.5) + (math.pi if k % 2 else 0), rng.uniform(220, 620), 3, 0)
    cr = np.asarray(big).astype(float) / 255
    lip = np.clip(blur(cr, 2.5) * 2.5 - cr, 0, 1)
    f1, f2 = worley(rng, s, 1600)
    craze = np.clip(1.0 - (f2 - f1) / 1.1, 0, 1) * np.clip(blur(fft_noise(rng, s, 2.8), 25) + 0.2, 0, 1) * 0.22
    a = 1.0 - 0.78 * blur(cr, 0.5) + 0.10 * lip - 0.2 * blur(craze, 0.5)
    a *= 1.0 + 0.10 * blur(fft_noise(rng, s, 2.5), 20)     # sun-fade blotches
    save_gray('a_crack.png', np.clip(a, 0, 1))


def gen_wood(s=512):
    """weathered plank / wood-grain albedo modulation, grain along u (image x)."""
    rng = np.random.default_rng(18)
    yy, xx = np.mgrid[0:s, 0:s].astype(float)
    warp = blur(fft_noise(rng, s, 2.4, aniso=(0.15, 1.0)), 2) * 9.0
    rings = np.sin((yy + warp) * 2 * np.pi / 11.0) * 0.5 + 0.5
    fine = blur(fft_noise(rng, s, 1.0, aniso=(0.05, 1.0)), 0.6)
    a = 0.72 + 0.16 * rings ** 3 + 0.06 * fine - 0.08 * np.clip(blur(fft_noise(rng, s, 2.2), 6), 0, 3)
    save_gray('a_wood.png', np.clip(a, 0, 1))


# ------------------------------------------------------------------------------------------------ decal atlas
ATLAS = 1024
RECTS = {}


def font(name, size):
    try:
        return ImageFont.truetype(FONTS + name, size)
    except OSError:
        return ImageFont.truetype(FONTS + 'arialbd.ttf', size)


def rect(name, x0, y0, x1, y1):
    """register a pixel rect (x0,y0 top-left) -> uv rect in Blender convention (v up)."""
    RECTS[name] = [x0 / ATLAS, 1 - y1 / ATLAS, x1 / ATLAS, 1 - y0 / ATLAS]
    return (x0, y0, x1, y1)


def grime(img, rng, amount=0.25, box=None):
    """darken + scuff a region (sticker wear)"""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    a = np.asarray(img.crop(box)).astype(float) / 255
    n = blur(fft_noise(rng, max(w, h), 2.2)[:h, :w], 2) if w == h else blur(fft_noise(rng, max(w, h), 2.2), 2)[:h, :w]
    sc = scratches(rng, max(w, h), 25, (0.05, 0.5), 0.5)[:h, :w]
    k = 1.0 - amount * np.clip(n * 0.5 + 0.3, 0, 1) - 0.18 * sc
    a[..., :3] = a[..., :3] * k[..., None] + 0.12 * sc[..., None] * amount
    img.paste(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), img.mode), box[:2])


def gen_atlas():
    rng = np.random.default_rng(21)
    img = Image.new('RGBA', (ATLAS, ATLAS), (30, 30, 30, 255))
    d = ImageDraw.Draw(img)
    # ---- row 0: 16 solid swatches 64x64 (name -> colour)
    sw = [('black', (14, 14, 15)), ('white', (225, 222, 212)), ('red', (190, 25, 18)), ('darkred', (110, 14, 10)), ('yellow', (240, 190, 20)),
          ('orange', (245, 105, 10)), ('green', (40, 150, 55)), ('blue', (30, 70, 170)), ('grey', (110, 110, 108)), ('brown', (90, 55, 30)),
          ('foam', (205, 175, 100)), ('copper', (190, 100, 50)), ('olive', (72, 78, 44)), ('cream', (230, 215, 170)), ('dgrey', (48, 48, 50)), ('silver', (175, 175, 172))]
    for i, (n, c) in enumerate(sw):
        x0 = i * 64
        d.rectangle(rect('sw_' + n, x0, 0, x0 + 64, 64), fill=c + (255,))
    # ---- skull & crossbones sticker (256x256) at (0,64)
    x0, y0 = 0, 64
    rect('skull', x0, y0, x0 + 256, y0 + 256)
    d.ellipse((x0 + 6, y0 + 6, x0 + 250, y0 + 250), fill=(20, 20, 20, 255))
    d.ellipse((x0 + 14, y0 + 14, x0 + 242, y0 + 242), outline=(230, 225, 210, 255), width=5)
    for a in (35, -35):
        cx, cy = x0 + 128, y0 + 175
        L = 95
        dx, dy = math.cos(math.radians(a)) * L, math.sin(math.radians(a)) * L
        d.line((cx - dx, cy - dy, cx + dx, cy + dy), fill=(230, 225, 210, 255), width=18)
        for sx in (-1, 1):
            ex, ey = cx + sx * dx, cy + sx * dy
            d.ellipse((ex - 14, ey - 14, ex + 14, ey + 14), fill=(230, 225, 210, 255))
    d.ellipse((x0 + 68, y0 + 40, x0 + 188, y0 + 150), fill=(230, 225, 210, 255))
    d.rectangle((x0 + 92, y0 + 130, x0 + 164, y0 + 172), fill=(230, 225, 210, 255))
    for ex in (98, 158):
        d.ellipse((x0 + ex - 20, y0 + 80, x0 + ex + 20, y0 + 118), fill=(20, 20, 20, 255))
    d.polygon([(x0 + 128, y0 + 120), (x0 + 118, y0 + 140), (x0 + 138, y0 + 140)], fill=(20, 20, 20, 255))
    for tx in range(98, 162, 12):
        d.line((x0 + tx, y0 + 150, x0 + tx, y0 + 172), fill=(20, 20, 20, 255), width=4)
    grime(img, rng, 0.3, (x0, y0, x0 + 256, y0 + 256))
    # ---- hazard triangle (256x224) at (256,64)
    x0, y0 = 256, 64
    rect('hazard', x0, y0, x0 + 256, y0 + 224)
    d.rectangle((x0, y0, x0 + 256, y0 + 224), fill=(240, 190, 20, 255))
    d.polygon([(x0 + 128, y0 + 14), (x0 + 244, y0 + 210), (x0 + 12, y0 + 210)], fill=(20, 20, 20, 255))
    d.polygon([(x0 + 128, y0 + 46), (x0 + 214, y0 + 192), (x0 + 42, y0 + 192)], fill=(240, 190, 20, 255))
    d.rectangle((x0 + 119, y0 + 90, x0 + 137, y0 + 152), fill=(20, 20, 20, 255))
    d.ellipse((x0 + 118, y0 + 160, x0 + 138, y0 + 180), fill=(20, 20, 20, 255))
    grime(img, rng, 0.3, (x0, y0, x0 + 256, y0 + 224))
    # ---- radiation trefoil (224x224) at (512,64)
    x0, y0 = 512, 64
    rect('radiation', x0, y0, x0 + 224, y0 + 224)
    d.rectangle((x0, y0, x0 + 224, y0 + 224), fill=(240, 190, 20, 255))
    cx, cy = x0 + 112, y0 + 112
    for k in range(3):
        a0 = -90 + k * 120 - 30
        d.pieslice((cx - 96, cy - 96, cx + 96, cy + 96), a0, a0 + 60, fill=(20, 20, 20, 255))
    d.ellipse((cx - 30, cy - 30, cx + 30, cy + 30), fill=(240, 190, 20, 255))
    d.ellipse((cx - 20, cy - 20, cx + 20, cy + 20), fill=(20, 20, 20, 255))
    grime(img, rng, 0.35, (x0, y0, x0 + 224, y0 + 224))
    # ---- text labels (each 256x64), stencil / condensed
    labels = [('lbl_nitro', 'NITRO', (245, 105, 10), (15, 15, 15)), ('lbl_arm', 'ARM', (190, 25, 18), (235, 230, 220)), ('lbl_lights', 'LIGHTS', (40, 40, 42), (230, 225, 210)),
              ('lbl_winch', 'WINCH', (40, 40, 42), (230, 225, 210)), ('lbl_pump', 'FUEL PUMP', (40, 40, 42), (230, 225, 210)), ('lbl_danger', 'DANGER', (190, 25, 18), (240, 235, 225)),
              ('lbl_ride', 'RIDE OR DIE', (15, 15, 15), (245, 105, 10)), ('lbl_nostep', 'NO STEP', (240, 190, 20), (15, 15, 15)), ('lbl_caution', 'CAUTION HOT', (240, 190, 20), (15, 15, 15)),
              ('lbl_v8', 'V8 POWER', (190, 25, 18), (240, 235, 225)), ('lbl_pull', 'PULL TO ARM', (15, 15, 15), (240, 190, 20)), ('lbl_nos', 'N2O', (30, 70, 170), (235, 235, 235))]
    for i, (n, txt, bg, fg) in enumerate(labels):
        if i < 6:
            box = rect(n, 736, 64 + i * 64, 1024, 128 + i * 64)
        else:
            box = rect(n, 0, 320 + (i - 6) * 64, 256, 384 + (i - 6) * 64)
        d.rectangle(box, fill=bg + (255,))
        f = font('STENCIL.TTF' if n in ('lbl_arm', 'lbl_danger', 'lbl_nostep', 'lbl_nitro', 'lbl_pull') else 'bahnschrift.ttf', 44 if len(txt) < 8 else 34)
        tw = d.textlength(txt, font=f)
        d.text((box[0] + (box[2] - box[0] - tw) / 2, box[1] + 8), txt, font=f, fill=fg + (255,))
        d.rectangle((box[0] + 3, box[1] + 3, box[2] - 4, box[3] - 4), outline=fg + (255,), width=2)
        grime(img, rng, 0.35, box)
    # ---- small round gauge faces (128x128 each, 4 of them) at (0,320)
    gnames = ['g_oil', 'g_temp', 'g_volt', 'g_press']
    for i, n in enumerate(gnames):
        x0, y0 = i * 128, 704
        rect(n, x0, y0, x0 + 128, y0 + 128)
        cx, cy = x0 + 64, y0 + 64
        d.ellipse((x0 + 2, y0 + 2, x0 + 126, y0 + 126), fill=(12, 12, 13, 255))
        for k in range(11):
            a = math.radians(135 + k * 27)
            r0 = 44 if k % 5 else 38
            d.line((cx + math.cos(a) * r0, cy + math.sin(a) * r0, cx + math.cos(a) * 54, cy + math.sin(a) * 54), fill=(225, 222, 212, 255) if k < 9 else (200, 30, 20, 255), width=3 if k % 5 == 0 else 2)
        f = font('bahnschrift.ttf', 16)
        t = ['OIL', 'TEMP', 'VOLT', 'PSI'][i]
        d.text((cx - d.textlength(t, font=f) / 2, cy + 18), t, font=f, fill=(170, 170, 165, 255))
        a = math.radians(135 + [150, 110, 175, 200][i])
        d.line((cx, cy, cx + math.cos(a) * 46, cy + math.sin(a) * 46), fill=(245, 105, 10, 255), width=4)
        d.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), fill=(60, 60, 60, 255))
    # ---- radio dial window (512x96) at (512,448)
    x0, y0 = 512, 448
    rect('radio_dial', x0, y0, x0 + 512, y0 + 96)
    d.rectangle((x0, y0, x0 + 512, y0 + 96), fill=(28, 24, 18, 255))
    f = font('arialbd.ttf', 20)
    for k, t in enumerate(['88', '92', '96', '100', '104', '108']):
        xx = x0 + 30 + k * 88
        d.text((xx - 10, y0 + 10), t, font=f, fill=(220, 190, 120, 255))
        for j in range(4):
            d.line((xx + j * 22, y0 + 40, xx + j * 22, y0 + (58 if j == 0 else 50)), fill=(220, 190, 120, 255), width=2)
    d.line((x0 + 20, y0 + 60, x0 + 492, y0 + 60), fill=(220, 190, 120, 255), width=2)
    d.rectangle((x0 + 290, y0 + 26, x0 + 295, y0 + 88), fill=(230, 60, 20, 255))
    f = font('arialbd.ttf', 16)
    d.text((x0 + 20, y0 + 70), 'FM', font=f, fill=(220, 190, 120, 255))
    # ---- serape blanket stripes (512x128) at (512,800) -- stripes run along u
    x0, y0 = 512, 800
    rect('serape', x0, y0, x0 + 512, y0 + 224)
    cols = [(150, 20, 30), (220, 120, 20), (240, 200, 60), (30, 110, 120), (20, 20, 30), (230, 225, 210), (160, 40, 90), (60, 140, 60), (200, 60, 20)]
    yy = y0
    k = 0
    while yy < y0 + 224:
        h = [22, 6, 10, 4, 14, 6, 26, 5, 9][k % 9]
        d.rectangle((x0, yy, x0 + 512, yy + h), fill=cols[(k * 4) % len(cols)] + (255,))
        yy += h
        k += 1
    grime(img, rng, 0.2, (x0, y0, x0 + 512, y0 + 224))
    # ---- polaroid photo (128x150) at (0,832) + road map (256x192) at (128,832)
    x0, y0 = 0, 832
    rect('photo', x0, y0, x0 + 128, y0 + 150)
    d.rectangle((x0, y0, x0 + 128, y0 + 150), fill=(228, 224, 212, 255))
    for yy in range(y0 + 8, y0 + 118):
        t = (yy - y0 - 8) / 110
        d.line((x0 + 8, yy, x0 + 120, yy), fill=(int(240 - 90 * t), int(170 - 40 * t), int(90 + 40 * t), 255))
    d.polygon([(x0 + 8, y0 + 100), (x0 + 40, y0 + 70), (x0 + 70, y0 + 92), (x0 + 95, y0 + 60), (x0 + 120, y0 + 96), (x0 + 120, y0 + 118), (x0 + 8, y0 + 118)], fill=(60, 40, 40, 255))
    d.ellipse((x0 + 50, y0 + 30, x0 + 78, y0 + 58), fill=(250, 220, 140, 255))
    grime(img, rng, 0.3, (x0, y0, x0 + 128, y0 + 150))
    x0, y0 = 128, 832
    rect('map', x0, y0, x0 + 384, y0 + 192)
    sub = Image.new('RGBA', (384, 192), (220, 208, 175, 255))
    sd = ImageDraw.Draw(sub)
    for k in range(60):
        pts = [(rng.uniform(0, 384), rng.uniform(0, 192))]
        for j in range(4):
            pts.append((pts[-1][0] + rng.normal(0, 40), pts[-1][1] + rng.normal(0, 25)))
        sd.line(pts, fill=(170, 80, 60, 255) if k % 7 == 0 else (120, 130, 150, 255), width=3 if k % 7 == 0 else 1)
    for k in range(5):
        cx, cy = rng.uniform(20, 364), rng.uniform(20, 172)
        sd.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), outline=(190, 25, 18, 255), width=3)
    sd.line((30, 150, 120, 110, 220, 120, 350, 40), fill=(190, 25, 18, 255), width=4)
    sd.line((192, 0, 192, 192), fill=(180, 170, 140, 255), width=2)
    img.paste(sub, (x0, y0))
    grime(img, rng, 0.35, (x0, y0, x0 + 384, y0 + 192))
    # ---- speaker / vent mesh (128x128 tileable-ish) at (256,320)
    x0, y0 = 256, 320
    rect('mesh', x0, y0, x0 + 128, y0 + 128)
    d.rectangle((x0, y0, x0 + 128, y0 + 128), fill=(40, 40, 42, 255))
    for yy in range(4, 128, 8):
        for xx in range(4 + (yy // 8 % 2) * 4, 128, 8):
            d.ellipse((x0 + xx - 2.4, y0 + yy - 2.4, x0 + xx + 2.4, y0 + yy + 2.4), fill=(6, 6, 6, 255))
    # ---- tally marks (256x96) at (256,448)
    x0, y0 = 256, 448
    rect('tally', x0, y0, x0 + 256, y0 + 96)
    d.rectangle((x0, y0, x0 + 256, y0 + 96), fill=(215, 210, 196, 255))
    for g in range(3):
        for j in range(4):
            xx = x0 + 16 + g * 80 + j * 14
            d.line((xx, y0 + 16, xx + rng.uniform(-3, 3), y0 + 80), fill=(20, 20, 20, 255), width=5)
        d.line((x0 + 8 + g * 80, y0 + 70, x0 + 72 + g * 80, y0 + 26), fill=(20, 20, 20, 255), width=5)
    grime(img, rng, 0.3, (x0, y0, x0 + 256, y0 + 96))
    # ---- warning-lamp strip (256x64) at (256,544): 6 coloured lamp lenses
    x0, y0 = 256, 544
    rect('lamps', x0, y0, x0 + 256, y0 + 64)
    d.rectangle((x0, y0, x0 + 256, y0 + 64), fill=(10, 10, 10, 255))
    for k, c in enumerate([(200, 30, 20), (230, 150, 20), (40, 170, 60), (40, 90, 200), (200, 30, 20), (230, 150, 20)]):
        d.ellipse((x0 + 8 + k * 41, y0 + 12, x0 + 8 + k * 41 + 34, y0 + 46), fill=tuple(int(v * 0.55) for v in c) + (255,))
        d.ellipse((x0 + 14 + k * 41, y0 + 16, x0 + 24 + k * 41, y0 + 26), fill=tuple(min(255, int(v * 0.9 + 40)) for v in c) + (255,))
    # ---- windshield sun strip (512x40) at (512,560): black band, orange block letters, thin stripes
    x0, y0 = 512, 560
    rect('sunstrip', x0, y0, x0 + 512, y0 + 40)
    d.rectangle((x0, y0, x0 + 512, y0 + 40), fill=(12, 12, 14, 255))
    d.rectangle((x0, y0 + 3, x0 + 512, y0 + 5), fill=(245, 105, 10, 255))
    d.rectangle((x0, y0 + 35, x0 + 512, y0 + 37), fill=(245, 105, 10, 255))
    f = font('bahnschrift.ttf', 28)
    txt = 'R I D E   O R   D I E'
    tw = d.textlength(txt, font=f)
    d.text((x0 + (512 - tw) / 2, y0 + 3), txt, font=f, fill=(245, 150, 40, 255))
    img = img.convert('RGB')
    img.save(os.path.join(OUT, 'decal_atlas.png'))
    with open(os.path.join(OUT, 'decal_atlas.json'), 'w') as fh:
        json.dump(RECTS, fh, indent=1)
    print('wrote decal_atlas.png', len(RECTS), 'rects')


if __name__ == '__main__':
    gen_atlas()
    gen_grain()
    gen_weave()
    gen_metal()
    gen_cast()
    gen_ribbed()
    gen_carbon()
    gen_crack()
    gen_wood()
