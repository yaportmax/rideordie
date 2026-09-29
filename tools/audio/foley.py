"""foley.py - small physical-ish building blocks for mechanical / impact / debris sounds."""
import math

import numpy as np

import dsp
from dsp import SR, secs, tt


def _norm(x, peak=1.0):
    p = dsp.peak(x)
    return x * (peak / p) if p > 1e-12 else x


def thunk(r, f=120.0, tau=0.05, dur=None, noise=0.3, drop=1.6, attack=0.0008, ncut=4.0, tone=1.0):
    """Low body hit: pitch-dropped sine (weight `tone`) + lowpassed noise burst."""
    dur = dur or tau * 6
    n = secs(dur)
    body = dsp.sweep(n, f * drop, f, tau * 0.45) * dsp.ar_env(n, attack, tau) * tone
    nz = dsp.lp(dsp.white(n, r), f * ncut, 2) * dsp.ar_env(n, 0.0003, tau * 0.5) * noise
    return body + nz


def tick(r, f=3000.0, q=3.0, tau=0.004, dur=None, ring=0.0, ring_f=None, ring_tau=0.03):
    """Sharp click: bandpassed noise burst, optional metallic ring."""
    dur = dur or max(tau * 10, 0.03)
    n = secs(dur)
    nz = dsp.bpq(dsp.white(n, r), f, q) * dsp.ar_env(n, 0.00004, tau)
    nz = _norm(nz)
    if ring:
        nz = nz + dsp.modal(n, [ring_f or f * 1.5, (ring_f or f * 1.5) * 2.41], [ring_tau, ring_tau * 0.5], [ring, ring * 0.4])
    return nz


def ring(freqs, taus, amps, dur, jitter=0.0, r=None, att=0.00012):
    freqs = np.asarray(freqs, float)
    if jitter and r is not None:
        freqs = freqs * (1 + jitter * r.uniform(-1, 1, len(freqs)))
    n = secs(dur)
    y = dsp.modal(n, freqs, taus, amps)
    y = y * (1 - np.exp(-tt(n) / att))
    return y


def metal_modes(f0, r, k=6, tau=0.08, spread=0.02, ratios=None):
    """Inharmonic plate-like partials. returns freqs, taus, amps."""
    ratios = ratios or [1.0, 2.76, 5.40, 8.93, 13.34, 18.64, 24.5, 31.0]
    ratios = np.asarray(ratios[:k], float) * (1 + spread * r.uniform(-1, 1, k))
    freqs = f0 * ratios
    taus = tau / (1 + 0.55 * np.arange(k)) * r.uniform(0.8, 1.2, k)
    amps = 1.0 / (1 + 0.7 * np.arange(k)) * r.uniform(0.6, 1.0, k)
    keep = freqs < 19000
    return freqs[keep], taus[keep], amps[keep]


def metal_hit(r, f0=1200.0, tau=0.08, dur=None, k=6, click=0.5, spread=0.02, ratios=None):
    dur = dur or min(tau * 7, 1.5)
    fr, ta, am = metal_modes(f0, r, k, tau, spread, ratios)
    n = secs(dur)
    y = ring(fr, ta, am, dur)
    if click:
        c = dsp.hp(dsp.white(n, r), 2500, 1) * dsp.exp_env(n, 0.0006) * click
        y = y + c
    return y


def friction(r, dur, f0, f1, q=2.0, rough=0.7, shape=0.7, tex_fc=500.0, res=0.0, res_f=None):
    """Sliding friction: noise through a moving bandpass, amplitude-textured; bell velocity envelope."""
    n = secs(dur)
    u = np.linspace(0, 1, n)
    fc = f0 * (f1 / f0) ** u
    y = dsp.svf(dsp.white(n, r), fc, q, "bp")
    tex = dsp.lp(dsp.white(n, r), tex_fc, 1)
    tex = tex / (np.std(tex) + 1e-9)
    am = np.clip(1.0 + rough * tex, 0.0, None) ** 1.3
    env = np.sin(np.pi * np.clip(u, 0, 1)) ** shape
    env = env * (0.15 + 0.85 * np.clip(u * 12, 0, 1)) * np.clip((1 - u) * 12, 0, 1) ** 0.5
    y = y * am * env
    if res:
        y += dsp.svf(y, res_f or f0 * 1.3, 25.0, "bp") * res
    return _norm(y)


def rattle(r, dur, rate, f_lo, f_hi, tau=0.004, shape=None, q=3.0):
    """Poisson stream of small clicks (chain / belt / loose parts). rate = clicks per second."""
    n = secs(dur)
    y = np.zeros(n)
    t = 0.0
    while True:
        t += r.exponential(1.0 / rate)
        if t >= dur:
            break
        f = math.exp(r.uniform(math.log(f_lo), math.log(f_hi)))
        a = r.uniform(0.25, 1.0) ** 1.5
        if shape is not None:
            a *= float(shape(t / dur))
        c = tick(r, f, q, tau * r.uniform(0.7, 1.4), dur=tau * 9, ring=0.15, ring_f=f * r.uniform(1.3, 2.1), ring_tau=tau * 4)
        dsp.place(y, c, secs(t), a)
    return y


def whoosh(r, dur, f0, f1, q=1.1, peak=0.4, power=1.6, order=1.0):
    """Air whoosh: bandpassed noise with sweeping centre frequency and swelled amplitude."""
    n = secs(dur)
    u = np.linspace(0, 1, n)
    fc = f0 * (f1 / f0) ** u
    y = dsp.svf(dsp.white(n, r), fc, q, "bp")
    up = np.clip(u / max(peak, 1e-3), 0, 1) ** power
    down = np.clip((1 - u) / max(1 - peak, 1e-3), 0, 1) ** (power * 0.8)
    env = np.where(u < peak, up, down)
    return _norm(y * env)


def cloth(r, dur, level=1.0, f_lo=500, f_hi=5000, bursts=4):
    """Fabric / strap rustle."""
    n = secs(dur)
    y = dsp.bp(dsp.white(n, r), f_lo, f_hi, 1)
    am = np.zeros(n)
    for _ in range(bursts):
        c = r.uniform(0.05, 0.95) * dur
        w = r.uniform(0.02, 0.08)
        am += np.exp(-((tt(n) - c) / w) ** 2) * r.uniform(0.4, 1.0)
    tex = np.clip(1 + 0.9 * dsp.lp(dsp.white(n, r), 90, 1) * 6, 0, None)
    y = y * am * tex
    return _norm(y) * level


def spring(r, dur, f0=900.0, tau=0.12, wobble=0.02):
    """Twangy spring: closely spaced partials with slow detune beating."""
    n = secs(dur)
    ks = np.arange(1, 7)
    freqs = f0 * ks * (1 + 0.003 * r.uniform(-1, 1, len(ks)))
    y = np.zeros(n)
    t = tt(n)
    for f, k in zip(freqs, ks):
        y += np.sin(2 * math.pi * f * t * (1 + wobble * np.exp(-t / (tau * 0.5)) / k) + r.uniform(0, 6.28)) * np.exp(-t / (tau / (0.6 + 0.4 * k))) / k
    return _norm(y)


def mix(items, dur):
    """items: list of (t_seconds, signal, gain)."""
    y = np.zeros(secs(dur))
    for t, x, g in items:
        dsp.place(y, x, secs(t), g)
    return y


def room(x, r, rt60=0.25, wet=0.25, lp_start=5000, lp_end=900, taps=()):
    """Short room / outdoor smear; returns extended signal."""
    ir = dsp.reverb_ir(rt60, r, lp_start=lp_start, lp_end=lp_end, early=taps)
    ir[:secs(0.002)] = 0
    w = dsp.convolve(x, ir)
    out = np.zeros(len(w))
    out[:len(x)] += x
    out += w * wet * (dsp.rms(x) / (dsp.rms(w) + 1e-12)) * 0.5
    return out


# ------------------------------------------------------------------------------------- energy-balanced layering
def en(x):
    """Unit-energy normalisation."""
    return x / (math.sqrt(float(np.sum(x * x))) + 1e-12)


def layers(parts, dur=None):
    """parts: list of (signal, energy_fraction, start_seconds). Each layer is energy-normalised then scaled by
    sqrt(fraction), so fractions describe how the energy budget is split (peaky transients stay peaky)."""
    end = max(secs(t) + len(x) for x, f, t in parts)
    y = np.zeros(secs(dur) if dur else end)
    for x, f, t in parts:
        dsp.place(y, en(x), secs(t), math.sqrt(f))
    return y


def loud(x, amount_db=6.0, ceiling_db=-1.5, look_ms=0.8, rel_ms=35.0):
    """Loudness maximiser: normalise, boost, brick-wall limit -> more body vs transient."""
    x = dsp.normalize_peak(x, ceiling_db)
    return dsp.limit(x * dsp.db(amount_db), ceiling_db, look_ms, rel_ms)


def crunch(r, dur, f_lo=400, f_hi=3500, n_bursts=5, tau=0.02, ring_f=(600, 2400), ring=0.5, front=0.7):
    """Crushed-metal texture: irregular noise bursts (front-loaded) each with a damped metallic ring."""
    n = secs(dur)
    y = np.zeros(n)
    for i in range(n_bursts):
        u = (r.random() ** (1.0 / max(front, 0.2))) if front != 1 else r.random()
        t0 = u * dur * 0.85 if i else 0.0
        bl = tau * r.uniform(0.6, 1.8)
        m = secs(bl * 7)
        b = dsp.bp(r.standard_normal(m), f_lo * r.uniform(0.8, 1.3), f_hi * r.uniform(0.7, 1.2), 2) * dsp.ar_env(m, 0.0004, bl)
        rf = math.exp(r.uniform(math.log(ring_f[0]), math.log(ring_f[1])))
        b = en(b) + ring * en(ring_(rf, bl * 3, r, m))
        dsp.place(y, b, secs(t0), r.uniform(0.35, 1.0) * (1.0 if i == 0 else 0.8))
    return y


def ring_(f, tau, r, n):
    fr = f * np.array([1.0, 2.32, 3.9]) * (1 + 0.02 * r.uniform(-1, 1, 3))
    return dsp.modal(n, fr, [tau, tau * 0.6, tau * 0.35], [1.0, 0.5, 0.3])


def tinkle(r, dur, rate0=120.0, rate1=8.0, f_lo=3000.0, f_hi=9000.0, tau=(0.008, 0.03)):
    """Falling shards / glass debris: Poisson clicks with decreasing rate, each a small high ring."""
    n = secs(dur)
    y = np.zeros(n)
    t = 0.0
    while t < dur:
        u = t / dur
        rate = rate0 * (rate1 / rate0) ** u
        t += r.exponential(1.0 / rate)
        if t >= dur:
            break
        f = math.exp(r.uniform(math.log(f_lo), math.log(f_hi)))
        ta = r.uniform(*tau)
        m = secs(ta * 6)
        s = dsp.modal(m, [f, f * 1.47], [ta, ta * 0.5], [1.0, 0.4])
        s = s * (1 - np.exp(-tt(m) / 0.00008))
        dsp.place(y, s, secs(t), r.uniform(0.15, 1.0) * (1 - 0.5 * u))
    return y


def pebbles(r, dur, rate=90.0, f_lo=900, f_hi=4000, decay=1.0):
    """Granular spray / gravel."""
    n = secs(dur)
    y = np.zeros(n)
    t = 0.0
    while t < dur:
        t += r.exponential(1.0 / (rate * math.exp(-decay * t / dur)))
        if t >= dur:
            break
        f = math.exp(r.uniform(math.log(f_lo), math.log(f_hi)))
        c = tick(r, f, 2.0, 0.0012, dur=0.012)
        dsp.place(y, c, secs(t), r.uniform(0.2, 1.0) * math.exp(-1.5 * t / dur))
    return y


def plus(*xs):
    """Sum signals of different lengths (zero-padded to the longest)."""
    n = max(len(x) for x in xs)
    y = np.zeros(n)
    for x in xs:
        y[:len(x)] += x
    return y
