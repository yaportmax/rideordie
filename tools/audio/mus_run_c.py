"""mus_run_c.py - RUN C (mountain / city): F# natural minor, 164 BPM, 16 bars, layered stems base / drums / lead / extra.

Tresillo-syncopated bass, four-on-the-floor + clap, big supersaw "sunrise" arpeggio hook, snare rushes.
Form: P1 (F#m D A E) | P2 (F#m D A E, fill bar 8) | P3 lift (Bm D A E) | P4 peak (F#m D A E, fill bar 16).
Scale = F# natural minor: F# G# A B C# D E.
"""
import dsp
import music_lib as M
import mus_rock as R
from music_lib import Grid, Scale, Human, parse_notes

SPEC = dict(track="run_c", bpm=164, bars=16, key="F# minor", tonic=66, mode="minor", kind="run",
            srcs=["music_lib.py", "mus_rock.py", "mus_run_c.py"], outputs=M.stem_outputs("run_c"),
            sections=[(1, "riff"), (5, "variation"), (9, "lift"), (13, "peak")], fill_bars=[8, 16],
            notes="RUN C (mountain/city) F# minor 164 BPM; layers base/drums/lead/extra = intensity 0..3, all 16 bars, identical length")

# root degrees (F#4 = 0):  F#m D A E | F#m D A E | Bm D A E | F#m D A E
PROG = [0, -2, 2, -1] * 2 + [3, -2, 2, -1] + [0, -2, 2, -1]

B1, B2, B3 = "R--R --R- R--R --R-", "R--R --R- R--R -rFO", "RR-R RR-R RR-R RR-O"
BASS = [B1] * 4 + [B2] * 4 + [B3] * 4 + [B2] * 2 + [B3] * 2
BASS_OPEN = [1400] * 4 + [1900] * 4 + [2300, 2600, 2900, 3200] + [2800, 3000, 3200, 3500]
PAD_LIFT = [1.0] * 4 + [1.4] * 4 + [1.8] * 4 + [2.0] * 4

K1, K2 = "x...x...x...x...", "x...x...x...x.7."
KICK = [K1] * 4 + [K2] * 4 + [K1] * 4 + [K2] * 4
SNARE = ["................"] * 4 + ["....5.......5..."] * 8 + ["....6.......6..."] * 4      # clap-led backbeat, snare layered from bar 5
SNARE[7] = "........5.6.7.8x"
SNARE[11] = "............5.7x"
SNARE[15] = "........5566778x"
CLAP = ["....x.......x..."] * 16
CLAP[7] = CLAP[15] = "....x..........."
HAT_C = ["7.5.7.5.7.5.7.5."] * 4 + ["7.5.7.5.7.5.7.5."] * 4 + ["6363636363636363"] * 4 + ["7.5.7.5.7.5.7.5."] * 4
HAT_O = ["..8...8...8...8."] * 16
NONE = "................"
TOM_H = [NONE] * 16
TOM_M = [NONE] * 16
TOM_L = [NONE] * 16
TOM_L[3] = "..............x."
TOM_H[11], TOM_M[11] = "..........x.x...", "............x.x."

HC = "0:3=4 3:3=7 6:2=9 8:8=7"          # sunrise arpeggio: C#5 F#5 A5 F#5 (relative to the chord root degree)
RC = "0:2=9 2:2=7 4:2=4 6:2=2 8:2=4 10:2=7 12:4=9"
rel = R.rel
LEAD = {
    0: rel(HC, 0), 1: rel(HC, -2), 2: rel(HC, 2), 3: rel(HC, -1),
    4: rel(HC, 0), 5: rel(RC, -2), 6: rel(HC, 2), 7: rel(RC, -1),
    8: parse_notes("0:6=10 6:2=9 8:4=7 12:4=5"), 9: parse_notes("0:8=9 8:4=7 12:4=5"),
    10: parse_notes("0:6=9 6:2=8 8:4=6 12:4=4"), 11: parse_notes("0:8=8 8:4=6 12:4=3"),
    12: rel(HC, 0), 13: rel(HC, -2), 14: rel(HC, 2),
    15: parse_notes("0:1=3 1:1=4 2:1=5 3:1=6 4:1=7 5:1=8 6:1=9 7:1=10 8:1=11 9:1=10 10:1=9 11:1=8 12:4=8"),
}
TIMBRES = {
    "a": dict(wave="saw", unison=7, det=20.0, spread=0.9, a=0.008, d=0.25, s=0.8, r=0.14, fc0=7500.0, fc1=3500.0, ftau=0.16, q=0.9,
              drive=1.4, vib=0.005, vel=0.7, gate=0.96),
    "b": dict(wave="saw", unison=7, det=24.0, spread=1.0, a=0.03, d=0.3, s=0.85, r=0.2, fc0=8500.0, fc1=4500.0, ftau=0.25, q=0.9,
              drive=1.3, vib=0.007, vib_len=6, vel=0.7, gate=0.98),
}
ARP_CODES = ["A8"] * 4 + ["E8"] * 4 + ["A"] * 4 + ["F"] * 4
TRES = (0, 3, 6, 8, 11, 14)
POWER = [None] * 4 + [TRES] * 4 + ["sus"] * 4 + [TRES] * 4


def build():
    g = Grid(SPEC["bpm"], SPEC["bars"])
    sc = Scale(SPEC["tonic"], SPEC["mode"])
    r = dsp.rng("run_c")
    hum = Human(r, ms=1.8, vel=0.06)
    beats = [b * 4 for b in range(g.bars * 4)]

    bass = R.bass_stem(g, sc, PROG, BASS, BASS_OPEN, r, hum, beats, lo=30,
                       params=dict(wave="saw", close=340.0, res=0.3, drive=3.0, sub=0.3, det=6.0, tau_f=0.07, gate=0.8),
                       duck=(0.7, 0.05))
    pad = R.pad_stem(g, sc, PROG, r, beats, PAD_LIFT,
                     params=dict(unison=7, det=16.0, spread=1.0, a=0.15, r=0.5, fc=1200.0),
                     bus=dict(hp_f=130, lp_f=6000, rev=dict(rt60=1.8, amount=0.26), width=1.45))
    M.dbg("bass", bass)
    M.dbg("pad", pad)
    base = bass + 0.42 * pad

    lanes = dict(kick=KICK, snare=SNARE, clap=CLAP, hat_c=HAT_C, hat_o=HAT_O, tom_h=TOM_H, tom_m=TOM_M, tom_l=TOM_L)
    kit = dict(kick=dict(f0=170, f1=46.25, tp=0.02, tau=0.095, drive=2.3, click=0.4, dur=0.38, hp_f=34.0, sub=0.15),
               snare=dict(tune=207.65, room=0.22), clap=dict(tail=0.11, lo=1000.0, hi=3800.0), hat=dict(bright=0.95),
               tom_h=(207.65, 0.1), tom_m=(155.6, 0.13), tom_l=(103.8, 0.18))
    drums = R.drum_stem(g, r, lanes, kit=kit, crashes=[(0, 0.8), (4, 0.6), (8, 1.0), (12, 1.0)], gains=dict(clap=0.8, snare=0.75, hat_o=0.5))
    M.dbg("drums", drums)

    lead = R.lead_stem(g, sc, r, hum, LEAD, ["a"] * 8 + ["b"] * 4 + ["a"] * 4, TIMBRES, low_bars=range(12, 16), prog=PROG,
                       delay_steps=3, delay=dict(feedback=0.4, mix=0.3, lp_fc=4200.0, hp_fc=250.0, stereo_pingpong=True),
                       bus=dict(hp_f=180, lp_f=11000, sat=1.15, rev=dict(rt60=1.6, amount=0.2), comp=(-16.0, 2.5, 6.0, 110.0, 0.0)))

    arp = R.arp_stem(g, sc, PROG, r, hum, beats, ARP_CODES, up_bars=range(12, 16), lo=66,
                     params=dict(wave="saw", unison=2, det=10.0, spread=0.6, fc0=9000.0, fc1=1800.0, ftau=0.05, q=2.0, drive=1.1, vel=0.7,
                                 ghost=0.5, r=0.12),
                     delay_steps=3, delay=dict(feedback=0.45, mix=0.38, lp_fc=4800.0, hp_fc=300.0, stereo_pingpong=True))
    pw = R.power_stem(g, sc, PROG, r, hum, beats, POWER, gain=4.5, sustain_gain=4.0, ring_steps=(0, 8))
    fx = R.fx_stem(g, r, risers=[(6, 2), (14, 2)], rev_crash=[8, 0], impacts=[(0, 0.7), (8, 1.0), (12, 0.8)],
                   riser_tone=(M.mtof(54), M.mtof(90), 0.25))
    perc = R.perc_stem(g, r, hum, shaker_bars=range(0, 16), cow_bars=range(12, 16), cow_steps=TRES, cow_f=M.mtof(78),
                       cow_ratios=(1.0, 1.5, 2.0, 3.0))
    for nm_, x_ in (("arp", arp), ("pw", pw), ("fx", fx), ("perc", perc)):
        M.dbg(nm_, x_)
    extra = arp * 0.75 + pw * 0.85 + fx * 0.55 + perc * 0.5

    stems = dict(base=base, drums=drums, lead=lead, extra=extra)
    return R.finish(stems, dict(base=-0.5, drums=0.5, lead=-1.5, extra=-1.5))
