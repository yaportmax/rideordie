"""mix_sim.py - simulate a busy combat second-by-second mix with the manifest gains + suggested bus levels, to validate headroom.

Scene (12 s): player LMG burst fire, 2 raider guns, bullet impacts + whizz, engine (t3 mid, 3800 rpm), tyres + wind at 130 km/h,
two explosions, a car crash, music (run_a all stems), ambience desert.  Reports peak / LUFS with and without a master limiter.
"""
import json
import math
import os

import numpy as np
import soundfile as sf
import pyloudnorm as pyln

import dsp

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
A = os.path.join(ROOT, "public", "audio")
man = json.load(open(os.path.join(A, "manifest.json")))
S = man["sounds"]
SR = 44100
rng = np.random.default_rng(7)
N = 12 * SR
BUS = dict(sfx=0.8, engine=0.6, amb=0.5, music=0.45)


def load(f):
    x, _ = sf.read(os.path.join(A, f), dtype="float64", always_2d=True)
    return x


def stereo(x):
    return np.repeat(x, 2, axis=1) if x.shape[1] == 1 else x


mix = {k: np.zeros((N, 2)) for k in ("sfx", "engine", "amb", "music")}


def add(bus, key, t, var=None, pitch=1.0, vol=1.0, pan=0.0):
    d = S[key]
    f = d["files"][var if var is not None else int(rng.integers(0, d["variations"]))]
    x = stereo(load(f))
    if abs(pitch - 1) > 1e-3:
        x = dsp.repitch(x, pitch)
    s = int(t * SR)
    if s >= N:
        return
    e = min(len(x), N - s)
    a = (pan + 1) * math.pi / 4
    x = x[:e] * np.array([math.cos(a), math.sin(a)]) * math.sqrt(2)
    mix[bus][s:s + e] += x * d["gain"] * vol * BUS[bus]


def loop(bus, key, vol=1.0, pitch=1.0):
    d = S[key]
    x = stereo(load(d["files"][0]))
    if abs(pitch - 1) > 1e-3:
        x = dsp.repitch(x, pitch)
    n = int(np.ceil(N / len(x)))
    y = np.tile(x, (n, 1))[:N]
    mix[bus] += y * d["gain"] * vol * BUS[bus]


# music + ambience + engine + road
for st in ("base", "drums", "lead", "extra"):
    k = f"music/run_a_{st}"
    if k in S:
        loop("music", k, 1.0)
loop("amb", "ambience/desert_wind_loop")
loop("engine", "vehicles/engine_player_t3_mid", 1.0)
loop("engine", "vehicles/tyre_asphalt_loop", 0.9, 1.4)
loop("engine", "vehicles/wind_loop", 0.7, 1.4)
# gunfire
for i in range(int(10 * 6)):
    add("sfx", "guns/fire_lmg", 1.0 + i / 10.0 * 1.0 + rng.uniform(-0.005, 0.005), pitch=rng.uniform(0.96, 1.04), pan=0.3)
for i in range(0, 60):
    add("sfx", "guns/fire_enemy_light", 0.5 + i / 8.0, pitch=rng.uniform(0.93, 1.07), pan=-0.6, vol=0.9)
    add("sfx", "guns/fire_enemy_light", 0.7 + i / 7.0, pitch=rng.uniform(0.93, 1.07), pan=0.7, vol=0.9)
for t in np.arange(1.0, 7.0, 0.11):
    add("sfx", "impacts/bullet_metal", t + rng.uniform(0, 0.05), pan=rng.uniform(-0.8, 0.8), vol=0.8)
    if rng.random() < 0.3:
        add("sfx", "impacts/bullet_whizz", t, pan=rng.uniform(-1, 1))
add("sfx", "explosions/explosion_medium", 3.0, pan=0.4)
add("sfx", "explosions/explosion_large", 6.5, pan=-0.4)
add("sfx", "impacts/car_crash_heavy", 6.0, pan=0.0)
add("sfx", "explosions/shockwave_sub", 6.5)

total = sum(mix.values())
m = pyln.Meter(SR)
print("bus peaks (dBFS):", {k: round(20 * math.log10(np.abs(v).max() + 1e-9), 1) for k, v in mix.items()})
print("sum peak dBFS %.2f   LUFS-I %.1f   short-term max ~%.1f" % (20 * math.log10(np.abs(total).max()), m.integrated_loudness(total),
                                                             max(m.integrated_loudness(total[i:i + 3 * SR]) for i in range(0, N - 3 * SR, SR))))
lim = dsp.limit(total, -1.0, 5.0, 100.0)
print("after master limiter (-1 dBFS): peak %.2f  LUFS-I %.1f" % (20 * math.log10(np.abs(lim).max()), m.integrated_loudness(lim)))
sfx_only = mix["sfx"]
print("sfx bus alone peak %.1f dBFS" % (20 * math.log10(np.abs(sfx_only).max())))
