"""Prop-specific colour variants of texture sets already in the props texture cache (darker / browner than the terrain-scale versions).
   python tools/env/prop_tex_variants.py"""
import os, sys, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *
PT = os.environ.get("ROD_PROP_TEX", "C:/Dev/art_cache/rideordie/props_tex")
CACHE = "C:/Dev/art_cache/rideordie/env"


def variant(src, dst, mean, sat=1.0, contrast=1.0, from_cache=None):
    """copy normal+arm from src, re-tone albedo to `mean` (sRGB 0..255)"""
    for suf in ("normal", "arm"):
        shutil.copyfile(os.path.join(PT, f"{src}_{suf}.jpg"), os.path.join(PT, f"{dst}_{suf}.jpg"))
    a = load(os.path.join(PT, f"{src}_albedo.jpg"))
    save_jpg(tone(a, mean, sat=sat, contrast=contrast), os.path.join(PT, f"{dst}_albedo.jpg"), 88, 2)
    print("ok", dst)


if __name__ == "__main__":
    # keep an untouched copy of the original galvanised set, then darken the working one
    if not os.path.exists(os.path.join(PT, "galv_rust_orig_albedo.jpg")):
        for suf in ("albedo", "normal", "arm"):
            shutil.copyfile(os.path.join(PT, f"galv_rust_{suf}.jpg"), os.path.join(PT, f"galv_rust_orig_{suf}.jpg"))
    variant("galv_rust_orig", "galv_rust", (92, 84, 72), sat=1.0, contrast=1.1)
    # the source scan is light zinc with orange rust; tone() would push the neutral zinc toward blue, so rebuild it explicitly: zinc grey + rust mask
    _o = s2l(load(os.path.join(PT, "galv_rust_orig_albedo.jpg")))
    _L = lum(_o)
    _rust = smoothstep((_o[..., 0] - _o[..., 2]) / (_L + 0.02), 0.5, 1.3)[..., None]
    _d = (_L / _L.mean()) ** 0.8
    _zinc = s2l(np.array([128, 124, 116], np.float32) / 255.0) * _d[..., None]
    _rc = s2l(np.array([112, 66, 38], np.float32) / 255.0) * _d[..., None] * 1.1
    save_jpg(np.clip(l2s(np.clip(_zinc * (1 - _rust) + _rc * _rust, 0, 1)), 0, 1), os.path.join(PT, "galv_rust_albedo.jpg"), 88, 2)
    _a = load(os.path.join(PT, "galv_rust_orig_arm.jpg")); _a[..., 2] *= 0.35; _a[..., 1] = np.clip(_a[..., 1] + 0.28, 0, 1)   # weathered zinc: mostly dielectric grime, rough (no blue sky mirror)
    save_jpg(_a, os.path.join(PT, "galv_rust_arm.jpg"), 88, 2)
    variant("wood_rough", "wood_crate", (112, 88, 64), sat=1.0, contrast=1.1)
    variant("wood_rough", "wood_pole", (70, 56, 44), sat=0.9, contrast=1.15)
    variant("wood_planks", "wood_planks_d", (104, 82, 60), sat=1.0, contrast=1.05)
    variant("concrete", "concrete_p", (170, 158, 142), sat=0.9, contrast=1.2)
    variant("concrete_cracked", "concrete_cracked_p", (150, 140, 126), sat=0.9, contrast=1.15)
