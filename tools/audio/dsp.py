"""dsp.py - core DSP toolkit for the RIDE OR DIE audio library (numpy / scipy / numba).

Conventions
  * SR = 44100, float64 internally, mono = shape (n,), stereo = shape (n, 2)
  * "loop=True" processing helpers tile the signal 3x, process, keep the middle third, so anything built
    from periodic noise + these helpers is (numerically) seamless when wrapped.
"""
import math
import zlib

import numpy as np
import scipy.fft as sfft
import scipy.ndimage as ndi
import scipy.signal as ss
from numba import njit

SR = 44100
NYQ = SR / 2.0
TAU = 2.0 * math.pi


# --------------------------------------------------------------------------------------- basics
def rng(name, salt=0):
    return np.random.default_rng(zlib.crc32(f"{name}:{salt}".encode()) & 0xFFFFFFFF)


def secs(t):
    return int(round(t * SR))


def tt(n, frac=0.0):
    return (np.arange(n) - frac) / SR


def db(x):
    return 10.0 ** (x / 20.0)


def to_db(x):
    return 20.0 * math.log10(max(float(x), 1e-12))


def rms(x):
    return math.sqrt(float(np.mean(np.square(x))) + 1e-24)


def peak(x):
    return float(np.max(np.abs(x))) if len(x) else 0.0


def mono(x):
    return x if x.ndim == 1 else x.mean(axis=1)


def pad_to(x, n):
    if len(x) >= n:
        return x[:n]
    shp = (n - len(x),) + x.shape[1:]
    return np.concatenate([x, np.zeros(shp)], axis=0)


def _tile3(a):
    return np.concatenate([a, a, a], axis=0)


def _mid(a, n):
    return a[n:2 * n]


# --------------------------------------------------------------------------------------- noise
def noise(n, r, beta=0.0, fmin=None, fmax=None):
    """Periodic (circular) noise of length n, power ~ 1/f^beta, unit RMS. Exactly loopable."""
    m = n // 2 + 1
    spec = r.standard_normal(m) + 1j * r.standard_normal(m)
    f = np.arange(m) * SR / n
    f[0] = f[1] if m > 1 else 1.0
    mag = f ** (-beta / 2.0)
    if fmin:
        mag = mag * (1.0 / (1.0 + (fmin / f) ** 4))
    if fmax:
        mag = mag * (1.0 / (1.0 + (f / fmax) ** 4))
    spec = spec * mag
    spec[0] = 0
    if n % 2 == 0:
        spec[-1] = spec[-1].real
    x = sfft.irfft(spec, n)
    return x / (np.sqrt(np.mean(x * x)) + 1e-20)


def white(n, r):
    return r.standard_normal(n)


# --------------------------------------------------------------------------------------- envelopes
def exp_env(n, tau, delay=0.0):
    t = tt(n) - delay
    e = np.exp(-np.maximum(t, 0.0) / max(tau, 1e-6))
    e[t < 0] = 0.0
    return e


def ar_env(n, attack, tau, curve=1.0):
    """attack: linear-ish ramp seconds (>=0.2ms), then exponential decay with time constant tau."""
    t = tt(n)
    a = np.clip(t / max(attack, 1e-5), 0, 1) ** curve
    d = np.exp(-np.maximum(t - attack, 0.0) / max(tau, 1e-6))
    return a * d


def adsr(n, a, d, s, r_start, r, dcurve=2.0):
    """sample-count based ADSR: a,d,r in seconds, s level, r_start = time when release begins."""
    t = tt(n)
    e = np.zeros(n)
    at = np.clip(t / max(a, 1e-5), 0, 1)
    dec = s + (1 - s) * np.exp(-np.maximum(t - a, 0) / max(d / dcurve, 1e-6))
    e = np.where(t < a, at, dec)
    rel = np.clip(1.0 - (t - r_start) / max(r, 1e-5), 0, 1) ** 2
    e = np.where(t > r_start, e * rel, e)
    return e


def fade(x, fin=0.0, fout=0.0):
    x = x.copy()
    n = len(x)
    if fin > 0:
        k = min(n, secs(fin))
        w = np.sin(np.linspace(0, math.pi / 2, k)) ** 2
        x[:k] = x[:k] * (w if x.ndim == 1 else w[:, None])
    if fout > 0:
        k = min(n, secs(fout))
        w = np.cos(np.linspace(0, math.pi / 2, k)) ** 2
        x[n - k:] = x[n - k:] * (w if x.ndim == 1 else w[:, None])
    return x


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


# --------------------------------------------------------------------------------------- filters
def _clipfc(fc):
    return np.clip(fc, 5.0, NYQ * 0.98)


def _sos(kind, fc, order):
    return ss.butter(order, _clipfc(np.asarray(fc, float)), btype=kind, fs=SR, output="sos")


def _filt(x, sos, loop):
    if loop:
        n = len(x)
        return _mid(ss.sosfilt(sos, _tile3(x), axis=0), n)
    return ss.sosfilt(sos, x, axis=0)


def lp(x, fc, order=2, loop=False):
    return _filt(x, _sos("lowpass", fc, order), loop)


def hp(x, fc, order=2, loop=False):
    return _filt(x, _sos("highpass", fc, order), loop)


def bp(x, lo, hi, order=2, loop=False):
    return _filt(x, _sos("bandpass", (lo, hi), order), loop)


def bpq(x, f0, q, order=2, loop=False):
    return bp(x, f0 * (1 - 0.5 / q), f0 * (1 + 0.5 / q), order, loop)


def notch(x, f0, q=8.0, loop=False):
    b, a = ss.iirnotch(min(f0, NYQ * 0.98), q, fs=SR)
    return _filt(x, ss.tf2sos(b, a), loop)


def peak_eq(x, f0, gain_db, q=1.0, loop=False):
    """RBJ peaking EQ."""
    A = 10 ** (gain_db / 40.0)
    w0 = TAU * min(f0, NYQ * 0.98) / SR
    al = math.sin(w0) / (2 * q)
    b = np.array([1 + al * A, -2 * math.cos(w0), 1 - al * A])
    a = np.array([1 + al / A, -2 * math.cos(w0), 1 - al / A])
    return _filt(x, ss.tf2sos(b / a[0], a / a[0]), loop)


def shelf(x, f0, gain_db, high=True, loop=False):
    """RBJ shelving (S=1)."""
    A = 10 ** (gain_db / 40.0)
    w0 = TAU * min(f0, NYQ * 0.98) / SR
    cw, sw = math.cos(w0), math.sin(w0)
    al = sw / 2 * math.sqrt(2)
    sq = 2 * math.sqrt(A) * al
    if high:
        b = np.array([A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sq)])
        a = np.array([(A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sq])
    else:
        b = np.array([A * ((A + 1) - (A - 1) * cw + sq), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sq)])
        a = np.array([(A + 1) + (A - 1) * cw + sq, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sq])
    return _filt(x, ss.tf2sos(b / a[0], a / a[0]), loop)


@njit(cache=True, fastmath=True)
def _svf(x, fc, q, mode, sr):
    n = x.shape[0]
    y = np.empty(n)
    ic1 = 0.0
    ic2 = 0.0
    for i in range(n):
        f = fc[i]
        if f > 0.48 * sr:
            f = 0.48 * sr
        if f < 5.0:
            f = 5.0
        g = math.tan(math.pi * f / sr)
        k = 1.0 / q[i]
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        if mode == 0:
            y[i] = v2
        elif mode == 1:
            y[i] = k * v1
        elif mode == 2:
            y[i] = x[i] - k * v1 - v2
        else:
            y[i] = x[i] - k * v1
    return y


_MODES = {"lp": 0, "bp": 1, "hp": 2, "notch": 3}


def svf(x, fc, q=0.707, mode="lp", loop=False):
    """Zavalishin TPT state-variable filter with per-sample cutoff (Hz) and Q. mono only."""
    x = np.ascontiguousarray(x, dtype=np.float64)
    n = len(x)
    fc = np.ascontiguousarray(np.broadcast_to(np.asarray(fc, float), (n,)), dtype=np.float64)
    q = np.ascontiguousarray(np.broadcast_to(np.asarray(q, float), (n,)), dtype=np.float64)
    if loop:
        y = _svf(_tile3(x), _tile3(fc), _tile3(q), _MODES[mode], float(SR))
        return _mid(y, n)
    return _svf(x, fc, q, _MODES[mode], float(SR))


def svf_st(x, fc, q=0.707, mode="lp", loop=False):
    if x.ndim == 1:
        return svf(x, fc, q, mode, loop)
    return np.stack([svf(x[:, c], fc, q, mode, loop) for c in range(x.shape[1])], axis=1)


@njit(cache=True, fastmath=True)
def _ladder(x, fc, res, drive, sr):
    """4-pole (Huovilainen-style, simplified) resonant lowpass with tanh nonlinearity."""
    n = x.shape[0]
    y = np.empty(n)
    s1 = 0.0
    s2 = 0.0
    s3 = 0.0
    s4 = 0.0
    for i in range(n):
        f = fc[i]
        if f > 0.42 * sr:
            f = 0.42 * sr
        if f < 20.0:
            f = 20.0
        g = 1.0 - math.exp(-2.0 * math.pi * f / sr)
        u = math.tanh(drive * x[i] - 4.0 * res[i] * s4)
        s1 += g * (u - s1)
        s2 += g * (s1 - s2)
        s3 += g * (s2 - s3)
        s4 += g * (s3 - s4)
        y[i] = s4
    return y


def ladder(x, fc, res=0.3, drive=1.0, loop=False):
    x = np.ascontiguousarray(x, dtype=np.float64)
    n = len(x)
    fc = np.ascontiguousarray(np.broadcast_to(np.asarray(fc, float), (n,)), dtype=np.float64)
    res = np.ascontiguousarray(np.broadcast_to(np.asarray(res, float), (n,)), dtype=np.float64)
    if loop:
        return _mid(_ladder(_tile3(x), _tile3(fc), _tile3(res), float(drive), float(SR)), n)
    return _ladder(x, fc, res, float(drive), float(SR))


def dc_block(x, fc=12.0):
    return hp(x, fc, 1)


# --------------------------------------------------------------------------------------- oscillators
@njit(cache=True, fastmath=True)
def _saw(freq, ph0, sr):
    n = freq.shape[0]
    out = np.empty(n)
    ph = ph0
    for i in range(n):
        dt = freq[i] / sr
        v = 2.0 * ph - 1.0
        if ph < dt:
            t = ph / dt
            v -= (t + t - t * t - 1.0)
        elif ph > 1.0 - dt:
            t = (ph - 1.0) / dt
            v -= (t * t + t + t + 1.0)
        out[i] = v
        ph += dt
        if ph >= 1.0:
            ph -= 1.0
    return out


def saw(freq, n=None, ph0=0.0):
    f = np.ascontiguousarray(np.broadcast_to(np.asarray(freq, float), (n,)) if n else np.asarray(freq, float), dtype=np.float64)
    return _saw(f, float(ph0), float(SR))


def pulse(freq, n=None, pw=0.5, ph0=0.0):
    f = np.ascontiguousarray(np.broadcast_to(np.asarray(freq, float), (n,)) if n else np.asarray(freq, float), dtype=np.float64)
    a = _saw(f, float(ph0), float(SR))
    b = _saw(f, float((ph0 + pw) % 1.0), float(SR))
    return (a - b) * 0.5 + 0.0


def tri(freq, n=None, ph0=0.0):
    f = np.broadcast_to(np.asarray(freq, float), (n,)) if n else np.asarray(freq, float)
    ph = (np.cumsum(f) / SR + ph0) % 1.0
    return 4.0 * np.abs(ph - 0.5) - 1.0


def sine(freq, n=None, ph0=0.0):
    f = np.broadcast_to(np.asarray(freq, float), (n,)) if n else np.asarray(freq, float)
    return np.sin(TAU * (np.cumsum(f) / SR + ph0))


def sweep(n, f0, f1, tau, ph0=0.0):
    """sine with exponential pitch glide f1 + (f0-f1)*exp(-t/tau)."""
    t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t / max(tau, 1e-6))
    return np.sin(TAU * (np.cumsum(f) / SR + ph0))


def glide(n, f0, f1, curve="exp"):
    """frequency array from f0 to f1 over n samples (log interpolation)."""
    u = np.linspace(0, 1, n)
    return f0 * (f1 / f0) ** u


def modal(n, freqs, taus, amps, phases=None, frac=0.0):
    """Sum of exponentially damped sinusoids (mode bank)."""
    t = tt(n, frac)[None, :]
    freqs = np.asarray(freqs, float)[:, None]
    taus = np.asarray(taus, float)[:, None]
    amps = np.asarray(amps, float)[:, None]
    ph = np.zeros_like(freqs) if phases is None else np.asarray(phases, float)[:, None]
    ok = (t >= 0)
    out = amps * np.exp(-np.maximum(t, 0) / taus) * np.sin(TAU * freqs * np.maximum(t, 0) + ph) * ok
    # anti-click: rise over 0.15 ms
    return out.sum(axis=0)


# --------------------------------------------------------------------------------------- nonlinearity / dynamics
def sat(x, drive=1.0):
    """tanh saturation normalised so small signals keep unity gain."""
    return np.tanh(x * drive) / max(drive, 1e-6) * (1.0 if drive < 1 else 1.0)


def softclip(x, ceiling=1.0):
    """smooth clipper: linear below ~0.6*ceiling, saturating to ceiling."""
    a = np.abs(x) / ceiling
    y = np.where(a < 0.6, a, 0.6 + 0.4 * np.tanh((a - 0.6) / 0.4))
    return np.sign(x) * y * ceiling


def fold(x, amount):
    y = x * amount
    return np.sin(np.clip(y, -math.pi / 2 * 6, math.pi / 2 * 6))


def asym_sat(x, drive=2.0, bias=0.2):
    y = np.tanh(drive * (x + bias)) - np.tanh(drive * bias)
    return y / (np.tanh(drive * (1 + bias)) - np.tanh(drive * bias) + 1e-9)


def bitcrush(x, bits=8, hold=1):
    q = 2.0 ** bits
    y = np.round(x * q) / q
    if hold > 1:
        y = np.repeat(y[::hold], hold)[: len(x)]
    return y


@njit(cache=True, fastmath=True)
def _comp(x, thr, ratio, att, rel, c):
    n = x.shape[0]
    y = np.empty_like(x)
    env = 0.0
    for i in range(n):
        a = 0.0
        for j in range(c):
            v = abs(x[i, j])
            if v > a:
                a = v
        if a > env:
            env = att * env + (1.0 - att) * a
        else:
            env = rel * env + (1.0 - rel) * a
        g = 1.0
        if env > thr:
            g = (thr / env) ** (1.0 - 1.0 / ratio)
        for j in range(c):
            y[i, j] = x[i, j] * g
    return y


def compress(x, thresh_db=-12.0, ratio=4.0, att_ms=5.0, rel_ms=80.0, makeup_db=0.0, loop=False):
    """feed-forward peak compressor (linked across channels)."""
    x2 = x.reshape(len(x), -1).astype(np.float64)
    n = len(x2)
    att = math.exp(-1.0 / max(att_ms * 1e-3 * SR, 1.0))
    rel = math.exp(-1.0 / max(rel_ms * 1e-3 * SR, 1.0))
    if loop:
        y = _mid(_comp(np.ascontiguousarray(_tile3(x2)), db(thresh_db), float(ratio), att, rel, x2.shape[1]), n)
    else:
        y = _comp(np.ascontiguousarray(x2), db(thresh_db), float(ratio), att, rel, x2.shape[1])
    y = y * db(makeup_db)
    return y.reshape(x.shape)


@njit(cache=True, fastmath=True)
def _release(g, rel):
    n = g.shape[0]
    out = np.empty(n)
    r = 1.0
    for i in range(n):
        r = rel * r + (1.0 - rel)
        if g[i] < r:
            r = g[i]
        out[i] = r
    return out


def limit(x, ceiling_db=-1.5, look_ms=2.5, rel_ms=60.0, loop=False):
    """Look-ahead brickwall-ish limiter (offline, zero latency)."""
    if loop:
        n = len(x)
        return _mid(limit(_tile3(x), ceiling_db, look_ms, rel_ms), n)
    c = db(ceiling_db)
    x2 = x.reshape(len(x), -1)
    side = np.max(np.abs(x2), axis=1)
    g = np.ones(len(x))
    m = side > c
    g[m] = c / side[m]
    L = max(int(look_ms * 1e-3 * SR), 2)
    L += L % 2
    gmin = ndi.minimum_filter1d(g, size=L + 1, origin=-(L // 2))  # forward window [i, i+L]
    gs = ndi.uniform_filter1d(gmin, size=L + 1, origin=L // 2)  # backward avg
    gs = np.minimum(gs, g)  # safety
    rel = math.exp(-1.0 / max(rel_ms * 1e-3 * SR, 1.0))
    gr = _release(np.ascontiguousarray(gs), rel)
    y = x * (gr if x.ndim == 1 else gr[:, None])
    return np.clip(y, -c, c)


def normalize_peak(x, peak_db=-1.5):
    p = peak(x)
    if p < 1e-9:
        return x
    return x * (db(peak_db) / p)


def trim_silence(x, thresh_db=-70.0, keep_tail=0.02):
    a = np.max(np.abs(x.reshape(len(x), -1)), axis=1)
    idx = np.nonzero(a > db(thresh_db) * max(a.max(), 1e-9))[0]
    if len(idx) == 0:
        return x
    end = min(len(x), idx[-1] + secs(keep_tail))
    return x[:end]


# --------------------------------------------------------------------------------------- resampling
def repitch(x, ratio):
    """Play-rate change: ratio 2.0 = octave up & half length."""
    from fractions import Fraction
    fr = Fraction(ratio).limit_denominator(400)
    return ss.resample_poly(x, fr.denominator, fr.numerator, axis=0)


def stretch_to(x, n):
    """Resample x (pitch changes) to exactly n samples."""
    return ss.resample(x, n, axis=0)


def fit(x, n):
    return pad_to(x, n)


# --------------------------------------------------------------------------------------- mixing
def place(buf, x, start, gain=1.0):
    """Add x into buf at integer sample start (crops both ends). Works for mono/stereo matching ndim."""
    s = int(start)
    if s >= len(buf):
        return buf
    a = max(0, -s)
    e = min(len(x), len(buf) - s)
    if e <= a:
        return buf
    buf[s + a: s + e] += x[a:e] * gain
    return buf


def place_wrap(buf, x, start, gain=1.0):
    """Circular add."""
    n = len(buf)
    s = int(start) % n
    L = len(x)
    if L > n:
        # fold long tails
        for k in range(0, L, n):
            place_wrap(buf, x[k:k + n], s + k, gain)
        return buf
    e = min(L, n - s)
    buf[s:s + e] += x[:e] * gain
    if e < L:
        buf[:L - e] += x[e:] * gain
    return buf


def pan_stereo(x, pan):
    """equal-power pan, pan in [-1,1]; returns (n,2)."""
    a = (pan + 1) * math.pi / 4
    return np.stack([x * math.cos(a), x * math.sin(a)], axis=1)


# --------------------------------------------------------------------------------------- reverb / echo
def reverb_ir(rt60, r, length=None, predelay=0.0, lp_start=8000.0, lp_end=1200.0, hp_f=60.0,
              early=(), early_gain=0.6, stereo=False, density_ramp=0.02):
    """Procedural diffuse IR: noise with exp decay (60 dB over rt60), progressive lowpass, optional early taps.
    early: iterable of (time_s, gain).  Returns mono (n,) or stereo (n,2). IR has no direct impulse."""
    length = length or rt60 * 1.15
    n = secs(length)

    def one():
        nz = r.standard_normal(n)
        t = tt(n)
        fc = lp_end + (lp_start - lp_end) * np.exp(-t / max(rt60 / 3.0, 1e-3))
        nz = svf(nz, fc, 0.6, "lp")
        nz = hp(nz, hp_f, 1)
        env = np.exp(-6.9078 * t / rt60) * np.clip(t / max(density_ramp, 1e-4), 0, 1)
        y = nz * env
        for (te, ge) in early:
            k = secs(te)
            if k < n:
                burst = lp(r.standard_normal(secs(0.004)) * np.hanning(secs(0.004)), 5000, 1)
                y[k:k + len(burst)] += burst * ge * 4.0
        return y

    if stereo:
        ir = np.stack([one(), one()], axis=1)
    else:
        ir = one()
    if predelay > 0:
        p = secs(predelay)
        ir = np.concatenate([np.zeros((p,) + ir.shape[1:]), ir], axis=0)
    e = np.sqrt(np.sum(np.square(ir)))
    return ir / (e + 1e-12)


def convolve(x, ir):
    """FFT convolve, returns len(x)+len(ir)-1 samples. mono x with mono ir; stereo ir gives stereo out."""
    if ir.ndim == 1:
        if x.ndim == 1:
            return ss.fftconvolve(x, ir)
        return np.stack([ss.fftconvolve(x[:, c], ir) for c in range(x.shape[1])], axis=1)
    xm = x if x.ndim == 1 else x.mean(axis=1)
    return np.stack([ss.fftconvolve(xm, ir[:, c]) for c in range(ir.shape[1])], axis=1)


def circ_reverb(x, ir, wet=0.3):
    """Circular convolution reverb (loop-safe). x: (n,) or (n,2); ir shorter than x is folded."""
    n = len(x)
    if ir.ndim == 1:
        ir = ir[:, None]
    L = len(ir)
    if L > n:
        ir = ir[:n]
    irp = np.zeros((n, ir.shape[1]))
    irp[:len(ir)] = ir
    IR = sfft.rfft(irp, axis=0)
    if x.ndim == 1:
        X = sfft.rfft(x)[:, None]
        if ir.shape[1] == 1:
            y = sfft.irfft(X * IR, n, axis=0)[:, 0]
            return x * (1 - wet) + y * wet
        y = sfft.irfft(X * IR, n, axis=0)
        return np.stack([x, x], axis=1) * (1 - wet) + y * wet
    X = sfft.rfft(x, axis=0)
    if IR.shape[1] == 1:
        IR = np.repeat(IR, x.shape[1], axis=1)
    y = sfft.irfft(X * IR, n, axis=0)
    return x * (1 - wet) + y * wet


def echo_taps(x, taps, lp_fc=4500.0, seed=None):
    """taps: list of (delay_s, gain). Each repeat is progressively lowpassed. Returns extended array (len + max delay)."""
    mx = max(t for t, _ in taps)
    out = np.zeros(len(x) + secs(mx) + 8)
    out[:len(x)] += x
    for i, (t, g) in enumerate(taps):
        y = lp(x, lp_fc / (1.0 + 0.35 * i), 1)
        place(out, y, secs(t), g)
    return out


def delay_loop(x, delay_s, feedback=0.4, mix=0.3, lp_fc=5000.0, hp_fc=150.0, stereo_pingpong=False):
    """Circular feedback delay (loop safe) using repeated circular shifts (approx. 8 repeats)."""
    n = len(x)
    d = secs(delay_s)
    if x.ndim == 1 and not stereo_pingpong:
        acc = np.zeros(n)
        cur = x
        for k in range(1, 9):
            cur = np.roll(cur, d) * feedback
            cur = lp(hp(cur, hp_fc, 1, loop=True), lp_fc, 1, loop=True)
            acc += cur
        return x + acc * mix
    xm = x if x.ndim == 1 else x.mean(axis=1)
    L = np.zeros(n)
    R = np.zeros(n)
    cur = xm
    for k in range(1, 9):
        cur = np.roll(cur, d) * feedback
        cur = lp(hp(cur, hp_fc, 1, loop=True), lp_fc, 1, loop=True)
        if k % 2:
            R += cur
        else:
            L += cur
    wet = np.stack([L, R], axis=1) * mix
    base = x if x.ndim == 2 else np.stack([x, x], axis=1)
    return base + wet


# --------------------------------------------------------------------------------------- sample I/O
def load_wav(path, target_sr=SR):
    import soundfile as sf
    x, sr = sf.read(path, dtype="float64", always_2d=True)
    x = x.mean(axis=1)
    if sr != target_sr:
        from fractions import Fraction
        fr = Fraction(target_sr, sr).limit_denominator(1000)
        x = ss.resample_poly(x, fr.numerator, fr.denominator)
    return x


# --------------------------------------------------------------------------------------- measurement helpers
def spectral_centroid(x):
    x = mono(x)
    if len(x) < 64:
        return 0.0
    X = np.abs(np.fft.rfft(x)) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return float((X * f).sum() / (X.sum() + 1e-12))


def loop_jump(x):
    """Ratio of wrap-around step to the 99.5th percentile of normal sample-to-sample steps. <=1 = indistinguishable
    from any interior step (seamless)."""
    x2 = x.reshape(len(x), -1)
    d = np.abs(np.diff(x2, axis=0))
    typ = np.percentile(d, 99.5, axis=0) + 1e-9
    jump = np.abs(x2[0] - x2[-1])
    return float(np.max(jump / typ))
