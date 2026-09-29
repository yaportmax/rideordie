"""City ruins (fork A): ruin_office_a/b/c, ruin_apartment_a/b, ruin_lowrise_a/b/c.   ONLY=<id> to build one."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_city_lib import *

ONLY = os.environ.get("ONLY", "")


def want(i):
    return ONLY in ("", i)


def flat_y(blk, x, z, hx, hz):
    """Roof height at (x,z) if the whole footprint (+-hx,+-hz) stands on one flat roof level, else None."""
    ys = [blk.roof_at(x + dx, z + dz) for dx in (-hx, 0, hx) for dz in (-hz, 0, hz)]
    if any(y is None for y in ys) or max(ys) - min(ys) > 0.01:
        return None
    return ys[0]


def roof_prop(blk, kind, cands, **kw):
    """Place a rooftop prop at the first candidate (x, z) that sits on one flat roof level."""
    p = blk.p
    for cand in cands:
        x, z = cand
        if kind == "mech":
            y = flat_y(blk, x, z, kw["sx"] / 2, kw["sz"] / 2)
            if y is not None:
                mech_box(p, x, y, z, kw["sx"], kw["sy"], kw["sz"], mat=kw.get("mat", "metal_bare"))
                return True
        elif kind == "tank":
            r = kw.get("r", 1.4)
            y = flat_y(blk, x, z, r, r)
            if y is not None:
                water_tank(p, x, y, z, r=r, h=kw.get("h", 2.2), legs=kw.get("legs", 1.5))
                return True
        elif kind == "antenna":
            y = flat_y(blk, x, z, 0.5, 0.5)
            if y is not None:
                antenna(p, x, y, z, h=kw.get("h", 10), lean=kw.get("lean", (0, 0)), crossbars=kw.get("crossbars", 3))
                return True
        elif kind == "box":
            y = flat_y(blk, x, z, kw["sx"] / 2, kw["sz"] / 2)
            if y is not None:
                p.bx(kw.get("mat", "brick"), (x - kw["sx"] / 2, x + kw["sx"] / 2), (y, y + kw["sy"]), (z - kw["sz"] / 2, z + kw["sz"] / 2), sub=0)
                return True
    return False


def office_a():
    p = Piece("ruin_office_a", seed=41, ground_y=0.0, dirt_h=4.0, dirt_amt=0.5, ao_dist=3.5, facejit=0.09)
    rng = wn(p)
    W, D, F, fh = 30.0, 20.0, 14, 3.6
    wounds = [
        Wound("box", lo=(3.5, 27.5, -1.0), hi=(None, None, None), jag=2.6, seed=3),          # big bite out of the top front-left corner
        Wound("box", lo=(-16, 33.5, None), hi=(-3.0, None, None), jag=2.4, seed=4),          # stepped notch: whole left top corner
        Wound("sph", c=(-6.0, 19.0, 10.0), r=5.6, jag=1.8, seed=5),                          # blast hole in the front facade
        Wound("box", lo=(-15.5, 9.0, -1.0), hi=(-9.0, 21.0, 6.0), jag=1.2, seed=8),          # rear corner gash
    ]
    b = Block(p, -W / 2, W / 2, -D / 2, D / 2, F, fh, 6, 4, wounds=wounds, sp=1.05, wh=1.95, pw=0.75,
              msp="concrete_dark", mpier="concrete", mhead="concrete_dark", pbroken=0.6, rng=rng, p_missing=0.05, curtain_p=0.05, stub_keep=0.34)
    b.build()
    top = F * fh
    # roof props on the surviving part
    roof_prop(b, "mech", [(-9, -3), (-9, 1), (-11, 3), (0, 0)], sx=6.5, sy=3.4, sz=5.0)
    roof_prop(b, "tank", [(-3.5, 4.0), (-1.5, 3.0), (-6, 4), (2, 3)], r=1.7, h=2.6, legs=1.8)
    roof_prop(b, "antenna", [(-12, 5), (-11, 6), (-13, 3), (-6, 6)], h=13, lean=(-0.10, 0.06))
    roof_prop(b, "mech", [(-13.5, -6.5), (-13.5, -3), (-3, -3), (-13.5, 6)], sx=3.0, sy=1.6, sz=2.4)
    rubble(p, 10, 14.5, 9.0, 5.5, 24, rng, big=3.0, rebar=4)
    rubble(p, -6, 12.8, 5.5, 3.2, 9, rng, big=2.0, rebar=2)
    p.notes = dict(desc="Ruined 14-floor concrete office tower, big corner bite at the top, blast hole in the front facade. Front faces +Z; origin base centre.",
                   height=round(top, 1), footprint=[W, D], front="+Z", lean_deg=3.2)
    lean(p, kx=0.045, kz=0.0, curve=0.0004)
    return p


def office_b():
    p = Piece("ruin_office_b", seed=52, ground_y=0.0, dirt_h=4.0, dirt_amt=0.5, ao_dist=3.5, facejit=0.09)
    rng = wn(p)
    PH, PF = 4.4, 3
    podium = Block(p, -20, 20, -14, 14, PF, PH, 6, 4, sp=1.2, wh=2.7, pw=1.0, proud=0.2, msp="metal_dark", mpier="steel_beam", mhead="metal_dark",
                   pbroken=0.55, rng=rng, p_missing=0.04, parapet=1.0,
                   floor_style={0: dict(sp=0.35, wh=3.4, pbroken=0.85)},
                   wounds=[Wound("sph", c=(-14, 6.0, 14.0), r=6.5, jag=1.6, seed=11),
                           Wound("box", lo=(9, 5.0, 3.0), hi=(None, None, None), jag=1.5, seed=12)])
    podium.build()
    y0 = PF * PH
    TF, TH = 13, 3.7
    tw = [Wound("half", n=(0.40, 0.92, 0.0), d=0.92 * 52.0 - 0.8, jag=1.6, seed=13),                 # slanted collapsed crown
          Wound("sph", c=(11.5, y0 + 26, -1.0), r=7.5, jag=2.0, seed=14),                             # gaping wound on the +X side
          Wound("box", lo=(-12, y0 + 30, 3.5), hi=(-6.5, None, None), jag=1.5, seed=15)]              # front-left corner gash near the top
    tower = Block(p, -11, 11, -9, 9, TF, TH, 4, 3, y0=y0, sp=1.15, wh=2.2, pw=0.85, proud=0.25, msp="metal_dark", mpier="steel_beam", mhead="metal_dark",
                  pbroken=0.5, rng=rng, p_missing=0.05, wounds=tw, mroof="concrete_dark", parapet=0.7, curtain_p=0.05)
    tower.build()
    top = y0 + TF * TH
    roof_prop(tower, "antenna", [(-8.5, -3.0), (-9.5, 0.0), (-8.5, -6.0), (-3, -6), (0, 0)], h=11.0, lean=(-0.12, 0.05), crossbars=4)
    roof_prop(tower, "mech", [(-7, -5), (-3, -5), (0, 3), (-8, 4)], sx=5.0, sy=2.6, sz=3.5)
    roof_prop(podium, "mech", [(14, -8), (15, -3), (12, -9)], sx=5.5, sy=3.0, sz=4.0)
    roof_prop(podium, "mech", [(-16, 4), (-15, 8), (-16, -6)], sx=3.5, sy=2.2, sz=3.0, mat="metal_dark")
    roof_prop(podium, "tank", [(-13, -7), (-10, -8), (-16, -9)], r=1.3, h=2.0, legs=1.4)
    rubble(p, -11, 21.0, 9.0, 6.5, 28, rng, big=3.2, rebar=5)
    rubble(p, 17, 17.0, 6.0, 5.0, 16, rng, big=2.5, rebar=3)
    p.notes = dict(desc="Ruined 3-storey podium + 13-storey dark steel/glass tower with a slanted collapsed crown and a gaping wound; leaning slightly. Front +Z, origin base centre.",
                   height=round(top, 1), footprint=[40, 28], front="+Z", lean_deg=-2.0)
    lean(p, kx=-0.035, kz=0.0, curve=0.0007)
    return p


def office_c():
    p = Piece("ruin_office_c", seed=63, ground_y=0.0, dirt_h=4.5, dirt_amt=0.55, ao_dist=3.5, facejit=0.1)
    rng = wn(p)
    # slim tall tower (right) + long low wing (left), light concrete with heavy vertical fins
    TF, TH = 16, 3.5
    WF, WH = 9, 3.6
    common = dict(sp=0.85, wh=2.0, pw=1.05, proud=0.65, msp="concrete", mpier="concrete_dark", mhead="concrete", pbroken=0.4, rng=rng, p_missing=0.04, tint_var=0.15, stub_keep=0.3, curtain_p=0.05)
    tall = Block(p, 4, 17, -7, 7, TF, TH, 3, 3, side_from={"R": WF}, parapet=0.8,
                 wounds=[Wound("half", n=(-0.62, 0.78, 0.05), d=0.78 * 46 - 0.62 * 10.0, jag=1.8, seed=21),           # slanted broken top
                         Wound("box", lo=(None, 26, -8), hi=(8.0, 38, 3.0), jag=1.6, seed=22),                           # gash on the wing side
                         Wound("sph", c=(10.5, 20, 7.5), r=5.0, jag=1.5, seed=23)], floor_style={0: dict(sp=0.4, wh=3.0, pbroken=0.8)}, **common)
    tall.build()
    wing = Block(p, -24, 4, -7, 7, WF, WH, 6, 3, sides="FBR", parapet=0.8, mroof="concrete_dark",
                 wounds=[Wound("box", lo=(-14, 24.5, -9), hi=(-2.0, None, None), jag=1.8, seed=24),                      # roof collapsed
                         Wound("sph", c=(-19, 13.0, 7.5), r=5.0, jag=1.5, seed=25)], floor_style={0: dict(sp=0.4, wh=3.0, pbroken=0.8)}, **common)
    wing.build()
    top = TF * TH
    roof_prop(tall, "antenna", [(15, -4.0), (14, 0), (6, -4), (10, 4), (6, 4)], h=11, lean=(0.10, 0.02))
    roof_prop(tall, "mech", [(10, -3), (10, 0), (6, 0)], sx=4.0, sy=2.2, sz=3.0)
    roof_prop(wing, "mech", [(-20, -3), (-21, 2), (-18, -3)], sx=6.5, sy=2.8, sz=4.0)
    roof_prop(wing, "mech", [(-6.5, 3), (-6.5, -3)], sx=4.0, sy=2.0, sz=3.0)
    roof_prop(wing, "tank", [(-9, -4), (-11, 3), (-3, -3), (-22, 3)], r=1.5, h=2.4, legs=1.6)
    rubble(p, -10.0, 11.5, 11.0, 5.0, 20, rng, big=2.8, rebar=3)
    rubble(p, 14, 12.5, 6.0, 4.5, 12, rng, big=2.6, rebar=2)
    p.notes = dict(desc="Ruined slim 16-floor tower with heavy concrete fins + a long 9-floor wing; both broken, whole complex leans hard. Front +Z, origin base centre.",
                   height=round(top, 1), footprint=[41, 14], front="+Z", lean_deg=4.5)
    lean(p, kx=0.045, kz=0.0, curve=0.006)
    return p


def apartment_a():
    p = Piece("ruin_apartment_a", seed=74, ground_y=0.0, dirt_h=3.0, dirt_amt=0.55, ao_dist=3.0, facejit=0.1)
    rng = wn(p)
    F, fh = 8, 3.0
    common = dict(sp=0.95, wh=1.5, pw=1.0, proud=0.1, depth=0.45, msp="brick", mpier="brick", mhead="brick", pbroken=0.4, rng=rng, p_missing=0.05,
                  sills=True, parapet=0.7, mroof="concrete", tint_var=0.14, pier_sub=6.0, glass="glass", mult=(0.82, 0.78, 0.76), curtain_p=0.10, ac_p=0.07)
    body = Block(p, -17, 17, -6.5, 6.5, F, fh, 9, 3, floor_style={0: dict(sp=0.5, wh=2.2, pbroken=0.85)},
                 wounds=[Wound("box", lo=(8.0, 13.0, None), hi=(None, None, None), jag=1.8, seed=31),
                         Wound("sph", c=(-3.0, 15.0, 6.5), r=4.5, jag=1.5, seed=32),
                         Wound("box", lo=(-17.5, 5.0, -8), hi=(-12.0, 10.5, -2.0), jag=1.2, seed=33)], **common)
    body.build()
    # stair tower on the left end
    st = Block(p, -20, -17, -3, 3, F + 1, fh, 1, 2, sides="FBR", sp=1.6, wh=0.9, pw=1.1, proud=0.25, msp="concrete", mpier="concrete_dark", mhead="concrete",
               pbroken=0.3, rng=rng, parapet=0.4, mroof="concrete", pier_sub=6.0,
               wounds=[Wound("half", n=(0.3, 0.95, 0.15), d=0.95 * 26.5, jag=1.0, seed=34)])
    st.build()
    balconies(body, "F", range(1, F), 0.55, rng, depth=1.5, inset=0.55)
    balconies(body, "B", range(1, F), 0.35, rng, depth=1.2, inset=0.6, collapse=0.25)
    top = F * fh
    roof_prop(body, "tank", [(-8, 0.0), (-6, 1.0), (-11, 0)], r=1.4, h=2.2, legs=1.5)
    roof_prop(body, "tank", [(-3, 0.0), (-1, 1.0), (1, 0)], r=1.2, h=2.0, legs=1.5)
    roof_prop(body, "box", [(2.0, -1.0), (-0.5, -2.0), (4.0, -1.0)], sx=1.0, sy=3.2, sz=1.0)
    roof_prop(body, "box", [(5.0, -1.0), (6.0, -2.0), (3.0, -3.0)], sx=1.0, sy=3.0, sz=1.0)
    roof_prop(body, "mech", [(-14, -2), (-12, 2), (-2, -3)], sx=3.0, sy=2.0, sz=3.0)
    rubble(p, 13.0, 11.0, 8.0, 5.0, 28, rng, big=2.6, rebar=5)
    p.notes = dict(desc="Ruined 8-floor brick apartment slab with balconies, stair tower at the -X end, collapsed +X end and a blast hole. Front +Z, origin base centre.",
                   height=round(top, 1), footprint=[37, 13], front="+Z", lean_deg=1.2)
    lean(p, kx=-0.02, kz=0.0, curve=0.0006)
    return p


def apartment_b():
    p = Piece("ruin_apartment_b", seed=85, ground_y=0.0, dirt_h=3.0, dirt_amt=0.5, ao_dist=3.0, facejit=0.1)
    rng = wn(p)
    F, fh = 7, 3.1
    common = dict(sp=0.9, wh=1.55, pw=0.8, proud=0.12, msp="concrete", mpier="concrete_dark", mhead="concrete", pbroken=0.45, rng=rng, p_missing=0.05,
                  sills=True, parapet=0.8, mroof="concrete_dark", tint_var=0.14, pier_sub=6.0, curtain_p=0.10, ac_p=0.07)
    main = Block(p, -16, 8, -5.5, 5.5, F, fh, 6, 2, skip_bays={"F": {0, 1, 2}}, floor_style={0: dict(sp=0.5, wh=2.2, pbroken=0.85)},
                 wounds=[Wound("half", n=(0.38, 0.92, 0.0), d=13.9, jag=1.5, seed=41),
                         Wound("sph", c=(3.0, 11.0, -5.5), r=4.2, jag=1.6, seed=42)], **common)
    main.build()
    wing = Block(p, -16, -4, 5.5, 22, F, fh, 3, 4, sides="FLR", floor_style={0: dict(sp=0.5, wh=2.2, pbroken=0.85)},
                 wounds=[Wound("half", n=(0.0, 0.767, 0.641), d=21.8, jag=1.8, seed=43),
                         Wound("sph", c=(-4.0, 9.5, 14.0), r=5.0, jag=1.7, seed=44)], **common)
    wing.build()
    # access galleries along the courtyard side of the wing (+X face), per floor
    for f in range(1, F):
        y = wing.yf(f)
        blk, s = wing, "L"
        n, t, O, length, nb = blk.side_frame(s)
        bay = length / nb
        for b in range(nb):
            ix, iz = blk.bay_cell(s, b)
            if not blk.alive(f, ix, iz):
                continue
            c = side_pt(blk, s, (b + 0.5) * bay, 0.0, y + 1.0)
            if removed(blk.wounds, c.x, y + 1.0, c.z, 1.0) or rng.random() < 0.12:
                continue
            sbox(blk, s, "concrete", b * bay, (b + 1) * bay, -0.1, 1.5, y - 0.02, y + 0.22, tint=rng.uniform(0.85, 1.0))
            sbox(blk, s, "metal_dark", b * bay, (b + 1) * bay, 1.42, 1.5, y + 0.22, y + 1.1, skip=("ny",), tint=0.85)
    top = F * fh
    roof_prop(main, "mech", [(-2, 2.0), (-6, 2.0), (-11, 0)], sx=4.0, sy=2.2, sz=3.0)
    roof_prop(wing, "mech", [(-12, 12.0), (-10, 9), (-13, 16)], sx=3.0, sy=2.0, sz=3.0)
    roof_prop(main, "tank", [(-11, -1.5), (-13, 1.5), (-8, -2.5), (-5, 0)], r=1.4, h=2.2, legs=1.5)
    roof_prop(main, "antenna", [(0.5, 0.0), (-3, 3), (-8, 3), (-14, 0)], h=9, lean=(0.06, 0.03))
    rubble(p, -10.0, 26.0, 7.0, 5.0, 20, rng, big=2.6, rebar=4)
    rubble(p, 7.0, 8.5, 6.0, 4.5, 16, rng, big=2.6, rebar=3)
    p.notes = dict(desc="Ruined 7-floor concrete apartment complex, L-plan (long block + front wing) with access galleries, collapsed slanted roof-lines. Front +Z, origin base centre.",
                   height=round(top, 1), footprint=[24, 27.5], front="+Z", lean_deg=1.5)
    lean(p, kx=0.026, kz=0.0, curve=0.0005)
    return p


def lowrise_a():
    p = Piece("ruin_lowrise_a", seed=96, ground_y=0.0, dirt_h=2.6, dirt_amt=0.55, ao_dist=2.5, facejit=0.1)
    rng = wn(p)
    F = 3
    common = dict(sp=0.9, wh=1.5, pw=0.9, proud=0.1, msp="brick", mpier="concrete", mhead="brick", pbroken=0.5, rng=rng, p_missing=0.04, sills=True,
                  parapet=0.9, mroof="concrete", tint_var=0.14, pier_sub=6.0, stub_keep=0.7, mult=(0.82, 0.78, 0.76), curtain_p=0.10, ac_p=0.06)
    b = Block(p, -8.5, 8.5, -6.5, 6.5, F, 3.6, 4, 3, y0=0.0, floor_style={0: dict(sp=0.5, wh=2.6, pbroken=0.9, msp="concrete", mhead="concrete")},
              wounds=[Wound("box", lo=(1.0, 6.0, 0.0), hi=(None, None, None), jag=1.5, seed=51),
                      Wound("sph", c=(-4.0, 8.0, 6.5), r=2.8, jag=1.0, seed=52)], **common)
    b.build()
    awning(b, "F", 3.4, rng, out=2.2, drop=0.6, u0=0.5, u1=12.5, seg=1.2)
    # sign board over the awning
    sbox(b, "F", "paint", 1.0, 8.5, 0.1, 0.45, 3.55, 4.9, tint=0.95)
    sbox(b, "F", "metal_dark", 0.95, 1.05, 0.0, 0.45, 3.4, 3.55, sub=0)
    top = F * 3.6
    yb_ = b.roof_at(-5.5, 5.0)
    if yb_ is not None:
        p.box("paint", (-5.5, yb_ + 2.6, 5.0), (7.0, 3.2, 0.3), rot=(0, 0, -6), tint=0.9)
        for x in (-8.5, -2.5):
            p.tube("metal_dark", (x, yb_, 5.0), (x + (0.3 if x < -5 else -0.2), yb_ + 3.0, 5.0), 0.07, sides=4, smooth=False)
    roof_prop(b, "tank", [(-4.0, -3.0), (-6, -3), (0, -3)], r=1.1, h=1.8, legs=1.3)
    roof_prop(b, "mech", [(-1.0, 1.5), (-6, 0), (2, -3)], sx=2.5, sy=1.4, sz=2.0)
    rubble(p, 6.5, 9.0, 6.0, 3.5, 16, rng, big=2.0, rebar=3)
    p.notes = dict(desc="Ruined 3-floor corner shop: storefront with torn striped awning, blank sign panel, roof billboard, collapsed +X roof corner. Front +Z, origin base centre.",
                   height=round(top, 1), footprint=[17, 13], front="+Z", lean_deg=0.0)
    return p


def lowrise_b():
    p = Piece("ruin_lowrise_b", seed=107, ground_y=0.0, dirt_h=2.6, dirt_amt=0.55, ao_dist=2.5, facejit=0.1)
    rng = wn(p)
    F, fh = 2, 4.2
    common = dict(sp=0.9, wh=1.7, pw=0.8, proud=0.1, msp="concrete", mpier="concrete_dark", mhead="concrete", pbroken=0.55, rng=rng, p_missing=0.04,
                  sills=True, parapet=1.1, mroof="concrete_dark", tint_var=0.14, pier_sub=6.0, stub_keep=0.7, mtop_par="paint2", curtain_p=0.08, ac_p=0.05)
    b = Block(p, -16, 16, -5, 5, F, fh, 8, 2, floor_style={0: dict(sp=0.4, wh=3.0, pbroken=0.85, msp="metal_dark", mhead="metal_dark")},
              wounds=[Wound("box", lo=(-18, 3.0, None), hi=(-6.0, None, None), jag=1.8, seed=61),
                      Wound("sph", c=(9.0, 8.4, 5.0), r=3.8, jag=1.2, seed=62)], **common)
    b.build()
    # colonnade + flat canopy over the shop fronts
    cy = 3.6
    for k in range(9):
        x = -16 + k * 4.0
        if x < -8:
            continue
        p.bx("concrete", (x - 0.22, x + 0.22), (0, cy), (5 + 2.8 - 0.22, 5 + 2.8 + 0.22), skip=("ny",), sub=0, tint=rng.uniform(0.8, 1.0))
    p.bx("concrete_dark", (-8.6, 16.3), (cy, cy + 0.4), (4.6, 8.3), sub=4.0, skip=("ny",))
    p.bx("paint2", (-8.6, 16.3), (cy + 0.4, cy + 0.9), (8.0, 8.3), sub=3.0)
    # pylon sign next to the building
    top = F * fh
    p.tube("metal_dark", (20, 0, 8), (20, 11, 8), 0.28, sides=8)
    p.box("paint", (20, 10.2, 8), (0.35, 3.0, 4.5), tint=0.9)
    p.box("paint2", (20, 8.4, 8), (0.42, 0.9, 4.6), tint=0.85)
    p.bx("metal_dark", (19.6, 20.4), (0, 0.5), (7.6, 8.4), bevel=0.05)
    roof_prop(b, "mech", [(-2, 0.0), (-4, 1), (0, 1)], sx=3.5, sy=1.6, sz=2.5)
    roof_prop(b, "mech", [(6, -1.0), (4, -2), (8, 1)], sx=2.5, sy=1.2, sz=2.0)
    roof_prop(b, "tank", [(12, -2.0), (13, 1.0), (10, -2)], r=1.0, h=1.6, legs=1.2)
    rubble(p, -12, 9.0, 9.0, 5.0, 24, rng, big=2.4, rebar=4)
    p.cbx((19.6, 20.4), (0, 11.5), (7.6, 8.4))
    p.cbx((-8.6, 16.3), (cy, cy + 0.9), (4.6, 8.3))
    p.notes = dict(desc="Ruined 2-floor strip mall with colonnade canopy, pylon sign, one end collapsed to rubble. Front +Z, origin base centre. Pylon sign stands at x=20 (outside the 32 m body).",
                   height=round(top, 1), footprint=[32, 10], front="+Z")
    return p


def lowrise_c():
    p = Piece("ruin_lowrise_c", seed=118, ground_y=0.0, dirt_h=2.6, dirt_amt=0.55, ao_dist=2.5, facejit=0.1)
    rng = wn(p)
    F, fh = 3, 3.7
    common = dict(sp=0.9, wh=1.6, pw=1.0, proud=0.12, msp="brick", mpier="brick", mhead="brick", pbroken=0.5, rng=rng, p_missing=0.05,
                  sills=True, parapet=0.9, mroof="concrete", tint_var=0.16, pier_sub=6.0, stub_keep=0.7, mult=(0.82, 0.78, 0.76), curtain_p=0.10, ac_p=0.06)
    b = Block(p, -10, 6, -7, 7, F, fh, 4, 4, floor_style={0: dict(sp=0.5, wh=2.4, pbroken=0.85)},
              wounds=[Wound("half", n=(-0.6, 0.8, 0.0), d=0.8 * 7.6 - 0.6 * 1.0, jag=1.4, seed=71),
                      Wound("sph", c=(-10.0, 5.5, -6.0), r=3.5, jag=1.2, seed=72)], **common)
    b.build()
    # round corner turret at the front-right corner (x=6, z=7): loft with a jagged top
    cx, cz, R = 6.0, 7.0, 3.0
    N = 14
    levels = [0.0, 3.7, 7.4]
    top_h = [8.6 + rng.uniform(-0.6, 3.4) for _ in range(N)]
    rings = [[(cx + math.cos(2 * math.pi * k / N) * R, yl, cz + math.sin(2 * math.pi * k / N) * R) for k in range(N)] for yl in levels]
    rings.append([(cx + math.cos(2 * math.pi * k / N) * R * 0.99, top_h[k], cz + math.sin(2 * math.pi * k / N) * R * 0.99) for k in range(N)])
    p.loft("brick", rings, closed=True, cap_a=True, cap_b=True, sub=3.0, sg=p._new_sg(), tint=(0.78, 0.72, 0.7))
    # turret windows: dark quads
    for li in range(3):
        for k in range(N):
            if k % 2:
                continue
            a0, a1 = 2 * math.pi * (k + 0.2) / N, 2 * math.pi * (k + 0.8) / N
            y0, y1 = levels[li] + 1.0, levels[li] + 2.5
            rr = R + 0.03
            q0 = (cx + math.cos(a0) * rr, y0, cz + math.sin(a0) * rr)
            q1 = (cx + math.cos(a1) * rr, y0, cz + math.sin(a1) * rr)
            q2 = (cx + math.cos(a1) * rr, y1, cz + math.sin(a1) * rr)
            q3 = (cx + math.cos(a0) * rr, y1, cz + math.sin(a0) * rr)
            p.quad("concrete_dark", q0, q3, q2, q1, tint=0.16)
    for yl in (3.7, 7.4):
        p.cyl("concrete", (cx, yl, cz), R + 0.14, 0.3, "y", sides=N, smooth=False)
    rebar_tuft(p, cx, 9.2, cz, n=4, length=(0.8, 2.0), spread=1.4, rng=rng)
    awning(b, "F", 3.3, rng, out=2.0, drop=0.5, u0=1.0, u1=12.0, seg=1.2, stripe=((0.2, 0.45, 0.7), (0.85, 0.8, 0.66)))
    top = F * fh
    roof_prop(b, "mech", [(-4, -2), (-7, -3), (0, -4)], sx=3.5, sy=1.5, sz=2.5)
    roof_prop(b, "antenna", [(-7.5, 2.0), (-8, -1), (-3, 3)], h=5.0)
    rubble(p, -9.0, -9.0, 6.0, 3.5, 14, rng, big=2.2, rebar=3)
    rubble(p, 9.0, 11.5, 5.5, 3.5, 10, rng, big=1.8, rebar=2)
    p.cbox((cx, 5.0, cz), (2 * R, 10.0, 2 * R))
    p.notes = dict(desc="Ruined 3-floor brick block with a round corner turret (jagged broken top) at the front-right corner and a slanted collapsed roof. Front +Z, origin base centre.",
                   height=11.1, footprint=[16, 14], front="+Z")
    lean(p, kx=0.02, kz=0.0, curve=0.0)
    return p


for _id, _fn in (("ruin_office_a", office_a), ("ruin_office_b", office_b), ("ruin_office_c", office_c), ("ruin_apartment_a", apartment_a),
                 ("ruin_apartment_b", apartment_b), ("ruin_lowrise_a", lowrise_a), ("ruin_lowrise_b", lowrise_b), ("ruin_lowrise_c", lowrise_c)):
    if want(_id):
        _fn().build()
