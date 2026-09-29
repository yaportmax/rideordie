"""per-prop colour stats from a vegview 'foliage' render.  usage: foliage_measure.py png"""
import sys, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32)
items = ['fern', 'shrub_green_bush', 'shrub_desert_scrub', 'shrub_dry_bush', 'grass_tuft', 'grass_tuft_green', 'cactus_barrel', 'cactus_prickly_pear', 'cactus_saguaro', 'palm_coast', 'dead_tree_a', 'pine_a']
camz = -1.0; f = 768.0
for i, n in enumerate(items):
    X = 9.4 - i * 1.7; Z = 15 if n in ('palm_coast', 'pine_a') else 8
    sx = 800 - X * f / (Z - camz)
    w = 0.75 * f / (Z - camz) * (1.4 if n in ('palm_coast', 'pine_a') else 1.0)
    x0, x1 = int(max(0, sx - w)), int(min(1599, sx + w))
    c = a[:600, x0:x1].reshape(-1, 3)
    if n.startswith('dead') or n.startswith('shrub_dry') or n.startswith('grass_tuft') and 'green' not in n:
        m = (c[:, 0] > 30) & (c[:, 2] < c[:, 1] + 15) & (c[:, 2] < c[:, 0]) & (c[:, 0] < 230)       # warm straw / wood (not sky, not ground beyond)
    else:
        m = (c[:, 1] > c[:, 2] + 6) & (c[:, 1] >= c[:, 0] - 8)
    px = c[m]
    if len(px) < 30:
        print("%-22s (too few px %d)" % (n, len(px))); continue
    lum = px @ np.array([.2126, .7152, .0722])
    g = lambda lo, hi: px[(lum >= np.percentile(lum, lo)) & (lum <= np.percentile(lum, hi))].mean(0).round().astype(int).tolist()
    print("%-22s n=%-6d p10 %-16s p50 %-16s p90 %-16s" % (n, len(px), g(5, 15), g(40, 60), g(85, 95)))
