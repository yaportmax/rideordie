import sys, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32)
H, W = a.shape[:2]
def st(name, x0, x1, y0=0, y1=None):
    c = a[y0:y1 or int(H * 0.62), x0:x1].reshape(-1, 3)
    m = (c[:, 1] > c[:, 2] + 8) & (c[:, 1] >= c[:, 0] - 5)
    px = c[m]; lum = px @ np.array([.2126, .7152, .0722])
    f = lambda lo, hi: px[(lum >= np.percentile(lum, lo)) & (lum <= np.percentile(lum, hi))].mean(0).round()
    print(name, len(px), "p10", f(5, 15), "p50", f(40, 60), "p90", f(85, 95))
st("left half (LOD)", 0, W // 2); st("right half (full)", W // 2, W)
