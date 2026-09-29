"""Bark / skin texture sets for the vegetation props -> props texture cache (512px).  Needs tex_fetch.py --res 1k pine_bark bark_willow palm_bark first."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *
PT = os.environ.get("ROD_PROP_TEX", "C:/Dev/art_cache/rideordie/props_tex")
CACHE = "C:/Dev/art_cache/rideordie/env"
os.makedirs(PT, exist_ok=True)

def prep(src, out, mean, sat, contrast, size=512):
    d = os.path.join(CACHE, src)
    a = resize(load(os.path.join(d, "Diffuse.jpg")), size)
    n = resize(load(os.path.join(d, "nor_gl.jpg")), size)
    arm = resize(load(os.path.join(d, "arm.jpg")), size)
    arm[..., 1] = 0.88 + 0.12 * arm[..., 1]                 # bark: matte
    a = tone(a, mean, sat=sat, contrast=contrast)
    save_jpg(a, os.path.join(PT, out + "_albedo.jpg"), 88, 2)
    save_jpg(n, os.path.join(PT, out + "_normal.jpg"), 88, 0)
    save_jpg(arm, os.path.join(PT, out + "_arm.jpg"), 86, 2)
    print("ok", out)

prep("bark_willow", "bark_dead", (68, 63, 56), 0.4, 1.6)      # weathered silver-grey dead wood
prep("pine_bark", "bark_pine", (62, 46, 36), 0.55, 1.2)             # dark red-brown pine bark plates
prep("palm_bark", "bark_palm", (84, 72, 56), 0.9, 1.3)           # pale ringed palm trunk
prep("knotted_pine_bark", "bark_dead2", (128, 116, 102), 0.3, 1.2) # alt dead wood with knots
