"""Make 512px texture sets for props (embedded in the GLBs) in the props texture cache (ROD_PROP_TEX, default C:/Dev/art_cache/rideordie/props_tex).
   usage: prep_prop_textures.py [--size 512] name [name ...]
   name = a texture set in public/textures/<name>/ ; or  polyhaven_id[:out_name]  (from the Poly Haven cache, tex_fetch.py first)"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PT = os.environ.get("ROD_PROP_TEX", "C:/Dev/art_cache/rideordie/props_tex")
CACHE = "C:/Dev/art_cache/rideordie/env"
os.makedirs(PT, exist_ok=True)
a = sys.argv[1:]; size = 512
if a and a[0] == "--size": size = int(a[1]); a = a[2:]
for nm in a:
    src, out = (nm.split(":") + [None])[:2]
    out = out or src
    d = os.path.join(ROOT, "public", "textures", src)
    if os.path.exists(os.path.join(d, "albedo.jpg")):
        files = dict(albedo="albedo.jpg", normal="normal.jpg", arm="arm.jpg")
    else:
        d = os.path.join(CACHE, src)
        files = dict(albedo="Diffuse.jpg", normal="nor_gl.jpg", arm="arm.jpg")
    for k, f in files.items():
        p = os.path.join(d, f)
        if not os.path.exists(p): print("missing", p); continue
        arr = resize(load(p), size)
        save_jpg(arr, os.path.join(PT, "%s_%s.jpg" % (out, k)), 86, 0 if k == "normal" else 2)
    print("ok", nm, "->", out)
