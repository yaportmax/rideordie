"""Ground-cover card atlas for src/world/dressing/groundcover.js.

2x2 cells of 512 px: 0 dry grass clump, 1 green grass clump, 2 dry seed stalks, 3 desert scrub bush (from the prop card textures in
C:/Dev/art_cache/rideordie/props_tex). Each clump is scaled to fill its cell with its base on the cell's bottom edge; colour is bled
under transparent texels (mips never pull in black). Output: public/textures/cover/cover_atlas.png (1024 x 1024 RGBA).
"""
import os
import numpy as np
from PIL import Image, ImageFilter

SRC = os.environ.get('ROD_PROP_TEX', 'C:/Dev/art_cache/rideordie/props_tex')
OUT = 'public/textures/cover/cover_atlas.png'
CELLS = ['card_grass_dry', 'card_grass_green', 'card_grass_stalks_dry', 'card_bush_scrub']
C = 512
atlas = Image.new('RGBA', (2 * C, 2 * C), (0, 0, 0, 0))
for i, n in enumerate(CELLS):
    im = Image.open(f'{SRC}/{n}.png').convert('RGBA')
    bb = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    im = im.crop(bb)
    w, h = im.size
    k = min((C - 8) / w, (C - 4) / h)
    im = im.resize((max(1, int(w * k)), max(1, int(h * k))), Image.LANCZOS)
    cell = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    cell.paste(im, ((C - im.size[0]) // 2, C - im.size[1]))
    # bleed colour outward under alpha 0 (repeated dilation of the opaque colour)
    a = np.asarray(cell).astype(np.float32)
    rgb, al = a[..., :3].copy(), a[..., 3:] / 255.0
    # iterative fill: empty texels take the blurred colour of their neighbours
    filled = rgb.copy(); mask = al[..., 0] > 0.02
    avg = (rgb[mask].mean(axis=0) if mask.any() else np.array([100, 90, 60]))
    filled[~mask] = avg
    for _ in range(24):
        blur = np.asarray(Image.fromarray(filled.astype(np.uint8)).filter(ImageFilter.BoxBlur(3))).astype(np.float32)
        filled[~mask] = blur[~mask]
    out = np.concatenate([filled, a[..., 3:]], axis=-1).clip(0, 255).astype(np.uint8)
    atlas.paste(Image.fromarray(out, 'RGBA'), ((i % 2) * C, (i // 2) * C))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
atlas.save(OUT, optimize=True)
print('saved', OUT, os.path.getsize(OUT) // 1024, 'KB')
