"""g_ui.py - menu / garage / HUD interface sounds (synthesised, gritty-arcade style)."""
import math

import numpy as np

import dsp
import foley as fo
import samples
from dsp import SR, secs, tt
from foley import en, layers, loud
from render import sound

G = "ui"


def _w(r, n):
    return r.standard_normal(n)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def bell(f, dur, tau, ratios=(1.0, 2.76, 5.4), amps=(1.0, 0.5, 0.25), att=0.001):
    n = secs(dur)
    t = tt(n)
    y = np.zeros(n)
    for k, (rt, a) in enumerate(zip(ratios, amps)):
        y += a * np.sin(2 * math.pi * f * rt * t) * np.exp(-t / (tau / (1 + 0.6 * k)))
    return y * np.minimum(1, t / att)


def beep(f, dur, att=0.004, rel=0.02, harm=(1.0, 0.0, 0.0), wave="sin"):
    n = secs(dur)
    t = tt(n)
    if wave == "square":
        y = dsp.pulse(np.full(n, f), n, 0.5)
    else:
        y = sum(a * np.sin(2 * math.pi * f * (k + 1) * t) for k, a in enumerate(harm))
    return y * np.minimum(1, t / att) * np.minimum(1, np.maximum(dur - t, 0) / rel)


def reg(name, n, rel, notes, **kw):
    def deco(fn):
        sound(G, name, n=n, category="ui", rel_db=rel, notes=notes, **kw)(fn)
        return fn
    return deco


@reg("click", 1, 0, "button press: dry tactile tick")
def click(v, r):
    t1 = beep(1350, 0.05, 0.0008, 0.03, (1, 0.3, 0.0))
    t1 = t1 * np.exp(-tt(len(t1)) / 0.012)
    tk = fo.tick(r, 3800, 1.5, 0.0012, dur=0.02)
    th = fo.thunk(r, 260, 0.01, 0.04, noise=0.6, tone=0.8)
    return layers([(t1, 0.45, 0), (tk, 0.30, 0), (th, 0.25, 0)], 0.07)


@reg("hover", 1, -6, "menu item hover: light high tick")
def hover(v, r):
    t1 = beep(2350, 0.035, 0.0006, 0.02, (1, 0.2, 0))
    t1 = t1 * np.exp(-tt(len(t1)) / 0.008)
    tk = fo.tick(r, 5200, 1.5, 0.0008, dur=0.012)
    return layers([(t1, 0.7, 0), (tk, 0.3, 0)], 0.05)


@reg("buy", 1, 0, "purchase confirmation: cash-register bell + coin clink, 0.7 s")
def buy(v, r):
    b1 = bell(1568, 0.6, 0.22, (1, 2.0, 3.01, 4.2), (1, 0.5, 0.3, 0.15))
    b2 = bell(2093, 0.55, 0.2, (1, 2.0, 3.01), (1, 0.45, 0.25))
    ck = fo.metal_hit(r, 3400, 0.03, k=3, click=0.8, dur=0.12)
    th = fo.thunk(r, 210, 0.02, 0.08, noise=0.8, tone=0.7)
    return layers([(th, 0.08, 0), (ck, 0.12, 0), (b1, 0.38, 0.03), (b2, 0.42, 0.1)], 0.75)


@reg("error", 1, -1, "denied / cannot afford: low double buzz")
def error(v, r):
    n = secs(0.36)
    t = tt(n)
    f = np.where(t < 0.16, 196.0, 147.0)
    s = dsp.pulse(f, n, 0.5)
    s = dsp.lp(s, 1400, 2)
    env = np.where(t < 0.16, 1, 1) * (np.minimum(1, t / 0.004) * np.minimum(1, np.abs(np.where(t < 0.16, 0.16 - t, 0.36 - t)) / 0.02 * 3 + 0.0))
    env = np.minimum(1, t / 0.004) * np.where(t < 0.16, np.minimum(1, (0.16 - t) / 0.015), np.minimum(1, (0.36 - t) / 0.03))
    env = np.maximum(env, 0)
    return layers([(s * env, 0.85, 0), (fo.tick(r, 900, 1.0, 0.004, dur=0.03), 0.15, 0)], 0.36)


@reg("coin", 2, -2, "coin pickup / cash ding (two variations, pitch up/down)")
def coin(v, r):
    f = [1975.0, 2349.0][v]
    b = bell(f, 0.42, 0.12, (1, 2.0, 3.0, 4.07), (1, 0.55, 0.25, 0.12))
    b2 = bell(f * 1.335, 0.4, 0.14, (1, 2.0, 3.0), (1, 0.4, 0.2))
    tk = fo.tick(r, 6000, 1.5, 0.0008, dur=0.012)
    return layers([(tk, 0.06, 0), (b, 0.5, 0), (b2, 0.44, 0.055)], 0.45)


@reg("upgrade_unlock", 1, 0, "new upgrade / weapon unlocked: rising sparkle arpeggio, 1 s")
def upgrade_unlock(v, r):
    notes = [72, 76, 79, 84, 88]     # C5 E5 G5 C6 E6 (C major pentatonic-ish)
    parts = []
    for i, m in enumerate(notes):
        parts.append((bell(midi(m), 0.55, 0.16 + 0.03 * i, (1, 2.0, 3.0, 4.1), (1, 0.5, 0.3, 0.12)), 0.15, 0.075 * i))
    sp = fo.tinkle(r, 0.7, 60, 30, 4500, 11000, tau=(0.006, 0.02))
    parts.append((sp, 0.10, 0.2))
    sw = fo.whoosh(r, 0.4, 500, 6000, 1.0, 0.85, 1.4)
    parts.append((sw, 0.08, 0.0))
    return layers(parts, 1.05)


@reg("ready", 1, -1, "ready / confirm: two-note up chirp")
def ready(v, r):
    a = beep(660, 0.12, 0.004, 0.03, (1, 0.35, 0.1))
    b = beep(880, 0.22, 0.004, 0.08, (1, 0.35, 0.1))
    b = b * np.exp(-tt(len(b)) / 0.14)
    a = a * np.exp(-tt(len(a)) / 0.1)
    tk = fo.tick(r, 3200, 1.5, 0.001, dur=0.02)
    return layers([(a, 0.35, 0), (b, 0.5, 0.11), (tk, 0.15, 0)], 0.36)


@reg("countdown_beep", 1, -2, "3-2-1 countdown beep (880 Hz)")
def countdown_beep(v, r):
    b = beep(880, 0.28, 0.003, 0.05, (1, 0.3, 0.12))
    b = b * (0.3 + 0.7 * np.exp(-tt(len(b)) / 0.15))
    tk = fo.tick(r, 2500, 1.5, 0.0015, dur=0.02)
    return layers([(b, 0.9, 0), (tk, 0.1, 0)], 0.3)


@reg("go", 1, 0, "GO! start beep: higher, longer, with rising sweep")
def go(v, r):
    n = secs(0.7)
    t = tt(n)
    f = 1320 * (1 + 0.06 * (1 - np.exp(-t / 0.05)))
    s = np.sin(2 * math.pi * np.cumsum(f) / SR) + 0.4 * np.sin(2 * math.pi * np.cumsum(f * 2) / SR) + 0.2 * np.sin(2 * math.pi * np.cumsum(f * 3) / SR)
    s = s * np.minimum(1, t / 0.003) * (0.4 + 0.6 * np.exp(-t / 0.3)) * np.minimum(1, np.maximum(0.7 - t, 0) / 0.15)
    sw = fo.whoosh(r, 0.5, 400, 5000, 1.0, 0.7, 1.3)
    tk = fo.tick(r, 3000, 1.5, 0.0015, dur=0.02)
    th = fo.thunk(r, 110, 0.05, 0.2, noise=0.6, tone=0.9)
    return layers([(s, 0.6, 0), (sw, 0.14, 0), (th, 0.14, 0), (tk, 0.06, 0)], 0.7)


@reg("menu_open", 1, -3, "menu opens: short rising airy whoosh + soft click")
def menu_open(v, r):
    w = fo.whoosh(r, 0.28, 700, 4200, 1.2, 0.6, 1.3)
    tk = fo.tick(r, 2600, 1.5, 0.0015, dur=0.02)
    b = beep(1000, 0.08, 0.004, 0.04, (1, 0.2, 0)) * np.exp(-tt(secs(0.08)) / 0.03)
    return layers([(w, 0.6, 0), (tk, 0.15, 0.2), (b, 0.25, 0.21)], 0.32)


@reg("menu_close", 1, -3, "menu closes: falling whoosh + soft thock")
def menu_close(v, r):
    w = fo.whoosh(r, 0.24, 4000, 600, 1.2, 0.3, 1.3)
    th = fo.thunk(r, 210, 0.02, 0.08, noise=0.7, tone=0.8)
    tk = fo.tick(r, 2100, 1.5, 0.0015, dur=0.02)
    return layers([(w, 0.55, 0), (th, 0.3, 0.17), (tk, 0.15, 0.17)], 0.3)


@reg("whoosh_transition", 1, -2, "screen transition: swelling whoosh into a low thud, 0.8 s")
def whoosh_transition(v, r):
    w = fo.whoosh(r, 0.65, 300, 7000, 0.9, 0.85, 1.6)
    th = fo.thunk(r, 75, 0.06, 0.3, noise=0.8, tone=0.9)
    air = dsp.bp(_w(r, secs(0.4)), 3000, 9000, 1) * dsp.ar_env(secs(0.4), 0.01, 0.1)
    return layers([(w, 0.6, 0), (th, 0.32, 0.62), (air, 0.08, 0.62)], 0.95)
