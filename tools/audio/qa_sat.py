"""qa_sat.py - flag limiter-saturated (flat-topped) or extremely low-crest files."""
import glob
import os

import numpy as np
import soundfile as sf

rows = []
for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "..", "public", "audio", "*", "*.ogg"))):
    if os.sep + "music" + os.sep in f:
        continue
    x, sr = sf.read(f, always_2d=True)
    m = np.abs(x).max()
    frac = np.mean(np.abs(x) > 0.93 * m)
    crest = 20 * np.log10(m / (np.sqrt(np.mean(x ** 2)) + 1e-12))
    rows.append((frac * 100, crest, os.path.basename(f)))
rows.sort(reverse=True)
print("most saturated (percent of samples within 0.6 dB of peak, crest dB):")
for r in rows[:22]:
    print(f"{r[0]:6.3f}% crest {r[1]:5.1f}  {r[2]}")
print("lowest crest:")
for r in sorted(rows, key=lambda r: r[1])[:10]:
    print(f"{r[0]:6.3f}% crest {r[1]:5.1f}  {r[2]}")
