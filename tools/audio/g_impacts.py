"""g_impacts.py - bullet impacts, near-miss whizz, hit feedback, car crashes, debris."""
import math

import numpy as np

import dsp
import foley as fo
import samples
from dsp import SR, secs, tt
from foley import en, layers, loud
from render import sound

G = "impacts"


def _w(r, n):
    return r.standard_normal(n)


def rubber(name, ratio=1.0, gain=1.0, **kw):
    """rubberduck CC0 sample (OpenGameArt 'breaking/falling/hit' + '100 CC0 SFX' sets), path relative to sfx_src."""
    return samples.kenney(name, ratio, gain, **kw)


def reg(name, n, cat, rel, notes, loop=False, **kw):
    def deco(fn):
        sound(G, name, n=n, category=cat, rel_db=rel, notes=notes, loop=loop, **kw)(fn)
        return fn
    return deco


# ---------------------------------------------------------------------------------------------- bullets
@reg("bullet_metal", 5, "impact_bullet", 0, "bullet on car body / plate: tick + plate modes + dent; frequent, short")
def bullet_metal(v, r):
    f0 = [950, 1300, 1750, 2350, 1100][v] * r.uniform(0.96, 1.04)
    tk = fo.tick(r, 4200, 1.5, 0.0009, dur=0.012)
    plate = fo.metal_hit(r, f0, 0.032 + 0.005 * (v % 3), k=6, click=0.0, dur=0.2, spread=0.03)
    dent = fo.thunk(r, 240 * r.uniform(0.9, 1.15), 0.012, 0.07, noise=1.2, tone=0.4)
    zing = samples.impact("Tin_medium", v, ratio=r.uniform(1.25, 1.8), length=0.2)
    real = rubber(f"breaking/bfh1_metal_hit_{2 + v:02d}.ogg", ratio=r.uniform(1.5, 2.4), length=0.18)
    y = layers([(tk, 0.12, 0), (plate, 0.26, 0.0004), (dent, 0.18, 0), (zing, 0.22, 0), (real, 0.22, 0)], 0.27)
    return loud(y, 8)


@reg("bullet_glass", 3, "impact_bullet", -1, "bullet through glass: crack + ting + falling shards")
def bullet_glass(v, r):
    f = [3300, 3900, 4600][v] * r.uniform(0.97, 1.03)
    crack = fo.tick(r, 6500, 1.2, 0.0016, dur=0.015)
    ting = dsp.modal(secs(0.25), [f, f * 2.13, f * 3.41], [0.05, 0.03, 0.018], [1, 0.5, 0.3])
    shards = fo.tinkle(r, 0.4, 180, 14, 3500, 10500)
    ken = samples.impact("Glass_light", v + 1, ratio=r.uniform(1.0, 1.4), length=0.3)
    real = rubber(f"breaking/bfh1_glass_breaking_{[2, 5, 4][v]:02d}.ogg", ratio=r.uniform(0.9, 1.1), length=0.4)
    y = layers([(crack, 0.12, 0), (ting, 0.18, 0.0005), (shards, 0.25, 0.008), (ken, 0.20, 0), (real, 0.25, 0)], 0.5)
    return loud(y, 8)


@reg("bullet_dirt", 3, "impact_bullet", -3, "bullet into dirt/sand: soft thud + spray")
def bullet_dirt(v, r):
    thud = fo.thunk(r, 105 * r.uniform(0.9, 1.15), 0.03, 0.16, noise=1.5, tone=0.5)
    puff = dsp.bp(_w(r, secs(0.25)), 250, 2200, 2) * dsp.ar_env(secs(0.25), 0.0008, 0.05)
    peb = fo.pebbles(r, 0.25, 160, 800, 3500)
    y = layers([(thud, 0.35, 0), (puff, 0.40, 0), (peb, 0.25, 0.004)], 0.3)
    return loud(y, 8)


@reg("bullet_flesh", 3, "impact_bullet", -2, "dull body thud (non-graphic): low thump + soft slap")
def bullet_flesh(v, r):
    thud = fo.thunk(r, 110 * r.uniform(0.9, 1.2), 0.022, 0.12, noise=1.6, tone=0.5, ncut=3.0)
    smack = dsp.bp(_w(r, secs(0.05)), 600, 2600, 2) * dsp.ar_env(secs(0.05), 0.0005, 0.011)
    ken = samples.impact("Soft_heavy" if v != 1 else "Punch_medium", v, ratio=r.uniform(1.35, 1.9), length=0.14)
    y = layers([(thud, 0.40, 0), (smack, 0.25, 0.001), (ken, 0.35, 0)], 0.22)
    y = dsp.lp(y, 3800, 1)
    return loud(y, 8)


@reg("bullet_tire", 1, "impact_bullet", -1, "tyre puncture: pop + long air hiss + flap")
def bullet_tire(v, r):
    n = secs(1.5)
    t = tt(n)
    pop = dsp.bp(_w(r, secs(0.05)), 200, 3500, 2) * dsp.ar_env(secs(0.05), 0.0004, 0.010)
    body = fo.thunk(r, 85, 0.03, 0.15, noise=1.0, tone=0.7)
    fc = 3000 + 7000 * np.exp(-t / 0.35)
    hiss = dsp.svf(dsp.hp(_w(r, n), 1600, 1), fc, 0.7, "lp")
    sputter = 1 + 0.5 * np.sin(2 * math.pi * (16 * np.exp(-t / 0.9)) * t)
    hiss = hiss * np.exp(-t / 0.42) * (1 - np.exp(-t / 0.006)) * sputter
    flap = np.zeros(n)
    tk = 0.11
    while tk < 0.9:
        dsp.place(flap, fo.thunk(r, 120, 0.012, 0.05, noise=1.6, tone=0.3), secs(tk), math.exp(-tk / 0.3) * r.uniform(0.4, 1.0))
        tk += (0.09 + 0.05 * tk) * r.uniform(0.75, 1.3)
    y = layers([(pop, 0.15, 0), (body, 0.15, 0), (hiss, 0.55, 0.004), (flap, 0.06, 0.03)], 1.5)
    return loud(y, 8)


@reg("bullet_asphalt", 3, "impact_bullet", -3, "bullet on road: sharp tck + dust puff + gravel scatter")
def bullet_asphalt(v, r):
    crack = fo.tick(r, [3200, 2600, 3800][v], 1.5, 0.002, dur=0.03, ring=0.2, ring_f=5200, ring_tau=0.006)
    puff = dsp.bp(_w(r, secs(0.12)), 700, 3200, 2) * dsp.ar_env(secs(0.12), 0.0005, 0.03)
    peb = fo.pebbles(r, 0.22, 240, 1400, 6000)
    th = fo.thunk(r, 140, 0.012, 0.06, noise=1.2, tone=0.3)
    y = layers([(crack, 0.25, 0), (puff, 0.25, 0.001), (peb, 0.30, 0.006), (th, 0.20, 0)], 0.25)
    return loud(y, 8)


@reg("ricochet", 4, "impact_bullet", 0, "ricochet zing: tonal noise gliding down, 0.6 s")
def ricochet(v, r):
    dur = 0.7
    n = secs(dur)
    t = tt(n)
    f_start = [5600, 6400, 4800, 6000][v]
    f_end = [1500, 1900, 1200, 2200][v]
    tg = [0.11, 0.08, 0.14, 0.10][v]
    fc = f_end + (f_start - f_end) * np.exp(-t / tg)
    zing = dsp.svf(_w(r, n), fc, 22.0, "bp")
    tone = np.sin(2 * math.pi * np.cumsum(fc * (1 + 0.004 * np.sin(2 * math.pi * 40 * t))) / SR)
    env = dsp.ar_env(n, 0.0012, [0.16, 0.13, 0.2, 0.15][v])
    body = (en(zing) * 0.75 + en(tone) * 0.6) * env
    tk = fo.tick(r, 4500, 1.5, 0.001, dur=0.012)
    ping = fo.metal_hit(r, f_start * 0.55, 0.05, k=3, click=0.0, dur=0.3)
    y = layers([(tk, 0.10, 0), (body, 0.70, 0.0005), (ping, 0.20, 0)], dur)
    return loud(y, 8)


@reg("bullet_whizz", 5, "impact_bullet", 1, "supersonic near-miss flyby with downward pitch glide (doppler)")
def bullet_whizz(v, r):
    dur = 0.5
    n = secs(dur)
    t = tt(n)
    f0 = [4800, 4200, 5200, 3800, 4500][v] * r.uniform(0.97, 1.03)
    f1 = [1700, 1500, 2000, 1300, 1600][v]
    tg = [0.09, 0.12, 0.08, 0.14, 0.1][v]
    fc = f1 + (f0 - f1) * np.exp(-t / tg)
    q = [5.0, 4.0, 6.0, 3.5, 4.5][v]
    zz = dsp.svf(_w(r, n), fc, q, "bp")
    env = (1 - np.exp(-t / 0.018)) * np.exp(-t / 0.11)
    lowair = dsp.lp(_w(r, n), 700, 1) * env * 0.5
    whip = dsp.hp(_w(r, secs(0.02)), 3000, 1) * dsp.ar_env(secs(0.02), 0.0003, 0.004)
    y = layers([(zz * env, 0.80, 0), (lowair, 0.06, 0), (whip, 0.14, 0.02)], dur)
    return loud(y, 8)


# ---------------------------------------------------------------------------------------------- feedback UI ticks
@reg("hit_marker", 1, "impact_ui", -4, "crisp hit confirmation tick (2-3 kHz)")
def hit_marker(v, r):
    n = secs(0.11)
    t = tt(n)
    tone = np.sin(2 * math.pi * 2350 * t) * np.exp(-t / 0.011) + 0.45 * np.sin(2 * math.pi * 4700 * t) * np.exp(-t / 0.006)
    tk = fo.tick(r, 5200, 1.5, 0.0012, dur=0.02)
    y = layers([(tone, 0.6, 0), (tk, 0.4, 0)], 0.11)
    return y


@reg("hit_marker_kill", 1, "impact_ui", -1, "kill confirmation: double tick + low thock + ping")
def hit_marker_kill(v, r):
    def tk(f):
        n = secs(0.12)
        t = tt(n)
        return np.sin(2 * math.pi * f * t) * np.exp(-t / 0.014) + 0.4 * np.sin(2 * math.pi * f * 2 * t) * np.exp(-t / 0.008)
    thock = fo.thunk(r, 170, 0.03, 0.12, noise=0.8, tone=0.8)
    ping = dsp.modal(secs(0.4), [1560, 3120, 4700], [0.16, 0.08, 0.04], [1, 0.4, 0.2])
    c = fo.tick(r, 5000, 1.5, 0.0012, dur=0.02)
    y = layers([(tk(2000), 0.22, 0), (tk(2700), 0.26, 0.055), (thock, 0.22, 0.05), (ping, 0.20, 0.055), (c, 0.10, 0)], 0.45)
    return y


@reg("headshot_ping", 1, "impact_ui", -2, "bright metallic headshot ping")
def headshot_ping(v, r):
    fs = [2400, 5180, 7900, 3350]
    ping = dsp.modal(secs(0.8), fs, [0.32, 0.16, 0.07, 0.2], [1.0, 0.55, 0.3, 0.35])
    ping = ping * (1 - np.exp(-tt(secs(0.8)) / 0.00015))
    tk = fo.tick(r, 6000, 1.5, 0.0012, dur=0.02)
    thock = fo.thunk(r, 200, 0.02, 0.08, noise=0.6, tone=0.7)
    y = layers([(ping, 0.65, 0), (tk, 0.15, 0), (thock, 0.20, 0)], 0.8)
    return y


@reg("armor_hit", 3, "impact_bullet", 0, "hit on body armor / armour plate: clank + thud")
def armor_hit(v, r):
    plate = fo.metal_hit(r, [520, 690, 860][v] * r.uniform(0.97, 1.03), 0.05, k=5, click=0.3, dur=0.3)
    thud = fo.thunk(r, 140, 0.03, 0.14, noise=1.0, tone=0.6)
    ken = samples.impact("Plate_heavy", v, ratio=r.uniform(1.1, 1.5), length=0.3)
    y = layers([(plate, 0.35, 0), (thud, 0.30, 0), (ken, 0.35, 0)], 0.42)
    return loud(y, 8)


# ---------------------------------------------------------------------------------------------- vehicles / debris
def _crash(r, kind, v):
    """kind: 'light' or 'heavy'"""
    heavy = kind == "heavy"
    dur = 1.9 if heavy else 1.0
    boom = np.tanh(1.4 * dsp.sweep(secs(dur), 95 if heavy else 130, 34 if heavy else 52, 0.08 if heavy else 0.05)) * \
        dsp.ar_env(secs(dur), 0.0015, 0.32 if heavy else 0.13)
    ken1 = samples.impact("Plate_heavy", v, ratio=(0.75 if heavy else 1.0) * r.uniform(0.92, 1.08), length=0.5)
    ken2 = samples.impact("Metal_heavy", v + 1, ratio=(0.8 if heavy else 1.1) * r.uniform(0.92, 1.08), length=0.4)
    cr = fo.crunch(r, 0.9 if heavy else 0.5, 300 if heavy else 500, 3200, 12 if heavy else 6, 0.03 if heavy else 0.02,
                   (350, 1800), 0.5, 0.6)
    glass = fo.tinkle(r, 0.9 if heavy else 0.5, 90 if heavy else 60, 6, 3000, 9000)
    roll = dsp.bp(_w(r, secs(dur)), 300, 2800, 1) * dsp.ar_env(secs(dur), 0.02, 0.28 if heavy else 0.14)
    scrape = fo.friction(r, 0.5 if heavy else 0.3, 700, 2600, 5.0, 1.0, res=0.5, res_f=1900)
    real = rubber(f"breaking/bfh1_metal_hit_{[4, 5, 2][v]:02d}.ogg", ratio=(0.85 if heavy else 1.1) * r.uniform(0.95, 1.05), length=0.5)
    slam = rubber(f"sfx100/slam_{[2, 3, 6][v]:02d}.ogg", ratio=(0.8 if heavy else 1.0), length=0.5)
    mfall = rubber(f"breaking/bfh1_metal_falling_{[1, 2, 1][v]:02d}.ogg", ratio=r.uniform(0.85, 1.0), length=0.9)
    parts = [(boom, 0.17 if heavy else 0.15, 0), (ken1, 0.16, 0), (ken2, 0.10, 0.004), (cr, 0.16, 0.006),
             (glass, 0.05, 0.03), (roll, 0.08, 0.05), (scrape, 0.06, 0.12), (real, 0.10, 0.002), (slam, 0.10, 0), (mfall, 0.06, 0.08)]
    y = layers(parts, dur)
    ir = dsp.reverb_ir(0.5 if heavy else 0.25, r, lp_start=5000, lp_end=900)
    w = dsp.convolve(y, ir)
    w *= math.sqrt(0.25 * np.sum(y ** 2) / np.sum(w ** 2))
    out = np.zeros(len(w))
    out[:len(y)] += y
    out += w
    out = dsp.trim_silence(out, -62, 0.02)
    return loud(out, 6)


reg("car_crash_light", 3, "impact_car", -6, "light collision / scrape-crash, ~1 s")(lambda v, r: _crash(r, "light", v))
reg("car_crash_heavy", 3, "impact_car", 0, "heavy crash: sub boom + crush + debris, ~1.9 s")(lambda v, r: _crash(r, "heavy", v))


@reg("car_scrape_loop", 1, "impact_loop", -4, "metal scraping on asphalt, seamless 1.6 s loop; gain by slide speed, pitch 0.8-1.3",
     loop=True, norm=("lufs", -21.0))
def car_scrape_loop(v, r):
    n = secs(1.6)
    nz = lambda beta=0: dsp.noise(n, r, beta)
    modes = (en(dsp.bpq(nz(), 1250, 3.5, 2, loop=True)) * 1.0 + en(dsp.bpq(nz(), 2700, 4, 2, loop=True)) * 0.8 +
             en(dsp.bpq(nz(), 4700, 5, 2, loop=True)) * 0.5)
    rough = np.clip(1 + 1.1 * en(dsp.lp(nz(), 220, 1, loop=True)), 0.03, 3.5)
    grit = en(dsp.hp(nz(), 3000, 1, loop=True)) * 0.35 * rough ** 2
    low = en(dsp.lp(nz(1), 320, 2, loop=True)) * 0.5
    y = (modes * 0.9 + low) * rough + grit
    sp = np.zeros(n)
    for _ in range(38):
        t0 = r.uniform(0, 1.6)
        f = math.exp(r.uniform(math.log(1500), math.log(6000)))
        dsp.place_wrap(sp, fo.tick(r, f, 2, 0.0012, dur=0.012), secs(t0), r.uniform(0.2, 1.0))
    y = y / dsp.rms(y) + sp / (dsp.rms(sp) + 1e-9) * 0.3
    return np.tanh(y * 0.8)


@reg("car_scrape_hit", 1, "impact_car", -6, "onset of a metal scrape: screech chirp + crunch, 0.5 s")
def car_scrape_hit(v, r):
    n = secs(0.55)
    t = tt(n)
    f = 620 + 1000 * (1 - np.exp(-t / 0.15))
    fm = 1 + 0.03 * np.sin(2 * math.pi * 55 * t)
    saw = dsp.saw(f * fm, n)
    saw = dsp.svf(saw, 2400, 3.0, "lp") * dsp.ar_env(n, 0.004, 0.2)
    fr = fo.friction(r, 0.5, 900, 3200, 4.0, 1.0, res=0.5, res_f=2100)
    cr = fo.crunch(r, 0.25, 500, 3200, 4, 0.02)
    th = fo.thunk(r, 130, 0.02, 0.1, noise=1.0, tone=0.5)
    y = layers([(saw, 0.20, 0.0), (fr, 0.35, 0.0), (cr, 0.30, 0.0), (th, 0.15, 0)], 0.55)
    return loud(y, 5)


@reg("glass_shatter", 2, "impact_car", -3, "windscreen / window shatter, 1.3 s")
def glass_shatter(v, r):
    dur = 1.4
    n = secs(dur)
    crack = fo.tick(r, 6800, 1.0, 0.003, dur=0.03)
    burst = dsp.bp(_w(r, n), 2200, 11000, 2) * dsp.ar_env(n, 0.0006, 0.06)
    shards = fo.tinkle(r, 1.2, 320, 10, 2800, 10500, tau=(0.01, 0.045))
    ken = samples.impact("Glass_heavy", v + 2, ratio=r.uniform(0.9, 1.2), length=0.4)
    pane = fo.thunk(r, 180, 0.02, 0.1, noise=0.8, tone=0.6)
    real = rubber(f"breaking/bfh1_glass_breaking_{[1, 3][v]:02d}.ogg", ratio=r.uniform(0.85, 1.0), length=0.75)
    real2 = rubber(f"breaking/bfh1_glass_breaking_{[4, 6][v]:02d}.ogg", ratio=r.uniform(0.9, 1.05), length=0.8)
    y = layers([(crack, 0.08, 0), (burst, 0.16, 0.002), (shards, 0.24, 0.02), (ken, 0.14, 0), (pane, 0.08, 0),
                (real, 0.18, 0.0), (real2, 0.12, 0.05)], dur)
    return loud(y, 5)


@reg("metal_tear", 3, "impact_car", -3, "tearing / peeling sheet metal, ~1 s")
def metal_tear(v, r):
    dur = [1.0, 0.8, 1.2][v]
    n = secs(dur)
    t = tt(n)
    fr = fo.friction(r, dur, 500, 2600, 3.5, 1.2, shape=0.5, tex_fc=90, res=0.6, res_f=1300 + 300 * v)
    sq = dsp.saw(np.linspace(700, 1500, n) * (1 + 0.04 * np.sin(2 * math.pi * 23 * t)), n)
    sq = dsp.svf(sq, 1800, 2.5, "lp") * np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5
    snaps = np.zeros(n)
    k = 0.03
    while k < dur - 0.05:
        dsp.place(snaps, fo.tick(r, r.uniform(1200, 4000), 2, 0.002, dur=0.03, ring=0.4, ring_f=2200, ring_tau=0.02), secs(k), r.uniform(0.4, 1))
        k += r.uniform(0.04, 0.16)
    th = fo.thunk(r, 120, 0.03, 0.12, noise=1.0, tone=0.4)
    y = layers([(fr, 0.45, 0), (sq, 0.15, 0.02), (snaps, 0.25, 0), (th, 0.15, 0)], dur)
    return loud(y, 5)


@reg("panel_detach", 3, "impact_car", -2, "body panel / bumper ripping off: clang + boing + skitter")
def panel_detach(v, r):
    f0 = [430, 560, 700][v] * r.uniform(0.96, 1.04)
    clang = fo.metal_hit(r, f0, 0.14, k=6, click=0.5, dur=0.6, spread=0.03)
    snap = fo.tick(r, 2500, 1.5, 0.003, dur=0.04, ring=0.5, ring_f=1800, ring_tau=0.03)
    boing = fo.spring(r, 0.35, 320 + 60 * v, 0.14)
    ken = samples.impact("Metal_heavy", v + 2, ratio=r.uniform(0.85, 1.05), length=0.35)
    sk = np.zeros(secs(0.7))
    t0 = 0.12
    a = 0.6
    step = 0.09
    for _k in range(7):
        dsp.place(sk, fo.metal_hit(r, r.uniform(500, 1400), 0.035, k=3, click=0.4, dur=0.15), secs(t0), a)
        t0 += step
        step *= 0.72
        a *= 0.65
    y = layers([(clang, 0.30, 0), (snap, 0.12, 0), (boing, 0.08, 0.02), (ken, 0.25, 0), (sk, 0.25, 0.05)], 0.75)
    return loud(y, 5)


@reg("debris_bounce", 4, "impact_car", -6, "chunk of metal bouncing on asphalt, 3 bounces")
def debris_bounce(v, r):
    size = [1.0, 0.75, 1.35, 0.6][v]
    y = np.zeros(secs(0.75))
    t0 = 0.0
    a = 1.0
    gap = 0.14 * size
    for k in range(4):
        f = r.uniform(600, 1300) / size
        m = fo.metal_hit(r, f, 0.05 * size, k=4, click=0.5, dur=0.25)
        th = fo.thunk(r, 170 / size, 0.02, 0.08, noise=1.0, tone=0.5)
        real = rubber(f"breaking/bfh1_metal_hit_{2 + (v + k) % 5:02d}.ogg", ratio=r.uniform(1.0, 1.8) / size, length=0.16)
        s = layers([(m, 0.4, 0), (th, 0.3, 0), (real, 0.3, 0)])
        dsp.place(y, s, secs(t0), a)
        t0 += gap
        gap *= 0.62
        a *= 0.5
    return loud(y, 5)


@reg("wheel_off", 1, "impact_car", -1, "wheel shears off: bang + whirring roll-away + bounces, 1.8 s")
def wheel_off(v, r):
    dur = 1.8
    n = secs(dur)
    t = tt(n)
    bang = fo.crunch(r, 0.3, 600, 4500, 4, 0.02)
    snap = fo.tick(r, 3000, 1.2, 0.004, dur=0.04, ring=0.6, ring_f=1500, ring_tau=0.05)
    boom = fo.thunk(r, 90, 0.05, 0.25, noise=1.0, tone=0.8)
    # rolling wheel: tonal hum with decaying pitch + thump rate slowing (Doppler-ish recede)
    fhum = 260 * np.exp(-t / 0.9) + 90
    hum = dsp.lp(dsp.saw(fhum, n), 1200, 1) * np.exp(-t / 0.55)
    rot = np.zeros(n)
    tk = 0.1
    while tk < 1.5:
        dsp.place(rot, fo.thunk(r, 110, 0.014, 0.06, noise=1.0, tone=0.4), secs(tk), math.exp(-tk / 0.55))
        tk += 0.05 + 0.09 * tk
    bounces = np.zeros(n)
    for bt, ba in [(0.35, 0.8), (0.62, 0.5), (0.83, 0.32), (0.98, 0.2)]:
        dsp.place(bounces, fo.metal_hit(r, 420 * r.uniform(0.9, 1.1), 0.08, k=4, click=0.3, dur=0.3), secs(bt), ba)
    y = layers([(bang, 0.22, 0), (snap, 0.06, 0), (boom, 0.14, 0), (hum, 0.14, 0.05), (rot, 0.14, 0.05), (bounces, 0.30, 0)], dur)
    y = dsp.lp(y, 9000, 1)
    return loud(y, 5)


@reg("ram_hit", 3, "impact_car", -2, "vehicle-vehicle ram: solid low thud + crunch")
def ram_hit(v, r):
    dur = 0.9
    thud = np.tanh(1.5 * dsp.sweep(secs(dur), 88, 42, 0.05)) * dsp.ar_env(secs(dur), 0.0012, 0.16)
    ken = samples.impact("Mining", v, ratio=r.uniform(1.0, 1.25), length=0.5)
    ken2 = samples.impact("Plate_heavy", v + 3, ratio=r.uniform(0.85, 1.0), length=0.4)
    cr = fo.crunch(r, 0.4, 400, 3000, 5, 0.025, (300, 1500), 0.4, 0.8)
    rat = fo.rattle(r, 0.4, 60, 500, 2500, 0.004)
    slam = rubber(f"sfx100/slam_{[2, 3, 4][v]:02d}.ogg", ratio=r.uniform(0.85, 1.0), length=0.5)
    y = layers([(thud, 0.26, 0), (ken, 0.20, 0), (ken2, 0.12, 0), (cr, 0.16, 0.004), (rat, 0.08, 0.06), (slam, 0.18, 0)], dur)
    y = dsp.trim_silence(y, -62, 0.02)
    return loud(y, 6)
