#!/bin/bash
# usage: run.sh <script.py>   (from anywhere)
cd C:/Dev/rideordie
"C:/Dev/tools/Blender-4.5.11-portable/blender.exe" -b --factory-startup -P "tools/blender/vehicles/enemy_b/$1" 2>&1 | grep -vE "WARNING: More than one|INFO:|^$|Blender 4.5|Blender quit"
