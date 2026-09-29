"""samples.py - CC0 Kenney sample layers (verified licences: k_impact / k_rpg / k_ui in C:/Dev/sfx_src)."""
import functools
import os

import numpy as np
import scipy.signal as ss

import dsp
from dsp import SR

BASE = "C:/Dev/sfx_src"


@functools.lru_cache(maxsize=256)
def _load(rel):
    return dsp.load_wav(os.path.join(BASE, rel))


def kenney(rel, ratio=1.0, gain=1.0, start=0.0, length=None, fin=0.0005, fout=0.01):
    """Load a Kenney CC0 sample (path relative to sfx_src), repitch by playback ratio, trim, fade."""
    x = _load(rel).copy()
    if start:
        x = x[dsp.secs(start):]
    if length:
        x = x[:dsp.secs(length)]
    if abs(ratio - 1.0) > 1e-3:
        x = dsp.repitch(x, ratio)
    x = dsp.fade(x, fin, fout)
    return x * gain


def impact(kind, idx, ratio=1.0, gain=1.0, **kw):
    """kind e.g. 'Metal_heavy', 'Plate_heavy', 'Mining', 'Punch_heavy', 'Soft_heavy', 'Glass_heavy', 'Tin_medium'"""
    return kenney(f"k_impact/Audio/impact{kind}_{idx % 5:03d}.ogg", ratio, gain, **kw)


def rpg(name, ratio=1.0, gain=1.0, **kw):
    return kenney(f"k_rpg/Audio/{name}.ogg", ratio, gain, **kw)
