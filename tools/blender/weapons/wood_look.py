"""Local wood recipe (revolver + shotgun): straight-grain walnut with fine pores, oiled and worn.  Replaces gunlook.RECIPES['wood'] when
installed:  wood_look.install(grain=(1,0,0), dark=..., light=..., checker=fn)
checker(c, P) -> (zone, ridge) optional, adds checkering (height + slight darkening)."""
import numpy as np
import gunlook
from gunlook import smoothstep, vnoise


def install(grain=(1.0, 0.0, 0.0), dark=(0.038, 0.013, 0.005), light=(0.150, 0.060, 0.024), checker=None, stripe=1.7, wander=1.0):
    d = np.array(grain, np.float32)
    d /= np.linalg.norm(d)
    # two lateral axes
    ref = np.array([0.0, 1.0, 0.0], np.float32) if abs(d[1]) < 0.9 else np.array([1.0, 0.0, 0.0], np.float32)
    e1 = np.cross(d, ref); e1 /= np.linalg.norm(e1)
    e2 = np.cross(d, e1)

    def recipe(c, style):
        st = dict(style or {})
        P = c.P
        N = c.N
        a = P @ d
        u = P @ e1
        v = P @ e2
        # slow lateral wander of the grain along its length
        Q = np.stack([a, u, v], 1).astype(np.float32)
        wob = (vnoise(Q, (0.008, 0.04, 0.04), 5) - 0.5) * 9.0 * wander + (vnoise(Q, (0.03, 0.22, 0.22), 9) - 0.5) * 1.6 * wander
        q = (u * 0.85 + v * 1.0) + wob
        # cathedral/plain-sawn feel: stripe spacing varies with a second slow field
        f = stripe * 2.3 * (0.8 + 0.5 * vnoise(Q, (0.008, 0.04, 0.04), 21))
        s = 0.5 + 0.5 * np.sin(q * f)
        s = smoothstep(0.15, 0.95, s)
        pores = vnoise(Q, (0.045, c.fmax * 1.3, c.fmax * 1.3), 91)
        fine = vnoise(Q, (0.09, c.fmax * 0.7, c.fmax * 0.7), 93)
        grain = s * 0.34 + pores * 0.36 + fine * 0.30
        dk = np.array(st.get("wood_dark", dark), np.float32)
        lt = np.array(st.get("wood_light", light), np.float32)
        alb = dk + (lt - dk) * grain[:, None]
        alb = alb * (0.62 + 0.8 * c.nL[:, None])
        hi, lo, grime = gunlook._wear_common(c, st, 1.0, 0.7, 0.8)
        wear = np.clip(hi + lo * 0.7, 0, 1)
        bleach = np.array([0.20, 0.125, 0.065], np.float32)
        alb = alb * (1 - wear[:, None] * 0.6) + bleach * wear[:, None] * 0.6 * (0.7 + 0.5 * c.nH[:, None])
        alb = alb * (1 - grime[:, None] * 0.65) + np.array([0.022, 0.015, 0.010], np.float32) * grime[:, None] * 0.65
        h = (pores - 0.5) * 0.035 + (s - 0.5) * 0.015 - 0.05 * np.maximum(c.scr_a, c.scr_b)
        if checker is not None:
            zone, ridge = checker(c, P)
            h = h + (ridge - 1.0) * 0.34 * zone
            alb = alb * (1 - 0.35 * zone[:, None] * (1 - ridge)[:, None])
        alb = alb * (0.40 + 0.60 * c.ao_s[:, None])
        oil = smoothstep(0.45, 0.75, c.nL2)
        rough = 0.46 - 0.12 * oil + 0.16 * wear + 0.14 * grime + 0.06 * (c.nH - 0.5)
        return alb, np.clip(rough, 0.2, 1.0), np.zeros(N, np.float32), h

    gunlook.RECIPES["wood"] = recipe
    return recipe
