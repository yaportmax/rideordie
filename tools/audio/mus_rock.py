"""mus_rock.py - shared stem builders for the driving rock/electronic RUN tracks (base / drums / lead / extra).

Track modules (mus_run_a/b/c.py) supply data (progression, patterns, melodies, timbres); this module renders the layers with
the toolkit in music_lib.  Every builder returns a stereo (N,2) loop bus.
"""
import numpy as np

import dsp
import music_lib as M
from dsp import SR
from music_lib import put, parse_lane, parse_notes, mtof


def _p(defaults, over):
    d = dict(defaults)
    d.update(over or {})
    return d


def rel(s, r):
    """motif string relative to a chord root degree r -> absolute-degree note list."""
    return [(a, b, c + r) for a, b, c in parse_notes(s)]


# ------------------------------------------------------------------------------------------------------ bass + pad
BASS_OFF = {"R": 0, "r": 0, "O": 0, "o": 0, "F": 4, "f": -3, "b": -1, "D": -1, "U": 1, "3": 2, "4": 3}


def bass_stem(g, sc, prog, pats, opens, r, hum, duck_steps, lo=28, params=None, duck=(0.66, 0.05), bus=None):
    p = _p(dict(close=320.0, res=0.34, drive=3.6, sub=0.26, det=4.0, wave="saw", tau_f=0.075, gate=0.86, rel=0.045), params)
    buf = g.zeros()
    for bar in range(g.bars):
        root_deg = prog[bar]
        base = M.bass_root(sc, root_deg, lo)
        pat = pats[bar].replace(" ", "")
        toks = [(i, c) for i, c in enumerate(pat) if c != "-"]
        for k, (i, c) in enumerate(toks):
            if c == ".":
                continue
            j = toks[k + 1][0] if k + 1 < len(toks) else 16
            ln = j - i
            m = sc.midi(root_deg + BASS_OFF[c])
            while m < base - 6:
                m += 12
            while m >= base + 8:
                m -= 12
            if c in "Oo":
                m += 12
            if c == "f" and m > base:
                m -= 12
            s = bar * 16 + i
            short = c in "rof"
            gate = int(g.dur(s, ln) * (0.6 if short else p["gate"]))
            vel = (1.0 if i % 4 == 0 else 0.86 if i % 2 == 0 else 0.72) * hum.v()
            nt = M.bass_note(mtof(m), max(gate, 64), vel, open_=opens[bar], close=p["close"], tau_f=p["tau_f"], res=p["res"],
                             drive=p["drive"], sub=p["sub"], rel=p["rel"], det=p["det"], wave=p["wave"], seed=bar * 17 + i)
            put(buf, nt, g.t(s), 1.0, 0.0)
    buf = buf * M.duck_env(g, duck_steps, *duck)[:, None]
    b = _p(dict(hp_f=38, lp_f=6500, sat=1.3, comp=(-16.0, 3.0, 8.0, 120.0, 0.0)), bus)
    return M.bus(buf, r, **b)


def pad_stem(g, sc, prog, r, duck_steps, lift, params=None, lo=55, hi=70, vel=0.5, duck=(0.55, 0.06), bus=None, gate_bars=1):
    p = _p(dict(wave="saw", unison=5, det=13.0, spread=0.85, a=0.10, d=0.6, s=0.9, r=0.40, fc=1100.0, ftau=0.5, q=0.8), params)
    buf = g.zeros()
    prev = None
    bar = 0
    while bar < g.bars:
        pcs = [m % 12 for m in sc.triad(prog[bar])]
        vo = M.voice_lead(prev, pcs, lo, hi)
        prev = vo
        # hold across repeated chords
        nb = 1
        while gate_bars > 1 and bar + nb < g.bars and prog[bar + nb] == prog[bar] and nb < gate_bars:
            nb += 1
        for k, m in enumerate(vo):
            nt = M.synth_note(mtof(m), g.dur(bar * 16, 16 * nb), vel, wave=p["wave"], unison=p["unison"], det=p["det"],
                              spread=p["spread"], a=p["a"], d=p["d"], s=p["s"], r=p["r"], fc0=p["fc"] * lift[bar],
                              fc1=p["fc"] * lift[bar] * 0.82, ftau=p["ftau"], q=p["q"], seed=bar * 7 + k)
            put(buf, nt, g.t(bar * 16), 0.5)
        bar += nb
    buf = buf * M.duck_env(g, duck_steps, *duck)[:, None]
    b = _p(dict(hp_f=120, lp_f=5000, rev=dict(rt60=1.4, amount=0.22), width=1.3), bus)
    return M.bus(buf, r, **b)


# ------------------------------------------------------------------------------------------------------ drums
def drum_stem(g, r, lanes, kit=None, crashes=(), gains=None, bus=None, crest=10.5, open_hat_steps=2.5):
    k = _p(dict(kick=dict(f0=190, f1=56, tp=0.018, tau=0.075, drive=2.4, click=0.55, dur=0.36, hp_f=36.0),
                snare=dict(tune=188, room=0.16), clap=dict(), hat=dict(), hat_o=dict(),
                tom_h=(190.0, 0.10), tom_m=(140.0, 0.13), tom_l=(95.0, 0.18), crash=dict()), kit)
    gn = _p(dict(kick=1.0, snare=0.85, clap=0.5, hat_c=0.5, hat_o=0.45, tom_h=0.7, tom_m=0.7, tom_l=0.75, crash=0.42,
                 rim=0.5, ride=0.3, perc=0.5), gains)
    hd = M.Human(r, ms=0.0, vel=0.04)
    smp = dict(kick=M.make_kick(r, **k["kick"]), snare=M.make_snare(r, **k["snare"]), clap=M.make_clap(r, **k["clap"]),
               hat_c=M.make_hat(r, **k["hat"]), hat_o=M.make_hat(r, True, **k["hat_o"]),
               tom_h=M.make_tom(r, *k["tom_h"]), tom_m=M.make_tom(r, *k["tom_m"]), tom_l=M.make_tom(r, *k["tom_l"]))
    if "rim" in lanes:
        smp["rim"] = M.make_metal(r, f=1650.0, ratios=(1.0, 1.52, 2.4), taus=(0.03, 0.02, 0.012), dur=0.12, click=0.7)
    pans = dict(kick=0.0, snare=0.0, clap=0.05, hat_c=0.18, hat_o=-0.15, tom_h=-0.25, tom_m=0.0, tom_l=0.25, rim=-0.2)
    crash = M.make_crash(r, **k["crash"])
    buf = g.zeros()
    for bar in range(g.bars):
        for name, lane_list in lanes.items():
            if name == "hat_o":
                for i, v in parse_lane(lane_list[bar]):
                    oh = smp["hat_o"][:g.dur(bar * 16 + i, open_hat_steps)].copy()
                    kk = min(200, len(oh))
                    oh[-kk:] *= np.linspace(1, 0, kk)
                    put(buf, oh, g.t(bar * 16 + i), gn["hat_o"] * v, pans["hat_o"])
                continue
            for i, v in parse_lane(lane_list[bar]):
                put(buf, smp[name], g.t(bar * 16 + i), gn[name] * v * hd.v(), pans[name])
    for bar, v in crashes:
        put(buf, crash, g.t(bar * 16), gn["crash"] * v)
    b = _p(dict(hp_f=26, sat=1.5, comp=(-14.0, 3.0, 6.0, 90.0, 0.0)), bus)
    buf = M.bus(buf, r, **b)
    return M.soft_crest(buf, crest)


# ------------------------------------------------------------------------------------------------------ lead
def lead_stem(g, sc, r, hum, bars_notes, timbre_of, timbres, low_bars=(), counter=None, counter_bars=(), prog=None,
              bus=None, delay_steps=3, delay=None, low_gain=0.55, low_params=None, counter_params=None):
    lead = g.zeros()
    low = g.zeros()
    cnt = g.zeros()
    lp = _p(dict(wave="pulse", pw=0.35, unison=2, det=8.0, spread=0.4, a=0.006, d=0.2, s=0.7, r=0.10, fc0=3000.0, fc1=1300.0,
                 ftau=0.12, q=1.0, drive=1.6), low_params)
    cp = _p(dict(wave="pulse", pw=0.3, unison=2, det=6.0, spread=0.3, a=0.004, d=0.12, s=0.4, r=0.08, fc0=3800.0, fc1=1500.0,
                 ftau=0.09, q=1.4, drive=1.5), counter_params)
    for bar in range(g.bars):
        tp = timbres[timbre_of[bar]]
        for (st, ln, d) in bars_notes.get(bar, []):
            s = bar * 16 + st
            gate = int(g.dur(s, ln) * tp.get("gate", 0.94))
            vd = tp.get("vib", 0.0) if ln >= tp.get("vib_len", 4) else 0.0
            kw = {k: v for k, v in tp.items() if k not in ("gate", "vib", "vib_len", "vel")}
            nt = M.synth_note(mtof(sc.midi(d)), max(gate, 64), tp.get("vel", 0.8) * hum.v(), vib_depth=vd, seed=bar * 13 + int(st), **kw)
            put(lead, nt, g.t(s) + hum.t(s), 1.0)
            if bar in low_bars:
                nl = M.synth_note(mtof(sc.midi(d - 7)), max(gate, 64), 0.55 * hum.v(), seed=bar * 5 + int(st), **lp)
                put(low, nl, g.t(s), 1.0)
        if counter and bar in counter_bars:
            for (st, ln, d) in parse_notes(counter):
                s = bar * 16 + st
                nl = M.synth_note(mtof(sc.midi(prog[bar] - 7 + d)), max(int(g.dur(s, ln) * 0.8), 64), 0.6 * hum.v(),
                                  seed=bar * 3 + int(st), **cp)
                put(cnt, nl, g.t(s), 1.0)
    ds = g.sps * delay_steps / SR
    dl = _p(dict(delay_s=ds, feedback=0.36, mix=0.28, lp_fc=3800.0, hp_fc=250.0, stereo_pingpong=True), delay)
    bd = _p(dict(hp_f=180, lp_f=9000, sat=1.2, delay=dl, rev=dict(rt60=1.2, amount=0.16), comp=(-16.0, 2.5, 6.0, 110.0, 0.0)), bus)
    lead = M.bus(lead, r, **bd)
    lowb = M.bus(low + cnt, r, hp_f=150, lp_f=6000, sat=1.2, rev=dict(rt60=0.8, amount=0.1), comp=(-16.0, 2.5, 6.0, 110.0, 0.0))
    M.dbg("lead", lead)
    M.dbg("lowb", lowb)
    return lead + low_gain * lowb


# ------------------------------------------------------------------------------------------------------ extra layers
DEF_ARP_PAT = {"A": [0, 1, 2, 3, 2, 1, 2, 1], "B": [0, 2, 1, 3, 2, 3, 1, 2], "C": [3, 2, 1, 0, 1, 2, 3, 2],
               "D": [0, 3, 1, 3, 2, 3, 1, 3], "E": [0, 0, 1, 1, 2, 2, 3, 3], "F": [0, 1, 0, 2, 0, 3, 0, 2]}


def arp_stem(g, sc, prog, r, hum, duck_steps, codes, pats=None, lo=64, up_bars=(), params=None, delay_steps=3, delay=None,
             duck=(0.4, 0.05), bus=None, tones_fn=None):
    pats = pats or DEF_ARP_PAT
    p = _p(dict(wave="saw", unison=2, det=8.0, spread=0.5, a=0.002, d=0.12, s=0.05, r=0.09, fc0=7000.0, fc1=1400.0, ftau=0.055,
                q=2.2, drive=1.3, vel=0.75, ghost=0.55), params)
    buf = g.zeros()
    for bar in range(g.bars):
        code = codes[bar]
        if code is None:
            continue
        eighth = code.endswith("8")
        pat = pats[code[0]] * 2
        m0 = sc.midi(prog[bar])
        while m0 < lo:
            m0 += 12
        while m0 >= lo + 12:
            m0 -= 12
        r0 = sc.midi(prog[bar])
        tones = [m0, m0 + sc.midi(prog[bar] + 2) - r0, m0 + sc.midi(prog[bar] + 4) - r0, m0 + 12]
        if tones_fn:
            tones = tones_fn(bar, tones)
        if bar in up_bars:
            tones = [t + 12 if k >= 2 else t for k, t in enumerate(tones)]
        for i in range(16):
            if eighth and i % 2:
                continue
            m = tones[pat[(i // 2) % 8 if eighth else i % 8]]
            s = bar * 16 + i
            gate = int(g.dur(s, 2 if eighth else 1) * 0.85)
            kw = {k: v for k, v in p.items() if k not in ("vel", "ghost")}
            nt = M.synth_note(mtof(m), max(gate, 64), (p["ghost"] if i % 4 else p["vel"]) * hum.v(), seed=bar * 31 + i, **kw)
            pan = -0.55 if (i // (2 if eighth else 1)) % 2 == 0 else 0.55
            a_ = (pan + 1) * np.pi / 4
            put(buf, nt * np.array([np.cos(a_), np.sin(a_)]) * 1.41, g.t(s) + hum.t(s), 1.0)
    buf = buf * M.duck_env(g, duck_steps, *duck)[:, None]
    dl = _p(dict(delay_s=g.sps * delay_steps / SR, feedback=0.42, mix=0.34, lp_fc=4200.0, hp_fc=300.0, stereo_pingpong=True), delay)
    b = _p(dict(hp_f=250, sat=1.1, delay=dl, rev=dict(rt60=1.0, amount=0.15)), bus)
    return M.bus(buf, r, **b)


def power_stem(g, sc, prog, r, hum, duck_steps, modes, chug_steps=(0, 3, 6, 8, 11, 14), ring_steps=(0, 8), lo=40, gain=6.0,
               duck=(0.5, 0.055), bus=None, sustain_gain=5.0, oct_up=True, sus_vel=0.85):
    buf = g.zeros()
    for bar in range(g.bars):
        mode = modes[bar]
        if not mode:
            continue
        root = M.bass_root(sc, prog[bar], lo)
        if mode == "sus":
            nt = M.power_chord(root, g.dur(bar * 16, 15), sus_vel, palm=False, gain=sustain_gain, seed=bar, oct_up=oct_up)
            put(buf, nt, g.t(bar * 16), 1.0)
        else:
            steps = chug_steps if mode == "chug" else mode
            for st in steps:
                s = bar * 16 + st
                ring = st in ring_steps
                nt = M.power_chord(root, g.dur(s, 2 if ring else 1), (0.95 if ring else 0.75) * hum.v(), palm=not ring, gain=gain,
                                   seed=bar * 11 + st, oct_up=oct_up)
                put(buf, nt, g.t(s), 1.0)
    buf = buf * M.duck_env(g, duck_steps, *duck)[:, None]
    b = _p(dict(hp_f=100, lp_f=7000, comp=(-18.0, 3.0, 8.0, 100.0, 0.0), rev=dict(rt60=0.9, amount=0.12), width=1.2), bus)
    return M.bus(buf, r, **b)


def fx_stem(g, r, risers=(), rev_crash=(), impacts=(), riser_tone=(mtof(57), mtof(81), 0.25), riser_range=(250.0, 9500.0),
            impact_kw=None):
    fx = g.zeros()
    for start_bar, ln_bars in risers:
        nrs = g.dur(start_bar * 16, ln_bars * 16)
        put(fx, M.make_riser(r, nrs, riser_range[0], riser_range[1], 2.0, tone=riser_tone), g.t(start_bar * 16), 0.8)
    rc = M.make_crash(r, 1.8)[::-1].copy()
    for bar in rev_crash:
        put(fx, rc, g.t(bar * 16) - len(rc), 0.7)
    imp = M.make_impact(r, **(impact_kw or {}))
    for bar, v in impacts:
        put(fx, imp, g.t(bar * 16), 0.7 * v)
    return fx


def perc_stem(g, r, hum, shaker_bars=(), cow_bars=(), cow_steps=(0, 3, 6, 8, 11, 14), cow_f=820.0, tam_steps=(4, 12),
              shaker_gain=0.5, cow_gain=0.16):
    shaker = M.make_shaker(r)
    tam = M.make_shaker(r, tau=0.05, dur=0.2, lo=3500.0)
    buf = g.zeros()
    for bar in shaker_bars:
        for i in range(16):
            v = (0.5 if i % 4 == 2 else 0.22 if i % 2 == 0 else 0.3) * hum.v()
            put(buf, shaker, g.t(bar * 16 + i), shaker_gain * v, 0.3 if i % 2 else -0.3)
        for i in tam_steps:
            put(buf, tam, g.t(bar * 16 + i), 0.35, 0.4)
    cow = M.make_metal(r, f=cow_f, ratios=(1.0, 1.51, 2.02, 3.1), taus=(0.09, 0.06, 0.04, 0.03), dur=0.3, click=0.3)
    for bar in cow_bars:
        for st in cow_steps:
            put(buf, cow, g.t(bar * 16 + st), cow_gain * (1.0 if st % 8 == 0 else 0.7), -0.3)
    return M.bus(buf, r, hp_f=400, rev=dict(rt60=0.5, amount=0.1))


def finish(stems, rel_db, target=-14.0, ref=-20.0, ceiling=-2.0):
    m = {k: M.lufs(v) for k, v in stems.items()}
    gains = {k: 10 ** ((ref + rel_db[k] - m[k]) / 20.0) for k in stems}
    out, info = M.master(stems, gains, target_lufs=target, ceiling_db=ceiling)
    info["pre_stem_lufs"] = {k: round(v, 2) for k, v in m.items()}
    return out, info
