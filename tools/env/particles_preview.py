"""composite particle sprites over a background for review. usage: particles_preview.py out.png bg(r,g,b) file [file ...]  (files in public/textures/particles)"""
import os, sys
import numpy as np
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
P = os.path.join(ROOT, "public", "textures", "particles")
out = sys.argv[1]; bg = tuple(int(v) for v in sys.argv[2].split(",")); files = sys.argv[3:]
ims = []
for f in files:
    im = Image.open(os.path.join(P, f)).convert("RGBA")
    s = 1024 / max(im.size)
    im = im.resize((int(im.size[0] * s), int(im.size[1] * s)), Image.LANCZOS)
    b = Image.new("RGBA", im.size, bg + (255,))
    ims.append(Image.alpha_composite(b, im).convert("RGB"))
W = sum(i.size[0] for i in ims); H = max(i.size[1] for i in ims)
sh = Image.new("RGB", (W, H)); x = 0
for i in ims: sh.paste(i, (x, 0)); x += i.size[0]
sh.save(out); print(out, sh.size)
