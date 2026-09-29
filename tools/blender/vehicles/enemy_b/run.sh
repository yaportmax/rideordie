#!/bin/bash
# usage: run.sh <script.py>   (from anywhere).  Env: VEH_OUT=shots/enemy_b/test to write test GLBs outside public/.
cd C:/Dev/rideordie
"C:/Dev/tools/Blender-4.5.11-portable/blender.exe" -b --factory-startup -P "tools/blender/vehicles/enemy_b/$1" 2>&1 | grep -vE "WARNING: More than one|INFO:|^$|Blender 4.5|Blender quit"
