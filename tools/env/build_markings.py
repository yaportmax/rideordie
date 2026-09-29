"""Procedural road-marking atlas -> public/textures/road_markings/{markings.png, markings.json}
   Every marking is drawn as vector shapes, then chipped / worn / speckled so it doesn't look vector-clean.
   Orientation: the road's forward direction is UP in the image (image Y); items are centred, transparent background."""
import json, math, os, sys
import numpy as np
from scipy import ndimage as ndi
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import noise, smoothstep

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "public", "textures", "road_markings")
os.makedirs(OUT, exist_ok=True)
PPM = 128           # pixels per metre in the atlas
SS = 2              # supersample while drawing / wearing
ATLAS = 2048
WHITE = np.array([0.88, 0.87, 0.83], np.float32)
YELLOW = np.array([0.90, 0.67, 0.12], np.float32)


def canvas(w_m, h_m):
    return int(round(w_m * PPM)), int(round(h_m * PPM))


def draw_mask(w_m, h_m, painter):
    """painter(draw, s) draws white on black at scale s px/m; returns float mask at SS resolution"""
    W, H = canvas(w_m, h_m)
    im = Image.new("L", (W * SS, H * SS), 0)
    painter(ImageDraw.Draw(im), PPM * SS)
    return np.asarray(im, np.float32) / 255.0


def wear(mask, level, seed, chip=1.5, keep=1.0):
    """mask (float, SS res) -> alpha (float, SS res) with chipped edges, speckle and thinning paint. level 0..1"""
    H, W = mask.shape
    N = max(H, W)
    N = int(2 ** math.ceil(math.log2(N)))
    inside = ndi.distance_transform_edt(mask > 0.5)
    outside = ndi.distance_transform_edt(mask <= 0.5)
    sd = (inside - outside).astype(np.float32)
    jit = (noise(N, 2.5, seed)[:H, :W] * 1.2 + noise(N, 1.7, seed + 1)[:H, :W] * 0.8) * chip * SS * (0.4 + 0.9 * level)
    a = smoothstep(sd + jit, -0.9, 0.9)
    thr = 1.95 - 1.55 * level
    spk = noise(N, 1.9, seed + 2)[:H, :W]
    missing = smoothstep(spk, thr, thr + 0.4)
    patch = noise(N, 3.4, seed + 3)[:H, :W]
    fade = smoothstep(patch, 1.1 - level * 1.4, 1.7 - level * 1.4) * level * 0.85
    grain = noise(N, 1.1, seed + 4)[:H, :W]
    a = a * (1 - missing) * (1 - fade) * (0.9 + 0.08 * np.tanh(grain))
    # paint pooled at the edges: slightly thicker alpha near the inside edge -> reads as thermoplastic
    return np.clip(a * keep, 0, 1)


def to_rgba(alpha, color, seed):
    H, W = alpha.shape
    N = int(2 ** math.ceil(math.log2(max(H, W))))
    dirt = 0.5 + 0.5 * np.tanh(noise(N, 3.0, seed + 9)[:H, :W])
    dirt2 = 0.5 + 0.5 * np.tanh(noise(N, 1.6, seed + 10)[:H, :W])
    k = (0.80 + 0.14 * dirt + 0.06 * dirt2)[..., None]
    rgb = color[None, None, :] * k
    # downsample SS -> 1
    a1 = alpha.reshape(H // SS, SS, W // SS, SS).mean((1, 3))
    prem = (rgb * alpha[..., None]).reshape(H // SS, SS, W // SS, SS, 3).mean((1, 3))
    c1 = prem / np.maximum(a1[..., None], 1e-4)
    # bleed colour into fully transparent texels
    c1 = np.where(a1[..., None] < 0.002, color[None, None, :] * 0.8, c1)
    return np.clip(c1, 0, 1), np.clip(a1, 0, 1)


# ------------------------------------------------------------------------------------------------ shapes
def rect(x0, y0, x1, y1):
    def p(d, s):
        d.rectangle([x0 * s, y0 * s, x1 * s, y1 * s], fill=255)
    return p


def multi(*ps):
    def p(d, s):
        for q in ps:
            q(d, s)
    return p


def poly(pts):
    def p(d, s):
        d.polygon([(x * s, y * s) for x, y in pts], fill=255)
    return p


def chevron(W, H, stroke):
    ia = 2 * stroke * H / W
    return poly([(0, H), (W / 2, 0), (W, H), (W - stroke, H), (W / 2, ia), (stroke, H)])


def arrow_path(path, shaft, head_len, head_w):
    """polyline shaft with an arrow head at the end of `path` (metres)"""
    def p(d, s):
        pts = [(x * s, y * s) for x, y in path]
        d.line(pts, fill=255, width=int(shaft * s), joint="curve")
        for (x, y) in pts[1:-1]:
            r = shaft * s / 2
            d.ellipse([x - r, y - r, x + r, y + r], fill=255)
        (x0, y0), (x1, y1) = path[-2], path[-1]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy); dx /= L; dy /= L
        nx, ny = -dy, dx
        bx, by = x1, y1                                    # head base at the path end, tip extends forward
        tip = (bx + dx * head_len, by + dy * head_len)
        d.polygon([((bx + nx * head_w / 2) * s, (by + ny * head_w / 2) * s), (tip[0] * s, tip[1] * s), ((bx - nx * head_w / 2) * s, (by - ny * head_w / 2) * s)], fill=255)
    return p


def hatch(W, H, stripe=0.28, pitch=0.8, border=0.15):
    def p(d, s):
        d.rectangle([0, 0, border * s, H * s], fill=255)
        d.rectangle([(W - border) * s, 0, W * s, H * s], fill=255)
        k = -H
        while k < W + H:
            pts = [(k, H), (k + stripe * 1.414, H), (k + stripe * 1.414 + H, 0), (k + H, 0)]
            d.polygon([(x * s, y * s) for x, y in pts], fill=255)
            k += pitch * 1.414
        # keep stripes inside the borders
    return p


def clip_between(mask_fn, W, H, margin):
    return mask_fn


def crosswalk(W, H, bar=0.5, gap=0.5):
    def p(d, s):
        x = gap / 2
        while x + bar <= W + 1e-6:
            d.rectangle([x * s, 0, (x + bar) * s, H * s], fill=255)
            x += bar + gap
    return p


def rumble(W, H, groove=0.16, pitch=0.42):
    def p(d, s):
        y = pitch / 2
        while y + groove <= H:
            d.rounded_rectangle([0.06 * s, y * s, (W - 0.06) * s, (y + groove) * s], radius=0.05 * s, fill=255)
            y += pitch
    return p


# ------------------------------------------------------------------------------------------------ item table
def items():
    L = []
    def add(name, w, h, painter, color, level, seed, chip=1.5, kind="", keep=1.0, dark=False, note=""):
        L.append(dict(name=name, w=w, h=h, painter=painter, color=color, level=level, seed=seed, chip=chip, kind=kind, keep=keep, dark=dark, note=note))
    # white dashed lane line: 3.2 m dash (one instance per 12 m), 0.15 m wide
    for i, lv in enumerate((0.30, 0.55, 0.85)):
        add(f"dash_white_{'abc'[i]}", 0.34, 3.2, rect(0.095, 0.05, 0.245, 3.15), WHITE, lv, 10 + i, kind="dash", note="3.0 m dash; repeat every 12 m (9 m gap)")
    for i, lv in enumerate((0.35, 0.7)):
        add(f"dash_yellow_{'ab'[i]}", 0.34, 3.2, rect(0.095, 0.05, 0.245, 3.15), YELLOW, lv, 20 + i, kind="dash")
    # solid edge line 6 m segments
    for i, lv in enumerate((0.25, 0.5, 0.75)):
        add(f"edge_white_{'abc'[i]}", 0.34, 6.0, rect(0.085, 0.0, 0.255, 6.0), WHITE, lv, 30 + i, kind="segment", note="solid line, 6 m; stack end to end (bottom of one = top of next)")
    add("edge_white_faded", 0.34, 6.0, rect(0.085, 0.0, 0.255, 6.0), WHITE, 0.98, 36, chip=2.2, kind="segment", keep=0.85, note="almost gone")
    # centre lines
    for i, lv in enumerate((0.3, 0.55, 0.8)):
        add(f"double_yellow_{'abc'[i]}", 0.62, 6.0, multi(rect(0.10, 0.0, 0.25, 6.0), rect(0.37, 0.0, 0.52, 6.0)), YELLOW, lv, 40 + i, kind="segment", note="double solid yellow centre line, 6 m")
    for i, lv in enumerate((0.3, 0.7)):
        add(f"single_yellow_{'ab'[i]}", 0.34, 6.0, rect(0.085, 0.0, 0.255, 6.0), YELLOW, lv, 50 + i, kind="segment")
    add("yellow_solid_dash", 0.62, 6.0, multi(rect(0.10, 0.0, 0.25, 6.0), *[rect(0.37, y, 0.52, y + 1.0) for y in (0.15, 3.15)]), YELLOW, 0.45, 55, kind="segment", note="passing zone: solid + dashed (1 m dash / 2 m gap)")
    # rumble strips (dark grooves) — fresh + worn
    add("rumble_a", 0.90, 3.0, rumble(0.90, 3.0), np.array([0.03, 0.03, 0.03], np.float32), 0.25, 60, chip=1.2, kind="rumble", keep=0.62, note="milled shoulder grooves, darkening decal")
    add("rumble_b", 0.90, 3.0, rumble(0.90, 3.0), np.array([0.05, 0.045, 0.04], np.float32), 0.7, 61, chip=2.0, kind="rumble", keep=0.5, note="worn / filled with dust")
    # chevrons + hatching (gore)
    add("chevron_white", 3.0, 2.2, chevron(3.0, 2.2, 0.50), WHITE, 0.4, 70, kind="chevron", note="V pointing forward (up)")
    add("chevron_yellow", 3.0, 2.2, chevron(3.0, 2.2, 0.50), YELLOW, 0.55, 71, kind="chevron")
    add("hatch_white", 2.0, 4.0, hatch(2.0, 4.0), WHITE, 0.45, 72, kind="hatch", note="gore / painted island, diagonal stripes")
    add("hatch_yellow", 2.0, 4.0, hatch(2.0, 4.0), YELLOW, 0.6, 73, kind="hatch")
    # arrows (elongated 4 m)
    add("arrow_straight", 1.0, 4.0, multi(rect(0.35, 1.5, 0.65, 3.95), poly([(0.5, 0.05), (0.98, 1.6), (0.02, 1.6)])), WHITE, 0.45, 80, kind="arrow")
    add("arrow_left", 1.8, 4.0, arrow_path([(1.30, 3.95), (1.30, 2.35), (0.80, 1.45)], 0.30, 1.1, 0.95), WHITE, 0.45, 81, kind="arrow")
    add("arrow_right", 1.8, 4.0, arrow_path([(0.50, 3.95), (0.50, 2.35), (1.00, 1.45)], 0.30, 1.1, 0.95), WHITE, 0.45, 82, kind="arrow")
    # crosswalk / stop line
    add("crosswalk", 4.0, 3.0, crosswalk(4.0, 3.0), WHITE, 0.55, 90, kind="crosswalk", note="zebra bars run along the road; 4 m wide")
    add("stop_line", 3.6, 0.5, rect(0.0, 0.05, 3.6, 0.45), WHITE, 0.5, 91, kind="stopline")
    return L


def pack(its):
    """shelf packing, sorted by height"""
    pad = 10
    order = sorted(its, key=lambda i: -canvas(i["w"], i["h"])[1])
    x = y = shelf = pad
    for it in order:
        W, H = canvas(it["w"], it["h"])
        if x + W + pad > ATLAS:
            x = pad; y += shelf + pad; shelf = 0
        it["x"], it["y"], it["W"], it["H"] = x, y, W, H
        x += W + pad
        shelf = max(shelf, H)
    assert y + shelf + pad <= ATLAS, "atlas overflow %d" % (y + shelf)
    return y + shelf + pad


def main():
    its = items()
    used = pack(its)
    atlas = np.zeros((ATLAS, ATLAS, 4), np.float32)
    atlas[..., :3] = 0.5
    meta = {}
    for it in its:
        m = draw_mask(it["w"], it["h"], it["painter"])
        a = wear(m, it["level"], it["seed"], chip=it["chip"], keep=it["keep"])
        rgb, a1 = to_rgba(a, it["color"], it["seed"])
        x, y, W, H = it["x"], it["y"], it["W"], it["H"]
        atlas[y:y + H, x:x + W, :3] = rgb
        atlas[y:y + H, x:x + W, 3] = a1
        meta[it["name"]] = dict(x=x, y=y, w=W, h=H, size_m=[it["w"], it["h"]], kind=it["kind"], color="yellow" if it["color"][2] < 0.3 and it["color"][0] > 0.6 else ("dark" if it["color"][0] < 0.1 else "white"),
                                uv=[round(x / ATLAS, 5), round(1 - (y + H) / ATLAS, 5), round((x + W) / ATLAS, 5), round(1 - y / ATLAS, 5)], note=it["note"])
    img = Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
    img.save(os.path.join(OUT, "markings.png"), optimize=True)
    json.dump(dict(px_per_m=PPM, atlas=[ATLAS, ATLAS], note="forward = image up (+V); uv = [u0, v0, u1, v1] in three.js convention (flipY true); alpha-blended decals", items=meta),
              open(os.path.join(OUT, "markings.json"), "w"), indent=1)
    print("saved markings.png used height", used, os.path.getsize(os.path.join(OUT, "markings.png")) // 1024, "KB;", len(meta), "items")


if __name__ == "__main__":
    main()
