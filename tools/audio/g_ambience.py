"""g_ambience.py - stereo biome ambience beds, seamless loops (all modulation uses integer cycles per loop)."""
import math

import numpy as np

import dsp
import foley as fo
from dsp import SR, secs, tt
from foley import en
from render import sound

G = "ambience"
LOOP_S = 24.0


def _gust(L, r, cycles=(2, 3), depth=0.5, irr=0.3, slow_fc=0.6):
    t = np.arange(L) / SR
    T = L / SR
    lfo = sum(np.sin(2 * math.pi * c * t / T + r.uniform(0, 6.28)) for c in cycles) / len(cycles)
    ir = en(dsp.lp(dsp.noise(L, r, 0), slow_fc, 1, loop=True))
    return np.clip(1 + depth * lfo + irr * ir, 0.05, 3.0)


def _chan(fn, L, r):
    return np.stack([fn(L, r), fn(L, r)], axis=1)


def reg(name, lufs, notes, rel=0):
    def deco(fn):
        sound(G, name, n=1, ch=2, loop=True, category="ambience", norm=("lufs", lufs), rel_db=rel, notes=notes, quality=4)(fn)
        return fn
    return deco


@reg("desert_wind_loop", -26.0, "open desert wind: broad gusts + sand hiss + faint whistles, seamless 24 s stereo loop")
def desert_wind(v, r):
    L = secs(LOOP_S)

    def ch(L, r):
        base = en(dsp.bp(dsp.noise(L, r, 1.0), 60, 900, 2, loop=True)) * _gust(L, r, (2, 3), 0.55, 0.35)
        sand = en(dsp.bp(dsp.noise(L, r, 0.3), 1500, 5200, 1, loop=True)) * _gust(L, r, (5, 9), 0.5, 0.4, 1.0) * 0.28
        rum = en(dsp.lp(dsp.noise(L, r, 1.5), 90, 2, loop=True)) * 0.35
        wh = (en(dsp.bpq(dsp.noise(L, r, 0), 620, 30, 2, loop=True)) * 0.07 +
              en(dsp.bpq(dsp.noise(L, r, 0), 1010, 30, 2, loop=True)) * 0.05) * _gust(L, r, (3,), 0.9, 0.2)
        return base + sand + rum + wh
    return _chan(ch, L, r)


@reg("canyon_wind_loop", -26.0, "hollow canyon wind: moving formant resonances + long echo, seamless 24 s stereo loop")
def canyon_wind(v, r):
    L = secs(LOOP_S)
    T = LOOP_S
    t = np.arange(L) / SR

    def ch(L, r):
        y = np.zeros(L)
        for f0, q, g, cyc in [(180, 7, 1.0, 2), (290, 8, 0.8, 3), (460, 8, 0.5, 4)]:
            fc = f0 * (1 + 0.10 * np.sin(2 * math.pi * cyc * t / T + r.uniform(0, 6.28)))
            y += en(dsp.svf(dsp.noise(L, r, 0.5), fc, q, "bp", loop=True)) * g
        y *= _gust(L, r, (2, 3), 0.6, 0.3)
        y += en(dsp.bp(dsp.noise(L, r, 1.0), 70, 700, 2, loop=True)) * 0.35
        y += en(dsp.hp(dsp.noise(L, r, 0.2), 3000, 1, loop=True)) * 0.04
        return y
    st = _chan(ch, L, r)
    ir = dsp.reverb_ir(3.0, r, lp_start=3500, lp_end=500, stereo=True)
    return dsp.circ_reverb(st, ir, 0.35)


@reg("coast_waves_loop", -25.0, "surf: three irregular waves rolling in and washing out over distant surf, seamless 24 s stereo loop")
def coast_waves(v, r):
    L = secs(LOOP_S)
    t = np.arange(L) / SR
    T = LOOP_S
    waves = [(1.8, 1.0, 5.5), (9.9, 0.75, 4.8), (16.4, 0.9, 5.2)]    # (crash time, size, wash length)

    def ch(L, r, shift):
        env_tot = np.zeros(L)
        y = np.zeros(L)
        nz = dsp.noise(L, r, 0.4)
        for tc, size, wl in waves:
            tc = tc + shift
            d = ((t - tc + T / 2) % T) - T / 2          # signed circular time relative to crash
            rise = dsp.smoothstep((d + 3.0) / 3.0)      # builds over 3 s before crash
            wash = np.exp(-np.maximum(d, 0) / (wl * 0.45))
            env = np.where(d < 0, rise ** 2 * 0.5, 0.5 + 0.5 * 0) * np.where(d < 0, 1, wash)
            env_tot += env * size
        # spectrum follows wave energy: brighter at crash
        fc = 500 + 4200 * np.clip(env_tot, 0, 1) ** 1.5
        y = dsp.svf(nz, fc, 0.7, "lp", loop=True)
        y = y * (0.12 + env_tot)
        foam = en(dsp.hp(dsp.noise(L, r, 0.2), 3500, 1, loop=True)) * np.clip(env_tot - 0.25, 0, 2) * 0.25
        rumble = en(dsp.lp(dsp.noise(L, r, 1.6), 260, 2, loop=True)) * 0.35
        return y + foam + rumble
    a = ch(L, r, 0.0)
    b = ch(L, r, 0.35)      # slightly offset arrival for width
    return np.stack([a, b], axis=1)


@reg("forest_wind_loop", -27.0, "wind through pines: swishing gusts + leaf rustle sparkle, seamless 24 s stereo loop")
def forest_wind(v, r):
    L = secs(LOOP_S)

    def ch(L, r):
        sw = en(dsp.bp(dsp.noise(L, r, 0.8), 350, 3200, 2, loop=True)) * _gust(L, r, (4, 6, 9), 0.55, 0.45, 0.8)
        leaf = en(dsp.hp(dsp.noise(L, r, 0.0), 2500, 1, loop=True))
        leaf = leaf * np.clip(en(dsp.lp(dsp.noise(L, r, 0), 40, 1, loop=True)), 0, 3) ** 2 * _gust(L, r, (4, 6), 0.5, 0.4, 0.8) * 0.5
        low = en(dsp.lp(dsp.noise(L, r, 1.5), 120, 2, loop=True)) * 0.25
        return sw + leaf * 0.35 + low
    return _chan(ch, L, r)


@reg("city_ruins_loop", -27.0, "ruined city: thin wind, structure howl, distant creaks and debris ticks, seamless 24 s stereo loop")
def city_ruins(v, r):
    L = secs(LOOP_S)
    t = np.arange(L) / SR
    T = LOOP_S

    def ch(L, r):
        wind = en(dsp.bp(dsp.noise(L, r, 1.0), 80, 700, 2, loop=True)) * _gust(L, r, (2, 3), 0.5, 0.35)
        fc = 250 * (1 + 0.5 * np.sin(2 * math.pi * 2 * t / T + r.uniform(0, 6)) * 0.5 + 0.2 * np.sin(2 * math.pi * 5 * t / T + r.uniform(0, 6)))
        howl = en(dsp.svf(dsp.noise(L, r, 0.3), fc, 20.0, "bp", loop=True)) * (0.2 + 0.8 * np.clip(_gust(L, r, (3,), 0.9, 0.2), 0, 2))
        dust = en(dsp.bp(dsp.noise(L, r, 0.2), 2000, 6000, 1, loop=True)) * 0.08 * _gust(L, r, (5, 7), 0.6, 0.4, 0.8)
        ev = np.zeros(L)
        for _ in range(3):        # metal creaks
            d = r.uniform(0.9, 1.6)
            cr = fo.friction(r, d, r.uniform(250, 450), r.uniform(500, 900), 6.0, 0.9, res=0.6, res_f=r.uniform(500, 800))
            dsp.place_wrap(ev, cr, secs(r.uniform(0, T)), 0.5)
        for _ in range(11):       # debris ticks
            m = fo.metal_hit(r, r.uniform(600, 2400), 0.05, k=3, click=0.5, dur=0.25)
            dsp.place_wrap(ev, m, secs(r.uniform(0, T)), r.uniform(0.15, 0.5))
        return wind + howl * 0.45 + dust + en(ev) * 0.35
    return _chan(ch, L, r)


@reg("dam_rumble_loop", -22.0, "boss arena at the dam: deep water thunder + turbine hum + spray, seamless 24 s stereo loop")
def dam_rumble(v, r):
    L = secs(LOOP_S)
    t = np.arange(L) / SR
    T = LOOP_S

    def q(f):
        return round(f * T) / T

    def ch(L, r):
        deep = en(dsp.lp(dsp.noise(L, r, 2.0), 160, 2, loop=True)) * _gust(L, r, (2, 4), 0.25, 0.2, 0.5)
        roar = en(dsp.bp(dsp.noise(L, r, 1.0), 180, 3200, 2, loop=True)) * _gust(L, r, (3, 5), 0.3, 0.3, 0.8)
        spray = en(dsp.hp(dsp.noise(L, r, 0.2), 3500, 1, loop=True)) * 0.12
        hum = (np.sin(2 * math.pi * q(47.7) * t + r.uniform(0, 6)) + 0.6 * np.sin(2 * math.pi * q(95.5) * t + r.uniform(0, 6)) +
               0.3 * np.sin(2 * math.pi * q(143.1) * t + r.uniform(0, 6)))
        hum *= 1 + 0.15 * np.sin(2 * math.pi * 3 * t / T)
        return deep * 1.0 + roar * 0.75 + spray + en(hum) * 0.22
    return _chan(ch, L, r)
