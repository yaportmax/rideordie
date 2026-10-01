"""Original deterministic Ride or Die DnB score. Default exports stay in work/music.

No runtime synthesis, downloaded samples, artist references, or licensed melodies.
The complete groove lives in base; extra adds pressure, never replaces the beat.
Circular placement/filtering/reverb and one exact sample grid preserve loop seams.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools" / "audio"))
import numpy as np
import scipy.signal as ss
import soundfile as sf
import dsp
import music_lib as M

SR = dsp.SR
BPM = 174
BARS = 32
TRACKS = [
    ("run_01_desert", "desert", "Dust Runner", 0),
    ("run_02_canyon", "canyon", "Redline Gorge", 1),
    ("run_03_coast", "coast", "Undertow", 2),
    ("run_04_mountain", "mountain", "Iron Pressure", 3),
    ("run_05_city", "city", "Ash Protocol", 4),
    ("run_06_dam", "dam", "Critical Mass", 5),
    ("boss_dnb", "boss", "Leviathan", 6),
]


def normalized(x, level=1.0):
    return x * (level / (np.max(np.abs(x)) + 1e-12))


def reese_note(midi, gate, level, seed, variant):
    """Moving, gritty mid bass plus a separate centered sine sub.

    No square-wave melody. Filter motion and phase beating provide movement.
    Oscillators render offline with the same antialiased toolkit as the game.
    """
    f = M.mtof(midi)
    n = gate + int(.08 * SR)
    t = np.arange(n) / SR
    det = 7 + level * 1.3
    p = .173 * seed % 1
    a = dsp.saw(f * 2 ** (det / 1200), n, p)
    b = dsp.saw(f * 2 ** (-det / 1200), n, (p + .47) % 1)
    mid = .6 * (a + b)
    # A subtle upper frequency-modulated growl appears later in the route.
    mid += (.05 + .014 * level) * np.sin(2 * np.pi * (f * 2 * t + .37 * np.sin(2 * np.pi * f * t)))
    motion = .5 + .5 * np.sin(2 * np.pi * (2.2 + variant * .53) * t + seed)
    cut = 270 + (530 + 160 * level) * motion ** 1.7
    mid = dsp.svf(mid, cut, .52 + level * .015, "lp")
    mid = dsp.hp(np.tanh(mid * (2.5 + .22 * level)), 105, 2)
    # Low bass remains mono; the stereo side is high-passed above 180 Hz.
    side = dsp.hp(a - b, 180, 2) * .055
    sub = .65 * np.sin(2 * np.pi * f * t)
    env = M.adsr_env(n, gate, a=.006, d=.08, s=.88, r=.055)
    return np.stack([(mid + sub + side) * env, (mid + sub - side) * env], axis=1)


def string_note(midi, gate, velocity, seed, low=False):
    """Dark ensemble attack with bowed/noise edge, not a bright arcade lead."""
    x = M.synth_note(M.mtof(midi), gate, .7, wave="saw", unison=5, det=12,
                     spread=.45, a=.035 if low else .14, d=.22, s=.62, r=.24,
                     fc0=1250 if low else 1750, fc1=480 if low else 800,
                     ftau=.16, q=.55, drive=.9, seed=seed)
    return x * velocity


def drum_kit(r):
    # Short modern kick, a layered high-impact snare and acoustic ghost articulations.
    kick = M.make_kick(r, f0=155, f1=50, tp=.014, tau=.057, click=.28, dur=.25, drive=1.8, hp_f=32)
    snare = M.make_snare(r, tune=178, noise_lo=850, noise_hi=9700, tau_n=.058,
                         tau_t=.029, room=.10, body=.75, snap=.75, dur=.23)
    crack = M.make_snare(r, tune=227, noise_lo=2300, noise_hi=11000, tau_n=.024,
                         tau_t=.012, room=0, body=.3, snap=.9, dur=.15)
    snare[:len(crack)] += crack * .24
    snare = normalized(snare)
    ghost = M.make_snare(r, tune=205, noise_lo=1100, noise_hi=5900, tau_n=.025,
                         tau_t=.020, room=.035, body=.65, snap=.3, dur=.115)
    hat = M.make_hat(r, bright=.87, tau=.015, dur=.09)
    hat_open = M.make_hat(r, True, bright=.91, tau=.060, dur=.19)
    shaker = M.make_shaker(r, tau=.018, dur=.08, lo=7200)
    metal = M.make_metal(r, f=433, ratios=(1, 2.1, 3.53), taus=(.026, .016, .01), dur=.105, click=.3)
    return dict(kick=kick, snare=snare, ghost=ghost, hat=hat, hat_open=hat_open, shaker=shaker, metal=metal)


def compose(track, biome, title, level):
    g = M.Grid(BPM, BARS)
    r = dsp.rng(track)
    kit = drum_kit(r)
    drums, bass, atmosphere, pressure = [g.zeros() for _ in range(4)]
    counts = dict(kicks=0, snares=0, ghost_hits=0, top_hits=0, bass_notes=0, pressure_hits=0)
    kick_steps = []
    # Each four-bar phrase resolves around D, Bb, C and A, with minor fifths.
    progressions = [
        [26, 26, 24, 26], [26, 22, 24, 26], [26, 26, 29, 24],
        [26, 22, 24, 21], [26, 26, 22, 24], [26, 22, 21, 24], [26, 25, 22, 21],
    ]
    roots = progressions[level]
    bass_patterns = [(0, 6, 10), (0, 3, 7, 10), (0, 2, 6, 10, 14),
                     (0, 3, 6, 9, 11, 14), (0, 2, 5, 7, 10, 13, 15),
                     (0, 2, 3, 6, 8, 10, 13, 15), (0, 2, 3, 5, 7, 9, 10, 13, 15)]
    for bar in range(BARS):
        phrase = bar // 8
        variant = (bar + level) % 4
        # The halftime phrase lasts only two bars and retains drum motion.
        half = phrase == 2 and bar % 8 in (0, 1)
        kick = [0, 10] if not half else [0, 7]
        if bar % 4 == 1:
            kick = [0, 9.5]
        if level >= 2 and bar % 4 == 3:
            kick.append(14)
        if level >= 4 and bar % 4 == 2:
            kick.append(6)
        for st in kick:
            M.put(drums, kit["kick"], g.t(bar * 16 + st), .80 if st == 0 else .66)
            kick_steps.append(bar * 16 + st)
            counts["kicks"] += 1
        for st in ([8] if half else [4, 12]):
            M.put(drums, kit["snare"], g.t(bar * 16 + st), .79 * (1 + r.uniform(-.025, .025)))
            counts["snares"] += 1
        ghost_pattern = [3.5, 11] + ([6.5] if level >= 1 else []) + ([15] if level >= 2 else [])
        if level >= 3:
            ghost_pattern += [5.5, 13.5]
        if level >= 5:
            ghost_pattern += [1.5, 9]
        for j, st in enumerate(ghost_pattern):
            # Shuffle is a deliberate ~7 ms displacement, not random frame timing.
            M.put(drums, kit["ghost"], g.t(bar * 16 + st) + int(.004 * SR),
                  .10 + .018 * level + .025 * (j % 2), -.04 if j % 2 else .04)
            counts["ghost_hits"] += 1
        for st in range(0, 16, 2):
            M.put(drums, kit["hat"], g.t(bar * 16 + st), .11 if st % 4 else .155, .21)
            counts["top_hits"] += 1
        for st in range(1, 16, 2):
            if level >= 1 or st in (3, 11):
                M.put(drums, kit["shaker"], g.t(bar * 16 + st) + int(.007 * SR), .065 + .008 * level, -.23)
                counts["top_hits"] += 1
        for st in [2, 14]:
            M.put(drums, kit["hat_open"], g.t(bar * 16 + st), .115, -.15)
        if bar % 4 == 3:
            # Evolving short rolls rather than a stock repeated fill every bar.
            roll = [14, 14.5, 15, 15.5] if level >= 2 else [14.5, 15.5]
            for j, st in enumerate(roll):
                M.put(drums, kit["ghost"], g.t(bar * 16 + st), .12 + .035 * j, .03)
                counts["ghost_hits"] += 1
        root = roots[bar % 4]
        pat = list(bass_patterns[level])
        if half:
            pat = [0, 7, 11]
        if bar % 8 == 7:
            pat[-1] = min(pat[-1], 14)
        for j, st in enumerate(pat):
            end = pat[j + 1] if j + 1 < len(pat) else 16
            gate = int(g.dur(bar * 16 + st, end - st) * (.84 if j % 2 else .96))
            note = root + (12 if j == len(pat) - 1 and bar % 8 == 7 else 0)
            n = reese_note(note, max(500, gate), level, bar * 19 + j, variant)
            M.put(bass, n, g.t(bar * 16 + st), .40 + .025 * level)
            counts["bass_notes"] += 1
        # A low, sparse ensemble chord with no nursery-like arpeggio hook.
        if bar % 2 == 0:
            chord = [root + 24, root + 31, root + 39]
            for j, note in enumerate(chord):
                x = string_note(note, g.dur(bar * 16, 30), .045 + level * .004, bar * 7 + j)
                M.put(atmosphere, x, g.t(bar * 16), 1)
        if level >= 2:
            pulse_positions = [0, 6, 10] if level < 4 else [0, 3, 6, 8, 10, 14]
            for j, st in enumerate(pulse_positions):
                n = string_note(root + 24 + (7 if j % 3 == 2 else 0), g.dur(bar * 16 + st, 1.7),
                                .036 + .004 * level, bar * 11 + j, low=True)
                M.put(atmosphere, n, g.t(bar * 16 + st), 1, -.18 + .12 * (j % 3))
        # The adaptive pressure stem adds technical break detail and orchestra.
        for st in [2.5, 7.5, 10.5, 14.5] + ([1, 5, 9, 13] if level >= 3 else []):
            M.put(pressure, kit["ghost"], g.t(bar * 16 + st), .16 + .012 * level, -.12 if st % 2 else .12)
            counts["pressure_hits"] += 1
        for st in [6, 15] + ([1, 9] if level >= 4 else []):
            M.put(pressure, kit["metal"], g.t(bar * 16 + st), .060 + .007 * level, -.28 if st < 8 else .28)
            counts["pressure_hits"] += 1
        for st in range(0, 16, 2 if level >= 3 else 4):
            n = string_note(root + 24 + (7 if st % 8 == 6 else 0), g.dur(bar * 16 + st, 1.1),
                            .045, bar * 31 + st, low=True)
            M.put(pressure, n, g.t(bar * 16 + st), 1)
    bass *= M.duck_env(g, kick_steps, depth=.43, tau=.043)[:, None]
    # Different sound design for the coast/wilderness/industrial stages.
    atmosphere = M.bus(atmosphere, r, hp_f=160, lp_f=2500 + level * 110,
                       rev=dict(rt60=.8 + .07 * level, amount=.18), width=1.15)
    pressure = M.bus(pressure, r, hp_f=185, lp_f=8500, rev=dict(rt60=.45, amount=.055))
    drums = M.bus(drums, r, hp_f=28, lp_f=15000, sat=.7)
    bass = M.bus(bass, r, hp_f=30, lp_f=5400, sat=.7)
    # Per-layer normalization is used for musical balance, never stage loudness.
    drum_gain = 10 ** ((-19.5 - M.lufs(drums)) / 20)
    bass_gain = 10 ** ((-23.5 - M.lufs(bass)) / 20)
    atmos_gain = 10 ** ((-32 - M.lufs(atmosphere)) / 20)
    extra_gain = 10 ** ((-27 - M.lufs(pressure)) / 20)
    stems = dict(base=drums * drum_gain + bass * bass_gain + atmosphere * atmos_gain,
                 extra=pressure * extra_gain)
    # Shared sidechain limiter means any intermediate extra-layer gain is safe.
    # Vorbis can overshoot short snare transients. Leave encoding headroom here
    # and measure the decoded playback sum and oversampled true peak below.
    out, master = M.master(stems, dict(base=1, extra=1), target_lufs=-15.8, ceiling_db=-4.5)
    return out, dict(track=track, biome=biome, title=title, intensity_order=level + 1,
                     bpm=g.bpm, bpm_nominal=BPM, bars=BARS, samples=g.N,
                     sample_rate=SR, duration=g.N / SR, sec_per_bar=g.N / SR / BARS,
                     authored_events=counts, master=master,
                     provenance="Original deterministic offline DSP composition. No external samples or melodies.")


def seam_stats(x):
    diff = np.abs(np.diff(x, axis=0))
    jump = np.abs(x[0] - x[-1])
    p95 = np.percentile(diff, 95, axis=0)
    return dict(jump_db=round(20 * math.log10(float(jump.max()) + 1e-12), 3),
                jump_ratio_95=round(float(np.max(jump / (p95 + 1e-12))), 4),
                jump_percentile=round(float(max(np.mean(diff[:, c] < jump[c]) for c in range(2))), 4))


def export(track, biome, title, level, output):
    started = time.perf_counter()
    stems, meta = compose(track, biome, title, level)
    out = Path(output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    metrics, decoded_stems = {}, {}
    for name, x in {**stems, "mix": stems["base"] + stems["extra"]}.items():
        wav = out / f"{track}_{name}.wav"
        ogg = out / f"{track}_{name}.ogg"
        sf.write(wav, x, SR, subtype="PCM_24")
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav),
                        "-c:a", "libvorbis", "-q:a", "5", str(ogg)], check=True)
        decoded, rate = sf.read(ogg, always_2d=True)
        assert rate == SR and len(decoded) == meta["samples"]
        assert np.all(np.isfinite(decoded))
        if name in ("base", "extra"):
            decoded_stems[name] = decoded
        metrics[name] = dict(file=ogg.name, bytes=ogg.stat().st_size,
                             sha256=hashlib.sha256(ogg.read_bytes()).hexdigest(),
                             decoded_lufs=round(M.lufs(decoded), 3),
                             peak_db=round(20 * math.log10(float(np.max(np.abs(decoded))) + 1e-12), 3),
                             true_peak_4x_db=round(20 * math.log10(float(np.max(np.abs(ss.resample_poly(decoded, 4, 1)))) + 1e-12), 3),
                             dc_max=round(float(np.max(np.abs(np.mean(decoded, axis=0)))), 8),
                             source_seam=seam_stats(x), decoded_seam=seam_stats(decoded),
                             decode_pcm_bytes=meta["samples"] * 2 * 4)
    meta["files"] = metrics
    meta["decoded_playback_levels"] = []
    for v in (0, .25, .5, .75, 1):
        mix = decoded_stems["base"] + decoded_stems["extra"] * v
        meta["decoded_playback_levels"].append(dict(extra_gain=v, lufs=round(M.lufs(mix), 3),
            peak_db=round(20 * math.log10(float(np.max(np.abs(mix))) + 1e-12), 3),
            true_peak_4x_db=round(20 * math.log10(float(np.max(np.abs(ss.resample_poly(mix, 4, 1)))) + 1e-12), 3),
            seam=seam_stats(mix)))
    assert max(v["true_peak_4x_db"] for v in meta["decoded_playback_levels"]) < -1
    meta["render_seconds"] = round(time.perf_counter() - started, 3)
    (out / f"{track}.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(dict(track=track, duration=meta["duration"], mix_lufs=metrics["mix"]["decoded_lufs"],
                         peak=metrics["mix"]["peak_db"], source_seam=metrics["mix"]["source_seam"],
                         decoded_seam=metrics["mix"]["decoded_seam"], seconds=meta["render_seconds"])), flush=True)
    return meta


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("tracks", nargs="*")
    parser.add_argument("--output", default=str(ROOT / "work" / "music" / "rendered"))
    args = parser.parse_args()
    chosen = [t for t in TRACKS if not args.tracks or t[0] in args.tracks or t[1] in args.tracks]
    if not chosen:
        parser.error("No matching track")
    results = [export(*t, args.output) for t in chosen]
    (Path(args.output) / "last-build.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
