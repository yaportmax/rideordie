"""g_explosions.py - explosions, fire, shockwaves."""
import math

import numpy as np

import dsp
import foley as fo
import samples
from dsp import SR, secs, tt
from foley import en, layers, loud
from render import sound

G = "explosions"


def _w(r, n):
    return r.standard_normal(n)


def _sub(n, f0, f1, tp, ta, drive=1.6, attack=0.003):
    return np.tanh(drive * dsp.sweep(n, f0, f1, tp)) * dsp.ar_env(n, attack, ta)


def _rumble(r, n, fc0, fc1, tfc, ta, rise=0.05, am_depth=0.4, am_fc=11.0):
    t = tt(n)
    fc = fc1 + (fc0 - fc1) * np.exp(-t / tfc)
    y = dsp.svf(_w(r, n), fc, 0.7, "lp")
    y = dsp.svf(y, fc * 0.9, 0.7, "lp")
    am = 1 + am_depth * en(dsp.lp(_w(r, n), am_fc, 1))
    return y * np.clip(am, 0.1, 3.0) * dsp.ar_env(n, rise, ta, 0.8)


def _debris(r, dur, rate0, rate1, fmin=200, fmax=1400, gain_decay=1.5):
    n = secs(dur)
    y = np.zeros(n)
    t = 0.02
    while t < dur:
        u = t / dur
        t += r.exponential(1.0 / (rate0 * (rate1 / rate0) ** u))
        if t >= dur:
            break
        a = r.uniform(0.15, 1.0) * math.exp(-gain_decay * u)
        kind = r.random()
        if kind < 0.35:
            s = fo.metal_hit(r, r.uniform(fmin, fmax), r.uniform(0.03, 0.12), k=4, click=0.3, dur=0.3)
        elif kind < 0.7:
            s = fo.thunk(r, r.uniform(60, 200), r.uniform(0.02, 0.05), 0.15, noise=1.4, tone=0.3)
        else:
            s = fo.pebbles(r, 0.12, 200, 1000, 5000)
        dsp.place(y, s, secs(t), a)
    return y


def explosion(r, p):
    """Layered explosion: crack + swept blast noise + sub boom + debris + rolling rumble + canyon tail."""
    dur = p["dur"]
    n = secs(dur)
    t = tt(n)
    crack = fo.tick(r, p.get("crack_f", 2500), 0.8, p.get("crack_tau", 0.012), dur=0.12)
    crack2 = dsp.hp(_w(r, secs(0.02)), 2000, 1) * dsp.exp_env(secs(0.02), 0.0005)
    fc = p["blast_fc"][1] + (p["blast_fc"][0] - p["blast_fc"][1]) * np.exp(-t / p["blast_tfc"])
    blast = dsp.svf(_w(r, n), fc, 0.75, "lp") * dsp.ar_env(n, p.get("blast_att", 0.004), p["blast_tau"], 0.7)
    sub = _sub(n, p["sub"][0], p["sub"][1], p["sub"][2], p["sub"][3])
    rum = _rumble(r, n, p["rumble"][0], p["rumble"][1], p["rumble"][2], p["rumble"][3], p.get("rumble_rise", 0.06))
    deb = _debris(r, min(dur, p["debris"][0]), p["debris"][1], p["debris"][2], gain_decay=1.0)
    fr = p.get("frac", dict(crack=0.06, blast=0.26, sub=0.24, rumble=0.28, debris=0.08))
    parts = [(crack, fr["crack"] * 0.6, 0), (crack2, fr["crack"] * 0.4, 0), (blast, fr["blast"], 0), (sub, fr["sub"], 0),
             (rum, fr["rumble"], 0.01), (deb, fr["debris"], 0.03)]
    if "extra" in p:
        parts += p["extra"](r)
    if p.get("thunder", 0) > 0:
        th = samples.kenney("sfx100b/sfx100v2_thunder_01.ogg", ratio=p.get("thunder_ratio", 1.0) * r.uniform(0.92, 1.08),
                            length=min(dur, 4.5), fin=0.02, fout=0.4)
        parts.append((th, p["thunder"], 0.02))
    y = layers(parts, dur)
    y = np.tanh(y / (np.abs(y).max() + 1e-9) * p.get("drive", 2.2)) / np.tanh(p.get("drive", 2.2))
    # canyon echo + diffuse tail
    ir = dsp.reverb_ir(p["rt60"], r, lp_start=4200, lp_end=350, hp_f=35.0, early=p.get("echo", []), early_gain=1.0)
    ir[:secs(0.006)] = 0
    w = dsp.convolve(dsp.lp(y, 2500, 1), ir)
    w *= math.sqrt(p.get("wet", 0.6) * np.sum(y ** 2) / (np.sum(w ** 2) + 1e-12))
    out = np.zeros(max(len(w), n))
    out[:n] += y
    out[:len(w)] += w
    out = dsp.trim_silence(out, -64, 0.03)
    return loud(out, p.get("loud", 4.0))


SIZES = {
    "small": dict(dur=1.7, blast_fc=(7500, 450), blast_tfc=0.06, blast_tau=0.16, sub=(95, 42, 0.10, 0.22),
                  rumble=(700, 90, 0.35, 0.55), debris=(0.9, 14, 4), rt60=0.9, wet=0.6,
                  echo=[(0.22, 0.2), (0.5, 0.1)]),
    "medium": dict(dur=2.6, blast_fc=(7000, 350), blast_tfc=0.09, blast_tau=0.28, sub=(80, 34, 0.16, 0.45),
                   rumble=(650, 75, 0.6, 0.95), debris=(1.6, 13, 3), rt60=1.5, wet=0.7,
                   echo=[(0.25, 0.32), (0.55, 0.2), (0.95, 0.12)]),
    "large": dict(thunder=0.07, dur=3.8, blast_fc=(6500, 280), blast_tfc=0.13, blast_tau=0.45, sub=(68, 27, 0.24, 0.85),
                  rumble=(600, 60, 0.9, 1.5), debris=(2.4, 12, 2.5), rt60=2.2, wet=0.8,
                  echo=[(0.3, 0.34), (0.68, 0.24), (1.15, 0.16), (1.8, 0.1)]),
    "huge": dict(thunder=0.09, dur=6.5, blast_fc=(6000, 220), blast_tfc=0.2, blast_tau=0.75, sub=(58, 22, 0.35, 1.5),
                 rumble=(520, 48, 1.3, 2.4), debris=(4.0, 12, 2.0), rt60=3.4, wet=0.9,
                 echo=[(0.35, 0.36), (0.8, 0.26), (1.4, 0.18), (2.2, 0.12), (3.0, 0.07)], loud=5.0),
}


def _reg(name, n, cat, rel, notes, **kw):
    def deco(fn):
        sound(G, name, n=n, category=cat, rel_db=rel, notes=notes, **kw)(fn)
        return fn
    return deco


def _sized(size, tweak=None):
    def fn(v, r):
        p = dict(SIZES[size])
        j = 1 + 0.08 * (v - (1 if size != "huge" else 0))
        p["sub"] = (p["sub"][0] * j, p["sub"][1] * j, p["sub"][2], p["sub"][3])
        p["blast_fc"] = (p["blast_fc"][0] * j, p["blast_fc"][1], )
        if tweak:
            tweak(p, v)
        return explosion(r, p)
    return fn


_reg("explosion_small", 3, "explosion", -9, "small blast (barrel, light car), 1.7 s")(_sized("small"))
_reg("explosion_medium", 3, "explosion", -5, "medium blast (car explosion), 2.6 s")(_sized("medium"))
_reg("explosion_large", 2, "explosion", -2, "large blast (heavy vehicle, chain reaction), 3.8 s")(_sized("large"))
_reg("explosion_huge", 1, "explosion", 0, "boss / tanker mega explosion, 6.5 s; screen shake sync at ~0.0-0.6 s")(_sized("huge"))


def _shrapnel(r):
    """Metal fragments whining away: short downward glides."""
    parts = []
    for i in range(int(r.integers(4, 8))):
        d = r.uniform(0.15, 0.4)
        n = secs(d)
        t = tt(n)
        f0 = r.uniform(3500, 7000)
        f1 = f0 * r.uniform(0.3, 0.5)
        fc = f1 + (f0 - f1) * np.exp(-t / (d * 0.35))
        z = dsp.svf(_w(r, n), fc, 16.0, "bp") * dsp.ar_env(n, 0.002, d * 0.4)
        parts.append((z, 0.012, r.uniform(0.01, 0.12)))
    return parts


def _gren(p, v):
    p["extra"] = _shrapnel
    p["frac"] = dict(crack=0.12, blast=0.28, sub=0.14, rumble=0.22, debris=0.14)
    p["crack_f"] = 3200
    p["crack_tau"] = 0.008


_reg("grenade_explosion", 3, "explosion", -6, "frag grenade: sharp crack + shrapnel whine + short boom, ~1.9 s")(
    lambda v, r: explosion(r, dict(SIZES["small"], dur=1.9, sub=(88 * (1 + 0.06 * v), 40, 0.09, 0.3), blast_tau=0.2,
                                    rumble=(700, 85, 0.4, 0.7), rt60=1.1, wet=0.65, extra=_shrapnel,
                                    frac=dict(crack=0.14, blast=0.28, sub=0.14, rumble=0.22, debris=0.14),
                                    crack_f=3200, crack_tau=0.008)))


_reg("rocket_explosion", 2, "explosion", -3, "rocket / RPG impact: sharp bang then heavy boom, 2.8 s")(
    lambda v, r: explosion(r, dict(SIZES["medium"], dur=2.8, sub=(85 * (1 + 0.06 * v), 34, 0.13, 0.55), blast_tau=0.3,
                                    extra=_shrapnel, crack_f=2800, crack_tau=0.01,
                                    frac=dict(crack=0.10, blast=0.27, sub=0.20, rumble=0.25, debris=0.10))))


@_reg("fuel_ignite", 1, "explosion", -6, "fuel / fire whump: slow-attack low thump + flame roar, 1.6 s")
def fuel_ignite(v, r):
    dur = 1.7
    n = secs(dur)
    t = tt(n)
    sub = np.tanh(1.3 * dsp.sweep(n, 62, 40, 0.15)) * dsp.ar_env(n, 0.014, 0.28)
    fc = 500 + 2500 * np.exp(-t / 0.25)
    roar = dsp.svf(_w(r, n), fc, 0.9, "lp") * dsp.ar_env(n, 0.035, 0.42, 0.9)
    roar = dsp.hp(roar, 90, 1)
    whoosh = fo.whoosh(r, 0.6, 250, 1800, 0.9, 0.45, 1.2)
    crackle = fo.pebbles(r, 1.0, 60, 900, 5000, decay=1.2)
    y = layers([(sub, 0.35, 0), (roar, 0.40, 0), (whoosh, 0.12, 0.02), (crackle, 0.08, 0.2)], dur)
    ir = dsp.reverb_ir(0.8, r, lp_start=3000, lp_end=400)
    w = dsp.convolve(dsp.lp(y, 2000, 1), ir)
    w *= math.sqrt(0.4 * np.sum(y ** 2) / np.sum(w ** 2))
    out = np.zeros(len(w))
    out[:n] += y
    out += w
    return loud(dsp.trim_silence(out, -60, 0.03), 3)


@_reg("fire_loop", 1, "explosion_loop", -3, "burning car: roar + crackle, seamless 2.4 s loop (3D loop on wrecks)",
      loop=True, norm=("lufs", -20.0))
def fire_loop(v, r):
    n = secs(2.4)
    t = tt(n)
    roar = en(dsp.bp(dsp.noise(n, r, 1.0), 90, 1400, 2, loop=True))
    swell = 1 + 0.35 * np.sin(2 * math.pi * (5 / 2.4) * t + 1) + 0.25 * np.sin(2 * math.pi * (13 / 2.4) * t + 2) \
        + 0.25 * en(dsp.lp(dsp.noise(n, r, 0), 9, 1, loop=True))
    low = en(dsp.lp(dsp.noise(n, r, 1.5), 120, 2, loop=True))
    hiss = en(dsp.hp(dsp.noise(n, r, 0.5), 2500, 1, loop=True))
    crk = np.zeros(n)
    for _ in range(66):
        f = math.exp(r.uniform(math.log(700), math.log(5500)))
        dsp.place_wrap(crk, fo.tick(r, f, 1.6, r.uniform(0.0006, 0.003), dur=0.02), secs(r.uniform(0, 2.4)), r.uniform(0.2, 1.0) ** 2)
    for _ in range(9):
        dsp.place_wrap(crk, fo.thunk(r, r.uniform(90, 200), 0.012, 0.05, noise=1.5, tone=0.2), secs(r.uniform(0, 2.4)), r.uniform(0.5, 1.0))
    y = roar * np.clip(swell, 0.2, 2.5) * 0.9 + low * 0.55 + hiss * 0.18 + en(crk) * 0.75
    return np.tanh(y * 0.75)


@_reg("fire_crackle_loop", 1, "explosion_loop", -6, "crackling flames (quieter, more snaps), seamless 3.2 s loop",
      loop=True, norm=("lufs", -24.0))
def fire_crackle_loop(v, r):
    dur = 3.2
    n = secs(dur)
    roar = en(dsp.bp(dsp.noise(n, r, 1.0), 200, 2200, 2, loop=True)) * 0.35
    crk = np.zeros(n)
    for _ in range(120):
        f = math.exp(r.uniform(math.log(600), math.log(7000)))
        dsp.place_wrap(crk, fo.tick(r, f, 1.8, r.uniform(0.0005, 0.004), dur=0.03, ring=0.15, ring_f=f * 1.7, ring_tau=0.004),
                       secs(r.uniform(0, dur)), r.uniform(0.15, 1.0) ** 2)
    for _ in range(14):
        dsp.place_wrap(crk, fo.thunk(r, r.uniform(120, 260), 0.01, 0.05, noise=1.6, tone=0.15), secs(r.uniform(0, dur)), r.uniform(0.4, 1.0))
    y = en(crk) * 1.0 + roar * 0.9 + en(dsp.lp(dsp.noise(n, r, 1.5), 110, 2, loop=True)) * 0.25
    return np.tanh(y * 0.7)


@_reg("distant_explosion", 3, "explosion", -12, "far-away blast: muffled, delayed onset, long rumble (mono, non-directional)")
def distant_explosion(v, r):
    dur = [3.6, 4.2, 3.0][v]
    n = secs(dur)
    t = tt(n)
    p = dict(SIZES["medium"], thunder=0.22, thunder_ratio=0.9, dur=dur + 0.4, sub=(70, 30, 0.15, 0.8), rumble=(420, 55, 1.2, 1.9), rt60=2.6, wet=1.0,
             frac=dict(crack=0.02, blast=0.44, sub=0.12, rumble=0.36, debris=0.06), loud=2.0,
             echo=[(0.4, 0.35), (1.0, 0.25), (1.8, 0.15)])
    y = explosion(r, p)
    sub = dsp.lp(y, 100, 2)
    harm = dsp.hp(np.tanh(5.0 * sub / (np.abs(sub).max() + 1e-9)), 120, 2)        # small-speaker audible harmonics of the sub rumble
    y = dsp.lp(y, [1300, 1600, 1100][v], 2)
    y = y + harm * (np.abs(y).max() * 0.55)
    # soften the attack: 20 ms exponential smear
    sm = np.exp(-np.arange(secs(0.06)) / (0.018 * SR))
    y = np.convolve(y, sm / sm.sum())[:len(y)]
    y = np.concatenate([np.zeros(secs(0.05 + 0.03 * v)), y])
    return loud(y, 3)


@_reg("shockwave_sub", 1, "explosion", -8, "sub-bass thump for blast pressure wave; layer under big explosions / camera shake")
def shockwave_sub(v, r):
    dur = 1.0
    n = secs(dur)
    s1 = _sub(n, 68, 24, 0.12, 0.28, drive=1.8, attack=0.004)
    s2 = np.tanh(2.0 * dsp.sweep(n, 150, 60, 0.03)) * dsp.ar_env(n, 0.002, 0.05)
    air = dsp.lp(_w(r, n), 220, 2) * dsp.ar_env(n, 0.003, 0.09)
    y = layers([(s1, 0.62, 0), (s2, 0.20, 0), (air, 0.18, 0)], dur)
    harm = dsp.hp(np.tanh(5.0 * dsp.lp(y, 90, 2) / (np.abs(y).max() + 1e-9)), 110, 2)
    y = y + harm * np.abs(y).max() * 0.4
    return loud(dsp.trim_silence(y, -60, 0.05), 2)
