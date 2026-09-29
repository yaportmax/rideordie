#!/bin/bash
# Rebuild manifest + credits + textures README, shoot every prop and make the contact sheet (shots/env/contact_sheet.png).
# usage: bash tools/env/finalize.sh      (dev server must be running on :5173)
cd C:/Dev/rideordie
PY=C:/Dev/conduit/art_src/venv/Scripts/python.exe
$PY tools/env/build_manifest.py
$PY tools/env/build_credits.py
$PY tools/env/build_readme.py
names=$($PY -c "import json;print(' '.join(json.load(open('public/models/props/manifest.json'))['props'].keys()))")
node tools/env/shots.mjs --w=480 --h=320 $names > /dev/null
$PY tools/env/contact.py shots/env/contact_sheet.png --cols 6 --w 480 --h 320
