"""mus_run_a.py - RUN A (desert): A natural minor, 152 BPM, 16 bars, layered stems base / drums / lead / extra.

Form (4 x 4 bars):  P1 riff (Am G F G)  |  P2 variation, fill bar 8 (Am G F G)  |  P3 lift (Dm F C G)  |  P4 peak, fill bar 16
"""
import dsp
import music_lib as M
import mus_rock as R
from music_lib import Grid, Scale, Human, parse_notes

SPEC = dict(track="run_a", bpm=152, bars=16, key="A minor", tonic=69, mode="minor", kind="run",
            srcs=["music_lib.py", "mus_rock.py", "mus_run_a.py"], outputs=M.stem_outputs("run_a"),
            sections=[(1, "riff"), (5, "variation"), (9, "lift"), (13, "peak")], fill_bars=[8, 16],
            notes="RUN A (desert) A minor 152 BPM; layers base/drums/lead/extra = intensity 0..3, all 16 bars, identical length")

# chord root degree per bar (0 = A). Am G F G | Am G F G | Dm F C G | Am G F G
PROG = [0, -1, -2, -1] * 2 + [-4, -2, -5, -1] + [0, -1, -2, -1]

BASS = (["R-rR R-r. R-rR R-OF"] * 4 + ["R-R- R-R- R-R- R-O-"] * 4 + ["RRRR RRRO RRRR RRFO"] * 4 +
        ["R-rR R-r. R-rR R-OF"] * 2 + ["RRRR RRRO RRRR RRFO"] * 2)
BASS_OPEN = [1300] * 4 + [1700] * 4 + [2000, 2400, 2800, 3200] + [2400, 2600, 2900, 3300]
PAD_LIFT = [1.0] * 8 + [1.6] * 4 + [1.9] * 4

KICK = ["x...9...9...9..."] * 16
KICK[3] = KICK[11] = "x...9...9...9.6."
SNARE = ["....x.......x..."] * 16
SNARE[3] = SNARE[11] = "....x.......x.66"
SNARE[7] = "....x...5.6.x.89"
SNARE[15] = "....x.........xx"
CLAP = ["................"] * 4 + ["....6.......6..."] * 12
CLAP[7] = CLAP[15] = "................"
HAT_C = (["7.5.7.5.7.5.7.5."] * 4 + ["74.574.574.574.5"] * 4 + ["7.3.7.3.7.3.7.3."] * 4 + ["74.574.574.574.5"] * 4)
HAT_O = ["..............6."] * 4 + ["..7...7...7...7."] * 4 + ["..8...8...8...8."] * 4 + ["..8...8...8...8."] * 4
NONE = "................"
TOM_H = [NONE] * 16
TOM_M = [NONE] * 16
TOM_L = [NONE] * 16
TOM_H[15], TOM_M[15], TOM_L[15] = "........x7......", "..........x7....", "............x7.."
TOM_H[7], TOM_M[7] = "............6...", ".............6.."

M1 = "0:3=0 3:3=2 6:2=4 8:3=7 11:1=6 12:4=4"       # tresillo arpeggio hook, relative to the chord root degree
rel = R.rel
LEAD = {
    0: rel(M1, 0), 1: rel(M1, -1), 2: rel(M1, -2), 3: parse_notes("0:3=-1 3:3=1 6:2=3 8:2=6 10:2=5 12:4=3"),
    4: rel(M1, 0), 5: parse_notes("0:2=-1 2:2=1 4:2=3 6:2=6 8:6=8 14:2=6"), 6: rel(M1, -2),
    7: parse_notes("0:4=8 4:4=6 8:4=3 12:4=1"),
    8: parse_notes("0:6=7 6:2=5 8:4=3 12:4=5"), 9: parse_notes("0:6=9 6:2=7 8:4=5 12:4=7"),
    10: parse_notes("0:6=6 6:2=4 8:4=2 12:4=4"), 11: parse_notes("0:6=8 6:2=6 8:4=3 12:4=1"),
    12: rel(M1, 0), 13: rel(M1, -1), 14: rel(M1, -2),
    15: parse_notes("0:1=-1 1:1=0 2:1=1 3:1=2 4:1=3 5:1=4 6:1=5 7:1=6 8:1=7 9:1=8 10:1=9 11:1=10 12:4=8"),
}
COUNTER = "2:1=4 6:2=2 10:1=4 14:2=7"      # relative to (chord root - 7): pulse-wave stabs under the melody
TIMBRES = {
    "a": dict(wave="saw", unison=3, det=9.0, spread=0.3, a=0.006, d=0.2, s=0.75, r=0.11, fc0=5200.0, fc1=2100.0, ftau=0.13, q=1.1,
              drive=2.0, vib=0.0055, vel=0.8),
    "b": dict(wave="saw", unison=5, det=15.0, spread=0.6, a=0.006, d=0.2, s=0.75, r=0.11, fc0=6200.0, fc1=2600.0, ftau=0.13, q=1.1,
              drive=2.0, vib=0.0055, vel=0.8),
}
ARP_CODES = ["A8"] * 4 + ["A"] * 4 + ["C"] * 4 + ["B"] * 4
POWER = [None] * 4 + ["chug"] * 4 + ["sus"] * 4 + ["chug"] * 4


def build():
    g = Grid(SPEC["bpm"], SPEC["bars"])
    sc = Scale(SPEC["tonic"], SPEC["mode"])
    r = dsp.rng("run_a")
    hum = Human(r, ms=1.8, vel=0.06)
    beats = [b * 4 for b in range(g.bars * 4)]

    bass = R.bass_stem(g, sc, PROG, BASS, BASS_OPEN, r, hum, beats)
    pad = R.pad_stem(g, sc, PROG, r, beats, PAD_LIFT)
    M.dbg("bass", bass)
    M.dbg("pad", pad)
    base = bass + 0.42 * pad

    lanes = dict(kick=KICK, snare=SNARE, clap=CLAP, hat_c=HAT_C, hat_o=HAT_O, tom_h=TOM_H, tom_m=TOM_M, tom_l=TOM_L)
    kit = dict(snare=dict(tune=M.mtof(55), room=0.16), tom_h=(M.mtof(57), 0.10), tom_m=(M.mtof(52), 0.13), tom_l=(M.mtof(45), 0.18))   # A3 E3 A2 toms, G3 snare
    drums = R.drum_stem(g, r, lanes, kit=kit, crashes=[(0, 0.8), (4, 0.5), (8, 1.0), (12, 0.9)])
    M.dbg("drums", drums)

    lead = R.lead_stem(g, sc, r, hum, LEAD, ["a"] * 8 + ["b"] * 4 + ["a"] * 4, TIMBRES, low_bars=range(12, 16), counter=COUNTER,
                       counter_bars=range(8, 15), prog=PROG)

    arp = R.arp_stem(g, sc, PROG, r, hum, beats, ARP_CODES, up_bars=range(12, 16))
    pw = R.power_stem(g, sc, PROG, r, hum, beats, POWER)
    fx = R.fx_stem(g, r, risers=[(6, 2), (14, 2)], rev_crash=[8, 0], impacts=[(0, 0.7), (8, 1.0), (12, 0.8)])
    perc = R.perc_stem(g, r, hum, shaker_bars=range(4, 16), cow_bars=range(12, 16))
    for nm_, x_ in (("arp", arp), ("pw", pw), ("fx", fx), ("perc", perc)):
        M.dbg(nm_, x_)
    extra = arp * 0.75 + pw * 0.85 + fx * 0.55 + perc * 0.5

    stems = dict(base=base, drums=drums, lead=lead, extra=extra)
    return R.finish(stems, dict(base=-0.5, drums=0.5, lead=-1.5, extra=-1.5))
