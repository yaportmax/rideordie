"""music_lib.py - sequencer, instruments, buses, mastering and on-disk caching for the RIDE OR DIE music tracks.

Everything is synthesised (numpy / numba via dsp.py).  All placement is circular (dsp.place_wrap), all filters that
touch whole buses run on 3x-tiled material (loop=True) and reverb / delay are circular, so every stem is a seamless loop.

Conventions
  * Grid: `steps` = 16th notes, N samples for the whole loop, samples-per-step is a float, every event is rounded to
    the nearest sample (no drift; all stems of a track share the same Grid => identical length, bar aligned).
  * Scale degrees: d=0 is the tonic, 7 is the tonic an octave up, negative = below (Scale.midi(d)).
"""
import hashlib
import json
import math
import os
import time

import numpy as np
import scipy.fft as sfft
import scipy.ndimage as ndi
from numba import njit

import dsp
from dsp import SR, TAU, secs

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")

# ======================================================================================================== theory
SCALES = {
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "harmonic": [0, 2, 3, 5, 7, 8, 11],
    "major": [0, 2, 4, 5, 7, 9, 11],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "phrygdom": [0, 1, 4, 5, 7, 8, 10],
}
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def stem_outputs(track):
    return [(f"{track}_{k}", k, i) for i, k in enumerate(["base", "drums", "lead", "extra"])]


def mtof(m):
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


class Scale:
    def __init__(self, tonic, mode="minor"):
        self.tonic = tonic
        self.mode = mode
        self.steps = SCALES[mode]

    def midi(self, d):
        o, k = divmod(int(d), 7)
        return self.tonic + self.steps[k] + 12 * o

    def triad(self, r):
        return [self.midi(r), self.midi(r + 2), self.midi(r + 4)]

    def pcs(self):
        return sorted({(self.tonic + s) % 12 for s in self.steps})

    def name(self):
        return f"{NOTE_NAMES[self.tonic % 12]} {self.mode}"


def voice_lead(prev, pcs, lo, hi):
    """choose one pitch for each pitch class in [lo,hi] minimising motion vs the previous voicing (sorted lists)."""
    import itertools
    cands = []
    for pc in pcs:
        cands.append([m for m in range(lo, hi + 1) if m % 12 == pc % 12])
    best, bc = None, 1e9
    for combo in itertools.product(*cands):
        s = sorted(combo)
        if len(set(s)) < len(s):
            continue
        cost = sum(abs(a - b) for a, b in zip(s, prev)) if prev else abs(sum(s) / len(s) - (lo + hi) / 2) * len(s)
        if cost < bc:
            best, bc = s, cost
    return best


def bass_root(scale, deg, lo=28):
    """midi of scale degree deg folded into [lo, lo+12)."""
    m = scale.midi(deg)
    while m < lo:
        m += 12
    while m >= lo + 12:
        m -= 12
    return m


def parse_notes(s):
    """'0:3=0 3:3=2' -> [(step, len, degree)]  (step:len=degree, degree may be negative / >7)."""
    out = []
    for tok in s.split():
        a, b = tok.split("=")
        st, ln = a.split(":")
        out.append((float(st), float(ln), int(b)))
    return out


def parse_lane(s):
    """'x...5...' -> list of (step, vel): '.' rest, 'x' 1.0, '1'..'9' -> d/9.  Spaces ignored."""
    s = s.replace(" ", "")
    out = []
    for i, c in enumerate(s):
        if c == ".":
            continue
        out.append((i, 1.0 if c == "x" else int(c) / 9.0))
    return out


# ======================================================================================================== grid
class Grid:
    def __init__(self, bpm, bars):
        self.bars = bars
        self.steps = bars * 16
        self.N = int(round(self.steps * SR * 15.0 / bpm))
        self.sps = self.N / self.steps
        self.bpm = 60.0 * SR / (4.0 * self.sps)
        self.nominal = bpm

    def t(self, step):
        return int(round(step * self.sps))

    def dur(self, step, length):
        return max(1, self.t(step + length) - self.t(step))

    def zeros(self):
        return np.zeros((self.N, 2))

    def beats(self):
        return [self.t(4 * b) for b in range(self.bars * 4)]


def put(buf, x, start, gain=1.0, pan=0.0):
    """circular add of a mono (pan) or stereo sound."""
    if x.ndim == 1:
        x = dsp.pan_stereo(x, pan)
    dsp.place_wrap(buf, x, int(start), gain)
    return buf


class Human:
    """seeded micro timing / velocity humanisation."""

    def __init__(self, r, ms=2.0, vel=0.06):
        self.r, self.ms, self.vel = r, ms, vel

    def t(self, s):
        return int(round(self.r.uniform(-1, 1) * self.ms * 1e-3 * SR)) if self.ms > 0 else 0

    def v(self, x=1.0):
        return x * (1.0 + self.r.uniform(-self.vel, self.vel))


# ======================================================================================================== envelopes
def adsr_env(n, gate, a=0.005, d=0.1, s=0.7, r=0.05):
    t = np.arange(n) / SR
    at = np.minimum(t / max(a, 1e-4), 1.0)
    dec = s + (1.0 - s) * np.exp(-np.maximum(t - a, 0.0) / max(d / 3.0, 1e-4))
    e = np.where(t < a, at, dec)
    if gate < n:
        rel = np.exp(-np.maximum(t[gate:] - gate / SR, 0.0) / max(r / 4.0, 1e-4))
        e[gate:] *= rel
    k = min(n, int(0.0015 * SR))
    e[n - k:] *= np.linspace(1, 0, k)
    return e


def tail_n(gate, rel):
    return gate + int(rel * SR * 1.6) + 8


def saturate(x, drive):
    """unity-small-signal tanh."""
    return np.tanh(x * drive) / drive if drive > 1e-6 else x


def soft_crest(x, crest_db):
    """soft clip so that peaks sit about crest_db above the stem RMS (smooth knee)."""
    rm = dsp.rms(x)
    c = rm * 10 ** (crest_db / 20.0)
    a = np.abs(x) / c
    y = np.where(a < 0.55, a, 0.55 + 0.45 * np.tanh((a - 0.55) / 0.45))
    return np.sign(x) * y * c


# ======================================================================================================== ducking
def duck_env(g, steps, depth=0.65, tau=0.05, att=0.0012, length=0.28):
    """sidechain-style gain: dips by `depth` at each listed step, recovers with time constant tau.  Exactly periodic
    for periodic step lists."""
    L = secs(length)
    t = np.arange(L) / SR
    sh = (1.0 - np.exp(-t / att)) * np.exp(-t / tau)
    sh = sh / sh.max()
    seg = 1.0 - depth * sh
    env = np.ones(g.N)
    for s in steps:
        idx = (g.t(s) + np.arange(L)) % g.N
        env[idx] *= seg
    return env


# ======================================================================================================== oscillators / voices
def _phase_list(seed, k):
    r = np.random.default_rng(seed)
    return r.uniform(0.0, 1.0, k)


def _osc(wave, f, n, ph0, pw=0.5):
    if wave == "saw":
        return dsp.saw(f, n, ph0)
    if wave == "pulse":
        return dsp.pulse(f, n, pw, ph0)
    if wave == "tri":
        return dsp.tri(f, n, ph0)
    if wave == "sine":
        return dsp.sine(f, n, ph0)
    raise ValueError(wave)


def synth_note(f, gate, vel=1.0, wave="saw", pw=0.5, unison=1, det=0.0, spread=0.0, a=0.005, d=0.15, s=0.7, r=0.08,
               fc0=4000.0, fc1=1500.0, ftau=0.1, q=0.9, drive=0.0, vib_depth=0.0, vib_rate=5.5, vib_delay=0.15,
               sub=0.0, seed=1, fc_track=0.0, pwm=0.0):
    """stereo (n,2) note.  det in cents (total half-spread of unison voices), spread 0..1 stereo width, filter LP
    envelope fc1 + (fc0-fc1)*exp(-t/ftau)  (+ fc_track * f)."""
    n = tail_n(gate, r)
    t = np.arange(n) / SR
    ph = _phase_list(seed, max(unison, 1))
    offs = np.zeros(1) if unison == 1 else np.linspace(-det, det, unison)
    pans = np.zeros(1) if unison == 1 else np.linspace(-spread, spread, unison)
    if vib_depth > 0:
        vib = 1.0 + vib_depth * np.sin(TAU * vib_rate * t) * np.clip((t - vib_delay) / 0.3, 0.0, 1.0)
    else:
        vib = 1.0
    L = np.zeros(n)
    R = np.zeros(n)
    for i in range(len(offs)):
        fr = f * 2.0 ** (offs[i] / 1200.0) * vib
        if pwm > 0:
            fr = fr  # (pwm handled through pulse width below)
        v = _osc(wave, fr, n, ph[i], pw)
        aa = (pans[i] + 1.0) * math.pi / 4
        L += v * math.cos(aa)
        R += v * math.sin(aa)
    norm = 1.0 / math.sqrt(len(offs))
    L *= norm
    R *= norm
    if sub > 0:
        sb = np.sin(TAU * f * t) * sub
        L += sb
        R += sb
    fc = (fc1 + (fc0 - fc1) * np.exp(-t / max(ftau, 1e-4))) + fc_track * f
    L = dsp.svf(L, fc, q, "lp")
    R = dsp.svf(R, fc, q, "lp")
    if drive > 0:
        L = saturate(L, drive)
        R = saturate(R, drive)
    e = adsr_env(n, gate, a, d, s, r) * vel
    return np.stack([L * e, R * e], axis=1)


def bass_note(f, gate, vel=1.0, open_=1800.0, close=260.0, tau_f=0.07, res=0.3, drive=3.0, sub=0.7, rel=0.05,
              a=0.003, det=5.0, wave="saw", seed=3):
    """mono distorted saw bass: 2 detuned saws through resonant ladder LP with per-note filter env, tanh drive and a
    sine sub at the fundamental."""
    n = tail_n(gate, rel)
    t = np.arange(n) / SR
    ph = _phase_list(seed, 2)
    f1 = f * 2.0 ** (det / 1200.0)
    f2 = f * 2.0 ** (-det / 1200.0)
    if wave == "saw":
        osc = 0.5 * dsp.saw(f1, n, ph[0]) + 0.5 * dsp.saw(f2, n, ph[1])
    elif wave == "tri":
        osc = 0.5 * dsp.tri(f1, n, ph[0]) + 0.5 * dsp.tri(f2, n, ph[1])
    else:
        osc = 0.5 * dsp.pulse(f1, n, 0.5, ph[0]) + 0.5 * dsp.pulse(f2, n, 0.35, ph[1])
    fc = close + (open_ - close) * np.exp(-t / tau_f)
    y = dsp.ladder(osc, fc, res, 1.0)
    y = saturate(y * 1.5, drive) * 1.2
    y = y + sub * np.sin(TAU * f * t)
    e = adsr_env(n, gate, a, 0.25, 0.85, rel)
    return y * e * vel


def power_chord(m_root, gate, vel=1.0, palm=False, gain=6.0, seed=5, rel=0.09, spread=0.55, oct_up=True, fifth=True):
    """distorted saw power chord (root+fifth+octave), double tracked L/R, cabinet filtered. returns stereo."""
    n = tail_n(gate, rel)
    t = np.arange(n) / SR
    notes = [m_root]
    if fifth:
        notes.append(m_root + 7)
    if oct_up:
        notes.append(m_root + 12)
    outs = []
    for take, (pan, dets) in enumerate([(-spread, (-6.0, 5.0)), (spread, (6.0, -5.0))]):
        y = np.zeros(n)
        ph = _phase_list(seed + take, 6)
        k = 0
        for m in notes:
            f = mtof(m)
            for dcent in dets:
                y += dsp.saw(f * 2.0 ** (dcent / 1200.0), n, ph[k % 6])
                k += 1
        y = y / len(notes)
        y = saturate(y, gain) * 1.0
        outs.append((y, pan))
    e = adsr_env(n, gate, 0.003, 0.12 if palm else 0.5, 0.35 if palm else 0.8, rel)
    if palm:
        e = e * np.exp(-t / 0.13)
    res = []
    for y, pan in outs:
        y = dsp.hp(y, 90.0, 2)
        y = dsp.svf(y, 1500.0 if palm else 3600.0, 0.9, "lp")
        y = dsp.peak_eq(y, 1900.0, 3.0, 0.9)
        res.append(dsp.pan_stereo(y * e * vel, pan))
    return res[0] + res[1]


def brass_note(f, gate, vel=1.0, a=0.035, d=0.25, s=0.8, r=0.12, fc_lo=500.0, fc_hi=3200.0, drive=1.8, seed=7, sub_oct=True):
    """detuned saw stack through an opening lowpass: synth-brass stab (stereo)."""
    n = tail_n(gate, r)
    t = np.arange(n) / SR
    ph = _phase_list(seed, 6)
    L = np.zeros(n)
    R = np.zeros(n)
    for i, (dc, pan) in enumerate([(-9.0, -0.6), (-3.0, -0.2), (3.0, 0.2), (9.0, 0.6)]):
        v = dsp.saw(f * 2.0 ** (dc / 1200.0), n, ph[i])
        aa = (pan + 1) * math.pi / 4
        L += v * math.cos(aa)
        R += v * math.sin(aa)
    if sub_oct:
        v = dsp.saw(f * 0.5, n, ph[4]) * 0.9
        L += v * 0.7
        R += v * 0.7
    fc = fc_lo + (fc_hi - fc_lo) * (1 - np.exp(-t / 0.055)) * (0.55 + 0.45 * np.exp(-t / 0.5))
    L = dsp.svf(L, fc, 1.3, "lp")
    R = dsp.svf(R, fc, 1.3, "lp")
    L = saturate(L * 0.6, drive)
    R = saturate(R * 0.6, drive)
    e = adsr_env(n, gate, a, d, s, r) * vel
    return np.stack([L * e, R * e], axis=1)


_VOWELS = {
    "ah": ((730.0, 1090.0, 2440.0), (1.0, 0.55, 0.30), (9.0, 11.0, 14.0)),
    "oh": ((450.0, 800.0, 2830.0), (1.0, 0.45, 0.10), (9.0, 11.0, 14.0)),
    "oo": ((325.0, 700.0, 2530.0), (1.0, 0.35, 0.08), (9.0, 11.0, 14.0)),
    "eh": ((530.0, 1840.0, 2480.0), (1.0, 0.45, 0.25), (9.0, 11.0, 14.0)),
}


def choir_note(f, gate, vel=1.0, vowel="ah", a=0.5, r=0.7, seed=9, vib=0.0045, breath=0.02):
    """formant-filtered saw stack ('choir'): 3 detuned saws with slow vibrato through 3 resonant bandpass formants."""
    n = tail_n(gate, r)
    t = np.arange(n) / SR
    fr, am, qs = _VOWELS[vowel]
    ph = _phase_list(seed, 4)
    rr = np.random.default_rng(seed)
    src_l = np.zeros(n)
    src_r = np.zeros(n)
    for i, (dc, pan, vph) in enumerate([(-11.0, -0.7, 0.0), (0.0, 0.0, 1.9), (11.0, 0.7, 4.1)]):
        vibr = 1.0 + vib * np.sin(TAU * 5.1 * t + vph) * np.clip((t - 0.25) / 0.5, 0, 1)
        v = dsp.saw(f * 2.0 ** (dc / 1200.0) * vibr, n, ph[i])
        aa = (pan + 1) * math.pi / 4
        src_l += v * math.cos(aa)
        src_r += v * math.sin(aa)
    outs = []
    for src in (src_l, src_r):
        y = np.zeros(n)
        for fc_, a_, q_ in zip(fr, am, qs):
            y += a_ * dsp.svf(src, fc_, q_, "bp")
        y += 0.10 * dsp.lp(src, 700.0, 1)
        outs.append(y)
    bz = dsp.bp(rr.standard_normal(n), 1400.0, 3200.0, 1) * breath
    e = adsr_env(n, gate, a, 0.3, 0.9, r) * vel
    return np.stack([(outs[0] + bz) * e, (outs[1] + bz) * e], axis=1)


@njit(cache=True, fastmath=True)
def _ks(exc, pint, ap_a, decay, damp, n):
    y = np.zeros(n)
    apx1 = 0.0
    apy1 = 0.0
    for i in range(n):
        v = exc[i] if i < exc.shape[0] else 0.0
        if i > pint + 1:
            s = (1.0 - damp) * y[i - pint] + damp * y[i - pint - 1]
            # first order allpass for fractional delay
            ap = ap_a * s + apx1 - ap_a * apy1
            apx1 = s
            apy1 = ap
            v += decay * ap
        y[i] = v
    return y


def pluck_ks(f, gate, vel=1.0, decay=0.996, damp=0.5, bright=0.6, rel=0.12, seed=11, dur=None, pick=0.2):
    """Karplus-Strong string (tuned with allpass fractional delay). returns mono."""
    dur = dur if dur is not None else (gate / SR + rel * 1.6)
    n = int(dur * SR) + 8
    tot = SR / f - damp                      # the (1-damp, damp) averaging filter adds `damp` samples of delay
    pint = int(math.floor(tot - 0.5))
    dap = tot - pint                         # allpass fractional delay in [0.5, 1.5)
    ap_a = (1.0 - dap) / (1.0 + dap)
    rr = np.random.default_rng(seed)
    m = max(pint, 8)
    exc = rr.uniform(-1, 1, m)
    exc = dsp.lp(exc, 1500.0 + 9000.0 * bright, 1)
    # pick position comb
    k = max(1, int(pick * m))
    exc2 = exc.copy()
    exc2[k:] -= exc[:-k]
    exc = exc2 - exc2.mean()
    exc = exc / (np.abs(exc).max() + 1e-9)
    y = _ks(np.ascontiguousarray(exc), pint, ap_a, decay, damp, n)
    y = y / (np.abs(y).max() + 1e-9)
    e = np.ones(n)
    if gate < n:
        e[gate:] = np.exp(-np.maximum(np.arange(n - gate), 0) / SR / max(rel / 4.0, 1e-4))
    kk = min(n, int(0.002 * SR))
    e[n - kk:] *= np.linspace(1, 0, kk)
    return y * e * vel


def epiano(f, gate, vel=1.0, tau=1.1, bright=0.6, rel=0.25, seed=13):
    """electric-piano / bell: harmonic partials (1,2,3,4,6) with faster decay for the upper ones + tine click. stereo."""
    n = tail_n(gate, rel) + int(tau * SR * 0.5)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k, (h, a, tk) in enumerate([(1, 1.0, 1.0), (2, 0.55, 0.6), (3, 0.28 * bright, 0.35), (4, 0.2 * bright, 0.25), (6, 0.1 * bright, 0.15)]):
        if f * h < 12000:
            y += a * np.sin(TAU * f * h * t + 0.7 * k) * np.exp(-t / (tau * tk))
    rr = np.random.default_rng(seed)
    y += 0.25 * bright * dsp.bp(rr.standard_normal(n), 2500.0, 6000.0, 1) * np.exp(-t / 0.012)
    e = np.ones(n)
    if gate < n:
        e[gate:] = np.exp(-np.maximum(t[gate:] - gate / SR, 0.0) / max(rel / 4.0, 1e-4))
    e *= np.minimum(t / 0.002, 1.0)
    kk = int(0.005 * SR)
    e[n - kk:] *= np.linspace(1, 0, kk)
    y = np.tanh(1.3 * y) * e * vel
    return np.stack([y, y], axis=1)


def tape_wow(x, depth_ms=0.35, cycles=21, flutter_ms=0.08, flutter_cycles=290, seed=3):
    """loop-safe tape wow/flutter: sinusoidal delay modulation with integer cycles per loop (circular interpolation)."""
    n = len(x)
    t = np.arange(n) / n
    d = (depth_ms * np.sin(TAU * cycles * t + 0.4) + flutter_ms * np.sin(TAU * flutter_cycles * t + 1.3)) * 1e-3 * SR
    idx = (np.arange(n) - d) % n
    i0 = np.floor(idx).astype(int)
    fr = idx - i0
    i1 = (i0 + 1) % n
    if x.ndim == 1:
        return x[i0] * (1 - fr) + x[i1] * fr
    return x[i0] * (1 - fr)[:, None] + x[i1] * fr[:, None]


# ======================================================================================================== drums
def _nz(r, n):
    return r.standard_normal(n)


def _tailfade(y, frac=0.22, min_s=0.006):
    """raised-cosine fade over the last `frac` of the sound (>= min_s): no truncation clicks on decaying samples."""
    y = y.copy()
    n = len(y)
    k = min(n, max(int(min_s * SR), int(frac * n)))
    w = 0.5 * (1.0 + np.cos(np.linspace(0.0, np.pi, k)))
    if y.ndim == 1:
        y[n - k:] *= w
    else:
        y[n - k:] *= w[:, None]
    return y


def make_kick(r, f0=180.0, f1=52.0, tp=0.022, tau=0.13, drive=2.2, click=0.45, dur=0.32, sub=0.0, hp_f=30.0):
    n = secs(dur)
    t = dsp.tt(n)
    f = f1 + (f0 - f1) * np.exp(-t / tp)
    body = np.sin(TAU * np.cumsum(f) / SR)
    endw = np.clip((dur - t) / (0.4 * dur), 0.0, 1.0) ** 2
    amp = np.exp(-t / tau) * np.minimum(t / 0.0007, 1.0) * endw
    y = np.tanh(drive * body * amp)
    if sub > 0:
        y += sub * np.sin(TAU * f1 * 0.5 * t) * np.exp(-t / (tau * 1.3)) * np.minimum(t / 0.004, 1.0)
    cl = dsp.hp(_nz(r, n), 1800.0, 2) * np.exp(-t / 0.0018) * np.minimum(t / 0.0002, 1.0)
    cl += 0.7 * np.sin(TAU * 1500.0 * t) * np.exp(-t / 0.0025)
    y = y + click * cl / (np.abs(cl).max() + 1e-9)
    y = dsp.hp(y, hp_f, 2)
    y = _tailfade(y)
    return y / (np.abs(y).max() + 1e-9)


def make_snare(r, tune=190.0, noise_lo=1300.0, noise_hi=9000.0, tau_n=0.085, tau_t=0.05, room=0.18, body=1.0, snap=0.6, dur=0.42):
    n = secs(dur)
    t = dsp.tt(n)
    fr = tune * (1.0 + 0.25 * np.exp(-t / 0.012))
    t1 = np.sin(TAU * np.cumsum(fr) / SR) * np.exp(-t / tau_t)
    t2 = np.sin(TAU * np.cumsum(fr * 1.74) / SR) * np.exp(-t / (tau_t * 0.7)) * 0.55
    nz = dsp.bp(_nz(r, n), noise_lo, noise_hi, 2) * np.exp(-t / tau_n)
    nz /= np.abs(nz).max() + 1e-9
    sn = dsp.hp(_nz(r, n), 4500.0, 1) * np.exp(-t / 0.005)
    sn /= np.abs(sn).max() + 1e-9
    y = body * (t1 + t2) * 0.7 + nz * 0.85 + snap * sn * 0.45
    y = np.tanh(1.5 * y) / 1.2
    if room > 0:
        ir = dsp.reverb_ir(0.22, r, lp_start=6000, lp_end=1500, hp_f=200.0)
        w = dsp.convolve(y, ir)[:n]
        y = y + room * w * math.sqrt(np.sum(y * y) / (np.sum(w * w) + 1e-12))
    y = _tailfade(y)
    return y / (np.abs(y).max() + 1e-9)


def make_clap(r, lo=850.0, hi=3400.0, tail=0.075, dur=0.30, spacing=(0.0, 0.0085, 0.0175, 0.0265)):
    n = secs(dur)
    t = dsp.tt(n)
    y = np.zeros(n)
    nz = dsp.bp(_nz(r, n), lo, hi, 2)
    for i, s in enumerate(spacing):
        k = secs(s)
        e = np.exp(-np.maximum(t - s, 0) / 0.0045) * (t >= s)
        y += nz * e * (1.0 if i < len(spacing) - 1 else 0.7)
    s = spacing[-1]
    y += dsp.bp(_nz(r, n), lo * 0.9, hi * 0.8, 2) * np.exp(-np.maximum(t - s, 0) / tail) * (t >= s) * 0.9
    y = np.tanh(1.4 * y) / 1.1
    y = _tailfade(y)
    return y / (np.abs(y).max() + 1e-9)


_HAT_F = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0])


def make_hat(r, open_=False, bright=1.0, dur=None, tau=None):
    tau = tau if tau is not None else (0.13 if open_ else 0.022)
    dur = dur if dur is not None else (0.45 if open_ else 0.14)
    n = secs(dur)
    t = dsp.tt(n)
    y = np.zeros(n)
    for f in _HAT_F * 1.9 * bright:
        y += dsp.pulse(f, n, 0.5, 0.0)
    y = dsp.hp(y, 6500.0, 2)
    y = dsp.bp(y, 6500.0, 15500.0, 1)
    y = y + 0.3 * dsp.hp(_nz(r, n), 9000.0, 2) * 0.6
    env = np.exp(-t / tau) * np.minimum(t / 0.0004, 1.0)
    y = y * env
    y = _tailfade(y)
    return y / (np.abs(y).max() + 1e-9)


def make_tom(r, f=110.0, tau=0.17, drop=1.7, dur=0.55, drive=1.6):
    n = secs(dur)
    t = dsp.tt(n)
    fr = f * (1.0 + (drop - 1.0) * np.exp(-t / 0.035))
    y = np.sin(TAU * np.cumsum(fr) / SR) * np.exp(-t / tau) * np.minimum(t / 0.0008, 1.0)
    y = np.tanh(drive * y)
    cl = dsp.bp(_nz(r, n), 900.0, 4500.0, 1) * np.exp(-t / 0.006) * 0.35
    y = y + cl
    y = _tailfade(y)
    return y / (np.abs(y).max() + 1e-9)


def make_crash(r, dur=2.6, tau=0.85, lo=3200.0):
    n = secs(dur)
    t = dsp.tt(n)
    outs = []
    for c in range(2):
        nz = _nz(r, n)
        y = dsp.hp(nz, lo, 2) * np.exp(-t / tau)
        y += 0.8 * dsp.bp(nz, 6000.0, 12000.0, 1) * np.exp(-t / (tau * 0.5))
        fc = 13000.0 - 8000.0 * (1 - np.exp(-t / 0.7))
        y = dsp.svf(y, fc, 0.7, "lp")
        y *= np.minimum(t / 0.0015, 1.0)
        outs.append(y)
    o = np.stack(outs, axis=1)
    o = _tailfade(o)
    return o / (np.abs(o).max() + 1e-9)


def make_riser(r, n, f0=300.0, f1=9000.0, q=2.2, curve=2.0, tone=None):
    t = np.arange(n) / SR
    u = np.arange(n) / n
    fc = f0 * (f1 / f0) ** (u ** 1.3)
    outs = []
    for c in range(2):
        nz = _nz(r, n)
        y = dsp.svf(nz, fc, q, "bp")
        outs.append(y * (u ** curve))
    o = np.stack(outs, axis=1)
    if tone is not None:
        f = tone[0] * (tone[1] / tone[0]) ** (u ** 1.5)
        tn = dsp.saw(f, n, 0.0)
        tn = dsp.svf(tn, np.minimum(f * 4.0, 9000.0), 1.2, "lp") * (u ** 2.5) * tone[2]
        o = o + tn[:, None]
    o = o / (np.abs(o).max() + 1e-9)
    o = _tailfade(o, frac=0.0, min_s=0.004)        # riser ends loud on purpose (the downbeat masks it): 4 ms fade only
    return o


def make_impact(r, f0=110.0, f1=28.0, dur=1.6, tau=0.35, noise=0.4):
    n = secs(dur)
    t = dsp.tt(n)
    fr = f1 + (f0 - f1) * np.exp(-t / 0.12)
    y = np.sin(TAU * np.cumsum(fr) / SR) * np.exp(-t / tau) * np.minimum(t / 0.001, 1.0)
    y = np.tanh(1.8 * y)
    nz = dsp.lp(_nz(r, n), 2200.0, 2) * np.exp(-t / 0.35) * noise
    y = y + nz
    y = _tailfade(y)
    return y / (np.abs(y).max() + 1e-9)


def make_shaker(r, tau=0.03, dur=0.15, lo=5500.0):
    n = secs(dur)
    t = dsp.tt(n)
    y = dsp.hp(_nz(r, n), lo, 2) * np.exp(-t / tau) * (1 - np.exp(-t / 0.004))
    y = _tailfade(y)
    return y / (np.abs(y).max() + 1e-9)


# diatonic (just) partial ratios for a tuned 'metal': root, fifth, octave, fourth+oct, minor-sixth+oct, 2 oct  (root=E: E B E A C E)
METAL_E = (1.0, 1.5, 2.0, 2.667, 3.2, 4.0)


def make_metal(r, f=380.0, ratios=(1.0, 2.76, 5.40, 8.93, 13.34), taus=(0.35, 0.22, 0.14, 0.08, 0.05), dur=0.9, click=0.5, drive=1.6):
    n = secs(dur)
    t = dsp.tt(n)
    fs = [f * x for x in ratios]
    y = dsp.modal(n, fs, taus, [1.0 / (1 + 0.5 * i) for i in range(len(fs))])
    y = np.tanh(drive * y)
    cl = dsp.bp(_nz(r, n), 2000.0, 9000.0, 1) * np.exp(-t / 0.004) * click
    y = y + cl
    y = _tailfade(y)
    return y / (np.abs(y).max() + 1e-9)


# ======================================================================================================== bus processing
def send_reverb(x, r, rt60=0.9, amount=0.15, lp_start=7000.0, lp_end=1500.0, hp_f=150.0, stereo_in=True):
    ir = dsp.reverb_ir(rt60, r, length=rt60 * 1.1, lp_start=lp_start, lp_end=lp_end, hp_f=hp_f, stereo=True)
    ir[:secs(0.006)] = 0.0
    wet = dsp.circ_reverb(x, ir, wet=1.0)
    return x + amount * wet


def bus(x, r, hp_f=None, lp_f=None, sat=None, comp=None, rev=None, delay=None, width=None, loop=True):
    """standard stem bus chain: hp/lp -> saturation -> compressor -> reverb send -> delay -> width.  circular."""
    if hp_f:
        x = dsp.hp(x, hp_f, 2, loop=loop)
    if lp_f:
        x = dsp.lp(x, lp_f, 2, loop=loop)
    if sat:
        x = saturate(x, sat)
    if comp:
        x = dsp.compress(x, *comp, loop=loop)
    if rev:
        x = send_reverb(x, r, **rev)
    if delay:
        x = dsp.delay_loop(x, **delay)
    if width is not None:
        m = (x[:, 0] + x[:, 1]) * 0.5
        s = (x[:, 0] - x[:, 1]) * 0.5 * width
        x = np.stack([m + s, m - s], axis=1)
    return x


def _tile3(a):
    return np.concatenate([a, a, a], axis=0)


def limiter_gain(side, ceiling_db=-1.9, look_ms=3.0, rel_ms=90.0):
    """circular look-ahead limiter gain (same method as dsp.limit but returns the gain curve)."""
    n = len(side)
    s3 = np.concatenate([side, side, side])
    c = dsp.db(ceiling_db)
    g = np.ones(len(s3))
    m = s3 > c
    g[m] = c / s3[m]
    L = max(int(look_ms * 1e-3 * SR), 2)
    L += L % 2
    gmin = ndi.minimum_filter1d(g, size=L + 1, origin=-(L // 2))
    gs = ndi.uniform_filter1d(gmin, size=L + 1, origin=L // 2)
    gs = np.minimum(gs, g)
    rel = math.exp(-1.0 / max(rel_ms * 1e-3 * SR, 1.0))
    gr = dsp._release(np.ascontiguousarray(gs), rel)
    return gr[n:2 * n]


_meter = None


def dbg(name, x):
    """print component loudness when MDEBUG=1 (dev aid)."""
    if os.environ.get("MDEBUG"):
        print(f"   [{name:8s}] lufs {lufs(x):6.1f}  peak {20 * math.log10(float(np.abs(x).max()) + 1e-12):6.1f} dB")


def save_parts(track, parts):
    """dev aid: MSAVE=<dir> dumps the component buses of a track as float32 npz."""
    d = os.environ.get("MSAVE")
    if d:
        os.makedirs(d, exist_ok=True)
        np.savez(os.path.join(d, f"{track}_parts.npz"), **{k: v.astype(np.float32) for k, v in parts.items()})


def lufs(x):
    global _meter
    import pyloudnorm as pyln
    if _meter is None:
        _meter = pyln.Meter(SR)
    return float(_meter.integrated_loudness(x))


def master(stems, gains, target_lufs=-14.0, ceiling_db=-1.9, look_ms=3.0, rel_ms=90.0, tol=0.03):
    """common static gains -> ONE limiter gain curve computed from max(|sum|, |each stem|) -> common makeup so the
    limited sum hits target_lufs.  Identical gain curve applied to every stem (stems still sum to the limited mix)."""
    pre = {k: stems[k] * gains.get(k, 1.0) for k in stems}
    keys = list(pre)
    s0 = sum(pre.values())

    def run(G):
        y = {k: pre[k] * G for k in keys}
        s = sum(y.values())
        side = np.abs(s).max(axis=1)
        for k in keys:
            side = np.maximum(side, np.abs(y[k]).max(axis=1))
        lg = limiter_gain(side, ceiling_db, look_ms, rel_ms)
        return y, s * lg[:, None], lg

    l0 = lufs(s0)
    lo, hi = target_lufs - l0 - 6.0, target_lufs - l0 + 14.0
    G = 10 ** (((lo + hi) / 2) / 20.0)
    for _ in range(18):
        mid = (lo + hi) / 2
        G = 10 ** (mid / 20.0)
        _, mix, lg = run(G)
        L = lufs(mix)
        if abs(L - target_lufs) < tol:
            break
        if L < target_lufs:
            lo = mid
        else:
            hi = mid
    y, mix, lg = run(G)
    out = {k: y[k] * lg[:, None] for k in keys}
    pk = float(np.abs(mix).max())
    info = dict(gain_db=round(20 * math.log10(G), 2), lufs=round(lufs(mix), 2), peak_db=round(20 * math.log10(pk), 2),
                gr_max_db=round(-20 * math.log10(lg.min()), 2), gr_mean_db=round(float(np.mean(-20 * np.log10(lg))), 2),
                gr_frac=round(float(np.mean(lg < 0.97)), 3),
                rms_db=round(20 * math.log10(float(np.sqrt(np.mean(mix ** 2)))), 2))
    info["crest_db"] = round(info["peak_db"] - info["rms_db"], 2)
    info["stem_lufs"] = {k: round(lufs(out[k]), 2) for k in keys}
    info["stem_peak_db"] = {k: round(20 * math.log10(float(np.abs(out[k]).max()) + 1e-12), 2) for k in keys}
    return out, info


# ======================================================================================================== caching
def _src_hash(files):
    h = hashlib.sha1()
    for f in files:
        with open(f, "rb") as fh:
            h.update(fh.read())
    return h.hexdigest()


def cached_stems(track, builder, srcs):
    """builder() -> (dict stem-> (N,2) array, info dict).  Cached at cache/<track>.npz keyed by source hashes, safe
    against parallel builders (lock file)."""
    os.makedirs(CACHE, exist_ok=True)
    key = _src_hash([os.path.join(HERE, s) for s in srcs])
    path = os.path.join(CACHE, f"{track}.npz")
    lock = path + ".lock"

    def load():
        if not os.path.exists(path):
            return None
        try:
            z = np.load(path)
            if str(z["__key"]) != key:
                return None
            st = {k: z[k].astype(np.float64) for k in z.files if not k.startswith("__")}
            info = json.loads(str(z["__info"]))
            return st, info
        except Exception:
            return None

    r = load()
    if r:
        return r
    t0 = time.time()
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            while os.path.exists(lock):
                time.sleep(0.5)
                r = load()
                if r:
                    return r
                try:
                    if time.time() - os.path.getmtime(lock) > 300:      # stale lock from a killed build
                        os.remove(lock)
                except OSError:
                    pass
    try:
        r = load()
        if r:
            return r
        st, info = builder()
        info = dict(info)
        info["render_s"] = round(time.time() - t0, 1)
        tmp = path + f".{os.getpid()}.tmp.npz"
        np.savez(tmp, __key=key, __info=json.dumps(info), **{k: v.astype(np.float32) for k, v in st.items()})
        os.replace(tmp, path)
        return {k: v.astype(np.float32).astype(np.float64) for k, v in st.items()}, info
    finally:
        os.close(fd)
        try:
            os.remove(lock)
        except OSError:
            pass
