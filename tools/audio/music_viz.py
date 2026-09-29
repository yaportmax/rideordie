"""music_viz.py - per-track stem sheets: one full-width log-frequency spectrogram per stem with bar lines/numbers
(and a beat tick strip for the drums), for inspection with the Read tool.

  python music_viz.py run_a            -> sheets/music_run_a_stems.png
  python music_viz.py run_a --zoom 0 4 -> zoomed to bars 0..4 (0-based, drum grid ticks at 16ths)
"""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import scipy.signal as ss
import soundfile as sf

import render as R
from dsp import SR

OUT = os.path.join(R.OUT, "music")
SHEETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sheets")


def spec(ax, x, t0, t1, fmax=16000, dyn=70, fine=False):
    m = x.mean(axis=1)
    a, b = int(t0 * SR), int(t1 * SR)
    seg = m[a:b]
    nper = 4096 if not fine else 2048
    f, t, S = ss.spectrogram(seg, SR, nperseg=nper, noverlap=nper - (512 if not fine else 128), window="hann", mode="magnitude")
    S = 20 * np.log10(S + 1e-9)
    # resample rows onto a true log-frequency grid (+3 dB/oct tilt so highs are visible)
    fg = np.geomspace(30, fmax, 320)
    Sg = np.empty((len(fg), S.shape[1]))
    for j in range(S.shape[1]):
        Sg[:, j] = np.interp(fg, f, S[:, j])
    Sg += 3.0 * np.log2(fg / 1000.0)[:, None]
    Sg -= Sg.max()
    ax.imshow(Sg[::-1], aspect="auto", cmap="magma", vmin=-dyn, vmax=0,
              extent=[t0 + t[0], t0 + t[-1], np.log10(30), np.log10(fmax)])
    ticks = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
    ax.set_yticks([np.log10(v) for v in ticks if v <= fmax])
    ax.set_yticklabels([str(v) for v in ticks if v <= fmax], fontsize=6)
    ax.set_xlim(t0, t1)


def main(track, zoom=None):
    from music_qa import collect
    tr = collect([track])
    ents = tr[track]
    order = ["base", "drums", "lead", "extra", "mix"]
    ents = sorted(ents, key=lambda e: order.index(e[1]) if e[1] in order else 9)
    ex = ents[0][2]
    bars = ex["bars"]
    dur = ex["samples"] / SR
    bar_s = dur / bars
    t0, t1 = 0.0, dur
    if zoom:
        t0, t1 = zoom[0] * bar_s, zoom[1] * bar_s
    fig, axs = plt.subplots(len(ents), 1, figsize=(16, 2.6 * len(ents)), sharex=True)
    axs = np.atleast_1d(axs)
    for ax, (name, key, e) in zip(axs, ents):
        x, sr = sf.read(os.path.join(OUT, name + ".ogg"), dtype="float64", always_2d=True)
        spec(ax, x, t0, t1, fine=zoom is not None)
        for b in range(bars + 1):
            tb = b * bar_s
            if t0 - 1e-6 <= tb <= t1 + 1e-6:
                ax.axvline(tb, color="w", lw=0.6, alpha=0.6, ls="--")
                ax.text(tb + 0.02, np.log10(13000), str(b + 1), color="w", fontsize=7, va="top")
        if zoom:
            sps = bar_s / 16
            k = int(np.ceil(t0 / sps))
            while k * sps <= t1:
                ax.axvline(k * sps, color="c", lw=0.3, alpha=0.35)
                k += 1
        ax.set_title(f"{name}  {len(x) / sr:.3f}s  peak {20 * np.log10(np.abs(x).max()):.1f} dB", fontsize=8, pad=2)
    axs[-1].set_xlabel("s", fontsize=7)
    os.makedirs(SHEETS, exist_ok=True)
    tag = f"_z{zoom[0]}-{zoom[1]}" if zoom else ""
    p = os.path.join(SHEETS, f"music_{track}_stems{tag}.png")
    fig.tight_layout()
    fig.savefig(p, dpi=90)
    print(p)


if __name__ == "__main__":
    a = sys.argv[1:]
    z = None
    if "--zoom" in a:
        i = a.index("--zoom")
        z = (float(a[i + 1]), float(a[i + 2]))
        a = a[:i]
    main(a[0], z)
