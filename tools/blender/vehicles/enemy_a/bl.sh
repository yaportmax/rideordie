#!/bin/bash
# usage: bl.sh <script-name-without-.py> [args...]   -> runs blender headless, prints tail of log
cd C:/Dev/rideordie
name=$1; shift
"C:/Dev/tools/Blender-4.5.11-portable/blender.exe" -b --factory-startup -P tools/blender/vehicles/enemy_a/$name.py -- "$@" > shots/enemy_a/_$name.log 2>&1
grep -E "^\[|REPORT|Error|Traceback|EXPORTED|line [0-9]+|rror:" shots/enemy_a/_$name.log | head -40
