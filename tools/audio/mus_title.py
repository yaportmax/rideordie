"""mus_title.py - TITLE screen loop: D natural minor, 104 BPM, 16 bars (~36.9 s), single stereo loop, about -16 LUFS.

Epic / moody: low drone + strings pad, a four-bar horn theme (A D F E | D C Bb D | F E C A | E D C) played softly, then
full, an answering B section, then the peak; taiko toms, half-time backbeat, 16th pulse arp, choir, riser into the loop.
Chords: Dm Bb F C | Dm Bb F C | Gm Bb F C | Dm Bb F C  (i VI III VII ... iv VI III VII)
"""
import numpy as np

import dsp
import music_lib as M
import mus_rock as R
from dsp import SR
from music_lib import Grid, Scale, Human, put, parse_notes, mtof

SPEC = dict(track="title", bpm=104, bars=16, key="D minor", tonic=62, mode="minor", kind="loop",
            srcs=["music_lib.py", "mus_rock.py", "mus_title.py"], outputs=[("title_loop", "mix", 0)],
            sections=[(1, "drone + horn"), (5, "theme + drums"), (9, "answer + choir"), (13, "peak")],
            notes="TITLE screen loop: D minor 104 BPM, 16 bars, ~-16 LUFS, epic/moody horn theme")

# root degrees rel. D4: Dm Bb F C | Dm Bb F C | Gm Bb F C | Dm Bb F C
PROG = [0, -2, 2, -1] * 2 + [3, -2, 2, -1] + [0, -2, 2, -1]
BASS = ["R--- ---- ---- ----"] * 4 + ["R-R- R-R- R-R- R-R-"] * 4 + (["R-R- R-R- R-R- R-RO"] * 8)
BASS_OPEN = [500.0] * 4 + [800.0] * 4 + [1100.0] * 4 + [1400.0] * 4
PAD_LIFT = [0.7] * 4 + [1.0] * 4 + [1.3] * 4 + [1.6] * 4

THEME = {0: "0:4=4 4:4=7 8:6=9 14:2=8", 1: "0:6=7 6:2=6 8:4=5 12:4=7", 2: "0:6=9 6:2=8 8:4=6 12:4=4", 3: "0:6=8 6:2=7 8:8=6"}
ANSWER = {8: "0:6=10 6:2=9 8:4=7 12:4=5", 9: "0:8=9 8:4=7 12:4=5", 10: "0:8=9 8:4=6 12:4=4", 11: "0:4=6 4:4=8 8:8=10"}
LEAD = {}
for b in range(4):
    LEAD[b] = parse_notes(THEME[b])
    LEAD[4 + b] = parse_notes(THEME[b])
    LEAD[12 + b] = parse_notes(THEME[b])
for b, s_ in ANSWER.items():
    LEAD[b] = parse_notes(s_)

NONE = "................"
KICK = [NONE] * 4 + ["x.....7.....5..."] * 4 + ["x.....7...x.5..."] * 4 + ["x.....7...x.5.7."] * 4
SNARE = [NONE] * 4 + ["........x......."] * 4 + ["........x......."] * 4 + ["....x.......x..."] * 4
SNARE[7] = "........x.5.6.7x"
SNARE[11] = "........x...5.7x"
SNARE[15] = "....x...x.5.6.7x"
CLAP = [NONE] * 8 + ["........5......."] * 4 + ["....6.......6..."] * 4
HAT_C = [NONE] * 4 + ["5.3.5.3.5.3.5.3."] * 4 + ["5.3.5.3.5.3.5.3."] * 4 + ["5.3.5.3.5.3.5.3."] * 4
TOM_L = ["x..............."] * 4 + [NONE] * 4 + ["....x.......x..."] * 4 + ["x...x...x...x..."] * 4
TOM_M = [NONE] * 16
TOM_H = [NONE] * 16
TOM_L[3] = "x...........x.x."
TOM_M[3] = "..........x.x.x."
TOM_M[7] = "..........x.7.5."
TOM_L[7] = "............x.x."
TOM_M[11] = "..........x.x.x."
TOM_L[11] = "............x.x."
TOM_H[15], TOM_M[15], TOM_L[15] = "........x7x7x.x.", "..........x7x7x.", "............x7x7"
ARP = [None] * 4 + ["A8"] * 4 + ["D8"] * 4 + ["B"] * 4


def level(x, target_lufs):
    return x * 10 ** ((target_lufs - M.lufs(x)) / 20.0)


def build():
    g = Grid(SPEC["bpm"], SPEC["bars"])
    sc = Scale(SPEC["tonic"], SPEC["mode"])
    r = dsp.rng("title")
    hum = Human(r, ms=2.5, vel=0.06)
    beats = [b * 4 for b in range(g.bars * 4)]
    parts = {}

    bass = R.bass_stem(g, sc, PROG, BASS, BASS_OPEN, r, hum, beats, lo=28,
                       params=dict(wave="saw", close=170.0, res=0.28, drive=2.2, sub=0.5, det=5.0, tau_f=0.11, gate=0.92, rel=0.09),
                       duck=(0.25, 0.08), bus=dict(hp_f=40, lp_f=3000, sat=1.2, comp=(-18.0, 2.5, 10.0, 150.0, 0.0)))
    parts["bass"] = level(bass, -29.0)

    pad = R.pad_stem(g, sc, PROG, r, beats, PAD_LIFT,
                     params=dict(wave="saw", unison=5, det=15.0, spread=0.9, a=0.6, d=1.0, s=0.9, r=1.2, fc=1300.0, ftau=1.2, q=0.8),
                     lo=50, hi=69, vel=0.5, duck=(0.2, 0.08), bus=dict(hp_f=100, lp_f=5000, rev=dict(rt60=2.8, amount=0.34), width=1.4))
    parts["pad"] = level(pad, -28.0)

    choir = g.zeros()
    prev = None
    for bar in range(8, 16):
        pcs = [m % 12 for m in sc.triad(PROG[bar])]
        vo = M.voice_lead(prev, pcs, 55, 74)
        prev = vo
        for k, m in enumerate(vo):
            nt = M.choir_note(mtof(m), g.dur(bar * 16, 16), 0.5, vowel="ah" if bar % 2 == 0 else "oh", a=0.5, r=0.9, seed=bar * 9 + k)
            put(choir, nt, g.t(bar * 16), 1.0)
    choir = M.bus(choir, r, hp_f=140, lp_f=6500, rev=dict(rt60=2.6, amount=0.35), width=1.4)
    parts["choir"] = level(choir, -31.0)

    horn = g.zeros()
    strings = g.zeros()
    for bar in range(16):
        soft = bar < 4
        for (st, ln, d) in LEAD[bar]:
            s = bar * 16 + st
            gate = int(g.dur(s, ln) * 0.95)
            vel = (0.5 if soft else 0.8 if bar < 8 else 0.85 if bar < 12 else 1.0) * hum.v()
            nt = M.brass_note(mtof(sc.midi(d)), max(gate, 64), vel, a=0.12 if soft else 0.06, d=0.3, s=0.85, r=0.35, fc_lo=450.0,
                              fc_hi=1800.0 if soft else 2800.0, drive=1.5, seed=bar * 5 + int(st), sub_oct=False)
            put(horn, nt, g.t(s) + hum.t(s), 1.0)
            if bar >= 4:
                ns = M.synth_note(mtof(sc.midi(d + 7)), max(gate, 64), 0.45 * hum.v(), wave="saw", unison=5, det=13.0, spread=0.7, a=0.05,
                                  d=0.3, s=0.85, r=0.4, fc0=4000.0, fc1=2500.0, ftau=0.2, q=0.9, drive=1.3, vib_depth=0.004 if ln >= 6 else 0.0,
                                  seed=bar * 7 + int(st))
                put(strings, ns, g.t(s) + hum.t(s), 1.0)
    horn = M.bus(horn, r, hp_f=110, lp_f=6500, sat=1.2, rev=dict(rt60=2.2, amount=0.3), comp=(-18.0, 2.5, 10.0, 150.0, 0.0))
    strings = M.bus(strings, r, hp_f=250, lp_f=8000, rev=dict(rt60=2.4, amount=0.3), width=1.3,
                    delay=dict(delay_s=g.sps * 3 / SR, feedback=0.3, mix=0.18, lp_fc=3000.0, hp_fc=300.0, stereo_pingpong=True))
    parts["horn"] = level(horn, -26.0)
    parts["strings"] = level(strings, -31.0)

    arp = R.arp_stem(g, sc, PROG, r, hum, beats, ARP, lo=62,
                     params=dict(wave="pulse", pw=0.4, unison=2, det=9.0, spread=0.5, fc0=5500.0, fc1=1100.0, ftau=0.08, q=2.0, drive=1.3, vel=0.7, ghost=0.5),
                     duck=(0.25, 0.06), delay_steps=3, delay=dict(feedback=0.4, mix=0.3, lp_fc=3500.0, hp_fc=300.0, stereo_pingpong=True))
    parts["arp"] = level(arp, -30.0)

    lanes = dict(kick=KICK, snare=SNARE, clap=CLAP, hat_c=HAT_C, tom_l=TOM_L, tom_m=TOM_M, tom_h=TOM_H)
    kit = dict(kick=dict(f0=140, f1=43.65, tp=0.025, tau=0.13, drive=1.9, click=0.3, dur=0.5, hp_f=34.0),
               snare=dict(tune=M.mtof(52), noise_lo=900.0, noise_hi=6500.0, tau_n=0.13, room=0.45, snap=0.35, dur=0.6),
               tom_l=(M.mtof(38), 0.22), tom_m=(M.mtof(45), 0.2), tom_h=(M.mtof(50), 0.16))   # D2 A2 D3
    drums = R.drum_stem(g, r, lanes, kit=kit, crashes=[(0, 0.7), (4, 0.5), (8, 0.9), (12, 1.0)],
                        gains=dict(kick=0.9, snare=0.9, clap=0.5, hat_c=0.3, tom_l=1.0, tom_m=0.9, tom_h=0.8, crash=0.4),
                        bus=dict(hp_f=28, sat=1.6, comp=(-16.0, 3.0, 8.0, 110.0, 0.0), rev=dict(rt60=1.8, amount=0.22)), crest=11.0)
    parts["drums"] = level(drums, -24.5)

    fx = R.fx_stem(g, r, risers=[(14, 2)], rev_crash=[8, 0, 12], impacts=[(0, 0.9), (4, 0.6), (8, 1.0), (12, 1.0)],
                   riser_tone=(mtof(50), mtof(86), 0.3), impact_kw=dict(f0=100.0, f1=26.0, dur=2.0, tau=0.45))
    parts["fx"] = level(fx, -31.0)

    for k, v in parts.items():
        M.dbg(k, v)
    mix = sum(parts.values())
    mix = dsp.hp(mix, 30.0, 2, loop=True)
    mix = M.soft_crest(mix, 12.0)
    out, info = M.master({"mix": mix}, {"mix": 1.0}, target_lufs=-16.0, ceiling_db=-2.0)
    return out, info
