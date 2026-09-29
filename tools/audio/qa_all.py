"""qa_all.py - objective checks over every built file (decoded from the OGGs)."""
import glob, json, math, os, sys
import numpy as np, soundfile as sf
import dsp
import render as R

def check(path):
    x, sr = sf.read(path, dtype="float64", always_2d=True)
    m = x.mean(axis=1)
    pk = np.abs(x).max()
    res = dict(file=os.path.relpath(path, R.OUT).replace("\\", "/"), sr=sr, ch=x.shape[1], dur=len(x)/sr)
    res["peak_db"] = 20*math.log10(pk+1e-12)
    res["nan"] = bool(np.isnan(x).any())
    res["clip"] = int((np.abs(x) >= 0.9999).sum())
    res["dc"] = float(np.abs(x.mean(axis=0)).max())
    # onset / trailing level
    a = np.abs(m)
    on = int(np.argmax(a > 0.01*pk)) if pk > 0 else 0
    res["onset_ms"] = on/sr*1000
    tail = np.abs(m[-int(0.005*sr):]).max() if len(m) > 300 else 0
    res["end_db_rel"] = 20*math.log10(tail/pk+1e-12) if pk > 0 else -200
    res["jump"] = dsp.loop_jump(x)
    return res

def main(groups=None):
    rows = []
    for f in sorted(glob.glob(os.path.join(R.OUT, "*", "*.ogg"))):
        g = os.path.basename(os.path.dirname(f))
        if groups and g not in groups: continue
        rows.append(check(f))
    man = json.load(open(os.path.join(R.OUT, "manifest.json")))["sounds"] if os.path.exists(os.path.join(R.OUT, "manifest.json")) else {}
    loops = {v["file"]: v["loop"] for v in man.values()}
    bad = []
    for r in rows:
        issues = []
        if r["sr"] != 44100: issues.append("sr")
        if r["peak_db"] > -1.0: issues.append(f"peak {r['peak_db']:.2f}")
        if r["nan"]: issues.append("nan")
        if r["clip"]: issues.append("clip")
        if r["dc"] > 0.003: issues.append(f"dc {r['dc']:.4f}")
        is_loop = loops.get(r["file"], False)
        if is_loop and r["jump"] > 1.5: issues.append(f"loop-jump {r['jump']:.2f}")
        if not is_loop:
            if r["onset_ms"] > 12 and r["dur"] < 1.0 and not any(k in r["file"] for k in ("riser", "whoosh", "menu_", "grenade_throw", "belt_in")): issues.append(f"late onset {r['onset_ms']:.0f}ms")
            if r["end_db_rel"] > -34 and "riser" not in r["file"] and "engine_start" not in r["file"]: issues.append(f"abrupt end {r['end_db_rel']:.0f}dB")
        if issues: bad.append((r["file"], issues))
    print(f"checked {len(rows)} files; {len(bad)} with issues")
    for f, i in bad: print("  ", f, "; ".join(i))
    tot = sum(os.path.getsize(f) for f in glob.glob(os.path.join(R.OUT, "*", "*.ogg")))
    print(f"total size {tot/1e6:.2f} MB")
    return rows, bad

if __name__ == "__main__":
    main(sys.argv[1:] or None)
