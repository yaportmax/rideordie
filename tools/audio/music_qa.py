"""music_qa.py - objective QA of the built music files (decodes the produced .ogg with soundfile).

  python music_qa.py                # all music tracks
  python music_qa.py run_a boss     # tracks by name prefix

Checks: stem lengths, loop seams, DC, peak, sum-of-stems loudness / crest / spectral balance, chroma (in-scale energy,
tonic/fifth dominance) per pitched stem, rhythm (kick on every beat, beat period from onset autocorrelation, grid
alignment of drum transients, sidechain-duck periodicity).
"""
import json
import math
import os
import sys

import numpy as np
import scipy.ndimage as ndi
import scipy.signal as ss
import soundfile as sf

import dsp
import music_lib as M
import render as R
from dsp import SR

OUT = os.path.join(R.OUT, "music")
STEMS = ["base", "drums", "lead", "extra"]


def load(name):
    x, sr = sf.read(os.path.join(OUT, name + ".ogg"), dtype="float64", always_2d=True)
    assert sr == SR
    return x


def pk_db(x):
    return 20 * math.log10(float(np.abs(x).max()) + 1e-12)


def jump_ratio(x, pct=95.0):
    d = np.abs(np.diff(x, axis=0))
    typ = np.percentile(d, pct, axis=0) + 1e-9
    return float(np.max(np.abs(x[0] - x[-1]) / typ))


def seam(x):
    ratio = jump_ratio(x, 95.0)
    k = int(0.005 * SR)
    m = x.mean(axis=1)
    d_seam = float(np.sqrt(np.mean((m[-k:] - m[:k]) ** 2)))
    ds = []
    for p in range(k, len(m) - 2 * k, k // 2):
        ds.append(np.sqrt(np.mean((m[p:p + k] - m[p + k:p + 2 * k]) ** 2)))
    ds = np.array(ds)
    return dict(jump_ratio=round(ratio, 2), jump_ratio_995=round(jump_ratio(x, 99.5), 2), seam_rms=round(d_seam, 5), interior_med=round(float(np.median(ds)), 5),
                seam_vs_med=round(d_seam / (float(np.median(ds)) + 1e-12), 2), seam_pct=round(float(np.mean(ds < d_seam)), 3))


def bands(x):
    m = x
    X = np.abs(np.fft.rfft(m, axis=0)) ** 2
    X = X.sum(axis=1)
    f = np.fft.rfftfreq(len(m), 1 / SR)
    edges = [0, 120, 500, 2000, 8000, 30000]
    tot = X.sum()
    return [float(X[(f >= a) & (f < b)].sum() / tot) for a, b in zip(edges[:-1], edges[1:])]


# ------------------------------------------------------------------------------------------------- chroma
def chroma(x, fmin, fmax, scale_pcs, tonic_pc, win=8192, hop=4096, prom_db=9.0, attribute=True, merge_hz=0.0):
    xm = x.mean(axis=1)
    w = np.hanning(win)
    freqs = np.fft.rfftfreq(win, 1 / SR)
    pc_e = np.zeros(12)
    raw_e = np.zeros(12)
    for start in range(0, len(xm) - win, hop):
        X = np.abs(np.fft.rfft(xm[start:start + win] * w))
        if X.max() < 1e-4:
            continue
        floor = ndi.median_filter(X, size=81)
        pk, _ = ss.find_peaks(X, height=X.max() * 10 ** (-55 / 20))
        pk = [k for k in pk if X[k] > floor[k] * 10 ** (prom_db / 20) and 2 <= k < len(X) - 1]
        pts = []
        for k in pk:
            a, b, c = np.log(X[k - 1] + 1e-12), np.log(X[k] + 1e-12), np.log(X[k + 1] + 1e-12)
            d = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
            f = (k + d) * SR / win
            e = X[k - 1] ** 2 + X[k] ** 2 + X[k + 1] ** 2
            pts.append((f, e))
        if merge_hz > 0:
            # amplitude-modulation sidebands (sidechain ducking / note gating) within merge_hz of a stronger peak are
            # merged into it (they are not separate pitches)
            kept = []
            for f, e in sorted(pts, key=lambda p_: -p_[1]):
                for kp in kept:
                    if abs(kp[0] - f) < merge_hz:
                        kp[1] += e
                        break
                else:
                    kept.append([f, e])
            pts = [(f, e) for f, e in kept]
        pts.sort()
        acc = []
        for f, e in pts:
            pc = int(round(12 * math.log2(f / 440.0) + 69)) % 12
            if fmin <= f <= fmax:
                raw_e[pc] += e
            got = False
            if attribute:
                for fa, pca, ea in acc:
                    ratio = f / fa
                    kk = round(ratio)
                    if 2 <= kk <= 12 and abs(ratio - kk) / kk < 0.03 and e <= ea * 2.0:
                        pc_e[pca] += e if fmin <= fa <= fmax else 0.0
                        got = True
                        break
            if not got:
                acc.append((f, pc, e))
                if fmin <= f <= fmax:
                    pc_e[pc] += e
    res = {}
    for nm, arr in (("attributed", pc_e), ("raw", raw_e)):
        tot = arr.sum() + 1e-20
        ins = sum(arr[p] for p in scale_pcs) / tot
        res[nm] = dict(in_scale=round(float(ins), 4), tonic=round(float(arr[tonic_pc] / tot), 3),
                       fifth=round(float(arr[(tonic_pc + 7) % 12] / tot), 3),
                       top_pcs=[M.NOTE_NAMES[i] for i in np.argsort(-arr)[:3]])
    return res


# ------------------------------------------------------------------------------------------------- rhythm
def band_env(x, lo, hi, win_ms=5.0):
    m = x.mean(axis=1)
    y = dsp.bp(m, lo, hi, 2, loop=True)
    w = int(win_ms * 1e-3 * SR)
    e = np.sqrt(ndi.uniform_filter1d(y * y, size=w, mode="wrap"))
    return e


def circ_autocorr(e):
    e = e - e.mean()
    F = np.fft.rfft(e)
    ac = np.fft.irfft(F * np.conj(F), len(e))
    return ac / (ac[0] + 1e-20)


def onset_offsets(x, step_samples):
    """rising-edge onsets of the (>200 Hz) drum signal -> signed deviation (ms) from the nearest 16th-note grid line."""
    m = x.mean(axis=1)
    hf = dsp.hp(m, 200.0, 2, loop=True)
    env = ndi.uniform_filter1d(np.abs(hf), size=int(0.0008 * SR), mode="wrap")
    W = int(0.006 * SR)
    gap = int(0.001 * SR)
    A = ndi.uniform_filter1d(env, size=W, mode="wrap")
    prev = np.roll(A, W // 2 + gap)
    rise = env - prev
    pk, _ = ss.find_peaks(rise, height=rise.max() * 0.40, distance=int(0.03 * SR))
    offs = []
    for p in pk:
        q = p
        while q > 0 and rise[q - 1] > 0.4 * rise[p]:
            q -= 1
        st = q / step_samples
        offs.append((st - round(st)) * step_samples / SR * 1000.0)
    return np.array(offs)


def rhythm(drums, bpm_actual, bars, step_samples):
    beat = 60.0 / bpm_actual
    beat_n = beat * SR
    e = band_env(drums, 40, 90)
    ac = circ_autocorr(band_env(drums, 40, 90, win_ms=15.0))
    acs = ac
    lags = np.arange(len(e)) / SR
    sel = (lags > 0.15) & (lags < 2.0)
    mx = acs[sel].max()
    lo_i, hi_i = int(0.95 * beat * SR), int(1.05 * beat * SR)
    i = lo_i + int(np.argmax(acs[lo_i:hi_i]))
    a_, b_, c_ = acs[i - 1], acs[i], acs[i + 1]
    dlt = 0.5 * (a_ - c_) / (a_ - 2 * b_ + c_) if (a_ - 2 * b_ + c_) != 0 else 0.0
    period = (i + dlt) / SR
    ac_at_beat = float(acs[i] / mx)
    sh = (lags > 0.15) & (lags < 0.9 * beat)
    shorter = float(acs[sh].max() / mx) if sh.any() else 0.0
    nb = bars * 4
    post, pre = [], []
    for b in range(nb):
        s0 = int(round(b * beat_n))
        w = int(0.030 * SR)
        post.append(float(np.mean(e[(s0 + np.arange(w)) % len(e)] ** 2)))
        pre.append(float(np.mean(e[(s0 - w - int(0.002 * SR) + np.arange(w)) % len(e)] ** 2)))
    post, pre = np.array(post), np.array(pre)
    onset_db = 10 * np.log10(post / (pre + 1e-20))
    offs = onset_offsets(drums, step_samples)
    eng = []
    for b in range(nb):
        s0 = int(round(b * beat_n))
        w = int(0.050 * SR)
        eng.append(float(np.mean(e[(s0 + np.arange(w)) % len(e)] ** 2)))
    eng = np.array(eng)
    return dict(beat_s=round(beat, 5), ac_period_s=round(float(period), 5), period_err_pct=round(abs(period - beat) / beat * 100, 3), ac_at_beat=round(ac_at_beat, 3), ac_shorter=round(shorter, 3),
                kicks_present=int((eng >= 0.25 * np.median(eng)).sum()), kick_e_min_db=round(float(10 * np.log10(eng.min() / np.median(eng))), 1), beats=nb, kick_onset_db_min=round(float(onset_db.min()), 1),
                kick_onset_db_med=round(float(np.median(onset_db)), 1),
                onsets=len(offs), grid_dev_ms_p95=round(float(np.percentile(np.abs(offs), 95)), 2) if len(offs) else None,
                grid_dev_ms_med=round(float(np.median(np.abs(offs))), 2) if len(offs) else None,
                grid_dev_ms_max=round(float(np.abs(offs).max()), 2) if len(offs) else None)


def duck_check(base, bpm_nominal, bars):
    """(a) the sidechain envelope generator itself: dip position/depth/recovery identical on every beat (+-1 sample);
    (b) audio: correlation of the beat-slot envelope of the base stem across bars (rhythmic regularity incl. pumping)."""
    g = M.Grid(bpm_nominal, bars)
    steps = [4 * b for b in range(bars * 4)]
    env = M.duck_env(g, steps, 0.66, 0.05)
    offs, mins, rec = [], [], []
    for b in range(bars * 4):
        s0 = g.t(4 * b)
        seg = env[(s0 + np.arange(int(0.28 * SR))) % g.N]
        offs.append(int(np.argmin(seg)))
        mins.append(float(seg.min()))
        rec.append(int(np.argmax(seg[int(np.argmin(seg)):] > 0.9)) / SR * 1000.0)
    beat_n = g.sps * 4
    m = base.mean(axis=1)
    y = dsp.bp(m, 300.0, 1400.0, 2, loop=True)
    e = np.sqrt(ndi.uniform_filter1d(y * y, size=int(0.002 * SR), mode="wrap"))
    L = int(0.45 * beat_n)
    segs = np.array([e[(int(round(b * beat_n)) - 441 + np.arange(L + 882)) % len(e)] for b in range(bars * 4)])
    corr, lags = [], []
    for ph in range(bars // 4):
        for slot in range(4):
            grp = segs[ph * 16 + slot: ph * 16 + 16: 4]
            tpl = np.median(grp, axis=0)
            for sgm in grp:
                best = (-2.0, 0)
                for lg in range(-441, 442, 11):
                    a = sgm[441 + lg:441 + lg + L]
                    c = float(np.corrcoef(a, tpl[441:441 + L])[0, 1])
                    if c > best[0]:
                        best = (c, lg)
                corr.append(best[0])
                lags.append(best[1] / SR * 1000.0)
    return dict(gen_dip_offset_samples=sorted(set(offs)), gen_min_gain=round(min(mins), 3), gen_recover90_ms=round(float(np.mean(rec)), 1),
                slot_corr_mean=round(float(np.mean(corr)), 3), slot_corr_min=round(float(np.min(corr)), 3),
                slot_lag_ms_p90=round(float(np.percentile(np.abs(lags), 90)), 2), slot_lag_ms_max=round(float(np.abs(lags).max()), 2))


# ------------------------------------------------------------------------------------------------- track analysis
def analyse_track(track, entries, verbose=True):
    """entries: list of (out_name, stem_key, extra)."""
    ex0 = entries[0][2]
    key = ex0["key"]
    tonic_name, mode = key.split()[0], key.split()[1]
    tonic_pc = M.NOTE_NAMES.index(tonic_name)
    steps = M.SCALES[{"minor": "minor", "phrygian": "phrygian", "harmonic": "harmonic", "major": "major", "dorian": "dorian",
                      "phrygdom": "phrygdom", "phrygian-dominant": "phrygdom"}.get(mode, mode)]
    scale_pcs = sorted({(tonic_pc + s) % 12 for s in steps})
    rep = dict(track=track, key=key, bpm=ex0["bpm"], bars=ex0["bars"], scale_pcs=[M.NOTE_NAMES[p] for p in scale_pcs])
    sig = {}
    for name, stem, ex in entries:
        sig[stem] = load(name)
    lens = {k: len(v) for k, v in sig.items()}
    rep["lengths"] = lens
    rep["equal_length"] = len(set(lens.values())) == 1
    rep["duration_s"] = round(min(lens.values()) / SR, 4)
    rep["stems"] = {}
    for k, x in sig.items():
        d = dict(peak_db=round(pk_db(x), 2), dc=round(float(np.abs(x.mean(axis=0)).max()), 6),
                 lufs=round(R.lufs_integrated(x), 2), seam=seam(x))
        rep["stems"][k] = d
    if len(sig) > 1:
        n = min(lens.values())
        mix = sum(x[:n] for x in sig.values())
    else:
        mix = list(sig.values())[0]
    rms = float(np.sqrt(np.mean(mix ** 2)))
    b = bands(mix)
    mono = mix.mean(axis=1)
    mono_fold = R.lufs_integrated(np.stack([mono, mono], axis=1)) - R.lufs_integrated(mix)
    corr_lr = float(np.corrcoef(mix[:, 0], mix[:, 1])[0, 1])
    rep["mix"] = dict(mono_fold_db=round(mono_fold, 2), lr_corr=round(corr_lr, 3), lufs=round(R.lufs_integrated(mix), 2), peak_db=round(pk_db(mix), 2),
                      crest_db=round(pk_db(mix) - 20 * math.log10(rms), 2),
                      crest_vs_lufs_db=round(pk_db(mix) - R.lufs_integrated(mix), 2),
                      bands_pct=[round(v * 100, 1) for v in b],
                      flags=[f for f, c in (("bass>55%", b[0] > 0.55), ("highs>20%", b[4] > 0.20)) if c])
    # chroma
    ch = {}
    for k, x in sig.items():
        if k == "drums":
            continue
        if k == "base":
            ch[k] = chroma(x, 90, 330, scale_pcs, tonic_pc, win=16384, hop=8192)
        else:
            ch[k] = chroma(x, 100, 2500, scale_pcs, tonic_pc)
    if len(sig) == 1:
        k = list(sig)[0]
        ch = {k: chroma(sig[k], 60, 2500, scale_pcs, tonic_pc)}
    rep["chroma"] = ch
    # rhythm
    bpm = ex0["bpm"]
    step_n = SR * 15.0 / bpm
    if "drums" in sig:
        rep["rhythm"] = rhythm(sig["drums"], bpm, ex0["bars"], step_n)
    if "base" in sig:
        rep["duck"] = duck_check(sig["base"], ex0["bpmNominal"], ex0["bars"])
    return rep


def fmt(rep):
    L = []
    L.append(f"=== {rep['track']}  key {rep['key']}  bpm {rep['bpm']}  bars {rep['bars']}  dur {rep['duration_s']}s  "
             f"equal_len={rep['equal_length']} {rep['lengths']}")
    for k, d in rep["stems"].items():
        s = d["seam"]
        L.append(f"  stem {k:6s} lufs {d['lufs']:6.1f} peak {d['peak_db']:6.2f} dc {d['dc']:.6f} | seam jump p95 {s['jump_ratio']:.2f} p99.5 {s['jump_ratio_995']:.2f} "
                 f"seamRMS/med {s['seam_vs_med']:.2f} (pctile {s['seam_pct']:.2f})")
    m = rep["mix"]
    L.append(f"  MIX  mono-fold {m['mono_fold_db']:+.2f} dB (L/R corr {m['lr_corr']:.2f}) lufs {m['lufs']:6.2f} peak {m['peak_db']:6.2f} crest {m['crest_db']:5.2f} dB (peak-LUFS {m['crest_vs_lufs_db']:.2f}) "
             f"bands<120/120-500/0.5-2k/2-8k/>8k % {m['bands_pct']} flags {m['flags']}")
    for k, c in rep["chroma"].items():
        a, r_ = c["attributed"], c["raw"]
        L.append(f"  chroma {k:6s} in-scale {a['in_scale'] * 100:5.1f}% (raw {r_['in_scale'] * 100:5.1f}%)  tonic {a['tonic'] * 100:4.1f}% "
                 f"fifth {a['fifth'] * 100:4.1f}%  top {a['top_pcs']}")
    if "rhythm" in rep:
        r = rep["rhythm"]
        L.append(f"  rhythm beat {r['beat_s']}s acPeriod {r['ac_period_s']}s err {r['period_err_pct']}% (AC@beat/max {r['ac_at_beat']}, shorter-lag/max {r['ac_shorter']}) | kicks {r['kicks_present']}/{r['beats']} "
                 f"(40-90Hz energy min {r['kick_e_min_db']} dB re median; rise min {r['kick_onset_db_min']} med {r['kick_onset_db_med']} dB) | drum onsets {r['onsets']} grid dev ms med "
                 f"{r['grid_dev_ms_med']} p95 {r['grid_dev_ms_p95']} max {r['grid_dev_ms_max']}")
    if "duck" in rep:
        d = rep["duck"]
        L.append(f"  duck gen: dip offsets(samples) {d['gen_dip_offset_samples']} min gain {d['gen_min_gain']} 90%-recovery {d['gen_recover90_ms']} ms | "
                 f"audio (300-1400 Hz) beat-slot corr mean {d['slot_corr_mean']} min {d['slot_corr_min']}, timing jitter |lag| p90 {d['slot_lag_ms_p90']} ms max {d['slot_lag_ms_max']} ms")
    return "\n".join(L)


def collect(prefixes):
    import g_music  # noqa: F401  registers
    tracks = {}
    for (g, n), e in R.REG.items():
        if g != "music":
            continue
        ex = e["extra"]
        tr = ex.get("track", n)
        if prefixes and not any(tr.startswith(p) for p in prefixes):
            continue
        key = ex.get("stem", "mix")
        tracks.setdefault(tr, []).append((n, key, ex))
    return tracks


if __name__ == "__main__":
    tr = collect(sys.argv[1:])
    allrep = {}
    for t, ents in sorted(tr.items()):
        if not all(os.path.exists(os.path.join(OUT, n + ".ogg")) for n, _, _ in ents):
            print(f"--- {t}: not built")
            continue
        rep = analyse_track(t, ents)
        allrep[t] = rep
        print(fmt(rep))
    os.makedirs(os.path.join(R.HERE, "qa"), exist_ok=True)
    p = os.path.join(R.HERE, "qa", "music_" + ("_".join(sys.argv[1:]) or "all") + ".json")
    with open(p, "w") as f:
        json.dump(allrep, f, indent=1)
