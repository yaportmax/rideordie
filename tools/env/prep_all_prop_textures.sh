#!/bin/bash
# Reproducible prep of every 512px prop texture set (props texture cache, see envlib.PTEX). Run after build_textures.py.
cd "$(dirname "$0")/../.."
PY=C:/Dev/conduit/art_src/venv/Scripts/python.exe
$PY tools/env/tex_fetch.py --res 1k rusty_metal_02 rough_wood weathered_brown_planks pine_bark bark_willow palm_bark knotted_pine_bark
$PY tools/env/prep_prop_textures.py rock_red rock_grey cliff concrete concrete_cracked rust_metal brick_ruin dirt_red asphalt
$PY tools/env/prep_prop_textures.py rusty_metal_02:galv_rust rough_wood:wood_rough weathered_brown_planks:wood_planks
rm -f C:/Dev/art_cache/rideordie/props_tex/galv_rust_orig_*.jpg     # prop_tex_variants.py re-derives galv_rust from a fresh copy
$PY tools/env/prop_tex_variants.py
$PY tools/env/veg_prep_textures.py
$PY tools/env/sign_textures.py
