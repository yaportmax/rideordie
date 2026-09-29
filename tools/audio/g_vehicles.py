"""g_vehicles.py - engines (5 RPM stage loops each), forced induction, nitro, tyres, wind, suspension, horns, misc."""
import math

import numpy as np

import dsp
import engine_lib as EL
import foley as fo
import samples
from dsp import SR, secs, tt
from foley import en, layers, loud
from render import sound

G = "vehicles"
STAGES = ["idle", "low", "mid", "high", "redline"]
STAGE_LUFS = dict(idle=-22.0, low=-21.3, mid=-20.6, high=-20.0, redline=-19.5)


def _w(r, n):
    return r.standard_normal(n)


# ==================================================================================================== engines
V8_LOPE = np.array([1.0, 0.78, 1.08, 0.6, 1.0, 0.9, 0.72, 1.12])

ENGINES = {
    "engine_player_t1": dict(
        desc="tired rattly 4-cylinder (starter truck)", rpms=[900, 2200, 3600, 5200, 6500],
        P=dict(layout="I4", kd=0.30, pipe=[(1.3, 0.35, 0.5)], res=[(140, 4, 0.5), (420, 4, 0.4), (900, 3, 0.3)], rasp=1.4,
               muff=2300, click=0.3, click_mix=0.35, click_bp=(800, 4000), mech=0.30, mech_rate=6.0, mech_bp=(1500, 5000),
               intake=0.22, var=0.14, tjit=0.02, body=[(110, 4.0, 1.2)], dry=0.6)),
    "engine_player_t2": dict(
        desc="rough V8", rpms=[750, 2000, 3400, 5000, 6200],
        P=dict(layout="V8x", kd=0.23, pipe=[(1.8, 0.5, 0.55), (2.0, 0.5, 0.55)], res=[(85, 5, 0.7), (190, 5, 0.6), (420, 4, 0.4)],
               rasp=2.0, muff=1900, click=0.12, click_mix=0.15, mech=0.12, intake=0.25, var=0.08, body=[(90, 5.0, 1.2)])),
    "engine_player_t3": dict(
        desc="big growly V8", rpms=[700, 1900, 3300, 4900, 6000],
        P=dict(layout="V8x", kd=0.20, pipe=[(2.4, 0.62, 0.6), (2.6, 0.62, 0.6)],
               res=[(65, 6, 0.9), (140, 6, 0.8), (310, 5, 0.5), (700, 4, 0.3)], rasp=2.6, muff=1600, click=0.10, click_mix=0.14,
               intake=0.30, var=0.06, body=[(80, 5.0, 1.2), (200, 2.0, 1.0)])),
    "engine_player_t4": dict(
        desc="supercharged V8 with gear/blower whine", rpms=[750, 2200, 3800, 5500, 6800],
        P=dict(layout="V8x", kd=0.19, pipe=[(2.4, 0.6, 0.55), (2.5, 0.6, 0.55)],
               res=[(70, 6, 0.8), (150, 6, 0.7), (330, 5, 0.6), (900, 4, 0.4)], rasp=2.0, muff=2800, click=0.10, click_mix=0.12,
               intake=0.35, var=0.05, body=[(85, 5.0, 1.2)], whine=dict(k=18.0, gain=0.42, rpm_full=6000, am=9))),
    "engine_sedan": dict(
        desc="thin inline-6 (sedan raiders)", rpms=[850, 2100, 3500, 5100, 6400],
        P=dict(layout="I6", kd=0.17, pipe=[(1.5, 0.45, 0.5)], res=[(180, 5, 0.6), (520, 4, 0.5), (1300, 3, 0.3)], rasp=1.5,
               muff=3400, click=0.08, click_mix=0.10, mech=0.10, mech_rate=6.0, intake=0.38, var=0.05, body=[(150, 3.0, 1.2)])),
    "engine_muscle": dict(
        desc="loud V8 with lopey idle", rpms=[650, 1900, 3300, 5000, 6300],
        P=dict(layout="V8x", kd=0.19, pipe=[(2.6, 0.66, 0.55), (2.3, 0.66, 0.55)],
               res=[(75, 6, 1.0), (155, 6, 0.9), (330, 5, 0.6), (720, 4, 0.4)], rasp=3.0, muff=2200, click=0.18, click_mix=0.2,
               intake=0.28, var=0.07, body=[(80, 5.0, 1.2)], lope=dict(pattern=V8_LOPE, miss=0.06))),
    "engine_buggy": dict(
        desc="raspy air-cooled 4-cylinder / buzzy two-stroke style", rpms=[1100, 2600, 4200, 5800, 7400],
        P=dict(layout="F4", kd=0.14, pipe=[(0.9, 0.55, 0.4), (1.0, 0.55, 0.4)], res=[(260, 5, 0.6), (700, 4, 0.6), (1700, 3, 0.4)],
               rasp=3.2, muff=4200, click=0.5, click_mix=0.4, click_bp=(1500, 6000), mech=0.45, mech_rate=5.0,
               mech_bp=(2500, 8000), intake=0.2, var=0.10, waver=0.03, body=[(200, 3.0, 1.2)])),
    "engine_diesel": dict(
        desc="heavy diesel (trucks, vans, tankers)", rpms=[600, 1000, 1500, 2000, 2600],
        P=dict(layout="I6", kd=0.13, pipe=[(2.2, 0.55, 0.6)], res=[(70, 6, 1.0), (150, 5, 0.7), (400, 4, 0.35)], rasp=1.6,
               muff=1300, click=0.5, click_mix=0.5, click_bp=(900, 3500), knock=0.9, knock_f=140, mech=0.22, mech_rate=3.0,
               intake=0.25, var=0.06, body=[(70, 5.0, 1.2)])),
    "engine_boss": dict(
        desc="huge turbo-diesel V12 (boss war rig), menacing", rpms=[520, 900, 1400, 1900, 2500],
        P=dict(layout="V12", kd=0.13, pipe=[(3.6, 0.7, 0.6), (3.4, 0.7, 0.6)], res=[(45, 7, 1.2), (95, 6, 1.0), (210, 5, 0.6), (500, 4, 0.3)],
               rasp=2.4, muff=1200, click=0.45, click_mix=0.45, click_bp=(700, 3000), knock=1.0, knock_f=90, mech=0.2, mech_rate=3.0,
               intake=0.3, var=0.05, body=[(55, 6.0, 1.2)], whine=dict(k=14.0, gain=0.16, rpm_full=2500, am=5))),
}

STAGE_DEPTH = dict(idle=1.0, low=0.8, mid=0.5, high=0.3, redline=0.15)
STAGE_WAVER = dict(idle=0.05, low=0.03, mid=0.02, high=0.015, redline=0.01)


def _engine_stage(ename, si):
    spec = ENGINES[ename]
    stage = STAGES[si]
    rpm = spec["rpms"][si]

    def fn(v, r):
        P = dict(spec["P"])
        P["waver"] = P.get("waver", 0.0) or STAGE_WAVER[stage]
        if "lope" in P:
            depth = STAGE_DEPTH[stage]
            pat = 1 + depth * (P["lope"]["pattern"] - 1)
            P["lope"] = dict(pattern=pat, miss=P["lope"]["miss"] * depth)
        if stage == "idle":
            P["var"] = P.get("var", 0.05) * 1.6
        y, L, f_fire = EL.build_engine(ename, rpm, P, r, dur=2.4)
        return y
    return fn


for _e, _spec in ENGINES.items():
    _lay = EL.LAYOUTS[_spec["P"]["layout"]]
    for _si, _st in enumerate(STAGES):
        _rpm = _spec["rpms"][_si]
        sound(G, f"{_e}_{_st}", n=1, loop=True, category="engine", norm=("lufs", STAGE_LUFS[_st]), rel_db=-1.0 * (4 - _si) * 0.0,
              notes=f"{_spec['desc']}; {_st} stage recorded at {_rpm} RPM (fire freq {_rpm / 60.0 * _lay['n'] / 2.0:.1f} Hz); "
                    f"crossfade neighbours, playbackRate = rpm/{_rpm}",
              extra=dict(engine=_e, stage=_st, rpm=_rpm, fireHz=round(_rpm / 60.0 * _lay["n"] / 2.0, 2), cylinders=_lay["n"],
                         engine_desc=_spec["desc"]))(_engine_stage(_e, _si))


# ==================================================================================================== forced induction
def _quant(f, L):
    return round(f * L / SR) * SR / L


@sound(G, "turbo_whine_loop", loop=True, category="vehicle_loop", norm=("lufs", -27.0), rel_db=-2,
       notes="turbine whistle, reference 3.3 kHz; playbackRate 0.5-1.6 with boost / rpm; layer with engine")
def turbo_whine_loop(v, r):
    L = secs(1.5)
    t = np.arange(L) / SR
    dur = L / SR
    f0 = _quant(3300, L)
    f1 = _quant(3300 * 1.031, L)
    vib = 1 + 0.004 * np.sin(2 * math.pi * 6 * t / dur * dur / 1.0 * 1.0) * 0
    a = np.sin(2 * math.pi * f0 * t) + 0.8 * np.sin(2 * math.pi * f1 * t + 1.1) + 0.35 * np.sin(2 * math.pi * _quant(6640, L) * t + 2)
    a *= 1 + 0.12 * np.sin(2 * math.pi * 4 * t / dur)
    air = dsp.bp(dsp.noise(L, r, 0), 4500, 9500, 1, loop=True)
    y = en(a) * 0.8 + en(air) * 0.35
    return y


@sound(G, "supercharger_whine_loop", loop=True, category="vehicle_loop", norm=("lufs", -27.0), rel_db=-2,
       notes="roots-blower / gear whine, reference 1.5 kHz; playbackRate follows rpm (0.5-1.5)")
def supercharger_whine_loop(v, r):
    L = secs(1.5)
    t = np.arange(L) / SR
    dur = L / SR
    f0 = _quant(1500, L)
    y = np.zeros(L)
    for h in range(1, 9):
        y += np.sin(2 * math.pi * _quant(f0 * h, L) * t + r.uniform(0, 6.28)) / h ** 1.15
    y *= 1 + 0.10 * np.sin(2 * math.pi * round(47 * dur) * t / dur)
    air = dsp.bp(dsp.noise(L, r, 0), 2200, 6500, 1, loop=True)
    return en(y) * 0.8 + en(air) * 0.22


@sound(G, "nitro_ignite", category="vehicle_fx", rel_db=0, notes="nitro / boost kick-in: whump + pssht + rising scream, 1.1 s")
def nitro_ignite(v, r):
    dur = 1.1
    n = secs(dur)
    t = tt(n)
    whump = np.tanh(1.3 * dsp.sweep(n, 95, 45, 0.08)) * dsp.ar_env(n, 0.004, 0.18)
    fc = 700 + 4500 * (1 - np.exp(-t / 0.12))
    ps = dsp.svf(_w(r, n), fc, 1.2, "bp") * dsp.ar_env(n, 0.012, 0.28)
    sc = dsp.saw(300 + 700 * (1 - np.exp(-t / 0.2)), n)
    sc = dsp.svf(sc, 2600, 1.5, "lp") * dsp.ar_env(n, 0.01, 0.3)
    pop = fo.tick(r, 900, 0.8, 0.01, dur=0.08)
    y = layers([(whump, 0.30, 0), (ps, 0.36, 0), (sc, 0.18, 0.03), (pop, 0.16, 0)], dur)
    return loud(y, 3)


@sound(G, "nitro_loop", loop=True, category="vehicle_loop", norm=("lufs", -22.0), rel_db=0,
       notes="nitro burn: flame roar + turbine whistle, seamless 1.6 s loop")
def nitro_loop(v, r):
    L = secs(1.6)
    t = np.arange(L) / SR
    dur = L / SR
    roar = en(dsp.bp(dsp.noise(L, r, 0.4), 250, 4500, 2, loop=True))
    flut = 1 + 0.35 * np.sin(2 * math.pi * round(110 * dur) * t / dur) + 0.2 * en(dsp.lp(dsp.noise(L, r, 0), 40, 1, loop=True))
    low = en(dsp.lp(dsp.noise(L, r, 1.5), 130, 2, loop=True))
    wh = np.sin(2 * math.pi * _quant(2600, L) * t + 0.4 * np.sin(2 * math.pi * 6 * t / dur))
    y = roar * np.clip(flut, 0.2, 2.5) + low * 0.5 + en(wh) * 0.22
    return np.tanh(y * 0.8)


@sound(G, "nitro_end", category="vehicle_fx", rel_db=-3, notes="nitro off: fading hiss, pitch-dropping whistle + crackling pops, 1.1 s")
def nitro_end(v, r):
    dur = 1.1
    n = secs(dur)
    t = tt(n)
    hiss = dsp.bp(_w(r, n), 1200, 7000, 1) * np.exp(-t / 0.22) * (1 - np.exp(-t / 0.01))
    wh = np.sin(2 * math.pi * np.cumsum(900 + 1700 * np.exp(-t / 0.18)) / SR) * np.exp(-t / 0.2)
    pops = np.zeros(n)
    for tp, a in [(0.05, 1.0), (0.17, 0.6), (0.3, 0.7), (0.46, 0.35), (0.62, 0.25)]:
        pops_ = fo.mix([(0, fo.thunk(r, 140, 0.012, 0.06, noise=1.6, tone=0.3), 1.0), (0, fo.tick(r, 1600, 1.0, 0.004, dur=0.03), 1.0)], 0.08)
        dsp.place(pops, pops_, secs(tp + r.uniform(-0.01, 0.01)), a)
    y = layers([(hiss, 0.4, 0), (wh, 0.15, 0), (pops, 0.45, 0)], dur)
    return loud(y, 2)


@sound(G, "backfire", n=3, category="vehicle_fx", rel_db=-3, notes="exhaust backfire bang + crackle, 0.6 s")
def backfire(v, r):
    dur = 0.65
    n = secs(dur)
    pop = dsp.bp(_w(r, n), 150 * (1 + 0.2 * v), 2600, 2) * dsp.ar_env(n, 0.0015, 0.03 + 0.008 * v)
    th = np.tanh(1.5 * dsp.sweep(n, 110, 48, 0.03)) * dsp.ar_env(n, 0.002, 0.07)
    crk = np.zeros(n)
    for k in range(3 + v):
        dsp.place(crk, fo.plus(fo.tick(r, r.uniform(700, 2500), 1.2, 0.003, dur=0.04), fo.thunk(r, 160, 0.01, 0.05, noise=1.5, tone=0.2)),
                  secs(r.uniform(0.07, 0.42)), r.uniform(0.2, 0.6))
    c = fo.tick(r, 3500, 0.8, 0.003, dur=0.02)
    y = layers([(pop, 0.42, 0), (th, 0.2, 0), (crk, 0.22, 0), (c, 0.16, 0)], dur)
    ir = dsp.reverb_ir(0.25, r, lp_start=4500, lp_end=800)
    w = dsp.convolve(dsp.lp(y, 3500, 1), ir)
    w *= math.sqrt(0.3 * np.sum(y ** 2) / np.sum(w ** 2))
    out = np.zeros(len(w))
    out[:n] += y
    out += w
    return loud(dsp.trim_silence(out, -60, 0.02), 4)


# ==================================================================================================== tyres, wind
@sound(G, "skid_loop", loop=True, category="vehicle_loop", norm=("lufs", -23.0), rel_db=0,
       notes="tyre squeal on asphalt (drift), seamless 1.6 s loop; gain by slip, pitch 0.85-1.25")
def skid_loop(v, r):
    L = secs(1.6)
    dur = L / SR
    t = np.arange(L) / SR
    f0 = _quant(1180, L)
    eps = en(dsp.lp(dsp.noise(L, r, 0), 9, 1, loop=True))
    eps = 0.014 * eps
    eps -= eps.mean()
    ph = 2 * math.pi * np.cumsum(f0 * (1 + eps)) / SR
    ph = ph - ph[0]
    # force integer number of cycles over the loop for seamlessness
    tot = f0 * dur + np.sum(f0 * eps) / SR
    ph = ph * (round(tot) / tot) if tot > 0 else ph
    sq = np.sin(ph) + 0.5 * np.sin(2 * ph + 0.6) + 0.25 * np.sin(3 * ph + 1.2)
    am = 1 + 0.25 * np.sin(2 * math.pi * round(37 * dur) * t / dur) + 0.25 * en(dsp.lp(dsp.noise(L, r, 0), 30, 1, loop=True))
    sq = sq * np.clip(am, 0.2, 2)
    rasp = en(dsp.bp(dsp.noise(L, r, 0), 1800, 6000, 1, loop=True)) * np.clip(am, 0.2, 2)
    low = en(dsp.bp(dsp.noise(L, r, 1), 200, 800, 1, loop=True))
    y = en(sq) * 1.0 + rasp * 0.30 + low * 0.10
    return np.tanh(y * 0.8)


@sound(G, "skid_gravel_loop", loop=True, category="vehicle_loop", norm=("lufs", -23.0), rel_db=0,
       notes="sliding on gravel / dirt: spray hiss + stone crackle, seamless 1.6 s loop")
def skid_gravel_loop(v, r):
    L = secs(1.6)
    spray = en(dsp.bp(dsp.noise(L, r, 0.3), 350, 5200, 2, loop=True))
    am = np.clip(1 + 0.6 * en(dsp.lp(dsp.noise(L, r, 0), 45, 1, loop=True)), 0.1, 2.5)
    low = en(dsp.lp(dsp.noise(L, r, 1.5), 200, 2, loop=True))
    grains = np.zeros(L)
    for _ in range(170):
        f = math.exp(r.uniform(math.log(600), math.log(4500)))
        dsp.place_wrap(grains, fo.tick(r, f, 1.5, 0.0012, dur=0.015), secs(r.uniform(0, 1.6)), r.uniform(0.2, 1.0))
    y = spray * am * 0.8 + low * 0.45 + en(grains) * 0.4
    return np.tanh(y * 0.8)


@sound(G, "tyre_asphalt_loop", loop=True, category="vehicle_loop", norm=("lufs", -25.0), rel_db=0,
       notes="road roar on asphalt; volume ~ speed^1, pitch 0.7-1.6 with speed; seamless 2 s loop")
def tyre_asphalt_loop(v, r):
    L = secs(2.0)
    t = np.arange(L) / SR
    dur = L / SR
    base = en(dsp.bp(dsp.noise(L, r, 1.0), 80, 1500, 2, loop=True))
    hum = en(np.sin(2 * math.pi * _quant(205, L) * t + 0.3) + 0.6 * np.sin(2 * math.pi * _quant(412, L) * t))
    hiss = en(dsp.bp(dsp.noise(L, r, 0.2), 1800, 5200, 1, loop=True))
    am = 1 + 0.18 * np.sin(2 * math.pi * round(1.5 * dur) * t / dur) + 0.12 * en(dsp.lp(dsp.noise(L, r, 0), 12, 1, loop=True))
    y = (base * 0.9 + hum * 0.16 + hiss * 0.28) * np.clip(am, 0.3, 2)
    return y


@sound(G, "tyre_dirt_loop", loop=True, category="vehicle_loop", norm=("lufs", -25.0), rel_db=0,
       notes="tyres on dirt / gravel road: rumble + stone rattle; pitch 0.7-1.5 with speed; 2 s loop")
def tyre_dirt_loop(v, r):
    L = secs(2.0)
    rum = en(dsp.lp(dsp.noise(L, r, 1.6), 700, 2, loop=True))
    mid = en(dsp.bp(dsp.noise(L, r, 0.5), 300, 3000, 1, loop=True))
    st = np.zeros(L)
    for _ in range(140):
        f = math.exp(r.uniform(math.log(500), math.log(3500)))
        dsp.place_wrap(st, fo.tick(r, f, 1.5, 0.0015, dur=0.02), secs(r.uniform(0, 2.0)), r.uniform(0.2, 1.0))
    am = np.clip(1 + 0.35 * en(dsp.lp(dsp.noise(L, r, 0), 10, 1, loop=True)), 0.3, 2)
    y = (rum * 0.9 + mid * 0.45) * am + en(st) * 0.32
    return y


@sound(G, "wind_loop", loop=True, category="vehicle_loop", norm=("lufs", -25.0), rel_db=0,
       notes="wind rush around the truck; volume ~ speed^1.5, pitch 0.7-1.6; 2.5 s loop")
def wind_loop(v, r):
    L = secs(2.5)
    t = np.arange(L) / SR
    dur = L / SR
    w = en(dsp.bp(dsp.noise(L, r, 1.0), 120, 3800, 2, loop=True))
    gust = 1 + 0.3 * np.sin(2 * math.pi * round(0.8 * dur) * t / dur + 1) + 0.2 * np.sin(2 * math.pi * round(2.2 * dur) * t / dur + 3) \
        + 0.15 * en(dsp.lp(dsp.noise(L, r, 0), 6, 1, loop=True))
    whistle = en(dsp.bpq(dsp.noise(L, r, 0), 1250, 22, 2, loop=True)) * (0.5 + 0.5 * np.sin(2 * math.pi * round(1.1 * dur) * t / dur))
    return (w * np.clip(gust, 0.2, 2.5) + whistle * 0.10)


# ==================================================================================================== suspension / body
def _thunk_suspension(r, f, size):
    th = fo.thunk(r, f, 0.05 * size, 0.3, noise=1.0, tone=0.9)
    sp = dsp.modal(secs(0.5), [f * 1.7, f * 2.6], [0.14 * size, 0.08 * size], [0.7, 0.35])
    rt = fo.rattle(r, 0.3, 45, 250, 1400, 0.006)
    mt = fo.metal_hit(r, 480 * r.uniform(0.9, 1.15), 0.05, k=4, click=0.3, dur=0.2)
    return layers([(th, 0.50, 0), (sp, 0.18, 0.01), (rt, 0.12, 0.03), (mt, 0.20, 0)], 0.55)


@sound(G, "suspension_thunk", n=3, category="vehicle_fx", rel_db=-3, notes="landing / bump: dull thunk + spring settle, 0.55 s")
def suspension_thunk(v, r):
    return loud(_thunk_suspension(r, [72, 86, 98][v] * r.uniform(0.96, 1.04), 1.0), 4)


@sound(G, "jump_land_heavy", category="vehicle_fx", rel_db=0, notes="hard landing after a jump: sub thump + suspension crash + rattle, 1.1 s")
def jump_land_heavy(v, r):
    dur = 1.1
    n = secs(dur)
    sub = np.tanh(1.5 * dsp.sweep(n, 70, 34, 0.07)) * dsp.ar_env(n, 0.002, 0.2)
    ken = samples.impact("Mining", 1, ratio=r.uniform(1.0, 1.2), length=0.5)
    cr = fo.crunch(r, 0.4, 350, 2800, 5, 0.03)
    sp = dsp.modal(secs(0.8), [120, 190, 320], [0.22, 0.14, 0.08], [0.7, 0.4, 0.25])
    rt = fo.rattle(r, 0.6, 55, 250, 1600, 0.006)
    gr = fo.pebbles(r, 0.5, 120, 500, 3500)
    y = layers([(sub, 0.32, 0), (ken, 0.24, 0), (cr, 0.14, 0.004), (sp, 0.10, 0.01), (rt, 0.10, 0.04), (gr, 0.10, 0.02)], dur)
    return loud(dsp.trim_silence(y, -62, 0.03), 5)


@sound(G, "hit_car_body", n=3, category="vehicle_fx", rel_db=-4, notes="bullet hits on the PLAYER truck body: heavier panel bong + thud")
def hit_car_body(v, r):
    f0 = [380, 450, 520][v] * r.uniform(0.97, 1.03)
    panel = fo.metal_hit(r, f0, 0.09, k=6, click=0.0, dur=0.35, spread=0.03)
    tk = fo.tick(r, 3200, 1.2, 0.002, dur=0.02)
    th = fo.thunk(r, 130, 0.025, 0.14, noise=1.0, tone=0.6)
    ken = samples.impact("Plate_medium", v, ratio=r.uniform(0.9, 1.2), length=0.25)
    y = layers([(tk, 0.10, 0), (panel, 0.35, 0.0005), (th, 0.25, 0), (ken, 0.30, 0)], 0.42)
    return loud(y, 6)


@sound(G, "gear_shift", n=2, category="vehicle_fx", rel_db=-6, notes="gear change: drivetrain clunk + blow-off chuff, 0.45 s")
def gear_shift(v, r):
    n = secs(0.5)
    t = tt(n)
    clunk = fo.thunk(r, 85 + 10 * v, 0.03, 0.15, noise=1.2, tone=0.6)
    tk = fo.tick(r, 1900, 1.5, 0.003, dur=0.03, ring=0.4, ring_f=700, ring_tau=0.03)
    chuff = dsp.hp(_w(r, n), 2200, 2) * np.exp(-t / 0.07) * (1 - np.exp(-t / 0.006))
    wh = dsp.saw(np.linspace(520, 260, n), n) * dsp.ar_env(n, 0.004, 0.08)
    wh = dsp.lp(wh, 1800, 1)
    y = layers([(clunk, 0.35, 0.05), (tk, 0.12, 0.05), (chuff, 0.35, 0), (wh, 0.18, 0.0)], 0.5)
    return loud(y, 4)


@sound(G, "oil_slick_splat", category="vehicle_fx", rel_db=-5, notes="oil slick deployed: wet splat + bubbles, 0.7 s")
def oil_slick_splat(v, r):
    dur = 0.7
    n = secs(dur)
    t = tt(n)
    splat = dsp.bp(_w(r, n), 400, 3200, 2) * dsp.ar_env(n, 0.003, 0.05)
    plop = np.sin(2 * math.pi * np.cumsum(90 + 200 * np.exp(-t / 0.04)) / SR) * dsp.ar_env(n, 0.002, 0.07)
    bub = np.zeros(n)
    for k in range(5):
        m = secs(0.05)
        tb = tt(m)
        f = r.uniform(280, 520)
        b = np.sin(2 * math.pi * np.cumsum(f * (1 + 1.6 * tb / 0.05)) / SR) * np.exp(-tb / 0.02)
        dsp.place(bub, b, secs(0.08 + 0.09 * k + r.uniform(0, 0.03)), r.uniform(0.3, 0.9))
    wet = dsp.bp(_w(r, n), 1500, 6000, 1) * dsp.ar_env(n, 0.01, 0.12) * 0.6
    y = layers([(splat, 0.35, 0), (plop, 0.25, 0), (bub, 0.25, 0), (wet, 0.15, 0.02)], dur)
    return loud(y, 4)


@sound(G, "mine_drop_beep", category="vehicle_fx", rel_db=-5, notes="mine dropped: clink + two arming beeps (2.1 kHz), 0.75 s")
def mine_drop_beep(v, r):
    dur = 0.8
    n = secs(dur)
    clink = fo.plus(fo.metal_hit(r, 900, 0.03, k=3, click=0.7, dur=0.12), fo.thunk(r, 130, 0.02, 0.1, noise=1.0, tone=0.5) * 0.7)

    def beep(f, d):
        m = secs(d)
        tb = tt(m)
        s = np.sin(2 * math.pi * f * tb) + 0.35 * np.sin(2 * math.pi * f * 2 * tb + 0.5) + 0.15 * np.sin(2 * math.pi * f * 3 * tb)
        return s * np.minimum(1, tb / 0.003) * np.minimum(1, (d - tb) / 0.008)
    y = layers([(clink, 0.25, 0), (beep(2100, 0.07), 0.3, 0.22), (beep(2100, 0.07), 0.3, 0.36), (beep(2800, 0.16), 0.3, 0.5)], dur)
    return y


@sound(G, "mine_explosion", category="explosion", rel_db=-3, notes="road mine blast: crack + dirt spray + medium boom, 2.3 s")
def mine_explosion(v, r):
    from g_explosions import SIZES, explosion, _shrapnel
    p = dict(SIZES["medium"], dur=2.3, sub=(88, 36, 0.12, 0.5), blast_tau=0.26, extra=_shrapnel, crack_f=2600, crack_tau=0.01,
             debris=(1.8, 20, 4), rt60=1.3, frac=dict(crack=0.10, blast=0.27, sub=0.20, rumble=0.22, debris=0.13))
    return explosion(r, p)


# ==================================================================================================== horns, brakes
def _horn(r, freqs, dur, buzz=0.5, lpf=3500):
    n = secs(dur)
    t = tt(n)
    y = np.zeros(n)
    for f in freqs:
        s = dsp.pulse(np.full(n, f), n, pw=0.42) + 0.5 * dsp.saw(np.full(n, f * 2.0), n) * 0.3
        s += buzz * 0.2 * np.sin(2 * math.pi * f * 3 * t)
        y += s
    y = dsp.lp(y, lpf, 2)
    y = y * (1 + 0.03 * np.sin(2 * math.pi * 31 * t))
    env = np.minimum(1, t / 0.025) * np.minimum(1, np.maximum(dur - t, 0) / 0.09)
    body = dsp.peak_eq(y * env, 900, 5, 1.2)
    return body


@sound(G, "horn", n=2, category="vehicle_fx", rel_db=-3, notes="horn: [0]=car honk (415+520 Hz), [1]=heavy truck horn (235+295 Hz); ~1 s sustained")
def horn(v, r):
    if v == 0:
        return _horn(r, [415, 520], 1.0, 0.5, 2300)
    return _horn(r, [233, 293, 175], 1.35, 0.7, 1700)


@sound(G, "brake_squeal", category="vehicle_fx", rel_db=-6, notes="brake squeal, 1.1 s (pitch 0.9-1.2)")
def brake_squeal(v, r):
    dur = 1.1
    n = secs(dur)
    t = tt(n)
    f = 3050 * (1 + 0.012 * np.sin(2 * math.pi * 5.5 * t) + 0.02 * (1 - t / dur))
    s = np.sin(2 * math.pi * np.cumsum(f) / SR) + 0.6 * np.sin(2 * math.pi * np.cumsum(f * 1.21) / SR + 1) + 0.3 * np.sin(2 * math.pi * np.cumsum(f * 0.5) / SR)
    rasp = dsp.bp(_w(r, n), 2500, 7000, 1)
    env = np.minimum(1, t / 0.06) * np.exp(-t / 0.55)
    y = (en(s) * 0.8 + en(rasp) * 0.3) * env
    return y


# ==================================================================================================== dynamic engine one-shots
def _dyn_pulses(rpm_curve, ncyl, r, layout, jitter=0.02, miss=0.0, amp_curve=None):
    n = len(rpm_curve)
    f_fire = rpm_curve / 60.0 * ncyl / 2.0
    phase = np.cumsum(f_fire) / SR
    k = np.floor(phase).astype(int)
    idx = np.nonzero(np.diff(k) > 0)[0]
    lay = EL.LAYOUTS[layout]
    times, amps, banks = [], [], []
    for j, i in enumerate(idx):
        a = 1 + jitter * r.standard_normal()
        if miss and r.random() < miss:
            a *= 0.2
        if amp_curve is not None:
            a *= amp_curve[i]
        times.append(i + r.uniform(-0.5, 0.5))
        amps.append(a)
        banks.append(lay["banks"][j % ncyl])
    return np.array(times), np.array(amps), np.array(banks)


@sound(G, "engine_start", category="vehicle_fx", rel_db=-3, notes="starter crank -> catch -> rev overshoot -> idle (~800 rpm), 3 s")
def engine_start(v, r):
    dur = 3.2
    n = secs(dur)
    t = tt(n)
    P = dict(ENGINES["engine_player_t2"]["P"])
    # rpm curve: crank at ~160 rpm for 0.9 s, catch, overshoot to 1500, settle to 800
    rpm = np.where(t < 0.95, 130 + 60 * np.minimum(t / 0.6, 1.0), 0.0)
    catch = np.clip((t - 0.95) / 0.35, 0, 1)
    rpm2 = 190 + (1500 - 190) * catch ** 0.8
    settle = np.exp(-(np.maximum(t - 1.4, 0)) / 0.5)
    rpm2 = np.where(t >= 1.4, 800 + 700 * settle, rpm2)
    rpm = np.where(t < 0.95, rpm, rpm2)
    # combustion only after catch (t>1.0): before that compression thumps
    times, amps, banks = _dyn_pulses(rpm, 8, r, "V8x", 0.04)
    ti = times / SR
    amps = np.where(ti < 1.0, amps * 0.0, amps)
    amps = np.where((ti >= 1.0) & (ti < 1.25), amps * (0.4 + 0.6 * r.random(len(amps))), amps)
    eng, L, ff = EL.build_engine("start", 1200, P, r, L=n, times=times, amps=amps, banks_seq=banks, loop=False)
    # cranking: dull compression thumps at low cyl rate + starter motor whine
    crank = np.zeros(n)
    tc = 0.02
    while tc < 1.0:
        dsp.place(crank, fo.thunk(r, 65, 0.035, 0.15, noise=1.0, tone=0.8), secs(tc), 0.6 + 0.4 * r.random())
        tc += 1.0 / (7 + 3 * min(tc / 0.6, 1))
    starter = dsp.saw(np.where(t < 1.15, 280 + 220 * np.minimum(t / 0.8, 1) + 20 * np.sin(2 * math.pi * 9 * t), 0), n)
    starter = dsp.lp(starter, 1600, 1) * np.where(t < 1.05, 1, np.exp(-(t - 1.05) / 0.06)) * dsp.ar_env(n, 0.01, 30.0)
    sol = fo.plus(fo.tick(r, 1200, 1.2, 0.005, dur=0.05), fo.thunk(r, 160, 0.015, 0.08, noise=1.0, tone=0.5))
    y = layers([(eng, 0.62, 0), (crank, 0.10, 0), (starter, 0.10, 0), (sol, 0.03, 0.0)], dur)
    return loud(y, 2)


@sound(G, "engine_stall", category="vehicle_fx", rel_db=-4, notes="engine dies: sputtering chugs slowing to a stop, 2.4 s")
def engine_stall(v, r):
    dur = 2.6
    n = secs(dur)
    t = tt(n)
    P = dict(ENGINES["engine_player_t2"]["P"])
    rpm = 780 * np.exp(-t / 0.55) * (1 + 0.25 * np.sin(2 * math.pi * 6 * t) * np.minimum(t / 0.6, 1))
    rpm = np.maximum(rpm, 0.0)
    times, amps, banks = _dyn_pulses(rpm, 8, r, "V8x", 0.25, miss=0.0)
    ti = times / SR
    keep = (rpm[np.clip(times.astype(int), 0, n - 1)] > 40)
    amps = np.where(keep, amps, 0) * np.exp(-ti / 0.9) * np.where(r.random(len(amps)) < (0.08 + 0.4 * (ti / 2.0)), 0.15, 1.0)
    eng, L, ff = EL.build_engine("stall", 1000, P, r, L=n, times=times, amps=amps, banks_seq=banks, loop=False)
    clunk = fo.thunk(r, 75, 0.05, 0.2, noise=1.0, tone=0.8)
    tick = fo.rattle(r, 0.6, 20, 1500, 4500, 0.003)
    y = layers([(eng, 0.85, 0), (clunk, 0.08, 1.2), (tick, 0.04, 1.9)], dur)
    return loud(dsp.trim_silence(y, -60, 0.05), 2)


@sound(G, "damaged_engine_loop", loop=True, category="vehicle_loop", norm=("lufs", -22.0), rel_db=0,
       notes="dying engine: misfires, rod knock, steam hiss; overlay on engine when HP low; seamless 2.4 s loop")
def damaged_engine_loop(v, r):
    P = dict(ENGINES["engine_player_t1"]["P"])
    P.update(var=0.35, tjit=0.05, mech=0.55, lope=dict(pattern=np.array([1.0, 0.5, 0.9, 0.2]), miss=0.22), waver=0.06, intake=0.2)
    y, L, ff = EL.build_engine("dmg", 880, P, r, dur=2.4)
    dur = L / SR
    knock = np.zeros(L)
    Tc = 120 / 880
    N = int(round(dur / Tc))
    for c in range(N):
        t0 = (c + r.uniform(0.0, 0.2)) * (L / N)
        k = fo.metal_hit(r, r.uniform(240, 330), 0.03, k=3, click=0.5, dur=0.14)
        dsp.place_wrap(knock, k, int(t0), 0.7 + 0.3 * r.random())
    steam = en(dsp.hp(dsp.noise(L, r, 0), 3500, 1, loop=True)) * np.clip(1 + 0.6 * en(dsp.lp(dsp.noise(L, r, 0), 5, 1, loop=True)), 0.1, 2)
    return en(y) * 0.8 + en(knock) * 0.5 + steam * 0.2
