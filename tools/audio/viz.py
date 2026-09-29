"""viz.py - contact sheets (waveform + log-frequency spectrogram) of built files, for inspection with the Read tool."""
import glob
import os
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import scipy.signal as ss
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "public", "audio"))
SHEETS = os.path.join(HERE, "sheets")


def spec_img(ax, x, sr, fmax=16000, dyn=80):
    nper = 2048 if len(x) < sr * 3 else 4096
    f, t, S = ss.spectrogram(x, sr, nperseg=nper, noverlap=nper * 7 // 8, window="hann", mode="magnitude")
    S = 20 * np.log10(S + 1e-9)
    S = S - S.max()
    # resample rows onto a log-frequency axis (linear FFT bins -> 30 Hz..fmax log grid)
    lf = np.geomspace(30, fmax, 260)
    from scipy.interpolate import interp1d
    Sl = interp1d(f, S, axis=0, kind="linear", bounds_error=False, fill_value=-dyn)(lf)
    ax.imshow(Sl[::-1], aspect="auto", cmap="magma", vmin=-dyn, vmax=0,
              extent=[0, len(x) / sr, np.log10(30), np.log10(fmax)], interpolation="bilinear")
    ticks = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
    ax.set_yticks([np.log10(v) for v in ticks if v <= fmax])
    ax.set_yticklabels([str(v) for v in ticks if v <= fmax], fontsize=5)
    ax.tick_params(axis="x", labelsize=5)


def sheet(files, out_png, cols=3, rows_per=6, title=""):
    n = len(files)
    per = cols * rows_per
    pages = (n + per - 1) // per
    outs = []
    for p in range(pages):
        chunk = files[p * per:(p + 1) * per]
        rws = (len(chunk) + cols - 1) // cols
        fig = plt.figure(figsize=(6.4 * cols, 2.2 * rws), dpi=100)
        for i, fpath in enumerate(chunk):
            x, sr = sf.read(fpath, dtype="float64", always_2d=True)
            m = x.mean(axis=1)
            r, c = divmod(i, cols)
            gs = fig.add_gridspec(rws * 2, cols, height_ratios=[1, 2] * rws, hspace=0.35, wspace=0.12)
            ax1 = fig.add_subplot(gs[r * 2, c])
            tt = np.arange(len(m)) / sr
            step = max(1, len(m) // 4000)
            # envelope-style waveform
            if step > 1:
                k = len(m) // step
                mm = m[:k * step].reshape(k, step)
                ax1.fill_between(tt[:k * step:step], mm.min(axis=1), mm.max(axis=1), color="#38a", lw=0)
            else:
                ax1.plot(tt, m, lw=0.5, color="#38a")
            ax1.set_xlim(0, len(m) / sr)
            ax1.set_ylim(-1, 1)
            ax1.set_xticks([])
            ax1.tick_params(labelsize=5)
            ax1.set_title(f"{os.path.basename(fpath)}  {len(m) / sr:.2f}s  pk {20 * np.log10(np.abs(x).max() + 1e-9):.1f}", fontsize=7, pad=2)
            ax2 = fig.add_subplot(gs[r * 2 + 1, c])
            spec_img(ax2, m, sr)
        fig.suptitle(title, fontsize=8)
        png = out_png.replace(".png", f"_{p + 1}.png") if pages > 1 else out_png
        fig.savefig(png, bbox_inches="tight")
        plt.close(fig)
        outs.append(png)
    return outs


if __name__ == "__main__":
    group = sys.argv[1]
    pats = sys.argv[2:] or ["*"]
    files = []
    for pat in pats:
        files += sorted(glob.glob(os.path.join(OUT, group, pat + ".ogg")))
    os.makedirs(SHEETS, exist_ok=True)
    tag = "_".join(p.replace("*", "x") for p in pats)[:40]
    outs = sheet(files, os.path.join(SHEETS, f"{group}_{tag}.png"), title=f"{group} {tag}")
    for o in outs:
        print(o)
