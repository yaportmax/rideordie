"""g_stingers.py - event stingers and looping alert beds (stereo)."""
import math

import numpy as np

import dsp
import foley as fo
from dsp import SR, secs, tt
from foley import en, layers
from render import sound

G = "stingers"


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def _w(r, n):
    return r.standard_normal(n)


def unison(f, n, cents=(0, 9, -8, 17, -15), r=None, glide=None):
    y = np.zeros(n)
    for i, c in enumerate(cents):
        fr = (f if glide is None else glide) * 2 ** (c / 1200.0)
        y += dsp.saw(fr, n, ph0=(i * 0.173) % 1.0)
    return y / len(cents)


def brass(f, dur, att=0.06, rel=0.35, fc0=500, fc1=3200, peak=0.35, gain=1.0, drive=1.6):
    n = secs(dur + rel)
    t = tt(n)
    y = unison(f, n)
    u = np.clip(t / max(dur * peak, 1e-3), 0, 1)
    fc = fc0 + (fc1 - fc0) * np.sin(u * math.pi / 2) ** 2
    fc = np.where(t > dur * 0.7, fc1 * np.exp(-(t - dur * 0.7) / 0.4), fc)
    y = dsp.svf(y, np.maximum(fc, 300), 1.4, "lp")
    env = np.minimum(1, t / att) * np.where(t < dur, 1.0, np.exp(-(t - dur) / (rel * 0.35)))
    y = np.tanh(drive * y) * env
    return y * gain


def power_chord(root, dur, rel=0.5, drive=3.5, fc=2600, notes=(0, 7, 12, 19)):
    n = secs(dur + rel)
    t = tt(n)
    y = np.zeros(n)
    for k, iv in enumerate(notes):
        y += unison(midi(root + iv), n, cents=(0, 11, -9, 19, -17)) / (1 + 0.25 * k)
    y = np.tanh(drive * y)
    y = dsp.svf(y, fc, 0.9, "lp")
    env = np.minimum(1, t / 0.004) * np.where(t < dur, np.exp(-t / (dur * 1.6)), np.exp(-dur / (dur * 1.6)) * np.exp(-(t - dur) / (rel * 0.4)))
    return y * env


def kick(dur=0.45, f0=150, f1=44):
    n = secs(dur)
    y = np.tanh(1.8 * dsp.sweep(n, f0, f1, 0.035)) * dsp.ar_env(n, 0.001, 0.15)
    c = dsp.hp(np.random.default_rng(3).standard_normal(n), 2500, 1) * np.exp(-tt(n) / 0.002)
    return y + 0.15 * c / (np.abs(c).max() + 1e-9)


def tom(f0, dur=0.6):
    n = secs(dur)
    y = np.tanh(1.3 * dsp.sweep(n, f0 * 1.6, f0, 0.05)) * dsp.ar_env(n, 0.001, 0.18)
    nz = dsp.bp(np.random.default_rng(5).standard_normal(n), 200, 2200, 1) * dsp.ar_env(n, 0.0005, 0.03)
    return y + 0.3 * nz / (np.abs(nz).max() + 1e-9)


def snare(r, dur=0.4):
    n = secs(dur)
    t = tt(n)
    b = (np.sin(2 * math.pi * 190 * t) + 0.6 * np.sin(2 * math.pi * 330 * t)) * np.exp(-t / 0.05)
    nz = dsp.bp(_w(r, n), 1200, 7500, 1) * dsp.ar_env(n, 0.0005, 0.1)
    return en(b) * 0.45 + en(nz) * 0.9


def crash(r, dur=2.2, hi=True):
    n = secs(dur)
    t = tt(n)
    nz = dsp.hp(_w(r, n), 3000 if hi else 1500, 2)
    metal = np.zeros(n)
    for f in [2620, 3960, 5350, 7110, 9400]:
        metal += dsp.pulse(np.full(n, f * (1 + 0.003 * r.standard_normal())), n, 0.5) * 0.2
    metal = dsp.hp(metal, 2500, 1)
    env = np.exp(-t / (dur * 0.28)) * (1 - np.exp(-t / 0.002))
    return (en(nz) * 0.7 + en(metal) * 0.4) * env


def rev_cym(r, dur):
    n = secs(dur)
    t = tt(n)
    nz = dsp.hp(_w(r, n), 2200, 1)
    return nz * (t / dur) ** 2.2


def stereo_rev(x, r, rt60=1.2, wet=0.3, lp0=6000, lp1=900, pre=0.008):
    ir = dsp.reverb_ir(rt60, r, lp_start=lp0, lp_end=lp1, stereo=True, predelay=pre)
    w = dsp.convolve(x, ir)
    L = max(len(w), len(x))
    out = np.zeros((L, 2))
    out[:len(x), 0] += x
    out[:len(x), 1] += x
    out += w * (math.sqrt(wet * np.sum(x ** 2) / (np.sum(w ** 2) + 1e-12)) if wet > 0 else 0)
    return out


def widen(x, r, amount=0.5):
    """cheap stereo widening of a mono signal: short Haas delay + complementary tilt."""
    d = secs(0.011)
    L = x.copy()
    R = np.concatenate([np.zeros(d), x[:-d]]) if d < len(x) else x
    return np.stack([L * (1 - 0.3 * amount) + R * 0.3 * amount, R * (1 - 0.3 * amount) + L * 0.3 * amount], axis=1)


def _mix(items, dur):
    """items: (start_s, signal, energy_fraction) -> energy-balanced sum (fractions are energy shares)."""
    return fo.layers([(x, f, t) for t, x, f in items], dur)


def reg(name, rel, notes, loop=False, **kw):
    def deco(fn):
        sound(G, name, n=1, ch=2, category=("stinger_loop" if loop else "stinger"), rel_db=rel, notes=notes, loop=loop, **kw)(fn)
        return fn
    return deco


@reg("run_start", 0, "run begins: 1.2 s riser (tom roll + swell) then A-minor power-chord impact; ~4 s total")
def run_start(v, r):
    dur = 3.4
    hit = 1.25
    items = []
    items.append((0.0, rev_cym(r, hit + 0.02), 0.06))
    f = np.geomspace(110, 440, secs(hit))
    sw = dsp.svf(unison(f, secs(hit), glide=f), np.geomspace(500, 4500, secs(hit)), 1.2, "lp") * (np.linspace(0, 1, secs(hit)) ** 1.5)
    items.append((0.0, sw, 0.06))
    for k, tt_ in enumerate([0.55, 0.75, 0.9, 1.0, 1.08, 1.15, 1.2]):
        items.append((tt_, tom(90 + 25 * k), 0.012 + 0.003 * k))
    items.append((hit, kick(), 0.10))
    items.append((hit, snare(r, 0.4), 0.06))
    items.append((hit, crash(r, 2.0), 0.16))
    items.append((hit, power_chord(45, 0.9, 1.0), 0.24))          # A2 power chord
    items.append((hit, power_chord(57, 0.9, 1.0, notes=(0, 7, 12)), 0.09))
    mono = _mix(items, dur)
    mono = dsp.normalize_peak(mono, -3.0)
    out = stereo_rev(mono, r, 1.3, 0.22)
    out[:len(mono)] += widen(mono, r, 0.6) * 0.3
    out = dsp.trim_silence(out, -58, 0.05)
    return dsp.limit(dsp.normalize_peak(out, -1.6), -1.5, 2.0, 60.0)


@reg("game_over", 0, "car destroyed / run over: sub hit + tape-stop A-minor chord sinking, 3.8 s")
def game_over(v, r):
    dur = 4.0
    n = secs(dur)
    t = tt(n)
    sub = np.tanh(1.5 * dsp.sweep(n, 80, 30, 0.2)) * dsp.ar_env(n, 0.003, 0.7)
    burst = dsp.lp(_w(r, n), 1800, 2) * dsp.ar_env(n, 0.002, 0.25)
    # tape-stop chord: pitch ratio falls from 1 to 0.3
    ratio = 0.3 + 0.7 * np.exp(-np.maximum(t - 0.25, 0) / 0.9)
    chord = np.zeros(n)
    for m in (45, 57, 60, 64):      # A2 A3 C4 E4
        chord += unison(midi(m), n, glide=midi(m) * ratio) / 2
    chord = dsp.svf(chord, 250 + 2600 * np.exp(-np.maximum(t - 0.25, 0) / 0.8), 1.0, "lp")
    chord *= np.minimum(1, t / 0.02) * np.exp(-np.maximum(t - 0.25, 0) / 1.5) * (t > 0.0)
    # sinking motif
    motif = np.zeros(n)
    for k, m in enumerate((69, 67, 64, 60)):    # A4 G4 E4 C4
        b = brass(midi(m), 0.3, 0.02, 0.3, 500, 1800, 0.2, 1.0, 1.0)
        dsp.place(motif, b, secs(0.9 + 0.42 * k), 0.5 * (1 - 0.12 * k))
    mono = layers([(sub, 0.32, 0), (burst, 0.10, 0), (chord, 0.38, 0), (motif, 0.20, 0)], dur)
    out = stereo_rev(mono, r, 2.2, 0.5, 4000, 500)
    out = dsp.trim_silence(out, -58, 0.05)
    return dsp.limit(dsp.normalize_peak(out, -1.6), -1.5)


@reg("boss_intro", 0, "boss appears: drone + phrygian minor-second swell + tom hits + massive E hit, ~7 s")
def boss_intro(v, r):
    dur = 6.2
    n = secs(dur)
    t = tt(n)
    hit = 4.2
    drone = unison(midi(28), n, cents=(0, 12, -12)) + 0.6 * unison(midi(40), n, cents=(0, 15, -15))
    drone = dsp.svf(drone, 120 + 500 * np.clip(t / hit, 0, 1) ** 2, 1.0, "lp") * np.clip(t / 1.2, 0, 1) * np.where(t < hit, 1, np.exp(-(t - hit) / 1.2))
    swell = np.zeros(n)
    for m in (52, 53):      # E3 + F3 (phrygian b2 cluster)
        b_ = brass(midi(m), hit - 0.4, 2.0, 0.2, 350, 2800, 0.95, 1.0, 2.0)
        dsp.place(swell, b_, secs(0.4), 0.5)
    items = [(0.0, drone, 0.13), (0.0, swell, 0.13)]
    k = 0
    tp = 0.6
    while tp < hit - 0.05:
        items.append((tp, tom(70 if k % 4 else 62, 0.9), 0.012 + 0.03 * tp / hit))
        tp += 0.75 - 0.45 * tp / hit
        k += 1
    items.append((0.5, rev_cym(r, hit - 0.5), 0.05))
    items.append((hit, kick(0.6, 130, 36), 0.09))
    items.append((hit, crash(r, 2.6), 0.13))
    items.append((hit, power_chord(28, 1.4, 1.5, notes=(0, 7, 12, 13, 19)), 0.22))   # E1 with F: phrygian
    items.append((hit, power_chord(40, 1.4, 1.5, notes=(0, 7, 12)), 0.10))
    mono = _mix(items, dur)
    mono = dsp.normalize_peak(mono, -3.0)
    out = stereo_rev(mono, r, 2.4, 0.4, 5000, 600)
    out = dsp.trim_silence(out, -58, 0.05)
    return dsp.limit(dsp.normalize_peak(out, -1.6), -1.5)


@reg("boss_defeated", 0, "boss dies: huge boom then rising A-minor to A-major brass resolution, ~7 s")
def boss_defeated(v, r):
    from g_explosions import SIZES, explosion
    dur = 5.4
    boom = explosion(r, dict(SIZES["large"], dur=3.2, loud=3.0))
    items = [(0.0, boom, 0.34)]
    t0 = 0.7
    for m, d in [(57, 0.35), (60, 0.35), (64, 0.35), (69, 0.5)]:      # A3 C4 E4 A4 arpeggio up (minor)
        items.append((t0, brass(midi(m), d, 0.02, 0.25, 500, 3000, 0.4), 0.03))
        t0 += 0.3
    for m in (57, 61, 64, 69, 73):      # resolution to A major (C#)
        items.append((2.0, brass(midi(m), 1.6, 0.05, 1.0, 600, 3800, 0.3), 0.05))
    items.append((2.0, crash(r, 3.0), 0.10))
    items.append((2.0, kick(0.5, 140, 42), 0.06))
    items.append((2.0, fo.tinkle(r, 2.0, 40, 14, 3500, 11000), 0.08))
    mono = _mix(items, dur)
    mono = dsp.normalize_peak(mono, -3.0)
    out = stereo_rev(mono, r, 2.0, 0.35)
    out = dsp.trim_silence(out, -58, 0.05)
    return dsp.limit(dsp.normalize_peak(out, -1.6), -1.5)


@reg("victory", 0, "short heroic C-major fanfare (2.6 s stinger; full theme is music/victory)")
def victory(v, r):
    dur = 2.2
    items = []
    t0 = 0.0
    for m in (55, 60, 64, 67):          # G3 C4 E4 G4
        items.append((t0, brass(midi(m), 0.13, 0.01, 0.12, 800, 3400, 0.3, 1.0, 1.2), 0.04))
        t0 += 0.10
    tr = 0.15
    while tr < 0.55:
        items.append((tr, snare(r, 0.12), 0.012))
        tr += 0.055
    items.append((0.45, snare(r, 0.15), 0.03))
    ch = 0.55
    for m in (48, 60, 64, 67, 72, 76):   # C major
        items.append((ch, brass(midi(m), 1.0, 0.03, 0.5, 800, 4200, 0.25), 0.05))
    items.append((ch, crash(r, 1.6), 0.12))
    items.append((ch, kick(0.5, 140, 46), 0.06))
    for k, m in enumerate((84, 88, 91, 96)):
        items.append((ch + 0.05 + 0.08 * k, fo.ring([midi(m), midi(m) * 2.0], [0.3, 0.16], [1, 0.4], 0.6), 0.03))
    mono = _mix(items, dur)
    mono = dsp.normalize_peak(mono, -3.0)
    out = stereo_rev(mono, r, 1.0, 0.30)
    out = dsp.trim_silence(out, -46, 0.05)
    return dsp.limit(dsp.normalize_peak(out, -1.6), -1.5)


@reg("low_health_heartbeat_loop", -3, "heartbeat lub-dub-lub-dub at 60 BPM (2 beats, slight variation), seamless 2 s loop; loop while HP < 30 %, raise rate via playbackRate", loop=True,
     norm=("lufs", -21.0))
def heartbeat(v, r):
    L = secs(2.0)
    y = np.zeros(L)

    def beat(f0, f1, tau, level):
        n = secs(0.35)
        b = np.tanh(1.6 * dsp.sweep(n, f0, f1, 0.03)) * dsp.ar_env(n, 0.006, tau)
        nz = dsp.lp(_w(r, n), 260, 2) * dsp.ar_env(n, 0.004, tau * 0.6)
        return (en(b) * 0.85 + en(nz) * 0.35) * level
    for k in range(2):
        t0 = k * 1.0
        j = 1.0 + 0.04 * (k)
        dsp.place_wrap(y, beat(95 * j, 52 * j, 0.07, 1.0 - 0.06 * k), secs(t0))
        dsp.place_wrap(y, beat(80 * j, 46 * j, 0.085, 0.7 - 0.05 * k), secs(t0 + 0.3))
    st = np.stack([y, y], axis=1)
    return st


@reg("warning_alarm_loop", -2, "two-tone electronic warning siren (960/720 Hz), seamless 1.2 s loop", loop=True, norm=("lufs", -22.0))
def warning_alarm(v, r):
    L = secs(1.2)
    n = L
    t = tt(n)
    seg = 0.3
    f = np.where((t // seg) % 2 == 0, 960.0, 720.0)
    s = dsp.pulse(f, n, 0.5)
    s = dsp.lp(s, 3200, 2) + 0.25 * np.sin(2 * math.pi * np.cumsum(f * 2) / SR)
    # per-tone envelope with tiny fades (no clicks at seam)
    ph = (t % seg) / seg
    env = np.minimum(1, ph / 0.02) * np.minimum(1, (1 - ph) / 0.03)
    s = s * env
    s = np.tanh(1.3 * s)
    return np.stack([s, s], axis=1)


@reg("danger_riser", -1, "3 s tension riser (noise sweep + rising tone + accelerating tremolo); ends at peak, cut it with a hit", norm=("peak", -1.5))
def danger_riser(v, r):
    dur = 3.0
    n = secs(dur)
    t = tt(n)
    u = t / dur
    fc = 300 * (9000 / 300) ** u
    nz = dsp.svf(_w(r, n), fc, 1.4, "bp")
    trem_f = 4 + 16 * u ** 1.5
    trem = 0.6 + 0.4 * np.sin(2 * math.pi * np.cumsum(trem_f) / SR)
    tone = unison(110 * (1 + 3.0 * u ** 1.6), n, glide=110 * (1 + 3.0 * u ** 1.6))
    tone = dsp.svf(tone, 400 + 3500 * u, 1.2, "lp")
    y = (en(nz) * 0.9 * trem + en(tone) * 0.6) * (u ** 1.7)
    y = np.tanh(1.5 * y)
    L = y * 1.0
    st = np.stack([L, L], axis=1)
    return dsp.fade(st, 0.0, 0.03)
