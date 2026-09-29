"""mus_victory.py - VICTORY one-shot fanfare: D major, 132 BPM, ~11 s.  Not a loop.

Bar 1: rising harp/pluck arpeggio (D F# A D F# A D F#) + snare/timpani roll.
Bar 2 (D):  brass fanfare  A A A D | F# (held)       drums 4-on-the-floor, crash
Bar 3 (G A): brass  G D | A E                          snare fill
Bar 4 (D):  big final D major chord (brass + bells + choir) with timpani/crash hit, natural release + reverb tail.
"""
import numpy as np

import dsp
import music_lib as M
from dsp import SR, secs
from music_lib import Grid, Scale, Human, parse_notes, mtof

SPEC = dict(track="victory", bpm=132, bars=4, key="D major", tonic=62, mode="major", kind="victory", srcs=["music_lib.py", "mus_victory.py"], outputs=[("victory", "mix", 0)],
            notes="VICTORY fanfare one-shot, D major 132 BPM, ~11 s, heroic brass + drums + rising arpeggio, natural tail")

TOTAL_S = 11.2


def level(x, target_lufs):
    return x * 10 ** ((target_lufs - M.lufs(x)) / 20.0)


def build():
    g = Grid(SPEC["bpm"], SPEC["bars"])
    sc = Scale(SPEC["tonic"], SPEC["mode"])
    r = dsp.rng("victory")
    hum = Human(r, ms=1.0, vel=0.04)
    N = secs(TOTAL_S)

    def z():
        return np.zeros((N, 2))

    def pn(buf, x, start, gain=1.0, pan=0.0):
        if x.ndim == 1:
            x = dsp.pan_stereo(x, pan)
        dsp.place(buf, x, int(start), gain)

    parts = {}
    # ---- drums
    kick = M.make_kick(r, f0=175, f1=48, tp=0.02, tau=0.11, drive=2.2, click=0.4, dur=0.5, hp_f=34.0)
    snare = M.make_snare(r, tune=180, room=0.35, tau_n=0.11, dur=0.6)
    hat = M.make_hat(r)
    crash = M.make_crash(r, dur=4.0, tau=1.3)
    timp = M.make_tom(r, 73.4, 0.5, drop=1.35, dur=2.2, drive=1.4)
    timp_hi = M.make_tom(r, 110.0, 0.35, drop=1.3, dur=1.5, drive=1.4)
    dr = z()
    for i in range(0, 16):                                    # bar 1: snare + timpani roll, crescendo
        v = 0.15 + 0.85 * i / 15.0
        if i >= 6:
            pn(dr, snare, g.t(i), 0.7 * v ** 1.3, 0.0)
        pn(dr, timp if i % 2 == 0 else timp_hi, g.t(i), 0.9 * v ** 1.5, -0.2 if i % 2 else 0.2)
    for bar in (1, 2):                                        # bars 2-3: kick 4/4, backbeat, 8th hats
        for b in range(4):
            pn(dr, kick, g.t(bar * 16 + 4 * b), 1.0)
        for b in (1, 3):
            pn(dr, snare, g.t(bar * 16 + 4 * b), 0.9)
        for i in range(0, 16, 2):
            pn(dr, hat, g.t(bar * 16 + i), 0.3 if i % 4 == 0 else 0.2, 0.2)
    pn(dr, crash, g.t(16), 0.55)
    for i in range(12, 16):                                   # bar 3 fill
        pn(dr, snare, g.t(32 + i), 0.75 + 0.05 * (i - 12), 0.0)
    pn(dr, kick, g.t(48), 1.1)                                # bar 4: the hit
    pn(dr, snare, g.t(48), 1.0)
    pn(dr, timp, g.t(48), 1.2)
    pn(dr, crash, g.t(48), 0.75)
    dr = M.bus(dr, r, hp_f=28, sat=1.5, comp=(-14.0, 3.0, 6.0, 100.0, 0.0), rev=dict(rt60=2.2, amount=0.22))
    parts["drums"] = level(dr, -22.0)

    # ---- brass fanfare (melody in octave unison + fifth below, chords underneath)
    br = z()
    mel = {1: "0:2=4 2:2=4 4:2=4 6:2=7 8:8=9", 2: "0:4=10 4:4=7 8:4=11 12:4=8"}
    for bar, s_ in mel.items():
        for st, ln, d in parse_notes(s_):
            s = bar * 16 + st
            gate = int(g.dur(s, ln) * (0.7 if ln <= 2 else 0.96))
            for dd, vel in ((d, 1.0), (d - 7, 0.7)):
                nt = M.brass_note(mtof(sc.midi(dd)), max(gate, 64), vel * 0.8 * hum.v(), a=0.025, d=0.2, s=0.85, r=0.25, fc_lo=700.0,
                                  fc_hi=4200.0, drive=1.7, seed=bar * 5 + int(st) + dd, sub_oct=False)
                pn(br, nt, g.t(s) + hum.t(0), 1.0)
    # chord support (bars 2-3): D | D | G A  as brass triads
    for (s, ln, root) in [(16, 16, 0), (32, 8, 3), (40, 8, 4)]:
        for k, d in enumerate((root - 7, root - 7 + 4, root)):
            nt = M.brass_note(mtof(sc.midi(d)), int(g.dur(s, ln) * 0.95), 0.42, a=0.04, d=0.3, s=0.85, r=0.25, fc_lo=500.0, fc_hi=2600.0,
                              drive=1.5, seed=s + k, sub_oct=(k == 0))
            pn(br, nt, g.t(s), 1.0)
    # final chord D3 A3 D4 F#4 A4 D5 (bar 4), long release
    fin_gate = secs(2.3)
    for k, m in enumerate((50, 57, 62, 66, 69, 74)):
        nt = M.brass_note(mtof(m), fin_gate, 0.75 if k in (2, 5) else 0.6, a=0.05, d=0.4, s=0.9, r=1.6, fc_lo=700.0, fc_hi=3600.0, drive=1.6,
                          seed=900 + k, sub_oct=(k == 0))
        pn(br, nt, g.t(48), 1.0)
    br = M.bus(br, r, hp_f=80, lp_f=9000, sat=1.15, comp=(-16.0, 2.5, 8.0, 120.0, 0.0), rev=dict(rt60=2.6, amount=0.3), width=1.2)
    parts["brass"] = level(br, -19.0)

    # ---- rising arpeggio (bar 1) + shimmering bells on the final chord + choir swell
    arp = z()
    tones = [62, 66, 69, 74, 78, 81, 86, 90]                 # D4 F#4 A4 D5 F#5 A5 D6 F#6
    for k, m in enumerate(tones):
        s = 2 * k
        nt = M.synth_note(mtof(m), g.dur(s, 2), (0.35 + 0.65 * k / 7) * hum.v(), wave="saw", unison=3, det=10.0, spread=0.6, a=0.002,
                          d=0.15, s=0.1, r=0.35, fc0=8000.0, fc1=2200.0, ftau=0.1, q=1.6, drive=1.2, seed=k)
        pn(arp, nt, g.t(s), 1.0)
    for k, m in enumerate((74, 78, 81, 86, 90, 86, 81, 78)):
        s = 48 + 2 * k
        nt = M.epiano(mtof(m), g.dur(s, 2), (0.6 - 0.04 * k) * hum.v(), tau=1.6, bright=0.9, rel=1.4, seed=k)
        pn(arp, nt, g.t(s), 1.0)
    arp = M.bus(arp, r, hp_f=250, sat=1.1, rev=dict(rt60=2.6, amount=0.3), delay=dict(delay_s=g.sps * 3 / SR, feedback=0.35, mix=0.2, lp_fc=4000.0,
                                                                                       hp_fc=300.0, stereo_pingpong=True), width=1.3)
    parts["arp"] = level(arp, -27.0)

    ch = z()
    for k, m in enumerate((50, 57, 62, 66, 69)):
        nt = M.choir_note(mtof(m), secs(2.2), 0.5, vowel="ah", a=0.25, r=1.5, seed=77 + k)
        pn(ch, nt, g.t(48) - secs(0.25), 1.0)
    ch = M.bus(ch, r, hp_f=120, rev=dict(rt60=3.0, amount=0.35), width=1.4)
    parts["choir"] = level(ch, -29.0)

    # ---- bar-4 sub drop
    imp = M.make_impact(r, f0=100.0, f1=30.0, dur=2.2, tau=0.5)
    sub = z()
    pn(sub, imp, g.t(48), 0.8)
    parts["sub"] = level(sub, -27.0)

    for k, v in parts.items():
        M.dbg(k, v)
    mix = sum(parts.values())
    mix = M.soft_crest(mix, 11.5)
    out, info = M.master({"mix": mix}, {"mix": 1.0}, target_lufs=-14.0, ceiling_db=-2.0)
    return out, info
