"""mus_garage.py - GARAGE menu loop: G natural minor, 92 BPM, 16 bars, single stereo loop (~41.7 s), about -16 LUFS.

Warm sine/triangle sub bass, tape-saturated boom-bap drums with swung hats, muted Karplus-Strong guitar arps, a simple
hopeful pluck theme (enters bar 5), electric-piano chords, slow warm pad, tape hiss / vinyl crackle / distant workshop clinks,
loop-safe tape wow.   Chords: Gm Eb Bb F | Gm Eb Bb F | Cm Eb Bb F | Eb Bb Cm F  (i VI III VII ... iv VI III VII ... VII -> i)
"""
import numpy as np

import dsp
import music_lib as M
import mus_rock as R
from dsp import SR
from music_lib import Grid, Scale, Human, put, parse_notes, mtof

SPEC = dict(track="garage", bpm=92, bars=16, key="G minor", tonic=67, mode="minor", kind="loop",
            srcs=["music_lib.py", "mus_rock.py", "mus_garage.py"], outputs=[("garage_loop", "mix", 0)],
            sections=[(1, "intro arps"), (5, "theme"), (9, "lift"), (13, "resolve")],
            notes="GARAGE menu loop: G minor 92 BPM, 16 bars, ~-16 LUFS, warm/gritty/hopeful, sits under menus")

# root degrees rel. G4: Gm Eb Bb F | Gm Eb Bb F | Cm Eb Bb F | Eb Bb Cm F
PROG = [0, -2, 2, -1] * 2 + [3, -2, 2, -1] + [-2, 2, 3, -1]
BASS_A, BASS_B = "R--- --r. R--- --F-", "R--- --r. R-r. R-F-"
BASS = ([BASS_A] * 4 + [BASS_B] * 4) * 2
KA, KB = "x.....7...8.....", "x...5.7...8..5.."
KICK = ([KA] * 4 + [KB] * 4) * 2
SNARE = ["....x.......x.3."] * 16
SNARE[7] = SNARE[15] = "....x.....3.x.36"
HAT_C = ["6242624262426242"] * 16
HAT_O = ["..............3."] * 16
NONE = "................"
MELODY = {
    4: "0:6=4 6:2=3 8:4=2 12:4=4", 5: "0:6=7 6:2=6 8:4=5 12:4=7", 6: "0:6=6 6:2=5 8:4=4 12:4=6", 7: "0:6=3 6:2=2 8:4=1 12:4=3",
    8: "0:6=7 6:2=6 8:4=5 12:4=3", 9: "0:6=7 6:2=5 8:4=7 12:4=9", 10: "0:6=6 6:2=4 8:4=6 12:4=4", 11: "0:8=8 8:4=6 12:4=3",
    12: "0:8=7 8:4=5 12:4=7", 13: "0:8=6 8:4=4 12:4=6", 14: "0:6=5 6:2=4 8:4=3 12:4=5", 15: "0:8=3 8:8=1",
}
ARP_IDX = [0, 2, 1, 3, 2, 1, 2, 3]


def level(x, target_lufs):
    return x * 10 ** ((target_lufs - M.lufs(x)) / 20.0)


def build():
    g = Grid(SPEC["bpm"], SPEC["bars"])
    sc = Scale(SPEC["tonic"], SPEC["mode"])
    r = dsp.rng("garage")
    hum = Human(r, ms=3.0, vel=0.07)
    kick_steps = [16 * b + i for b in range(16) for i, c in enumerate(KICK[b].replace(" ", "")) if c != "."]
    beats = [b * 4 for b in range(g.bars * 4)]
    parts = {}

    # ---- warm sub bass
    bass = R.bass_stem(g, sc, PROG, BASS, [420.0] * 16, r, hum, kick_steps, lo=31,
                       params=dict(wave="tri", close=140.0, res=0.12, drive=1.25, sub=0.55, det=3.0, tau_f=0.14, gate=0.96, rel=0.12),
                       duck=(0.28, 0.09), bus=dict(hp_f=40, lp_f=1400, sat=1.2, comp=(-18.0, 2.5, 12.0, 150.0, 0.0)))
    parts["bass"] = level(bass, -31.0)

    # ---- warm pad
    pad = R.pad_stem(g, sc, PROG, r, kick_steps, [1.0] * 16,
                     params=dict(wave="tri", unison=3, det=9.0, spread=0.6, a=0.45, d=0.8, s=0.9, r=0.9, fc=1500.0, ftau=1.0, q=0.7),
                     lo=53, hi=70, vel=0.5, duck=(0.2, 0.1), bus=dict(hp_f=130, lp_f=4200, rev=dict(rt60=2.0, amount=0.3), width=1.25))
    parts["pad"] = level(pad, -31.0)

    # ---- electric piano chords (beat 1, plus an off-beat lift in the second half)
    ep = g.zeros()
    prev = None
    for bar in range(16):
        pcs = [m % 12 for m in sc.triad(PROG[bar])]
        vo = M.voice_lead(prev, pcs, 55, 72)
        prev = vo
        evs = [(0, 5, 0.6)] + ([(10, 3, 0.4)] if bar >= 8 else [])
        for st, ln, v in evs:
            for k, m in enumerate(vo):
                nt = M.epiano(mtof(m), g.dur(bar * 16 + st, ln), v * hum.v(), tau=1.2, bright=0.55, seed=bar * 9 + k)
                put(ep, nt, g.t(bar * 16 + st) + hum.t(0), 1.0, 0.0)
    ep = M.bus(ep, r, hp_f=160, lp_f=5500, sat=1.3, rev=dict(rt60=1.6, amount=0.28), width=1.2)
    parts["ep"] = level(ep, -30.0)

    # ---- muted KS guitar arps
    arp = g.zeros()
    for bar in range(16):
        r0 = sc.midi(PROG[bar])
        m0 = r0
        while m0 < 55:
            m0 += 12
        while m0 >= 67:
            m0 -= 12
        tones = [m0, m0 + sc.midi(PROG[bar] + 2) - r0, m0 + sc.midi(PROG[bar] + 4) - r0, m0 + 12]
        for k in range(8):
            s = bar * 16 + 2 * k
            m = tones[ARP_IDX[k]]
            nt = M.pluck_ks(mtof(m), int(g.dur(s, 2) * 0.8), (0.85 if k % 2 == 0 else 0.55) * hum.v(), decay=0.986, damp=0.62,
                            bright=0.4, rel=0.15, seed=bar * 8 + k)
            put(arp, nt, g.t(s) + hum.t(s), 1.0, -0.35 if k % 2 else 0.35)
    arp = M.bus(arp, r, hp_f=140, lp_f=6500, sat=1.4, delay=dict(delay_s=g.sps * 3 / SR, feedback=0.28, mix=0.18, lp_fc=3200.0,
                                                                  hp_fc=250.0, stereo_pingpong=True), rev=dict(rt60=1.3, amount=0.22))
    parts["arp"] = level(arp, -27.0)

    # ---- hopeful pluck theme (bars 5-16)
    mel = g.zeros()
    for bar, s_ in MELODY.items():
        for (st, ln, d) in parse_notes(s_):
            s = bar * 16 + st
            nt = M.pluck_ks(mtof(sc.midi(d)), int(g.dur(s, ln) * 0.97), 0.9 * hum.v(), decay=0.9975, damp=0.36, bright=0.65,
                            rel=0.35, seed=bar * 5 + int(st), pick=0.15)
            put(mel, nt, g.t(s) + hum.t(s), 1.0, 0.05)
    mel = M.bus(mel, r, hp_f=200, lp_f=7500, sat=1.3, delay=dict(delay_s=g.sps * 3 / SR, feedback=0.32, mix=0.22, lp_fc=3000.0, hp_fc=300.0,
                                                                  stereo_pingpong=True), rev=dict(rt60=1.8, amount=0.3))
    parts["mel"] = level(mel, -25.0)

    # ---- drums (tape saturated boom-bap, swung hats)
    lanes = dict(kick=KICK, snare=SNARE, hat_c=HAT_C, hat_o=HAT_O)
    kit = dict(kick=dict(f0=125, f1=49.0, tp=0.03, tau=0.14, drive=1.6, click=0.22, dur=0.42, hp_f=32.0),
               snare=dict(tune=M.mtof(55), noise_lo=700.0, noise_hi=5500.0, tau_n=0.10, room=0.3, snap=0.3), hat=dict(bright=0.85),
               hat_o=dict(bright=0.85))
    drums = R.drum_stem(g, r, lanes, kit=kit, gains=dict(kick=0.95, snare=0.75, hat_c=0.4, hat_o=0.3), swing=0.14,
                        bus=dict(hp_f=28, lp_f=9500, sat=2.6, comp=(-16.0, 2.5, 10.0, 120.0, 0.0), rev=dict(rt60=0.5, amount=0.08)), crest=11.0)
    parts["drums"] = level(drums, -25.0)

    # ---- textures: tape hiss, vinyl crackle, distant workshop clinks
    hiss = np.stack([dsp.noise(g.N, r, 0.0, fmin=3500.0, fmax=12000.0), dsp.noise(g.N, r, 0.0, fmin=3500.0, fmax=12000.0)], axis=1)
    crackle = g.zeros()
    ct = np.exp(-np.arange(int(0.0012 * SR)) / (0.0003 * SR))
    for _ in range(int(g.N / SR * 5)):
        s = int(r.integers(0, g.N))
        put(crackle, ct * r.uniform(0.05, 1.0) * r.choice([-1, 1]), s, 1.0, r.uniform(-0.8, 0.8))
    clink = M.make_metal(r, f=mtof(67 + 24), ratios=(1.0, 1.5, 2.0), taus=(0.22, 0.14, 0.09), dur=0.5, click=0.4, drive=1.4)
    clinks = g.zeros()
    for bar, st, pan in [(2, 10, -0.5), (6, 10, 0.4), (10, 6, -0.3), (14, 10, 0.5)]:
        put(clinks, clink, g.t(bar * 16 + st), 0.5, pan)
    clinks = M.bus(clinks, r, hp_f=500, rev=dict(rt60=1.2, amount=0.35))
    tex = level(hiss, -44.0) + level(crackle, -45.0) + level(clinks, -40.0)
    parts["tex"] = tex

    for k, v in parts.items():
        M.dbg(k, v)
    mix = sum(parts.values())
    mix = M.tape_wow(mix, depth_ms=0.32, cycles=21)
    mix = dsp.hp(mix, 30.0, 2, loop=True)
    mix = M.saturate(mix, 1.15)
    mix = M.soft_crest(mix, 12.5)
    out, info = M.master({"mix": mix}, {"mix": 1.0}, target_lufs=-16.0, ceiling_db=-2.0)
    return out, info
