"""render.py - sound registry, finalisation, encoding (ffmpeg libvorbis q5), QA measurement, parallel build."""
import importlib
import json
import math
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "audio")
META = os.path.join(HERE, "meta")

import dsp
from dsp import SR, db, to_db

GROUP_MODULES = {
    "guns": "g_guns",
    "impacts": "g_impacts",
    "explosions": "g_explosions",
    "vehicles": "g_vehicles",
    "ui": "g_ui",
    "stingers": "g_stingers",
    "ambience": "g_ambience",
    "music": "g_music",
}

REG = {}   # (group, name) -> entry


def sound(group, name, n=1, loop=False, norm=("peak", -1.5), category=None, notes="", ch=1, rel_db=0.0,
          extra=None, ceiling=-1.5, quality=5):
    """Register a synth function fn(v, r) -> ndarray (mono (n,) or stereo (n,2)). r is a seeded RNG."""
    def deco(fn):
        REG[(group, name)] = dict(group=group, name=name, n=n, loop=loop, norm=norm, category=category or group,
                                  notes=notes, ch=ch, rel_db=rel_db, extra=extra or {}, fn=fn, ceiling=ceiling,
                                  quality=quality)
        return fn
    return deco


def fname(entry, v):
    return entry["name"] if entry["n"] == 1 else f"{entry['name']}_{v + 1}"


# ----------------------------------------------------------------------------------------- loudness
_meter = None


def _get_meter():
    global _meter
    if _meter is None:
        import pyloudnorm as pyln
        _meter = pyln.Meter(SR)
    return _meter


def k_weight(x):
    m = _get_meter()
    x2 = x.reshape(len(x), -1)
    y = x2
    for key, stage in m._filters.items():
        y = stage.apply_filter(y)
    return y


def lufs_integrated(x):
    import pyloudnorm as pyln
    x2 = x.reshape(len(x), -1)
    if len(x2) < int(0.5 * SR):
        x2 = np.concatenate([x2, np.zeros((int(0.5 * SR) - len(x2), x2.shape[1]))])
    try:
        v = _get_meter().integrated_loudness(x2)
        if not np.isfinite(v):
            return -70.0
        return float(v)
    except Exception:
        return -70.0


def lufs_window_max(x, win=0.4, hop=0.05):
    """Max K-weighted loudness (LUFS) over sliding windows of `win` seconds."""
    y = k_weight(x)
    w = int(win * SR)
    h = int(hop * SR)
    n = len(y)
    if n < w:
        y = np.concatenate([y, np.zeros((w - n, y.shape[1]))])
        n = len(y)
    sq = np.sum(np.square(y), axis=1)
    c = np.concatenate([[0], np.cumsum(sq)])
    best = -200.0
    for s in range(0, n - w + 1, h):
        e = (c[s + w] - c[s]) / w
        best = max(best, -0.691 + 10 * math.log10(e + 1e-20))
    return best


def lufs_momentary_max(x):
    return lufs_window_max(x, 0.4, 0.05)


def analyze(x, loop=False):
    x2 = x.reshape(len(x), -1)
    m = dsp.mono(x)
    pk = dsp.peak(x)
    out = dict(
        duration=round(len(x) / SR, 4),
        peak_db=round(to_db(pk), 2),
        rms_db=round(to_db(dsp.rms(x)), 2),
        lufs_i=round(lufs_integrated(x), 2),
        lufs_m=round(lufs_momentary_max(x), 2),
        lufs_s=round(lufs_window_max(x, 0.1, 0.025), 2),
        dc=round(float(np.mean(x2)), 6),
        centroid=round(dsp.spectral_centroid(x), 0),
        clip=int(np.sum(np.abs(x2) >= 0.999)),
    )
    a = np.abs(m)
    if pk > 0:
        on = int(np.argmax(a > 0.01 * pk))
        pk_i = int(np.argmax(a >= 0.9 * pk))
        out["rise_ms"] = round((pk_i - on) / SR * 1000, 2)
        # tail: 10 ms rms window
        w = int(0.01 * SR)
        if len(m) > w:
            env = np.sqrt(np.convolve(m * m, np.ones(w) / w, mode="same"))
            below = np.nonzero(env > pk * db(-50))[0]
            out["tail_50db_s"] = round(float(below[-1]) / SR, 3) if len(below) else 0.0
    # band energy (dB relative to total)
    X = np.abs(np.fft.rfft(m)) ** 2 if len(m) > 32 else np.ones(2)
    f = np.fft.rfftfreq(len(m), 1 / SR) if len(m) > 32 else np.array([0, 1])
    tot = X.sum() + 1e-20
    bands = [(0, 150), (150, 800), (800, 4000), (4000, 22050)]
    out["bands_db"] = [round(10 * math.log10(X[(f >= lo) & (f < hi)].sum() / tot + 1e-12), 1) for lo, hi in bands]
    if loop:
        out["loop_jump"] = round(dsp.loop_jump(x), 2)
    return out


# ----------------------------------------------------------------------------------------- finalise & encode
def _finalize(entry, x):
    x = np.nan_to_num(np.asarray(x, dtype=np.float64))
    if entry["ch"] == 1 and x.ndim == 2:
        x = x.mean(axis=1)
    if entry["ch"] == 2 and x.ndim == 1:
        x = np.stack([x, x], axis=1)
    if entry["loop"]:
        x = x - x.mean(axis=0)
    else:
        x = dsp.hp(x, 10.0, 1)  # dc / infra removal
        # tiny fade-out to avoid end clicks
        x = dsp.fade(x, 0.0, min(0.03, 0.2 * len(x) / SR))
        x = dsp.fade(x, 0.0002, 0.0)
    kind, val = entry["norm"][0], entry["norm"][1]
    if kind == "peak":
        x = dsp.normalize_peak(x, val)
    elif kind == "lufs":
        cur = lufs_integrated(x)
        x = x * db(val - cur)
        if dsp.peak(x) > db(entry["ceiling"]):
            x = dsp.limit(x, entry["ceiling"], 2.5, 60.0, loop=entry["loop"])
    elif kind == "none":
        pass
    return x


def encode_ogg(x, path, quality=5):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    ch = 1 if x.ndim == 1 else x.shape[1]
    raw = np.ascontiguousarray(x.astype(np.float32)).tobytes()
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-i", "-",
           "-c:a", "libvorbis", "-q:a", str(quality), "-ar", str(SR), path]
    p = subprocess.run(cmd, input=raw, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode("utf8", "replace"))


def decode_ogg(path):
    import soundfile as sf
    x, sr = sf.read(path, dtype="float64", always_2d=True)
    assert sr == SR, sr
    return x[:, 0] if x.shape[1] == 1 else x


def encode_verified(x, path, quality=5, ceiling_db=-1.0, target_db=None):
    """Encode, decode; keep decoded peak <= ceiling. If target_db is given (peak-normalised sounds) also raise the
    level when the codec lowered the peak below target-0.5 dB."""
    hi = db(ceiling_db) - 1e-4
    lo = db(target_db - 0.5) if target_db is not None else 0.0
    for it in range(5):
        encode_ogg(x, path, quality)
        y = decode_ogg(path)
        pk = dsp.peak(y)
        if lo <= pk <= hi:
            return x, y
        goal = target_db if target_db is not None else ceiling_db - 0.3
        x = x * (db(goal) / pk)
    return x, y


def _metric(entry, x):
    return lufs_integrated(x) if entry["loop"] else lufs_window_max(x, 0.1, 0.025)


def build_sound(job):
    """Render every variation of one sound, equalise loudness across variations, encode, measure."""
    group, name = job
    importlib.import_module(GROUP_MODULES[group])
    entry = REG[(group, name)]
    t0 = time.time()
    xs = []
    for v in range(entry["n"]):
        r = dsp.rng(f"{group}/{name}", v)
        xs.append(_finalize(entry, entry["fn"](v, r)))
    if entry["n"] > 1 and entry["norm"][0] != "none":
        ms = np.array([_metric(entry, x) for x in xs])
        target = float(np.median(ms))
        for i, x in enumerate(xs):
            d = float(np.clip(target - ms[i], -6.0, 6.0))
            if abs(d) < 0.2:
                continue
            y = x * db(d)
            if dsp.peak(y) > db(entry["ceiling"]):
                y = dsp.limit(y, entry["ceiling"], 1.0, 40.0, loop=entry["loop"])
            xs[i] = y
    out = []
    for v, x in enumerate(xs):
        fn = fname(entry, v)
        path = os.path.join(OUT, group, fn + ".ogg")
        x, y = encode_verified(x, path, entry["quality"], target_db=None)
        meta = analyze(y, entry["loop"])
        meta["src_len"] = len(x)
        meta["dec_len"] = len(y)
        meta["file"] = f"{group}/{fn}.ogg"
        meta["variation"] = v
        meta["bytes"] = os.path.getsize(path)
        meta["build_s"] = round(time.time() - t0, 2)
        if entry["loop"]:
            meta["loop_jump_src"] = round(dsp.loop_jump(x), 2)
        os.makedirs(os.path.join(META, group), exist_ok=True)
        with open(os.path.join(META, group, fn + ".json"), "w") as f:
            json.dump(meta, f)
        out.append((group, name, v, meta))
    return out


def _init_worker():
    for m in GROUP_MODULES.values():
        try:
            importlib.import_module(m)
        except ModuleNotFoundError:
            pass


def load_group(group):
    mod = GROUP_MODULES[group]
    importlib.import_module(mod)


def jobs_for(group, only=None):
    load_group(group)
    js = []
    for (g, n), e in REG.items():
        if g != group:
            continue
        if only and not any(o == n or n.startswith(o) for o in only):
            continue
        js.append((g, n))
    return js


def build(group, only=None, workers=None, verbose=True):
    js = jobs_for(group, only)
    t0 = time.time()
    res = []
    workers = workers or min(os.cpu_count() or 4, 16)
    # longest-first would be nicer; simple ordering is fine
    if len(js) == 1 or workers == 1:
        for j in js:
            res.extend(build_sound(j))
    else:
        with ProcessPoolExecutor(max_workers=workers, initializer=_init_worker) as ex:
            for r in ex.map(build_sound, js, chunksize=1):
                res.extend(r)
    if verbose:
        for g, n, v, m in res:
            print(f"{m['file']:<44} {m['duration']:6.2f}s pk{m['peak_db']:6.1f} rms{m['rms_db']:6.1f} "
                  f"LUFSi{m['lufs_i']:6.1f} m{m['lufs_m']:6.1f} rise{m.get('rise_ms', 0):5.1f}ms "
                  f"tail{m.get('tail_50db_s', 0):5.2f}s c{m['centroid']:6.0f} {'LJ%.2f' % m['loop_jump'] if 'loop_jump' in m else ''}")
        print(f"built {len(res)} files in {time.time() - t0:.1f}s")
    return res
