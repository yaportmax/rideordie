#!/bin/bash
# usage: tools/env/props/run.sh road_barriers.py name [name ...]
cd C:/Dev/rideordie
script=$1; shift
"C:/Dev/tools/Blender-4.5.11-portable/blender.exe" -b --factory-startup -P tools/env/props/$script -- "$@" 2>&1 | grep -E "PROP|Error|Traceback|line [0-9]+|Exception|error" 
