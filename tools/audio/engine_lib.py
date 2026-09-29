"""engine_lib.py - physically-flavoured engine synthesis.

Model: per-cylinder combustion/exhaust pressure pulses (crank-angle-scaled) -> per-bank exhaust pipe (feedback comb with
damped reflection = open/closed tube resonances) -> body/exhaust formant resonators -> rasp waveshaper -> muffler
low-pass, plus intake noise, valvetrain ticks, combustion knock and optional supercharger / turbo whine.
Loops are periodic by construction: exactly N engine cycles fit in L samples; all filtering runs on 3x tiled material.
"""
import math

import numpy as np
from numba import njit

import dsp
from dsp import SR, secs, tt


# firing layouts: bank per slot (slot = 720/ncyl degrees apart, one 4-stroke cycle) --------------------------
LAYOUTS = {
    "I4": dict(n=4, banks=[0, 0, 0, 0]),
    "I6": dict(n=6, banks=[0, 0, 0, 0, 0, 0]),
    "F4": dict(n=4, banks=[0, 1, 0, 1]),                       # boxer (two banks)
    "V8x": dict(n=8, banks=[0, 1, 1, 0, 1, 0, 0, 1]),          # cross-plane 1-8-4-3-6-5-7-2
    "V12": dict(n=12, banks=[0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]),
}


@njit(cache=True, fastmath=True)
def _pipe(x, D, g, damp):
    """y[n] = x[n] - g * lp(y[n-D]);  odd-harmonic tube resonance with frequency dependent loss."""
    n = x.shape[0]
    y = np.zeros(n)
    lpst = 0.0
    for i in range(n):
        fb = 0.0
        if i >= D:
            v = y[i - D]
            lpst = damp * lpst + (1.0 - damp) * v
            fb = lpst
        y[i] = x[i] - g * fb
    return y


def pipe(x, D, g, damp, loop=True):
    x = np.ascontiguousarray(x, dtype=np.float64)
    n = len(x)
    if loop:
        return _pipe(np.concatenate([x, x, x]), int(D), float(g), float(damp))[n:2 * n]
    return _pipe(x, int(D), float(g), float(damp))


def _alpha_pulse(n, t0, tau_a, tau_d):
    """analytic pulse (1-exp(-t/ta))*exp(-t/td) sampled at integer samples for start time t0 (samples, float)."""
    t = (np.arange(n) - t0) / SR
    p = np.where(t > 0, (1 - np.exp(-np.maximum(t, 0) / tau_a)) * np.exp(-np.maximum(t, 0) / tau_d), 0.0)
    return p


def render_pulses(L, times, amps, banks, nbanks, tau_a, tau_d, loop=True):
    """Return list of nbanks arrays (length L) with the summed pulses. times in samples (float)."""
    out = [np.zeros(L) for _ in range(nbanks)]
    W = int(tau_d * SR * 9) + 4
    for t0, a, b in zip(times, amps, banks):
        td = tau_d[b] if isinstance(tau_d, (list, np.ndarray)) else tau_d
        s = int(math.floor(t0))
        idx = np.arange(s, s + W)
        tloc = (idx - t0) / SR
        p = np.where(tloc > 0, (1 - np.exp(-np.maximum(tloc, 0) / tau_a)) * np.exp(-np.maximum(tloc, 0) / td), 0.0)
        if loop:
            out[b][idx % L] += p * a
        else:
            ok = (idx >= 0) & (idx < L)
            out[b][idx[ok]] += p[ok] * a
    return out


def build_engine(name, rpm, P, r, L=None, dur=2.4, times=None, amps=None, banks_seq=None, loop=True, fire_hz_out=None):
    """Synthesise one engine loop (or dynamic rendering when times given). Returns float array (mono).

    P keys: layout, kd (pulse decay as fraction of fire period), click, pipe=[(len_m, g, damp)], res=[(f, q, gain)],
            muff, rasp, intake, mech, mech_rate (ticks per engine rev), knock, body=[(f, dB, q)], var (cycle amp variation),
            slot_amp (per-slot amplitude array), waver (relative rpm waver depth), lope (dict), whine (dict)
    """
    lay = LAYOUTS[P["layout"]]
    ncyl = lay["n"]
    nb = max(lay["banks"]) + 1
    if loop:
        Tc = 120.0 / rpm
        N = max(1, int(round(dur / Tc)))
        L = int(round(N * Tc * SR))
        Tc_s = L / N            # samples per 4-stroke cycle (exact)
        slots = np.arange(ncyl) / ncyl * Tc_s
        tk, ak, bk = [], [], []
        sa = P.get("slot_amp", np.ones(ncyl))
        lope = P.get("lope")
        for c in range(N):
            for j in range(ncyl):
                a = sa[j] * (1 + P.get("var", 0.05) * r.standard_normal())
                if lope:
                    pat = lope["pattern"]
                    a *= pat[(c * ncyl + j) % len(pat)]
                    if lope.get("miss", 0) and r.random() < lope["miss"]:
                        a *= 0.25
                tj = P.get("tjit", 0.004) * Tc_s / ncyl * r.standard_normal()
                tk.append(c * Tc_s + slots[j] + tj)
                ak.append(a)
                bk.append(lay["banks"][j])
        tk = np.array(tk)
        # slow rpm waver (periodic): warp times
        wv = P.get("waver", 0.0)
        if wv:
            m = P.get("waver_cycles", 3)
            tk = tk + wv * Tc_s * np.sin(2 * math.pi * m * tk / L + r.uniform(0, 6.28)) * 0.5
        ak = np.array(ak)
        bk = np.array(bk)
        f_fire = rpm / 60.0 * ncyl / 2.0
    else:
        tk, ak, bk = np.asarray(times, float), np.asarray(amps, float), np.asarray(banks_seq, int)
        f_fire = rpm / 60.0 * ncyl / 2.0
    Tf = 1.0 / f_fire
    tau_d = max(P["kd"] * Tf, 0.00035)
    tau_a = tau_d * 0.18
    pulses = render_pulses(L, tk, ak, bk, nb, tau_a, tau_d, loop)
    # exhaust pipes per bank
    banked = []
    for b in range(nb):
        ln, g, damp = P["pipe"][b % len(P["pipe"])]
        D = int(round(SR * 2.0 * ln / 343.0))
        y = pipe(pulses[b], D, g, damp, loop=loop)
        banked.append(y)
    y = sum(banked)
    y = y / (dsp.rms(y) + 1e-9)
    # body / exhaust formants
    acc = y * P.get("dry", 0.55)
    for f, q, gn in P["res"]:
        acc = acc + gn * dsp.svf(y, f, q, "bp", loop=loop)
    y = acc / (dsp.rms(acc) + 1e-9)
    # rasp (waveshaping) with slight asymmetry
    y = np.tanh(P["rasp"] * y + P.get("bias", 0.15)) - math.tanh(P.get("bias", 0.15))
    y = y / (dsp.rms(y) + 1e-9)
    y = dsp.lp(y, P["muff"], 2, loop=loop)
    y = y / (dsp.rms(y) + 1e-9)
    # combustion crackle / knock: HF burst on every firing pulse
    if P.get("click", 0) > 0 or P.get("knock", 0) > 0:
        cl = np.zeros(L)
        clk_tpl_n = secs(0.006)
        nz = r.standard_normal(clk_tpl_n)
        kb = dsp.bp(nz, P.get("click_bp", (1200, 5000))[0], P.get("click_bp", (1200, 5000))[1], 1) * np.exp(-np.arange(clk_tpl_n) / (SR * 0.0011))
        kb /= np.abs(kb).max() + 1e-9
        kn = 0.0
        for t0, a in zip(tk, ak):
            s = int(round(t0))
            idx = (np.arange(clk_tpl_n) + s)
            if loop:
                cl[idx % L] += kb * a * P.get("click", 0)
            else:
                ok = idx < L
                cl[idx[ok]] += kb[ok] * a * P.get("click", 0)
        if P.get("knock", 0) > 0:
            # diesel knock: low thump pinged at combustion
            kt = secs(0.012)
            tk_tpl = np.sin(2 * math.pi * P.get("knock_f", 160) * np.arange(kt) / SR) * np.exp(-np.arange(kt) / (SR * 0.004))
            for t0, a in zip(tk, ak):
                s = int(round(t0))
                idx = np.arange(kt) + s
                if loop:
                    cl[idx % L] += tk_tpl * a * P["knock"]
                else:
                    ok = idx < L
                    cl[idx[ok]] += tk_tpl[ok] * a * P["knock"]
        cl = dsp.hp(cl, 700, 1, loop=loop) if P.get("click", 0) > 0 and not P.get("knock", 0) else cl
        y = y + cl / (dsp.rms(cl) + 1e-9) * P.get("click_mix", 0.25) if dsp.rms(cl) > 1e-9 else y
    # intake noise (bandlimited, firing-synchronous swell)
    if P.get("intake", 0) > 0:
        nz = dsp.noise(L, r, 0.0) if loop else r.standard_normal(L)
        ifc = P.get("intake_f", (300, 1400))
        nz = dsp.bp(nz, ifc[0], ifc[1], 1, loop=loop)
        env = np.zeros(L)
        gw = secs(0.35 * Tf) + 3
        gtpl = np.hanning(2 * gw)
        for t0, a in zip(tk, ak):
            s = int(round(t0)) - gw
            idx = np.arange(2 * gw) + s
            if loop:
                env[idx % L] += gtpl
            else:
                ok = (idx >= 0) & (idx < L)
                env[idx[ok]] += gtpl[ok]
        env = 0.4 + 0.6 * env / (env.max() + 1e-9)
        y = y + nz * env / (dsp.rms(nz * env) + 1e-9) * P["intake"]
    # valvetrain ticks / clatter (not firing-synchronous unless mech_rate given)
    if P.get("mech", 0) > 0:
        rate = P.get("mech_rate", 4.0) * rpm / 60.0    # ticks per second
        cl = np.zeros(L)
        nt = int(rate * L / SR)
        Tk = L / max(nt, 1)
        for k in range(nt):
            s = int(k * Tk + r.uniform(-0.2, 0.2) * Tk)
            f = r.uniform(*P.get("mech_bp", (2000, 6000)))
            m = secs(0.004)
            b = dsp.bp(r.standard_normal(m), f * 0.7, f * 1.3, 1) * np.exp(-np.arange(m) / (SR * 0.0009))
            idx = (np.arange(m) + s)
            a = r.uniform(0.4, 1.0)
            if loop:
                cl[idx % L] += b * a
            else:
                ok = idx < L
                cl[idx[ok]] += b[ok] * a
        y = y + cl / (dsp.rms(cl) + 1e-9) * P["mech"]
    # body EQ
    for f, gdb, q in P.get("body", []):
        y = dsp.peak_eq(y, f, gdb, q, loop=loop)
    # supercharger / turbo whine (tonal, quantised to loop bins)
    if P.get("whine"):
        w = P["whine"]
        f0 = w["k"] * rpm / 60.0
        if loop:
            f0 = round(f0 * L / SR) * SR / L
        tvec = np.arange(L) / SR
        wh = np.zeros(L)
        for h, ga in [(1, 1.0), (2, 0.45), (3, 0.25)]:
            fh = f0 * h
            if loop:
                fh = round(fh * L / SR) * SR / L
            if fh < 18000:
                wh += ga * np.sin(2 * math.pi * fh * tvec + r.uniform(0, 6.28))
        am_c = max(1, int(round(w.get("am", 7) * L / SR)))
        wh *= 1 + 0.15 * np.sin(2 * math.pi * am_c * tvec / (L / SR))
        y = y + wh / (dsp.rms(wh) + 1e-9) * w["gain"] * (0.25 + 0.75 * min(1.0, rpm / w.get("rpm_full", 6000)))
    y = y / (dsp.rms(y) + 1e-9)
    y = dsp.hp(y, 28, 1, loop=loop)
    # gentle compression to even the pulses
    y = dsp.compress(y, -12.0, 2.5, 2.0, 40.0, loop=loop) if P.get("comp", True) else y
    return y, L, f_fire
