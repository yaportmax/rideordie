"""qa_engines.py - verify engine loops: fire frequency present, loop seam, loudness ramp."""
import json, sys, math
import numpy as np, soundfile as sf
import dsp
import render as R
import g_vehicles as V

def main(names=None):
    print(f"{'file':34} {'rpm':>5} {'fireHz':>7} {'peakHz':>7} {'harm(dB) 1,2,3,4':>22} {'lufs':>6} {'seam':>5} {'cent':>5}")
    for e, spec in V.ENGINES.items():
        if names and e not in names: continue
        for si, st in enumerate(V.STAGES):
            fn = f"{e}_{st}"
            x, sr = sf.read(f"{R.OUT}/vehicles/{fn}.ogg", dtype="float64")
            L = len(x)
            rpm = spec["rpms"][si]
            ncyl = 12 if spec["P"]["layout"]=="V12" else (8 if spec["P"]["layout"].startswith("V8") else (6 if spec["P"]["layout"]=="I6" else 4))
            ff = rpm/60*ncyl/2
            X = np.abs(np.fft.rfft(x*np.hanning(L)))
            f = np.fft.rfftfreq(L, 1/sr)
            # strongest bin within +-12% of f_fire and of its harmonics
            def pk(fc):
                m = (f > fc*0.88) & (f < fc*1.12)
                if not m.any(): return 0, 0
                i = np.argmax(X[m]); return f[m][i], X[m][i]
            hs = [pk(ff*k) for k in (1,2,3,4)]
            ref = max(h[1] for h in hs)+1e-9
            print(f"{fn:34} {rpm:5d} {ff:7.1f} {hs[0][0]:7.1f} " + " ".join(f"{20*np.log10(h[1]/ref+1e-9):5.0f}" for h in hs) +
                  f" {R.lufs_integrated(x):6.1f} {dsp.loop_jump(x):5.2f} {dsp.spectral_centroid(x):5.0f}")
if __name__ == "__main__":
    main(sys.argv[1:] or None)
