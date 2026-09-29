"""g_guns.py - weapon fire, reload foley, grenades, shells."""
import math

import numpy as np

import dsp
import foley as fo
import samples
from dsp import SR, secs, tt
from render import sound

G = "guns"


# ============================================================================================ gunshot model
def _nz(r, n):
    return r.standard_normal(n)


def shot(r, p):
    """Layered gunshot: click + crack + blast + body resonance + thump (+ action clack) -> saturation -> outdoor tail."""
    j = lambda v, a=0.05: v * (1 + a * r.uniform(-1, 1))
    dur = p["dur"]
    n = secs(dur)
    t = tt(n)
    g = p.get("g", {})
    # 1. click (sub-ms transient)
    click = dsp.hp(_nz(r, n), 3500, 1) * np.exp(-t / 0.00022)
    click /= np.abs(click).max() + 1e-9
    # 2. crack: mid/high bandpassed noise, fast decay
    lo, hi = p["crack"][0], p["crack"][1]
    crack = dsp.bp(_nz(r, n), j(lo), j(hi), 2) * dsp.ar_env(n, 0.00005, j(p["crack"][2]))
    crack /= np.abs(crack).max() + 1e-9
    # 3. blast: swept lowpassed broadband noise (pressure wave)
    fc0, fc1, tb = p["blast"]
    fc = fc1 + (fc0 - fc1) * np.exp(-t / 0.018)
    blast = dsp.svf(_nz(r, n), fc, 0.8, "lp") * dsp.ar_env(n, 0.00015, j(tb))
    blast /= np.abs(blast).max() + 1e-9
    # 4. body resonance (weapon specific pitch)
    bf, bq, btau = p["body"]
    exc = _nz(r, n) * np.exp(-t / 0.0022)
    fb = j(bf) * (1 + 0.25 * np.exp(-t / 0.02))
    body = dsp.svf(exc, fb, bq, "bp") * dsp.ar_env(n, 0.0002, j(btau))
    body /= np.abs(body).max() + 1e-9
    # 5. thump: pitch-dropped sine
    tf0, tf1, tpt, ttau = p["thump"]
    th = dsp.sweep(n, j(tf0), j(tf1), tpt) * dsp.ar_env(n, 0.0012, j(ttau))
    th = np.tanh(1.6 * th)
    th /= np.abs(th).max() + 1e-9
    mixf = p.get("mix", dict(click=0.03, crack=0.27, blast=0.33, body=0.22, thump=0.15))
    en = lambda x: x / (math.sqrt(float(np.sum(x * x))) + 1e-12)
    dry = (en(click) * math.sqrt(mixf["click"]) + en(crack) * math.sqrt(mixf["crack"]) +
           en(blast) * math.sqrt(mixf["blast"]) + en(body) * math.sqrt(mixf["body"]) + en(th) * math.sqrt(mixf["thump"]))
    dry_e = float(np.sum(dry * dry))
    dry = dry / (np.abs(dry).max() + 1e-12)
    # 6. mechanical action clack
    if "action" in p:
        ad, af, ag = p["action"]
        m = fo.metal_hit(r, j(af), 0.018, k=4, click=0.6, dur=0.12)
        dsp.place(dry, m / (np.abs(m).max() + 1e-9), secs(ad), ag)
    # saturate + punch compress
    dry = np.tanh(dry * p.get("drive", 3.0)) / np.tanh(p.get("drive", 3.0))
    dry = dsp.compress(dry, -10.0, 3.0, 0.3, 60.0, makeup_db=1.0)
    # 7. outdoor tail: diffuse + slapback echoes
    rt60 = p["tail"]["rt60"]
    taps = [(j(tp, 0.08), tg) for tp, tg in p["tail"].get("taps", [])]
    ir = dsp.reverb_ir(rt60, r, lp_start=p["tail"].get("lp0", 7000), lp_end=p["tail"].get("lp1", 1600), early=taps,
                       early_gain=1.0, hp_f=140.0)
    ir[:secs(0.004)] = 0.0
    src = dsp.lp(dry, p["tail"].get("src_lp", 4500), 1)
    w = dsp.convolve(src, ir)
    wet_ratio = p["tail"].get("wet", 1.0)
    w *= math.sqrt(wet_ratio * np.sum(dry ** 2) / (np.sum(w ** 2) + 1e-12))
    out = np.zeros(max(len(w), n))
    out[:n] += dry
    out[:len(w)] += w
    # lift the tail slightly (gated-reverb "bloom") but keep the transient
    out = dsp.compress(out, -14.0, 2.0, 2.0, 220.0, makeup_db=2.0)
    out = dsp.trim_silence(out, -66.0, 0.02)
    out = loud(out, p.get("loud", 6.0))
    return out


def loud(x, amount_db=6.0, ceiling_db=-1.5):
    """Loudness maximiser: normalise, boost, brick-wall limit (short look-ahead) -> higher body vs transient."""
    x = dsp.normalize_peak(x, ceiling_db)
    return dsp.limit(x * dsp.db(amount_db), ceiling_db, 0.8, 35.0)


# ---- weapon parameter sets -------------------------------------------------------------------------------
W = {
    "pistol": dict(mix=dict(click=0.03, crack=0.30, blast=0.36, body=0.23, thump=0.08), dur=0.8, crack=(2000, 7500, 0.004), blast=(5500, 900, 0.028), body=(720, 5, 0.030),
                   thump=(150, 78, 0.025, 0.030), action=(0.028, 3200, 0.10),
                   tail=dict(rt60=0.5, taps=[(0.055, 0.30), (0.13, 0.16)], wet=0.9)),
    "revolver": dict(mix=dict(click=0.02, crack=0.20, blast=0.30, body=0.22, thump=0.26), dur=1.4, crack=(1300, 6000, 0.006), blast=(4800, 520, 0.050), body=(390, 4, 0.070),
                     thump=(120, 48, 0.055, 0.085), g=dict(thump=1.0, body=0.75),
                     tail=dict(rt60=1.0, taps=[(0.085, 0.34), (0.19, 0.20), (0.33, 0.11)], wet=1.2)),
    "smg": dict(mix=dict(click=0.04, crack=0.36, blast=0.36, body=0.20, thump=0.04), dur=0.5, crack=(2600, 8500, 0.0032), blast=(6500, 1300, 0.018), body=(980, 6, 0.018),
                thump=(180, 100, 0.018, 0.020), action=(0.022, 3800, 0.13), g=dict(thump=0.55, crack=1.05),
                tail=dict(rt60=0.32, taps=[(0.042, 0.26)], wet=0.7)),
    "shotgun": dict(mix=dict(click=0.01, crack=0.13, blast=0.30, body=0.20, thump=0.36), dur=2.0, crack=(900, 4800, 0.010), blast=(3800, 240, 0.100), body=(230, 3, 0.10),
                    thump=(95, 36, 0.070, 0.13), g=dict(thump=1.15, blast=1.1, body=0.7),
                    tail=dict(rt60=1.5, taps=[(0.11, 0.32), (0.24, 0.22), (0.41, 0.13)], wet=1.5)),
    "rifle": dict(mix=dict(click=0.03, crack=0.25, blast=0.32, body=0.20, thump=0.20), dur=1.7, crack=(1800, 9500, 0.0055), blast=(5800, 620, 0.042), body=(540, 4, 0.048),
                  thump=(135, 56, 0.045, 0.065), action=(0.04, 2900, 0.09), g=dict(crack=1.1),
                  tail=dict(rt60=1.3, taps=[(0.09, 0.30), (0.21, 0.17), (0.40, 0.10)], wet=1.3)),
    "lmg": dict(mix=dict(click=0.02, crack=0.20, blast=0.30, body=0.22, thump=0.26), dur=1.0, crack=(1400, 7500, 0.0055), blast=(4800, 420, 0.048), body=(310, 4, 0.055),
                thump=(105, 43, 0.050, 0.075), action=(0.05, 2100, 0.10), g=dict(thump=1.1, blast=1.0),
                tail=dict(rt60=0.65, taps=[(0.07, 0.28), (0.15, 0.14)], wet=1.0)),
    "sniper": dict(mix=dict(click=0.01, crack=0.16, blast=0.30, body=0.20, thump=0.33), dur=3.4, crack=(1500, 10500, 0.008), blast=(6200, 330, 0.095), body=(260, 3, 0.13),
                   thump=(92, 30, 0.080, 0.16), g=dict(crack=1.2, thump=1.2, blast=1.05),
                   tail=dict(rt60=2.8, taps=[(0.13, 0.36), (0.30, 0.26), (0.56, 0.18), (0.95, 0.10)], wet=1.8, lp1=700),),
}


def _gun(name, n, **over):
    def fn(v, r):
        p = dict(W[name])
        p.update(over)
        return shot(r, p)
    return fn


for _nm, _n, _cat in [("pistol", 3, "gun_fire"), ("revolver", 3, "gun_fire"), ("smg", 4, "gun_fire"),
                      ("shotgun", 3, "gun_fire"), ("rifle", 4, "gun_fire"), ("lmg", 4, "gun_fire"),
                      ("sniper", 2, "gun_fire")]:
    _rel = dict(pistol=-5, revolver=-2, smg=-6, shotgun=-1, rifle=-3, lmg=-2, sniper=0)[_nm]
    sound(G, f"fire_{_nm}", n=_n, category=_cat, rel_db=_rel,
          notes=f"{_nm} shot with outdoor tail; play at pitch 0.94-1.06 for extra variation")(_gun(_nm, _n))


# ---- RPG launch + rocket flight ----------------------------------------------------------------------------
@sound(G, "fire_rpg", n=2, category="gun_fire", rel_db=0.0, notes="launch: tube pop + ignition whoosh + backblast thump")
def fire_rpg(v, r):
    dur = 2.4
    n = secs(dur)
    t = tt(n)
    pop = dsp.hp(_nz(r, n), 800, 1) * np.exp(-t / 0.004)
    pop /= np.abs(pop).max()
    th = np.tanh(1.5 * dsp.sweep(n, 110, 38, 0.10) * dsp.ar_env(n, 0.002, 0.28))
    # ignition roar: noise swelling then decaying, lowpass sweeping down
    fc = 200 + 3400 * np.exp(-t / 0.35) + 300
    roar = dsp.svf(_nz(r, n), fc, 0.9, "lp") * dsp.ar_env(n, 0.05, 0.55, 0.8)
    roar /= np.abs(roar).max()
    # whoosh (rocket leaving)
    wh = fo.whoosh(r, 1.2, 500, 2600, 1.0, 0.25, 1.5)
    hiss = dsp.bp(_nz(r, n), 2500, 9000, 1) * dsp.ar_env(n, 0.03, 0.35)
    hiss /= np.abs(hiss).max()
    y = pop * 0.5 + th * 1.0 + roar * 0.95 + hiss * 0.25
    dsp.place(y, wh, secs(0.05), 0.55)
    y = np.tanh(y * 1.4)
    ir = dsp.reverb_ir(1.8, r, lp_start=4500, lp_end=600, early=[(0.12, 0.3), (0.3, 0.2), (0.6, 0.12)])
    ir[:secs(0.006)] = 0
    w = dsp.convolve(dsp.lp(y, 3500, 1), ir)
    w *= math.sqrt(1.2 * np.sum(y ** 2) / np.sum(w ** 2))
    out = np.zeros(len(w))
    out[:n] += y
    out += w
    out = dsp.compress(out, -12, 2.5, 3, 200, 2.0)
    return dsp.trim_silence(out, -66, 0.02)


@sound(G, "rocket_loop", loop=True, category="gun_loop", norm=("lufs", -20.0), rel_db=-4,
       notes="rocket motor flight loop, 1.6 s seamless; scale gain with distance, pitch 0.9-1.15 (doppler)")
def rocket_loop(v, r):
    n = secs(1.6)
    t = tt(n)
    en = lambda x: x / (dsp.rms(x) + 1e-12)
    roar = en(dsp.bp(dsp.noise(n, r, 0.5), 180, 4500, 2, loop=True))
    flutter = 1 + 0.35 * np.sin(2 * math.pi * (40 / 1.6) * t) + 0.2 * np.sin(2 * math.pi * (97 / 1.6) * t + 2)
    turb = 1 + 0.5 * en(dsp.lp(dsp.noise(n, r, 0), 30, 1, loop=True))
    hiss = en(dsp.hp(dsp.noise(n, r, 0), 3000, 1, loop=True))
    low = en(dsp.lp(dsp.noise(n, r, 1.5), 140, 2, loop=True))
    y = roar * flutter * np.clip(turb, 0.3, 2.0) * 1.0 + hiss * 0.35 + low * 0.7
    y = np.tanh(y * 0.9)
    return y


@sound(G, "fire_enemy_light", n=3, category="gun_enemy", rel_db=-8,
       notes="raider light gun (distant, flatter, midrangey); positional")
def fire_enemy_light(v, r):
    p = dict(W["smg"] if v != 1 else W["pistol"])
    p["dur"] = 0.75
    p["tail"] = dict(rt60=0.7, taps=[(0.09, 0.32), (0.21, 0.2)], wet=1.6, src_lp=3000, lp0=4000, lp1=700)
    p["blast"] = (3200, 900, 0.03)
    p["crack"] = (1500, 4200, 0.004)
    p["mix"] = dict(click=0.01, crack=0.20, blast=0.40, body=0.30, thump=0.09)
    y = shot(r, p)
    y = dsp.lp(y, 4800, 2)
    return y


@sound(G, "fire_enemy_heavy", n=3, category="gun_enemy", rel_db=-4,
       notes="raider heavy gun / shotgun (distant, chunky); positional")
def fire_enemy_heavy(v, r):
    p = dict(W["rifle"] if v != 2 else W["shotgun"])
    p["dur"] = 1.6
    p["tail"] = dict(rt60=1.2, taps=[(0.12, 0.34), (0.27, 0.22), (0.5, 0.12)], wet=1.8, src_lp=2600, lp0=3500, lp1=600)
    p["blast"] = (3000, 400, 0.06)
    p["crack"] = (1100, 3600, 0.006)
    p["mix"] = dict(click=0.01, crack=0.14, blast=0.38, body=0.30, thump=0.17)
    y = shot(r, p)
    y = dsp.lp(y, 4200, 2)
    return y


@sound(G, "dry_click", category="gun_foley", rel_db=-8, notes="empty-chamber hammer click")
def dry_click(v, r):
    a = fo.tick(r, 3300, 3.0, 0.0025, dur=0.08, ring=0.5, ring_f=4600, ring_tau=0.02)
    b = fo.thunk(r, 480, 0.012, 0.06, noise=0.5)
    y = fo.mix([(0.0, a, 1.0), (0.0, b, 0.35), (0.028, fo.tick(r, 2400, 3, 0.002, dur=0.05), 0.4)], 0.13)
    return y


# ============================================================================================ reload foley
def _clack(r, f=2400, weight=1.0, body=300, dur=0.16, ringf=None):
    """Metal seat/slam: real latch click layer + synthetic tick + body thunk + very short damped ring."""
    ringf = ringf or f * 1.9
    a = fo.tick(r, f, 2.5, 0.0028, dur=0.06, ring=0.15, ring_f=ringf, ring_tau=0.006 + 0.006 * weight)
    b = fo.thunk(r, body, 0.008 + 0.008 * weight, dur=0.10, noise=1.3, tone=0.3, ncut=3.0)
    m = fo.metal_hit(r, f * 0.55, 0.010 * weight + 0.004, k=4, click=0.0, dur=0.08)
    k = samples.rpg("metalLatch" if r.random() < 0.6 else "metalClick", ratio=f / 2600.0 * r.uniform(0.95, 1.05),
                    length=0.12, gain=0.7)
    y = fo.mix([(0, a, 1.0), (0, b, 0.65 * weight), (0.001, m, 0.12), (0.0, k, 0.55 / max(weight, 0.6))], dur)
    return y


def _seq(r, dur, items):
    return fo.mix(items, dur)


def _mag_out(r, f, weight, body, v):
    j = 1 + 0.05 * r.uniform(-1, 1)
    rel = fo.tick(r, f * 1.3 * j, 3, 0.003, dur=0.05, ring=0.3, ring_f=f * 2.6, ring_tau=0.015)
    sl = fo.friction(r, 0.11 + 0.03 * weight, f * 0.7, f * 1.8, 2.0, 0.7)
    drop = _clack(r, f * 0.55 * j, 0.6 * weight, body * 0.8, 0.14)
    return fo.mix([(0.0, rel, 0.9), (0.02, sl, 0.35), (0.05 + 0.03 * weight, drop, 0.5)], 0.38)


def _mag_in(r, f, weight, body):
    j = 1 + 0.05 * r.uniform(-1, 1)
    sl = fo.friction(r, 0.10 + 0.03 * weight, f * 1.6, f * 0.8, 2.0, 0.65)
    seat = _clack(r, f * j, weight, body, 0.18)
    latch = fo.tick(r, f * 1.5, 3, 0.002, dur=0.04, ring=0.3, ring_f=f * 3, ring_tau=0.012)
    return fo.mix([(0.0, sl, 0.4), (0.12 + 0.03 * weight, seat, 1.0), (0.17 + 0.03 * weight, latch, 0.5)], 0.42)


def _slide(r, f, weight, body, back=0.09, gap=0.07):
    j = 1 + 0.04 * r.uniform(-1, 1)
    b = fo.friction(r, back, f * 0.6, f * 1.5, 2.2, 0.8)
    sp = fo.spring(r, 0.12, f * 0.6, 0.05)
    fw = fo.friction(r, 0.05, f * 1.2, f * 0.7, 2.0, 0.6)
    slam = _clack(r, f * 1.15 * j, weight, body, 0.2)
    t2 = back + gap
    return fo.mix([(0.0, b, 0.55), (back * 0.5, sp, 0.05), (t2, fw, 0.3), (t2 + 0.045, slam, 1.0)], t2 + 0.3)


def _reg(name, n, fn, rel=-10, notes="", cat="gun_foley"):
    sound(G, name, n=n, category=cat, rel_db=rel, notes=notes)(fn)


_reg("pistol_mag_out", 1, lambda v, r: _mag_out(r, 3000, 0.7, 320, v), -9)
_reg("pistol_mag_in", 1, lambda v, r: _mag_in(r, 2900, 0.7, 330), -8)
_reg("pistol_slide", 1, lambda v, r: _slide(r, 3000, 0.8, 340), -7)
_reg("smg_mag_out", 1, lambda v, r: _mag_out(r, 2400, 1.0, 260, v), -8)
_reg("smg_mag_in", 1, lambda v, r: _mag_in(r, 2300, 1.0, 270), -7)
_reg("smg_bolt", 1, lambda v, r: _slide(r, 2300, 1.0, 250, 0.12, 0.09), -6)
_reg("rifle_mag_out", 1, lambda v, r: _mag_out(r, 2000, 1.3, 210, v), -8)
_reg("rifle_mag_in", 1, lambda v, r: _mag_in(r, 1900, 1.3, 220), -6)
_reg("rifle_bolt", 1, lambda v, r: _slide(r, 1900, 1.3, 200, 0.14, 0.10), -5)


def _shell_in(v, r):
    j = 1 + 0.08 * r.uniform(-1, 1)
    hull = fo.thunk(r, 560 * j, 0.016, 0.07, noise=0.6)
    tube = dsp.modal(secs(0.1), [1150 * j, 2350 * j], [0.03, 0.015], [0.5, 0.25])
    lat = fo.tick(r, 3600 * j, 3, 0.0018, dur=0.04, ring=0.3, ring_f=5200, ring_tau=0.012)
    return fo.mix([(0, hull, 0.9), (0, tube, 0.5), (0.028, lat, 0.7), (0.05, fo.thunk(r, 300, 0.01, 0.04), 0.3)], 0.22)


_reg("shotgun_shell_in", 4, _shell_in, -8)


def _pump(v, r):
    j = 1 + 0.03 * r.uniform(-1, 1)
    b = fo.friction(r, 0.14, 350, 900, 1.6, 0.9, res=0.3, res_f=1100)
    rattle = fo.rattle(r, 0.12, 90, 900, 3500, 0.004)
    fw = fo.friction(r, 0.08, 800, 400, 1.6, 0.8)
    slam = _clack(r, 1500 * j, 1.5, 150, 0.28)
    lock = fo.tick(r, 3000, 3, 0.002, dur=0.05, ring=0.4, ring_f=4200, ring_tau=0.02)
    return fo.mix([(0, b, 0.6), (0.03, rattle, 0.12), (0.26, fw, 0.4), (0.33, slam, 1.0), (0.34, lock, 0.4)], 0.75)


_reg("shotgun_pump", 1, _pump, -3)


def _lmg_cover_open(v, r):
    creak = fo.friction(r, 0.22, 260, 720, 4.0, 0.9, res=0.4, res_f=650)
    hit = _clack(r, 850, 2.0, 110, 0.4)
    latch = fo.tick(r, 2200, 3, 0.003, dur=0.06, ring=0.4, ring_f=3300, ring_tau=0.03)
    return fo.mix([(0, latch, 0.7), (0.03, creak, 0.4), (0.24, hit, 1.0)], 0.7)


def _lmg_belt_in(v, r):
    ch = fo.rattle(r, 0.55, 42, 1800, 5200, 0.0045, shape=lambda u: 0.4 + 0.6 * math.sin(math.pi * min(u * 1.1, 1)))
    thk = fo.thunk(r, 210, 0.03, 0.12, 0.6)
    return fo.mix([(0, ch, 0.9), (0.02, fo.friction(r, 0.3, 700, 1800, 2, 0.9), 0.25), (0.32, thk, 0.5)], 0.68)


def _lmg_cover_close(v, r):
    s = _clack(r, 700, 2.4, 95, 0.5)
    l = fo.tick(r, 2600, 3, 0.003, dur=0.06, ring=0.5, ring_f=3900, ring_tau=0.035)
    fr = fo.friction(r, 0.13, 300, 800, 3.0, 0.8, res=0.3, res_f=700)
    return fo.mix([(0, fr, 0.35), (0.10, s, 1.0), (0.13, l, 0.6)], 0.6)


def _lmg_rack(v, r):
    b = fo.friction(r, 0.18, 260, 800, 2.0, 0.9, res=0.25, res_f=900)
    sp = fo.spring(r, 0.15, 500, 0.08)
    slam = _clack(r, 900, 2.0, 120, 0.4)
    return fo.mix([(0, b, 0.6), (0.05, sp, 0.05), (0.32, slam, 1.0), (0.33, fo.tick(r, 2800, 3, 0.002, dur=0.05), 0.4)], 0.8)


_reg("lmg_cover_open", 1, _lmg_cover_open, -4)
_reg("lmg_belt_in", 1, _lmg_belt_in, -8)
_reg("lmg_cover_close", 1, _lmg_cover_close, -3)
_reg("lmg_rack", 1, _lmg_rack, -4)


def _sniper_bolt_open(v, r):
    lift = fo.tick(r, 2600, 3, 0.003, dur=0.06, ring=0.3, ring_f=3900, ring_tau=0.02)
    sl = fo.friction(r, 0.16, 900, 2200, 1.8, 0.5, res=0.2, res_f=2500)
    stop = _clack(r, 2100, 1.0, 220, 0.2)
    return fo.mix([(0, lift, 0.8), (0.04, sl, 0.45), (0.21, stop, 0.8)], 0.5)


def _sniper_bolt_close(v, r):
    sl = fo.friction(r, 0.14, 2200, 900, 1.8, 0.5, res=0.2, res_f=2000)
    seat = _clack(r, 1800, 1.2, 200, 0.22)
    down = fo.tick(r, 2900, 3, 0.003, dur=0.06, ring=0.35, ring_f=4200, ring_tau=0.025)
    return fo.mix([(0, sl, 0.45), (0.15, seat, 0.9), (0.22, down, 0.8)], 0.55)


def _sniper_mag(v, r):
    a = fo.friction(r, 0.09, 1100, 2000, 2.0, 0.6)
    s = _clack(r, 1500, 0.9, 190, 0.16)
    return fo.mix([(0, a, 0.35), (0.09, s, 1.0), (0.13, fo.tick(r, 2600, 3, 0.002, dur=0.04), 0.4)], 0.38)


_reg("sniper_bolt_open", 1, _sniper_bolt_open, -6)
_reg("sniper_bolt_close", 1, _sniper_bolt_close, -6)
_reg("sniper_mag", 1, _sniper_mag, -8)


def _rpg_reload(v, r):
    sl = fo.friction(r, 0.55, 200, 700, 1.4, 0.9, shape=0.5, res=0.35, res_f=600)
    rat = fo.rattle(r, 0.4, 30, 400, 1800, 0.005)
    lock = _clack(r, 700, 2.2, 90, 0.5)
    ck = fo.tick(r, 2600, 3, 0.003, dur=0.06, ring=0.5, ring_f=3600, ring_tau=0.03)
    return fo.mix([(0, sl, 0.7), (0.1, rat, 0.15), (0.58, lock, 1.0), (0.62, ck, 0.6)], 1.15)


_reg("rpg_reload", 1, _rpg_reload, -4)


def _weapon_swap(v, r):
    cl = fo.cloth(r, 0.16, 1.0, 600, 4500, bursts=3 + v)
    hd = fo.thunk(r, 210 * (1 + 0.15 * v), 0.022, 0.1, 0.7)
    st = fo.tick(r, 2200 + 500 * v, 3, 0.003, dur=0.06, ring=0.3, ring_f=3300, ring_tau=0.02)
    return fo.mix([(0, cl, 0.55), (0.05, hd, 0.55), (0.09, st, 0.6), (0.11 + 0.02 * v, fo.cloth(r, 0.1, 1, 800, 5000, 2), 0.25)], 0.38)


_reg("weapon_swap", 2, _weapon_swap, -8)


def _grenade_pin(v, r):
    pull = fo.friction(r, 0.06, 1200, 3200, 3, 0.5)
    ping = fo.ring([5400, 8100, 3600], [0.16, 0.07, 0.10], [0.7, 0.3, 0.3], 0.5)
    spoon = fo.metal_hit(r, 2600, 0.05, k=4, click=0.7, dur=0.25)
    return fo.mix([(0, pull, 0.5), (0.055, ping, 0.35), (0.08, fo.tick(r, 3500, 3, 0.002, dur=0.05), 0.5), (0.13, spoon, 0.6)], 0.5)


def _grenade_throw(v, r):
    w = fo.whoosh(r, 0.32, 350, 1600, 0.9, 0.35, 1.3)
    cl = fo.cloth(r, 0.18, 1, 500, 3500, 3)
    return fo.mix([(0, cl, 0.4), (0.03, w, 0.55)], 0.4)


def _grenade_bounce(v, r):
    j = 1 + 0.1 * (v - 1) + 0.03 * r.uniform(-1, 1)
    th = fo.thunk(r, 170 * j, 0.03, 0.12, 0.7)
    m = fo.metal_hit(r, 880 * j, 0.11, k=5, click=0.6, dur=0.5, ratios=[1.0, 2.32, 4.13, 6.6, 9.7])
    tk = fo.tick(r, 3200 * j, 2, 0.003, dur=0.05)
    gr = dsp.bp(r.standard_normal(secs(0.06)), 1200, 4000, 1) * dsp.exp_env(secs(0.06), 0.015)
    return fo.mix([(0, th, 0.9), (0, m, 0.7), (0, tk, 0.5), (0.005, gr, 0.3)], 0.55)


_reg("grenade_pin", 1, _grenade_pin, -6)
_reg("grenade_throw", 1, _grenade_throw, -9)
_reg("grenade_bounce", 3, _grenade_bounce, -6)


def _shell_brass(v, r):
    j = 1 + 0.12 * r.uniform(-1, 1)
    f0 = 4300 * j
    bounces = [(0.0, 1.0), (0.062 + 0.01 * v, 0.55), (0.105 + 0.015 * v, 0.28), (0.135 + 0.02 * v, 0.12)]
    dur = 0.5
    y = np.zeros(secs(dur))
    for k, (t0, a) in enumerate(bounces):
        ff = f0 * (1 + 0.04 * r.uniform(-1, 1))
        m = fo.ring([ff, ff * 1.52, ff * 2.13, ff * 0.61], [0.07, 0.04, 0.025, 0.05], [1, 0.5, 0.3, 0.3], 0.3)
        c = fo.tick(r, 5500, 2, 0.001, dur=0.02)
        dsp.place(y, m, secs(t0), a)
        dsp.place(y, c, secs(t0), a * 0.4)
    return y


def _shell_shotgun(v, r):
    j = 1 + 0.10 * r.uniform(-1, 1)
    f0 = 1700 * j
    bounces = [(0.0, 1.0), (0.085 + 0.01 * v, 0.5), (0.14 + 0.015 * v, 0.24)]
    y = np.zeros(secs(0.55))
    for t0, a in bounces:
        ff = f0 * (1 + 0.05 * r.uniform(-1, 1))
        m = fo.ring([ff, ff * 2.05, ff * 3.4, ff * 0.5], [0.028, 0.02, 0.012, 0.03], [1, 0.4, 0.2, 0.5], 0.2)
        c = fo.thunk(r, 350 * j, 0.008, 0.04, 0.8)
        dsp.place(y, m, secs(t0), a)
        dsp.place(y, c, secs(t0), a * 0.6)
    return y


_reg("shell_drop_brass", 4, _shell_brass, -12)
_reg("shell_drop_shotgun", 3, _shell_shotgun, -11)
