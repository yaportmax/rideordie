"""mus_run_b.py - RUN B (canyon / coast): D phrygian, 158 BPM, 16 bars, layered stems base / drums / lead / extra.

Off-beat pumping bass, syncopated kick pushes, acid-pulse lead with the b2 (Eb) neighbour-tone hook.
Form: P1 (Dm Eb Dm Cm) | P2 (Dm Bb Cm Eb, fill bar 8) | P3 lift (Bb Cm Dm Dm) | P4 peak (Dm Eb Dm Cm, fill bar 16).
Scale = D phrygian: D Eb F G A Bb C (chords Dm Eb F Gm Bb Cm).
"""
import dsp
import music_lib as M
import mus_rock as R
from music_lib import Grid, Scale, Human, parse_notes

SPEC = dict(track="run_b", bpm=158, bars=16, key="D phrygian", tonic=62, mode="phrygian", kind="run",
            srcs=["music_lib.py", "mus_rock.py", "mus_run_b.py"], outputs=M.stem_outputs("run_b"),
            sections=[(1, "riff"), (5, "variation"), (9, "lift"), (13, "peak")], fill_bars=[8, 16],
            notes="RUN B (canyon/coast) D phrygian 158 BPM; layers base/drums/lead/extra = intensity 0..3, all 16 bars, identical length")

# root degrees (D4 = 0):  Dm Eb Dm Cm | Dm Bb Cm Eb | Bb Cm Dm Dm | Dm Eb Dm Cm
PROG = [0, 1, 0, -1] + [0, -2, -1, 1] + [-2, -1, 0, 0] + [0, 1, 0, -1]

B1, B2, B3, B4 = "..R- ..R- ..R- ..R-", "R.R- R.R- R.R- R.RO", "R-O- R-O- R-O- R-O-", "R.R- ..R- R.R- ..RO"
BASS = [B1] * 4 + [B2] * 4 + [B3] * 4 + [B4] * 4
BASS_OPEN = [1200] * 4 + [1800] * 4 + [2200, 2500, 2800, 3000] + [2600, 2800, 3000, 3300]
PAD_LIFT = [1.0] * 4 + [1.3] * 4 + [1.8] * 4 + [1.9] * 4

K1, K2, K3 = "x...x...x...x...", "x...x.7.x...x.7.", "x...x...x...x..7"
KICK = [K1] * 4 + [K2] * 4 + [K3] * 4 + [K2] * 4
SNARE = ["....x.......x..."] * 16
SNARE[7] = "....x.......x..x"
SNARE[15] = "....x...5566778x"
SNARE[3] = SNARE[11] = "....x.......x.5x"
CLAP = ["................"] * 4 + ["....7.......7..."] * 12
CLAP[7] = CLAP[15] = "................"
HAT_C = ["6.4.6.4.6.4.6.4."] * 4 + ["6435643564356435"] * 4 + ["6.4.6.4.6.4.6.4."] * 4 + ["7546754675467546"] * 4
HAT_O = ["................"] * 4 + ["..7...7...7...7."] * 4 + ["..8...8...8...8."] * 4 + ["..7...7...7...77"] * 4
NONE = "................"
TOM_H = [NONE] * 16
TOM_M = [NONE] * 16
TOM_L = [NONE] * 16
TOM_H[7], TOM_M[7], TOM_L[7] = "........x.7.....", "..........x.7...", "............x.7."
TOM_L[3] = "............x.x."

MB1 = "0:3=7 3:1=8 4:2=7 6:2=9 8:3=11 11:1=10 12:4=9"       # D5 Eb5 D5 F5 A5 G5 F5 (relative to chord root degree)
RB = "0:2=11 2:2=9 4:2=7 6:2=9 8:2=11 10:2=9 12:4=7"       # chord-tone arpeggio answer
rel = R.rel
LEAD = {
    0: rel(MB1, 0), 1: rel(MB1, 1), 2: rel(MB1, 0), 3: rel(MB1, -1),
    4: rel(MB1, 0), 5: rel(RB, -2), 6: rel(MB1, -1), 7: rel(RB, 1),
    8: parse_notes("0:6=9 6:2=8 8:4=7 12:4=5"), 9: parse_notes("0:6=10 6:2=9 8:4=8 12:4=6"),
    10: parse_notes("0:6=11 6:2=10 8:4=9 12:4=7"), 11: parse_notes("0:8=9 8:8=7"),
    12: rel(MB1, 0), 13: rel(MB1, 1), 14: rel(MB1, 0),
    15: parse_notes("0:2=2 2:2=3 4:2=4 6:2=5 8:2=6 10:2=7 12:4=8"),
}
COUNTER = "2:1=4 6:2=2 10:1=4 14:2=7"
TIMBRES = {
    "a": dict(wave="pulse", pw=0.42, unison=3, det=11.0, spread=0.35, a=0.005, d=0.2, s=0.75, r=0.10, fc0=4800.0, fc1=1900.0, ftau=0.10,
              q=1.8, drive=2.2, vib=0.0045, vel=0.8),
    "b": dict(wave="saw", unison=5, det=16.0, spread=0.6, a=0.01, d=0.2, s=0.8, r=0.14, fc0=6500.0, fc1=2800.0, ftau=0.14, q=1.1,
              drive=2.0, vib=0.006, vel=0.8, gate=0.97),
}
ARP_CODES = ["D8"] * 4 + ["D"] * 4 + ["C8"] * 4 + ["B"] * 4
E8 = (0, 2, 4, 6, 8, 10, 12, 14)
E16 = (0, 2, 3, 4, 6, 8, 10, 11, 12, 14)
POWER = [None] * 4 + [E8] * 4 + ["sus"] * 4 + [E16] * 4


def build():
    g = Grid(SPEC["bpm"], SPEC["bars"])
    sc = Scale(SPEC["tonic"], SPEC["mode"])
    r = dsp.rng("run_b")
    hum = Human(r, ms=1.8, vel=0.06)
    beats = [b * 4 for b in range(g.bars * 4)]

    bass = R.bass_stem(g, sc, PROG, BASS, BASS_OPEN, r, hum, beats,
                       params=dict(wave="pulse", close=300.0, res=0.4, drive=3.4, sub=0.25, det=4.0, tau_f=0.08, gate=0.85))
    pad = R.pad_stem(g, sc, PROG, r, beats, PAD_LIFT,
                     params=dict(unison=3, det=11.0, spread=0.9, a=0.12, r=0.5, fc=1400.0),
                     bus=dict(hp_f=120, lp_f=5500, rev=dict(rt60=2.2, amount=0.3), width=1.35))
    M.dbg("bass", bass)
    M.dbg("pad", pad)
    base = bass + 0.42 * pad

    lanes = dict(kick=KICK, snare=SNARE, clap=CLAP, hat_c=HAT_C, hat_o=HAT_O, tom_h=TOM_H, tom_m=TOM_M, tom_l=TOM_L)
    kit = dict(kick=dict(f0=200, f1=55, tp=0.016, tau=0.085, drive=2.6, click=0.6, dur=0.36, hp_f=36.0),
               snare=dict(tune=M.mtof(55), noise_lo=1500.0, noise_hi=9500.0, tau_n=0.075, room=0.2), hat=dict(bright=1.1),
               tom_h=(M.mtof(55), 0.1), tom_m=(M.mtof(50), 0.13), tom_l=(M.mtof(43), 0.18))   # G3 D3 G2
    drums = R.drum_stem(g, r, lanes, kit=kit, crashes=[(0, 0.8), (4, 0.6), (8, 1.0), (12, 1.0)])
    M.dbg("drums", drums)

    lead = R.lead_stem(g, sc, r, hum, LEAD, ["a"] * 8 + ["b"] * 4 + ["a"] * 4, TIMBRES, low_bars=range(12, 16), counter=COUNTER,
                       counter_bars=range(8, 15), prog=PROG, delay_steps=3,
                       delay=dict(feedback=0.4, mix=0.3, lp_fc=3800.0, hp_fc=250.0, stereo_pingpong=True))

    arp = R.arp_stem(g, sc, PROG, r, hum, beats, ARP_CODES, up_bars=range(12, 16), lo=62,
                     params=dict(wave="pulse", pw=0.35, unison=2, det=9.0, spread=0.5, fc0=7500.0, fc1=1500.0, ftau=0.06, q=2.4, drive=1.2,
                                 vel=0.75, ghost=0.55))
    pw = R.power_stem(g, sc, PROG, r, hum, beats, POWER, gain=5.0, sustain_gain=4.5, ring_steps=(0, 8))
    fx = R.fx_stem(g, r, risers=[(6, 2), (14, 2)], rev_crash=[8, 0], impacts=[(0, 0.7), (8, 1.0), (12, 0.8)],
                   riser_tone=(M.mtof(50), M.mtof(86), 0.25))
    perc = R.perc_stem(g, r, hum, shaker_bars=range(4, 16), cow_bars=range(12, 16), cow_steps=E16, cow_f=M.mtof(74),
                       cow_ratios=(1.0, 1.5, 2.0, 3.0))
    for nm_, x_ in (("arp", arp), ("pw", pw), ("fx", fx), ("perc", perc)):
        M.dbg(nm_, x_)
    extra = arp * 0.75 + pw * 0.85 + fx * 0.55 + perc * 0.5

    stems = dict(base=base, drums=drums, lead=lead, extra=extra)
    return R.finish(stems, dict(base=-0.5, drums=0.5, lead=-1.5, extra=-1.5))
