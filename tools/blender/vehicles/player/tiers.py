"""tiers - dimension/style config for the four player trucks (game coords: x left+, f forward+, z up)."""
from types import SimpleNamespace

BASE = dict(
    id='truck_t1', name='Rustbucket', tier=1,
    L=4.90, W=1.78, wb=2.75, fa=1.54,
    R=0.335, tw=0.185, rimR=0.19, track=0.735, arch_R=0.425,
    tread='bald', lug_depth=0.0, lug_pitch=3, wheel_style='steel', beadlock=False, wheel_seg=48, drum_rear=True,
    # frame / floor levels
    rail_x=0.45, rail_z=0.36, z_floor=0.45, z_sill=0.33,
    z_belt=1.04, z_roof=1.66, z_ws_base=1.08, f_cowl=1.02, ws_run=0.34,
    f_back=-0.56, cab_hw=0.80,
    # hood / nose
    hood_hw=0.655, z_hood_r=1.055, z_hood_f=0.985, hood_crown=0.03, f_grille=2.27, f_nose=2.45,
    fender_top=1.00, fender_hw=0.89,
    # doors
    f_df=0.90, f_dr=-0.46, door_hw=0.885,
    # bed
    z_bed=0.80, bed_wall=0.36, f_bf=-0.64, f_tail=-2.22, bed_hw=0.89, bed_wall_t=0.06,
    # seat
    seat='bench', driver_x=0.37, seat_f=0.06, seat_z=0.62,
    # style
    paint_door_R=True, roll_bar=False, bull_bar=False, fender_flare=False,
    dense=0.065, wear=0.85, dents=True, rust_patches=12,
)


def tier(n):
    import importlib
    d = dict(BASE)
    d.update(importlib.import_module('tcfg_t%d' % n).OVERRIDES)
    d['hw'] = d['W'] / 2
    d['ra'] = d['fa'] - d['wb']
    d['bed_top'] = d['z_bed'] + d['bed_wall']
    return SimpleNamespace(**d)
