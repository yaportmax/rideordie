"""shipping_container + shipping_container_stack3 (fork B1)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_outpost_common import *


def _container(p, pitch=0.25, door_open=0.0, rust_seed=1, stencil=True):
    """20 ft container, origin bottom-centre, doors at +Z. 6.06 x 2.44 x 2.59."""
    L, W, H = 6.06, 2.44, 2.59
    hl, hw = L / 2, W / 2
    rr = random.Random(rust_seed)
    fr = (0.82, 0.82, 0.82)
    # base + top frame rails
    for s in (-1, 1):
        p.bx("paint", (s * (hw - 0.075) - 0.075, s * (hw - 0.075) + 0.075), (0.0, 0.17), (-hl, hl), tint=fr, skip=("ny",))
        p.bx("paint", (s * (hw - 0.075) - 0.075, s * (hw - 0.075) + 0.075), (H - 0.12, H), (-hl, hl), tint=fr)
    for z in (-hl + 0.075, hl - 0.075):
        p.bx("paint", (-hw, hw), (H - 0.12, H), (z - 0.075, z + 0.075), tint=fr)
        p.bx("paint", (-hw, hw), (0.0, 0.17), (z - 0.075, z + 0.075), tint=fr, skip=("ny",))
    for z in (-2.2, -0.9, 0.4, 1.7):
        p.bx("metal_dark", (-hw + 0.1, hw - 0.1), (0.04, 0.16), (z - 0.05, z + 0.05), skip=("py",))
    p.bx("wood", (-hw + 0.1, hw - 0.1), (0.15, 0.2), (-hl + 0.1, hl - 0.1), sub=2.0)
    # corner posts + castings
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.bx("paint", (sx * (hw - 0.075) - 0.075, sx * (hw - 0.075) + 0.075), (0.17, H - 0.12),
                 (sz * (hl - 0.075) - 0.075, sz * (hl - 0.075) + 0.075), tint=(0.75, 0.75, 0.75))
            for y in (0.0, H - 0.13):
                p.bx("metal_dark", (sx * (hw - 0.08) - 0.09, sx * (hw - 0.08) + 0.09), (y, y + 0.13),
                     (sz * (hl - 0.08) - 0.09, sz * (hl - 0.08) + 0.09))
    # corrugated side walls, back wall, roof
    for s in (-1, 1):
        corr_wall_x(p, "paint", s * (hw - 0.06), s, 0.17, H - 0.12, -hl + 0.15, hl - 0.15, pitch=pitch, depth=0.055)
    corr_wall_z(p, "paint", -(hl - 0.15), -1, 0.17, H - 0.12, -hw + 0.15, hw - 0.15, pitch=pitch, depth=0.055)
    corr_roof(p, "paint", -hw + 0.15, hw - 0.15, -hl + 0.15, hl - 0.15, H - 0.13, pitch=pitch, depth=0.05, tint=(0.9, 0.9, 0.9))
    # door end: header, sill, dark interior, two leaves
    p.bx("paint", (-hw + 0.15, hw - 0.15), (H - 0.28, H - 0.12), (hl - 0.16, hl - 0.04), tint=fr)
    p.bx("paint", (-hw + 0.15, hw - 0.15), (0.17, 0.3), (hl - 0.16, hl - 0.04), tint=fr)
    p.bx("metal_dark", (-hw + 0.15, hw - 0.15), (0.3, H - 0.28), (hl - 0.3, hl - 0.25))
    for s in (-1, 1):
        x0, x1 = (0.02, hw - 0.14) if s > 0 else (-hw + 0.14, -0.02)

        def leaf():
            p.bx("paint", (x0, x1), (0.3, H - 0.28), (hl - 0.12, hl - 0.06), tint=(0.95, 0.95, 0.95), skip=("nz",))
            for j in range(5):
                xr = x0 + 0.1 + j * (x1 - x0 - 0.2) / 4
                p.bx("paint", (xr - 0.035, xr + 0.035), (0.34, H - 0.32), (hl - 0.06, hl - 0.03), tint=0.9, skip=("nz",))
            bars = (x0 + 0.11, x0 + (x1 - x0) * 0.42) if s > 0 else (x1 - (x1 - x0) * 0.42, x1 - 0.11)
            for xb in bars:
                p.tube("metal_bare", (xb, 0.14, hl - 0.005), (xb, H - 0.12, hl - 0.005), 0.018, sides=6, smooth=False)
                for y in (0.35, 0.9, H - 0.4):
                    p.bx("metal_dark", (xb - 0.05, xb + 0.05), (y - 0.04, y + 0.04), (hl - 0.03, hl + 0.005))
                p.bx("metal_dark", (xb - 0.02, xb + 0.02), (1.2, 1.5), (hl - 0.01, hl + 0.06))
            xh = x1 if s > 0 else x0
            for y in (0.5, 1.3, 2.1):
                p.bx("metal_dark", (xh - 0.04, xh + 0.04), (y - 0.08, y + 0.08), (hl - 0.12, hl - 0.03))
        if door_open and s > 0:
            M = Matrix.Translation((x1, 0, hl - 0.06)) @ xf((0, 0, 0), (0, -door_open, 0)) @ Matrix.Translation((-x1, 0, -(hl - 0.06)))
            xform_block(p, M, leaf)
        else:
            leaf()
    if stencil:
        p.bx("paint2", (-0.9, -0.25), (2.05, 2.11), (hl - 0.03, hl - 0.005), tint=0.85)
        p.bx("paint2", (-0.9, -0.5), (1.92, 1.97), (hl - 0.03, hl - 0.005), tint=0.85)
        for s in (-1, 1):
            p.bx("paint2", ((hw + 0.0, hw + 0.012) if s > 0 else (-hw - 0.012, -hw)), (1.55, 2.15), (-2.35, -0.55), tint=0.88)
    # rust patches on the sides
    for s in (-1, 1):
        for j in range(3):
            zc = rr.uniform(-2.4, 2.4)
            w, h = rr.uniform(0.5, 1.3), rr.uniform(0.25, 0.7)
            yc = 0.17 + h / 2 + rr.uniform(0, 0.2)
            p.bx("rust", ((hw + 0.004, hw + 0.012) if s > 0 else (-hw - 0.012, -hw - 0.004)), (yc - h / 2, yc + h / 2), (zc - w / 2, zc + w / 2))


def shipping_container():
    p = Piece("shipping_container", seed=41, ground_y=0.0, dirt_h=0.9, dirt_amt=0.55, ao_dist=1.5, ao_amt=0.7, noise_amt=0.35)
    p.notes = dict(desc="20 ft ISO container 6.06 x 2.44 x 2.59 m, doors at +Z. `paint` = whole shell (grayscale wear, game tints it); `paint2` = stencil marks; rust patches.",
                   dims=[2.44, 2.59, 6.06], front="+Z (doors)", stack_height=2.59)
    _container(p, pitch=0.24, stencil=True)
    p.cbox((0, 1.295, 0), (2.44, 2.59, 6.06))
    return p


def shipping_container_stack3():
    p = Piece("shipping_container_stack3", seed=42, ground_y=0.0, dirt_h=1.2, dirt_amt=0.5, ao_dist=1.5, ao_amt=0.7, noise_amt=0.35)
    p.notes = dict(desc="3 ISO containers stacked untidily: middle shifted/yawed with a door ajar, top one slid off, rolled ~3 deg and propped on junk. Shell = `paint` (tint). Front +Z (doors).",
                   footprint=[3.6, 6.4], height=7.9, front="+Z")
    H = 2.59
    _container(p, pitch=0.42, stencil=False, rust_seed=2)
    xform_block(p, xf((0.3, H, -0.7), (0, 4.0, 0)), lambda: _container(p, pitch=0.42, door_open=70, rust_seed=3, stencil=True))
    xform_block(p, xf((-0.35, 2 * H + 0.05, 0.9), (0, -11.0, 3.0)), lambda: _container(p, pitch=0.42, stencil=False, rust_seed=4))
    crate(p, 2.1, 1.2, 2 * H - 0.3, 0.55, rot=25)
    tyre_stack(p, 1.7, 3.9, 2, 0.0, seed=6)
    for k, (x, z) in enumerate(((2.0, 4.3), (2.6, 3.7))):
        barrel(p, x, z, 0.0, mat="rust" if k else "metal_dark")
    p.cbox((0, H / 2, 0), (2.44, H, 6.06))
    p.cbox((0.3, H * 1.5, -0.7), (2.44, H, 6.06), rot=(0, 4.0, 0))
    p.cbox((-0.35, 2.5 * H + 0.05, 0.9), (2.5, H, 6.06), rot=(0, -11.0, 3.0))
    return p
