"""mus_boss.py - BOSS convoy fight: E phrygian, 170 BPM, 16 bars, layered stems base / drums / lead / extra.

Form (4 x 4 bars):  P1 drive riff (Em F Em Dm) | P2 HALF-TIME breakdown (Em Em C F, fill bar 8) | P3 DOUBLE-TIME d-beat (Am F C Dm)
                    | P4 peak (Em F Em Dm), fill bar 16.
Scale is E phrygian only: E F G A B C D (the b2 = F is the menace; chords Em F Dm C Am).
"""
import numpy as np

import dsp
import music_lib as M
import mus_rock as R
from dsp import SR
from music_lib import Grid, Scale, Human, put, parse_notes, mtof

SPEC = dict(track="boss", bpm=170, bars=16, key="E phrygian", tonic=52, mode="phrygian", kind="boss",
            srcs=["music_lib.py", "mus_rock.py", "mus_boss.py"], outputs=M.stem_outputs("boss"),
            sections=[(1, "drive"), (5, "half-time breakdown"), (9, "double-time"), (13, "peak")], fill_bars=[8, 16],
            notes="BOSS convoy E phrygian 170 BPM; stems base/drums/lead/extra = intensity 0..3; half-time breakdown bars 5-8, double-time bars 9-12")

# chord roots as degrees of E phrygian (0=E3): Em F Em Dm | Em Em C F | Am F C Dm | Em F Em Dm
PROG = [0, 1, 0, -1] + [0, 0, 5, 1] + [3, 1, 5, -1] + [0, 1, 0, -1]

BASS = (["R-RR R-RR R-RR R-Rb"] * 4 +                       # P1: 16th gallop
        ["R--- ---- R--- ---F", "R--- ---- ---- R-b-", "R--- ---- R--- ----", "R--- ---- R--- --O-"] +   # P2 half-time (long low notes)
        ["R.RR R.RR R.RR R.RO"] * 3 + ["RRRR RRRR RRRR RRRb"] +    # P3
        ["R-RR R-RR R-RR R-Rb"] * 3 + ["RRRR RRRR RRRR RRRO"])
BASS_OPEN = [1100] * 4 + [800, 800, 1000, 1000] + [1500, 1700, 1900, 2100] + [1700, 1900, 2100, 2500]
CHOIR_LIFT = [1.0] * 4 + [0.8] * 4 + [1.2] * 4 + [1.3] * 4

KICK = (["x.7.x.7.x.7.x.7."] * 3 + ["x.7.x.7.x.7.x.77"] +
        ["x...5.7.x...5.7.", "x...5.7.x...5.7.", "x...5.7.x...5.7.", "x...5...x.5.5.7."] +
        ["x.9.x.9.x.9.x.9."] * 3 + ["x.9.x.9.x.9.x.99"] +
        ["x.7.x.7.x.7.x.7."] * 3 + ["x.7.x.7.x.7.x.99"])
SNARE = (["....x.......x..."] * 3 + ["....x.......x.5x"] +
         ["........x......."] * 3 + ["........x...5.7x"] +
         ["..x...x...x...x."] * 3 + ["..x...x...x.5678"] +
         ["....x.......x..."] * 3 + ["....x...5.6.x.9x"])
CLAP = ["................"] * 12 + ["....6.......6..."] * 3 + ["................"]
HAT_C = (["6.4.6.4.6.4.6.4."] * 4 + ["6.....5.6.....5."] * 3 + ["6.....5.6.5.5.7."] +
         ["7437743774377437"] * 4 + ["7437743774377437"] * 4)
HAT_O = ["................"] * 4 + ["..............6."] * 4 + ["..6...6...6...6."] * 4 + ["..7...7...7...7."] * 4
NONE = "................"
TOM_H = [NONE] * 16
TOM_M = [NONE] * 16
TOM_L = [NONE] * 16
TOM_L[3] = "..........x.x.7."      # small fills at the end of P1
TOM_M[7] = "..........x.7..."      # half-time fill: descending toms
TOM_L[7] = "............x.9."
TOM_L[11] = "..........x.x.7."
TOM_H[15], TOM_M[15], TOM_L[15] = "........x7x7....", "..........x7x7..", "............x7x7"

# lead riff (relative to the chord root degree; lead register E3..)
MB = "0:2=0 2:1=0 3:1=1 4:2=0 6:2=2 8:3=4 11:1=3 12:2=2 14:2=0"
MB2 = "0:1=0 1:1=0 2:2=0 4:1=0 5:1=0 6:2=2 8:1=0 9:1=0 10:2=4 12:2=2 14:2=1"
rel = R.rel
LEAD = {}
for b in range(4):
    LEAD[b] = rel(MB, PROG[b])
LEAD[4] = parse_notes("0:6=7 6:2=8 8:4=7 12:4=9")
LEAD[5] = parse_notes("0:6=11 6:2=9 8:8=7")
LEAD[6] = parse_notes("0:6=12 6:2=11 8:4=9 12:4=7")
LEAD[7] = parse_notes("0:4=8 4:4=10 8:4=12 12:4=15")
for b in range(8, 12):
    LEAD[b] = rel(MB2, PROG[b])
for b in range(12, 15):
    LEAD[b] = rel(MB, PROG[b])
LEAD[15] = parse_notes("0:1=13 1:1=12 2:1=11 3:1=10 4:1=9 5:1=8 6:1=7 7:1=6 8:1=5 9:1=4 10:1=3 11:1=2 12:4=-1")
TIMBRES = {
    "riff": dict(wave="saw", unison=5, det=19.0, spread=0.55, a=0.004, d=0.2, s=0.8, r=0.08, fc0=4200.0, fc1=1600.0, ftau=0.10, q=1.2,
                 drive=3.5, vib=0.0, sub=0.12, vel=0.75),
    "sing": dict(wave="saw", unison=5, det=14.0, spread=0.6, a=0.02, d=0.3, s=0.85, r=0.2, fc0=3600.0, fc1=2200.0, ftau=0.2, q=1.0,
                 drive=2.6, vib=0.006, vib_len=6, vel=0.75, gate=0.97),
}
TIMBRE_OF = ["riff"] * 4 + ["sing"] * 4 + ["riff"] * 8

# low brass stabs (relative to bar chord root): (step, len)
BRASS = {1: [(0, 3), (6, 2)], 3: [(0, 3), (6, 2)], 6: [(0, 15)], 7: [(0, 15)],
         8: [(2, 2), (6, 2), (10, 2), (14, 2)], 9: [(2, 2), (6, 2), (10, 2), (14, 2)], 10: [(2, 2), (6, 2), (10, 2), (14, 2)],
         11: [(2, 2), (6, 2), (10, 2), (14, 2)],
         12: [(0, 3), (3, 3), (6, 2), (10, 2), (14, 2)], 13: [(0, 3), (3, 3), (6, 2), (10, 2), (14, 2)],
         14: [(0, 3), (3, 3), (6, 2), (10, 2), (14, 2)]}

ARP_CODES = ["D8", "D8", "D8", "D8", None, None, "F8", "F8", "E", "E", "E", "E", "D", "D", "D", "B"]
POWER = ["chug"] * 4 + ["sus"] * 2 + [None, None] + ["chug"] * 8
GALLOP = (0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15)


def build():
    g = Grid(SPEC["bpm"], SPEC["bars"])
    sc = Scale(SPEC["tonic"], SPEC["mode"])
    r = dsp.rng("boss")
    hum = Human(r, ms=1.5, vel=0.06)
    beats = [b * 4 for b in range(g.bars * 4)]

    # ---------------------------------------------------------------- BASE: dark bass + formant choir
    bass = R.bass_stem(g, sc, PROG, BASS, BASS_OPEN, r, hum, beats,
                       params=dict(close=260.0, res=0.36, drive=4.6, sub=0.22, det=7.0, tau_f=0.09, gate=0.9, rel=0.05),
                       duck=(0.55, 0.05))
    choir = g.zeros()
    prev = None
    bar = 0
    while bar < g.bars:
        nb = 1
        while bar + nb < g.bars and PROG[bar + nb] == PROG[bar] and nb < 2:
            nb += 1
        pcs = [m % 12 for m in sc.triad(PROG[bar])]
        vo = M.voice_lead(prev, pcs, 50, 70)
        prev = vo
        vowel = "oo" if 4 <= bar < 8 else "ah"
        for k, m in enumerate(vo + [vo[0] - 12]):
            nt = M.choir_note(mtof(m), g.dur(bar * 16, 16 * nb), 0.5 if k < 3 else 0.35, vowel=vowel, a=0.35, r=0.8, seed=bar * 9 + k)
            put(choir, nt, g.t(bar * 16), 1.0)
        bar += nb
    choir = choir * M.duck_env(g, beats, 0.4, 0.06)[:, None]
    choir = M.bus(choir, r, hp_f=110, lp_f=6000, sat=1.2, rev=dict(rt60=2.2, amount=0.32), width=1.35)
    M.dbg("bass", bass)
    M.dbg("choir", choir)
    base = bass + 0.5 * choir

    # ---------------------------------------------------------------- DRUMS + industrial percussion
    lanes = dict(kick=KICK, snare=SNARE, clap=CLAP, hat_c=HAT_C, hat_o=HAT_O, tom_h=TOM_H, tom_m=TOM_M, tom_l=TOM_L)
    anvil = M.make_metal(r, f=mtof(52 - 12), ratios=M.METAL_E, taus=(0.55, 0.4, 0.3, 0.2, 0.12, 0.08), dur=1.3, click=0.6, drive=2.0)   # E3, diatonic partials
    clang = M.make_metal(r, f=mtof(52), ratios=M.METAL_E[:5], taus=(0.16, 0.12, 0.09, 0.06, 0.04), dur=0.5, click=0.5, drive=2.0)
    hits = []
    for b in (0, 4, 8, 12):
        hits.append((anvil, b * 16, 0.5, -0.1))
    for b in (5, 7):
        hits.append((anvil, b * 16 + 8, 0.4, 0.15))
    for b in range(8, 12):
        for st in (6, 14):
            hits.append((clang, b * 16 + st, 0.28, 0.3))
    hits.append((anvil, 15 * 16 + 14, 0.55, 0.0))
    kit = dict(kick=dict(f0=170, f1=43.65, tp=0.02, tau=0.095, drive=2.7, click=0.42, dur=0.42, hp_f=34.0, sub=0.25),
               snare=dict(tune=M.mtof(52), noise_lo=900.0, noise_hi=7500.0, tau_n=0.11, room=0.34, snap=0.5),
               tom_h=(M.mtof(52), 0.11), tom_m=(M.mtof(45), 0.14), tom_l=(M.mtof(40), 0.2))   # E3 A2 E2
    drums = R.drum_stem(g, r, lanes, kit=kit, crashes=[(0, 0.9), (4, 0.7), (8, 1.0), (12, 1.0)], hits=hits, gains=dict(hat_c=0.42, hat_o=0.4),
                        bus=dict(hp_f=26, sat=1.7, comp=(-14.0, 3.5, 6.0, 90.0, 0.0), rev=dict(rt60=0.7, amount=0.1)), crest=10.0)
    M.dbg("drums", drums)

    # ---------------------------------------------------------------- LEAD: distorted saw riffs + low brass stabs
    lead = R.lead_stem(g, sc, r, hum, LEAD, TIMBRE_OF, TIMBRES,
                       bus=dict(hp_f=140, lp_f=8000, sat=1.3, comp=(-16.0, 3.0, 6.0, 110.0, 0.0), rev=dict(rt60=1.4, amount=0.18)),
                       delay_steps=3, delay=dict(feedback=0.3, mix=0.2, lp_fc=3000.0, hp_fc=200.0, stereo_pingpong=True))
    brass = g.zeros()
    for bar, evs in BRASS.items():
        for st, ln in evs:
            s = bar * 16 + st
            gate = int(g.dur(s, ln) * 0.85)
            root = PROG[bar] - 7
            for k, d in enumerate((root, root + 4, root + 7)):
                nt = M.brass_note(mtof(sc.midi(d)), max(gate, 64), (0.55 if k != 1 else 0.4) * hum.v(), a=0.03 if ln < 8 else 0.25,
                                  d=0.25, s=0.8, r=0.15 if ln < 8 else 0.5, fc_lo=420.0, fc_hi=2600.0, drive=2.0, seed=bar * 5 + k, sub_oct=(k == 0))
                put(brass, nt, g.t(s), 1.0)
    brass = M.bus(brass, r, hp_f=70, lp_f=6000, sat=1.1, comp=(-18.0, 3.0, 8.0, 120.0, 0.0), rev=dict(rt60=1.0, amount=0.15), width=1.15)
    M.dbg("lead", lead)
    M.dbg("brass", brass)
    lead_stem = lead + 0.7 * brass

    # ---------------------------------------------------------------- EXTRA: dark arps, power chords, FX, industrial loops
    arp = R.arp_stem(g, sc, PROG, r, hum, beats, ARP_CODES, lo=52,
                     params=dict(wave="pulse", pw=0.3, unison=2, det=10.0, spread=0.5, fc0=4500.0, fc1=900.0, ftau=0.07, q=2.4, drive=1.6,
                                 vel=0.7, ghost=0.5),
                     delay_steps=3, delay=dict(feedback=0.38, mix=0.3, lp_fc=3200.0, hp_fc=250.0, stereo_pingpong=True))
    pw = R.power_stem(g, sc, PROG, r, hum, beats, [(GALLOP if m == "chug" else m) for m in POWER], lo=28 + 12, gain=4.5, sustain_gain=4.0,
                      ring_steps=(0, 8))
    fx = R.fx_stem(g, r, risers=[(6, 2), (14, 2)], rev_crash=[8, 0], impacts=[(0, 0.9), (4, 0.7), (8, 1.0), (12, 1.0)],
                   riser_tone=(mtof(40), mtof(76), 0.3), riser_range=(200.0, 8000.0), impact_kw=dict(f0=95.0, f1=24.0, dur=1.8, tau=0.4))
    chain = g.zeros()
    # industrial texture: metallic ticks on off-16ths in the drive sections + a low clank on beat 1 of each phrase
    tick = M.make_metal(r, f=mtof(52 + 24), ratios=(1.0, 1.5, 2.0), taus=(0.035, 0.02, 0.012), dur=0.12, click=0.6)
    for bar in list(range(0, 4)) + list(range(8, 16)):
        for st in (3, 7, 11, 15):
            put(chain, tick, g.t(bar * 16 + st), 0.18 * hum.v(), -0.3 if st % 8 == 3 else 0.3)
    for bar in (0, 4, 8, 12):
        put(chain, anvil, g.t(bar * 16 + 8), 0.25, 0.2)
    chain = M.bus(chain, r, hp_f=250, rev=dict(rt60=0.9, amount=0.15))
    for nm_, x_ in (("arp", arp), ("pw", pw), ("fx", fx), ("chain", chain)):
        M.dbg(nm_, x_)
    extra = arp * 0.75 + pw * 0.85 + fx * 0.55 + chain * 0.5
    M.save_parts('boss', dict(bass=bass, choir=choir, lead=lead, brass=brass, arp=arp, pw=pw, fx=fx, chain=chain))

    stems = dict(base=base, drums=drums, lead=lead_stem, extra=extra)
    return R.finish(stems, dict(base=-0.5, drums=0.5, lead=-1.5, extra=-1.5))
